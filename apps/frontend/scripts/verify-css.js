#!/usr/bin/env node
/**
 * Post-build sanity check: ensures Tailwind CSS utilities actually
 * landed in the compiled CSS bundle. Guards against silent breakage
 * when Tailwind's content scanner misses files (content glob drift,
 * workspace hoist issues, stale .next, etc.).
 *
 * Fails the build with exit 1 if sentinel utilities are missing.
 * Run via `postbuild` hook in package.json so it trips before deploy.
 */
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', '.next', 'static', 'css');

// Sentinel classes that MUST exist if Tailwind processed the source.
// Chosen because they're used in layout + dashboard + login — the
// common failure signatures we keep hitting (oversized nav icons,
// full-width buttons, etc.) all flow from these being absent.
const SENTINELS = [
  '.w-5{',
  '.h-5{',
  '.w-4{',
  '.h-4{',
  '.rounded-lg{',
  '.bg-slate-900',  // base theme
  '.text-slate-',   // theme text
];

function fail(msg) {
  console.error('\n\x1b[31m[verify-css] BUILD REJECTED: ' + msg + '\x1b[0m');
  console.error('\x1b[33mLikely causes:\x1b[0m');
  console.error('  1. tailwindcss not installed in workspace (run `npm install` at repo root)');
  console.error('  2. tailwind.config.js `content` glob missing src/**/*.tsx');
  console.error('  3. Stale .next — delete it and rebuild');
  console.error('  4. globals.css missing @tailwind directives');
  process.exit(1);
}

if (!fs.existsSync(CSS_DIR)) {
  fail('No .next/static/css directory — did `next build` run?');
}

const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
if (files.length === 0) {
  fail('No CSS files produced by build.');
}

// Concatenate all CSS bundles (Next splits them across routes).
let combined = '';
for (const f of files) {
  combined += fs.readFileSync(path.join(CSS_DIR, f), 'utf8');
}

const missing = SENTINELS.filter((s) => !combined.includes(s));
if (missing.length > 0) {
  fail('Tailwind utilities missing from build output: ' + missing.join(', '));
}

const sizeKB = Math.round(combined.length / 1024);
console.log(`\x1b[32m[verify-css] OK — ${files.length} bundle(s), ${sizeKB}KB total, all sentinels present\x1b[0m`);
