// sandbox.js — an authoring bench for the grading rules. No Firebase import,
// so it needs no project setup, no session and no network. It does still need
// to be served over http: browsers block ES modules on file:// URLs.

import { grade, validateTopic } from "./grade.js";
import { renderChem, parseFormula, parseEquation, parseQuantity, normalize, repairCaseAll } from "./chem.js";
import { BUILTIN_TOPICS } from "./config.js";

const $ = (id) => document.getElementById(id);
let topic = null, flat = [], q = null;

/* ---------- loading ---------- */

BUILTIN_TOPICS.forEach((t) => {
  const o = document.createElement("option");
  o.value = t.file; o.textContent = t.label;
  $("builtin").appendChild(o);
});

$("loadBuiltin").addEventListener("click", async () => {
  try {
    const res = await fetch($("builtin").value, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not read ${$("builtin").value} (${res.status}). If you opened this page from a file:// URL, use Upload or Paste instead.`);
    load(await res.json());
  } catch (e) { report([e.message], []); }
});

$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { load(JSON.parse(await f.text())); }
  catch (err) { report([`${f.name} is not valid JSON: ${err.message}`], []); }
});

$("loadPaste").addEventListener("click", () => {
  try { load(JSON.parse($("paste").value)); }
  catch (err) { report([`That is not valid JSON: ${err.message}`], []); }
});

function load(data) {
  const v = validateTopic(data);
  report(v.errors, v.warnings);
  if (!v.ok) { $("workbench").classList.add("hidden"); return; }
  topic = data;
  flat = [];
  data.levels.forEach((l) => l.questions.forEach((qq) => flat.push({ level: l, q: qq })));
  $("qPick").innerHTML = flat.map((f, i) =>
    `<option value="${i}">${f.q.id} \u00b7 ${escapeHtml(stripMarkup(f.q.prompt)).slice(0, 66)}</option>`).join("");
  $("workbench").classList.remove("hidden");
  pick(0);
}

