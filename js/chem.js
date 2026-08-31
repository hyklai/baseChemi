// chem.js — normalization, parsing, units, significant figures.
// No dependencies. Safe to import from any screen.

export const ELEMENTS = ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni " +
  "Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm " +
  "Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu " +
  "Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og").split(" ");

const ELEMENT_SET = new Set(ELEMENTS);
const ELEMENT_BY_LOWER = new Map(ELEMENTS.map((e) => [e.toLowerCase(), e]));

const SUB = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", "₍": "(", "₎": ")" };
const SUP = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")" };

const SUB_RE = /[₀₁₂₃₄₅₆₇₈₉₊₋₍₎]+/g;
const SUP_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+/g;

/* ------------------------------------------------------------------ */
/* 1. Normalization                                                    */
/* ------------------------------------------------------------------ */

// Turns whatever a student typed into a canonical ASCII form.
// Subscripts become bare digits (H₂O -> H2O); superscripts become ^-prefixed
// groups (SO₄²⁻ -> SO4^2-) so charge survives the round trip.
export function normalize(input) {
  if (input == null) return "";
  let s = String(input);

  // Sub/superscript runs must be read BEFORE NFKC, because NFKC flattens both
  // to plain digits and the distinction between H₂O and SO₄²⁻ would be lost.
  s = s.replace(SUB_RE, (run) => [...run].map((c) => SUB[c] || c).join(""));
  s = s.replace(SUP_RE, (run) => "^" + [...run].map((c) => SUP[c] || c).join(""));

  try { s = s.normalize("NFKC"); } catch (_) { /* older engines */ }

  // Quotes and dashes.
  s = s.replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[\u2010-\u2015\u2212]/g, "-");

  // Braces used for grouping: SO4^{2-} -> SO4^2-
  s = s.replace(/\^\{([^}]*)\}/g, "^$1");
  // Authoring markup for subscripts: H_2O and Ca(OH)_2 read as typed. The
  // "__" placeholders in a balance skeleton are left alone.
  s = s.replace(/_\{(\d+)\}/g, "$1").replace(/(^|[^_])_(?=\d)/g, "$1");

  // Arrows. Equilibrium is parked on a placeholder first, otherwise the yields
  // rule matches the "->" sitting inside "<->" and splits it apart.
  s = s.replace(/<\s*-+\s*>|<\s*=+\s*>|\u21CC|\u21C4|\u21C6|\u2194/g, "\u0001");
  s = s.replace(/-+\s*>|=+\s*>|\u2192|\u27F6|\u21FE/g, "\u0002");
  s = s.replace(/\b(?:yields|gives|produces|forms)\b/gi, "\u0002");
  s = s.replace(/\u0001/g, " <-> ").replace(/\u0002/g, " -> ");

  // Hydrate dot. "*" and the raised dots are unambiguous; a period is only a
  // dot when a formula block follows it, never when it is a decimal point
  // ("0.125 mol" and "2.5 M" are both left alone).
  s = s.replace(/[\u00B7\u2022\u2219\u22C5]/g, "\u00B7");
  s = s.replace(/([A-Za-z0-9\)])\s*\*\s*(\d*\s*[A-Z])/g, "$1\u00B7$2");
  s = s.replace(/([A-Za-z0-9\)])\s*\.\s*(\d*[A-Z][a-z]?\d*)/g, "$1\u00B7$2");

  // Scientific notation, in all the shapes a phone keyboard encourages.
  s = s.replace(/(\d)\s*[xX\u00D7\u2217*]\s*10\s*\^?\s*([+-]?\d+)/g, "$1e$2");
  s = s.replace(/(\d)\s*[eE]\s*([+-]?\d+)(?![\w])/g, "$1e$2");

  // Thousands separators (only in the 1,234,567 shape).
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

  // Degrees. "degree C", "degrees celsius", "degC", "oC" all land on °C.
  s = s.replace(/(?:\u00B0|deg(?:ree)?s?\.?)\s*(?:c\b|celsius\b|centigrade\b)/gi, "\u00B0C");
  s = s.replace(/(?:\u00B0|deg(?:ree)?s?\.?)\s*(?:f\b|fahrenheit\b)/gi, "\u00B0F");
  s = s.replace(/\bdeg(?:ree)?s?\.?\s*(?:k\b|kelvin\b)/gi, "K");
  s = s.replace(/\b[o0](?=C\b)/g, "\u00B0");
  s = s.replace(/\bcelsius\b/gi, "\u00B0C");
  s = s.replace(/\bkelvins?\b/gi, "K");

  // Micro prefix. Only rewrite a bare "u" when it is glued to a unit.
  s = s.replace(/[\u00B5\u03BC]/g, "\u03BC");
  s = s.replace(/\bmicro(?=[a-zA-Z])/g, "\u03BC");
  s = s.replace(/\bu(?=(?:g|L|l|m|mol|M|s|A)\b)/g, "\u03BC");

  // Collapse whitespace.
  return s.replace(/\s+/g, " ").trim();
}

