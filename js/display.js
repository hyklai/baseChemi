// display.js — projector view. Reads only anonymous aggregate nodes: meta,
// topic, agg, ping, and (during a race) the leaderboard. It never reads the
// students, helps, or progress branches, so no individual can surface here.

import {
  getSessionMeta, getTopic, watchMeta, watchAgg, watchPing, watchRace, watchHeadcount,
  struggleScore, readyToShow, topError, errorName,
} from "./db.js";
import { MIN_RESPONSES_TO_SHOW } from "./config.js";

const $ = (id) => document.getElementById(id);
let code, topic, agg = {}, headcount = 0, phase = "practice", lastRace = null;

/* ---------- start ---------- */

const params = new URLSearchParams(location.search);
if (params.get("code")) $("gateCode").value = params.get("code").toUpperCase();
$("gateCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("gateCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("gateGo").click(); });

$("gateGo").addEventListener("click", async () => {
  const c = $("gateCode").value.trim().toUpperCase();
  if (c.length < 4) return ($("gateErr").textContent = "Enter the session code.");
  $("gateGo").disabled = true;
  try {
    const meta = await getSessionMeta(c);
    if (!meta) throw new Error("No session with that code.");
    topic = await getTopic(c);
    code = c;
    unlockAudio();
    $("gate").remove();
    boot(meta);
  } catch (e) {
    $("gateErr").textContent = e.message || "Could not load that session.";
    $("gateGo").disabled = false;
  }
});

function boot(meta) {
  $("dTitle").textContent = meta.title || "";
  $("dCourse").textContent = meta.course || "";
  $("dCode").textContent = code;
  phase = meta.phase || "practice";

  watchMeta(code, (m) => {
    if (!m || m.phase === phase) return;
    phase = m.phase;
    // Repaint straight away rather than waiting for the first race submission.
    if (phase === "race") onRace(lastRace); else render();
  });
  watchAgg(code, (a) => { agg = a; render(); });
  watchPing(code, onPing);
  watchRace(code, onRace);

  // Headcount only, read from the name-free roster node.
  watchHeadcount(code, (n) => { headcount = n; $("dCount").textContent = n; });

  render();
}

/* ---------- help chime ---------- */

let audioCtx = null, lastPing = null;

function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    // iOS does not consider the context unlocked until a buffer has actually
    // played inside the user gesture, so a silent one-frame buffer is fired
    // here. resume() alone is not enough on iPhone or iPad.
    const src = audioCtx.createBufferSource();
    src.buffer = audioCtx.createBuffer(1, 1, 22050);
    src.connect(audioCtx.destination);
    src.start(0);
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (_) { audioCtx = null; }
}

// Some browsers re-suspend an idle context; any later click re-arms it.
document.addEventListener("click", () => {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
});

// A two-note bell, synthesized so there is no audio file to host.
function chime() {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  const now = audioCtx.currentTime;
  [880, 1174.7].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.16);
    gain.gain.linearRampToValueAtTime(0.28, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.9);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 1);
  });
}

function onPing(p) {
  if (!p) return;
  if (lastPing === null) { lastPing = p.n; return; }   // don't chime on first load
  if (p.n > lastPing) {
    chime();
    $("hand").classList.add("up");
    clearTimeout(onPing.t);
    onPing.t = setTimeout(() => $("hand").classList.remove("up"), 6000);
  }
  lastPing = p.n;
}

/* ---------- render ---------- */

function render() {
  if (!topic) return;
  if (phase === "race") return;   // the race board owns the screen
  $("dBody").innerHTML = topic.levels.map(renderLevel).join("");
  renderSticking();
}

