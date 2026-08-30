// grade.js — one comparator per answer type. Every result is
// { correct, message, label, detail } so the UI never has to guess.

import {
  normalize, normText, editDistance, parseFormula, parseEquation, parseQuantity,
  atomBalance, gcdAll, hill, seqKey, sameCounts, convert, canonUnit, roundSig, formulaCandidates,
} from "./chem.js";

const MSG = {
  missingUnit: "Add the units to your answer.",
  wrongUnit: "That unit does not match what the question asks for.",
  incomparableUnit: "Those units measure a different quantity. Check what you calculated.",
  sigfig: "Correct value. Check your significant figures.",
  unbalanced: "Your equation is not balanced.",
  notLowest: "Balanced, but the coefficients are not in the lowest whole-number ratio.",
  rightSpecies: "Your reactants and products are right. The coefficients are not.",
  wrongCharge: "Right formula, wrong charge.",
  wrongPhase: "Right formula, check your phase labels.",
  unparsed: "That did not read as a chemical formula. Check your symbols and parentheses.",
  noArrow: "Include an arrow, for example: A + B -> C",
  empty: "Enter an answer.",
};

function ok(extra = {}) { return { correct: true, message: "", label: "correct", ...extra }; }
function no(message, label = "incorrect", extra = {}) { return { correct: false, message, label, ...extra }; }

/* ------------------------------------------------------------------ */

export function grade(question, raw, defaults = {}) {
  const spec = question.answer || {};
  const d = { ...defaults, ...spec };
  const input = String(raw ?? "").trim();
  if (!input && spec.type !== "choice" && spec.type !== "balance") return no(MSG.empty, "empty");

  let result;
  switch (spec.type) {
    case "choice": result = gradeChoice(spec, raw); break;
    case "numeric": result = gradeNumeric(spec, input, d); break;
    case "range": result = gradeRange(spec, input, d); break;
    case "formula": result = gradeFormula(spec, input, d); break;
    case "balance": result = gradeBalance(spec, raw); break;
    case "equation": result = gradeEquation(spec, input, d); break;
    case "text": result = gradeText(spec, input); break;
    case "expression": result = gradeExpression(spec, input); break;
    case "set": result = gradeSet(spec, input, d); break;
    default: result = no("This question is misconfigured: unknown answer type.", "config-error");
  }

  // A declared common error overrides the generic message, and its label is
  // what the display screen rolls up into the error breakdown.
  if (!result.correct) {
    const hit = matchCommonError(question, raw, d);
    if (hit) return { ...result, message: hit.message, label: hit.label || "common-error" };
  }
  return result;
}