// Render "H_2O" / "SO_4^2-" markup as HTML. Used for prompts and previews.
export function renderChem(text) {
  if (text == null) return "";
  const esc = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_\{([^}]*)\}/g, "<sub>$1</sub>")
    .replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>")
    // Chemical subscripts are always numeric. Allowing letters here made
    // "Na_2SO_4" capture "2SO" and subscript the rest of the formula.
    .replace(/_(\d+)/g, "<sub>$1</sub>")
    // Superscripts are a signed number (charges, exponents, mol^-1) or a bare
    // sign. Anything else needs explicit ^{...} braces.
    .replace(/\^([+-]?\d+[+-]?|[+-])/g, "<sup>$1</sup>")
    // Arrows are matched in their escaped form, because ">" became "&gt;"
    // above and the old rule never fired. Equilibrium first: "<->" holds "->".
    .replace(/\s*&lt;-+&gt;\s*/g, " \u21CC ")
    .replace(/\s*-+&gt;\s*/g, " \u2192 ");
}

// "Al2(SO4)3" -> "Al_2(SO_4)_3". Puts subscript markup back on a bare formula
// so a parsed reading can be shown to the student with its grouping intact.
export function formulaMarkup(body) {
  return String(body || "").replace(/([A-Za-z\)\]])(\d+)/g, "$1_$2");
}

/* ------------------------------------------------------------------ */
/* 2. Case repair                                                      */
/* ------------------------------------------------------------------ */

// "nacl" -> ["NaCl"]. Returns EVERY valid reading, because case repair is not
// always unique: "co" is both Co (cobalt) and CO (carbon monoxide), and
// "caco3" reads as CaCO3, CaCo3 or CAcO3. Callers use the count to decide
// whether they may name a correction or must only warn.
export function repairCaseAll(src, limit = 6) {
  const s = String(src);
  const out = [];

  (function walk(i, acc) {
    if (out.length >= limit) return;
    if (i >= s.length) { out.push(acc); return; }
    const c = s[i];
    if (!/[A-Za-z]/.test(c)) { walk(i + 1, acc + c); return; }
    // Two-letter symbols first so the common reading surfaces first.
    const two = /[A-Za-z]/.test(s[i + 1] || "") ? ELEMENT_BY_LOWER.get(s.slice(i, i + 2).toLowerCase()) : null;
    if (two) walk(i + 2, acc + two);
    const one = ELEMENT_BY_LOWER.get(c.toLowerCase());
    if (one) walk(i + 1, acc + one);
  })(0, "");

  return out;
}

// The single best repair, or null when the string cannot be read as elements.
export function repairCase(src) {
  const all = repairCaseAll(src, 1);
  return all.length ? all[0] : null;
}

/* ------------------------------------------------------------------ */
/* 3. Formula parsing                                                  */
/* ------------------------------------------------------------------ */

