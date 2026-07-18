import type { WorkTraceEvent } from '../../../../shared/work-trace';
import type { NexusPulseMode, NexusPulseSnapshot, NexusPulseState, NexusPulseToolState } from './types';

const MAX_RECENT_EVENTS = 8;

export type NexusPulseAction =
  | { type: 'voice_mode'; mode: NexusPulseState['voiceMode']; statusText?: string }
  | { type: 'transcript'; text?: string }
  | { type: 'caption'; text?: string }
  | { type: 'audio_level'; value: number }
  | { type: 'trace_event'; event: WorkTraceEvent }
  | { type: 'clear_error' }
  | { type: 'reset_tool_mode' };

export const initialNexusPulseState: NexusPulseState = {
  voiceMode: 'idle',
  toolMode: 'idle',
  statusText: 'Emergent Activated',
  transcript: '',
  caption: '',
  currentTool: undefined,
  recentEvents: [],
  audioLevel: 0,
  requiresApproval: false,
  error: undefined,
};

function mapTraceToolPhase(event: WorkTraceEvent): NexusPulseToolState['phase'] {
  switch (event.phase) {
    case 'queued':
      return 'queued';
    case 'started':
    case 'update':
      return 'running';
    case 'artifact':
    case 'complete':
    case 'closed':
      return 'complete';
    case 'error':
      return 'error';
    default:
      return 'running';
  }
}

function dedupeRecentEvents(events: WorkTraceEvent[]): WorkTraceEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  }).slice(0, MAX_RECENT_EVENTS);
}

export function nexusPulseReducer(state: NexusPulseState, action: NexusPulseAction): NexusPulseState {
  switch (action.type) {
    case 'voice_mode':
      return {
        ...state,
        voiceMode: action.mode,
        statusText: action.statusText || state.statusText,
      };
    case 'transcript':
      return {
        ...state,
        transcript: action.text || '',
      };
    case 'caption':
      return {
        ...state,
        caption: action.text || '',
      };
    case 'audio_level':
      return {
        ...state,
        audioLevel: Math.max(0, Math.min(Number(action.value) || 0, 1)),
      };
    case 'clear_error':
      return {
        ...state,
        error: undefined,
      };
    case 'reset_tool_mode':
      return {
        ...state,
        toolMode: 'idle',
        requiresApproval: false,
        currentTool: undefined,
      };
    case 'trace_event': {
      const { event } = action;
      const nextState: NexusPulseState = {
        ...state,
        recentEvents: dedupeRecentEvents([event, ...state.recentEvents]),
        statusText: event.summary || event.label || state.statusText,
      };

      if (event.phase === 'error') {
        nextState.error = event.summary || event.detail || 'Nexus hit an error.';
      } else if (state.error) {
        nextState.error = undefined;
      }

      if (event.kind === 'approval' && event.phase === 'queued') {
        nextState.requiresApproval = true;
        nextState.toolMode = 'idle';
      } else if (event.phase === 'closed') {
        nextState.requiresApproval = false;
        nextState.toolMode = 'idle';
      } else if (event.phase === 'complete' || event.phase === 'artifact') {
        nextState.requiresApproval = false;
      }

      if (event.toolName) {
        nextState.currentTool = {
          id: event.runId,
          name: event.toolName,
          kind: event.kind,
          phase: mapTraceToolPhase(event),
          detail: event.detail || event.summary,
        };
      }

      if (event.phase === 'error') {
        nextState.toolMode = 'idle';
      } else if (event.kind === 'browser' && event.phase !== 'closed') {
        nextState.toolMode = 'browsing';
      } else if (event.kind === 'system' && /thinking|synthesizing|planning/i.test(`${event.label} ${event.summary}`)) {
        nextState.toolMode = 'thinking';
      } else if (event.phase === 'queued' || event.phase === 'started' || event.phase === 'update') {
        nextState.toolMode = 'tool_calling';
      } else if (event.phase === 'complete' || event.phase === 'artifact') {
        nextState.toolMode = 'idle';
      }

      return nextState;
    }
    default:
      return state;
  }
}

export function buildNexusPulseSnapshot(state: NexusPulseState): NexusPulseSnapshot {
  let mode: NexusPulseMode = 'idle';

  if (state.error) {
    mode = 'error';
  } else if (state.requiresApproval) {
    mode = 'needs_confirmation';
  } else if (state.voiceMode === 'speaking') {
    mode = 'speaking';
  } else if (state.toolMode === 'browsing') {
    mode = 'browsing';
  } else if (state.toolMode === 'tool_calling') {
    mode = 'tool_calling';
  } else if (state.toolMode === 'thinking') {
    mode = 'thinking';
  } else if (state.voiceMode === 'transcribing') {
    mode = 'transcribing';
  } else if (state.voiceMode === 'listening') {
    mode = 'listening';
  }

  return {
    mode,
    statusText: state.statusText,
    transcript: state.transcript,
    caption: state.caption,
    currentTool: state.currentTool,
    recentEvents: state.recentEvents,
    audioLevel: state.audioLevel,
    requiresApproval: state.requiresApproval,
    error: state.error,
  };
}
