import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const LIBRARY = resolve(
  process.env.PAPER_ROOT || fileURLToPath(new URL("./library", import.meta.url))
);
const PORT = Number(process.env.PORT) || 8080;

// Every paper resource resolves under /library. The <base> below makes the
// relative ../../../assets and ../media paths inside the papers work even
// though the viewer loads them through iframe.srcdoc.
function paperBase(paperPath) {
  const dir = String(paperPath || "")
    .split("/")
    .slice(0, -1)
    .map(encodeURIComponent)
    .join("/");
  return dir ? `/library/${dir}/` : "/library/";
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function cacheControl(pathname) {
  if (pathname === "/index.html" || pathname === "/paper.html" || pathname === "/") return "no-cache";
  // App shell assets must not stick in the browser cache across redesigns.
  if (pathname === "/assets/app.js" || pathname === "/assets/styles.css") return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=3600, stale-while-revalidate=86400";
  if (pathname.startsWith("/data/")) return "public, max-age=300, stale-while-revalidate=86400";
  if (pathname.startsWith("/library/")) return "public, max-age=86400";
  return "no-cache";
}

function send(res, status, body, type = "text/plain; charset=utf-8", cache = "no-cache") {
  res.writeHead(status, { "content-type": type, "cache-control": cache });
  res.end(body);
}

function hostBridge(paperPath) {
  const pathJson = JSON.stringify(String(paperPath || "")).replace(/</g, "\\u003c");
  return `<script id="bijzli-host-bridge">
(() => {
  const PAPER_PATH = ${pathJson};
  const ACTIVITY_KEY = "bijzli-activity-v1";
  const nativeSetItem = Storage.prototype.setItem;
  const nativeGetItem = Storage.prototype.getItem;
  window.__BIJZLI_PAPER__ = PAPER_PATH;
  try { localStorage.setItem("test-ui-theme", "dark"); } catch (_) {}
  if (document.querySelector(".left-panel")) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "classes-palette-toggle";
    toggle.textContent = "☰ Questions";
    toggle.setAttribute("aria-label", "Toggle question palette");
    toggle.addEventListener("click", () => document.body.classList.toggle("classes-palette-open"));
    document.body.appendChild(toggle);
    document.querySelector(".left-panel").addEventListener("click", (event) => {
      if (event.target.closest("button")) document.body.classList.remove("classes-palette-open");
    });
  }


  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const percent = (part, total) => (total > 0 ? (part / total) * 100 : 0);
  const rounded = (value) => Math.round(finite(value) * 100) / 100;
  const parseStore = (raw) => {
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  };
  const readSections = () => {
    const rows = Array.from(document.querySelectorAll("#reviewRows tr"));
    return rows.map((row) => {
      const cells = Array.from(row.cells).map((cell) => cell.textContent.trim());
      if (cells.length < 6) return null;
      const correct = finite(cells[2]);
      const wrong = finite(cells[3]);
      const skipped = finite(cells[4]);
      const total = finite(cells[1]);
      return {
        name: cells[0],
        total,
        correct,
        wrong,
        skipped,
        marks: finite(cells[5].replace(/[^0-9.-]/g, "")),
        accuracy: percent(correct, correct + wrong)
      };
    }).filter(Boolean);
  };
  const attemptFromSimple = (entry, withSections) => {
    if (!entry || typeof entry !== "object") return null;
    const submittedAt = finite(entry.submittedAt);
    const total = finite(entry.total || entry.totalMarks);
    const questions = finite(entry.questions);
    const marks = finite(entry.marks);
    if (!submittedAt || (!total && !questions && !marks)) return null;

    const correct = finite(entry.correct);
    const wrong = finite(entry.wrong);
    const sectionInput = Array.isArray(entry.sections) ? entry.sections : [];
    const sections = withSections
      ? readSections()
      : sectionInput.map((section) => {
          const correct = finite(section.correct);
          const wrong = finite(section.wrong);
          return { ...section, accuracy: finite(section.accuracy, percent(correct, correct + wrong)) };
        });

    return {
      submittedAt,
      marks,
      total,
      correct,
      wrong,
      skipped: finite(entry.skipped),
      attempted: finite(entry.attempted, correct + wrong),
      questions,
      accuracy: finite(entry.accuracy, percent(correct, correct + wrong)),
      sections
    };
  };
  const attemptHistory = (entry) => {
    if (!entry || typeof entry !== "object") return [];
    if (Array.isArray(entry.history)) {
      return entry.history
        .map((item) => attemptFromSimple(item, false))
        .filter(Boolean)
        .slice(-19);
    }
    const legacy = attemptFromSimple(entry, false);
    return legacy ? [legacy] : [];
  };
  const mergeStore = (existingRaw, incomingRaw) => {
    const existing = parseStore(existingRaw);
    const incoming = parseStore(incomingRaw);
    const merged = Object.assign({}, existing);

    for (const key of Object.keys(incoming)) {
      const oldEntry = existing[key];
      const incomingEntry = incoming[key];
      const history = attemptHistory(oldEntry);
      const previousSubmittedAt = finite(oldEntry && oldEntry.submittedAt);
      const nextSubmittedAt = finite(incomingEntry && incomingEntry.submittedAt);
      const shouldReadSections = Boolean(nextSubmittedAt && nextSubmittedAt !== previousSubmittedAt);
      const latest = attemptFromSimple(incomingEntry, shouldReadSections);

      if (latest && !history.some((item) => item.submittedAt === latest.submittedAt)) {
        history.push(latest);
      }

      merged[key] = Object.assign({}, oldEntry, incomingEntry, { history: history.slice(-20) });
    }

    return merged;
  };

  Storage.prototype.setItem = function (key, value) {
    if (key !== ACTIVITY_KEY || typeof value !== "string") {
      return nativeSetItem.call(this, key, value);
    }
    try {
      const merged = mergeStore(nativeGetItem.call(this, key), value);
      return nativeSetItem.call(this, key, JSON.stringify(merged));
    } catch (_) {
      return nativeSetItem.call(this, key, value);
    }
  };

  const ACTIVITY_PATH = String(PAPER_PATH || "").toLowerCase().replace(/[.]html?$/, "");
  let recordedSubmit = false;

  const readNumber = (id) => {
    const node = document.getElementById(id);
    if (!node) return null;
    const number = Number(String(node.textContent || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : null;
  };
  const readFirstNumber = (...ids) => {
    for (const id of ids) {
      const value = readNumber(id);
      if (value !== null) return value;
    }
    return null;
  };
  const readTotalMarks = () => Array.from(document.querySelectorAll(".qcard[data-right]"))
    .reduce((sum, card) => sum + finite(card.getAttribute("data-right"), 0), 0);

  const recordOpen = () => {
    if (!ACTIVITY_PATH) return;
    try {
      const store = parseStore(nativeGetItem.call(localStorage, ACTIVITY_KEY));
      const previous = store[ACTIVITY_PATH] || {};
      store[ACTIVITY_PATH] = Object.assign({}, previous, {
        title: previous.title || document.title,
        openedAt: finite(previous.openedAt, Date.now()),
        lastAccessedAt: Date.now(),
        opens: finite(previous.opens) + 1
      });
      nativeSetItem.call(localStorage, ACTIVITY_KEY, JSON.stringify(store));
    } catch (_) {}
  };

  const recordAttempt = () => {
    if (!ACTIVITY_PATH || recordedSubmit) return;
    // The GATE overlay fills the review panel; the original paper fills #kpi_*.
    const marks = readFirstNumber("reviewMarks", "kpi_marks");
    if (marks === null) return;
    try {
      const correct = finite(readFirstNumber("reviewCorrect", "kpi_correct"));
      const wrong = finite(readFirstNumber("reviewWrong", "kpi_wrong"));
      const skipped = finite(readFirstNumber("reviewSkipped", "kpi_skipped"));
      const kpiAttempted = finite(readFirstNumber("kpi_attempted"));
      const attempted = kpiAttempted > 0 ? kpiAttempted : correct + wrong;
      const questions = document.querySelectorAll(".qcard[data-qnum]").length || correct + wrong + skipped;
      const total = readTotalMarks() || finite(readFirstNumber("reviewTotal"));
      const sections = readSections();
      const now = Date.now();
      const store = parseStore(nativeGetItem.call(localStorage, ACTIVITY_KEY));
      const previous = store[ACTIVITY_PATH] || {};
      const history = attemptHistory(previous);
      const attempt = {
        submittedAt: now,
        marks,
        total,
        correct,
        wrong,
        skipped,
        attempted,
        questions,
        accuracy: percent(correct, correct + wrong),
        sections
      };
      history.push(attempt);
      store[ACTIVITY_PATH] = Object.assign({}, previous, attempt, {
        title: previous.title || document.title,
        openedAt: finite(previous.openedAt, now),
        lastAccessedAt: now,
        history: history.slice(-20)
      });
      nativeSetItem.call(localStorage, ACTIVITY_KEY, JSON.stringify(store));
      recordedSubmit = true;
    } catch (_) {}
  };

  const scheduleRecord = () => {
    setTimeout(recordAttempt, 350);
    setTimeout(recordAttempt, 1400);
  };

  const watchSubmit = () => {
    const root = document.documentElement;
    const inspect = () => {
      const submitted = root.getAttribute("data-bijzli-submitted") === "true" ||
        document.body.classList.contains("test-submitted");
      if (submitted) scheduleRecord();
      else recordedSubmit = false;
    };
    const observer = new MutationObserver(inspect);
    observer.observe(root, { attributes: true, attributeFilter: ["data-bijzli-submitted"] });
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("#gateSubmitBtn, [data-bijzli-submit]")) {
        scheduleRecord();
      }
    }, true);
    inspect();
  };

  const ensureReattempt = () => {
    const done = document.getElementById("smDoneBtn");
    if (!done || document.getElementById("bijzliReattemptBtn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "bijzliReattemptBtn";
    button.className = "sm-fbtn rev";
    button.textContent = "Re-attempt";
    button.addEventListener("click", () => {
      recordedSubmit = false;
      if (typeof window.resetAll === "function") window.resetAll();
    });
    done.parentNode.insertBefore(button, done);
  };

  const startBridge = () => {
    recordOpen();
    watchSubmit();
    ensureReattempt();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startBridge, { once: true });
  } else {
    startBridge();
  }
})();
</script>`;
}

function patchProgress(js) {
  let out = String(js || "");
  // Old-style files expose currentPaperPath(); current upstream files use
  // resolvePaperKey(), which derives the key from location.pathname and
  // breaks inside srcdoc frames. Point both at the bridge paper path.
  if (out.includes("function currentPaperPath")) {
    out = out.replace(
      /\n  function currentPaperPath\(\)\s*\{[\s\S]*?\n  \}/,
      "\n  function currentPaperPath() {\n    return String(window.__BIJZLI_PAPER__ || '').toLowerCase().replace(/[.]html?$/, '');\n  }"
    );
  }
  if (out.includes("function resolvePaperKey")) {
    out = out.replace(
      /function resolvePaperKey\(\)\s*\{[\s\S]*?\n  \}/,
      "function resolvePaperKey() {\n    return String(window.__BIJZLI_PAPER__ || '').toLowerCase().replace(/\\.html?$/, '');\n  }"
    );
  }
  out = out.replace("    read: read\n  };", "    read: read,\n    reset: function () { recorded = false; }\n  };");
  return out;
}

const GATE_PROGRESS_HELPERS = `
  const GATE_PROGRESS_PREFIX = "bijzli-inprogress-v1:";
  function gateProgressKey(path) {
    return GATE_PROGRESS_PREFIX + String(path || "").toLowerCase().replace(/[.]html?$/, "");
  }
  function readGateProgress(path) {
    try {
      const saved = JSON.parse(localStorage.getItem(gateProgressKey(path)) || "null");
      return saved && typeof saved === "object" && saved.version === 1 ? saved : null;
    } catch (_) {
      return null;
    }
  }
  function writeGateProgress(path, snapshot) {
    try {
      localStorage.setItem(gateProgressKey(path), JSON.stringify(snapshot));
    } catch (_) {}
  }
  function clearGateProgress(path) {
    try {
      localStorage.removeItem(gateProgressKey(path));
    } catch (_) {}
  }
  function gateSnapshot(current) {
    if (!current || current.submitted) return null;
    return {
      version: 1,
      savedAt: Date.now(),
      remain: Math.max(0, finiteNumber(current.remain, current.duration || 0)),
      current: finiteNumber(current.current, current.qnums && current.qnums[0] ? current.qnums[0] : 1),
      paused: Boolean(current.paused),
      statuses: Array.from(current.statuses || []),
      cards: (current.cards || []).map((card) => ({
        qnum: getQnum(card),
        radios: qsa('input[type="radio"]', card).map((input) => Boolean(input.checked)),
        boxes: qsa('input[type="checkbox"]', card).map((input) => Boolean(input.checked)),
        nat: qs('input[data-nat-input]', card) ? qs('input[data-nat-input]', card).value : ""
      }))
    };
  }
  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function gateApplyProgress(current, saved) {
    if (!saved || !Array.isArray(saved.cards)) return;
    const savedByQ = new Map(saved.cards.map((item) => [finiteNumber(item.qnum, -1), item]));
    current.cards.forEach((card) => {
      const item = savedByQ.get(getQnum(card));
      if (!item) return;
      qsa('input[type="radio"]', card).forEach((input, index) => {
        if (typeof item.radios?.[index] === "boolean") input.checked = item.radios[index];
      });
      qsa('input[type="checkbox"]', card).forEach((input, index) => {
        if (typeof item.boxes?.[index] === "boolean") input.checked = item.boxes[index];
      });
      const nat = qs('input[data-nat-input]', card);
      if (nat && typeof item.nat === "string") nat.value = item.nat;
    });

    if (Array.isArray(saved.statuses)) {
      current.statuses = new Map(saved.statuses.map((entry) => [finiteNumber(entry[0], -1), String(entry[1])]));
      current.qnums.forEach((qnum) => {
        if (!current.statuses.has(qnum)) current.statuses.set(qnum, "not-visited");
      });
    }

    const currentQ = finiteNumber(saved.current, current.qnums[0]);
    current.current = current.qnums.includes(currentQ) ? currentQ : current.qnums[0];
    if (current.duration) current.remain = clampNumber(finiteNumber(saved.remain, current.duration), 0, current.duration);
    current.paused = Boolean(saved.paused);
  }
  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
`;

function patchDummy(js) {
  const helperMarker = "  if (!cards.length) return;";
  const stateMarker = '  qnums.forEach((qnum) => state.statuses.set(qnum, "not-visited"));';
  if (!js.includes(helperMarker) || !js.includes(stateMarker)) return js;

  // Remove the "BE / DVRUO EASY / FREELY GIVEN" logo block from the exam header.
  let patched = js.replace(
    /        <div class="gate-logo-area">[\s\S]*?<\/div>\n        <div class="gate-header-center">/,
    '        <div class="gate-header-center">'
  );
  patched = patched.replace(/"DVRUO EASY \| Test Series"/g, '"Test Series"');
  patched = patched.replace(/"DVRUO EASY Test"/g, '"Test Series"');
  patched = patched.replace(
    '} catch (error) {\n      return "bright";\n    }\n    return "bright";',
    '} catch (error) {\n      return "dark";\n    }\n    return "dark";'
  );
  patched = patched.replace(
    'if (stored === "bright" || stored === "dark" || stored === "green") return stored;',
    'if (stored === "dark") return stored;'
  );

  // Improved exam UI (dark violet theme matching the library app). Appended
  // after the engine's own styles so it wins on equal specificity.
  const gateUiCss = [
    'html[data-bijzli-gate="true"] body[data-theme="bright"]{--b:#2563eb;--b2:#1d4ed8;--g:#059669;--r:#dc2626;--o:#d97706;--p:#2563eb;--head:#14151a;--sub:#f5f5f7;--bg:#f4f4f6;--card:#ffffff;--chip:#f1f1f4;--hover:#ececee;--border:#e2e2e8;--text:#17122b;--muted:#6b6b76;--ring:rgba(37,99,235,.25)}',
    'html[data-bijzli-gate="true"] body[data-theme="dark"]{--b:#e4e4e7;--b2:#d4d4d8;--g:#34d399;--r:#f87171;--o:#fbbf24;--p:#e4e4e7;--head:#14151a;--sub:#0a0a0d;--bg:#0a0a0d;--card:#14151a;--chip:#1a1b22;--hover:#22232c;--border:rgba(255,255,255,.07);--text:#f2f2f5;--muted:#a1a1aa;--ring:rgba(255,255,255,.18)}',
    'html[data-bijzli-gate="true"] body[data-theme="green"]{--b:#34d399;--b2:#6ee7b7;--g:#34d399;--r:#f87171;--o:#fbbf24;--p:#34d399;--head:#101512;--sub:#0a0f0c;--bg:#0a0f0c;--card:#111812;--chip:#182118;--hover:#1e2a20;--border:rgba(255,255,255,.07);--text:#ecfdf5;--muted:#9fb8aa;--ring:rgba(52,211,153,.25)}',
    'html[data-bijzli-gate="true"] body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    'html[data-bijzli-gate="true"] body[data-theme="dark"]{background:#0a0a0d}',
    'html[data-bijzli-gate="true"] body[data-theme="green"]{background:#0a0f0c}',
    'html[data-bijzli-gate="true"] body::before{display:none}',
  'html[data-bijzli-gate="true"] body{--bg:#0a0a0d!important;--card:#14151a!important;--ink:#f2f2f5!important;--muted:#a1a1aa!important;--border:rgba(255,255,255,.08)!important;--header-bg:#14151a!important;--panel-bg:#14151a!important;--head:#14151a!important;--accent:#a78bfa!important;--opt-bg:#1a1b22!important;--input-bg:#101014!important;background:#0a0a0d!important;color:#f2f2f5!important}',
  'html[data-bijzli-gate="true"] .qcard,html[data-bijzli-gate="true"] .qtext,html[data-bijzli-gate="true"] .qid,html[data-bijzli-gate="true"] .tags,html[data-bijzli-gate="true"] .gate-q-info,html[data-bijzli-gate="true"] .gate-info-chip{color:#f2f2f5!important}',
  'html[data-bijzli-gate="true"] .tags{color:#a1a1aa!important}',
  'html[data-bijzli-gate="true"] header#pageHeader{display:none!important}',
    'html[data-bijzli-gate="true"] .gate-header{background:#14151a;border-bottom:1px solid rgba(255,255,255,.08);box-shadow:none;padding:12px 16px;color:#f2f2f5}',
    'html[data-bijzli-gate="true"] .gate-logo-area{display:none!important}',
    'html[data-bijzli-gate="true"] .gate-header-center{text-align:left;flex:1 1 auto}',
    'html[data-bijzli-gate="true"] .gate-exam-title{font-size:17px;letter-spacing:-.01em}',
    'html[data-bijzli-gate="true"] .gate-exam-subtitle{color:#a1a1aa}',
    'html[data-bijzli-gate="true"] .gate-theme-switch{border-radius:999px;background:#1a1b22;border:1px solid rgba(255,255,255,.08)}',
    'html[data-bijzli-gate="true"] .gate-theme-btn{border-radius:999px;color:#a1a1aa}',
    'html[data-bijzli-gate="true"] .gate-theme-btn[aria-pressed="true"]{background:#e4e4e7;color:#101014}',
    'html[data-bijzli-gate="true"] .gate-timer-box{border-radius:14px;background:#101014;border:1px solid rgba(255,255,255,.08)}',
    'html[data-bijzli-gate="true"] .gate-timer-label{color:#a1a1aa}',
    'html[data-bijzli-gate="true"] .gate-timer-time{color:#f2f2f5}',
    'html[data-bijzli-gate="true"] .gate-header-btn{border-radius:999px;font-weight:700}',
    'html[data-bijzli-gate="true"] .gate-header-btn.danger{background:#e4e4e7;color:#101014;border:1px solid transparent}',
    'html[data-bijzli-gate="true"] .gate-header-btn.pause{background:transparent;color:#f2f2f5;border:1px solid rgba(255,255,255,.14)}',
    'html[data-bijzli-gate="true"] .gate-section-tab{border-radius:999px;background:transparent;color:#a1a1aa}',
    'html[data-bijzli-gate="true"] .gate-section-tab.active{background:#e4e4e7;color:#101014}',
    'html[data-bijzli-gate="true"] .gate-result-chip{border-radius:14px;background:#1a1b22;border:1px solid rgba(255,255,255,.06)}',
    'html[data-bijzli-gate="true"] .qcard,html[data-bijzli-gate="true"] .gate-side-card,html[data-bijzli-gate="true"] .gate-q-info,html[data-bijzli-gate="true"] .gate-review-panel,html[data-bijzli-gate="true"] .sm-modal{border-radius:20px;box-shadow:none}',
    'html[data-bijzli-gate="true"] .gate-info-chip,html[data-bijzli-gate="true"] .gate-side-kpi,html[data-bijzli-gate="true"] .gate-review-kpi{border-radius:14px}',
    'html[data-bijzli-gate="true"] label.opt{border-radius:14px}',
    'html[data-bijzli-gate="true"] label.opt:hover{border-color:rgba(255,255,255,.16)}',
    'html[data-bijzli-gate="true"] .gate-nav-btn{border-radius:999px;font-weight:700}',
    'html[data-bijzli-gate="true"] .gate-nav-btn.primary{background:#e4e4e7;color:#101014;border:1px solid transparent}',
    'html[data-bijzli-gate="true"] .gate-nav-btn.secondary{background:transparent}',
    'html[data-bijzli-gate="true"] .gate-nav-bar{border-radius:20px;background:#14151a;border:1px solid rgba(255,255,255,.08);box-shadow:none}',
    'html[data-bijzli-gate="true"] .gate-palette-btn{border-radius:10px}',
    'html[data-bijzli-gate="true"] .gate-palette-btn.not-visited,html[data-bijzli-gate="true"] .gate-legend-dot.not-visited{background:#26272e;border-color:rgba(255,255,255,.08);color:#a1a1aa}',
    'html[data-bijzli-gate="true"] .gate-palette-btn.not-answered,html[data-bijzli-gate="true"] .gate-legend-dot.not-answered{background:#7f1d1d;border-color:rgba(255,255,255,.08);color:#fecaca}',
    'html[data-bijzli-gate="true"] .gate-palette-btn.answered,html[data-bijzli-gate="true"] .gate-legend-dot.answered{background:#065f46;border-color:rgba(255,255,255,.08);color:#a7f3d0}',
    'html[data-bijzli-gate="true"] .gate-palette-btn.marked,html[data-bijzli-gate="true"] .gate-legend-dot.marked{background:#4c1d95;border-color:rgba(255,255,255,.08);color:#ddd6fe}',
    'html[data-bijzli-gate="true"] .gate-palette-btn.answered-marked,html[data-bijzli-gate="true"] .gate-legend-dot.answered-marked{background:#92400e;border-color:rgba(255,255,255,.08);color:#fde68a}',
    'html[data-bijzli-gate="true"] .natInput{border-radius:14px}',
    'html[data-bijzli-gate="true"] .gate-palette-toggle{display:none}',
    '@media (max-width:640px){html[data-bijzli-gate="true"] .gate-palette-toggle{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.14);background:#1a1b22;color:#f2f2f5;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer}html[data-bijzli-gate="true"] .gate-sidebar{position:fixed!important;top:0;right:0;bottom:0;width:min(320px,90vw);z-index:1600;background:#14151a;border-left:1px solid rgba(255,255,255,.1);padding:16px;overflow-y:auto;transform:translateX(105%);transition:transform .25s ease;box-shadow:-20px 0 50px rgba(0,0,0,.5)}html[data-bijzli-gate="true"] body.gate-palette-open .gate-sidebar{transform:none}}',    // Mobile: collapse the header to timer + submit only; theme/buttons
    // hidden, title single-line, tabs in one scrollable row.
    '@media (max-width:640px){html[data-bijzli-gate="true"] .gate-header{padding:10px 12px}'
    + 'html[data-bijzli-gate="true"] .gate-exam-title{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html[data-bijzli-gate="true"] .gate-exam-subtitle{display:none}'
    + 'html[data-bijzli-gate="true"] .gate-header-top{gap:8px}'
    + 'html[data-bijzli-gate="true"] .gate-theme-switch{display:none}'
    + 'html[data-bijzli-gate="true"] #gatePauseBtn{display:none}'
    + 'html[data-bijzli-gate="true"] .gate-header-right{gap:8px;flex-wrap:nowrap}'
    + 'html[data-bijzli-gate="true"] .gate-timer-box{min-width:88px;padding:6px 8px}'
    + 'html[data-bijzli-gate="true"] .gate-timer-label{display:none}'
    + 'html[data-bijzli-gate="true"] .gate-timer-time{font-size:17px}'
    + 'html[data-bijzli-gate="true"] .gate-header-btn{width:auto!important;padding:8px 12px;font-size:13px}'
    + 'html[data-bijzli-gate="true"] .gate-section-nav{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}'
    + 'html[data-bijzli-gate="true"] .gate-section-nav::-webkit-scrollbar{display:none}'
    + 'html[data-bijzli-gate="true"] .gate-section-tab{flex:0 0 auto;padding:7px 10px;font-size:12px}'
    + 'html[data-bijzli-gate="true"] .gate-layout{display:flex;flex-direction:column}'
    + 'html[data-bijzli-gate="true"] .gate-question-area{order:-1}'
    + 'html[data-bijzli-gate="true"] .gate-sidebar{position:static;max-height:none}'
    + 'html[data-bijzli-gate="true"] .gate-q-info{grid-template-columns:repeat(2,minmax(0,1fr))}'
    + 'html[data-bijzli-gate="true"] .qcard{padding:16px!important}'
    + 'html[data-bijzli-gate="true"] label.opt{padding:12px 14px}'
    + 'html[data-bijzli-gate="true"] .gate-nav-bar{grid-template-columns:repeat(2,minmax(0,1fr));bottom:8px}'
    + '}'
  ];

  const gateUiInject = [
    '  const gateUiStyle = document.createElement("style");',
    '  gateUiStyle.id = "gate-ui-overrides";',
    '  gateUiStyle.textContent = GATE_UI_CSS_PLACEHOLDER;',
    '  document.head.appendChild(gateUiStyle);'
  ].join("\n");
  patched = patched.replace(
    "  injectStyles();",
    "  injectStyles();\n" + gateUiInject.replace("GATE_UI_CSS_PLACEHOLDER", JSON.stringify(gateUiCss.join("")))
  );

  const hamLines = [
    '  (() => {',
    '    const header = document.querySelector(".gate-header");',
    '    if (!header) return;',
    '    try {',
    '      if (window.matchMedia("(max-width:640px)").matches) {',
    '        const aside = document.querySelector(".gate-sidebar");',
    '        const right = header.querySelector(".gate-header-right");',
    '        const nav = header.querySelector("#gateSectionNav");',
    '        const strip = header.querySelector("#gateResultStrip");',
    '        const fabStack = right ? right.querySelector(".bijzli-calc-header-stack") : null;',
    '        if (fabStack) fabStack.remove();',
    '        if (aside && nav) aside.prepend(nav);',
    '        if (aside && right) aside.prepend(right);',
    '        if (aside && strip) aside.prepend(strip);',
    '        if (fabStack) header.appendChild(fabStack);',
    '      }',
    '    } catch (_) {}',
    '    const btn = document.createElement("button");',
    '    btn.type = "button";',
    '    btn.className = "gate-palette-toggle";',
    '    btn.textContent = "☰ Questions";',
    '    btn.setAttribute("aria-label", "Toggle question palette");',
    '    btn.addEventListener("click", () => document.body.classList.toggle("gate-palette-open"));',
    '    header.appendChild(btn);',
    '    document.querySelector(".gate-sidebar")?.addEventListener("click", (event) => {',
    '      if (event.target.closest(".gate-palette-btn")) document.body.classList.remove("gate-palette-open");',
    '    });',
    '  })();'
  ];
  patched = patched.replace(
    '  buildUI(state);\n  applyTheme(state, loadTheme());',
    ['  buildUI(state);', hamLines.join('\n'), '  applyTheme(state, loadTheme());'].join('\n')
  );

  const injected = `  if (savedProgress) gateApplyProgress(state, savedProgress);
  const saveGateProgress = () => {
    const snapshot = gateSnapshot(state);
    if (snapshot) writeGateProgress(window.__BIJZLI_PAPER__ || "", snapshot);
  };
  document.addEventListener("change", saveGateProgress);
  document.addEventListener("input", saveGateProgress);
  window.setInterval(saveGateProgress, 2000);
  window.addEventListener("beforeunload", saveGateProgress);

  ${stateMarker}`;

  patched = patched.replace(
    helperMarker,
    `${helperMarker}\n${GATE_PROGRESS_HELPERS}\n  const savedProgress = readGateProgress(window.__BIJZLI_PAPER__ || "");`
  );

  // (The logo-block, fallback, and injectStyles() replacements above already
  // ran on `patched`; they are the branding/UI patches.)

  patched = patched.replace(stateMarker, injected);
  patched = patched.replace(
    "  function submit(current) {\n    if (current.submitted) return scrollToReview();",
    "  function submit(current) {\n    clearGateProgress(window.__BIJZLI_PAPER__ || \"\");\n    if (current.submitted) return scrollToReview();"
  );
  patched = patched.replace(
    "  function resetAll(current) {\n    stopTimer(current);",
    "  function resetAll(current) {\n    clearGateProgress(window.__BIJZLI_PAPER__ || \"\");\n    try {\n      const progressApi = window.__bijzliProgress;\n      if (progressApi && typeof progressApi.reset === \"function\") progressApi.reset();\n    } catch (_) {}\n    stopTimer(current);"
  );

  return patched;
}

function cleanPaper(html, paperPath) {
  let cleaned = html;

  // A srcdoc frame has no useful base URL, so point every paper at its local
  // mirror directory before any asset is parsed. Some 2026 demo papers use
  // ../../../ext_media paths just like the 2027 JSON papers do.
  if (!/<base\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/<head([^>]*)>/i, `<head$1><base href="${paperBase(paperPath)}">`);
    cleaned = cleaned.replace(/<head([^>]*)>/i, `<head$1><script>try{localStorage.setItem("theme","dark");localStorage.setItem("bijzli-provider-theme","dark");localStorage.setItem("test-ui-theme","dark");}catch(e){}</script>`);
  }

  // Browsers may resolve static srcdoc resources against the embedding page
  // (/paper.html) instead of the <base> above. Rewrite relative content
  // references in markup to absolute /library paths so they always resolve
  // locally. Dynamic JS (2027 JSON papers) still uses <base> at runtime.
  const paperDir = String(paperPath || "").split("/").slice(0, -1);
  const toAbsolute = (ref) => {
    const value = String(ref || "").trim();
    if (!value || /^(?:#|data:|mailto:|tel:|javascript:|blob:|\/)/i.test(value)) return ref;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ref;
    // Strip query/hash for resolution, then re-append.
    const hashIndex = value.search(/[?#]/);
    const pathPart = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const suffix = hashIndex >= 0 ? value.slice(hashIndex) : "";
    if (!pathPart) return ref;
    const segments = ["library", ...paperDir];
    for (const part of pathPart.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") segments.pop();
      else segments.push(part);
    }
    if (segments[0] !== "library") return ref;
    return "/" + segments.map(encodeURIComponent).join("/") + suffix;
  };
  cleaned = cleaned.replace(
    /\b(src|href|poster|data-src|data-href)=(["'])([^"']+)\2/gi,
    (match, attr, quote, ref) => {
      const absolute = toAbsolute(ref);
      if (/^\/library\/assets\/(made-easy-dummy|progress|calculator)\.js/.test(absolute)) {
        return `${attr}=${quote}${absolute.replace(/\?v=[^&#]*/, "")}?v=20261105-ui7${quote}`;
      }
      return `${attr}=${quote}${absolute}${quote}`;
    }
  );
  cleaned = cleaned.replace(/\burl\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, ref) => {
    const absolute = toAbsolute(ref);
    return absolute === ref ? match : `url(${quote}${absolute}${quote})`;
  });

  // Scrub provider branding from paper chrome (2027 classes papers render
  // org/profile labels from inline data). Titles and question data stay intact.
  cleaned = cleaned
    .split('"orgName":"DVRUOACE"').join('"orgName":"Test Series"')
    .split('"batchName":"DVRUOACE Test Series').join('"batchName":"Test Series')
    .split('return "DVRUOACE";').join('return "TEST SERIES";')
    .split('name: "DVRUO"').join('name: "Test Series"')
    .split('userId: "@Dvruo"').join('userId: "Student"')
    .split('orgId: "@Dvruo"').join('orgId: "Test Series"')
    .split('| DVRUOACE</title>').join('| Test Series</title>');

  return cleaned
    .replace(/<script[^>]*src=["']\/\.netlify\/scripts\/hud[^>]*>\s*<\/script>/gi, "")
    .replace(
      "</head>",
      '<link rel="icon" href="data:,"><style id="bijzli-host-style">#nl-badge-frame,#netlify-badge,.netlify-badge{display:none!important}.qcard{content-visibility:auto;contain-intrinsic-size:auto 720px}#header-user,.telegram-admin-btn,.developer-note,.free-note,.safety-note,#noticeBar{display:none!important}#pageHeader,#noticeBar{display:none!important}.adminFloat{display:none!important}@media (max-width:640px){html[data-bijzli-classes] .test-layout{display:flex;flex-direction:column}html[data-bijzli-classes] .right-panel{order:-1}html[data-bijzli-classes] .top-toolbar{gap:10px}html[data-bijzli-classes] .action-row{display:grid;grid-template-columns:1fr 1fr}html[data-bijzli-classes] .action-row .btn{width:100%}html[data-bijzli-classes] .timer-pill{padding:8px 10px;font-size:12px}html[data-bijzli-classes] .theme-toggle-btn{display:none}html[data-bijzli-classes] #pause-timer-btn{display:none}html[data-bijzli-classes] .timer-pill span{display:none}}.classes-palette-toggle{display:none}@media (max-width:640px){html[data-bijzli-classes] .classes-palette-toggle{display:inline-flex;position:fixed;right:16px;bottom:16px;z-index:1700;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.14);background:#1a1b22;color:#f2f2f5;border-radius:999px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.45)}html[data-bijzli-classes] .left-panel{position:fixed!important;top:0;right:0;bottom:0;animation:none!important;width:min(320px,90vw);z-index:1600;background:#14151a;border-left:1px solid rgba(255,255,255,.1);padding:16px;overflow-y:auto;transform:translateX(105%);transition:transform .25s ease;box-shadow:-20px 0 50px rgba(0,0,0,.5)}html[data-bijzli-classes] body.classes-palette-open .left-panel{transform:none}}html[data-bijzli-classes] body.theme-dark{--bg-top:#0a0a0d!important;--bg-bottom:#0a0a0d!important;--card:#14151a!important;--ink:#f2f2f5!important;--muted:#a1a1aa!important;--accent:#a78bfa!important;--accent-strong:#c4b5fd!important;--soft-border:rgba(255,255,255,.08)!important;--shadow:0 20px 50px rgba(0,0,0,.45)!important}html[data-bijzli-classes] body.theme-dark h1,html[data-bijzli-classes] body.theme-dark h2,html[data-bijzli-classes] body.theme-dark h3,html[data-bijzli-classes] body.theme-dark h4{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif!important}</style></head>'
    )
    .replace("</body>", `${hostBridge(paperPath)}</body>`);
}

function resolveFile(base, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }
  const suffix = decoded.startsWith("/") ? decoded : `/${decoded}`;
  const file = resolve(base, `.${suffix}`);
  if (file !== base && !file.startsWith(`${base}${sep}`)) return null;
  return file;
}

async function serveFrom(base, relativePath, res, cache) {
  let file = resolveFile(base, relativePath);
  if (!file) return false;

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) return false;

  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": cache
  });
  if (res.req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

async function serveLibraryPath(relativePath, res, cache = "public, max-age=86400") {
  const rel = String(relativePath || "").replace(/^\/+/, "");

  if (rel === "assets/made-easy-dummy.js") {
    const file = resolveFile(LIBRARY, rel);
    if (!file) return false;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return false;
    send(res, 200, patchDummy(await readFile(file, "utf8")), "text/javascript; charset=utf-8", cache);
    return true;
  }

  if (rel === "assets/progress.js") {
    const file = resolveFile(LIBRARY, rel);
    if (!file) return false;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return false;
    send(res, 200, patchProgress(await readFile(file, "utf8")), "text/javascript; charset=utf-8", cache);
    return true;
  }

  return serveFrom(LIBRARY, rel, res, cache);
}

async function servePaper(url, res) {
  let paperPath = url.searchParams.get("path");
  if (!paperPath || !paperPath.trim()) {
    if (await serveFrom(ROOT, "/paper.html", res, "no-cache")) return;
    send(res, 400, "Missing paper path");
    return;
  }

  paperPath = String(paperPath).replace(/\/BIJZLIACE\//g, "/DVRUOACE/");
  const file = resolveFile(LIBRARY, paperPath);
  if (!file) {
    send(res, 400, "Invalid paper path");
    return;
  }

  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    send(res, 404, "Paper not found in the local library. Run npm run mirror to download it.");
    return;
  }

  const html = cleanPaper(await readFile(file, "utf8"), paperPath);
  send(res, 200, html, "text/html; charset=utf-8", "no-cache");
}


// ---------------------------------------------------------------------------
// Custom tests: pick a branch + subjects, get a fresh exam built from random
// questions of the matching local papers (GATE-engine .qcard papers only).
// The generated paper reuses the CE 2026 template, so timer, palette,
// submit and review all work out of the box.
// ---------------------------------------------------------------------------

const CUSTOM_DIR = join(LIBRARY, "CUSTOM");
const CUSTOM_REGISTRY = fileURLToPath(new URL("./data/custom-tests.json", import.meta.url));
const MANIFEST_FILE = fileURLToPath(new URL("./src/data/series-manifest.json", import.meta.url));
const CUSTOM_TEMPLATE =
  join(LIBRARY, "CIVIL ENGINEERING", "MADE EASY", "GATE 2026 + ESE 2026 Online Test Series - Civil Engineering", "001_Advance Level Test-1 Full Syllabus GATE 2026 CE.html");
const SECONDS_PER_QUESTION = 170;
const branchIndexCache = new Map();

async function loadCustomRegistry() {
  try {
    const parsed = JSON.parse(await readFile(CUSTOM_REGISTRY, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveCustomRegistry(entries) {
  await mkdir(dirname(CUSTOM_REGISTRY), { recursive: true });
  await writeFile(CUSTOM_REGISTRY, JSON.stringify(entries, null, 2) + "\n");
}

function tidyTitleText(text) {
  return String(text ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function subjectFromTitle(title) {
  const cleaned = tidyTitleText(title);
  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const segment = parts[1].replace(/\s*(Topic|Subject).*/i, "").trim();
      if (segment && !/^(GATE|ESE)\b/i.test(segment)) return segment;
    }
  }
  // "Subjectwise Test-1 Part Syllabus GATE 2025 EE Electric Circuit" -> "Electric Circuit"
  const match = cleaned.match(/(?:Subjectwise|Topicwise)\s*Test-\d+\s*Part Syllabus\s*(?:GATE|ESE)\s*20\d{2}\s*\S+\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function countQcards(html) {
  const matches = String(html || "").match(/<section class="card qcard"/g);
  return matches ? matches.length : 0;
}

async function paperQcardCount(path) {
  const file = resolveFile(LIBRARY, path);
  if (!file) return 0;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size === 0) return 0;
  const head = await readFile(file, "utf8").catch(() => "");
  return head.includes('<section class="card qcard"') ? countQcards(head) : 0;
}

async function branchIndex(branchName) {
  const key = String(branchName || "").toLowerCase();
  if (branchIndexCache.has(key)) return branchIndexCache.get(key);

  const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
  const branch = (manifest.branches || []).find((item) => item.name.toLowerCase() === key);
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
  const normalizeSubject = (name) =>
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s*\(?part-?\d+\)?$/i, "")
      .replace(/[\s_-]*\d+$/, "")
      .replace(/\s+/g, " ")
      .trim();
  const addSubject = (name, path) => {
    const normalized = normalizeSubject(name);
    if (!normalized || normalized === "mixed subjects" || normalized === "mock gate" || normalized === "general aptitude") return;
    if (!subjectMap.has(normalized)) subjectMap.set(normalized, { name: String(name).trim(), papers: new Set() });
    subjectMap.get(normalized).papers.add(path);
    // Prefer the canonical display name (no "-1"/"Part-2" suffixes).
    const existing = subjectMap.get(normalized);
    if (/\d\s*$/.test(existing.name) && !/\d\s*$/.test(String(name).trim())) {
      existing.name = String(name).trim();
    }
  };

  for (const test of tests) {
    if (test.subject) addSubject(test.subject, test.path);
  }

  // Question counts per subject + General Aptitude pool (reads are cached
  // in memory per branch for the process lifetime).
  // Merge singular/plural variants (e.g. Database vs Databases).
  for (const [key, entry] of [...subjectMap]) {
    if (!subjectMap.has(key)) continue; // already merged away
    const alt = key.endsWith("s") ? key.slice(0, -1) : `${key}s`;
    if (subjectMap.has(alt) && alt !== key) {
      const other = subjectMap.get(alt);
      for (const paper of other.papers) entry.papers.add(paper);
      if (!/s$/.test(entry.name) && /s$/.test(other.name)) entry.name = other.name;
      subjectMap.delete(alt);
    }
  }

  const subjectList = [];
  for (const entry of subjectMap.values()) {
    let questions = 0;
    for (const path of entry.papers) questions += await paperQcardCount(path);
    if (questions > 0) subjectList.push({ name: entry.name, papers: entry.papers.size, questions, paths: [...entry.papers] });
  }
  subjectList.sort((a, b) => b.questions - a.questions);

  let gaQuestions = 0;
  for (const test of tests) {
    const file = resolveFile(LIBRARY, test.path);
    if (!file) continue;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    const html = await readFile(file, "utf8").catch(() => "");
    if (!html.includes('<section class="card qcard"')) continue;
    const gaMatches = html.match(/<div class="tags">\s*General Aptitude/g);
    if (gaMatches) gaQuestions += gaMatches.length;
  }

  const index = {
    branch: branch.name,
    tests,
    subjects: [
      { name: "General Aptitude", papers: tests.length, questions: gaQuestions },
      ...subjectList
    ]
  };
  branchIndexCache.set(key, index);
  return index;
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

function sanitizeCustomName(raw, index) {
  const cleaned = tidyTitleText(raw || "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .slice(0, 60)
    .trim();
  return cleaned || `Custom Test ${index}`;
}

async function generateCustomTest({ branch, subjects, count, name }) {
  const index = await branchIndex(branch);
  const wanted = Array.isArray(subjects) ? subjects.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean) : [];
  if (!wanted.length) throw new Error("Select at least one subject");
  const total = Math.max(1, Math.min(100, Math.floor(Number(count) || 30)));

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
          : poolTests.filter((t) => {
              const title = t.title.toLowerCase();
              return title.includes(subjectName);
            }).map((t) => t.path));
    const unique = [...new Set(papers)];
    pools.push({ subject: subject.name, isGA, papers: unique });
  }

  const picked = [];
  const pickedKeys = new Set();
  const baseQuota = Math.floor(total / pools.length);
  const quotas = pools.map((_, i) => Math.max(1, baseQuota + (i < total % pools.length ? 1 : 0)));
  const attempts = Math.max(total * 40, 400);

  for (let attempt = 0; attempt < attempts && picked.length < total; attempt += 1) {
    const poolIndex = attempt % pools.length;
    const pool = pools[poolIndex];
    const poolPicked = picked.filter((item) => item.pool === poolIndex).length;
    if (poolPicked >= quotas[poolIndex] && attempt < total) continue;
    if (!pool.papers.length) continue;
    const path = pool.papers[Math.floor(Math.random() * pool.papers.length)];
    const file = resolveFile(LIBRARY, path);
    if (!file) continue;
    const html = await readFile(file, "utf8").catch(() => "");
    if (!html.includes('<section class="card qcard"')) continue;
    const cards = shuffle(
      extractCards(html).filter((card) => {
        const isGA = /<div class="tags">\s*General Aptitude/.test(card);
        return pool.isGA ? isGA : !isGA;
      })
    );
    if (!cards.length) continue;
    const card = cards[0];
    const key = `${path}::${card.slice(0, 400)}`;
    if (pickedKeys.has(key)) continue;
    pickedKeys.add(key);
    picked.push({ pool: poolIndex, card });
  }

  if (!picked.length) throw new Error("No matching questions found in the local papers");

  const template = await readFile(CUSTOM_TEMPLATE, "utf8");
  const cardPattern = /<section class="card qcard"[\s\S]*?<\/section>/g;
  const templateCards = [...template.matchAll(cardPattern)];
  if (!templateCards.length) throw new Error("Custom template unavailable");

  const testName = sanitizeCustomName(name, 1);
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

  const branchSlug = index.branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";
  const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `custom-${Date.now()}`;
  const relativePath = `CUSTOM/${branchSlug}/custom-${slug}-${Date.now()}.html`;
  const outFile = resolveFile(LIBRARY, relativePath);
  if (!outFile) throw new Error("Unsafe custom path");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);

  const entry = {
    name: testName,
    path: relativePath,
    branch: index.branch,
    subjects: [...new Set(pools.map((p) => p.subject))],
    questions: picked.length,
    durationSec,
    createdAt: new Date().toISOString()
  };
  const registry = await loadCustomRegistry();
  registry.push(entry);
  await saveCustomRegistry(registry.slice(-50));
  return entry;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/paper") {
      await servePaper(url, res);
      return;
    }

    if (url.pathname === "/custom/meta") {
      const branch = url.searchParams.get("branch") || "";
      const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
      const branches = (manifest.branches || []).map((item) => ({ name: item.name, testCount: item.testCount || 0 }));
      if (!branch) {
        const meta = { branches };
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-cache");
        res.end(JSON.stringify(meta));
        return;
      }
      const index = await branchIndex(branch);
      const meta = {
        branch: index.branch,
        subjects: index.subjects.map((subject) => ({
          name: subject.name,
          papers: subject.papers,
          questions: subject.questions
        }))
      };
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.end(JSON.stringify(meta));
      return;
    }

    if (url.pathname === "/custom/list") {
      const entries = await loadCustomRegistry();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.end(JSON.stringify({ tests: entries }));
      return;
    }

    if (url.pathname === "/custom/generate" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; if (raw.length > 65536) req.destroy(); });
      await new Promise((resolve) => req.on("end", resolve));
      try {
        const body = JSON.parse(raw || "{}");
        const entry = await generateCustomTest(body);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-cache");
        res.end(JSON.stringify({ ok: true, entry }));
      } catch (error) {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: error.message || "Could not generate the test" }));
      }
      return;
    }

    if (url.pathname.startsWith("/library/")) {
      const rel = url.pathname.slice("/library/".length);
      if (await serveLibraryPath(rel, res)) return;
      send(res, 404, "Not found in local library");
      return;
    }

    if (url.pathname.startsWith("/ext_media/")) {
      // Safety net for papers that resolve this path from the server root
      // instead of through their <base> URL.
      if (await serveLibraryPath(url.pathname.replace(/^\//, ""), res)) return;
      send(res, 404, "Not found in local library");
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      // App assets win; paper-only assets fall through to the local mirror.
      if (await serveFrom(ROOT, url.pathname, res, cacheControl(url.pathname))) return;
      if (await serveLibraryPath(url.pathname.replace(/^\/assets\//, "assets/"), res)) return;
      send(res, 404, "Asset not found");
      return;
    }

    if (url.pathname.startsWith("/data/")) {
      if (await serveFrom(ROOT, url.pathname, res, cacheControl(url.pathname))) return;
      send(res, 404, "Not found");
      return;
    }

    if (await serveFrom(ROOT, url.pathname, res, cacheControl(url.pathname === "/" ? "/index.html" : url.pathname))) {
      return;
    }
    send(res, 404, "Not found");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, "Local server error");
  }
});

server.listen(PORT, () => {
  console.log(`Test Series at http://localhost:${PORT}/`);
  console.log(`Local paper library: ${LIBRARY}`);
});
