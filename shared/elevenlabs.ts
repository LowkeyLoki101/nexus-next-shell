export const DEFAULT_ELEVENLABS_AGENT_NAME = 'EIG Nexus';
export const DEFAULT_ELEVENLABS_AGENT_ID = 'agent_1201kncsmgwpef190xnx857h6czc';
export const DEFAULT_ELEVENLABS_VOICE_ID = '6Ukf8wW2VPW3sNdorRI7';

export function resolveElevenLabsAgentId(value?: string | null): string {
  return String(value || '').trim() || DEFAULT_ELEVENLABS_AGENT_ID;
}

export function resolveElevenLabsVoiceId(value?: string | null): string {
  return String(value || '').trim() || DEFAULT_ELEVENLABS_VOICE_ID;
}
