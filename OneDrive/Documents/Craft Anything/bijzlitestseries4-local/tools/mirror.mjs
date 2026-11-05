#!/usr/bin/env node
/*
 * Build a complete local mirror of the test library and generate
 * the same series manifest shape the app already uses.
 *
 * Usage:
 *   node tools/mirror.mjs                     # download everything
 *   node tools/mirror.mjs --limit 5           # first 5 tests only
 *   node tools/mirror.mjs --match "GATE 2027" # tests whose path/title matches
 *   node tools/mirror.mjs --branch "ELECTRICAL ENGINEERING"
 *   node tools/mirror.mjs --force             # overwrite existing files
 *   node tools/mirror.mjs --map-only          # rebuild manifest/map only
 *   node tools/mirror.mjs --verify            # check local files + report
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const LIB = join(ROOT, "library");
const ORIGIN = "https://dvruo-test-series.netlify.app";
const SOURCE_MANIFEST = join(ROOT, "data", "source-manifest.json");
const TARGET_MANIFEST = join(ROOT, "src", "data", "series-manifest.json");
const TEST_MAP = join(ROOT, "data", "test-map.json");
const MATHJAX_SRC = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg-full.js";
const MATHJAX_LOCAL = "assets/mathjax/tex-svg-full.js";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const LIMIT = Math.max(0, Number(opt("--limit", 0)) || 0);
const BRANCH = opt("--branch", "");
const MATCH = opt("--match", "");
const CONCURRENCY = Math.max(1, Number(opt("--concurrency", 6)) || 6);
const FORCE = flag("--force");
const MAP_ONLY = flag("--map-only");
const VERIFY = flag("--verify");
const PAPERS_ONLY = flag("--papers-only");
const ASSETS_ONLY = flag("--assets-only");

const encoder = (path) => String(path).split("/").map(encodeURIComponent).join("/");
const paperUrl = (path) => `${ORIGIN}/${encoder(path)}`;
const mirrorPath = (path) => String(path).replace(/\/BIJZLIACE\//g, "/DVRUOACE/");

const manifest = JSON.parse(await readFile(SOURCE_MANIFEST, "utf8"));

function flatten(source) {
  const out = [];
  for (const branch of source.branches) {
    for (const provider of branch.providers) {
      for (const series of provider.series) {
        for (const test of series.tests) {
          out.push({ branch, provider, series, test });
        }
      }
    }
  }
  return out;
}

const allTests = flatten(manifest);
let selected = allTests;
if (BRANCH) {
  const wanted = BRANCH.toLowerCase();
  selected = selected.filter((item) => item.branch.name.toLowerCase() === wanted);
}
if (MATCH) {
  const wanted = MATCH.toLowerCase();
  selected = selected.filter(
    (item) =>
      item.test.path.toLowerCase().includes(wanted) ||
      item.test.title.toLowerCase().includes(wanted) ||
      item.test.fileName.toLowerCase().includes(wanted)
  );
}
if (LIMIT) selected = selected.slice(0, LIMIT);

const state = {
  downloaded: 0,
  skipped: 0,
  bytes: 0,
  failures: [],
  resources: new Set(),
  external: new Map(),
  externalFailures: []
};

function log(message) {
  console.log(message);
}

function safeInsideLib(relativePath) {
  const target = resolve(LIB, relativePath);
  return target === LIB || target.startsWith(LIB + sep) ? target : null;
}

async function fetchBuffer(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": UA, accept: "*/*" },
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

async function download(relativePath, outPath, options = {}) {
  const force = options.force ?? FORCE;
  if (!force && existsSync(outPath)) {
    const info = await stat(outPath);
    if (info.size > 0) {
      state.skipped += 1;
      return { skipped: true, size: info.size };
    }
  }
  const buffer = await fetchBuffer(paperUrl(relativePath));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  state.downloaded += 1;
  state.bytes += buffer.length;
  return { skipped: false, size: buffer.length };
}

