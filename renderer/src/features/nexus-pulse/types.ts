import type { WorkTraceEvent, WorkTraceKind } from '../../../../shared/work-trace';

export type NexusPulseMode =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'tool_calling'
  | 'browsing'
  | 'speaking'
  | 'needs_confirmation'
  | 'error';

export interface NexusPulseToolState {
  id: string;
  name: string;
  kind: WorkTraceKind;
  phase: 'queued' | 'running' | 'streaming' | 'complete' | 'error';
  detail?: string;
}

export interface NexusPulseSnapshot {
  mode: NexusPulseMode;
  statusText: string;
  transcript?: string;
  caption?: string;
  currentTool?: NexusPulseToolState;
  recentEvents: WorkTraceEvent[];
  audioLevel: number;
  requiresApproval?: boolean;
  error?: string;
}

export interface NexusPulseState {
  voiceMode: 'idle' | 'listening' | 'transcribing' | 'speaking';
  toolMode: 'idle' | 'thinking' | 'tool_calling' | 'browsing';
  statusText: string;
  transcript?: string;
  caption?: string;
  currentTool?: NexusPulseToolState;
  recentEvents: WorkTraceEvent[];
  audioLevel: number;
  requiresApproval?: boolean;
  error?: string;
}
