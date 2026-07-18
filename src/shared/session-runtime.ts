export type SessionMode = 'chat' | 'text_session' | 'voice_session';

export type SessionStatus =
  | 'idle'
  | 'planning'
  | 'acting'
  | 'waiting'
  | 'needs_approval'
  | 'paused'
  | 'ended'
  | 'error';

export type StageMode = 'research' | 'prepare' | 'present';

export type RetryRecommendation = 'retry' | 'pivot' | 'ask_user' | 'wait' | 'end';

export interface RuntimeWondering {
  id: string;
  question: string;
  answer?: string;
  source?: string;
}

export interface SessionTurnPacket {
  objective: string;
  currentTask?: string;
  whyNow: string;
  lastAction?: string;
  lastOutcome?: 'success' | 'partial' | 'failed' | 'blocked';
  finished: boolean;
  retryRecommendation: RetryRecommendation;
  availableTools: string[];
  platformControls: string[];
  wonderings: RuntimeWondering[];
}

export interface SessionRuntimeState {
  sessionId: string;
  mode: SessionMode;
  status: SessionStatus;
  stageMode: StageMode;
  objective: string;
  currentTask?: string;
  lastAction?: string;
  lastOutcome?: 'success' | 'partial' | 'failed' | 'blocked';
  blocker?: string;
  cycleCount: number;
  availableTools: string[];
  platformControls: string[];
  wonderings: RuntimeWondering[];
  lastTurnPacket?: SessionTurnPacket;
  updatedAt: number;
  startedAt: number;
  lastTrigger?: string;
}

export interface SessionRuntimeStartOptions {
  mode?: SessionMode;
  objective?: string;
  trigger?: string;
  runInitialCycle?: boolean;
}

export interface SessionRuntimeCycleOptions {
  objective?: string;
  trigger?: string;
}

export function createDefaultSessionRuntimeState(
  sessionId: string,
  availableTools: string[] = [],
  platformControls: string[] = [],
): SessionRuntimeState {
  const now = Date.now();
  return {
    sessionId,
    mode: 'chat',
    status: 'idle',
    stageMode: 'research',
    objective: '',
    currentTask: '',
    lastAction: '',
    lastOutcome: undefined,
    blocker: '',
    cycleCount: 0,
    availableTools,
    platformControls,
    wonderings: [],
    lastTurnPacket: undefined,
    updatedAt: now,
    startedAt: now,
    lastTrigger: 'bootstrap',
  };
}

export function normalizeSessionMode(value: unknown): SessionMode {
  switch (String(value || '').trim().toLowerCase()) {
    case 'text_session':
      return 'text_session';
    case 'voice_session':
      return 'voice_session';
    default:
      return 'chat';
  }
}

export function normalizeSessionStatus(value: unknown): SessionStatus {
  switch (String(value || '').trim().toLowerCase()) {
    case 'planning':
    case 'acting':
    case 'waiting':
    case 'needs_approval':
    case 'paused':
    case 'ended':
    case 'error':
      return String(value).trim().toLowerCase() as SessionStatus;
    default:
      return 'idle';
  }
}

export function normalizeStageMode(value: unknown): StageMode {
  switch (String(value || '').trim().toLowerCase()) {
    case 'prepare':
      return 'prepare';
    case 'present':
      return 'present';
    default:
      return 'research';
  }
}