async function pool(items, worker, concurrency) {
  let index = 0;
  const results = new Array(items.length);
  async function runner() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = { ok: true, value: await worker(items[current], current) };
      } catch (error) {
        results[current] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function tagAttributes(tag) {
  const attrs = new Map();
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = attrRe.exec(tag))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Extract content references from an HTML or CSS document. */
function extractRefs(text, isCss = false) {
  const refs = [];

  if (!isCss) {
    const tagRe = /<([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g;
    let match;
    while ((match = tagRe.exec(text))) {
      const tagName = match[1].toLowerCase();
      if (tagName === "a") continue;
      const attrs = tagAttributes(match[0]);
      const contentAttrs = ["src", "href", "poster", "data-src", "data-href", "data-poster"];
      for (const name of contentAttrs) {
        if (!attrs.has(name)) continue;
        const value = attrs.get(name).trim();
        if (!value) continue;
        if (tagName === "link") {
          const rel = (attrs.get("rel") || "").toLowerCase();
          if (rel && !/(stylesheet|icon|preload|modulepreload|prefetch)/.test(rel)) continue;
        }
        refs.push(value);
      }
      for (const name of ["srcset", "data-srcset"]) {
        if (!attrs.has(name)) continue;
        for (const candidate of attrs.get(name).split(",")) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) refs.push(url);
        }
      }
      if ((attrs.get("style") || "").includes("url(")) {
        refs.push(...cssRefs(attrs.get("style")));
      }
    }

    const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    while ((match = styleRe.exec(text))) {
      refs.push(...cssRefs(match[1]));
    }

    // JSON-embedded markup (the 2027 classes papers) can contain media paths
    // as plain strings. Catch those even if the surrounding markup is escaped.
    const mediaRe = /((?:\.\.\/)+media\/[A-Za-z0-9._%~/-]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif))/gi;
    while ((match = mediaRe.exec(text))) refs.push(match[1]);
  } else {
    refs.push(...cssRefs(text));
  }

  return Array.from(new Set(refs.map((ref) => decodeEntities(ref).trim()).filter(Boolean)));
}

