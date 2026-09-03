import { renderChem, formulaMarkup, parseFormula, parseEquation, parseQuantity, repairCaseAll } from "./chem.js";
import { grade } from "./grade.js";
import { LOCK_QUESTION_TEXT, BLOCK_ANSWER_PASTE } from "./config.js";
import {
  signIn, getSessionMeta, getTopic, joinSession, watchMeta, watchMe, watchRace,
  recordAttempt, setMyLevel, raiseHand, submitRaceScore, claimNick, getMyProgress,
} from "./db.js";

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

let uid, code, nick, topic, meta;
let levelIdx = 0, correctInLevel = 0;
let queue = [], current = null, attemptNo = 0, startedAt = 0, hintsUsed = 0;
const answered = new Map();   // qid -> true once correct
let phase = "practice";
let race = null, raceIdx = 0, raceScore = 0, raceStarted = false;

/* ------------------------------------------------------------------ */
/* Join                                                                */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
if (params.get("code")) $("code").value = params.get("code").toUpperCase();
// Prefill so rejoining after a reload is one tap.
try {
  const last = JSON.parse(localStorage.getItem("chem-arena") || "{}");
  if (last.nick) $("nick").value = last.nick;
  if (last.code && !$("code").value) $("code").value = last.code;
} catch (_) { /* private browsing */ }

$("code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("joinBtn").addEventListener("click", doJoin);
$("nick").addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });

async function doJoin() {
  const c = $("code").value.trim().toUpperCase();
  const n = $("nick").value.trim();
  $("joinErr").textContent = "";
  if (c.length < 4) return ($("joinErr").textContent = "Enter the session code shown on the projector.");
  if (!n) return ($("joinErr").textContent = "Pick a nickname so your instructor can find you if you need help.");

  $("joinBtn").disabled = true;
  $("joinBtn").textContent = "Joining\u2026";
  try {
    const user = await signIn();
    uid = user.uid;
    meta = await getSessionMeta(c);
    if (!meta) throw new Error("No session with that code. Check the projector and try again.");
    topic = await getTopic(c);
    if (!topic) throw new Error("That session has no questions loaded yet.");
    const claim = await claimNick(c, uid, n);
    if (!claim.ok) throw new Error("Another device is already using that nickname in this session. Pick a different one.");

    code = c; nick = n;
    await joinSession(code, uid, nick);
    await restoreProgress();
    // Safari in private browsing throws on any storage write, and this is
    // only a convenience, so a failure must not break the join.
    try { localStorage.setItem("chem-arena", JSON.stringify({ code, nick })); } catch (_) {}
    startSession();
  } catch (err) {
    $("joinErr").textContent = err.message || "Could not join. Check your connection.";
    $("joinBtn").disabled = false;
    $("joinBtn").textContent = "Join session";
  }
}

// Rebuilds local state from the student's own stored answers so a reload
// picks up where they left off instead of starting the level again.
async function restoreProgress() {
  const mine = await getMyProgress(code, uid).catch(() => null);
  if (!mine) return;
  for (const [qid, row] of Object.entries(mine.progress || {})) {
    if (row && row.ok) answered.set(qid, true);
  }
  const saved = mine.student && typeof mine.student.level === "number" ? mine.student.level : 0;
  levelIdx = Math.min(Math.max(saved, 0), topic.levels.length - 1);
  // Recounted from stored answers rather than trusting the running total, so
  // a rejoin cannot inflate progress toward the next level.
  correctInLevel = topic.levels[levelIdx].questions.filter((q) => answered.get(q.id)).length;
}

function startSession() {
  show("join", false);
  watchMeta(code, (m) => {
    if (!m) return;
    meta = m;
    if (m.phase !== phase) { phase = m.phase; onPhase(); }
  });
  watchMe(code, uid, (s) => {
    if (s && typeof s.level === "number" && s.level !== levelIdx && phase === "practice") {
      levelIdx = s.level; correctInLevel = s.correct || 0; buildQueue(); nextQuestion();
    }
  });
  phase = meta.phase || "practice";
  onPhase();
}

function onPhase() {
  if (phase === "ended") {
    show("practice", false); show("race", false); show("ended", true);
    const total = [...answered.values()].filter(Boolean).length;
    $("endedStats").textContent = total
      ? `You answered ${total} question${total === 1 ? "" : "s"} correctly. Nice work.`
      : "Thanks for taking part.";
    return;
  }
  show("ended", false);
  if (phase === "race") {
    show("practice", false); show("race", true);
    watchRace(code, onRace);
  } else {
    show("race", false); show("practice", true);
    buildQueue(); nextQuestion(); paintLevel();
  }
}

