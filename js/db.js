// db.js — everything that touches Firebase, plus the class metrics.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, onValue, runTransaction,
  serverTimestamp, onDisconnect, remove,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig, MIN_RESPONSES_TO_SHOW } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Students sign in anonymously: no account, but a stable id so the rules can
// tell devices apart.
export function signIn() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (u) => { if (u) resolve(u); });
    signInAnonymously(auth).catch(reject);
  });
}

/* ---------- teacher accounts ---------- */

// Teachers sign in with email and password. Firebase keeps the session in
// browser storage, so a reload does not sign you out.
export const watchAuth = (cb) => onAuthStateChanged(auth, cb);
export const currentUser = () => auth.currentUser;
export const isTeacher = (u) => !!u && !u.isAnonymous && !!u.email;

export async function signInTeacher(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return cred.user;
  } catch (e) {
    throw new Error(authMessage(e.code));
  }
}

export const signOutTeacher = () => signOut(auth);

export async function resetTeacherPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    throw new Error(authMessage(e.code));
  }
}

// Newer projects have email enumeration protection on, which collapses
// "no such user" and "wrong password" into invalid-credential. Both are
// covered so the message is right either way.
function authMessage(code) {
  return {
    "auth/invalid-credential": "That email and password do not match an account.",
    "auth/wrong-password": "That email and password do not match an account.",
    "auth/user-not-found": "That email and password do not match an account.",
    "auth/invalid-email": "That does not look like an email address.",
    "auth/missing-password": "Enter your password.",
    "auth/user-disabled": "That account has been disabled in the Firebase console.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "No connection to Firebase. Check the network.",
    "auth/operation-not-allowed": "Email and password sign-in is not enabled in the Firebase console.",
    "auth/unauthorized-domain": "This domain is not in the Firebase authorized domains list.",
  }[code] || "Could not sign in. Please try again.";
}

const S = (code) => `sessions/${code}`;

