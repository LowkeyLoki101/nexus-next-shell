/**
 * Ed25519 capsule canonicalization + verification.
 * Identical canonical form on engine and shell so signatures match.
 * Uses Node's crypto on the engine and Electron's bundled Node in the shell.
 */
import crypto from 'node:crypto';
import type { SignedCapsule } from './contract';

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function verifyCapsule(manifest: SignedCapsule, publicKeyPem: string): boolean {
  const sig = manifest?.signature;
  if (!sig || sig.algorithm !== 'ed25519' || !sig.value) return false;
  const unsigned: Record<string, unknown> = { ...manifest };
  delete unsigned.signature;
  try {
    return crypto.verify(null, Buffer.from(canonicalize(unsigned)), publicKeyPem, Buffer.from(sig.value, 'base64'));
  } catch {
    return false;
  }
}

/** Returns true if the capsule license window is still valid (with offline grace). */
export function capsuleWithinLicense(manifest: SignedCapsule, now = new Date()): boolean {
  const rlm = manifest.rlmPolicy;
  if (!rlm?.enabled) return true;
  if (!rlm.expiresAt) return true;
  const expires = new Date(rlm.expiresAt).getTime();
  const grace = (rlm.offlineGraceDays ?? 0) * 86_400_000;
  return now.getTime() <= expires + grace;
}

export function featureMap(manifest: SignedCapsule): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const f of manifest.features ?? []) map[f.id] = !!f.enabled;
  return map;
}