function matchCommonError(question, raw, defaults) {
  const list = question.feedback && question.feedback.commonErrors;
  if (!Array.isArray(list)) return null;
  for (const ce of list) {
    try {
      const r = grade({ answer: ce.match }, raw, defaults);
      if (r.correct) return ce;
    } catch (_) { /* a malformed distractor must never break grading */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */

function gradeChoice(spec, raw) {
  const picked = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && v !== "").map(Number).sort();
  const want = (spec.correct || []).slice().map(Number).sort();
  if (!picked.length) return no(MSG.empty, "empty");
  if (picked.length !== want.length) {
    return no(spec.multiSelect ? `Select exactly ${want.length}.` : "", "incorrect");
  }
  return picked.every((v, i) => v === want[i]) ? ok() : no("");
}

function gradeNumeric(spec, input, d) {
  const q = parseQuantity(input);
  if (!q.ok) return no("That did not read as a number.", "not-a-number");

  const wantUnit = spec.unit === undefined ? "" : spec.unit;
  const unitsRequired = spec.unitsRequired !== undefined ? spec.unitsRequired
    : (d.unitsRequired !== undefined ? d.unitsRequired : true);

  let value = q.value;
  const aliases = (spec.unitAliases || []).map((u) => canonUnit(u));
  const studentUnit = q.unit;
  const targetUnit = wantUnit ? canonUnit(wantUnit) : "";

  if (targetUnit) {
    if (!studentUnit) {
      if (unitsRequired) return no(MSG.missingUnit, "missing-unit");
    } else if (studentUnit !== targetUnit && !aliases.includes(studentUnit)) {
      const allowConvert = spec.unitConversion !== undefined ? spec.unitConversion
        : (d.unitConversion !== undefined ? d.unitConversion : true);
      const converted = allowConvert ? convert(q.value, studentUnit, targetUnit) : null;
      if (converted === null || converted === undefined) {
        return no(MSG.incomparableUnit, "wrong-unit");
      }
      value = converted;
    }
  }

  const tol = spec.tolerance || d.tolerance || { type: "relative", value: 0.01 };
  const target = Number(spec.value);
  if (!withinTolerance(value, target, tol, spec.sigFigs)) return no("", "incorrect");

  const policy = spec.sigFigPolicy || d.sigFigPolicy || "warn";
  if (spec.sigFigs && policy !== "ignore" && !q.ambiguousSig && q.sig !== spec.sigFigs) {
    if (policy === "enforce") return no(MSG.sigfig, "sigfig");
    return ok({ message: MSG.sigfig, label: "correct-sigfig-warning" });
  }
  return ok();
}

function withinTolerance(x, target, tol, sig) {
  const t = tol.type || "relative";
  const v = Number(tol.value);
  if (t === "absolute") return Math.abs(x - target) <= v;
  if (t === "percent") return Math.abs(x - target) <= Math.abs(target) * (v / 100);
  if (t === "sigfig") return roundSig(x, sig || 3) === roundSig(target, sig || 3);
  if (target === 0) return Math.abs(x) <= (v || 1e-9);
  return Math.abs(x - target) <= Math.abs(target) * v;
}

function gradeRange(spec, input) {
  const q = parseQuantity(input);
  if (!q.ok) return no("That did not read as a number.", "not-a-number");
  return q.value >= Number(spec.min) && q.value <= Number(spec.max) ? ok() : no("");
}

function gradeFormula(spec, input, d) {
  const mode = spec.match || "structural";
  const auto = (spec.autoCapitalize || d.autoCapitalize) === "on";
  const reads = formulaCandidates(input, { autoCapitalize: auto });
  if (!reads.length) return no(MSG.unparsed, "unparsed");

  const targets = [spec.value, ...(spec.accept || [])].filter(Boolean)
    .map((v) => parseFormula(v)).filter((p) => p.ok);
  if (!targets.length) return no("This question is misconfigured: the stored formula does not parse.", "config-error");

  let chargeMiss = false;
  let phaseMiss = false;

  for (const got of reads) {
    for (const want of targets) {
      if (!formulaMatch(got, want, mode)) continue;
      const wantCharge = spec.charge !== undefined ? Number(spec.charge) : want.charge;
      if (got.charge !== wantCharge) { chargeMiss = true; continue; }
      const wantPhase = spec.phase || want.phase;
      if (spec.requirePhase && wantPhase && got.phase !== wantPhase) { phaseMiss = true; continue; }
      return ok();
    }
  }

  if (chargeMiss) return no(MSG.wrongCharge, "wrong-charge");
  if (phaseMiss) return no(MSG.wrongPhase, "wrong-phase");

  const want0 = targets[0];
  if (reads.some((g) => sameCounts(g.counts, want0.counts) && g.charge === want0.charge)) {
    return no("Right composition, but not the formula this question is asking for.", "arrangement");
  }
  return no("");
}

function formulaMatch(a, b, mode) {
  // composition  — element counts only; isomers collapse together
  // structural   — written order of element runs must agree
  // exact        — order and composition must both agree
  if (mode === "composition") return sameCounts(a.counts, b.counts);
  if (mode === "exact") return seqKey(a.seq) === seqKey(b.seq) && sameCounts(a.counts, b.counts);
  return seqKey(a.seq) === seqKey(b.seq);
}

function gradeBalance(spec, raw) {
  const got = (Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/))
    .map((v) => String(v).trim()).filter((v) => v !== "");
  const want = (spec.correct || []).map(Number);
  if (got.length !== want.length || got.some((v) => !/^\d+$/.test(v))) {
    return no(`Enter a whole number in each of the ${want.length} boxes.`, "incomplete");
  }
  const nums = got.map(Number);
  if (nums.some((n) => n === 0)) return no("A coefficient of 1 must be typed as 1.", "zero-coefficient");
  if (nums.every((n, i) => n === want[i])) return ok();

  const ratio = nums[0] / want[0];
  const proportional = ratio > 0 && nums.every((n, i) => Math.abs(n - want[i] * ratio) < 1e-9);
  if (proportional) {
    if (spec.requireLowest === false) return ok();
    return no(MSG.notLowest, "not-lowest");
  }
  return no(MSG.unbalanced, "unbalanced");
}

function gradeEquation(spec, input, d) {
  const auto = (spec.autoCapitalize || d.autoCapitalize) === "on";
  const got = parseEquation(input, { autoCapitalize: auto });
  if (!got.ok) {
    if (got.error === "no-arrow") return no(MSG.noArrow, "no-arrow");
    if (got.error === "bad-species") return no(`"${got.species}" did not read as a formula.`, "unparsed");
    return no(MSG.unparsed, "unparsed");
  }
  const want = parseEquation(spec.value);
  if (!want.ok) return no("This question is misconfigured: the stored equation does not parse.", "config-error");

  const arrowWanted = spec.arrow || "any";
  if (arrowWanted !== "any" && got.arrow !== arrowWanted) {
    return no(arrowWanted === "equilibrium" ? "Use an equilibrium arrow (<->)." : "Use a single forward arrow (->).", "wrong-arrow");
  }

  const key = (sp) => hill(sp.formula.counts, sp.formula.charge) + (spec.requirePhases ? "|" + (sp.formula.phase || "") : "");
  const bag = (side) => {
    const m = new Map();
    for (const sp of side) m.set(key(sp), (m.get(key(sp)) || 0) + sp.coef);
    return m;
  };

  const [gL, gR, wL, wR] = [bag(got.lhs), bag(got.rhs), bag(want.lhs), bag(want.rhs)];
  const sameSpecies = (a, b) => a.size === b.size && [...a.keys()].every((k) => b.has(k));

  if (!sameSpecies(gL, wL) || !sameSpecies(gR, wR)) {
    if (spec.requirePhases) {
      const strip = (m) => new Set([...m.keys()].map((k) => k.split("|")[0]));
      const sL = strip(gL); const sR = strip(gR);
      const tL = strip(wL); const tR = strip(wR);
      const eq = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));
      if (eq(sL, tL) && eq(sR, tR)) return no(MSG.wrongPhase, "wrong-phase");
    }
    return no("Check your reactants and products.", "wrong-species");
  }

  const gv = [...wL.keys()].map((k) => gL.get(k)).concat([...wR.keys()].map((k) => gR.get(k)));
  const wv = [...wL.values()].concat([...wR.values()]);
  const exact = gv.every((v, i) => v === wv[i]);

  if (!exact) {
    const r = gv[0] / wv[0];
    const proportional = r > 0 && gv.every((v, i) => Math.abs(v - wv[i] * r) < 1e-9);
    if (proportional && spec.requireLowest === false) return ok();
    if (proportional) {
      const g = gcdAll(gv);
      if (g > 1) return no(MSG.notLowest, "not-lowest");
    }
    const bal = atomBalance(got);
    if (spec.requireBalanced !== false && !bal.balanced) {
      const which = bal.offenders.length ? ` Check ${bal.offenders.join(", ")}.` : "";
      return no(MSG.unbalanced + which, "unbalanced");
    }
    return no(MSG.rightSpecies, "wrong-coefficients");
  }

  if (spec.requireBalanced !== false) {
    const bal = atomBalance(got);
    if (!bal.balanced) return no(MSG.unbalanced, "unbalanced");
  }
  return ok();
}