/* ------------------------------------------------------------------ */
/* Practice                                                            */
/* ------------------------------------------------------------------ */

const level = () => topic.levels[levelIdx];
const levelCleared = () =>
  correctInLevel >= (level().requiredCorrect || 1) && levelIdx < topic.levels.length - 1;

// The banner is the one-shot celebration; the bar is the persistent way up for
// a student who chose to keep practising and would otherwise be stuck.
function paintAdvanceUi(celebrate) {
  const cleared = levelCleared();
  show("levelUp", cleared && celebrate);
  show("nextLevelBar", cleared && !celebrate);
}

// Practice mode serves the whole level pool, shuffled per student, so nobody
// runs out after hitting the target and no two neighbours see the same order.
function buildQueue() {
  const pool = level().questions.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  queue = pool.filter((q) => !answered.get(q.id)).concat(pool.filter((q) => answered.get(q.id)));
}

function nextQuestion() {
  paintAdvanceUi(false);
  current = queue.shift();
  if (!current) { buildQueue(); current = queue.shift(); }
  attemptNo = 0; hintsUsed = 0; startedAt = Date.now();
  $("qVerdict").innerHTML = ""; $("qHint").innerHTML = "";
  show("nextBtn", false);
  $("checkBtn").disabled = false; $("checkBtn").textContent = "Check answer";
  show("hintBtn", !!(current.hints || []).length);

  const done = level().questions.filter((q) => answered.get(q.id)).length;
  $("qMeta").textContent = `${level().title || level().id} \u00b7 ${done} of ${level().questions.length} answered`;
  $("qPrompt").innerHTML = renderChem(current.prompt);
  buildInput("qInput", "qPreview", current);
  $("doneNote").textContent = done >= level().questions.length ? "You have answered every question in this level." : "";
}

$("checkBtn").addEventListener("click", checkAnswer);
$("nextBtn").addEventListener("click", nextQuestion);
$("hintBtn").addEventListener("click", () => {
  const hs = current.hints || [];
  if (hintsUsed >= hs.length) return;
  const d = document.createElement("div");
  d.className = "hint small";
  d.innerHTML = renderChem(hs[hintsUsed++]);
  $("qHint").appendChild(d);
  if (hintsUsed >= hs.length) $("hintBtn").disabled = true;
});

async function checkAnswer() {
  const val = readInput("qInput", current);
  attemptNo += 1;
  const seconds = (Date.now() - startedAt) / 1000;
  const r = grade(current, val, topic.topic.defaults || {});

  paintVerdict("qVerdict", r, current);

  await recordAttempt(code, uid, {
    qid: current.id, levelId: level().id, correct: r.correct, attemptNo,
    seconds, label: r.label, expectedSeconds: current.expectedSeconds,
  }).catch(() => {});

  if (r.correct) {
    $("checkBtn").disabled = true;
    show("nextBtn", true);
    if (!answered.get(current.id)) {
      answered.set(current.id, true);
      correctInLevel += 1;
      setMyLevel(code, uid, levelIdx, correctInLevel).catch(() => {});
      paintLevel();
      if (correctInLevel >= (level().requiredCorrect || 1) && levelIdx < topic.levels.length - 1) {
        offerAdvance();
      }
    }
  }
}

function paintLevel() {
  const need = level().requiredCorrect || 1;
  $("levelChip").textContent = level().id;
  $("levelCount").textContent = `${Math.min(correctInLevel, need)}/${need}`;
  $("levelMeter").style.width = `${Math.min(100, (correctInLevel / need) * 100)}%`;
  if (!$("levelUp").classList.contains("hidden")) return;
  show("nextLevelBar", levelCleared());
}

function offerAdvance() {
  $("levelUpText").textContent = `${level().title || level().id} cleared.`;
  paintAdvanceUi(true);
}

$("stayBtn").addEventListener("click", () => paintAdvanceUi(false));
$("advanceBtn").addEventListener("click", advanceLevel);
$("nextLevelBtn").addEventListener("click", advanceLevel);

