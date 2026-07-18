/**
 * Nexus Next — shell-side WebSocket client.
 *
 * Speaks the nexus-hybrid/1 protocol to the remote engine. Provides an
 * invoke/subscribe surface that the preload's `ipcRenderer` shim maps onto,
 * so the unmodified preload (and therefore the unmodified renderer) talks to
 * a remote engine instead of a local Electron main process.
 *
 * Isomorphic: uses the global WebSocket in the browser, or the `ws` package
 * inside an Electron preload (Node) context.
 */
import { PROTOCOL_ID } from '../../protocol/contract';
import type { ClientFrame, ServerFrame, SignedCapsule, TransportPolicy } from '../../protocol/contract';
import { enforceScheme, nodeTlsOptions, TransportPolicyError } from '../../protocol/tls';

type Listener = (payload: unknown) => void;

export interface WsClientOptions {
  endpoint: string;            // wss://engine.example.com/engine
  capsule: SignedCapsule;
  token?: string;
  shell: { variant: string; version: string; platform: string };
  /** ms between reconnect attempts (capped exponential). */
  reconnectBaseMs?: number;
  onStatus?: (s: 'connecting' | 'open' | 'closed' | 'welcome' | 'error', detail?: unknown) => void;
}

function makeSocket(url: string, policy?: TransportPolicy): WebSocket {
  const G: any = globalThis as any;
  const requireFn =
    typeof require === 'function'
      ? require
      : typeof G.require === 'function'
        ? G.require
        : undefined;

  if (requireFn && typeof process !== 'undefined' && (process as any).versions?.electron) {
    const WS = requireFn('ws');
    const tls = nodeTlsOptions(policy);
    return (tls ? new WS(url, tls) : new WS(url)) as unknown as WebSocket;
  }

  // Browser: the engine cert is validated by the browser's CA/HSTS; JS cannot
  // inspect it, so SPKI pinning is enforced only on the Node/Electron path.
  if (typeof G.WebSocket !== 'undefined') return new G.WebSocket(url);
  if (!requireFn) throw new Error('No WebSocket implementation available.');
  const tls = nodeTlsOptions(policy);
  const WS = requireFn('ws');
  return (tls ? new WS(url, tls) : new WS(url)) as unknown as WebSocket;
}

export class NexusEngineClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private listeners = new Map<string, Set<Listener>>();
  private subscribedOnWire = new Set<string>();
  private seq = 0;
  private welcomed = false;
  private features: Record<string, boolean> = {};
  private closedByUser = false;
  private reconnectAttempts = 0;
  private readyResolvers: Array<() => void> = [];

  constructor(private opts: WsClientOptions) {}

  get featureFlags(): Record<string, boolean> { return { ...this.features }; }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const policy = this.opts.capsule?.transport;
    // Fail closed on insecure transport before any socket is opened.
    try {
      enforceScheme(this.opts.endpoint, policy);
    } catch (e) {
      if (e instanceof TransportPolicyError) {
        this.closedByUser = true; // do not reconnect to a disallowed endpoint
        this.opts.onStatus?.('error', e);
        for (const [, p] of this.pending) p.reject(e);
        this.pending.clear();
        return;
      }
      throw e;
    }
    this.opts.onStatus?.('connecting');
    const ws = makeSocket(this.opts.endpoint, policy);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.send({ type: 'hello', protocol: PROTOCOL_ID, capsule: this.opts.capsule, token: this.opts.token, shell: this.opts.shell });
    };
    ws.onmessage = (ev: MessageEvent) => this.onFrame(JSON.parse(String((ev as any).data)) as ServerFrame);
    ws.onerror = (e: any) => this.opts.onStatus?.('error', e);
    ws.onclose = () => {
      this.welcomed = false;
      this.opts.onStatus?.('closed');
      // reject in-flight invokes so callers don't hang
      for (const [, p] of this.pending) p.reject(new Error('engine connection closed'));
      this.pending.clear();
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const base = this.opts.reconnectBaseMs ?? 750;
    const delay = Math.min(base * 2 ** this.reconnectAttempts++, 15_000);
    setTimeout(() => { if (!this.closedByUser) this.open(); }, delay);
  }

  close(): void { this.closedByUser = true; this.ws?.close(); }

  /** Resolves once the engine has welcomed this connection. */
  ready(): Promise<void> {
    if (this.welcomed) return Promise.resolve();
    return new Promise((res) => this.readyResolvers.push(res));
  }

  private onFrame(f: ServerFrame): void {
    switch (f.type) {
      case 'welcome':
        this.welcomed = true;
        this.features = f.features ?? {};
        this.opts.onStatus?.('welcome', f);
        this.opts.onStatus?.('open');
        // re-subscribe channels after a reconnect
        for (const ch of this.subscribedOnWire) this.send({ type: 'subscribe', channel: ch });
        this.readyResolvers.splice(0).forEach((r) => r());
        break;
      case 'result': {
        const p = this.pending.get(f.id); if (!p) return;
        this.pending.delete(f.id); p.resolve(f.value);
        break;
      }
      case 'error': {
        if (f.id) { const p = this.pending.get(f.id); if (p) { this.pending.delete(f.id); p.reject(Object.assign(new Error(f.message), { code: f.code, detail: f.detail })); } }
        else this.opts.onStatus?.('error', f);
        break;
      }
      case 'event': {
        const set = this.listeners.get(f.channel);
        if (set) for (const l of set) { try { l(f.payload); } catch (e) { console.error('listener error', e); } }
        break;
      }
      case 'pong': break;
    }
  }

  private send(frame: ClientFrame): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) this.ws.send(JSON.stringify(frame));
  }

  /** ipcRenderer.invoke(channel, ...args) */
  async invoke(channel: string, args: unknown[]): Promise<unknown> {
    await this.ready();
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'invoke', id, channel, args });
    });
  }

  /** ipcRenderer.on(channel, listener) -> returns unsubscribe */
  subscribe(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) { set = new Set(); this.listeners.set(channel, set); }
    set.add(listener);
    if (!this.subscribedOnWire.has(channel)) {
      this.subscribedOnWire.add(channel);
      this.send({ type: 'subscribe', channel });
    }
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        this.subscribedOnWire.delete(channel);
        this.send({ type: 'unsubscribe', channel });
      }
    };
  }
}