function renderLevel(level) {
  const qs = level.questions;
  const seen = qs.map((q) => agg[q.id]).filter((a) => readyToShow(a));
  const totalAttempts = qs.reduce((s, q) => s + ((agg[q.id] && agg[q.id].attempts) || 0), 0);

  // Level meter: share of this level's questions the class has solved on
  // aggregate, not any one student's position.
  const solved = qs.reduce((s, q) => s + ((agg[q.id] && agg[q.id].correct) || 0), 0);
  const tries = qs.reduce((s, q) => s + ((agg[q.id] && agg[q.id].attempts) || 0), 0);
  const pct = tries ? Math.round((solved / tries) * 100) : 0;

  const bands = qs.map((q) => {
    const a = agg[q.id];
    if (!readyToShow(a)) {
      return `<div class="band pending" style="flex-grow:1" title="${q.id}"></div>`;
    }
    const s = struggleScore(a);
    const grow = 1 + 3 * ((a.attempts || 0) / Math.max(1, totalAttempts));
    return `<div class="band" style="flex-grow:${grow.toFixed(2)}; background:${colorFor(s)}" title="${q.id}"><em>${s}</em></div>`;
  }).join("");

  return `
    <section class="dlevel-block">
      <div class="dlevel">
        <div class="name">${escapeHtml(level.title || level.id)}
          <span>${seen.length} of ${qs.length} questions reporting</span>
        </div>
        <div>
          <div class="dmeter"><i style="width:${pct}%"></i><b>${pct}% of attempts correct</b></div>
        </div>
      </div>
      <div class="spectrum">${bands}</div>
    </section>`;
}

function renderSticking() {
  const rows = Object.entries(agg)
    .filter(([, a]) => readyToShow(a))
    .map(([qid, a]) => ({ qid, s: struggleScore(a), a }))
    .sort((x, y) => y.s - x.s);

  if (!rows.length) {
    $("dStick").innerHTML = `<small>a question appears once ${MIN_RESPONSES_TO_SHOW} students have tried it</small>`;
    return;
  }
  const top = rows[0];
  const te = topError(top.a);
  const pct = Math.round((100 * (top.a.firstOk || 0)) / top.a.n);
  $("dStick").innerHTML = te
    ? `${escapeHtml(top.qid)} <small>&mdash; ${escapeHtml(errorName(te.label))}, ${pct}% first try</small>`
    : `${escapeHtml(top.qid)} <small>&mdash; ${pct}% first try</small>`;
}

// Flame test colours: copper green through sodium yellow to strontium red.
function colorFor(s) {
  const stops = [[0, [33, 184, 132]], [50, [238, 174, 53]], [100, [221, 59, 76]]];
  const clamped = Math.max(0, Math.min(100, s));
  const i = clamped <= 50 ? 0 : 1;
  const [x0, c0] = stops[i];
  const [x1, c1] = stops[i + 1];
  const t = (clamped - x0) / (x1 - x0);
  const mix = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
  return `rgb(${mix.join(",")})`;
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- race ---------- */

function onRace(r) {
  if (r && r.meta) lastRace = r;
  if (phase !== "race" || !lastRace) return;
  r = lastRace;
  const scores = Object.values(r.scores || {});
  scores.sort((a, b) => b.score - a.score || a.at - b.at);
  const total = (r.meta.qids || []).length;

  $("dBody").innerHTML = `
    <p class="eyebrow" style="color:var(--chalk-2)">Race &middot; ${total} questions</p>
    <div class="board">
      ${scores.slice(0, 10).map((s, i) => `
        <div class="boardrow">
          <span class="rank">${String(i + 1).padStart(2, "0")}</span>
          <span>${escapeHtml(s.nick)}${s.done ? "" : ` <small style="color:var(--chalk-2)">${s.idx}/${total}</small>`}</span>
          <span class="pts">${s.score}</span>
        </div>`).join("") || '<p style="color:var(--chalk-2)">Waiting for the first answer\u2026</p>'}
    </div>`;

  const done = scores.filter((s) => s.done).length;
  $("dStick").innerHTML = `${done} finished <small>of ${scores.length} racing</small>`;
}
