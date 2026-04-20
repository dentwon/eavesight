#!/usr/bin/env node
/**
 * Pre-build dependency check: confirms critical build-time packages
 * resolve from apps/frontend. If workspace hoisting ever leaves the
 * frontend unable to find tailwindcss/postcss/autoprefixer, the
 * build dies immediately with a clear message instead of silently
 * producing CSS with no utility classes.
 */
const path = require('path');

const REQUIRED = ['tailwindcss', 'postcss', 'autoprefixer'];
const errors = [];

for (const pkg of REQUIRED) {
  try {
    const resolved = require.resolve(pkg, { paths: [path.join(__dirname, '..')] });
    const pkgJson = require(require.resolve(`${pkg}/package.json`, { paths: [path.join(__dirname, '..')] }));
    console.log(`\x1b[32m[check-deps] ${pkg}@${pkgJson.version}\x1b[0m → ${resolved}`);
  } catch (e) {
    errors.push(pkg);
  }
}

if (errors.length > 0) {
  console.error(`\n\x1b[31m[check-deps] BUILD REJECTED: cannot resolve ${errors.join(', ')} from apps/frontend\x1b[0m`);
  console.error('\x1b[33mFix: cd apps/frontend && npm install\x1b[0m');
  console.error('\x1b[33mIf hoisted to workspace root, reinstall: (cd /home/dentwon/StormVault && npm install)\x1b[0m');
  process.exit(1);
}

console.log('\x1b[32m[check-deps] All build dependencies resolvable.\x1b[0m');
