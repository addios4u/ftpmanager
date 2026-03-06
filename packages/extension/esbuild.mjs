import * as esbuild from 'esbuild';
import { cpSync, readdirSync, realpathSync, rmSync, statSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Native/external modules that must be copied into dist/ for VSIX packaging
const nativeModules = ['ssh2', 'cpu-features', 'ssh2-sftp-client'];

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode', ...nativeModules],
  logLevel: 'warning',
};

/**
 * Copy external native modules AND transitive dependencies into dist/node_modules/.
 * pnpm places modules in a virtual store; we BFS to find all deps.
 */
function copyNativeModules() {
  const require = createRequire(import.meta.url);
  const copied = new Set();
  const visitedDirs = new Set();
  const dirQueue = [];

  for (const mod of nativeModules) {
    try {
      let modPath;
      try {
        modPath = require.resolve(`${mod}/package.json`).replace('/package.json', '');
      } catch {
        modPath = dirname(require.resolve(mod));
      }
      const parentDir = dirname(modPath);
      if (parentDir.includes('.pnpm')) {
        dirQueue.push(parentDir);
      } else {
        const dest = `dist/node_modules/${mod}`;
        rmSync(dest, { recursive: true, force: true });
        cpSync(modPath, dest, { recursive: true, dereference: true });
        copied.add(mod);
      }
    } catch { /* module not installed */ }
  }

  // Build-time-only packages — not needed at runtime.
  // NOTE: readable-stream, string_decoder, safe-buffer, inherits, util-deprecate
  //       are intentionally NOT excluded: concat-stream (runtime dep of
  //       ssh2-sftp-client) requires them at extension activation time.
  const buildTimeOnly = new Set([
    'prebuild-install', 'node-abi', 'napi-build-utils', 'detect-libc',
    'tar-fs', 'tar-stream', 'pump', 'end-of-stream', 'bl', 'once', 'wrappy',
    'simple-get', 'simple-concat', 'decompress-response', 'mimic-response',
    'mkdirp-classic', 'fs-constants', 'chownr', 'tunnel-agent',
    'github-from-package', 'expand-template', 'ini', 'minimist', 'rc',
    'deep-extend', 'strip-json-comments', 'semver', 'buildcheck',
    'buffer', 'base64-js', 'ieee754',
  ]);

  // BFS over pnpm virtual store directories
  while (dirQueue.length > 0) {
    const dir = dirQueue.shift();
    if (visitedDirs.has(dir)) continue;
    visitedDirs.add(dir);

    for (const entry of readdirSync(dir)) {
      if (buildTimeOnly.has(entry)) continue;
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      if (!copied.has(entry)) {
        const dest = `dist/node_modules/${entry}`;
        rmSync(dest, { recursive: true, force: true });
        cpSync(entryPath, dest, { recursive: true, dereference: true });
        copied.add(entry);
      }
      try {
        const realParent = dirname(realpathSync(entryPath));
        if (!visitedDirs.has(realParent)) dirQueue.push(realParent);
      } catch { /* ignore */ }
    }
  }
}

async function main() {
  const ctx = await esbuild.context(buildOptions);
  if (watch) {
    await ctx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    await ctx.rebuild();
    copyNativeModules();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