// Parses a normalized formula into element counts, charge, phase, and an
// ordered token sequence (needed for structural comparison).
// "NH4+" and "Ca2+" are the same shape but not the same reading: one has a
// subscript, the other a charge magnitude. Rather than guess, this returns
// every plausible reading, best first, and lets the grader accept any of them.
export function formulaCandidates(input, opts = {}) {
  let s = normalize(input);
  if (!s) return [];

  // Phase label at the end: (s) (l) (g) (aq)
  let phase = null;
  s = s.replace(/\(\s*(s|l|g|aq)\s*\)\s*$/i, (_, p) => { phase = p.toLowerCase(); return ""; }).trim();

  const splits = []; // [bodyText, charge]
  let m;
  if ((m = s.match(/^(.*?)\^\s*(\d*)\s*([+-])$/))) {
    splits.push([m[1], (m[2] === "" ? 1 : +m[2]) * (m[3] === "-" ? -1 : 1)]);
  } else if ((m = s.match(/^(.*?)\^\s*([+-])\s*(\d*)$/))) {
    splits.push([m[1], (m[3] === "" ? 1 : +m[3]) * (m[2] === "-" ? -1 : 1)]);
  } else if ((m = s.match(/^(.*?)\(\s*(\d*)\s*([+-])\s*\)$/))) {
    splits.push([m[1], (m[2] === "" ? 1 : +m[2]) * (m[3] === "-" ? -1 : 1)]);
  } else if ((m = s.match(/^(.*\S)\s+(\d*)\s*([+-])$/))) {
    splits.push([m[1], (m[2] === "" ? 1 : +m[2]) * (m[3] === "-" ? -1 : 1)]);
  } else if ((m = s.match(/^(.*?)([+-])\2+$/))) {
    const signs = s.slice(m[1].length);
    splits.push([m[1], signs.length * (signs[0] === "-" ? -1 : 1)]);
  } else if ((m = s.match(/^(.*?)([+-])$/))) {
    const sign = m[2] === "-" ? -1 : 1;
    const body = m[1];
    const d = body.match(/^(.*)(\d)$/);
    // Ambiguous: the trailing digit is either a subscript (NH4+, charge 1)
    // or the charge magnitude (Ca2+, charge 2). Offer both.
    if (d) splits.push([d[1], +d[2] * sign, true]);
    splits.push([body, sign, false]);
  } else {
    splits.push([s, 0, false]);
  }

  const out = [];
  for (const [bodyRaw, charge, usedDigit] of splits) {
    // With autoCapitalize on, every valid recasing becomes its own candidate,
    // so "caco3" can be accepted as CaCO3 without the parser having to commit
    // to one guess between CaCO3 and CaCo3.
    const bodies = [bodyRaw];
    if (opts.autoCapitalize) {
      const stripped = String(bodyRaw).replace(/[\s^]/g, "");
      for (const r of repairCaseAll(stripped)) if (!bodies.includes(r)) bodies.push(r);
    }
    for (const b of bodies) {
      const parsed = parseBody(b, {});
      if (!parsed.ok) continue;
      const cand = { ...parsed, charge, phase, usedTrailingDigitAsCharge: !!usedDigit, canonical: hill(parsed.counts, charge) };
      if (!out.some((o) => o.canonical === cand.canonical && seqKey(o.seq) === seqKey(cand.seq))) out.push(cand);
    }
  }
  out.sort((a, b) => scoreParse(a) - scoreParse(b));
  return out;
}