function gradeText(spec, input) {
  const opts = spec.normalize || {};
  const got = normText(input, opts);
  if (!got) return no(MSG.empty, "empty");

  for (const r of spec.reject || []) {
    if (normText(r, opts) === got) return no("Close. Be more specific.", "near-miss");
  }
  const accepts = (spec.accept || []).map((a) => normText(a, opts));
  if (accepts.includes(got)) return ok();

  const maxEdits = spec.fuzzy && spec.fuzzy.maxEdits ? spec.fuzzy.maxEdits : 0;
  if (maxEdits > 0) {
    for (const a of accepts) {
      if (a.length < 5) continue; // never fuzzy-match short answers
      if (editDistance(got, a) <= maxEdits) return ok({ message: "Counted as correct. Watch the spelling." });
    }
  }
  return no("");
}

function gradeExpression(spec, input) {
  // Carets are dropped so "4s2" and "4s^2" are the same token; students should
  // not be penalised for skipping the superscript key.
  const clean = (s) => normalize(s).replace(/[\^{}]/g, "").toLowerCase()
    .replace(/\[([a-z]+)\]/g, (_, g) => "[" + g.charAt(0).toUpperCase() + g.slice(1) + "]");
  const tokens = (s) => clean(s).split(/[\s,]+/).filter(Boolean);
  const candidates = [spec.value, ...(spec.accept || [])];
  const gotT = tokens(input);
  for (const c of candidates) {
    const wantT = tokens(c);
    if (spec.mode === "sequence") {
      if (gotT.length === wantT.length && gotT.every((t, i) => t === wantT[i])) return ok();
    } else {
      const a = gotT.slice().sort().join("|");
      const b = wantT.slice().sort().join("|");
      if (a === b) return ok();
    }
  }
  return no("");
}

