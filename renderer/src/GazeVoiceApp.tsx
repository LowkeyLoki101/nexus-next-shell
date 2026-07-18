import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import rawAudioProcessorWorkletUrl from '../vendor/elevenlabs/rawAudioProcessor.worklet.js?url';
import audioConcatProcessorWorkletUrl from '../vendor/elevenlabs/audioConcatProcessor.worklet.js?url';
import libsamplerateWorkletUrl from '../vendor/elevenlabs/libsamplerate.worklet.js?url';
import {
  assessGaze,
  DEFAULT_GAZE_METRICS,
  drawGazeOverlay,
  type CalibrationBias,
  type GazeAssessment,
} from './lib/eyeContactDetection';
import './gaze-voice.css';

type CameraState = 'booting' | 'tracking' | 'ready' | 'error';
type VoiceState = 'idle' | 'armed' | 'connecting' | 'connected' | 'gaze-muted' | 'error';
type VisionState = 'idle' | 'capturing' | 'analyzing' | 'shared' | 'error';
type TranscriptRole = 'user' | 'assistant' | 'system';

interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  text: string;
  at: number;
  source?: string;
}

interface AmbientSnippet {
  id: string;
  text: string;
  at: number;
  status: 'note' | 'reviewed' | 'error';
}

const nexus = (window as any).nexus;
const GREEN_HOLD_MS = 650;
const RED_MUTE_HOLD_MS = 180;
const AMBIENT_SLICE_MS = 9000;
const VISION_SHARE_COOLDOWN_MS = 45000;

const GAZE_VOICE_RUNTIME_CONTEXT = [
  'You are running inside Nexus Gaze Voice.',
  'When Attention Mute is enabled, the microphone is intentionally gated by eye contact. When the gate is red or muted, do not treat speech as user input and do not infer authorization from muted speech.',
  'Off-gaze scratchpad notes are rough background transcripts. Review them for topic relevance when eye contact returns, ignore background noise, and do not respond to scratchpad notes by themselves.',
  'You do not have continuous video. Use the latest [GAZE_CAMERA_SNAPSHOT] contextual update as the current visual context, and ask for another snapshot if the scene may have changed.',
].join('\n');

const GAZE_VISION_PROMPT = [
  'You are viewing a user-facing camera snapshot during a live Nexus Gaze Voice session.',
  'Describe what is visible in practical terms: people, objects, screens, text, documents, lighting, gestures, and any obvious context that would help a conversational assistant understand the room.',
  'Do not identify any person by name. If a person is visible, describe their position, posture, clothing, and activity without guessing identity.',
  'Call out readable text exactly when possible. Keep the output concise enough to pass into a live voice agent.',
].join('\n');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function rendererAssetUrl(relativePath: string): string {
  return new URL(relativePath, window.location.href).toString();
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function describeRuntimeError(error: unknown, fallback: string): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const text = normalizeWhitespace(raw);
  if (!text) {
    return fallback;
  }

  const leakedSource = text.length > 500
    || /attach(?:EmptyPacketListener|ProtoVectorListener)|normalized_landmarks|world_landmarks|Zc\.prototype|export\s*\{/.test(text);
  if (leakedSource) {
    return `${fallback} The vision runtime returned an unreadable MediaPipe bundle error. Manual voice fallback is active.`;
  }

  return text.length > 260 ? `${text.slice(0, 260)}...` : text;
}

function describeVisionSnapshotError(error: unknown): { message: string; missingKey: boolean } {
  const detail = describeRuntimeError(error, 'Camera snapshot failed.');
  const missingKey = /no vision api key|openai or anthropic api key|api key in settings/i.test(detail);
  if (!missingKey) {
    return { message: detail, missingKey: false };
  }

  return {
    message: 'Vision snapshots need an OpenAI or Anthropic API key in Settings. Voice is still active; camera preview and gaze mute still work.',
    missingKey: true,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio blob.'));
    reader.readAsDataURL(blob);
  });
}

function pickAudioMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];

  return candidates.find((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate);
    } catch {
      return false;
    }
  });
}

function resultToSpokenText(result: any): string {
  if (typeof result?.result === 'string') {
    return result.result;
  }

  const structured = result?.result && typeof result.result === 'object' ? result.result : null;
  return normalizeWhitespace(
    structured?.message
    || structured?.response
    || structured?.summary
    || result?.error
    || ''
  ) || (result?.success ? 'Done' : 'The tool failed.');
}