// Ambiguous glyphs are left out so a code read off a projector is never
// mistyped: no O/0, I/1, S/5, Z/2.
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY3467689";
export function newCode(n = 5) {
  let out = "";
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */

export async function createSession(topic, uid) {
  let code;
  for (let tries = 0; tries < 8; tries++) {
    code = newCode();
    const snap = await get(ref(db, `${S(code)}/meta`));
    if (!snap.exists()) break;
    code = null;
  }
  if (!code) throw new Error("Could not allocate a session code. Try again.");

  const levels = topic.levels.map((l) => ({
    id: l.id, title: l.title || l.id,
    requiredCorrect: l.requiredCorrect || 1,
    count: l.questions.length,
    raceCount: l.raceCount || Math.min(2, l.questions.length),
  }));

  // Written as two separate nodes: security rules are declared per child, so a
  // single write to the parent path has no rule to authorise it.
  await set(ref(db, `${S(code)}/meta`), {
    title: topic.topic.title, course: topic.topic.course || "",
    phase: "practice", teacherUid: uid, createdAt: serverTimestamp(), levels,
  });
  await set(ref(db, `${S(code)}/topic`), topic);
  // Remembered so a reload, or a phone that locked mid-class, can rejoin
  // instead of stranding a live session with no console.
  await set(ref(db, `teachers/${uid}/activeSession`), code).catch(() => {});
  return code;
}

// Returns the teacher's still-live session, or null. Verified against
// meta.teacherUid so a stale code can never hand over someone else's room.
export async function getActiveSession(uid) {
  const snap = await get(ref(db, `teachers/${uid}/activeSession`));
  if (!snap.exists()) return null;
  const code = snap.val();
  const meta = await getSessionMeta(code);
  if (!meta || meta.teacherUid !== uid) {
    await remove(ref(db, `teachers/${uid}/activeSession`)).catch(() => {});
    return null;
  }
  return { code, meta };
}

export const forgetActiveSession = (uid) => remove(ref(db, `teachers/${uid}/activeSession`)).catch(() => {});

export async function getSessionMeta(code) {
  const snap = await get(ref(db, `${S(code)}/meta`));
  return snap.exists() ? snap.val() : null;
}

export async function getTopic(code) {
  const snap = await get(ref(db, `${S(code)}/topic`));
  return snap.exists() ? snap.val() : null;
}

export async function joinSession(code, uid, nick) {
  const path = `${S(code)}/students/${uid}`;
  await update(ref(db, path), { nick, level: 0, correct: 0, joinedAt: serverTimestamp() });
  // A name-free presence marker. The projector counts these, so it never needs
  // read access to the students branch.
  await set(ref(db, `${S(code)}/roster/${uid}`), true);
  onDisconnect(ref(db, `${S(code)}/helps/${uid}`)).remove();
  return path;
}

export const watchMeta = (code, cb) => onValue(ref(db, `${S(code)}/meta`), (s) => cb(s.val()));
export const watchStudents = (code, cb) => onValue(ref(db, `${S(code)}/students`), (s) => cb(s.val() || {}));
export const watchAgg = (code, cb) => onValue(ref(db, `${S(code)}/agg`), (s) => cb(s.val() || {}));
export const watchHelps = (code, cb) => onValue(ref(db, `${S(code)}/helps`), (s) => cb(s.val() || {}));
export const watchPing = (code, cb) => onValue(ref(db, `${S(code)}/ping`), (s) => cb(s.val()));
export const watchMe = (code, uid, cb) => onValue(ref(db, `${S(code)}/students/${uid}`), (s) => cb(s.val() || {}));
export const watchRace = (code, cb) => onValue(ref(db, `${S(code)}/race`), (s) => cb(s.val() || {}));
export const watchHeadcount = (code, cb) =>
  onValue(ref(db, `${S(code)}/roster`), (s) => cb(s.exists() ? Object.keys(s.val()).length : 0));

export const setPhase = (code, phase) => update(ref(db, `${S(code)}/meta`), { phase });
export const setMyLevel = (code, uid, level, correct) =>
  update(ref(db, `${S(code)}/students/${uid}`), { level, correct });

/* ------------------------------------------------------------------ */
/* Help button                                                         */
/* ------------------------------------------------------------------ */

export async function raiseHand(code, uid, nick, qid, levelId) {
  await set(ref(db, `${S(code)}/helps/${uid}`), { nick, qid, levelId, at: Date.now() });
  // A separate, name-free node so the projector can chime without ever
  // reading the students or helps branches.
  await runTransaction(ref(db, `${S(code)}/ping`), (cur) => ({ n: ((cur && cur.n) || 0) + 1, at: Date.now() }));
}
export const clearHand = (code, uid) => remove(ref(db, `${S(code)}/helps/${uid}`));

/* ------------------------------------------------------------------ */
/* Attempts and aggregation                                            */
/* ------------------------------------------------------------------ */

// Timing is stored as a histogram of ratios against the question's own
// expectedSeconds, so the node stays a fixed size no matter the class size.
const RATIO_EDGES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
function bucketFor(seconds, expected) {
  if (!expected) return null;
  const r = seconds / expected;
  for (let i = 0; i < RATIO_EDGES.length; i++) if (r < RATIO_EDGES[i]) return i;
  return RATIO_EDGES.length;
}

export async function recordAttempt(code, uid, { qid, levelId, correct, attemptNo, seconds, label, expectedSeconds }) {
  await update(ref(db, `${S(code)}/progress/${uid}/${qid}`), {
    ok: correct, attempts: attemptNo, seconds: Math.round(seconds), levelId, at: Date.now(),
  });

  await runTransaction(ref(db, `${S(code)}/agg/${qid}`), (cur) => {
    const a = cur || { n: 0, firstOk: 0, attempts: 0, correct: 0, tSum: 0, tN: 0, hist: {}, err: {} };
    a.attempts = (a.attempts || 0) + 1;
    if (attemptNo === 1) {
      a.n = (a.n || 0) + 1;                                  // distinct students
      if (correct) a.firstOk = (a.firstOk || 0) + 1;
    }
    if (correct) {
      a.correct = (a.correct || 0) + 1;
      a.tSum = (a.tSum || 0) + seconds;
      a.tN = (a.tN || 0) + 1;
      const b = bucketFor(seconds, expectedSeconds);
      if (b !== null) { a.hist = a.hist || {}; a.hist[b] = (a.hist[b] || 0) + 1; }
    } else if (label && label !== "incorrect" && label !== "empty") {
      a.err = a.err || {};
      a.err[label] = (a.err[label] || 0) + 1;
    }
    a.levelId = levelId;
    return a;
  });
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export function medianRatio(hist) {
  const counts = RATIO_EDGES.concat([Infinity]).map((_, i) => (hist && hist[i]) || 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    seen += counts[i];
    if (seen >= total / 2) {
      const lo = i === 0 ? 0 : RATIO_EDGES[i - 1];
      const hi = i < RATIO_EDGES.length ? RATIO_EDGES[i] : RATIO_EDGES[RATIO_EDGES.length - 1] * 1.5;
      return (lo + hi) / 2;
    }
  }
  return null;
}

// 0 = everyone got it first try at pace, 100 = the class is stuck.
export function struggleScore(a) {
  if (!a || !a.n) return null;
  const faa = (a.firstOk || 0) / a.n;
  const meanAttempts = (a.attempts || 0) / a.n;
  const mr = medianRatio(a.hist);

  const wrongPart = 40 * (1 - faa);
  const repeatPart = 30 * Math.min(1, Math.max(0, meanAttempts - 1) / 3);
  const timePart = mr === null ? 0 : 30 * Math.min(1, Math.max(0, mr - 1) / 2);
  const scale = mr === null ? 100 / 70 : 1;   // rescale when timing is unavailable
  return Math.round((wrongPart + repeatPart + timePart) * scale);
}

export function readyToShow(a) {
  return !!a && (a.n || 0) >= MIN_RESPONSES_TO_SHOW;
}

export function topError(a) {
  if (!a || !a.err) return null;
  const entries = Object.entries(a.err).sort((x, y) => y[1] - x[1]);
  if (!entries.length) return null;
  return { label: entries[0][0], count: entries[0][1] };
}

export const ERROR_NAMES = {
  "missing-unit": "left off units", "wrong-unit": "wrong units", sigfig: "significant figures",
  unbalanced: "not balanced", "not-lowest": "not lowest ratio", "wrong-species": "wrong products",
  "wrong-coefficients": "wrong coefficients", "wrong-charge": "wrong charge", "wrong-phase": "phase labels",
  unparsed: "unreadable formula", "no-arrow": "no arrow", "near-miss": "close wording",
  arrangement: "wrong arrangement", "not-a-number": "not a number", partial: "partly right",
  "too-few": "too few items", "zero-coefficient": "blank coefficient", "wrong-arrow": "wrong arrow",
};
export const errorName = (l) => ERROR_NAMES[l] || l.replace(/-/g, " ");

/* ------------------------------------------------------------------ */
/* Race                                                                */
/* ------------------------------------------------------------------ */

export async function startRace(code, qids) {
  await set(ref(db, `${S(code)}/race/meta`), { status: "running", qids, startedAt: Date.now() });
  await setPhase(code, "race");
}
export const submitRaceScore = (code, uid, nick, score, idx, done) =>
  set(ref(db, `${S(code)}/race/scores/${uid}`), { nick, score, idx, done, at: Date.now() });
export const endRace = (code) => update(ref(db, `${S(code)}/race/meta`), { status: "done" });

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export async function exportCsv(code) {
  const [studs, prog, aggr, meta] = await Promise.all([
    get(ref(db, `${S(code)}/students`)), get(ref(db, `${S(code)}/progress`)),
    get(ref(db, `${S(code)}/agg`)), get(ref(db, `${S(code)}/meta`)),
  ]);
  const students = studs.val() || {};
  const progress = prog.val() || {};
  const agg = aggr.val() || {};
  const m = meta.val() || {};

  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [];

  lines.push(q("Per-student attempts"));
  lines.push(["nickname", "level_reached", "question", "level", "correct", "attempts", "seconds"].map(q).join(","));
  for (const [uid, s] of Object.entries(students)) {
    const rows = progress[uid] || {};
    const lvl = (m.levels && m.levels[s.level] && m.levels[s.level].id) || s.level;
    if (!Object.keys(rows).length) lines.push([s.nick, lvl, "", "", "", "", ""].map(q).join(","));
    for (const [qid, r] of Object.entries(rows)) {
      lines.push([s.nick, lvl, qid, r.levelId, r.ok ? 1 : 0, r.attempts, r.seconds].map(q).join(","));
    }
  }

  lines.push("");
  lines.push(q("Per-question class metrics"));
  lines.push(["question", "level", "students", "first_try_correct", "first_try_pct", "mean_attempts", "median_time_ratio", "struggle", "top_error", "top_error_n"].map(q).join(","));
  for (const [qid, a] of Object.entries(agg)) {
    const te = topError(a);
    lines.push([
      qid, a.levelId || "", a.n || 0, a.firstOk || 0,
      a.n ? Math.round((100 * (a.firstOk || 0)) / a.n) : "",
      a.n ? ((a.attempts || 0) / a.n).toFixed(2) : "",
      (medianRatio(a.hist) ?? "").toString().slice(0, 4),
      struggleScore(a) ?? "", te ? errorName(te.label) : "", te ? te.count : "",
    ].map(q).join(","));
  }

  return lines.join("\n");
}

export function downloadCsv(text, filename) {
  const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  // iOS hands the blob to its own download flow and can still be reading it
  // well after the click, so the URL is kept alive far longer than a desktop
  // browser needs.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export { db, ref, set, get, update, onValue };