function gradeSet(spec, input, d) {
  const pieces = String(input).split(/[,;\n]+|\s\+\s/).map((s) => s.trim()).filter(Boolean);
  const want = spec.items || [];
  const itemType = spec.itemType || "text";

  const matches = (a, b) => {
    if (itemType === "formula") {
      const A = parseFormula(a, { autoCapitalize: (spec.autoCapitalize || d.autoCapitalize) === "on" });
      const B = parseFormula(b);
      return A.ok && B.ok && sameCounts(A.counts, B.counts) && A.charge === B.charge;
    }
    if (itemType === "numeric") {
      const A = parseQuantity(a); const B = parseQuantity(b);
      return A.ok && B.ok && Math.abs(A.value - B.value) <= Math.abs(B.value) * 0.01;
    }
    return normText(a) === normText(b);
  };

  const remaining = want.slice();
  let hits = 0;
  for (const p of pieces) {
    const idx = remaining.findIndex((w) => matches(p, w));
    if (idx >= 0) { hits++; remaining.splice(idx, 1); }
  }
  const wrong = pieces.length - hits;

  if (spec.ordered) {
    const inOrder = pieces.length === want.length && pieces.every((p, i) => matches(p, want[i]));
    return inOrder ? ok() : no(hits === want.length ? "All correct, but the order matters here." : "", "order");
  }
  if (hits === want.length && wrong === 0) return ok();
  if (spec.partialCredit) {
    const score = Math.max(0, (hits - wrong) / want.length);
    if (score > 0 && score < 1) {
      return no(`You have ${hits} of ${want.length}.`, "partial", { partial: score });
    }
  }
  if (pieces.length < want.length) return no(`This question expects ${want.length} items.`, "too-few");
  return no("");
}

/* ------------------------------------------------------------------ */
/* Topic validation — run before a file is ever loaded into a session. */
/* ------------------------------------------------------------------ */

const TYPES = new Set(["choice", "numeric", "range", "formula", "balance", "equation", "text", "expression", "set"]);