function cssRefs(text) {
  const refs = [];
  let match;
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
  while ((match = urlRe.exec(text))) refs.push(match[1] ?? match[2] ?? match[3] ?? "");
  const importRe = /@import\s+(?:url\()?\s*["']([^"']+)["']/gi;
  while ((match = importRe.exec(text))) refs.push(match[1]);
  return refs.filter(Boolean);
}

function resolveRef(ref, docRelativePath) {
  const clean = String(ref || "").trim();
  if (!clean) return null;
  if (/^(?:#|data:|mailto:|tel:|javascript:|blob:)/i.test(clean)) return null;
  const base = new URL(`http://local.mirror/${encoder(docRelativePath)}`);
  let url;
  try {
    url = new URL(clean, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const dvruoHost = new URL(ORIGIN).hostname;
  if (url.hostname === "local.mirror" || url.hostname === dvruoHost) {
    let pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!pathname) return null;
    return { internal: true, path: pathname };
  }
  return {
    internal: false,
    url: url.href,
    host: url.hostname,
    pathname: decodeURIComponent(url.pathname),
    original: clean
  };
}

async function walk(dir, filter) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, filter)));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

async function downloadPapers() {
  if (ASSETS_ONLY) return;
  let done = 0;
  log(`[papers] downloading ${selected.length} test paper(s) with concurrency ${CONCURRENCY}`);
  const results = await pool(
    selected,
    async (item) => {
      const localPath = mirrorPath(item.test.path);
      const outPath = safeInsideLib(localPath);
      if (!outPath) throw new Error(`unsafe path: ${localPath}`);
      const result = await download(localPath, outPath);
      item.localPath = localPath;
      item.status = "ok";
      item.bytes = result.size;
      done += 1;
      if (done % 25 === 0 || done === selected.length) {
        log(
          `[papers] ${done}/${selected.length} | ${(state.bytes / 1048576).toFixed(1)} MB new | ` +
            `${state.skipped} already present | ${state.failures.length} failed`
        );
      }
      return result;
    },
    CONCURRENCY
  );

  for (let index = 0; index < results.length; index += 1) {
    if (!results[index].ok) {
      const item = selected[index];
      const localPath = mirrorPath(item.test.path);
      item.status = "missing";
      item.error = results[index].error?.message || "download failed";
      state.failures.push({ path: localPath, error: item.error });
    }
  }
  log(`[papers] done: ${selected.length - state.failures.length} ok, ${state.failures.length} failed`);
}

async function collectResources() {
  const files = await walk(LIB, (name) => /\.(html?|css)$/i.test(name));
  log(`[scan] ${files.length} HTML/CSS file(s) under ${LIB}`);
  const internal = new Map();
  for (const file of files) {
    const rel = relative(LIB, file).split(sep).join("/");
    const isCss = /\.css$/i.test(file);
    const text = await readFile(file, "utf8").catch(() => "");
    for (const ref of extractRefs(text, isCss)) {
      const resolved = resolveRef(ref, rel);
      if (!resolved) continue;
      if (resolved.internal) {
        if (resolved.path !== rel) internal.set(resolved.path, rel);
      } else {
        if (!state.external.has(resolved.url)) {
          state.external.set(resolved.url, { ...resolved, sources: new Set() });
        }
        state.external.get(resolved.url).sources.add(rel);
      }
    }
  }
  state.resources = internal;
  log(`[assets] found ${internal.size} local asset paths and ${state.external.size} external content URLs`);
}

async function downloadResources() {
  if (PAPERS_ONLY) return;
  const queue = new Map(state.resources);
  const processedCss = new Set();
  let round = 0;

  while (queue.size) {
    round += 1;
    const items = Array.from(queue.entries());
    queue.clear();
    log(`[assets] round ${round}: downloading ${items.length} file(s)`);

    const results = await pool(
      items,
      async ([relativePath]) => {
        const outPath = safeInsideLib(relativePath);
        if (!outPath) throw new Error(`unsafe asset path: ${relativePath}`);
        return download(relativePath, outPath);
      },
      CONCURRENCY
    );

    for (let index = 0; index < results.length; index += 1) {
      const [relativePath] = items[index];
      if (!results[index].ok) {
        state.failures.push({ path: relativePath, error: results[index].error?.message || "download failed" });
        continue;
      }
      if (!/\.css$/i.test(relativePath) || processedCss.has(relativePath)) continue;
      processedCss.add(relativePath);
      const full = safeInsideLib(relativePath);
      if (!full) continue;
      const css = await readFile(full, "utf8").catch(() => "");
      for (const ref of cssRefs(css)) {
        const resolved = resolveRef(ref, relativePath);
        if (!resolved) continue;
        if (resolved.internal && !existsSync(safeInsideLib(resolved.path) || "")) {
          queue.set(resolved.path, relativePath);
        } else if (!resolved.internal && !state.external.has(resolved.url)) {
          state.external.set(resolved.url, { ...resolved, sources: new Set([relativePath]) });
        }
      }
    }

    if (round > 4) {
      log("[assets] stopping after 4 rounds");
      break;
    }
  }
}

async function vendorMathJax() {
  if (PAPERS_ONLY) return;
  const outPath = join(LIB, MATHJAX_LOCAL);
  if (!existsSync(outPath) || FORCE) {
    try {
      const buffer = await fetchBuffer(MATHJAX_SRC);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buffer);
      state.downloaded += 1;
      state.bytes += buffer.length;
      log(`[assets] vendored MathJax (${(buffer.length / 1048576).toFixed(1)} MB)`);
    } catch (error) {
      state.failures.push({ path: MATHJAX_LOCAL, error: error.message });
      log(`[assets] MathJax download failed: ${error.message}`);
    }
  } else {
    state.skipped += 1;
  }

  // calculator.js loads its stylesheet/icon via string concatenation
  // (baseAssetsPath + "calculator.css"), so the HTML scanner never sees them.
  // Fetch them explicitly or the panel renders unstyled at the page bottom.
  for (const name of ["calculator.css", "calculator-icon.png"]) {
    const assetPath = `assets/${name}`;
    const assetOut = join(LIB, assetPath);
    if (existsSync(assetOut) && !FORCE) {
      state.skipped += 1;
      continue;
    }
    try {
      const buffer = await fetchBuffer(`${ORIGIN}/${assetPath}`);
      await mkdir(dirname(assetOut), { recursive: true });
      await writeFile(assetOut, buffer);
      state.downloaded += 1;
      state.bytes += buffer.length;
      log(`[assets] downloaded ${assetPath} (${buffer.length} bytes)`);
    } catch (error) {
      state.failures.push({ path: assetPath, error: error.message });
      log(`[assets] ${assetPath} download failed: ${error.message}`);
    }
  }

  // The supplied math-boot.js tries assets/mathjax first and only falls back
  // to the CDN. Remove the CDN fallback so the library stays fully offline.
  const bootPath = join(LIB, "assets", "math-boot.js");
  if (existsSync(bootPath)) {
    const source = await readFile(bootPath, "utf8");
    const patched = source
      .replace(/var CDN_FALLBACK = "https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@3\/es5\/tex-svg-full\.js";/, 'var CDN_FALLBACK = MATHJAX_SRC;')
      .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@3\/es5\/tex-svg-full\.js"/g, "MATHJAX_SRC");
    if (patched !== source) {
      await writeFile(bootPath, patched);
      log("[assets] patched math-boot.js to stay local");
    }
  }
}

