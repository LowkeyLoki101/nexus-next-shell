import { useMemo, useReducer } from 'react';
import type { WorkTraceEvent } from '../../../../shared/work-trace';
import { buildNexusPulseSnapshot, initialNexusPulseState, nexusPulseReducer } from './nexusPulseReducer';

export function useNexusPulse() {
  const [state, dispatch] = useReducer(nexusPulseReducer, initialNexusPulseState);

  const snapshot = useMemo(() => buildNexusPulseSnapshot(state), [state]);

  return {
    snapshot,
    dispatch,
    actions: {
      setVoiceMode: (mode: 'idle' | 'listening' | 'transcribing' | 'speaking', statusText?: string) => {
        dispatch({ type: 'voice_mode', mode, statusText });
      },
      setTranscript: (text?: string) => {
        dispatch({ type: 'transcript', text });
      },
      setCaption: (text?: string) => {
        dispatch({ type: 'caption', text });
      },
      setAudioLevel: (value: number) => {
        dispatch({ type: 'audio_level', value });
      },
      applyTraceEvent: (event: WorkTraceEvent) => {
        dispatch({ type: 'trace_event', event });
      },
      clearError: () => {
        dispatch({ type: 'clear_error' });
      },
      resetToolMode: () => {
        dispatch({ type: 'reset_tool_mode' });
      },
    },
  };
}