export function validateTopic(topic) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!topic || typeof topic !== "object") return { ok: false, errors: ["File is not a JSON object."], warnings };
  if (!topic.topic || !topic.topic.title) E("topic.title is required.");
  if (!Array.isArray(topic.levels) || !topic.levels.length) E("levels must be a non-empty array.");
  if (errors.length) return { ok: false, errors, warnings };

  const seen = new Set();
  topic.levels.forEach((lv, li) => {
    const where = `level ${li + 1} (${lv.id || "no id"})`;
    if (!lv.id) E(`${where}: missing id.`);
    if (!Array.isArray(lv.questions) || !lv.questions.length) { E(`${where}: no questions.`); return; }
    const need = Number(lv.requiredCorrect || 0);
    if (!need) E(`${where}: requiredCorrect must be at least 1.`);
    if (need > lv.questions.length) E(`${where}: requiredCorrect (${need}) exceeds its ${lv.questions.length} questions.`);
    else if (need + 3 > lv.questions.length) W(`${where}: only ${lv.questions.length} questions for a target of ${need}. Add a few so random draws differ between students.`);
    if (lv.raceCount && lv.raceCount > lv.questions.length) E(`${where}: raceCount exceeds the question count.`);

    lv.questions.forEach((q, qi) => {
      const at = `${where} Q${qi + 1} (${q.id || "no id"})`;
      if (!q.id) E(`${at}: missing id.`);
      else if (seen.has(q.id)) E(`${at}: duplicate id "${q.id}". Ids must be unique across the whole file.`);
      else seen.add(q.id);
      if (!q.prompt) E(`${at}: missing prompt.`);
      const a = q.answer;
      if (!a || !TYPES.has(a.type)) { E(`${at}: answer.type must be one of ${[...TYPES].join(", ")}.`); return; }
      if (!q.expectedSeconds) W(`${at}: no expectedSeconds, so it is excluded from the timing metric.`);

      if (a.type === "choice") {
        if (!Array.isArray(a.options) || a.options.length < 2) E(`${at}: needs at least 2 options.`);
        if (!Array.isArray(a.correct) || !a.correct.length) E(`${at}: needs a correct index array.`);
        else if (a.correct.some((i) => i < 0 || i >= (a.options || []).length)) E(`${at}: a correct index is out of range.`);
        else if (!a.multiSelect && a.correct.length > 1) E(`${at}: multiple correct indices need multiSelect: true.`);
      }
      if (a.type === "numeric") {
        if (typeof a.value !== "number") E(`${at}: numeric answers need a numeric value.`);
        if (a.unit === undefined) W(`${at}: no unit. Write "unit": "" if the answer is genuinely unitless.`);
        const tol = a.tolerance || (topic.topic.defaults || {}).tolerance;
        if (a.value === 0 && tol && (tol.type === "relative" || tol.type === "percent")) {
          E(`${at}: relative tolerance cannot work on an answer of zero. Use "absolute".`);
        }
      }
      if (a.type === "range" && !(Number(a.min) < Number(a.max))) E(`${at}: range needs min < max.`);
      if (a.type === "formula" || a.type === "equation") {
        const p = a.type === "formula" ? parseFormula(a.value) : parseEquation(a.value);
        if (!p.ok) E(`${at}: the stored answer "${a.value}" does not parse (${p.error}).`);
        else if (a.type === "equation" && a.requireBalanced !== false && !atomBalance(p).balanced) {
          E(`${at}: the stored equation is not balanced.`);
        }
      }
      if (a.type === "balance") {
        const slots = (String(a.skeleton || "").match(/__/g) || []).length;
        if (!slots) E(`${at}: skeleton needs __ placeholders.`);
        else if (!Array.isArray(a.correct) || a.correct.length !== slots) E(`${at}: ${slots} placeholders but ${(a.correct || []).length} coefficients.`);
      }
      if (a.type === "text" && !(a.accept || []).length) E(`${at}: text answers need an accept list.`);
      if (a.type === "set" && !(a.items || []).length) E(`${at}: set answers need an items list.`);

      (q.feedback && q.feedback.commonErrors || []).forEach((ce, ci) => {
        if (!ce.match || !ce.message) E(`${at}: commonErrors[${ci}] needs both match and message.`);
        if (!ce.label) W(`${at}: commonErrors[${ci}] has no label, so it will not appear in the class error breakdown.`);
      });
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}
