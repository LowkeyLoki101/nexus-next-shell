/**
 * Browser `electron` shim for the WEB shell target.
 * Lets the SAME ported preload run in a plain browser:
 *   - contextBridge.exposeInMainWorld(name, api) -> window[name] = api
 *   - clipboard -> navigator.clipboard
 *   - ipcRenderer -> the shared WS engine client (set up by web/bootstrap)
 * Capsule verification is enforced server-side by the engine handshake.
 */
import type { NexusEngineClient } from '../transport/ws-client';

declare global { interface Window { __nexusClient?: NexusEngineClient } }

function client(): NexusEngineClient {
  const c = window.__nexusClient;
  if (!c) throw new Error('Nexus engine client not initialized — call bootstrap() first.');
  return c;
}

export const contextBridge = {
  exposeInMainWorld(name: string, api: unknown) { (window as any)[name] = api; },
};

export const clipboard = {
  writeText: (t: string) => { void navigator.clipboard?.writeText(t); },
  readText: () => '' as string,
};

type L = (event: unknown, ...args: unknown[]) => void;
const unsub = new WeakMap<L, () => void>();
export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => client().invoke(channel, args),
  on: (channel: string, listener: L) => { unsub.set(listener, client().subscribe(channel, (p) => listener({}, p))); return ipcRenderer; },
  once: (channel: string, listener: L) => { const off = client().subscribe(channel, (p) => { off(); listener({}, p); }); return ipcRenderer; },
  removeListener: (_c: string, listener: L) => { unsub.get(listener)?.(); return ipcRenderer; },
  removeAllListeners: () => ipcRenderer,
  send: (channel: string, ...args: unknown[]) => { void client().invoke(channel, args); },
};