export default function GazeVoiceApp(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const ambientStreamRef = useRef<MediaStream | null>(null);
  const ambientRecorderRef = useRef<MediaRecorder | null>(null);
  const ambientTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const previousScoreRef = useRef(0);
  const rawLookingRef = useRef(false);
  const rawLookingChangedAtRef = useRef(performance.now());
  const gatedLookingRef = useRef(false);
  const strictnessRef = useRef(0.52);
  const calibrationRef = useRef<CalibrationBias | null>(null);
  const lastAssessmentRef = useRef<GazeAssessment | null>(null);
  const conversationRef = useRef<any>(null);
  const conversationIdRef = useRef('');
  const sessionIdRef = useRef('');
  const voiceStateRef = useRef<VoiceState>('idle');
  const visionStateRef = useRef<VisionState>('idle');
  const voiceArmedRef = useRef(false);
  const cameraStateRef = useRef<CameraState>('booting');
  const attentionMuteRef = useRef(true);
  const scratchpadNotesRef = useRef(false);
  const autoVisionContextRef = useRef(true);
  const queuedScratchpadNotesRef = useRef<string[]>([]);
  const startingConversationRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const sharingVisionRef = useRef(false);
  const visionUnavailableRef = useRef(false);
  const lastVisionShareAtRef = useRef(0);

  const [cameraState, setCameraState] = useState<CameraState>('booting');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [gatedLooking, setGatedLooking] = useState(false);
  const [assessment, setAssessment] = useState<GazeAssessment>({
    looking: false,
    label: 'Starting',
    reason: 'Loading camera',
    metrics: DEFAULT_GAZE_METRICS,
  });
  const [strictness, setStrictness] = useState(0.52);
  const [calibrationLabel, setCalibrationLabel] = useState('Default center');
  const [cameraLabel, setCameraLabel] = useState('Starting camera');
  const [cameraError, setCameraError] = useState('');
  const [sessionLabel, setSessionLabel] = useState('No session');
  const [conversationLabel, setConversationLabel] = useState('Not connected');
  const [attentionMute, setAttentionMute] = useState(true);
  const [scratchpadNotes, setScratchpadNotes] = useState(false);
  const [autoVisionContext, setAutoVisionContext] = useState(true);
  const [ambientState, setAmbientState] = useState('Scratchpad off');
  const [visionState, setVisionState] = useState<VisionState>('idle');
  const [visionLabel, setVisionLabel] = useState('No camera snapshot shared');
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [voiceSetupStatus, setVoiceSetupStatus] = useState('Checking voice setup');
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState('');
  const [savingVoiceSetup, setSavingVoiceSetup] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [ambientSnippets, setAmbientSnippets] = useState<AmbientSnippet[]>([]);
  const [toolLog, setToolLog] = useState<TranscriptEntry[]>([]);
  const [codeMapStatus, setCodeMapStatus] = useState('Code graph not checked');
  const [codeMapStats, setCodeMapStats] = useState<any>(null);
  const [codeMapBusy, setCodeMapBusy] = useState('');

  const setVoiceStatus = useCallback((next: VoiceState) => {
    voiceStateRef.current = next;
    setVoiceState(next);
  }, []);

  const setCameraStatus = useCallback((next: CameraState) => {
    cameraStateRef.current = next;
    setCameraState(next);
  }, []);

  const setVisionStatus = useCallback((next: VisionState) => {
    visionStateRef.current = next;
    setVisionState(next);
  }, []);

  const shouldOpenVoiceGate = useCallback(() => (
    !attentionMuteRef.current || cameraStateRef.current !== 'tracking' || gatedLookingRef.current
  ), []);

  const addLog = useCallback((role: TranscriptRole, text: string, source?: string) => {
    const entry = {
      id: nowId('msg'),
      role,
      text: normalizeWhitespace(text),
      at: Date.now(),
      source,
    };
    if (!entry.text) {
      return;
    }
    setTranscript((current) => [...current.slice(-30), entry]);
  }, []);

  const addToolLog = useCallback((text: string, source?: string) => {
    const entry = {
      id: nowId('tool'),
      role: 'system' as const,
      text: normalizeWhitespace(text),
      at: Date.now(),
      source,
    };
    if (!entry.text) {
      return;
    }
    setToolLog((current) => [...current.slice(-12), entry]);
  }, []);

  const persistTranscript = useCallback(async (role: 'user' | 'assistant', text: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !nexus?.chat?.append) {
      return;
    }

    try {
      await nexus.chat.append(sessionId, role, text);
    } catch (error) {
      console.warn('[GazeVoice] Failed to persist transcript message:', error);
    }
  }, []);

  const ensureNexusSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }

    const session = await nexus.sessions.create(
      `Gaze Voice ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      'Eye-contact gated ElevenLabs voice session.',
    );
    sessionIdRef.current = String(session?.id || '').trim();
    setSessionLabel(session?.name || sessionIdRef.current || 'Gaze Voice');

    try {
      if (sessionIdRef.current) {
        await nexus.settings.set('last_active_session_id', sessionIdRef.current);
      }
    } catch {
      // Non-critical. The explicit session id is still passed to voice tools.
    }

    return sessionIdRef.current;
  }, []);

  const refreshCodeMapStatus = useCallback(async () => {
    if (!nexus?.understand?.status) {
      setCodeMapStatus('Understand-Anything bridge is not available.');
      return null;
    }

    try {
      const status = await nexus.understand.status();
      setCodeMapStats(status?.stats || null);
      setCodeMapStatus(status?.graphExists
        ? `${status.stats?.nodes || 0} nodes · ${status.stats?.edges || 0} edges`
        : 'No code graph found for this workspace.');
      return status;
    } catch (error) {
      const message = describeRuntimeError(error, 'Code graph status failed.');
      setCodeMapStatus(message);
      return null;
    }
  }, []);

  const createGazeCodeMap = useCallback(async () => {
    if (!nexus?.understand?.createDiagram) {
      setCodeMapStatus('Understand-Anything bridge is not available.');
      return;
    }

    setCodeMapBusy('Creating gaze map');
    try {
      const sessionId = await ensureNexusSession();
      const diagram = await nexus.understand.createDiagram({
        mode: 'gaze',
        sessionId,
        show: true,
      });
      const label = `${diagram?.name || 'Gaze code map'} created.`;
      setCodeMapStatus(label);
      addToolLog(label, 'code-map');
      if (conversationRef.current && voiceStateRef.current !== 'idle' && voiceStateRef.current !== 'connecting') {
        conversationRef.current.sendContextualUpdate([
          '[CODEBASE_GRAPH]',
          'A gaze-focused Understand-Anything diagram was created in Nexus.',
          `Diagram: ${diagram?.name || diagram?.id || 'Gaze code map'}`,
          `Graph: ${codeMapStats?.nodes || 'unknown'} nodes, ${codeMapStats?.edges || 'unknown'} edges.`,
        ].join('\n'));
      }
      await refreshCodeMapStatus();
    } catch (error) {
      const message = describeRuntimeError(error, 'Gaze code map creation failed.');
      setCodeMapStatus(message);
      addToolLog(message, 'code-map');
    } finally {
      setCodeMapBusy('');
    }
  }, [addToolLog, codeMapStats?.edges, codeMapStats?.nodes, ensureNexusSession, refreshCodeMapStatus]);

  const ingestCodeMapKnowledge = useCallback(async () => {
    if (!nexus?.understand?.ingestKnowledge) {
      setCodeMapStatus('Understand-Anything bridge is not available.');
      return;
    }

    setCodeMapBusy('Ingesting code KB');
    try {
      const sessionId = await ensureNexusSession();
      const result = await nexus.understand.ingestKnowledge({ sessionId });
      const message = result?.message || 'Code graph knowledge ingested.';
      setCodeMapStatus(message);
      addToolLog(message, 'knowledge');
    } catch (error) {
      const message = describeRuntimeError(error, 'Code graph knowledge ingest failed.');
      setCodeMapStatus(message);
      addToolLog(message, 'knowledge');
    } finally {
      setCodeMapBusy('');
    }
  }, [addToolLog, ensureNexusSession]);

  const shareScratchpadNotes = useCallback((text?: string) => {
    const pendingText = normalizeWhitespace(text || queuedScratchpadNotesRef.current.join('\n'));
    if (!pendingText) {
      return false;
    }

    if (!conversationRef.current || voiceStateRef.current === 'idle' || voiceStateRef.current === 'connecting') {
      queuedScratchpadNotesRef.current = [pendingText];
      return false;
    }

    try {
      conversationRef.current.sendContextualUpdate(
        [
          '[OFF_GAZE_SCRATCHPAD]',
          'These are rough scratchpad notes transcribed while the user was not making eye contact.',
          'Review them for topic relevance now that eye contact is back. Ignore background noise, unrelated speech, TV/audio bleed, and anything that does not connect to the active topic.',
          'Do not reply to these notes by themselves. Use them only if they clarify what the user says next or continue the current topic.',
          pendingText.slice(0, 1800),
        ].join('\n\n')
      );
      queuedScratchpadNotesRef.current = [];
      setAmbientSnippets((current) => current.map((snippet) => (
        pendingText.includes(snippet.text) ? { ...snippet, status: 'reviewed' } : snippet
      )));
      setAmbientState('Scratchpad reviewed');
      addToolLog('Off-gaze scratchpad sent for relevance review.', 'scratchpad');
      return true;
    } catch (error) {
      console.warn('[GazeVoice] Failed to share scratchpad notes:', error);
      queuedScratchpadNotesRef.current = [pendingText];
      return false;
    }
  }, [addToolLog]);

  const transcribeAmbientBlob = useCallback(async (blob: Blob) => {
    if (blob.size < 1200) {
      setAmbientState('Scratchpad slice too quiet');
      return;
    }

    const sessionId = sessionIdRef.current || await ensureNexusSession();
    setAmbientState('Transcribing scratchpad note');
    try {
      const dataUrl = await blobToDataUrl(blob);
      const result = await nexus.voice.transcribe(dataUrl, sessionId);
      const text = normalizeWhitespace(result?.text || '');
      if (!text) {
        setAmbientState('No clear off-gaze speech');
        return;
      }

      const snippet: AmbientSnippet = {
        id: nowId('ambient'),
        text,
        at: Date.now(),
        status: 'note',
      };
      setAmbientSnippets((current) => [...current.slice(-8), snippet]);
      queuedScratchpadNotesRef.current = [...queuedScratchpadNotesRef.current.slice(-3), text];
      setAmbientState(`Scratchpad notes: ${Math.min(4, queuedScratchpadNotesRef.current.length)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scratchpad transcription failed';
      setAmbientState(message);
      setAmbientSnippets((current) => [
        ...current.slice(-8),
        {
          id: nowId('ambient_error'),
          text: message,
          at: Date.now(),
          status: 'error',
        },
      ]);
    }
  }, [ensureNexusSession]);

  const stopAmbientSlice = useCallback(() => {
    if (ambientTimerRef.current !== null) {
      window.clearTimeout(ambientTimerRef.current);
      ambientTimerRef.current = null;
    }

    const recorder = ambientRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        ambientRecorderRef.current = null;
      }
    }
  }, []);

  const startAmbientSlice = useCallback(async () => {
    if (
      ambientRecorderRef.current
      || !scratchpadNotesRef.current
      || !voiceArmedRef.current
      || !attentionMuteRef.current
      || cameraStateRef.current !== 'tracking'
      || gatedLookingRef.current
    ) {
      return;
    }

    try {
      const stream = ambientStreamRef.current || await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
        video: false,
      });
      ambientStreamRef.current = stream;

      const chunks: Blob[] = [];
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      ambientRecorderRef.current = recorder;
      setAmbientState('Taking off-gaze scratchpad note');

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        ambientRecorderRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        void transcribeAmbientBlob(blob).finally(() => {
          if (
            scratchpadNotesRef.current
            && voiceArmedRef.current
            && attentionMuteRef.current
            && cameraStateRef.current === 'tracking'
            && !gatedLookingRef.current
          ) {
            window.setTimeout(() => {
              void startAmbientSlice();
            }, 400);
          }
        });
      };

      recorder.start();
      ambientTimerRef.current = window.setTimeout(() => {
        stopAmbientSlice();
      }, AMBIENT_SLICE_MS);
    } catch (error) {
      setAmbientState(error instanceof Error ? error.message : 'Scratchpad capture unavailable');
    }
  }, [stopAmbientSlice, transcribeAmbientBlob]);

  const applyVoiceGate = useCallback((shouldListen: boolean) => {
    const conversation = conversationRef.current;
    if (!conversation || voiceStateRef.current === 'idle') {
      return;
    }

    const nextShouldListen = !attentionMuteRef.current || shouldListen;
    try {
      conversation.setMicMuted(!nextShouldListen);
      setVoiceStatus(nextShouldListen ? 'connected' : 'gaze-muted');
      addToolLog(
        nextShouldListen
          ? (attentionMuteRef.current ? 'Gaze green: ElevenLabs microphone opened.' : 'Attention Mute off: ElevenLabs microphone open.')
          : 'Gaze red: ElevenLabs microphone muted.',
        'gate',
      );
      if (nextShouldListen && queuedScratchpadNotesRef.current.length > 0) {
        shareScratchpadNotes();
      }
    } catch (error) {
      setVoiceStatus('error');
      addLog('system', error instanceof Error ? error.message : 'Failed to apply gaze voice gate.', 'gate');
    }
  }, [addLog, addToolLog, setVoiceStatus, shareScratchpadNotes]);

  const captureCameraFrameDataUrl = useCallback((): string => {
    const video = videoRef.current;
    if (!cameraStreamRef.current || !video) {
      throw new Error('Camera is not available for a snapshot.');
    }

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('Camera preview is not ready yet. Try again in a moment.');
    }

    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not capture a camera frame.');
    }

    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }, []);

  const shareCameraSnapshot = useCallback(async (reason: 'manual' | 'connect' | 'gaze' = 'manual'): Promise<boolean> => {
    if (sharingVisionRef.current) {
      return false;
    }

    if (visionUnavailableRef.current && reason !== 'manual') {
      return false;
    }
    if (reason === 'manual') {
      visionUnavailableRef.current = false;
    }

    const now = Date.now();
    if (reason !== 'manual' && now - lastVisionShareAtRef.current < VISION_SHARE_COOLDOWN_MS) {
      return false;
    }

    if (!nexus?.images?.analyzeDataUrl) {
      setVisionStatus('error');
      setVisionLabel('Vision analysis is not available in this build');
      return false;
    }

    sharingVisionRef.current = true;
    setVisionStatus('capturing');
    setVisionLabel('Capturing camera snapshot');

    try {
      const sessionId = sessionIdRef.current || await ensureNexusSession();
      const dataUrl = captureCameraFrameDataUrl();
      setVisionStatus('analyzing');
      setVisionLabel('Analyzing camera snapshot');

      const snapshotTitle = `Gaze Voice Camera ${new Date().toLocaleString()}`;
      const analysis = await nexus.images.analyzeDataUrl(dataUrl, {
        sessionId,
        title: snapshotTitle,
        prompt: GAZE_VISION_PROMPT,
      });
      const description = normalizeWhitespace(String(analysis?.description || ''));
      if (!description) {
        throw new Error('Vision analysis returned no description.');
      }

      const snapshotContext = [
        '[GAZE_CAMERA_SNAPSHOT]',
        `Captured: ${new Date().toLocaleString()}`,
        analysis?.path ? `Image file: ${analysis.path}` : '',
        analysis?.provider || analysis?.model ? `Vision model: ${[analysis.provider, analysis.model].filter(Boolean).join(' / ')}` : '',
        'Use this as the current visual context. Do not claim continuous video; ask for another snapshot if the scene may have changed.',
        description,
      ].filter(Boolean).join('\n\n');

      const conversation = conversationRef.current;
      if (conversation && voiceStateRef.current !== 'idle' && voiceStateRef.current !== 'connecting') {
        conversation.sendContextualUpdate(snapshotContext);
      }

      lastVisionShareAtRef.current = Date.now();
      setVisionStatus('shared');
      setVisionLabel(`Snapshot shared: ${description.slice(0, 140)}${description.length > 140 ? '...' : ''}`);
      addToolLog(reason === 'manual' ? 'Camera snapshot shared with Nexus.' : 'Camera snapshot refreshed for Nexus.', 'vision');
      return true;
    } catch (error) {
      const { message, missingKey } = describeVisionSnapshotError(error);
      if (missingKey) {
        visionUnavailableRef.current = true;
      }
      setVisionStatus('error');
      setVisionLabel(message);
      if (reason === 'manual' || !missingKey) {
        addLog('system', message, 'vision-error');
      }
      addToolLog(missingKey ? message : `Camera snapshot failed: ${message}`, 'vision');
      return false;
    } finally {
      sharingVisionRef.current = false;
    }
  }, [addLog, addToolLog, captureCameraFrameDataUrl, ensureNexusSession, setVisionStatus]);

  const endConversation = useCallback(() => {
    stopRequestedRef.current = true;
    voiceArmedRef.current = false;
    setVoiceArmed(false);
    stopAmbientSlice();

    const conversation = conversationRef.current;
    const conversationId = conversationIdRef.current;
    const sessionId = sessionIdRef.current;
    conversationRef.current = null;
    conversationIdRef.current = '';
    setConversationLabel('Not connected');
    setVoiceStatus('idle');
    addToolLog('End requested. Nexus voice is off.', 'voice');

    try {
      conversation?.setMicMuted?.(true);
    } catch {
      // Best effort only; refs and UI state have already been cleared.
    }

    void (async () => {
      if (conversation) {
        try {
          await Promise.race([
            Promise.resolve(conversation.endSession()),
            delay(2500),
          ]);
        } catch {
          // It may already be closed.
        }
      }

      if (conversationId) {
        try {
          const result = await nexus.elevenlabs.endSession(conversationId, sessionId || undefined);
          addToolLog(result?.transcriptStored ? `Transcript stored: ${result.transcriptPath}` : 'Voice session ended.', 'voice');
        } catch (error) {
          addToolLog(describeRuntimeError(error, 'Voice session ended without transcript finalization.'), 'voice');
        }
      }
    })();
  }, [addToolLog, setVoiceStatus, stopAmbientSlice]);

  const startConversation = useCallback(async () => {
    if (startingConversationRef.current || conversationRef.current) {
      return;
    }

    stopRequestedRef.current = false;
    startingConversationRef.current = true;
    setVoiceStatus('connecting');
    setConversationLabel('Connecting');

    try {
      const sessionId = await ensureNexusSession();
      setConversationLabel('Loading voice config');
      const agentConfig = await nexus.elevenlabs.getAgentConfig(sessionId);
      const sessionOptions: Record<string, any> = {};
      let activeConversationId = `conv_${Date.now()}`;

      if (!agentConfig?.agentId) {
        throw new Error('ElevenLabs Agent ID is missing. Save an Agent ID in Settings.');
      }

      if (!agentConfig.hasApiKey) {
        setVoiceSetupOpen(true);
        setVoiceSetupStatus('ElevenLabs API key missing in this app profile');
        throw new Error('ElevenLabs API key is missing in this app profile. Open Voice Setup and save the key.');
      }

      setConversationLabel('Requesting voice URL');
      const { signedUrl } = await nexus.elevenlabs.getSignedUrl();
      if (!signedUrl) {
        throw new Error('ElevenLabs signed URL was empty. Check the API key in Settings.');
      }
      sessionOptions.signedUrl = signedUrl;
      sessionOptions.connectionType = 'websocket';
      addToolLog('Voice config loaded. Using signed ElevenLabs session.', 'voice');

      const clientTools: Record<string, (params: any) => Promise<string>> = {};
      for (const toolDef of agentConfig.toolDefinitions || []) {
        const toolName = String(toolDef?.name || '').trim();
        if (!toolName) {
          continue;
        }

        clientTools[toolName] = async (params: any) => {
          addToolLog(`Executing ${toolName}`, 'tool');
          const result = await nexus.elevenlabs.executeToolCall(
            toolName,
            params || {},
            conversationIdRef.current || activeConversationId,
            sessionId,
          );
          addToolLog(result?.success ? `${toolName} completed` : `${toolName} failed`, 'tool');
          return resultToSpokenText(result);
        };
      }

      setConversationLabel('Opening ElevenLabs voice');
      const conversation = await Conversation.startSession({
        ...sessionOptions,
        workletPaths: {
          rawAudioProcessor: rawAudioProcessorWorkletUrl,
          audioConcatProcessor: audioConcatProcessorWorkletUrl,
        },
        libsampleratePath: libsamplerateWorkletUrl,
        overrides: agentConfig.overrides,
        clientTools,
        onConversationCreated: (createdConversation: any) => {
          conversationRef.current = createdConversation;
          try {
            createdConversation?.setMicMuted?.(stopRequestedRef.current || !shouldOpenVoiceGate());
          } catch {
            // The normal connect/status callbacks will apply the gate again.
          }
        },
        onConnect: ({ conversationId }: { conversationId: string }) => {
          if (stopRequestedRef.current) {
            try {
              conversationRef.current?.setMicMuted?.(true);
            } catch {
              // The start result handler will close the session.
            }
            return;
          }

          activeConversationId = conversationId || activeConversationId;
          conversationIdRef.current = activeConversationId;
          setConversationLabel(activeConversationId);
          addToolLog('ElevenLabs connected.', 'voice');
          applyVoiceGate(shouldOpenVoiceGate());

          window.setTimeout(() => {
            try {
              conversationRef.current?.sendContextualUpdate([
                GAZE_VOICE_RUNTIME_CONTEXT,
                agentConfig.contextualPrompt,
              ].filter(Boolean).join('\n\n'));
            } catch {
              // Keep the live session running if context injection fails.
            }
          }, 250);

          if (autoVisionContextRef.current && shouldOpenVoiceGate()) {
            window.setTimeout(() => {
              void shareCameraSnapshot('connect');
            }, 850);
          }
          if (queuedScratchpadNotesRef.current.length > 0) {
            window.setTimeout(() => {
              shareScratchpadNotes();
            }, 650);
          }
        },
        onDisconnect: (details: any) => {
          addToolLog(`ElevenLabs disconnected${details?.message ? `: ${details.message}` : ''}`, 'voice');
          conversationRef.current = null;
          conversationIdRef.current = '';
          setConversationLabel('Disconnected');
          setVoiceStatus(voiceArmedRef.current ? 'armed' : 'idle');
        },
        onMessage: (message: any) => {
          const text = normalizeWhitespace(String(message?.message || ''));
          if (!text) {
            return;
          }

          const source = String(message?.source || message?.role || '').toLowerCase();
          const isFinal = typeof message?.isFinal === 'boolean' ? message.isFinal : true;
          const role = source === 'user' ? 'user' : 'assistant';
          addLog(role, text, isFinal ? 'voice-final' : 'voice-live');

          if (!isFinal) {
            return;
          }

          if (role === 'user') {
            void nexus.elevenlabs.addTranscript(conversationIdRef.current || activeConversationId, 'user', text);
            void persistTranscript('user', text);
          } else {
            void nexus.elevenlabs.addTranscript(conversationIdRef.current || activeConversationId, 'agent', text);
            void persistTranscript('assistant', text);
          }
        },
        onModeChange: (mode: any) => {
          if (mode?.mode === 'speaking') {
            addToolLog('Nexus speaking.', 'voice');
          }
        },
        onStatusChange: (status: any) => {
          if (status?.status === 'connected') {
            applyVoiceGate(shouldOpenVoiceGate());
          }
        },
        onError: (message: string, context?: any) => {
          const detail = describeRuntimeError(
            context || message,
            message || 'ElevenLabs voice session error.'
          );
          addLog('system', detail, 'voice-error');
          addToolLog(detail, 'voice-error');
          setVoiceStatus('error');
          setConversationLabel('Voice error');
        },
      } as any);

      if (stopRequestedRef.current || !voiceArmedRef.current) {
        try {
          await conversation.endSession();
        } catch {
          // It may already be closed.
        }
        conversationRef.current = null;
        conversationIdRef.current = '';
        setConversationLabel('Not connected');
        setVoiceStatus('idle');
        return;
      }

      conversationRef.current = conversation;
      setConversationLabel('Opening microphone');
      applyVoiceGate(shouldOpenVoiceGate());
    } catch (error) {
      if (stopRequestedRef.current || !voiceArmedRef.current) {
        setConversationLabel('Not connected');
        setVoiceStatus('idle');
        return;
      }

      voiceArmedRef.current = false;
      setVoiceArmed(false);
      const message = describeRuntimeError(error, 'Failed to start ElevenLabs.');
      addLog('system', message, 'voice-error');
      addToolLog(message, 'voice-error');
      setVoiceStatus('error');
      setConversationLabel('Voice start failed');
    } finally {
      startingConversationRef.current = false;
    }
  }, [addLog, addToolLog, applyVoiceGate, ensureNexusSession, persistTranscript, setVoiceStatus, shareCameraSnapshot, shareScratchpadNotes, shouldOpenVoiceGate]);

  const armVoice = useCallback(async () => {
    if (voiceArmedRef.current || startingConversationRef.current) {
      return;
    }

    voiceArmedRef.current = true;
    setVoiceArmed(true);
    stopRequestedRef.current = false;
    addToolLog('Gaze voice armed. Starting Nexus voice; Attention Mute will gate the microphone.', 'gate');

    try {
      await ensureNexusSession();
      await startConversation();
      if (
        scratchpadNotesRef.current
        && attentionMuteRef.current
        && cameraStateRef.current === 'tracking'
        && !gatedLookingRef.current
      ) {
        void startAmbientSlice();
      }
    } catch (error) {
      voiceArmedRef.current = false;
      setVoiceArmed(false);
      setVoiceStatus('error');
      setConversationLabel('Error');
      addLog('system', describeRuntimeError(error, 'Failed to arm Gaze Voice.'), 'voice-error');
    }
  }, [addLog, addToolLog, ensureNexusSession, setVoiceStatus, startAmbientSlice, startConversation]);

  const updateGate = useCallback((rawLooking: boolean, now: number) => {
    if (rawLooking !== rawLookingRef.current) {
      rawLookingRef.current = rawLooking;
      rawLookingChangedAtRef.current = now;
    }

    const holdMs = rawLooking ? GREEN_HOLD_MS : RED_MUTE_HOLD_MS;
    if (rawLooking === gatedLookingRef.current || now - rawLookingChangedAtRef.current < holdMs) {
      return;
    }

    gatedLookingRef.current = rawLooking;
    setGatedLooking(rawLooking);
  }, []);

  const runFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      frameRef.current = requestAnimationFrame(runFrame);
      return;
    }

    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);
    const nextAssessment = assessGaze(result, previousScoreRef.current, strictnessRef.current, calibrationRef.current);
    previousScoreRef.current = nextAssessment.metrics.smoothedScore;
    lastAssessmentRef.current = nextAssessment;
    setAssessment(nextAssessment);
    updateGate(nextAssessment.looking, now);
    drawGazeOverlay(canvas, video, result.faceLandmarks[0], gatedLookingRef.current);
    frameRef.current = requestAnimationFrame(runFrame);
  }, [updateGate]);

  const startCamera = useCallback(async () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;

    setCameraStatus('booting');
    setCameraLabel('Starting camera');
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
      });

      cameraStreamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element is not ready.');
      }

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      try {
        await video.play();
      } catch (error) {
        setCameraError(describeRuntimeError(error, 'Camera stream opened, but preview playback needs a retry.'));
      }

      const videoTrack = stream.getVideoTracks()[0];
      setCameraLabel(videoTrack?.label || 'Camera active');
      setCameraStatus('ready');

      try {
        const vision = await FilesetResolver.forVisionTasks(rendererAssetUrl('./mediapipe/wasm'));
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: rendererAssetUrl('./models/face_landmarker.task'),
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.55,
          minFacePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      } catch (error) {
        const message = describeRuntimeError(error, 'Unable to load gaze tracking.');
        setCameraError(`Camera is open, but gaze tracking is unavailable. Manual voice will still work. ${message}`);
        addToolLog('Camera opened, but gaze tracking is unavailable. Manual voice fallback is active.', 'camera');
        if (voiceArmedRef.current) {
          applyVoiceGate(true);
        }
        return;
      }

      setCameraStatus('tracking');
      frameRef.current = requestAnimationFrame(runFrame);
    } catch (error) {
      const message = describeRuntimeError(error, 'Unable to start camera.');
      setCameraStatus('error');
      setCameraLabel('Camera unavailable');
      setCameraError(`Camera unavailable. Manual voice can still be armed. ${message}`);
      setAssessment({
        looking: false,
        label: 'Camera error',
        reason: message,
        metrics: DEFAULT_GAZE_METRICS,
      });
      addToolLog(`Camera unavailable: ${message}`, 'camera');
      if (voiceArmedRef.current) {
        applyVoiceGate(true);
      }
    }
  }, [addToolLog, applyVoiceGate, runFrame, setCameraStatus]);

  const calibrate = useCallback(() => {
    const current = lastAssessmentRef.current;
    if (!current?.metrics.hasIris) {
      setCalibrationLabel('No eyes locked');
      return;
    }

    calibrationRef.current = {
      leftX: current.metrics.leftX - 0.5,
      rightX: current.metrics.rightX - 0.5,
      leftY: current.metrics.leftY - 0.5,
      rightY: current.metrics.rightY - 0.5,
      yaw: current.metrics.yaw,
      pitch: current.metrics.pitch,
    };
    setCalibrationLabel('Calibrated');
  }, []);

  const resetCalibration = useCallback(() => {
    calibrationRef.current = null;
    setCalibrationLabel('Default center');
  }, []);

  const refreshVoiceSetup = useCallback(async () => {
    try {
      const config = await nexus.elevenlabs.getAgentConfig(sessionIdRef.current || undefined);
      const agentId = String(config?.agentId || '').trim();
      setElevenLabsAgentId((current) => current.trim() || agentId);
      if (config?.hasApiKey) {
        setVoiceSetupStatus('Voice credentials ready');
      } else {
        setVoiceSetupStatus('ElevenLabs API key missing in this app profile');
        setVoiceSetupOpen(true);
      }
    } catch (error) {
      setVoiceSetupStatus(describeRuntimeError(error, 'Voice setup check failed.'));
      setVoiceSetupOpen(true);
    }
  }, []);

  const saveVoiceSetup = useCallback(async () => {
    if (savingVoiceSetup) {
      return;
    }

    const apiKey = elevenLabsApiKey.trim();
    const agentId = elevenLabsAgentId.trim();
    if (!apiKey && !agentId) {
      setVoiceSetupStatus('Enter an API key or Agent ID');
      return;
    }

    setSavingVoiceSetup(true);
    setVoiceSetupStatus('Saving voice settings');
    try {
      if (apiKey) {
        await nexus.settings.set('elevenlabs_api_key', apiKey);
      }
      if (agentId) {
        await nexus.settings.set('elevenlabs_agent_id', agentId);
      }
      setElevenLabsApiKey('');
      setVoiceSetupStatus('Voice settings saved');
      await refreshVoiceSetup();
    } catch (error) {
      setVoiceSetupStatus(describeRuntimeError(error, 'Voice settings save failed.'));
    } finally {
      setSavingVoiceSetup(false);
    }
  }, [elevenLabsAgentId, elevenLabsApiKey, refreshVoiceSetup, savingVoiceSetup]);

  useEffect(() => {
    void startCamera();

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      if (ambientTimerRef.current !== null) {
        window.clearTimeout(ambientTimerRef.current);
      }
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      ambientStreamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
      void endConversation();
    };
  }, [endConversation, startCamera]);

  useEffect(() => {
    void refreshVoiceSetup();
  }, [refreshVoiceSetup]);

  useEffect(() => {
    void refreshCodeMapStatus();
  }, [refreshCodeMapStatus]);

  useEffect(() => {
    strictnessRef.current = strictness;
  }, [strictness]);

  useEffect(() => {
    voiceArmedRef.current = voiceArmed;
  }, [voiceArmed]);

  useEffect(() => {
    attentionMuteRef.current = attentionMute;
    if (!attentionMute) {
      scratchpadNotesRef.current = false;
      setScratchpadNotes(false);
      stopAmbientSlice();
      setAmbientState('Scratchpad off');
    }
  }, [attentionMute, stopAmbientSlice]);

  useEffect(() => {
    scratchpadNotesRef.current = scratchpadNotes;
    if (!scratchpadNotes) {
      stopAmbientSlice();
      setAmbientState('Scratchpad off');
    } else if (voiceArmed && attentionMute && cameraState === 'tracking' && !gatedLooking) {
      void startAmbientSlice();
    }
  }, [attentionMute, cameraState, gatedLooking, scratchpadNotes, startAmbientSlice, stopAmbientSlice, voiceArmed]);

  useEffect(() => {
    autoVisionContextRef.current = autoVisionContext;
  }, [autoVisionContext]);

  useEffect(() => {
    if (!voiceArmed) {
      return;
    }

    const shouldListen = shouldOpenVoiceGate();
    if (shouldListen) {
      stopAmbientSlice();
      if (!conversationRef.current && voiceStateRef.current !== 'connecting') {
        void startConversation();
      } else {
        applyVoiceGate(true);
        if (queuedScratchpadNotesRef.current.length > 0) {
          shareScratchpadNotes();
        }
        if (autoVisionContextRef.current) {
          void shareCameraSnapshot('gaze');
        }
      }
      return;
    }

    if (!conversationRef.current) {
      setVoiceStatus('gaze-muted');
      setConversationLabel('Waiting for eye contact');
    }
    applyVoiceGate(false);
    if (scratchpadNotes && attentionMute && cameraState === 'tracking') {
      void startAmbientSlice();
    } else {
      stopAmbientSlice();
    }
  }, [applyVoiceGate, attentionMute, cameraState, gatedLooking, scratchpadNotes, setVoiceStatus, shareCameraSnapshot, shareScratchpadNotes, shouldOpenVoiceGate, startAmbientSlice, startConversation, stopAmbientSlice, voiceArmed]);

  const scorePercent = Math.round(assessment.metrics.smoothedScore * 100);
  const hasGazeTracking = cameraState === 'tracking';
  const manualVoiceFallback = voiceArmed && !hasGazeTracking;
  const eyeClass = gatedLooking || manualVoiceFallback ? 'is-looking' : 'is-not-looking';
  const voiceSetupNeedsAttention = /missing|failed|enter|empty|error/i.test(voiceSetupStatus);
  const gateLabel = manualVoiceFallback
    ? 'Manual voice'
    : !attentionMute
      ? 'Attention Mute off'
      : gatedLooking
        ? 'Nexus addressable'
        : 'Nexus muted';
  const gateDetail = manualVoiceFallback
    ? 'Gaze tracking is unavailable, so Nexus is listening manually.'
    : !attentionMute
      ? 'ElevenLabs can hear you even when you are not looking.'
      : gatedLooking
        ? 'ElevenLabs can hear you. Scratchpad notes can be reviewed for relevance.'
        : scratchpadNotes
          ? 'Microphone is muted. Off-gaze speech goes to scratchpad notes only.'
          : 'Microphone is hard-muted. Nexus will not receive red-state speech.';
  const cameraStatusLabel = cameraState === 'tracking'
    ? cameraLabel
    : cameraState === 'ready'
      ? `${cameraLabel} · manual fallback`
      : cameraState === 'error'
        ? 'Camera unavailable'
        : 'Starting camera';

  const statusRows = useMemo(() => [
    ['Gate', gateLabel],
    ['Voice', voiceState],
    ['Camera', cameraStatusLabel],
    ['Scratchpad', ambientState],
    ['Vision', visionState],
    ['Session', sessionLabel],
    ['Conversation', conversationLabel],
  ], [ambientState, cameraStatusLabel, conversationLabel, gateLabel, sessionLabel, visionState, voiceState]);

  return (
    <main className={`gaze-voice-app ${eyeClass}`}>
      <section className="gaze-stage" aria-label="Gaze-gated camera and voice state">
        <video ref={videoRef} className="gaze-video-layer" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="gaze-video-layer gaze-overlay" />
        <div className="gaze-stage-shade" />
        <div className="gaze-indicator-card">
          <div className="gaze-light" aria-hidden="true"><span /></div>
          <div>
            <strong>{gateLabel}</strong>
            <span>{gateDetail}</span>
          </div>
        </div>
      </section>

      <aside className="gaze-panel" aria-label="Nexus gaze voice controls">
        <header className="gaze-header">
          <span>Nexus Gaze Voice</span>
          <strong>{voiceArmed ? 'Armed' : 'Manual Start'}</strong>
        </header>

        <div className="gaze-actions">
          <button type="button" onClick={armVoice} disabled={voiceArmed || voiceState === 'connecting'}>
            {voiceState === 'connecting' ? 'Starting' : 'Arm Voice'}
          </button>
          <button type="button" onClick={endConversation}>
            End / Reset
          </button>
        </div>

        <div className="gaze-setup">
          <button
            type="button"
            className="gaze-secondary-button"
            onClick={() => setVoiceSetupOpen((current) => !current)}
          >
            {voiceSetupOpen ? 'Hide Voice Setup' : 'Voice Setup'}
          </button>
          <div className={`gaze-note ${voiceSetupNeedsAttention ? 'gaze-note--warning' : ''}`}>
            {voiceSetupStatus}
          </div>
          {voiceSetupOpen ? (
            <div className="gaze-setup-fields">
              <label className="gaze-field">
                <span>ElevenLabs API Key</span>
                <input
                  type="password"
                  value={elevenLabsApiKey}
                  onChange={(event) => setElevenLabsApiKey(event.currentTarget.value)}
                  autoComplete="off"
                  placeholder="Paste key"
                />
              </label>
              <label className="gaze-field">
                <span>Agent ID</span>
                <input
                  value={elevenLabsAgentId}
                  onChange={(event) => setElevenLabsAgentId(event.currentTarget.value)}
                  autoComplete="off"
                  placeholder="agent_..."
                />
              </label>
              <button
                type="button"
                className="gaze-secondary-button"
                onClick={() => { void saveVoiceSetup(); }}
                disabled={savingVoiceSetup}
              >
                {savingVoiceSetup ? 'Saving' : 'Save Voice Settings'}
              </button>
            </div>
          ) : null}
        </div>

        <div className="gaze-score">
          <div><span style={{ width: `${scorePercent}%` }} /></div>
          <p><span>Eye contact confidence</span><strong>{scorePercent}%</strong></p>
        </div>

        <label className="gaze-slider">
          <span>Sensitivity</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(strictness * 100)}
            onChange={(event) => setStrictness(Number(event.currentTarget.value) / 100)}
          />
        </label>

        <div className="gaze-actions">
          <button type="button" onClick={calibrate} disabled={cameraState !== 'tracking'}>Calibrate</button>
          <button type="button" onClick={resetCalibration}>Reset</button>
        </div>
        <div className="gaze-note">{calibrationLabel}</div>
        {cameraError ? <div className="gaze-note gaze-note--warning">{cameraError}</div> : null}
        {cameraState !== 'tracking' ? (
          <button
            type="button"
            className="gaze-secondary-button"
            onClick={() => { void startCamera(); }}
            disabled={cameraState === 'booting'}
          >
            {cameraState === 'booting' ? 'Starting Camera' : 'Retry Camera'}
          </button>
        ) : null}

        <label className="gaze-toggle">
          <input
            type="checkbox"
            checked={attentionMute}
            onChange={(event) => setAttentionMute(event.currentTarget.checked)}
          />
          <span>Attention Mute</span>
        </label>

        <label className="gaze-toggle">
          <input
            type="checkbox"
            checked={scratchpadNotes}
            onChange={(event) => setScratchpadNotes(event.currentTarget.checked)}
            disabled={!attentionMute}
          />
          <span>Off-Gaze Scratchpad</span>
        </label>

        <label className="gaze-toggle">
          <input
            type="checkbox"
            checked={autoVisionContext}
            onChange={(event) => setAutoVisionContext(event.currentTarget.checked)}
          />
          <span>Share camera snapshot on green gate</span>
        </label>

        <button
          type="button"
          className="gaze-secondary-button"
          onClick={() => shareScratchpadNotes()}
          disabled={queuedScratchpadNotesRef.current.length === 0 || !shouldOpenVoiceGate()}
        >
          Review Scratchpad
        </button>

        <button
          type="button"
          className="gaze-secondary-button"
          onClick={() => { void shareCameraSnapshot('manual'); }}
          disabled={cameraState !== 'tracking' || visionState === 'capturing' || visionState === 'analyzing'}
        >
          {visionState === 'capturing' || visionState === 'analyzing' ? 'Sharing Snapshot' : 'Share Camera Snapshot'}
        </button>
        <div className={`gaze-note ${visionState === 'error' ? 'gaze-note--warning' : ''}`}>{visionLabel}</div>

        <div className="gaze-setup">
          <div className="gaze-note">
            Code Map: {codeMapBusy || codeMapStatus}
          </div>
          <div className="gaze-actions">
            <button
              type="button"
              onClick={() => { void createGazeCodeMap(); }}
              disabled={Boolean(codeMapBusy)}
            >
              Gaze Map
            </button>
            <button
              type="button"
              onClick={() => { void ingestCodeMapKnowledge(); }}
              disabled={Boolean(codeMapBusy)}
            >
              Ingest KB
            </button>
          </div>
        </div>

        <div className="gaze-status-grid">
          {statusRows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </aside>

      <section className="gaze-feed" aria-label="Live transcripts and off-gaze scratchpad">
        <div>
          <h2>Voice Transcript</h2>
          <div className="gaze-feed-list">
            {transcript.length === 0 ? <p>No voice transcript yet.</p> : transcript.map((entry) => (
              <article key={entry.id} className={`gaze-entry ${entry.role}`}>
                <span>{entry.role}</span>
                <p>{entry.text}</p>
              </article>
            ))}
          </div>
        </div>

        <div>
          <h2>Off-Gaze Scratchpad</h2>
          <div className="gaze-feed-list">
            {ambientSnippets.length === 0 ? <p>No scratchpad notes yet.</p> : ambientSnippets.map((snippet) => (
              <article key={snippet.id} className={`gaze-entry ambient ${snippet.status}`}>
                <span>{snippet.status}</span>
                <p>{snippet.text}</p>
              </article>
            ))}
          </div>
        </div>

        <div>
          <h2>Gate Activity</h2>
          <div className="gaze-feed-list compact">
            {toolLog.length === 0 ? <p>Gate and tool events will appear here.</p> : toolLog.map((entry) => (
              <article key={entry.id} className="gaze-entry system">
                <span>{entry.source || 'event'}</span>
                <p>{entry.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
