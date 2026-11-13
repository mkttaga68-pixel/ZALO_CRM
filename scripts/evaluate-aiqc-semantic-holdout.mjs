#!/usr/bin/env node
// Offline re-evaluation of RECORDED semantic outputs against locked labels. No inference, no network.
// Recomputes TP/TN/FP/FN and 3-state accuracy from per-case rows (not from the stored summary), checks
// them against the stored summary, and applies acceptance thresholds that were fixed BEFORE evaluation.
// Usage: node scripts/evaluate-aiqc-semantic-holdout.mjs <results.json> [--out report.json]
import fs from 'node:fs';
import crypto from 'node:crypto';

const file = process.argv[2];
if (!file) { console.error('usage: evaluate-aiqc-semantic-holdout.mjs <results.json> [--out file]'); process.exit(2); }
const raw = fs.readFileSync(file);
const data = JSON.parse(raw.toString('utf8'));
const rows = data.results;
if (!Array.isArray(rows)) { console.error('results[] missing'); process.exit(2); }

// Acceptance thresholds (proposal v1, 2026-11-11). Changing them requires owner sign-off and a new holdout.
export const THRESHOLDS = {
  phaseB: { schemaValidity: 1, citationValidity: 1, timeouts: 0, regressionMaxFpr: 0.05, regressionMaxFnr: 0, holdoutMinStrict: 0.95 },
  pilot: { holdoutMinPositives: 30, holdoutMinNegatives: 60, wilsonUpperFprMax: 0.10, wilsonUpperFnrMax: 0.20, holdoutMinStrict: 0.95, perCategoryMinCases: 8 },
};
function wilsonUpper(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return (c + m) / d;
}
function score(cases) {
  const s = { count: cases.length, tp: 0, tn: 0, fp: 0, fn: 0, strictCorrect: 0, strictCount: 0, schemaInvalid: 0, citationInvalid: 0, timeouts: 0, errors: 0, falsePositives: [], falseNegatives: [], strictMismatches: [] };
  for (const r of cases) {
    if (r.expected === true && r.actual === true) s.tp++;
    else if (r.expected === false && r.actual === false) s.tn++;
    else if (r.expected === false && r.actual === true) { s.fp++; s.falsePositives.push(r.name); }
    else if (r.expected === true && r.actual !== true) { s.fn++; s.falseNegatives.push(r.name); }
    if (r.expectedDisposition) { s.strictCount++; if (r.expectedDisposition === r.disposition) s.strictCorrect++; else s.strictMismatches.push(`${r.name}: ${r.expectedDisposition}→${r.disposition}`); }
    if (r.schemaValid !== true || r.jsonParsed !== true) s.schemaInvalid++;
    if ((r.validCitations ?? 0) !== (r.citationCount ?? 0)) s.citationInvalid++;
    if ((r.errors ?? []).some(e => /TIMEOUT/i.test(String(e)))) s.timeouts++;
    if ((r.errors ?? []).length) s.errors++;
  }
  const neg = s.tn + s.fp, pos = s.tp + s.fn;
  return { ...s, positives: pos, negatives: neg, fpr: neg ? s.fp / neg : null, fnr: pos ? s.fn / pos : null,
    strictAccuracy: s.strictCount ? s.strictCorrect / s.strictCount : null, wilsonUpperFpr: wilsonUpper(s.fp, neg), wilsonUpperFnr: wilsonUpper(s.fn, pos) };
}
const regression = score(rows.filter(r => r.cohort === 'regression'));
const holdout = score(rows.filter(r => r.cohort !== 'regression'));
const perCategory = {};
for (const r of rows.filter(r => r.cohort !== 'regression')) (perCategory[r.group ?? r.category] ??= []).push(r);
const categories = Object.fromEntries(Object.entries(perCategory).map(([k, v]) => [k, score(v)]));

