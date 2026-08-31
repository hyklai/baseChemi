import { validateTopic } from "./grade.js";
import {
  watchAuth, isTeacher, signInTeacher, signOutTeacher, resetTeacherPassword,
  createSession, getActiveSession, forgetActiveSession, getTopic, endPractice, getSessionMeta,
  watchStudents, watchAgg, watchHelps, watchRace,
  clearHand, exportCsv, downloadCsv, startRace, endRace,
  struggleScore, readyToShow, topError, errorName,
} from "./db.js";
import { BUILTIN_TOPICS, MIN_RESPONSES_TO_SHOW } from "./config.js";

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

let uid, code, topic;
let students = {}, agg = {};
let unsubs = [];        // live listeners, detached when returning to setup
let exported = false;   // whether this session's CSV has been taken yet

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

// Fires on load with the stored session, so a reload lands straight on the
// console rather than back at the password box.
watchAuth(async (user) => {
  if (!isTeacher(user)) { uid = null; show("login", true); show("setup", false); return; }
  uid = user.uid;
  show("login", false); show("setup", true);
  await offerResume();
});

$("signInBtn").addEventListener("click", doSignIn);
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") doSignIn(); });
$("email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("password").focus(); });

async function doSignIn() {
  $("loginErr").textContent = ""; $("loginNote").textContent = "";
  const email = $("email").value.trim();
  const pw = $("password").value;
  if (!email) return ($("loginErr").textContent = "Enter your email.");
  if (!pw) return ($("loginErr").textContent = "Enter your password.");

  $("signInBtn").disabled = true;
  $("signInBtn").textContent = "Signing in\u2026";
  try {
    await signInTeacher(email, pw);
    $("password").value = "";
  } catch (e) {
    $("loginErr").textContent = e.message;
  } finally {
    $("signInBtn").disabled = false;
    $("signInBtn").textContent = "Sign in";
  }
}

$("forgotBtn").addEventListener("click", async () => {
  const email = $("email").value.trim();
  $("loginErr").textContent = ""; $("loginNote").textContent = "";
  if (!email) return ($("loginErr").textContent = "Type your email above first, then press Forgot password.");
  try {
    await resetTeacherPassword(email);
    $("loginNote").textContent = "If that address has an account, a reset link is on its way.";
  } catch (e) { $("loginErr").textContent = e.message; }
});

const doSignOut = async () => { await signOutTeacher(); location.reload(); };
$("signOutBtn").addEventListener("click", doSignOut);
$("signOutLive").addEventListener("click", doSignOut);

/* ------------------------------------------------------------------ */
/* Resume a running session                                            */
/* ------------------------------------------------------------------ */

async function offerResume() {
  // A code in the URL reopens any session you own, including one you have
  // already finished with. This is how you export a session's data after the
  // fact, so it is not tied to the stored "currently running" pointer.
  const wanted = (new URLSearchParams(location.search).get("code") || "").trim().toUpperCase();
  if (wanted) {
    const meta = await getSessionMeta(wanted).catch(() => null);
    if (meta && meta.teacherUid === uid) return rejoin({ code: wanted, meta });
    if (meta) problems([`Session ${wanted} belongs to a different account.`], []);
    else if (wanted) problems([`No session found with the code ${wanted}.`], []);
  }

  const active = await getActiveSession(uid).catch(() => null);
  if (!active) { show("resumeCard", false); return; }
  $("resumeCode").textContent = active.code;
  $("resumeTitle").textContent = active.meta.title || "";
  show("resumeCard", true);
  $("resumeBtn").onclick = () => rejoin(active);
  $("resumeDismiss").onclick = () => { forgetActiveSession(uid); show("resumeCard", false); };
}

async function rejoin(active) {
  topic = await getTopic(active.code);
  if (!topic) { problems([`Session ${active.code} has no questions stored.`], []); return; }
  code = active.code;
  exported = false;
  show("resumeCard", false);
  history.replaceState(null, "", `?code=${code}`);

  // A finished session has no live console to return to, but its data is
  // still there, so it opens straight on the wrap-up screen.
  if (active.meta && active.meta.phase === "ended") {
    showWrapUp("Session closed", `${topic.topic.title}. Practice has ended, but the data is still here.`, true);
    return;
  }
  goLive();
}

/* ------------------------------------------------------------------ */
/* Load and validate a topic                                           */
/* ------------------------------------------------------------------ */

BUILTIN_TOPICS.forEach((t) => {
  const o = document.createElement("option");
  o.value = t.file; o.textContent = t.label;
  $("builtin").appendChild(o);
});

$("loadBuiltin").addEventListener("click", async () => {
  try {
    const res = await fetch($("builtin").value, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not read ${$("builtin").value} (${res.status}).`);
    tryLoad(await res.json());
  } catch (e) { problems([e.message], []); }
});

$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { tryLoad(JSON.parse(await f.text())); }
  catch (err) { problems([`${f.name} is not valid JSON: ${err.message}`], []); }
});

$("loadPaste").addEventListener("click", () => {
  try { tryLoad(JSON.parse($("paste").value)); }
  catch (err) { problems([`That is not valid JSON: ${err.message}`], []); }
});

function tryLoad(data) {
  const v = validateTopic(data);
  problems(v.errors, v.warnings);
  if (!v.ok) { topic = null; $("reviewCard").style.display = "none"; return; }
  topic = data;
  $("tTitle").textContent = data.topic.title;
  const qs = data.levels.reduce((a, l) => a + l.questions.length, 0);
  $("tSummary").textContent = `${data.levels.length} levels \u00b7 ${qs} questions${data.topic.course ? " \u00b7 " + data.topic.course : ""}`;
  $("tLevels").innerHTML = data.levels.map((l) => `
    <div class="levelrow">
      <span class="mono tiny">${l.id}</span>
      <span class="small">${l.title || ""}</span>
      <span class="mono tiny muted">${l.requiredCorrect}/${l.questions.length}</span>
    </div>`).join("");
  $("reviewCard").style.display = "";
}

function problems(errors, warnings) {
  const host = $("valid");
  if (!errors.length && !warnings.length) { host.innerHTML = ""; return; }
  const block = (title, items, cls) => items.length
    ? `<p class="small ${cls}" style="margin:12px 0 0"><strong>${title}</strong></p><ul class="problems ${cls}">${items.map((e) => `<li>${e}</li>`).join("")}</ul>`
    : "";
  host.innerHTML = block(`${errors.length} problem${errors.length === 1 ? "" : "s"} to fix`, errors, "err")
    + block(`${warnings.length} thing${warnings.length === 1 ? "" : "s"} to check`, warnings, "muted");
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

$("startBtn").addEventListener("click", async () => {
  if (!topic) return;
  if (!uid) { problems(["You are signed out. Sign in again to start a session."], []); return; }
  $("startBtn").disabled = true;
  $("startBtn").textContent = "Starting\u2026";
  try {
    code = await createSession(topic, uid);
    goLive();
  } catch (e) {
    problems([e.message || "Could not start the session."], []);
    $("startBtn").disabled = false;
    $("startBtn").textContent = "Start session";
  }
});

function goLive() {
  show("setup", false); show("live", true);
  $("codeChip").textContent = code;
  $("liveTitle").textContent = topic.topic.title;
  history.replaceState(null, "", `?code=${code}`);

  unsubs.push(
    watchStudents(code, (s) => { students = s; paintStudents(); }),
    watchAgg(code, (a) => { agg = a; paintHard(); }),
    watchHelps(code, paintHelps),
  );
}

function detach() {
  unsubs.forEach((u) => { try { u(); } catch (_) {} });
  unsubs = [];
}

/* ------------------------------------------------------------------ */
/* Live panels                                                         */
/* ------------------------------------------------------------------ */

function paintStudents() {
  const list = Object.values(students);
  $("joined").textContent = `${list.length} joined`;
  const counts = topic.levels.map(() => 0);
  list.forEach((s) => { counts[Math.min(s.level || 0, counts.length - 1)] += 1; });
  const max = Math.max(1, ...counts);
  $("levelBars").innerHTML = topic.levels.map((l, i) => `
    <div class="levelrow">
      <span class="mono tiny">${l.id}</span>
      <div class="meter"><i style="width:${(counts[i] / max) * 100}%"></i></div>
      <span class="mono tiny muted">${counts[i]}</span>
    </div>`).join("");
}

function paintHelps(helps) {
  const entries = Object.entries(helps);
  show("helpCard", entries.length > 0);
  entries.sort((a, b) => a[1].at - b[1].at);
  $("helpList").innerHTML = entries.map(([id, h]) => `
    <li>
      <span class="who">${escapeHtml(h.nick)}</span>
      <span class="tiny mono muted">${h.qid || ""}</span>
      <button class="ghost small" data-uid="${id}" style="margin-left:auto; padding:6px 12px">Resolved</button>
    </li>`).join("");
  $("helpList").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => clearHand(code, b.dataset.uid));
  });
}

function paintHard() {
  const rows = Object.entries(agg)
    .filter(([, a]) => readyToShow(a))
    .map(([qid, a]) => ({ qid, s: struggleScore(a), a }))
    .filter((r) => r.s !== null)
    .sort((x, y) => y.s - x.s)
    .slice(0, 5);

  if (!rows.length) {
    $("hardList").innerHTML = `<p class="small muted" style="margin:0">Nothing to show yet. A question appears once ${MIN_RESPONSES_TO_SHOW} students have tried it.</p>`;
    return;
  }
  $("hardList").innerHTML = rows.map((r) => {
    const te = topError(r.a);
    const pct = Math.round((100 * (r.a.firstOk || 0)) / r.a.n);
    return `<div class="levelrow" style="grid-template-columns:76px 1fr 40px">
      <span class="mono tiny">${r.qid}</span>
      <span class="small">${pct}% first try${te ? ` \u00b7 ${escapeHtml(errorName(te.label))} (${te.count})` : ""}</span>
      <span class="mono tiny" style="color:${colorFor(r.s)}">${r.s}</span>
    </div>`;
  }).join("");
}

const colorFor = (s) => (s < 34 ? "var(--cu)" : s < 67 ? "var(--na)" : "var(--sr)");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ------------------------------------------------------------------ */
/* Export, projector, race                                             */
/* ------------------------------------------------------------------ */

$("displayBtn").addEventListener("click", () => window.open(`display.html?code=${code}`, "_blank", "noopener"));

$("csvBtn").addEventListener("click", async () => {
  $("csvBtn").disabled = true;
  await doExport();
  $("csvBtn").disabled = false;
});

async function doExport() {
  const csv = await exportCsv(code);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  downloadCsv(csv, `${code}-${stamp}.csv`);
  exported = true;
}

$("endPracticeBtn").addEventListener("click", async () => {
  if (!confirm("End practice? Students will not be able to answer any more.")) return;
  const btn = $("endPracticeBtn");
  btn.disabled = true; btn.textContent = "Ending\u2026";
  try {
    await endPractice(code);
    showWrapUp("Practice ended", "You can export the data or start a race with the same questions.", true);
  } finally {
    btn.disabled = false; btn.textContent = "End practice";
  }
});

function showWrapUp(title, note, offerRace) {
  $("wrapEyebrow").textContent = offerRace ? "Practice" : "Race";
  $("wrapTitle").textContent = title;
  $("wrapNote").textContent = note;
  $("wrapCode").textContent = code || "";
  show("wrapRaceBtn", offerRace);
  show("live", false); show("raceSetup", false); show("raceLive", false); show("wrapUp", true);
}

$("wrapExportBtn").addEventListener("click", async () => {
  $("wrapExportBtn").disabled = true;
  await doExport();
  $("wrapExportBtn").disabled = false;
});

$("wrapBackBtn").addEventListener("click", () => {
  // The data survives either way, but it is easy to walk out of a room having
  // meant to export, so this is mentioned once and only when it applies.
  if (!exported && !confirm(`You have not exported session ${code}. The data stays in the database and you can reopen it later with teacher.html?code=${code}. Go back now?`)) return;
  detach();
  forgetActiveSession(uid);
  code = null; students = {}; agg = {}; exported = false;
  history.replaceState(null, "", location.pathname);
  ["wrapUp", "live", "raceSetup", "raceLive", "resumeCard"].forEach((id) => show(id, false));
  show("setup", true);
  $("startBtn").disabled = false;
  $("startBtn").textContent = "Start session";
  $("raceGo").disabled = false;
  $("raceGo").textContent = "Start the race";
  $("raceEnd").disabled = false;
  $("raceEnd").textContent = "End race";
  window.scrollTo(0, 0);
});

$("wrapRaceBtn").addEventListener("click", openRaceSetup);
$("raceBtn").addEventListener("click", openRaceSetup);

let cameFromWrapUp = false;

function openRaceSetup() {
  cameFromWrapUp = !$("wrapUp").classList.contains("hidden");
  show("live", false); show("wrapUp", false); show("raceSetup", true);
  $("raceCounts").innerHTML = topic.levels.map((l, i) => `
    <div class="levelrow" style="grid-template-columns:1fr 80px">
      <span class="small"><strong class="mono tiny">${l.id}</strong> ${l.title || ""}</span>
      <input type="number" min="0" max="${l.questions.length}" value="${Math.min(l.raceCount || 2, l.questions.length)}" data-level="${i}">
    </div>`).join("");
}

$("raceCancel").addEventListener("click", () => {
  show("raceSetup", false);
  // Back to whichever screen sent us here.
  show(cameFromWrapUp ? "wrapUp" : "live", true);
});

$("raceGo").addEventListener("click", async () => {
  const picks = [];
  $("raceCounts").querySelectorAll("input").forEach((inp) => {
    const lvl = topic.levels[Number(inp.dataset.level)];
    const n = Math.max(0, Math.min(Number(inp.value) || 0, lvl.questions.length));
    const pool = lvl.questions.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    picks.push(...pool.slice(0, n).map((q) => q.id));
  });
  if (!picks.length) return alert("Pick at least one question.");

  for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }

  $("raceGo").disabled = true;
  $("raceGo").textContent = "Starting\u2026";
  await startRace(code, picks);
  show("raceSetup", false); show("raceLive", true);
  $("raceStatus").textContent = `${picks.length} questions in play`;
  unsubs.push(watchRace(code, paintBoard));
});

function paintBoard(r) {
  const scores = Object.values((r && r.scores) || {});
  scores.sort((a, b) => b.score - a.score || a.at - b.at);
  const done = scores.filter((s) => s.done).length;
  $("raceStatus").textContent = `${done} of ${scores.length} finished`;
  $("raceBoard").innerHTML = scores.slice(0, 12).map((s, i) => `
    <div class="levelrow" style="grid-template-columns:34px 1fr 70px">
      <span class="mono tiny muted">${i + 1}</span>
      <span class="small">${escapeHtml(s.nick)}${s.done ? "" : ' <span class="tiny muted">\u00b7 racing</span>'}</span>
      <span class="mono tiny">${s.score}</span>
    </div>`).join("") || '<p class="small muted" style="margin:0">Waiting for the first submission.</p>';
}

$("raceEnd").addEventListener("click", async () => {
  if (!confirm("End the race? Students will stop where they are.")) return;
  $("raceEnd").disabled = true;
  $("raceEnd").textContent = "Ending\u2026";
  await endRace(code);
  await endPractice(code);
  showWrapUp("Race finished", "One export covers both practice and the race.", false);
});