function advanceLevel() {
  levelIdx = Math.min(levelIdx + 1, topic.levels.length - 1);
  correctInLevel = 0;
  setMyLevel(code, uid, levelIdx, 0).catch(() => {});
  buildQueue(); nextQuestion(); paintLevel();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

$("helpBtn").addEventListener("click", async () => {
  const btn = $("helpBtn");
  btn.disabled = true;
  const qid = phase === "race" ? (race && race.meta.qids[raceIdx]) : (current && current.id);
  await raiseHand(code, uid, nick, qid || "", level().id).catch(() => {});
  btn.textContent = "Asked";
  setTimeout(() => { btn.disabled = false; btn.textContent = "Help"; }, 20000);
});

/* ------------------------------------------------------------------ */
/* Question text locking                                               */
/* ------------------------------------------------------------------ */

// Blocks the ordinary routes out of the question card: drag-select, the
// right-click menu, the iOS long-press callout, and the copy shortcut. Form
// fields are exempt so the answer box still works normally.
function lockQuestionText(el) {
  if (!LOCK_QUESTION_TEXT || !el || el.dataset.locked) return;
  el.dataset.locked = "1";
  el.classList.add("noselect");
  const isField = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
  for (const ev of ["copy", "cut", "contextmenu", "selectstart", "dragstart"]) {
    el.addEventListener(ev, (e) => { if (!isField(e.target)) e.preventDefault(); });
  }
}

["qCard", "raceCard"].forEach((id) => lockQuestionText($(id)));

/* ------------------------------------------------------------------ */
/* Input widgets                                                       */
/* ------------------------------------------------------------------ */

// Subscripts are plain digits here (H2O), so the pad only carries the
// characters a phone keyboard buries. Each key gets a spoken-word title.
//
// The hydrate dot is labelled rather than shown bare: sitting between + and -
// a lone middot reads as a multiplication sign, and students used it as one.
const KEYS = [
  ["x\u207f", "sup", "superscript, for charges and exponents"],
  ["+", "+", "plus"],
  ["\u2212", "-", "minus"],
  ["\u2192", " -> ", "yields arrow"],
  ["\u21cc", " <-> ", "equilibrium arrow"],
  ["( )", "()", "parentheses"],
  ["\u0394", "\u0394", "delta"],
  ["\u00b0", "\u00b0", "degree"],
  ["/", "/", "divided by"],
  ["\u00b7 hydrate", "\u00b7", "hydrate dot, as in CuSO4\u00b75H2O \u2014 not multiplication"],
];

function buildInput(hostId, previewId, q) {
  const host = $(hostId);
  host.innerHTML = "";
  const a = q.answer;

  if (a.type === "choice") {
    const order = a.options.map((_, i) => i);
    if (a.shuffle) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    host.dataset.order = JSON.stringify(order);
    order.forEach((origIdx) => {
      const b = document.createElement("button");
      b.className = "choice"; b.dataset.idx = origIdx;
      b.innerHTML = renderChem(a.options[origIdx]);
      b.addEventListener("click", () => {
        if (!a.multiSelect) host.querySelectorAll(".choice").forEach((x) => x.classList.remove("sel"));
        b.classList.toggle("sel");
      });
      host.appendChild(b);
    });
    if (previewId) $(previewId).textContent = "";
    return;
  }

  if (a.type === "balance") {
    const wrap = document.createElement("div");
    wrap.className = "skeleton";
    const parts = String(a.skeleton).split("__");
    parts.forEach((chunk, i) => {
      wrap.insertAdjacentHTML("beforeend", renderChem(chunk));
      if (i < parts.length - 1) {
        const inp = document.createElement("input");
        inp.type = "number"; inp.min = "1"; inp.className = "blank"; inp.inputMode = "numeric";
        inp.setAttribute("aria-label", `Coefficient ${i + 1}`);
        wrap.appendChild(inp);
      }
    });
    host.appendChild(wrap);
    if (previewId) $(previewId).textContent = "";
    return;
  }

  const inp = document.createElement("input");
  inp.type = "text"; inp.className = "answer-input"; inp.autocomplete = "off";
  inp.autocapitalize = "off"; inp.spellcheck = false;
  inp.placeholder = placeholderFor(a.type);
  inp.setAttribute("aria-label", "Your answer");
  host.appendChild(inp);

  const pad = document.createElement("div");
  pad.className = "keypad";
  for (const [label, val, hint] of KEYS) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.tabIndex = -1;
    if (hint) { b.title = hint; b.setAttribute("aria-label", hint); }
    if (val === "\u00b7") b.classList.add("wide");
    b.addEventListener("click", () => { insert(inp, val); updatePreview(inp, previewId, a.type); });
    pad.appendChild(b);
  }
  host.appendChild(pad);

  if (BLOCK_ANSWER_PASTE) inp.addEventListener("paste", (e) => e.preventDefault());
  inp.addEventListener("input", () => updatePreview(inp, previewId, a.type));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); (hostId === "qInput" ? $("checkBtn") : $("rqSubmit")).click(); }
  });
  setTimeout(() => inp.focus({ preventScroll: true }), 40);
  updatePreview(inp, previewId, a.type);
}

