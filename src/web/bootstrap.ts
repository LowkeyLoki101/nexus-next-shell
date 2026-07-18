/**
 * Web shell bootstrap. Fetches the capsule, opens the engine client, then
 * loads the ported preload (which exposes window.nexus). Import order matters:
 * the client must exist before the preload module evaluates.
 */
import { NexusEngineClient } from '../transport/ws-client';
import { resolveEndpoint } from '../../protocol/tls';
import type { SignedCapsule } from '../../protocol/contract';

export async function bootstrap() {
  const capsule = (await (await fetch('./capsule/capsule.json')).json()) as SignedCapsule;
  // Signed transport.endpoint is authoritative; VITE override only honored when
  // the capsule policy allows it. ws-client also enforces the scheme on connect.
  const { endpoint, overrideIgnored } = resolveEndpoint(capsule, (import.meta as any).env?.VITE_NEXUS_ENGINE_ENDPOINT);
  if (overrideIgnored) console.warn('[shell] Ignoring VITE_NEXUS_ENGINE_ENDPOINT; signed capsule endpoint is authoritative.');

  const client = new NexusEngineClient({
    endpoint,
    capsule,
    shell: { variant: 'next', version: '1.0.0', platform: 'web' },
  });
  window.__nexusClient = client;
  client.connect();
  await client.ready();

  // Late-load the ported preload so window.nexus is populated.
  await import('../../preload/index');
}