function safeExternalPath(external) {
  const host = external.host.replace(/[^a-zA-Z0-9.-]/g, "_");
  const pathname = external.pathname.replace(/^\/+/, "").replace(/\.\.(\/|$)/g, "");
  if (!pathname) return null;
  return `ext_media/${host}/${pathname}`;
}

async function downloadExternal() {
  if (PAPERS_ONLY || !state.external.size) return;
  const entries = Array.from(state.external.values());
  log(`[external] downloading ${entries.length} external content file(s)`);
  const rewrites = new Map();

  const results = await pool(
    entries,
    async (external) => {
      const relativePath = safeExternalPath(external);
      if (!relativePath) throw new Error("unsafe external path");
      const outPath = safeInsideLib(relativePath);
      if (!outPath) throw new Error("unsafe external path");
      if (!FORCE && existsSync(outPath)) {
        const info = await stat(outPath);
        if (info.size > 0) {
          state.skipped += 1;
          return { skipped: true, size: info.size };
        }
      }
      const buffer = await fetchBuffer(external.url);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buffer);
      state.downloaded += 1;
      state.bytes += buffer.length;
      rewrites.set(external.url, `/library/${encoder(relativePath)}`);
      rewrites.set(external.original, `/library/${encoder(relativePath)}`);
      return { skipped: false, size: buffer.length };
    },
    Math.min(CONCURRENCY, 4)
  );

  for (let index = 0; index < results.length; index += 1) {
    if (!results[index].ok) {
      state.externalFailures.push({ url: entries[index].url, error: results[index].error?.message });
    }
  }

  if (!rewrites.size) return;
  const sources = new Set();
  for (const external of entries) {
    for (const source of external.sources) sources.add(source);
  }
  for (const source of sources) {
    const full = safeInsideLib(source);
    if (!full || !existsSync(full)) continue;
    let text = await readFile(full, "utf8");
    let changed = false;
    for (const [from, to] of rewrites) {
      if (text.includes(from)) {
        text = text.split(from).join(to);
        changed = true;
      }
    }
    if (changed) await writeFile(full, text);
  }
  log(`[external] rewrote ${sources.size} file(s)`);
}

