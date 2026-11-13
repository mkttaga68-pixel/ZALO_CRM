#!/usr/bin/env node
// Static, read-only check of the EFFECTIVE AIQC flags for the `app` service across an ordered list of
// Compose files. It never runs Docker, never connects anywhere and never prints .env VALUES: from .env it
// only reads variable NAMES so it can flag any ${VAR} that would be overridden at deploy time.
//
// Usage: node scripts/verify-aiqc-compose-flags.mjs --phase A|B|current [--json] file1.yml [file2.yml ...]
// Exit code 0 = phase requirements met, 1 = violations, 2 = usage/parse error.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const phase = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : 'current';
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--phase');
if (!files.length || !['A', 'B', 'C', 'current'].includes(phase)) { console.error('usage: --phase A|B|current file1.yml [...]'); process.exit(2); }

const envNames = new Set();
for (const candidate of ['.env']) {
  const p = path.resolve(path.dirname(path.resolve(files[0])), candidate);
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line); if (m) envNames.add(m[1]); }
}
const unquote = v => { v = v.trim(); if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); return v; };
const interpolations = [];
function resolve(value, key) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}/g, (_m, name, op, rest) => {
    const fromEnv = envNames.has(name) || Object.hasOwn(process.env, name);
    interpolations.push({ key, variable: name, overridable: fromEnv });
    if (fromEnv) return `<from-env:${name}>`;
    if (op && op.endsWith('?')) return `<REQUIRED:${name}>`;
    return rest ?? '';
  });
}
/** Minimal reader for services.app.{image,build.args,environment}; enough for the repo's Compose files. */
function readApp(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = { image: undefined, args: {}, env: {}, buildReset: false };
  let inServices = false, inApp = false, section = null, sub = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length, line = raw.trim();
    if (indent === 0) { inServices = line === 'services:'; inApp = false; continue; }
    if (!inServices) continue;
    if (indent === 2) { inApp = line === 'app:'; section = null; continue; }
    if (!inApp) continue;
    if (indent === 4) {
      const [k, ...v] = line.split(':'); section = k; sub = null; const rest = v.join(':').trim();
      if (k === 'image') out.image = resolve(unquote(rest), 'image');
      if (k === 'build' && rest.startsWith('!reset')) out.buildReset = true;
      continue;
    }
    if (section === 'build' && indent === 6) { sub = line.replace(/:.*/, ''); continue; }
    if (section === 'build' && sub === 'args' && indent === 8) { const i = line.indexOf(':'); const k = line.slice(0, i); out.args[k] = resolve(unquote(line.slice(i + 1)), k); continue; }
    if (section === 'environment' && indent >= 6) {
      if (line.startsWith('- ')) { const item = unquote(line.slice(2)); const i = item.indexOf('='); if (i > 0) { const k = item.slice(0, i); out.env[k] = resolve(item.slice(i + 1), k); } }
      else { const i = line.indexOf(':'); const k = line.slice(0, i); out.env[k] = resolve(unquote(line.slice(i + 1)), k); }
    }
  }
  return out;
}
const merged = { image: undefined, args: {}, env: {}, sources: {} };
for (const f of files) {
  if (!fs.existsSync(f)) { console.error('missing file ' + f); process.exit(2); }
  const app = readApp(f);
  if (app.image !== undefined) { merged.image = app.image; merged.sources.image = f; }
  if (app.buildReset) merged.args = {};
  Object.assign(merged.args, app.args);
  for (const [k, v] of Object.entries(app.env)) { merged.env[k] = v; merged.sources[k] = path.basename(f); }
}
const aiqc = Object.fromEntries(Object.entries(merged.env).filter(([k]) => k.startsWith('AI_QC_') || k.startsWith('OLLAMA_') || k === 'OPENAI_MODEL').sort());
const vite = merged.args.VITE_AI_QC_ENABLED;
const on = k => aiqc[k] === 'true';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const violations = [], warnings = [];
const mustBeOff = ['AI_QC_REAL_API_ENABLED', 'AI_QC_OUTBOUND_TEST_APPROVED', 'AI_QC_REAL_DATA_ENABLED', 'AI_QC_REAL_DATA_OUTBOUND_APPROVED', 'AI_QC_AUTO_MONITOR_ENABLED', 'AI_QC_MANUAL_REAL_TEST_ENABLED', 'AI_QC_MANUAL_RETENTION_ENABLED'];
if (phase === 'A') { for (const k of ['AI_QC_ENABLED', 'AI_QC_OLLAMA_ENABLED', ...mustBeOff]) if (on(k)) violations.push(`${k} must not be true in phase A`); }
if (phase === 'B') {
  for (const k of mustBeOff) if (on(k)) violations.push(`${k} must not be true in phase B (synthetic only)`);
  if (!on('AI_QC_ENABLED')) violations.push('phase B needs AI_QC_ENABLED=true');
  if (on('AI_QC_OLLAMA_ENABLED') && !(on('AI_QC_RESOURCE_GUARD_REQUIRED') && aiqc.AI_QC_HOST_RESOURCE_FILE && aiqc.AI_QC_OLLAMA_KILL_SWITCH_FILE)) violations.push('Ollama needs resource guard, telemetry file and kill-switch file');
}
if (phase === 'C') {
  // Owner-approved local-only pilot: real data ONLY through local Ollama, manual + previewed, never outbound.
  for (const k of ['AI_QC_REAL_API_ENABLED', 'AI_QC_OUTBOUND_TEST_APPROVED', 'AI_QC_REAL_DATA_OUTBOUND_APPROVED', 'AI_QC_AUTO_MONITOR_ENABLED', 'AI_QC_MANUAL_REAL_TEST_ENABLED']) if (on(k)) violations.push(`${k} must not be true in the local pilot`);
  for (const k of ['AI_QC_ENABLED', 'AI_QC_REAL_DATA_ENABLED', 'AI_QC_OLLAMA_ENABLED', 'AI_QC_OLLAMA_REAL_DATA_ENABLED', 'AI_QC_MANUAL_RETENTION_ENABLED', 'AI_QC_RESOURCE_GUARD_REQUIRED']) if (!on(k)) violations.push(`${k}=true is required in the local pilot`);
  if (!UUID.test(aiqc.AI_QC_REAL_DATA_PILOT_ORG_ID ?? '')) violations.push('AI_QC_REAL_DATA_PILOT_ORG_ID must be the approved tenant UUID');
  if (!aiqc.AI_QC_HOST_RESOURCE_FILE || !aiqc.AI_QC_OLLAMA_KILL_SWITCH_FILE) violations.push('resource telemetry and kill-switch files are required');
  if ((aiqc.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434') !== 'http://host.docker.internal:11434') violations.push('Ollama must be the local host endpoint');
}
if (phase !== 'current') {
  if (phase !== 'C' && aiqc.AI_QC_REAL_DATA_PILOT_ORG_ID) violations.push('AI_QC_REAL_DATA_PILOT_ORG_ID must be absent before the real-data pilot');
  if (aiqc.AI_QC_OPENAI_REMOVED !== 'true') violations.push('AI_QC_OPENAI_REMOVED=true is required (owner cancelled OpenAI use)');
  if (!merged.image || !/@sha256:[a-f0-9]{64}$/.test(merged.image)) violations.push(`image must be pinned by digest (got ${merged.image ?? 'none'})`);
  if (aiqc.AI_QC_STORAGE && aiqc.AI_QC_STORAGE !== 'application') violations.push('AI_QC_STORAGE must be application in production');
}
if (on('AI_QC_REAL_DATA_ENABLED') && !UUID.test(aiqc.AI_QC_REAL_DATA_PILOT_ORG_ID ?? '')) warnings.push('AI_QC_REAL_DATA_ENABLED=true but no pilot tenant: code from 2026-11-11 keeps real data OFF; older images (e.g. sha256:875af855…) DO expose CRM reads');
if (vite === 'true' && !on('AI_QC_ENABLED')) warnings.push('VITE_AI_QC_ENABLED=true while backend is OFF: menu visible, API returns 503 (build-time; only matters if the image is rebuilt)');
// The AIQC ProgramData root holds production DB dumps (backups/); only its runtime/ child may be mounted.
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/source:\s*['"]?([^\s'"]+)/g)) {
  const src = m[1].replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (src === 'c:/programdata/zalocrm/aiqc' || src.startsWith('c:/programdata/zalocrm/aiqc/backups') || src === 'c:/programdata/zalocrm')
    violations.push(`${path.basename(f)} mounts ${m[1]}, which contains database backups`);
}
const relevant = k => k === 'image' || /^(AI_QC_|OLLAMA_|VITE_AI_QC_|OPENAI_)/.test(k);
for (const i of interpolations) if (i.overridable && relevant(i.key)) warnings.push(`${i.key} is interpolated from environment variable ${i.variable}; verify it on the deploy host`);
const report = { phase, files, image: merged.image, viteAiQcEnabled: vite ?? null, flags: aiqc, sources: Object.fromEntries(Object.keys(aiqc).map(k => [k, merged.sources[k]])), violations, warnings, result: violations.length ? 'FAIL' : 'PASS' };
console.log(JSON.stringify(report, null, 2));
process.exit(violations.length ? 1 : 0);
