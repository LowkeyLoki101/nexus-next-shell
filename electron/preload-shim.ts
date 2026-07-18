/**
 * `electron` shim for the SHELL PRELOAD.
 *
 * The real preload imports `{ clipboard, contextBridge, ipcRenderer } from 'electron'`.
 * The shell build rewrites that import to this module (see build plugin), so:
 *   - contextBridge, clipboard  -> the REAL electron (client-side, unchanged)
 *   - ipcRenderer               -> a WS-backed drop-in that forwards every
 *                                  invoke/on/removeListener to the remote engine.
 *
 * Net effect: the entire 66KB preload and the whole renderer run UNMODIFIED,
 * but every channel call now crosses the network to the engine — identical
 * behavior, split across the wire.
 */
// `electron-real` is resolved to the genuine electron module by the build plugin.
import { contextBridge, clipboard } from 'electron-real';
import { NexusEngineClient } from '../src/transport/ws-client';
import type { SignedCapsule } from '../protocol/contract';

function readConfig(): { endpoint: string; capsule: SignedCapsule; token?: string } {
  // The Electron main verifies the capsule, then injects config via env.
  const endpoint = process.env.NEXUS_ENGINE_ENDPOINT || 'ws://127.0.0.1:47900/engine';
  const capsule = JSON.parse(process.env.NEXUS_CAPSULE_JSON || '{}') as SignedCapsule;
  const token = process.env.NEXUS_SESSION_TOKEN || undefined;
  return { endpoint, capsule, token };
}

const cfg = readConfig();
const client = new NexusEngineClient({
  endpoint: cfg.endpoint,
  capsule: cfg.capsule,
  token: cfg.token,
  shell: { variant: process.env.EIG_NEXUS_SHELL || 'next', version: process.env.NEXUS_SHELL_VERSION || '1.0.0', platform: process.platform },
  onStatus: (s, d) => { try { contextBridge.exposeInMainWorld; } catch { /* noop */ } void s; void d; },
});
client.connect();

// Track on()->listener mappings so removeListener() can unsubscribe precisely.
type RendererListener = (event: unknown, ...args: unknown[]) => void;
const unsubByListener = new WeakMap<RendererListener, () => void>();

export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => client.invoke(channel, args),
  on: (channel: string, listener: RendererListener) => {
    const off = client.subscribe(channel, (payload) => listener({}, payload));
    unsubByListener.set(listener, off);
    return ipcRenderer;
  },
  once: (channel: string, listener: RendererListener) => {
    const off = client.subscribe(channel, (payload) => { off(); listener({}, payload); });
    return ipcRenderer;
  },
  removeListener: (_channel: string, listener: RendererListener) => {
    unsubByListener.get(listener)?.();
    unsubByListener.delete(listener);
    return ipcRenderer;
  },
  removeAllListeners: (_channel?: string) => ipcRenderer,
  // send is fire-and-forget; map to an invoke we don't await.
  send: (channel: string, ...args: unknown[]) => { void client.invoke(channel, args); },
};

export { contextBridge, clipboard };
export const __engineClient = client;