function placeholderFor(t) {
  return {
    numeric: "0.125 mol", range: "7.0", formula: "Al2(SO4)3",
    equation: "N2 + 3 H2 -> 2 NH3", text: "trigonal planar",
    expression: "1s2 2s2 2p6", set: "Na+, SO4 2-",
  }[t] || "";
}

// The chem keys write plain markers; "sub" and "sup" wrap the last token so a
// student never has to hunt for a superscript on a phone keyboard.
function insert(inp, val) {
  const s = inp.selectionStart ?? inp.value.length;
  const e = inp.selectionEnd ?? s;
  let text = val, caret = null;
  if (val === "sup") text = "^";
  if (val === "()") { text = "()"; caret = s + 1; }
  inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
  const pos = caret ?? s + text.length;
  inp.focus();
  inp.setSelectionRange(pos, pos);
}

// The live preview is the single best defence against grading disputes: the
// student sees how the app read their input before they commit to it.
function updatePreview(inp, previewId, type) {
  if (!previewId) return;
  const el = $(previewId);
  const raw = inp.value.trim();
  if (!raw) { el.innerHTML = ""; return; }

  let text = "", warn = "", sig = "";
  try {
    if (type === "formula" || type === "set") {
      const p = parseFormula(raw);
      if (p.ok) text = pretty(p);
      else warn = capitalHint(raw);
    } else if (type === "equation") {
      const p = parseEquation(raw);
      if (p.ok) {
        const side = (arr) => arr.map((s) => (s.coef === 1 ? "" : s.coef + " ") + pretty(s.formula)).join(" + ");
        text = `${side(p.lhs)} ${p.arrow === "equilibrium" ? "\u21cc" : "\u2192"} ${side(p.rhs)}`;
      }
    } else if (type === "numeric" || type === "range") {
      const p = parseQuantity(raw);
      if (!p.ok && /[\u00b7*]/.test(raw)) {
        warn = "the dot is the hydrate separator, as in CuSO_4\u00b75H_2O. It does not multiply \u2014 work out the number and type the result.";
      } else if (p.ok) {
        text = `${p.text}${p.unit ? " " + p.unit : ""}`;
        if (type === "numeric") {
          sig = p.ambiguousSig
            ? `${p.sig}\u2013${p.sigMax} sig figs (ambiguous \u2014 write it in scientific notation)`
            : `${p.sig} sig fig${p.sig === 1 ? "" : "s"}`;
        }
      }
    }
  } catch (_) { /* preview must never block typing */ }

  if (warn) { el.innerHTML = `<span style="color:var(--na)">${renderChem(warn)}</span>`; return; }
  if (!text) { el.innerHTML = ""; return; }
  el.innerHTML = `reads as <b>${renderChem(text)}</b>${sig ? ` <span class="tiny">\u00b7 ${sig}</span>` : ""}`;
}

// Element symbols are case-sensitive and CO is not Co, so the app never
// silently rewrites. It names a correction only when there is exactly one
// valid reading, and otherwise just points at the rule.
function capitalHint(raw) {
  const reads = repairCaseAll(raw.replace(/[\s^]/g, ""));
  const valid = [...new Set(reads)].filter((r) => parseFormula(r).ok);
  if (valid.length === 1) return `check your capitals \u2014 did you mean ${valid[0]}?`;
  if (valid.length > 1) return "element symbols are case-sensitive: Co is cobalt, CO is carbon monoxide";
  return "";
}

// Built from the string that was parsed, not from the expanded token list.
// The token list repeats grouped units, which rendered Al2(SO4)3 back to the
// student as Al2SO4SO4SO4.
function pretty(p) {
  let out = p.electron ? "e" : formulaMarkup(p.body);
  if (p.charge) out += "^" + (Math.abs(p.charge) === 1 ? "" : Math.abs(p.charge)) + (p.charge > 0 ? "+" : "-");
  if (p.phase) out += `(${p.phase})`;
  return out;
}