// Lower is better. Implausible readings (an oxygen subscript of 43, a charge of
// +7 on a polyatomic) are pushed behind sensible ones.
function scoreParse(p) {
  let s = 0;
  const counts = Object.values(p.counts);
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const elements = counts.length;
  if (maxCount > 12) s += 20 + maxCount;   // O43 is not a real subscript
  if (Math.abs(p.charge) > 4) s += 15;
  if (Math.abs(p.charge) > 7) s += 30;
  // "Ca2+" is one element carrying a 2+ charge, so the subscript reading loses.
  if (elements === 1 && !p.usedTrailingDigitAsCharge && maxCount > 1) s += 3;
  // "NH4+" is polyatomic, so the trailing 4 is a subscript, not a charge.
  if (elements > 1 && p.usedTrailingDigitAsCharge) s += 2;
  return s;
}

function parseBody(bodyRaw) {
  let s = String(bodyRaw).replace(/[\s^]/g, "");
  if (!s) return { ok: false, error: "empty" };

  // Electrons in half-reactions.
  if (/^e$/i.test(s)) return { ok: true, counts: Object.create(null), seq: [], electron: true, body: "e" };

  // Hydrates: split on the raised dot, each block may carry a multiplier.
  const blocks = s.split("\u00B7");
  const counts = Object.create(null);
  const seq = [];
  for (const raw of blocks) {
    const mm = raw.match(/^(\d+)(.*)$/);
    const mult = mm ? parseInt(mm[1], 10) : 1;
    const body = mm ? mm[2] : raw;
    if (!body) return { ok: false, error: "bad-block" };
    const r = parseGroup(body, 0);
    if (!r.ok) return r;
    if (r.pos !== body.length) return { ok: false, error: "unparsed", at: r.pos };
    for (const [el, n] of Object.entries(r.counts)) counts[el] = (counts[el] || 0) + n * mult;
    for (let k = 0; k < mult; k++) seq.push(...r.seq);
  }
  return { ok: true, counts, seq, body: s };
}

export function parseFormula(input, opts = {}) {
  const c = formulaCandidates(input, opts);
  if (!c.length) {
    const probe = parseBody(normalize(input).replace(/[+-]+$/, ""), opts);
    return { ok: false, error: probe.error || "unparsed", symbol: probe.symbol };
  }
  return { ok: true, ...c[0] };
}

function parseGroup(s, start) {
  const counts = Object.create(null);
  const seq = [];
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === ")" || c === "]") break;
    if (c === "(" || c === "[") {
      const inner = parseGroup(s, i + 1);
      if (!inner.ok) return inner;
      const close = s[inner.pos];
      if (close !== ")" && close !== "]") return { ok: false, error: "unclosed-paren", at: i };
      i = inner.pos + 1;
      const nm = s.slice(i).match(/^\d+/);
      const n = nm ? parseInt(nm[0], 10) : 1;
      if (nm) i += nm[0].length;
      for (const [el, v] of Object.entries(inner.counts)) counts[el] = (counts[el] || 0) + v * n;
      for (let k = 0; k < n; k++) seq.push(...inner.seq);
      continue;
    }
    const em = s.slice(i).match(/^([A-Z][a-z]?)(\d*)/);
    if (!em) return { ok: false, error: "unexpected", at: i, char: c };
    const el = em[1];
    if (!ELEMENT_SET.has(el)) {
      // "Cl" mis-split as "C" + "l" is the common case; try the single letter.
      const single = el[0];
      if (el.length === 2 && ELEMENT_SET.has(single)) {
        const n2 = 1;
        counts[single] = (counts[single] || 0) + n2;
        seq.push([single, n2]);
        i += 1;
        continue;
      }
      return { ok: false, error: "unknown-element", symbol: el, at: i };
    }
    const n = em[2] ? parseInt(em[2], 10) : 1;
    counts[el] = (counts[el] || 0) + n;
    seq.push([el, n]);
    i += em[0].length;
  }
  return { ok: true, counts, seq, pos: i };
}

