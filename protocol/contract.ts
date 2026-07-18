/**
 * Nexus Next — Hybrid wire protocol (shared contract).
 *
 * The desktop/web SHELL renders the UI and captures local devices
 * (camera, mic, gaze, gestures). The server ENGINE runs the agent
 * orchestration, LLM calls, tools, knowledge graph and database.
 *
 * The two halves speak this protocol over a single authenticated
 * WebSocket. It is a 1:1 transport for the existing Electron IPC
 * surface: every `ipcMain.handle(channel, fn)` in the engine maps to
 * an `invoke` frame, and every pushed event (`webContents.send`) maps
 * to an `event` frame. Keeping this mapping is what preserves
 * identical behavior ("same results") after the split.
 *
 * Protocol id: nexus-hybrid/1
 */
export const PROTOCOL_ID = 'nexus-hybrid/1';

/** Frames sent by the SHELL (client) to the ENGINE (server). */
export type ClientFrame =
  | HelloFrame
  | InvokeFrame
  | SubscribeFrame
  | UnsubscribeFrame
  | PingFrame;

/** Frames sent by the ENGINE (server) to the SHELL (client). */
export type ServerFrame =
  | WelcomeFrame
  | ResultFrame
  | ErrorFrame
  | EventFrame
  | PongFrame;

/** Auth + capability handshake. Sent once, first frame. */
export interface HelloFrame {
  type: 'hello';
  protocol: typeof PROTOCOL_ID;
  /** Signed Ed25519 capsule manifest the shell was provisioned with. */
  capsule: SignedCapsule;
  /** Bearer session token issued out-of-band (or 'capsule' for capsule-only auth). */
  token?: string;
  /** Shell build + channel for telemetry / feature gating. */
  shell: { variant: string; version: string; platform: string };
}

export interface WelcomeFrame {
  type: 'welcome';
  protocol: typeof PROTOCOL_ID;
  sessionId: string;
  /** Server-resolved feature flags from the verified capsule manifest. */
  features: Record<string, boolean>;
  engine: { version: string; channel: string };
}

/** Request/response — mirrors ipcRenderer.invoke(channel, ...args). */
export interface InvokeFrame {
  type: 'invoke';
  id: string;
  channel: string;
  args: unknown[];
}
export interface ResultFrame {
  type: 'result';
  id: string;
  value: unknown;
}
export interface ErrorFrame {
  type: 'error';
  id?: string;
  code: ErrorCode;
  message: string;
  detail?: unknown;
}

/** Push channel — mirrors webContents.send(channel, payload). */
export interface SubscribeFrame { type: 'subscribe'; channel: string; }
export interface UnsubscribeFrame { type: 'unsubscribe'; channel: string; }
export interface EventFrame { type: 'event'; channel: string; payload: unknown; }

export interface PingFrame { type: 'ping'; ts: number; }
export interface PongFrame { type: 'pong'; ts: number; }

export type ErrorCode =
  | 'unauthenticated'
  | 'capsule_invalid'
  | 'capsule_expired'
  | 'feature_denied'
  | 'unknown_channel'
  | 'handler_error'
  | 'bad_request'
  | 'rate_limited'
  | 'tls_pin_mismatch'
  | 'insecure_transport';

/**
 * Transport security policy. Lives INSIDE the signed capsule so the pins and
 * TLS requirements cannot be altered without invalidating the signature.
 */
export interface TransportPolicy {
  /** wss:// endpoint. ws:// is only honored when allowInsecure is true. */
  endpoint: string;
  /** Require TLS (wss://). Default true; only loopback dev may set false. */
  requireTls?: boolean;
  /** Explicitly permit ws:// (loopback dev only). */
  allowInsecure?: boolean;
  /**
   * Certificate pinning: base64 SHA-256 digests of the server cert's
   * SubjectPublicKeyInfo (SPKI). If non-empty, the shell rejects any TLS peer
   * whose SPKI pin is not in this set. Include a backup pin for rotation.
   */
  tlsPins?: string[];
  /** Minimum TLS version, e.g. "TLSv1.2" | "TLSv1.3". */
  minTlsVersion?: 'TLSv1.2' | 'TLSv1.3';
  /** Require mutual TLS (client presents a cert). Cert provisioning is per-deployment. */
  requireClientCert?: boolean;
}

/** Ed25519-signed capsule manifest (trust + licensing boundary). */
export interface SignedCapsule {
  schemaVersion: number;
  capsuleId: string;
  productName: string;
  version: string;
  channel: string;
  issuedAt: string;
  brand?: Record<string, unknown>;
  engine?: Record<string, unknown>;
  /** Signed transport security policy (TLS requirement + cert pinning + mTLS). */
  transport?: TransportPolicy;
  rlmPolicy?: {
    enabled: boolean;
    licenseMode: string;
    maxSeats: number;
    offlineGraceDays: number;
    renewalRequired: boolean;
    expiresAt?: string;
  };
  dataPolicy?: Record<string, unknown>;
  features?: Array<{ id: string; label: string; enabled: boolean }>;
  permissions?: Record<string, unknown>;
  signature: { algorithm: 'ed25519'; signedAt: string; value: string };
}