function report(errors, warnings) {
  const block = (title, items, cls) => items.length
    ? `<p class="small ${cls}" style="margin:12px 0 0"><strong>${title}</strong></p><ul class="problems ${cls}">${items.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
    : "";
  const host = $("valid");
  if (!errors.length && !warnings.length) {
    host.innerHTML = topic === null ? "" : '<p class="small" style="margin:12px 0 0; color:var(--cu)"><strong>File is valid.</strong></p>';
    return;
  }
  host.innerHTML = block(`${errors.length} problem${errors.length === 1 ? "" : "s"} to fix`, errors, "err")
    + block(`${warnings.length} thing${warnings.length === 1 ? "" : "s"} to check`, warnings, "muted");
}

/* ---------- question ---------- */

$("qPick").addEventListener("change", (e) => pick(Number(e.target.value)));

function pick(i) {
  q = flat[i].q;
  $("qPrompt").innerHTML = renderChem(q.prompt);
  $("qSpec").innerHTML = describe(q, flat[i].level);
  $("one").value = ""; $("onePreview").innerHTML = ""; $("oneVerdict").innerHTML = "";
  $("batch").value = ""; $("batchOut").innerHTML = ""; $("batchTally").textContent = "";
  fillVariants();
}

function describe(qq, level) {
  const a = qq.answer;
  const d = topic.topic.defaults || {};
  const bits = [`<strong class="mono">${a.type}</strong>`, `level <span class="mono">${level.id}</span>`];
  if (a.type === "numeric") {
    const tol = a.tolerance || d.tolerance || { type: "relative", value: 0.01 };
    bits.push(`answer <span class="mono">${a.value}${a.unit ? " " + a.unit : " (no unit)"}</span>`);
    bits.push(`${tol.type} tolerance ${tol.value}`);
    if (a.sigFigs) bits.push(`${a.sigFigs} sig figs, policy ${a.sigFigPolicy || d.sigFigPolicy || "warn"}`);
  } else if (a.type === "choice") {
    bits.push(`${a.options.length} options, correct: <span class="mono">${a.correct.map((i) => a.options[i]).join(", ")}</span>`);
  } else if (a.type === "balance") {
    bits.push(`coefficients <span class="mono">${a.correct.join(" / ")}</span>`);
  } else if (a.type === "text") {
    bits.push(`accepts <span class="mono">${a.accept.join(" | ")}</span>`);
    if (a.reject) bits.push(`rejects <span class="mono">${a.reject.join(" | ")}</span>`);
  } else if (a.type === "set") {
    bits.push(`items <span class="mono">${a.items.join(", ")}</span>`);
  } else if (a.type === "range") {
    bits.push(`between <span class="mono">${a.min}</span> and <span class="mono">${a.max}</span>`);
  } else {
    bits.push(`answer <span class="mono">${escapeHtml(a.value)}</span>`);
    if (a.match) bits.push(`match: ${a.match}`);
    if (a.accept && a.accept.length) bits.push(`also accepts <span class="mono">${a.accept.map(escapeHtml).join(" | ")}</span>`);
  }
  const ce = (qq.feedback && qq.feedback.commonErrors) || [];
  if (ce.length) bits.push(`${ce.length} declared common error${ce.length === 1 ? "" : "s"}`);
  if (qq.expectedSeconds) bits.push(`${qq.expectedSeconds}s expected`);
  return bits.join(" &nbsp;\u00b7&nbsp; ");
}

/* ---------- single answer ---------- */

$("one").addEventListener("input", () => {
  const raw = $("one").value;
  $("onePreview").innerHTML = previewOf(raw, q.answer.type);
  if (!raw.trim()) { $("oneVerdict").innerHTML = ""; return; }
  paint("oneVerdict", grade(q, coerce(raw, q), topic.topic.defaults || {}));
});

// Choice and balance answers arrive as arrays from the real UI; in the bench
// they are typed, so "2" or "4, 3, 2" is coerced into the same shape.
function coerce(raw, qq) {
  const t = qq.answer.type;
  if (t === "choice") return raw.split(/[\s,]+/).filter(Boolean).map(Number);
  if (t === "balance") return raw.split(/[\s,]+/).filter(Boolean);
  return raw;
}

function paint(hostId, r) {
  const cls = r.correct ? (r.label === "correct" ? "right" : "near") : "wrong";
  const head = r.correct ? (r.label === "correct" ? "Accepted" : "Accepted with a note") : "Rejected";
  $(hostId).innerHTML = `<div class="verdict ${cls}" style="margin-top:10px">
    <h3>${head} <span class="mono tiny muted" style="font-weight:400">${r.label}</span></h3>
    <p class="small" style="margin:0">${r.message ? renderChem(r.message) : "\u2014"}</p></div>`;
}

function previewOf(raw, type) {
  const s = raw.trim();
  if (!s) return "";
  try {
    if (type === "formula" || type === "set") {
      const p = parseFormula(s);
      if (p.ok) return `reads as <b>${renderChem(pretty(p))}</b>`;
      const valid = [...new Set(repairCaseAll(s.replace(/[\s^]/g, "")))].filter((r) => parseFormula(r).ok);
      if (valid.length === 1) return `<span style="color:var(--na)">check your capitals \u2014 did you mean ${valid[0]}?</span>`;
      if (valid.length > 1) return `<span style="color:var(--na)">ambiguous casing: reads as ${valid.slice(0, 3).join(" or ")}</span>`;
    } else if (type === "equation") {
      const p = parseEquation(s);
      if (p.ok) {
        const side = (arr) => arr.map((x) => (x.coef === 1 ? "" : x.coef + " ") + pretty(x.formula)).join(" + ");
        return `reads as <b>${renderChem(`${side(p.lhs)} ${p.arrow === "equilibrium" ? "<->" : "->"} ${side(p.rhs)}`)}</b>`;
      }
    } else if (type === "numeric" || type === "range") {
      const p = parseQuantity(s);
      if (p.ok) return `reads as <b>${p.value}${p.unit ? " " + renderChem(p.unit) : ""}</b>${p.sig ? ` <span class="tiny">(${p.sig} sig figs${p.ambiguousSig ? ", ambiguous" : ""})</span>` : ""}`;
    }
  } catch (_) { /* preview must never throw */ }
  return `<span class="tiny">normalized to <b>${escapeHtml(normalize(s))}</b></span>`;
}

function pretty(p) {
  let out = p.electron ? "e" : "";
  if (!p.electron) for (const [el, n] of p.seq) out += el + (n === 1 ? "" : "_" + n);
  if (p.charge) out += "^" + (Math.abs(p.charge) === 1 ? "" : Math.abs(p.charge)) + (p.charge > 0 ? "+" : "-");
  if (p.phase) out += `(${p.phase})`;
  return out;
}

/* ---------- batch ---------- */

$("runBatch").addEventListener("click", runBatch);
$("suggest").addEventListener("click", fillVariants);

function runBatch() {
  const lines = $("batch").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { $("batchOut").innerHTML = ""; $("batchTally").textContent = ""; return; }

  let acc = 0;
  const rows = lines.map((line) => {
    const r = grade(q, coerce(line, q), topic.topic.defaults || {});
    if (r.correct) acc++;
    const colour = r.correct ? (r.label === "correct" ? "var(--cu)" : "var(--na)") : "var(--sr)";
    return `<tr>
      <td class="mono">${escapeHtml(line)}</td>
      <td class="tiny muted">${previewOf(line, q.answer.type).replace(/^reads as /, "")}</td>
      <td style="color:${colour}"><strong>${r.correct ? "accept" : "reject"}</strong></td>
      <td class="mono tiny muted">${r.label}</td>
      <td class="tiny">${r.message ? renderChem(r.message) : ""}</td>
    </tr>`;
  }).join("");

  $("batchTally").textContent = `${acc} accepted, ${lines.length - acc} rejected`;
  $("batchOut").innerHTML = `<table class="tbl"><thead><tr>
      <th>input</th><th>reads as</th><th>verdict</th><th>label</th><th>message</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

// Seeds the batch box with the shapes students actually type: unicode
// subscripts, dropped units, alternate arrows, wrong casing.
function fillVariants() {
  if (!q) return;
  const a = q.answer;
  const out = [];
  const add = (v) => { if (v && !out.includes(v)) out.push(v); };
  const plain = (s) => String(s).replace(/_\{?(\d+)\}?/g, "$1").replace(/\^\{?([\d+-]+)\}?/g, "^$1");

  if (a.type === "numeric") {
    const v = a.value, u = a.unit || "";
    add(`${v} ${u}`.trim());
    add(String(v));
    add(`${v}${u}`);
    if (u === "g") add(`${v * 1000} mg`);
    if (u === "mol") add(`${(v * 1000).toPrecision(4)} mmol`);
    if (u === "K") add(`${(v - 273.15).toFixed(2)} degree C`);
    if (u === "\u00b0C" || u === "C") add(`${v} degrees celsius`);
    add(`${Number(v).toExponential(2).replace("e", " x 10^")} ${u}`.trim());
    add(`${(v * 1.5).toPrecision(3)} ${u}`.trim());
  } else if (a.type === "formula") {
    const p = plain(a.value);
    add(p); add(toUnicode(p)); add(p.toLowerCase()); add(p.replace("^", " "));
    (a.accept || []).forEach((x) => add(plain(x)));
  } else if (a.type === "equation") {
    const p = plain(a.value);
    add(p);
    add(toUnicode(p).replace(/->/g, "\u2192"));
    add(p.replace(/->/g, "="));
    add(p.replace(/\s+/g, " ").replace(/(\d) ([A-Z])/g, "$1$2"));
    const [l, r] = p.split("->");
    if (l && r) add(`${l.split("+").reverse().join("+").trim()} -> ${r.trim()}`);
  } else if (a.type === "balance") {
    add(a.correct.join(", "));
    add(a.correct.join(" "));
    add(a.correct.map((n) => n * 2).join(", "));
  } else if (a.type === "text") {
    (a.accept || []).forEach((x) => { add(x); add(x.toUpperCase()); });
    if (a.accept && a.accept[0] && a.accept[0].length > 5) {
      add(a.accept[0].slice(0, -1) + (a.accept[0].slice(-1) === "r" ? "er" : a.accept[0].slice(-1)));
    }
    (a.reject || []).forEach(add);
  } else if (a.type === "set") {
    const items = a.items.map(plain);
    add(items.join(", "));
    add(items.slice().reverse().join("; "));
    add(items.map(toUnicode).join(", "));
    add(items[0]);
  } else if (a.type === "choice") {
    a.options.forEach((_, i) => add(String(i)));
  } else if (a.type === "expression") {
    add(plain(a.value));
    add(plain(a.value).replace(/\^/g, ""));
    (a.accept || []).forEach((x) => add(plain(x)));
  } else if (a.type === "range") {
    add(String((a.min + a.max) / 2)); add(String(a.min)); add(String(a.max * 2));
  }

  ((q.feedback && q.feedback.commonErrors) || []).forEach((ce) => {
    const m = ce.match || {};
    if (m.value !== undefined) add(`${m.value}${m.unit ? " " + m.unit : ""}`);
  });

  $("batch").value = out.join("\n");
  runBatch();
}

const SUBS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089";
const SUPS = { 0: "\u2070", 1: "\u00b9", 2: "\u00b2", 3: "\u00b3", 4: "\u2074", 5: "\u2075", 6: "\u2076", 7: "\u2077", 8: "\u2078", 9: "\u2079", "+": "\u207a", "-": "\u207b" };

function toUnicode(s) {
  return String(s)
    .replace(/\^([\d]*)([+-])/g, (_, d, sg) => [...d].map((c) => SUPS[c]).join("") + SUPS[sg])
    .replace(/([A-Za-z\)])(\d+)/g, (_, a, d) => a + [...d].map((c) => SUBS[+c]).join(""));
}

const stripMarkup = (s) => String(s).replace(/[_^]\{?([\w+-]+)\}?/g, "$1").replace(/\*\*/g, "");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