function localManifest() {
  const okPaths = new Set(selected.filter((item) => item.status === "ok").map((item) => item.test.path));
  const branches = [];
  let branchCount = 0;
  let testCount = 0;

  for (const branch of manifest.branches) {
    const providers = [];
    let branchTests = 0;
    for (const provider of branch.providers) {
      const seriesList = [];
      let providerTests = 0;
      for (const series of provider.series) {
        const tests = series.tests
          .filter((test) => okPaths.has(test.path))
          .map((test) => ({
            ...test,
            path: mirrorPath(test.path),
            sourcePath: test.path
          }));
        if (!tests.length) continue;
        seriesList.push({ ...series, testCount: tests.length, tests });
        providerTests += tests.length;
      }
      if (!seriesList.length) continue;
      providers.push({ ...provider, testCount: providerTests, series: seriesList });
      branchTests += providerTests;
    }
    if (!providers.length) continue;
    branches.push({ ...branch, testCount: branchTests, providers });
    branchCount += 1;
    testCount += branchTests;
  }

  return {
    siteTitle: "Test Series - Local Library",
    generatedAt: new Date().toISOString(),
    branchCount,
    testCount,
    localLibrary: "library",
    sourceOrigin: ORIGIN,
    branches
  };
}

async function writeMaps() {
  const local = localManifest();
  await writeFile(TARGET_MANIFEST, JSON.stringify(local, null, 2) + "\n");

  const tests = [];
  let totalBytes = 0;
  for (const item of selected) {
    if (item.status !== "ok") continue;
    const localPath = mirrorPath(item.test.path);
    const full = safeInsideLib(localPath);
    let bytes = item.bytes || 0;
    if (full && existsSync(full)) bytes = (await stat(full)).size;
    totalBytes += bytes;
    tests.push({
      title: item.test.title,
      fileName: item.test.fileName,
      branch: item.branch.name,
      provider: item.provider.name,
      series: item.series.name,
      sourcePath: item.test.path,
      localPath,
      bytes,
      status: "ok"
    });
  }

  const map = {
    generatedAt: new Date().toISOString(),
    sourceOrigin: ORIGIN,
    libraryRoot: "library",
    testCount: tests.length,
    totalPaperBytes: totalBytes,
    assets: {
      localCount: state.resources.size,
      externalCount: state.external.size,
      externalFailures: state.externalFailures
    },
    failures: state.failures,
    tests
  };
  await writeFile(TEST_MAP, JSON.stringify(map, null, 2) + "\n");
  log(`[map] wrote ${relative(ROOT, TARGET_MANIFEST)} (${local.testCount} tests)`);
  log(`[map] wrote ${relative(ROOT, TEST_MAP)} (${tests.length} entries, ${(totalBytes / 1048576).toFixed(1)} MB of papers)`);
}

async function verify() {
  const local = JSON.parse(await readFile(TARGET_MANIFEST, "utf8").catch(() => '{"branches":[]}'));
  const tests = flatten(local);
  let missing = 0;
  let bytes = 0;
  for (const item of tests) {
    const full = safeInsideLib(item.test.path);
    if (!full || !existsSync(full)) {
      missing += 1;
      continue;
    }
    bytes += (await stat(full)).size;
  }
  const resources = await walk(LIB, () => true);
  log(`[verify] tests: ${tests.length}, missing: ${missing}`);
  log(`[verify] local files: ${resources.length}, library size: ${(bytes / 1048576).toFixed(1)} MB of papers`);
  if (missing) process.exitCode = 1;
}

async function main() {
  await mkdir(LIB, { recursive: true });

  if (VERIFY) {
    await verify();
    return;
  }

  if (!MAP_ONLY) {
    await downloadPapers();
    log("[scan] scanning downloaded HTML/CSS for assets");
    await collectResources();
    if (!ASSETS_ONLY) await downloadExternal();
    await downloadResources();
    await vendorMathJax();
  } else {
    log("[map] rebuilding map from existing local files");
    for (const item of selected) {
      const localPath = mirrorPath(item.test.path);
      const full = safeInsideLib(localPath);
      item.status = full && existsSync(full) ? "ok" : "missing";
      item.localPath = localPath;
      if (item.status === "ok") item.bytes = (await stat(full)).size;
      else state.failures.push({ path: localPath, error: "missing" });
    }
    await collectResources();
  }

  await writeMaps();

  if (state.failures.length) {
    log(`[warn] ${state.failures.length} failure(s):`);
    for (const failure of state.failures.slice(0, 20)) log(`  - ${failure.path}: ${failure.error}`);
    process.exitCode = 1;
  } else {
    log("[done] mirror complete");
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
