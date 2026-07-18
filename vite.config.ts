import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { extname, resolve, sep } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const capsuleDir = resolve(__dirname, 'capsule');
const rendererOutDir = resolve(__dirname, 'dist/renderer');

function capsuleAssetsPlugin() {
  return {
    name: 'nexus-capsule-assets',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (!url.pathname.startsWith('/capsule/')) return next();

        const rel = decodeURIComponent(url.pathname.slice('/capsule/'.length));
        const filePath = resolve(capsuleDir, rel);
        if (!filePath.startsWith(capsuleDir + sep)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const ext = extname(filePath);
        res.setHeader('content-type', ext === '.json' ? 'application/json' : 'text/plain');
        fs.createReadStream(filePath).pipe(res);
      });
    },
    async closeBundle() {
      const outDir = resolve(rendererOutDir, 'capsule');
      await fsp.rm(outDir, { recursive: true, force: true });
      await fsp.cp(capsuleDir, outDir, { recursive: true });
    },
  };
}

/**
 * Renderer build for the Nexus Next shell.
 * Aliases `electron` -> the browser web-shim so the ported preload can run in
 * a plain browser (web target). In the Electron target the preload is built
 * separately (scripts/build-electron.mjs) and this alias is unused.
 */
export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'renderer/src'),
      electron: resolve(__dirname, 'src/web/electron-web-shim.ts'),
    },
  },
  plugins: [react(), capsuleAssetsPlugin()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'renderer/index.html'),
        next: resolve(__dirname, 'renderer/next.html'),
        'gaze-voice': resolve(__dirname, 'renderer/gaze-voice.html'),
        'vision-gestures': resolve(__dirname, 'renderer/vision-gestures.html'),
        'nate-kb': resolve(__dirname, 'renderer/nate-kb.html'),
        'eye-contact': resolve(__dirname, 'renderer/eye-contact.html'),
        'browser-viewer': resolve(__dirname, 'renderer/browser-viewer.html'),
      },
    },
  },
  server: { port: 5173 },
});