// Cross-check against the summary stored with the run.
const mismatch = [];
for (const [name, mine, theirs] of [['regression', regression, data.regression], ['holdout', holdout, data.blind]])
  for (const k of ['tp', 'tn', 'fp', 'fn', 'strictCorrect', 'strictCount']) if (theirs && theirs[k] !== mine[k]) mismatch.push(`${name}.${k}: stored ${theirs[k]} vs recomputed ${mine[k]}`);

const T = THRESHOLDS, all = score(rows);
const gate = (ok, label, detail) => ({ label, result: ok ? 'PASS' : 'FAIL', detail });
const phaseB = [
  gate(all.schemaInvalid === 0, 'JSON/schema validity 100%', `${all.count - all.schemaInvalid}/${all.count}`),
  gate(all.citationInvalid === 0, 'citation validity 100%', `${all.count - all.citationInvalid}/${all.count}`),
  gate(all.timeouts === 0, 'no timeouts', String(all.timeouts)),
  gate(regression.fpr !== null && regression.fpr <= T.phaseB.regressionMaxFpr, `regression FPR <= ${T.phaseB.regressionMaxFpr * 100}%`, `${regression.fp}/${regression.negatives} = ${(regression.fpr * 100).toFixed(2)}% (${regression.falsePositives.join(', ')})`),
  gate(regression.fnr === 0, 'regression FNR = 0', `${regression.fn}/${regression.positives}`),
  gate(holdout.strictAccuracy !== null && holdout.strictAccuracy >= T.phaseB.holdoutMinStrict, `holdout 3-state >= ${T.phaseB.holdoutMinStrict * 100}%`, `${holdout.strictCorrect}/${holdout.strictCount} (${holdout.strictMismatches.join('; ')})`),
];
const smallCats = Object.entries(categories).filter(([, s]) => s.count < T.pilot.perCategoryMinCases).map(([k, s]) => `${k}=${s.count}`);
const pilot = [
  gate(holdout.positives >= T.pilot.holdoutMinPositives, `holdout positives >= ${T.pilot.holdoutMinPositives}`, String(holdout.positives)),
  gate(holdout.negatives >= T.pilot.holdoutMinNegatives, `holdout negatives >= ${T.pilot.holdoutMinNegatives}`, String(holdout.negatives)),
  gate(holdout.wilsonUpperFpr !== null && holdout.wilsonUpperFpr <= T.pilot.wilsonUpperFprMax, `Wilson 95% upper FPR <= ${T.pilot.wilsonUpperFprMax * 100}%`, holdout.wilsonUpperFpr === null ? 'n/a' : (holdout.wilsonUpperFpr * 100).toFixed(1) + '%'),
  gate(holdout.wilsonUpperFnr !== null && holdout.wilsonUpperFnr <= T.pilot.wilsonUpperFnrMax, `Wilson 95% upper FNR <= ${T.pilot.wilsonUpperFnrMax * 100}%`, holdout.wilsonUpperFnr === null ? 'n/a' : (holdout.wilsonUpperFnr * 100).toFixed(1) + '%'),
  gate(!smallCats.length, `every holdout category >= ${T.pilot.perCategoryMinCases} cases`, smallCats.join(', ') || 'ok'),
];
const report = { input: file, inputSha256: crypto.createHash('sha256').update(raw).digest('hex'), model: data.model, providerVersion: data.providerVersion,
  frozen: data.frozen, summaryCrossCheck: mismatch.length ? mismatch : 'MATCH', thresholds: T, regression, holdout, categories,
  phaseB: { result: phaseB.every(g => g.result === 'PASS') ? 'PASS' : 'FAIL', gates: phaseB }, pilot: { result: pilot.every(g => g.result === 'PASS') ? 'PASS' : 'FAIL', gates: pilot } };
const outIndex = process.argv.indexOf('--out');
if (outIndex > 0) fs.writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summaryCrossCheck: report.summaryCrossCheck, phaseB: report.phaseB, pilot: report.pilot }, null, 2));
process.exit(report.phaseB.result === 'PASS' && report.pilot.result === 'PASS' ? 0 : 1);