function readInput(hostId, q) {
  const host = $(hostId);
  const a = q.answer;
  if (a.type === "choice") return [...host.querySelectorAll(".choice.sel")].map((b) => Number(b.dataset.idx));
  if (a.type === "balance") return [...host.querySelectorAll("input")].map((i) => i.value.trim());
  const inp = host.querySelector("input");
  return inp ? inp.value : "";
}

function paintVerdict(hostId, r, q) {
  const host = $(hostId);
  const cls = r.correct ? (r.label === "correct" ? "right" : "near") : (r.label === "partial" || r.label === "near-miss" ? "near" : "wrong");
  const head = r.correct ? (r.label === "correct" ? "Correct" : "Correct, with a note") : "Not yet";
  const body = r.message || (r.correct ? "" : "Try again.");
  const explain = r.correct && q.explanation ? `<p class="small muted" style="margin:8px 0 0">${renderChem(q.explanation)}</p>` : "";
  host.innerHTML = `<div class="verdict ${cls}"><h3>${head}</h3><p class="small" style="margin:0">${renderChem(body)}</p>${explain}</div>`;
}

/* ------------------------------------------------------------------ */
/* Race                                                                */
/* ------------------------------------------------------------------ */

function onRace(r) {
  if (!r || !r.meta) return;
  race = r;
  if (r.meta.status === "done") { finishRace(); return; }
  if (!raceStarted) { raceStarted = true; raceIdx = 0; raceScore = 0; countdown(3); }
}

function countdown(n) {
  show("raceCountdown", true); show("raceCard", false); show("raceDone", false);
  $("cdNum").textContent = n;
  if (n === 0) { show("raceCountdown", false); showRaceQuestion(); return; }
  setTimeout(() => countdown(n - 1), 900);
}

const raceQuestions = () => {
  const byId = new Map();
  topic.levels.forEach((l) => l.questions.forEach((q) => byId.set(q.id, q)));
  return (race.meta.qids || []).map((id) => byId.get(id)).filter(Boolean);
};

function showRaceQuestion() {
  const qs = raceQuestions();
  if (raceIdx >= qs.length) return finishRace();
  current = qs[raceIdx];
  startedAt = Date.now(); attemptNo = 0;
  show("raceCard", true);
  $("rqVerdict").innerHTML = "";
  $("rqSubmit").disabled = false;
  $("rqMeta").textContent = `Question ${raceIdx + 1} of ${qs.length}`;
  $("rqPrompt").innerHTML = renderChem(current.prompt);
  $("raceMeter").style.width = `${(raceIdx / qs.length) * 100}%`;
  buildInput("rqInput", "rqPreview", current);
}

$("rqSubmit").addEventListener("click", async () => {
  const val = readInput("rqInput", current);
  attemptNo += 1;
  const elapsed = (Date.now() - startedAt) / 1000;
  const r = grade(current, val, topic.topic.defaults || {});
  paintVerdict("rqVerdict", r, current);

  await recordAttempt(code, uid, {
    qid: current.id, levelId: "race", correct: r.correct, attemptNo,
    seconds: elapsed, label: r.label, expectedSeconds: current.expectedSeconds,
  }).catch(() => {});

  if (!r.correct && attemptNo < 3) return;

  if (r.correct) {
    const pts = current.points || 10;
    const factor = attemptNo === 1 ? 1 : attemptNo === 2 ? 0.6 : 0.3;
    const bonus = Math.round(pts * 0.5 * Math.max(0, 1 - elapsed / (current.expectedSeconds || 60)));
    raceScore += Math.round(pts * factor) + bonus;
  }
  $("raceScore").textContent = `${raceScore} pts`;
  $("rqSubmit").disabled = true;
  raceIdx += 1;
  submitRaceScore(code, uid, nick, raceScore, raceIdx, false).catch(() => {});
  setTimeout(showRaceQuestion, r.correct ? 700 : 1400);
});

function finishRace() {
  show("raceCountdown", false); show("raceCard", false); show("raceDone", true);
  $("raceMeter").style.width = "100%";
  $("raceFinal").textContent = `${raceScore} points`;
  submitRaceScore(code, uid, nick, raceScore, raceIdx, true).catch(() => {});
}
