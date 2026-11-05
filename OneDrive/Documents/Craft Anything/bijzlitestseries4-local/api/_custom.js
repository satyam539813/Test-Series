// Shared custom-test builder. On the Vercel deployment the local mirror is
// unavailable, so this fetches papers live from the upstream mirror.
import { ORIGIN, upstreamPath } from "./_paper.js";

const CUSTOM_TEMPLATE_PATH =
  "CIVIL ENGINEERING/MADE EASY/GATE 2026 + ESE 2026 Online Test Series - Civil Engineering/001_Advance Level Test-1 Full Syllabus GATE 2026 CE.html";
const SECONDS_PER_QUESTION = 170;
const encoder = (p) => String(p).split("/").map(encodeURIComponent).join("/");

function tidyName(raw) {
  return String(raw ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function subjectFromTitle(title) {
  const cleaned = tidyName(title);
  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const segment = parts[1].replace(/\s*(Topic|Subject).*/i, "").trim();
      if (segment && !/^(GATE|ESE)\b/i.test(segment)) return segment;
    }
  }
  const match = cleaned.match(/(?:Subjectwise|Topicwise)\s*Test-\d+\s*Part Syllabus\s*(?:GATE|ESE)\s*20\d{2}\s*\S+\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function normalizeSubject(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\(?part-?\d+\)?$/i, "")
    .replace(/[\s_-]*\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCards(html) {
  const cards = [];
  const pattern = /<section class="card qcard"[\s\S]*?<\/section>/g;
  let match;
  while ((match = pattern.exec(String(html || "")))) cards.push(match[0]);
  return cards;
}

function renumberCard(card, n) {
  return String(card)
    .replace(/data-qnum="\d+"/, `data-qnum="${n}"`)
    .replace(/id="q\d+"/, `id="q${n}"`)
    .replace(/name="q\d+"/g, `name="q${n}"`)
    .replace(/(>Q)\d+(\s*<)/, `$1${n}$2`);
}

function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sanitizeName(raw) {
  const cleaned = tidyName(raw || "").replace(/[^a-zA-Z0-9\s-]/g, "").slice(0, 60).trim();
  return cleaned || `Custom Test`;
}

export async function fetchManifest() {
  const response = await fetch(`${ORIGIN}/data/series-manifest.json`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json,*/*" }
  });
  if (!response.ok) throw new Error("Upstream library unavailable");
  return response.json();
}

export async function loadBranchIndex(branchName) {
  const manifest = await fetchManifest();
  const branch = (manifest.branches || []).find(
    (item) => String(item.name || "").toLowerCase() === String(branchName || "").toLowerCase()
  );
  if (!branch) throw new Error("Unknown branch");

  const tests = [];
  for (const provider of branch.providers || []) {
    for (const series of provider.series || []) {
      for (const test of series.tests || []) {
        tests.push({ path: test.path, title: test.title, subject: subjectFromTitle(test.title) });
      }
    }
  }

  const subjectMap = new Map();
  const addSubject = (name, path) => {
    const normalized = normalizeSubject(name);
    if (!normalized || normalized === "mixed subjects" || normalized === "mock gate" || normalized === "general aptitude") return;
    if (!subjectMap.has(normalized)) subjectMap.set(normalized, { name: String(name).trim(), papers: new Set() });
    subjectMap.get(normalized).papers.add(path);
    const existing = subjectMap.get(normalized);
    if (/\d\s*$/.test(existing.name) && !/\d\s*$/.test(String(name).trim())) existing.name = String(name).trim();
  };
  for (const test of tests) if (test.subject) addSubject(test.subject, test.path);

  for (const [key, entry] of [...subjectMap]) {
    if (!subjectMap.has(key)) continue;
    const alt = key.endsWith("s") ? key.slice(0, -1) : `${key}s`;
    if (subjectMap.has(alt) && alt !== key) {
      const other = subjectMap.get(alt);
      for (const paper of other.papers) entry.papers.add(paper);
      if (!/s$/.test(entry.name) && /s$/.test(other.name)) entry.name = other.name;
      subjectMap.delete(alt);
    }
  }

  // Question counts are not measured here (that would need one fetch per
  // paper). The UI only needs names + question counts for filtering;
  // counts of 0 mean "measured lazily" and are hidden by the UI.
  const subjects = [
    { name: "General Aptitude", papers: tests.length, questions: 0 },
    ...[...subjectMap.values()]
      .map((entry) => ({ name: entry.name, papers: entry.papers.size, questions: 0, paths: [...entry.papers] }))
      .sort((a, b) => b.papers - a.papers)
  ];
  return { branch: branch.name, tests, subjects };
}

export async function generateCustomTestVercel({ branch, subjects, count, name }) {
  const index = await loadBranchIndex(branch);
  const wanted = Array.isArray(subjects) ? subjects.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean) : [];
  if (!wanted.length) throw new Error("Select at least one subject");
  const total = Math.max(1, Math.min(60, Math.floor(Number(count) || 30)));

  const poolTests = index.tests.filter((t) => !String(t.title).includes("|"));
  const poolPathSet = new Set(poolTests.map((t) => t.path));
  const pools = [];
  for (const subjectName of wanted) {
    const subject = index.subjects.find((s) => s.name.toLowerCase() === subjectName);
    if (!subject) throw new Error(`Unknown subject: ${subjectName}`);
    const isGA = subjectName === "general aptitude";
    const papers = isGA
      ? poolTests.map((t) => t.path)
      : (Array.isArray(subject.paths) && subject.paths.length
          ? subject.paths.filter((path) => poolPathSet.has(path))
          : poolTests.filter((t) => t.title.toLowerCase().includes(subjectName)).map((t) => t.path));
    pools.push({ subject: subject.name, isGA, papers: [...new Set(papers)] });
  }

  const base = Math.floor(total / pools.length);
  const quotas = pools.map((_, i) => Math.max(1, base + (i < total % pools.length ? 1 : 0)));
  const picked = [];
  const pickedKeys = new Set();
  const fetched = new Set();
  const needMore = () => {
    if (picked.length >= total) return false;
    return pools.some((pool, i) => picked.filter((item) => item.pool === i).length < quotas[i]);
  };

  // Batch-fetch candidate papers so generation fits the function timeout.
  for (let round = 0; round < 12 && needMore(); round += 1) {
    const jobs = [];
    for (let i = 0; i < pools.length && needMore(); i += 1) {
      const pool = pools[i];
      if (!pool.papers.length) {
        const remaining = [...pool.papers].filter((path) => !fetched.has(path));
        const job = remaining.length ? remaining[0] : null;
        if (job) jobs.push({ pool: i, path: job });
      } else {
        const remaining = pool.papers.filter((path) => !fetched.has(path));
        if (remaining.length) jobs.push({ pool: i, path: remaining[Math.floor(Math.random() * remaining.length)] });
      }
    }
    if (!jobs.length) break;
    const results = await Promise.all(
      jobs.map(async (job) => {
        fetched.add(job.path);
        const url = `${ORIGIN}/${encoder(upstreamPath(job.path))}`;
        try {
          const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "text/html,*/*" } });
          if (!response.ok) return { ...job, html: "" };
          return { ...job, html: await response.text() };
        } catch {
          return { ...job, html: "" };
        }
      })
    );
    for (const result of results) {
      const pool = pools[result.pool];
      const already = picked.filter((item) => item.pool === result.pool).length;
      if (already >= quotas[result.pool]) continue;
      const cards = shuffle(
        extractCards(result.html).filter((card) => {
          const isGA = /<div class="tags">\s*General Aptitude/.test(card);
          return pool.isGA ? isGA : !isGA;
        })
      );
      for (const card of cards) {
        if (picked.length >= total) break;
        if (picked.filter((item) => item.pool === result.pool).length >= quotas[result.pool]) break;
        const key = `${result.path}::${card.slice(0, 400)}`;
        if (pickedKeys.has(key)) continue;
        pickedKeys.add(key);
        picked.push({ pool: result.pool, card });
      }
    }
  }

  if (!picked.length) throw new Error("No matching questions found upstream");

  const templateResponse = await fetch(`${ORIGIN}/${encoder(upstreamPath(CUSTOM_TEMPLATE_PATH))}`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html,*/*" }
  });
  if (!templateResponse.ok) throw new Error("Custom template unavailable");
  const template = await templateResponse.text();
  const templateCards = [...template.matchAll(/<section class="card qcard"[\s\S]*?<\/section>/g)];
  if (!templateCards.length) throw new Error("Custom template unavailable");

  const testName = sanitizeName(name);
  const durationSec = picked.length * SECONDS_PER_QUESTION;
  const sectionsLabel = [...new Set(pools.map((p) => p.subject))].join(", ");
  const generated = picked.map((item, i) => renumberCard(item.card, i + 1)).join("\n");

  let html = template;
  const firstStart = templateCards[0].index;
  const lastEnd = templateCards[templateCards.length - 1].index + templateCards[templateCards.length - 1][0].length;
  html = html.slice(0, firstStart) + generated + "\n" + html.slice(lastEnd);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>Custom Test — ${testName}</title>`);
  html = html.replace(/(<h1>)[^<]*(<\/h1>)/, `$1Custom Test — ${testName}$2`);
  html = html.replace(/Package: [^<]*/, `Custom test • ${index.branch} • ${sectionsLabel} • ${picked.length} Questions`);
  html = html.replace(/data-duration="\d+"/, `data-duration="${durationSec}"`);

  // Inline the finished paper as a data URL so the client can open it in a
  // new tab without any server state. Content-length is capped by Vercel.
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  return {
    name: testName,
    branch: index.branch,
    subjects: [...new Set(pools.map((p) => p.subject))],
    questions: picked.length,
    durationSec,
    dataUrl
  };
}