// Hill notation: C first, then H, then everything else alphabetically.
export function hill(counts, charge = 0) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  const rest = keys.filter((k) => k !== "C" && k !== "H").sort();
  const order = keys.includes("C") ? ["C", ...(keys.includes("H") ? ["H"] : []), ...rest] : keys.slice().sort();
  let out = order.map((k) => k + (counts[k] === 1 ? "" : counts[k])).join("");
  if (charge) out += "{" + (Math.abs(charge) === 1 ? "" : Math.abs(charge)) + (charge > 0 ? "+" : "-") + "}";
  return out;
}

// Collapse a token sequence, merging adjacent runs of the same element, so
// "CH3CH2OH" and "CH₃CH₂OH" agree but "CH3CH2OH" and "CH3OCH3" do not.
export function seqKey(seq) {
  const merged = [];
  for (const [el, n] of seq) {
    const last = merged[merged.length - 1];
    if (last && last[0] === el) last[1] += n;
    else merged.push([el, n]);
  }
  return merged.map(([el, n]) => el + n).join(".");
}

export function sameCounts(a, b) {
  const ka = Object.keys(a).filter((k) => a[k] !== 0);
  const kb = Object.keys(b).filter((k) => b[k] !== 0);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/* ------------------------------------------------------------------ */
/* 4. Equation parsing                                                 */
/* ------------------------------------------------------------------ */

export function parseEquation(input, opts = {}) {
  const s = normalize(input);
  if (!s) return { ok: false, error: "empty" };

  let arrow = null;
  let parts = null;
  if (s.includes("<->")) { arrow = "equilibrium"; parts = s.split("<->"); }
  else if (s.includes("->")) { arrow = "yields"; parts = s.split("->"); }
  else if (/(?:^|[^^\d])=(?![>=])/.test(s)) { arrow = "yields"; parts = s.split("="); }
  if (!parts || parts.length !== 2) return { ok: false, error: "no-arrow" };

  const lhs = parseSide(parts[0], opts);
  const rhs = parseSide(parts[1], opts);
  if (!lhs.ok) return lhs;
  if (!rhs.ok) return rhs;
  if (!lhs.species.length || !rhs.species.length) return { ok: false, error: "empty-side" };

  return { ok: true, arrow, lhs: lhs.species, rhs: rhs.species };
}

function parseSide(text, opts) {
  const species = [];
  // Split on "+" only when it separates species, never when it is a charge.
  const chunks = splitPlus(text);
  for (const chunk of chunks) {
    const t = chunk.trim();
    if (!t) continue;
    const m = t.match(/^(\d+(?:\/\d+)?)\s+?(.*)$/) || t.match(/^(\d+)(?=[A-Z(\[])(.*)$/);
    let coef = 1;
    let body = t;
    if (m) {
      coef = m[1].includes("/") ? m[1].split("/").reduce((a, b) => a / b) : parseInt(m[1], 10);
      body = m[2];
    }
    const f = parseFormula(body, opts);
    if (!f.ok) return { ok: false, error: "bad-species", species: body, detail: f };
    species.push({ coef, formula: f, text: body.trim() });
  }
  return { ok: true, species };
}

// A "+" is a separator when a new species starts after it, and a charge sign
// otherwise. Looking ahead is what distinguishes the two "+" in "Ag+ + Cl-":
// the first is followed by another sign, the second by an element symbol.
function splitPlus(text) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "+" && depth === 0 && text[i - 1] !== "^") {
      const ahead = text.slice(i + 1).replace(/^\s+/, "");
      if (/^[A-Z(\[\d]/.test(ahead)) { out.push(buf); buf = ""; continue; }
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

export function atomBalance(eq) {
  const side = (arr) => arr.reduce((acc, sp) => {
    for (const [el, n] of Object.entries(sp.formula.counts)) acc[el] = (acc[el] || 0) + n * sp.coef;
    return acc;
  }, Object.create(null));
  const L = side(eq.lhs);
  const R = side(eq.rhs);
  const chargeL = eq.lhs.reduce((a, s) => a + s.formula.charge * s.coef, 0);
  const chargeR = eq.rhs.reduce((a, s) => a + s.formula.charge * s.coef, 0);
  const offenders = [];
  for (const el of new Set([...Object.keys(L), ...Object.keys(R)])) {
    if ((L[el] || 0) !== (R[el] || 0)) offenders.push(el);
  }
  return { balanced: offenders.length === 0 && chargeL === chargeR, offenders, chargeBalanced: chargeL === chargeR };
}

export function gcdAll(nums) {
  const g2 = (a, b) => (b ? g2(b, a % b) : a);
  return nums.map((n) => Math.abs(Math.round(n))).reduce((a, b) => g2(a, b), 0) || 1;
}

/* ------------------------------------------------------------------ */
/* 5. Numbers, units, significant figures                              */
/* ------------------------------------------------------------------ */

const BASE = {
  // mass
  g: ["mass", 1], kg: ["mass", 1000], mg: ["mass", 1e-3], "\u03BCg": ["mass", 1e-6], ug: ["mass", 1e-6], ng: ["mass", 1e-9], lb: ["mass", 453.592], amu: ["mass", 1.66054e-24], u: ["mass", 1.66054e-24],
  // amount
  mol: ["amount", 1], mmol: ["amount", 1e-3], "\u03BCmol": ["amount", 1e-6], kmol: ["amount", 1000],
  // volume
  L: ["volume", 1], mL: ["volume", 1e-3], "\u03BCL": ["volume", 1e-6], dL: ["volume", 0.1], cm3: ["volume", 1e-3], dm3: ["volume", 1], m3: ["volume", 1000],
  // length
  m: ["length", 1], cm: ["length", 0.01], mm: ["length", 1e-3], nm: ["length", 1e-9], pm: ["length", 1e-12], "\u00C5": ["length", 1e-10], km: ["length", 1000],
  // energy
  J: ["energy", 1], kJ: ["energy", 1000], cal: ["energy", 4.184], kcal: ["energy", 4184], eV: ["energy", 1.602177e-19],
  // pressure
  Pa: ["pressure", 1], kPa: ["pressure", 1000], atm: ["pressure", 101325], bar: ["pressure", 1e5], torr: ["pressure", 133.322], mmHg: ["pressure", 133.322],
  // time
  s: ["time", 1], min: ["time", 60], h: ["time", 3600], hr: ["time", 3600], ms: ["time", 1e-3],
  // dimensionless
  "%": ["ratio", 1], "": ["none", 1],
};

const UNIT_ALIAS = {
  grams: "g", gram: "g", gm: "g", kilograms: "kg", kilogram: "kg", milligrams: "mg", milligram: "mg",
  moles: "mol", mole: "mol", mols: "mol", millimoles: "mmol", millimole: "mmol",
  litres: "L", liters: "L", litre: "L", liter: "L", l: "L", ml: "mL", millilitres: "mL", milliliters: "mL", cc: "cm3",
  joules: "J", joule: "J", kilojoules: "kJ", kilojoule: "kJ", calories: "cal", calorie: "cal",
  seconds: "s", second: "s", sec: "s", minutes: "min", minute: "min", hours: "h", hour: "h",
  atmospheres: "atm", atmosphere: "atm", pascals: "Pa", pascal: "Pa",
  molar: "mol/L", M: "mol/L", m: "m", percent: "%", pct: "%",
  angstrom: "\u00C5", angstroms: "\u00C5", "a\u030A": "\u00C5",
  amus: "amu", daltons: "amu", da: "amu",
};

// Parses "0.125 mol", "2.5e-3 M", "74.10 g/mol", "25 °C".
export function parseQuantity(input) {
  const s = normalize(input);
  if (!s) return { ok: false, error: "empty" };

  const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/i);
  if (!m) return { ok: false, error: "no-number" };

  const value = parseFloat(m[1]);
  if (!isFinite(value)) return { ok: false, error: "not-finite" };

  const unitRaw = m[2].trim();
  return { ok: true, value, text: m[1], unitRaw, unit: canonUnit(unitRaw), ...sigFigs(m[1]) };
}

export function canonUnit(raw) {
  if (!raw) return "";
  let u = raw.trim();
  if (/^\u00B0?C$/.test(u)) return "\u00B0C";
  if (/^K$/.test(u)) return "K";
  if (/^\u00B0?F$/.test(u)) return "\u00B0F";
  // "g mol^-1" -> "g/mol". Done before whitespace is stripped, so the
  // numerator is not swallowed into the exponent match.
  u = u.replace(/([A-Za-z\u03BC\u00C5]+)\s*\^?\s*-1\b/g, "/$1");
  u = u.replace(/\s+/g, "").replace(/\/\//g, "/").replace(/^\//, (m, o, str) => (str.indexOf("/") === 0 ? "/" : m));
  const parts = u.split("/");
  const map = (p) => {
    const trimmed = p.replace(/[.\s]/g, "");
    if (BASE[trimmed]) return trimmed;
    const alias = UNIT_ALIAS[trimmed] || UNIT_ALIAS[trimmed.toLowerCase()];
    if (alias && !alias.includes("/")) return alias;
    if (alias) return alias;
    return trimmed;
  };
  if (parts.length === 1) {
    const mapped = map(parts[0]);
    return mapped;
  }
  return parts.map(map).join("/");
}

// Converts value between two canonical units. Returns null when the units are
// not comparable, so the caller can report a unit mismatch rather than a
// wrong number.
export function convert(value, from, to) {
  if (from === to) return value;
  const temps = new Set(["\u00B0C", "K", "\u00B0F"]);
  if (temps.has(from) || temps.has(to)) {
    if (!temps.has(from) || !temps.has(to)) return null;
    let k = from === "K" ? value : from === "\u00B0C" ? value + 273.15 : (value - 32) * 5 / 9 + 273.15;
    return to === "K" ? k : to === "\u00B0C" ? k - 273.15 : (k - 273.15) * 9 / 5 + 32;
  }
  const dec = (u) => {
    const [num, den] = u.split("/");
    const n = BASE[num];
    const d = den ? BASE[den] : ["none", 1];
    if (!n || !d) return null;
    return { dim: n[0] + "/" + d[0], factor: n[1] / d[1] };
  };
  const a = dec(from);
  const b = dec(to);
  if (!a || !b || a.dim !== b.dim) return null;
  return (value * a.factor) / b.factor;
}

// Significant figures, counted from the string the student typed.
export function sigFigs(numStr) {
  let s = String(numStr).trim().replace(/^[+-]/, "");
  const e = s.match(/^([\d.]+)e[+-]?\d+$/i);
  if (e) s = e[1];
  const hasPoint = s.includes(".");
  let digits = s.replace(".", "");
  digits = digits.replace(/^0+/, "");
  if (digits === "") return { sig: 1, ambiguousSig: false };
  if (hasPoint) return { sig: digits.length, ambiguousSig: false };
  const stripped = digits.replace(/0+$/, "");
  const trailing = digits.length - stripped.length;
  return { sig: stripped.length || 1, ambiguousSig: trailing > 0, sigMax: digits.length };
}

export function roundSig(x, n) {
  if (x === 0 || !isFinite(x)) return x;
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const p = n - d;
  const f = Math.pow(10, p);
  return Math.round(x * f) / f;
}

/* ------------------------------------------------------------------ */
/* 6. Text normalization for word answers                              */
/* ------------------------------------------------------------------ */

export function normText(s, opts = {}) {
  let t = normalize(s);
  if (opts.case !== true) t = t.toLowerCase();
  if (opts.punctuation !== false) t = t.replace(/[.,;:!?'"()\[\]]/g, " ");
  if (opts.articles !== false) t = t.replace(/\b(?:a|an|the)\b/gi, " ");
  if (opts.hyphens !== false) t = t.replace(/-/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
