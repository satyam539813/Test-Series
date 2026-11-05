// Shared paper helpers for the Vercel serverless functions.
// Papers are fetched live from the upstream mirror and patched the same way
// the local server (server.mjs) patches the local library copy.

export const ORIGIN = "https://dvruo-test-series.netlify.app";

export function upstreamPath(pathname) {
  return String(pathname || "").replace(/\/BIJZLIACE\//g, "/DVRUOACE/");
}

function paperBaseOrigin(paperPath) {
  const dir = upstreamPath(String(paperPath || ""))
    .split("/")
    .slice(0, -1)
    .map(encodeURIComponent)
    .join("/");
  return dir ? `${ORIGIN}/${dir}/` : `${ORIGIN}/`;
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

export function patchProgress(js) {
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

export function patchDummy(js) {
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

export function cleanPaperVercel(html, paperPath, host) {
  let cleaned = html;
  const hostUrl = `https://${host || "bijzlitestseries4-local.vercel.app"}`;
  const paperDir = upstreamPath(String(paperPath || "")).split("/").slice(0, -1);

  const toAbsoluteOrigin = (ref) => {
    const value = String(ref || "").trim();
    if (!value || /^(?:#|data:|mailto:|tel:|javascript:|blob:|\/)/i.test(value)) return ref;
    if (/^https?:\/\//i.test(value)) return ref;
    const hashIndex = value.search(/[?#]/);
    const pathPart = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const suffix = hashIndex >= 0 ? value.slice(hashIndex) : "";
    if (!pathPart) return ref;
    const segments = [...paperDir];
    for (const part of pathPart.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") segments.pop();
      else segments.push(part);
    }
    return `${ORIGIN}/${segments.map(encodeURIComponent).join("/")}${suffix}`;
  };

  // Pre-paint dark-theme force (before any paper engine reads storage).
  // NOTE: no <base> here — it would hijack resolution and bypass the
  // patched functions. Relative refs become absolute URLs instead.
  cleaned = cleaned.replace(
    /<head([^>]*)>/i,
    `<head$1><script>try{localStorage.setItem("theme","dark");localStorage.setItem("bijzli-provider-theme","dark");localStorage.setItem("test-ui-theme","dark");}catch(e){}</script>`
  );

  // Route patched assets through Vercel functions (see vercel.json rewrites).
  cleaned = cleaned.replace(
    /\b(src|href)=(["'])([^"']*assets\/(calculator\.js|made-easy-dummy\.js|progress\.js)[^"']*)\2/gi,
    (match, attr, quote, ref) => {
      const name = ref.includes("calculator.js")
        ? "calculator.js"
        : ref.includes("made-easy")
          ? "made-easy-dummy.js"
          : "progress.js";
      return `${attr}=${quote}${hostUrl}/assets/${name}?v=20261105-ui7${quote}`;
    }
  );
  cleaned = cleaned.replace(/\b(src|href|poster|data-src|data-href)=(["'])([^"']+)\2/gi, (match, attr, quote, ref) => {
    return `${attr}=${quote}${toAbsoluteOrigin(ref)}${quote}`;
  });
  cleaned = cleaned.replace(/\burl\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, ref) => {
    const absolute = toAbsoluteOrigin(ref);
    return absolute === ref ? match : `url(${quote}${absolute}${quote})`;
  });
  // 2027 papers embed ../media/... in JSON strings resolved at runtime.
  cleaned = cleaned.replace(/"((?:\.\.\/)+media\/[^"]+)"/g, (match, ref) => {
    return `"${toAbsoluteOrigin(ref)}"`;
  });

  // Scrub provider branding from paper chrome (same as the local server).
  cleaned = cleaned
    .split('"orgName":"DVRUOACE"').join('"orgName":"Test Series"')
    .split('"batchName":"DVRUOACE Test Series').join('"batchName":"Test Series"')
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
