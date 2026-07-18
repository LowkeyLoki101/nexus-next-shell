/**
 * Build the Electron shell: main + preload bundles.
 *
 * The key trick is the alias plugin on the PRELOAD bundle:
 *   - inside the real preload, `import ... from 'electron'`  -> our preload-shim
 *     (WS-backed ipcRenderer + real contextBridge/clipboard)
 *   - inside the shim, `import ... from 'electron-real'`      -> the genuine electron
 * so the preload runs unmodified but talks to the remote engine.
 */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shim = path.join(root, 'electron/preload-shim.ts');
const electronOut = path.join(root, 'dist/electron');

await fs.rm(electronOut, { recursive: true, force: true });
await fs.mkdir(electronOut, { recursive: true });

const preloadAlias = {
  name: 'preload-electron-alias',
  setup(b) {
    // Genuine electron, only requested by the shim via 'electron-real'.
    b.onResolve({ filter: /^electron-real$/ }, () => ({ path: 'electron', external: true }));
    // Everything else that imports 'electron' gets the shim — except the shim itself.
    b.onResolve({ filter: /^electron$/ }, (args) => {
      if (path.resolve(args.resolveDir, args.importer) === shim || args.importer === shim) {
        return { path: 'electron', external: true };
      }
      return { path: shim };
    });
  },
};

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'info' };

// Main process — real electron, external.
await build({
  ...common,
  entryPoints: [path.join(root, 'electron/main.ts')],
  outfile: path.join(electronOut, 'main.cjs'),
  external: ['electron'],
});

// Preload — electron rewritten to the WS-backed shim.
await build({
  ...common,
  entryPoints: [path.join(root, 'electron/preload-entry.ts')],
  outfile: path.join(electronOut, 'preload.cjs'),
  external: ['electron', 'ws'],
  plugins: [preloadAlias],
});

const capsuleOut = path.join(root, 'dist/capsule');
await fs.rm(capsuleOut, { recursive: true, force: true });
await fs.mkdir(capsuleOut, { recursive: true });
await fs.copyFile(path.join(root, 'capsule/capsule.json'), path.join(capsuleOut, 'capsule.json'));
await fs.copyFile(path.join(root, 'capsule/public-key.pem'), path.join(capsuleOut, 'public-key.pem'));

console.log('shell electron bundles -> dist/electron/{main,preload}.cjs');
