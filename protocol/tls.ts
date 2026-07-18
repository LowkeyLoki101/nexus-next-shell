/**
 * TLS transport-policy enforcement for the shell client.
 *
 * The capsule (signed) carries a TransportPolicy: TLS requirement + SPKI cert
 * pins + optional mTLS. These helpers turn that policy into concrete checks:
 *
 *  - enforceScheme(): reject ws:// unless the signed policy explicitly allows it
 *    (loopback dev only). Browsers can't inspect certs from JS, so this is the
 *    portable baseline both web and Electron shells apply.
 *  - spkiPin(): canonical base64(SHA-256(DER SubjectPublicKeyInfo)) of a cert.
 *  - nodeTlsOptions(): options for the Node `ws` socket (Electron/desktop),
 *    including a checkServerIdentity that pins the server's SPKI.
 */
import type { SignedCapsule, TransportPolicy } from './contract';

export class TransportPolicyError extends Error {
  constructor(message: string, public code: 'tls_pin_mismatch' | 'insecure_transport') {
    super(message);
  }
}

/**
 * Resolve the engine endpoint the shell will connect to.
 *
 * The capsule is signed, so its endpoint is authoritative. An environment
 * override (NEXUS_ENGINE_ENDPOINT / VITE_NEXUS_ENGINE_ENDPOINT) is honored
 * ONLY when the signed policy explicitly permits it (allowInsecure dev
 * capsules) or when the capsule carries no endpoint at all. This prevents an
 * env var from silently redirecting a production shell to an unsigned host.
 */
export function resolveEndpoint(capsule: SignedCapsule | undefined, envOverride?: string): {
  endpoint: string;
  overrideIgnored: boolean;
} {
  const policy = capsule?.transport;
  const signed = policy?.endpoint || (capsule?.engine?.endpoint as string | undefined);
  const overrideAllowed = !signed || policy?.allowInsecure === true;
  if (envOverride && overrideAllowed) return { endpoint: envOverride, overrideIgnored: false };
  if (signed) return { endpoint: signed, overrideIgnored: !!envOverride && !overrideAllowed };
  if (envOverride) return { endpoint: envOverride, overrideIgnored: false };
  return { endpoint: 'ws://127.0.0.1:47900/engine', overrideIgnored: false };
}

export function enforceScheme(endpoint: string, policy?: TransportPolicy): void {
  const isLoopback = /^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(endpoint);
  const requireTls = policy?.requireTls ?? true;
  if (endpoint.startsWith('wss://')) return;
  if (endpoint.startsWith('ws://')) {
    const allowed = policy?.allowInsecure === true && isLoopback;
    if (requireTls && !allowed) {
      throw new TransportPolicyError(
        `Insecure transport ${endpoint} is not permitted by the capsule policy (wss:// required).`,
        'insecure_transport',
      );
    }
    return;
  }
  throw new TransportPolicyError(`Unsupported endpoint scheme: ${endpoint}`, 'insecure_transport');
}

/** Canonical SPKI pin from a DER-encoded certificate (Buffer). */
export function spkiPinFromCertDer(der: Buffer): string {
  const crypto = loadNodeCrypto();
  const x509 = new crypto.X509Certificate(der);
  const spkiDer = x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(spkiDer).digest('base64');
}

function loadNodeCrypto(): typeof import('node:crypto') {
  const requireFn =
    typeof require === 'function'
      ? require
      : typeof (globalThis as any).require === 'function'
        ? (globalThis as any).require
        : undefined;
  if (!requireFn) throw new Error('SPKI pinning requires Node/Electron crypto support.');
  return requireFn('node:crypto') as typeof import('node:crypto');
}

/**
 * Node/Electron-only TLS options for the `ws` socket. Returns undefined when no
 * pinning/mTLS is required (default verification still applies).
 */
export function nodeTlsOptions(policy?: TransportPolicy): Record<string, unknown> | undefined {
  if (!policy) return undefined;
  const opts: Record<string, unknown> = { rejectUnauthorized: true };
  if (policy.minTlsVersion) opts.minVersion = policy.minTlsVersion;
  const pins = policy.tlsPins ?? [];
  if (pins.length > 0) {
    opts.checkServerIdentity = (_host: string, cert: { raw?: Buffer }) => {
      try {
        if (!cert?.raw) return new Error('No peer certificate to pin against.');
        const pin = spkiPinFromCertDer(cert.raw);
        if (!pins.includes(pin)) {
          return new TransportPolicyError(`Server SPKI pin ${pin} not in capsule pin set.`, 'tls_pin_mismatch');
        }
        return undefined; // pinned and trusted
      } catch (e) {
        return e instanceof Error ? e : new Error('SPKI pin check failed.');
      }
    };
  }
  // mTLS client cert/key are provisioned per-deployment via env (NEXUS_CLIENT_CERT/KEY).
  if (policy.requireClientCert) {
    const cert = process.env.NEXUS_CLIENT_CERT_PEM?.replace(/\\n/g, '\n');
    const key = process.env.NEXUS_CLIENT_KEY_PEM?.replace(/\\n/g, '\n');
    if (cert && key) { opts.cert = cert; opts.key = key; }
  }
  return opts;
}
