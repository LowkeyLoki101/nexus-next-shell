/**
 * Nexus Next — SHELL (Electron) main process.
 *
 * Responsibilities (thin client only — NO engine logic lives here):
 *   1. Load + cryptographically verify the signed capsule (Ed25519) before
 *      showing any UI. Tampered/invalid/expired capsule => refuse to launch.
 *   2. Resolve the engine endpoint (capsule.engine.endpoint or env override).
 *   3. Inject endpoint + capsule + token into the preload via env.
 *   4. Open the window for the selected shell variant and load the renderer.
 *
 * All chat/agent/tool/knowledge work happens on the remote engine; this
 * process only renders and captures local devices (camera/mic).
 */
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { verifyCapsule, capsuleWithinLicense } from '../protocol/capsule';
import { resolveEndpoint } from '../protocol/tls';
import type { SignedCapsule } from '../protocol/contract';

// Bundled to CJS for the Electron main; __dirname is provided by the bundler.
function resolveCapsuleDir(): string {
  const candidates = [
    process.env.NEXUS_CAPSULE_DIR,
    path.join(__dirname, '..', 'capsule'),
    path.join(__dirname, '..', 'renderer', 'capsule'),
    process.resourcesPath ? path.join(process.resourcesPath, 'capsule') : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'capsule.json'))
      && fs.existsSync(path.join(candidate, 'public-key.pem'))
    ) {
      return candidate;
    }
  }

  return candidates[0] || path.join(__dirname, '..', 'capsule');
}

const CAPSULE_DIR = resolveCapsuleDir();
const SHELL_VARIANT = process.env.EIG_NEXUS_SHELL || 'next';

const VARIANT_HTML: Record<string, string> = {
  next: 'next.html',
  classic: 'index.html',
  'gaze-voice': 'gaze-voice.html',
  'vision-gestures': 'vision-gestures.html',
  'nate-kb': 'nate-kb.html',
  'eye-contact': 'eye-contact.html',
};

function loadAndVerifyCapsule(): SignedCapsule {
  const manifestPath = path.join(CAPSULE_DIR, 'capsule.json');
  const publicKeyPath = path.join(CAPSULE_DIR, 'public-key.pem');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SignedCapsule;
  const publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
  if (!verifyCapsule(manifest, publicKey)) throw new Error('Capsule signature verification failed.');
  if (!capsuleWithinLicense(manifest)) throw new Error('Capsule license has expired.');
  return manifest;
}

function createWindow(capsule: SignedCapsule) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: capsule.productName || 'NEXUS Next',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload opens a WebSocket to the engine
    },
  });

  const html = VARIANT_HTML[SHELL_VARIANT] || 'next.html';
  const devUrl = process.env.NEXUS_RENDERER_URL; // e.g. http://localhost:5173 in dev
  if (devUrl) win.loadURL(`${devUrl}/${html}`);
  else win.loadFile(path.join(__dirname, '..', 'renderer', html));
}

app.whenReady().then(() => {
  let capsule: SignedCapsule;
  try {
    capsule = loadAndVerifyCapsule();
  } catch (err: any) {
    dialog.showErrorBox('Nexus Next — capsule error', `This build cannot start:\n\n${err?.message ?? err}`);
    app.quit();
    return;
  }

  // Inject config the preload needs to reach the engine. The SIGNED capsule
  // endpoint is authoritative; an env override is honored only if the capsule
  // policy allows it (dev/allowInsecure), otherwise it is ignored.
  const { endpoint, overrideIgnored } = resolveEndpoint(capsule, process.env.NEXUS_ENGINE_ENDPOINT);
  if (overrideIgnored) {
    console.warn(`[shell] Ignoring NEXUS_ENGINE_ENDPOINT override; signed capsule endpoint is authoritative (${endpoint}).`);
  }
  process.env.NEXUS_ENGINE_ENDPOINT = endpoint;
  process.env.NEXUS_CAPSULE_JSON = JSON.stringify(capsule);
  process.env.EIG_NEXUS_SHELL = SHELL_VARIANT;

  createWindow(capsule);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(capsule); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
