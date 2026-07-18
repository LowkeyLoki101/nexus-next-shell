import type { WorkTraceEvent, WorkTraceKind, WorkTracePhase } from './work-trace';

export type MissionStatus = 'active' | 'paused' | 'completed' | 'failed';

export type MissionEventType =
  | 'system'
  | 'note'
  | 'snapshot'
  | 'trace'
  | 'artifact'
  | 'failure'
  | 'resume'
  | 'export';

export interface MissionEventRecord {
  id: string;
  missionId: string;
  type: MissionEventType;
  label: string;
  summary: string;
  detail?: string;
  sessionId?: string;
  workTraceId?: string;
  workTracePhase?: WorkTracePhase;
  workTraceKind?: WorkTraceKind;
  toolName?: string;
  artifactPath?: string;
  artifactName?: string;
  timestamp: number;
}

export interface MissionRecord {
  id: string;
  title: string;
  objective: string;
  sessionId?: string;
  status: MissionStatus;
  nextStep: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  eventCount: number;
  artifactCount: number;
  failureCount: number;
  lastEventAt?: number;
  events: MissionEventRecord[];
}

export interface MissionCreateInput {
  title: string;
  objective?: string;
  sessionId?: string;
  nextStep?: string;
}

export interface MissionAppendEventInput {
  type: MissionEventType;
  label: string;
  summary: string;
  detail?: string;
  sessionId?: string;
  workTraceId?: string;
  workTracePhase?: WorkTracePhase;
  workTraceKind?: WorkTraceKind;
  toolName?: string;
  artifactPath?: string;
  artifactName?: string;
  timestamp?: number;
}

export interface MissionUpdateInput {
  title?: string;
  objective?: string;
  status?: MissionStatus;
  nextStep?: string;
  summary?: string;
}

export interface MissionExportResult {
  path: string;
  name: string;
  missionId: string;
  eventCount: number;
}

export function missionEventFromWorkTrace(event: WorkTraceEvent): MissionAppendEventInput {
  const artifactPath = String(event.openTarget?.path || event.payload?.path || '').trim();
  const artifactName = String(
    event.openTarget?.name
    || event.payload?.name
    || (artifactPath ? artifactPath.split(/[\\/]/).pop() : '')
    || '',
  ).trim();

  return {
    type: event.phase === 'error'
      ? 'failure'
      : artifactPath || event.phase === 'artifact'
        ? 'artifact'
        : 'trace',
    label: event.label || event.toolName || 'Work trace event',
    summary: event.summary || event.detail || event.toolName || 'Nexus recorded a work event.',
    detail: event.detail,
    sessionId: event.sessionId,
    workTraceId: event.id,
    workTracePhase: event.phase,
    workTraceKind: event.kind,
    toolName: event.toolName,
    artifactPath: artifactPath || undefined,
    artifactName: artifactName || undefined,
    timestamp: event.timestamp,
  };
}
