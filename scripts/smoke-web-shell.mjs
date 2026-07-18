/**
 * Smoke-test the built web shell against a real headless engine.
 *
 * This catches the black-screen class of failures:
 *   - missing capsule assets
 *   - web bootstrap not creating window.nexus
 *   - renderer crashing before .next-shell mounts
 *   - capsule/engine WebSocket handshake failure
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hybridRoot = path.resolve(root, '..');
const engineRoot = path.resolve(hybridRoot, 'nexus-next-engine');
const args = parseArgs(process.argv.slice(2));

const cfg = {
  shellPort: Number(args.shellPort ?? process.env.NEXUS_SHELL_SMOKE_PORT ?? 5188),
  enginePort: Number(args.enginePort ?? process.env.NEXUS_SHELL_SMOKE_ENGINE_PORT ?? 47900),
  host: args.host ?? process.env.NEXUS_SHELL_SMOKE_HOST ?? '127.0.0.1',
  timeoutMs: Number(args.timeoutMs ?? process.env.NEXUS_SHELL_SMOKE_TIMEOUT_MS ?? 30_000),
  build: args.build !== false,
};

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  config: cfg,
  build: {},
  engine: null,
  page: null,
  consoleErrors: [],
  pageErrors: [],
  finishedAt: null,
};

let engine;
let staticServer;
let chromeProcess;
let chromeProfile;

async function main() {
try {
  if (cfg.build) {
    console.log('[shell-smoke] building shell web assets...');
    report.build.shell = run('npm', ['run', 'build:web'], root);
    console.log('[shell-smoke] building engine...');
    report.build.engine = run('npm', ['run', 'build'], engineRoot);
  } else {
    report.build.skipped = true;
  }

  const publicKey = await fsp.readFile(path.join(root, 'capsule/public-key.pem'), 'utf-8');
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-next-shell-smoke-'));
  engine = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: engineRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXUS_ENGINE_HOST: cfg.host,
      NEXUS_ENGINE_PORT: String(cfg.enginePort),
      NEXUS_CAPSULE_PUBLIC_KEY: publicKey,
      NEXUS_DATA_DIR: dataDir,
      NEXUS_REQUIRE_TOKEN: '0',
      NEXUS_DISABLE_LOCAL_BRIDGES: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  collectLines(engine.stdout, 'engine');
  collectLines(engine.stderr, 'engine:err');
  report.engine = { pid: engine.pid, dataDir, url: `ws://${cfg.host}:${cfg.enginePort}/engine` };

  await waitForHealth();
  staticServer = await serveStatic(path.join(root, 'dist/renderer'), cfg.host, cfg.shellPort);

  const url = `http://${cfg.host}:${cfg.shellPort}/next.html`;
  console.log(`[shell-smoke] opening ${url}`);
  report.page = await runChromeProbe(url);

  report.ok = report.page.hasShell && report.page.hasNexus && report.page.hasClient && !report.page.hasBootstrapError && report.pageErrors.length === 0;
  if (!report.ok) {
    console.error('[shell-smoke] FAIL: shell did not mount cleanly');
  } else {
    console.log('[shell-smoke] PASS: web shell mounted and connected to engine');
  }
} catch (err) {
  report.ok = false;
  report.fatal = { message: err?.message ?? String(err), stack: err?.stack };
  console.error('[shell-smoke] fatal:', err?.stack || err?.message || err);
} finally {
  if (chromeProcess) await stopChild(chromeProcess);
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  if (engine) await stopChild(engine);
  if (chromeProfile) await fsp.rm(chromeProfile, { recursive: true, force: true }).catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeReport(report);
}

process.exit(report.ok ? 0 : 1);
}

function run(command, argv, cwd) {
  const result = spawnSync(command, argv, { cwd, stdio: 'inherit' });
  const summary = { status: result.status, signal: result.signal };
  if (result.status !== 0) throw new Error(`${command} ${argv.join(' ')} failed with status ${result.status}`);
  return summary;
}

async function waitForHealth() {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < cfg.timeoutMs) {
    if (engine.exitCode !== null) throw new Error(`engine exited early with code ${engine.exitCode}`);
    try {
      const res = await fetch(`http://${cfg.host}:${cfg.enginePort}/healthz`);
      if (res.ok) {
        const health = await res.json();
        if (health?.ok && Number(health.channels) > 0) return;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  throw new Error(`engine did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return await res.json();
}

function serveStatic(dir, host, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/next.html' : url.pathname);
    const filePath = path.resolve(dir, pathname.slice(1));
    if (!filePath.startsWith(dir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.stat(filePath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': mime(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log(`[shell-smoke] serving shell at http://${host}:${port}/next.html`);
      resolve(server);
    });
  });
}

async function runChromeProbe(url) {
  const chrome = findChrome();
  const debugPort = await getFreePort(cfg.host);
  chromeProfile = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-next-shell-chrome-'));
  const chromeStderr = [];
  chromeProcess = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-networking',
    `--remote-debugging-address=${cfg.host}`,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.setEncoding('utf-8');
  chromeProcess.stderr.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      chromeStderr.push(line);
      if (chromeStderr.length > 40) chromeStderr.shift();
    }
  });

  await waitForChrome(debugPort);
  const targets = await getJson(`http://${cfg.host}:${debugPort}/json/list`);
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('Chrome DevTools did not expose a page target.');

  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    cdp.on('Runtime.consoleAPICalled', (event) => {
      if (event.type === 'error') {
        report.consoleErrors.push((event.args || []).map((arg) => arg.value || arg.description || '').join(' ').trim());
      }
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      report.pageErrors.push(event.exceptionDetails?.text || event.exceptionDetails?.exception?.description || 'Runtime exception');
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url });

    await waitUntil(async () => {
      const result = await cdp.evaluate(`
        (() => {
          const text = document.body ? document.body.innerText : '';
          return Boolean(document.querySelector('.next-shell')) || text.includes('could not initialize');
        })()
      `);
      return Boolean(result);
    }, cfg.timeoutMs, 'shell did not render or fail visibly');

    const state = await cdp.evaluate(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        return {
          title: document.title,
          hasShell: Boolean(document.querySelector('.next-shell')),
          hasBootstrapError: text.includes('could not initialize'),
          hasCapsuleError: text.includes('NEXUS Next Capsule') && text.includes('could not initialize'),
          hasNexus: Boolean(window.nexus),
          hasClient: Boolean(window.__nexusClient),
          textSample: text.slice(0, 500)
        };
      })()
    `);

    return { url, chrome, debugPort, ...state, chromeStderr };
  } finally {
    cdp.close();
  }
}

class CdpClient {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      const set = this.listeners.get(msg.method);
      if (set) for (const fn of set) fn(msg.params || {});
    });
  }

  on(method, fn) {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(fn);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function getFreePort(host) {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForChrome(port) {
  await waitUntil(async () => {
    try {
      const res = await fetch(`http://${cfg.host}:${port}/json/version`);
      return res.ok;
    } catch {
      return false;
    }
  }, cfg.timeoutMs, 'Chrome DevTools endpoint did not open');
}

async function waitUntil(fn, timeoutMs, message) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(250);
  }
  throw new Error(message);
}

function mime(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function findChrome() {
  const candidates = [
    process.env.NEXUS_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No Chrome-compatible browser found. Set NEXUS_CHROME_BIN to a Chrome/Chromium binary.');
}

function collectLines(stream, prefix) {
  stream.setEncoding('utf-8');
  stream.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      console.log(`[${prefix}] ${line}`);
    }
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2_000).then(() => child.kill('SIGKILL')),
  ]);
}

async function writeReport(data) {
  const dir = path.join(root, 'smoke-results');
  await fsp.mkdir(dir, { recursive: true });
  const stamped = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const latest = path.join(dir, 'latest-web.json');
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await fsp.writeFile(stamped, text);
  await fsp.writeFile(latest, text);
  console.log(`[shell-smoke] report -> ${path.relative(root, stamped)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--no-build') parsed.build = false;
    else if (item.startsWith('--host=')) parsed.host = item.slice('--host='.length);
    else if (item === '--host') parsed.host = argv[++i];
    else if (item.startsWith('--shell-port=')) parsed.shellPort = item.slice('--shell-port='.length);
    else if (item === '--shell-port') parsed.shellPort = argv[++i];
    else if (item.startsWith('--engine-port=')) parsed.enginePort = item.slice('--engine-port='.length);
    else if (item === '--engine-port') parsed.enginePort = argv[++i];
    else if (item.startsWith('--timeout-ms=')) parsed.timeoutMs = item.slice('--timeout-ms='.length);
    else if (item === '--timeout-ms') parsed.timeoutMs = argv[++i];
  }
  return parsed;
}

void main();
