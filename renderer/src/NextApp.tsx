import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import rawAudioProcessorWorkletUrl from '../vendor/elevenlabs/rawAudioProcessor.worklet.js?url';
import audioConcatProcessorWorkletUrl from '../vendor/elevenlabs/audioConcatProcessor.worklet.js?url';
import libsamplerateWorkletUrl from '../vendor/elevenlabs/libsamplerate.worklet.js?url';
import type {
  SessionRuntimeState,
  SessionMode,
  SessionStatus,
  StageMode,
} from '../../shared/session-runtime';
import type { MissionRecord } from '../../shared/mission-recorder';
import ContractDraftingPanel from './ContractDraftingPanel';
import PrivateProfilePanel from './PrivateProfilePanel';
import MissionRecorderPanel from './MissionRecorderPanel';
import YouTubeKnowledgeWorkbench from './YouTubeKnowledgeWorkbench';
import {
  assessGaze,
  DEFAULT_GAZE_METRICS,
  type GazeAssessment,
} from './lib/eyeContactDetection';
import { useListStaggerMotion, useStageSwapMotion } from './lib/aiFocusMotion';
import './next-shell.css';

type SurfaceTab = 'chat' | 'ai-focus' | 'missions' | 'workstation' | 'knowledge-base';
type DockMode = 'full' | 'collapsed';
type HeaderPanelKind = 'diary' | 'statistics' | 'task-queue' | 'entity-crm' | 'research' | 'influencer-studio' | 'html-studio' | 'bugs' | 'settings' | 'info' | 'marketing' | 'contract-drafting' | 'private-profile' | null;
type StageKind = 'activity' | 'browser' | 'legal' | 'artifact' | 'graph' | 'panel' | 'inspection' | 'diagram';
type ConversationStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type ConversationMode = 'idle' | 'listening' | 'speaking';
type EyeContactControlStatus = 'off' | 'starting' | 'looking' | 'away' | 'error';
type WorkTracePhase = 'queued' | 'started' | 'update' | 'artifact' | 'complete' | 'error' | 'closed';
type WorkTraceKind =
  | 'system'
  | 'search'
  | 'browser'
  | 'file'
  | 'artifact'
  | 'contract'
  | 'legal'
  | 'crm'
  | 'diagram'
  | 'image'
  | 'agent'
  | 'approval'
  | 'unknown';
type NexusPulseMode = 'idle' | 'connecting' | 'listening' | 'thinking' | 'tooling' | 'browsing' | 'speaking' | 'approval' | 'error';

const HIDDEN_VOICE_RESUME_PREFIX = '[NEXUS_RESUME_SIGNAL]';
const MAX_VOICE_AUTO_RESUME_ATTEMPTS = 2;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const SCROLL_BOTTOM_TARGET_SELECTOR = [
  '.next-side-rail',
  '.next-session-list',
  '.next-chat-sidebar',
  '.next-chat-timeline',
  '.next-workstation-left',
  '.next-workstation-right',
  '.next-workstation-preview',
  '.next-stage-scroll',
  '.next-diagram-scroll',
  '.next-browser-results',
  '.next-browser-article',
  '.next-browser-page',
  '.next-header-panel',
  '.next-knowledge-sidebar',
  '.next-mission-sidebar',
  '.next-mission-feed',
  '.next-mission-inspector',
  '.next-marketing-inspector',
  '.next-diary-reader-copy',
].join(', ');

function isVoiceTimeoutReason(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return /llm response took too long|generating the llm response|voice session timed out/.test(normalized);
}

function isIntentionalVoiceDisconnect(details: any, reason: unknown): boolean {
  const normalized = String(reason || '').trim().toLowerCase();
  if (/manual stop|manually stopped|user ended|ended by user|stopped by user|user requested|normal closure/.test(normalized)) {
    return true;
  }

  const closeCode = Number(
    details?.code
    ?? details?.closeCode
    ?? details?.context?.code
    ?? details?.context?.closeCode,
  );

  return Number.isFinite(closeCode) && closeCode === 1000 && !normalized;
}

function shouldAutoResumeVoiceDisconnect(details: any, reason: unknown, manualStop: boolean): boolean {
  if (manualStop || isIntentionalVoiceDisconnect(details, reason)) {
    return false;
  }

  const normalized = String(reason || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (isVoiceTimeoutReason(normalized)) {
    return true;
  }

  if (/invalid api key|agent id is missing|microphone capture is not supported|permission denied/.test(normalized)) {
    return false;
  }

  return true;
}

function describeVoiceInitError(error: unknown): string {
  const rawMessage = String((error as any)?.message || error || '').trim();
  const rawName = String((error as any)?.name || '').trim();
  const normalized = `${rawName} ${rawMessage}`.toLowerCase();

  if (/notallowederror|permission denied|permission dismissed|microphone access denied|denied access to microphone/.test(normalized)) {
    return 'Microphone permission was denied. Allow microphone access for EIG Nexus and try again.';
  }

  if (/notfounderror|requested device not found|no microphone|no audio input|device not found/.test(normalized)) {
    return 'No microphone input device was found. Connect or enable a microphone and try again.';
  }

  if (/notreadableerror|track start error|device in use|could not start audio source|hardware error/.test(normalized)) {
    return 'The microphone is unavailable or already in use by another app. Close other apps using the mic and try again.';
  }

  if (/api error \(401\)|needs_authorization|authorization header|xi-api-key|invalid api key/.test(normalized)) {
    return 'ElevenLabs rejected the API credentials used for voice startup. Re-save the ElevenLabs API key in Settings and try again.';
  }

  if (/agent id is missing|agent id not configured/.test(normalized)) {
    return 'ElevenLabs Agent ID is missing. Open Settings and save a valid agent.';
  }

  if (/could not resolve api\\.elevenlabs\\.io|enotfound|eai_again/.test(normalized)) {
    return 'Nexus could not reach ElevenLabs. Check network, DNS, VPN, or firewall settings and try again.';
  }

  if (/failed to fetch|networkerror|network request failed|websocket|connection/.test(normalized)) {
    return 'Nexus could not establish the ElevenLabs voice channel. Check network access and try again.';
  }

  return rawMessage || 'Unknown ElevenLabs startup error.';
}

function stopMediaStreamTracks(stream: MediaStream | null | undefined): void {
  try {
    stream?.getTracks?.().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore cleanup issues for preflight tracks.
      }
    });
  } catch {
    // Ignore cleanup issues for preflight tracks.
  }
}

function rendererAssetUrl(relativePath: string): string {
  return new URL(relativePath, window.location.href).toString();
}

interface BrainstormSegment {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
}

interface BrainstormSessionRecord {
  id: string;
  sessionId: string;
  title: string;
  status: 'recording' | 'processing' | 'completed' | 'error';
  transcript: string;
  diarization: BrainstormSegment[];
  transcriptPdfPath: string;
  briefingContent: string;
  briefingPdfPath: string;
  knowledgeDocumentIds: string[];
  error: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  actionItemCount: number;
  summaryExcerpt: string;
}

interface SessionRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface MessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string | null;
  toolCalls?: any[];
  toolResults?: any[];
}

interface WorkTraceEvent {
  id: string;
  runId: string;
  turnId: string;
  sessionId?: string;
  toolName?: string;
  kind: WorkTraceKind;
  phase: WorkTracePhase;
  label: string;
  summary: string;
  detail?: string;
  payload?: any;
  openTarget?: any;
  timestamp: number;
}

interface FocusEventRecord {
  id: string;
  label: string;
  summary: string;
  meta: string;
  stage: string;
  createdAt: number;
}

interface WonderingRecord {
  id: string;
  category: string;
  question: string;
  answer: string;
  readerId?: string;
  sourceLabel?: string;
}

interface ArtifactPayload {
  path: string;
  name: string;
  kind: string;
  mimeType?: string;
  dataUrl?: string;
  textContent?: string;
  spreadsheetData?: any;
  startTime?: number;
  endTime?: number;
}

interface DiagramPayload {
  id: string;
  name: string;
  kind: string;
  svg: string;
  spec?: any;
  created_at?: string;
  updated_at?: string;
}

interface StageState {
  kind: StageKind;
  title: string;
  subtitle: string;
  summary?: string;
  data?: any;
}

type SetupCheckStatus = 'healthy' | 'warning' | 'error';
type SetupWizardStep = 'welcome' | 'readiness' | 'credentials' | 'finish';

interface RuntimeReadinessCheck {
  id: string;
  area: string;
  label: string;
  required: boolean;
  status: SetupCheckStatus;
  message: string;
  details?: string;
  action?: string;
}

interface RuntimeReadinessReport {
  checkedAt: string;
  appName: string;
  appVersion: string;
  channel: string;
  packaged: boolean;
  userDataPath: string;
  workspacePath: string;
  checks: RuntimeReadinessCheck[];
  summary?: {
    healthy: number;
    warnings: number;
    errors: number;
    requiredErrors: number;
    readyForFirstRun: boolean;
  };
}

const SETUP_WIZARD_COMPLETED_KEY = 'setup_wizard_completed_v1';

interface InspectionStageItem {
  id: string;
  title: string;
  subtitle?: string;
  preview?: string;
  badge?: string;
  openKind?: 'knowledge_document' | 'workspace_file' | 'text' | 'entity' | 'diagram';
  openTarget?: any;
}

interface InspectionStageSection {
  label: string;
  items: InspectionStageItem[];
}

interface EntityRoomPayload {
  counts: { people: number; businesses: number; links: number };
  people: any[];
  businesses: any[];
  query?: string;
  searchResults?: Array<{ type: string; id: string; name: string; description: string }>;
  activeEntityType?: 'person' | 'business' | null;
  activeEntity?: any | null;
  relationships?: any[];
  sessionContext?: {
    people: any[];
    businesses: any[];
    relationships: any[];
    summary: string;
    mode?: 'graph' | 'inferred';
  } | null;
  knowledge?: any | null;
  payload?: any;
}

interface VoiceStartOptions {
  suppressGreeting?: boolean;
  recoveryAttempt?: number;
  resumeContext?: string;
  hiddenUserMessage?: string;
}

interface VoiceTextHandoff {
  content: string;
  createdAt: number;
}

interface ControlLayerState {
  collaboration: boolean;
  eyeContact: boolean;
  handControl: boolean;
  browserControl: boolean;
  meetingMode: boolean;
  diagramCoEdit: boolean;
}

type RoomVisionStatus = 'off' | 'starting' | 'live' | 'capturing' | 'analyzing' | 'error';

interface RoomVisionSnapshot {
  dataUrl: string;
  description: string;
  capturedAt: number;
  provider?: string;
  model?: string;
  path?: string;
  name?: string;
}

const ROOM_VISION_PROMPT = [
  'You are viewing a camera snapshot from the user-facing room camera during a live Nexus voice/chat session.',
  'Describe what is visible in practical terms: people, objects, screens, text, documents, lighting, gestures, and any obvious context that would help a conversational assistant understand the room.',
  'Do not identify any person by name. If a person is visible, describe their position, posture, clothing, and activity without guessing identity.',
  'Call out readable text exactly when possible. Keep the output concise enough to pass into a live voice agent.',
].join('\n');

function describeRoomVisionError(error: unknown): string {
  const rawMessage = String((error as any)?.message || error || '').trim();
  const rawName = String((error as any)?.name || '').trim();
  const normalized = `${rawName} ${rawMessage}`.toLowerCase();

  if (/notallowederror|permission denied|permission dismissed|camera access denied|denied access to camera/.test(normalized)) {
    return 'Camera permission was denied. Allow camera access for EIG Nexus and try again.';
  }

  if (/notfounderror|requested device not found|no camera|no video input|device not found/.test(normalized)) {
    return 'No camera was found. Connect or enable a camera and try again.';
  }

  if (/notreadableerror|track start error|device in use|could not start video source|hardware error/.test(normalized)) {
    return 'The camera is unavailable or already in use by another app.';
  }

  return rawMessage || 'Room view camera failed.';
}

function formatRoomVisionStatus(status: RoomVisionStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting camera';
    case 'live':
      return 'Camera live';
    case 'capturing':
      return 'Capturing frame';
    case 'analyzing':
      return 'Analyzing room';
    case 'error':
      return 'Camera error';
    case 'off':
    default:
      return 'Camera off';
  }
}

const DEFAULT_ACTIVITY_STAGE: StageState = {
  kind: 'activity',
  title: 'AI Focus',
  subtitle: 'Empty until Nexus opens a real source, artifact, browser page, transcript, or report.',
  summary: 'AI Focus should show the actual thing Nexus is looking at, not a placeholder dashboard.',
  data: {},
};

const DEFAULT_WORKSTATION_STAGE: StageState = {
  kind: 'activity',
  title: 'Workstation',
  subtitle: 'Manual review surface for opening files, browsing knowledge, and running tools at your own pace.',
  summary: 'This is the user-owned side of the product. AI Focus remains separate.',
};

function truncateText(value: unknown, max = 200): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeHandoffText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatRelativeDate(timestamp: number): string {
  if (!timestamp) {
    return '';
  }
  const deltaMs = Date.now() - timestamp;
  const deltaMinutes = Math.round(deltaMs / 60000);
  if (deltaMinutes < 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function formatDateLabel(value: string | number | undefined): string {
  if (!value) {
    return '';
  }
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatVideoTimestamp(secondsValue: unknown): string {
  const totalSeconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatFileSize(value: unknown): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getPathTail(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const segments = text.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || text;
}

function getHostLabel(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  try {
    return new URL(text).host || text;
  } catch {
    return text;
  }
}

function isRevealableFilePath(value: unknown): boolean {
  const text = String(value || '').trim();
  return /^(\/|[A-Za-z]:[\\/])/.test(text);
}

function normalizeWorkTracePhase(value: unknown): WorkTracePhase {
  const normalized = String(value || '').trim().toLowerCase();
  switch (normalized) {
    case 'queued':
    case 'started':
    case 'update':
    case 'artifact':
    case 'complete':
    case 'error':
    case 'closed':
      return normalized;
    default:
      return 'update';
  }
}

function normalizeWorkTraceKind(value: unknown): WorkTraceKind {
  const normalized = String(value || '').trim().toLowerCase();
  switch (normalized) {
    case 'system':
    case 'search':
    case 'browser':
    case 'file':
    case 'artifact':
    case 'contract':
    case 'legal':
    case 'crm':
    case 'diagram':
    case 'image':
    case 'agent':
    case 'approval':
      return normalized;
    default:
      return 'unknown';
  }
}

function normalizeWorkTraceEvent(event: any): WorkTraceEvent {
  return {
    id: String(event?.id || `${event?.runId || 'trace'}-${event?.phase || 'update'}-${Date.now()}`),
    runId: String(event?.runId || event?.id || ''),
    turnId: String(event?.turnId || ''),
    sessionId: String(event?.sessionId || '').trim() || undefined,
    toolName: String(event?.toolName || '').trim() || undefined,
    kind: normalizeWorkTraceKind(event?.kind),
    phase: normalizeWorkTracePhase(event?.phase),
    label: String(event?.label || event?.toolName || 'Work trace'),
    summary: String(event?.summary || '').trim() || 'Nexus is working.',
    detail: String(event?.detail || '').trim() || undefined,
    payload: event?.payload,
    openTarget: event?.openTarget,
    timestamp: Number(event?.timestamp || Date.now()),
  };
}

function describeWorkTracePhase(phase: WorkTracePhase): string {
  switch (phase) {
    case 'queued':
      return 'Queued';
    case 'started':
      return 'Started';
    case 'update':
      return 'Live';
    case 'artifact':
      return 'Artifact';
    case 'complete':
      return 'Done';
    case 'error':
      return 'Error';
    case 'closed':
      return 'Closed';
    default:
      return 'Live';
  }
}

function summarizeWorkTraceEvent(event: WorkTraceEvent): { label: string; summary: string; meta: string } {
  const meta = [
    describeWorkTracePhase(event.phase),
    event.toolName && event.toolName !== event.label ? event.toolName : '',
    event.detail,
  ].filter(Boolean).join(' · ');

  return {
    label: event.label || event.toolName || 'Nexus',
    summary: event.summary || 'Nexus is working.',
    meta: truncateText(meta || event.kind, 120),
  };
}

function normalizeSessionRuntimeState(
  value: any,
  sessionId: string | null,
): SessionRuntimeState | null {
  const normalizedSessionId = String(value?.sessionId || sessionId || '').trim();
  if (!normalizedSessionId) {
    return null;
  }

  const modeCandidate = String(value?.mode || '').trim().toLowerCase();
  const statusCandidate = String(value?.status || '').trim().toLowerCase();
  const stageCandidate = String(value?.stageMode || '').trim().toLowerCase();

  const mode: SessionMode = modeCandidate === 'text_session'
    ? 'text_session'
    : modeCandidate === 'voice_session'
      ? 'voice_session'
      : 'chat';
  const status: SessionStatus = ['planning', 'acting', 'waiting', 'needs_approval', 'paused', 'ended', 'error'].includes(statusCandidate)
    ? statusCandidate as SessionStatus
    : 'idle';
  const stageMode: StageMode = stageCandidate === 'prepare'
    ? 'prepare'
    : stageCandidate === 'present'
      ? 'present'
      : 'research';

  return {
    sessionId: normalizedSessionId,
    mode,
    status,
    stageMode,
    objective: String(value?.objective || '').trim(),
    currentTask: String(value?.currentTask || '').trim() || undefined,
    lastAction: String(value?.lastAction || '').trim() || undefined,
    lastOutcome: ['success', 'partial', 'failed', 'blocked'].includes(String(value?.lastOutcome || '').trim())
      ? String(value?.lastOutcome).trim() as SessionRuntimeState['lastOutcome']
      : undefined,
    blocker: String(value?.blocker || '').trim() || undefined,
    cycleCount: Number(value?.cycleCount || 0),
    availableTools: Array.isArray(value?.availableTools) ? value.availableTools.map((entry: any) => String(entry)).filter(Boolean) : [],
    platformControls: Array.isArray(value?.platformControls) ? value.platformControls.map((entry: any) => String(entry)).filter(Boolean) : [],
    wonderings: Array.isArray(value?.wonderings)
      ? value.wonderings.map((entry: any, index: number) => ({
          id: String(entry?.id || `wondering-${index + 1}`),
          question: String(entry?.question || '').trim(),
          answer: String(entry?.answer || '').trim() || undefined,
          source: String(entry?.source || '').trim() || undefined,
        })).filter((entry: any) => entry.question)
      : [],
    lastTurnPacket: value?.lastTurnPacket || undefined,
    updatedAt: Number(value?.updatedAt || Date.now()),
    startedAt: Number(value?.startedAt || Date.now()),
    lastTrigger: String(value?.lastTrigger || '').trim() || undefined,
  };
}

function isSessionRuntimeStage(stage: StageState | null | undefined): boolean {
  return Boolean(stage && stage.kind === 'inspection' && stage.title === 'Session Runtime');
}

function buildSessionRuntimeStage(runtime: SessionRuntimeState): StageState {
  const sections: InspectionStageSection[] = [
    {
      label: 'Session State',
      items: [
        buildTextInspectionItem('Mode', runtime.mode.replace('_', ' '), 'Runtime policy'),
        buildTextInspectionItem('Status', runtime.status.replace('_', ' '), 'Coordinator state'),
        buildTextInspectionItem('Stage', runtime.stageMode, 'Research / Prepare / Present'),
        buildTextInspectionItem('Objective', runtime.objective || 'No explicit objective yet.', 'Session ledger'),
      ],
    },
    {
      label: 'Current Task',
      items: [
        buildTextInspectionItem('Task', runtime.currentTask || runtime.objective || 'No task selected yet.', 'What Nexus believes it is doing now'),
        buildTextInspectionItem('Last Action', runtime.lastAction || 'No prior action recorded yet.', 'Most recent completed step'),
        buildTextInspectionItem('Tool Reach', `${runtime.availableTools.length} tools available`, 'Allowed Nexus tool roster for coordination'),
        buildTextInspectionItem('Platform Reach', runtime.platformControls.join(', ') || 'chat, ai_focus, workstation', 'Nexus surfaces and subsystems in scope'),
      ],
    },
  ];

  if (runtime.wonderings.length) {
    sections.push({
      label: 'Wonderings',
      items: runtime.wonderings.slice(0, 6).map((entry) => buildTextInspectionItem(
        entry.question,
        entry.answer || 'No answer recorded yet.',
        entry.source ? `${entry.source} reflection` : 'Reflection',
      )),
    });
  }

  return {
    kind: 'inspection',
    title: 'Session Runtime',
    subtitle: runtime.currentTask || runtime.objective || 'Text autonomy is active for this session.',
    summary: `${runtime.mode.replace('_', ' ')} · ${runtime.stageMode} · cycle ${runtime.cycleCount}`,
    data: {
      status: runtime.status === 'planning' || runtime.status === 'acting' ? 'pending' : 'complete',
      sections,
    },
  };
}

function derivePulseMode(
  conversationStatus: ConversationStatus,
  conversationMode: ConversationMode,
  latestTrace: WorkTraceEvent | null,
): NexusPulseMode {
  if (conversationStatus === 'error' || latestTrace?.phase === 'error') {
    return 'error';
  }

  if (latestTrace?.kind === 'approval' && latestTrace.phase === 'queued') {
    return 'approval';
  }

  if (conversationStatus === 'connecting') {
    return 'connecting';
  }

  if (conversationStatus === 'connected' && conversationMode === 'speaking') {
    return 'speaking';
  }

  if (latestTrace?.kind === 'browser' && latestTrace.phase !== 'closed') {
    return 'browsing';
  }

  if (latestTrace && ['queued', 'started', 'update', 'artifact'].includes(latestTrace.phase)) {
    return latestTrace.kind === 'search' ? 'thinking' : 'tooling';
  }

  if (conversationStatus === 'connected') {
    return 'listening';
  }

  return 'idle';
}

function safeJsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getToolCallName(toolCall: any): string {
  const candidate = toolCall?.function?.name
    ?? toolCall?.name
    ?? toolCall?.toolName
    ?? toolCall?.tool
    ?? '';
  return String(candidate || '').trim();
}

function getToolCallArgumentsText(toolCall: any): string {
  const argumentsValue = toolCall?.function?.arguments
    ?? toolCall?.arguments
    ?? toolCall?.input
    ?? toolCall?.args
    ?? toolCall?.parameters
    ?? null;

  if (typeof argumentsValue === 'string') {
    const trimmed = argumentsValue.trim();
    if (!trimmed) {
      return '{}';
    }
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  if (argumentsValue == null) {
    return '{}';
  }

  return safeJsonPreview(argumentsValue);
}

function stripInlineToolCallMarkup(content: string, toolCalls: any[] = []): {
  cleanedContent: string;
  removedMarkup: boolean;
} {
  let cleanedContent = String(content || '');
  let removedMarkup = false;
  const toolNames = Array.from(new Set(toolCalls.map(getToolCallName).filter(Boolean)));
  const patterns = toolNames.map((toolName) => new RegExp(
    `<${escapeRegExp(toolName)}>\\s*[\\s\\S]*?\\s*<\\/${escapeRegExp(toolName)}>`,
    'gi',
  ));

  patterns.push(/["'`]?\s*<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>\s*["'`]?/gi);
  patterns.push(/["'`]?\s*<invoke\b[^>]*>[\s\S]*?<\/invoke>\s*["'`]?/gi);
  patterns.push(/["'`]?\s*<invoke\b[^>]*?\/>\s*["'`]?/gi);
  patterns.push(/["'`]?\s*<result\b[^>]*>[\s\S]*?<\/result>\s*["'`]?/gi);
  patterns.push(/["'`]?\s*<tool_result\b[^>]*>[\s\S]*?<\/tool_result>\s*["'`]?/gi);
  patterns.push(/["'`]?\s*<\/?(?:tool_calls|result|tool_result)\b[^>]*>\s*["'`]?/gi);
  patterns.push(/<([a-z0-9]+(?:[_-][a-z0-9]+)+)>\s*[\s\S]*?\s*<\/\1>/gi);

  for (const pattern of patterns) {
    const nextContent = cleanedContent.replace(pattern, ' ');
    if (nextContent !== cleanedContent) {
      cleanedContent = nextContent;
      removedMarkup = true;
    }
  }

  cleanedContent = cleanedContent
    .replace(/^[^\S\r\n]+|[^\S\r\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();

  return { cleanedContent, removedMarkup };
}

interface AssistantMessagePresentation {
  previewText: string;
  cleanedContent: string;
  rawContent: string;
  hasDetails: boolean;
  toolCalls: any[];
  toolResults: any[];
}

function getAssistantMessagePresentation(message?: MessageRecord | null): AssistantMessagePresentation {
  const rawContent = String(message?.content || '').trim();
  const toolCalls = Array.isArray(message?.toolCalls) ? message.toolCalls : [];
  const toolResults = Array.isArray(message?.toolResults) ? message.toolResults : [];
  const { cleanedContent, removedMarkup } = stripInlineToolCallMarkup(rawContent, toolCalls);
  const previewText = cleanedContent
    || (toolCalls.length
      ? `Completed ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}.`
      : rawContent);

  return {
    previewText: previewText || 'Nexus has not responded yet in this session.',
    cleanedContent: cleanedContent || previewText,
    rawContent,
    hasDetails: removedMarkup || toolCalls.length > 0 || toolResults.length > 0,
    toolCalls,
    toolResults,
  };
}

function formatToolResultPreview(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function unwrapToolResultPayload(toolResult: any): any {
  return toolResult?.result?.result ?? toolResult?.result;
}

function isDiagramPayload(value: unknown): value is DiagramPayload {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as DiagramPayload).id === 'string'
    && typeof (value as DiagramPayload).svg === 'string'
    && String((value as DiagramPayload).svg || '').trim(),
  );
}

function getToolResultOpenLabel(toolResult: any): string | null {
  const toolName = String(toolResult?.toolName || '').trim();
  const payload = unwrapToolResultPayload(toolResult);

  if (isDiagramPayload(payload) || toolName === 'draw_diagram' || toolName === 'show_diagram') {
    return 'Open Diagram';
  }

  const artifactPath = String(payload?.path || '').trim();
  if (artifactPath) {
    return 'Open Artifact';
  }

  const inspectionStage = buildInspectionStageFromTool(toolName, toolResult?.args || {}, payload, 'complete');
  if (!inspectionStage) {
    return null;
  }

  return inspectionStage.kind === 'diagram' ? 'Open Diagram' : 'Open in AI Focus';
}

function formatQuotedPreview(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^[“"'`]/.test(trimmed)) {
    return trimmed;
  }
  return `“${trimmed}”`;
}

function isDefaultFocusStage(stage: StageState): boolean {
  return stage.kind === DEFAULT_ACTIVITY_STAGE.kind
    && stage.title === DEFAULT_ACTIVITY_STAGE.title
    && stage.subtitle === DEFAULT_ACTIVITY_STAGE.subtitle;
}

function isDefaultWorkstationStage(stage: StageState): boolean {
  return stage.kind === DEFAULT_WORKSTATION_STAGE.kind
    && stage.title === DEFAULT_WORKSTATION_STAGE.title
    && stage.subtitle === DEFAULT_WORKSTATION_STAGE.subtitle;
}

function buildStageMotionKey(stage: StageState | null | undefined): string {
  if (!stage) {
    return 'stage:none';
  }

  const data = stage.data || {};
  const payload = data?.payload || {};
  const identityParts = [
    data?.id,
    data?.path,
    data?.name,
    data?.panelKind,
    data?.url,
    data?.query,
    data?.documentId,
    payload?.query,
    payload?.activeEntity?.id,
    payload?.activeSessionId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const graphSummary = [
    Array.isArray(data?.spec?.nodes) ? `nodes:${data.spec.nodes.length}` : '',
    Array.isArray(data?.spec?.edges) ? `edges:${data.spec.edges.length}` : '',
  ]
    .filter(Boolean)
    .join(':');

  if (graphSummary) {
    identityParts.push(graphSummary);
  }

  return [
    stage.kind,
    stage.title,
    stage.subtitle,
    String(stage.summary || ''),
    identityParts.join('|'),
  ].join('||');
}

function stagesMatch(left: StageState | null | undefined, right: StageState | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.kind === right.kind
    && left.title === right.title
    && left.subtitle === right.subtitle
    && String(left.summary || '') === String(right.summary || '');
}

function buildWonderings(
  diaryEntries: any[],
  diaryNarratives: any[],
  messages: MessageRecord[],
  focusEvents: FocusEventRecord[],
  focusStage: StageState,
  currentProjectName?: string | null,
  currentSessionName?: string | null,
): WonderingRecord[] {
  const normalizedEntries = Array.isArray(diaryEntries) ? diaryEntries : [];
  const normalizedNarratives = Array.isArray(diaryNarratives) ? diaryNarratives : [];
  const latestUserTurn = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && String(message.content || '').trim());
  const latestUserText = truncateText(
    String(latestUserTurn?.content || '').replace(/^["“”']+|["“”']+$/g, ''),
    120,
  );

  const latestEvent = [...focusEvents].reverse()[0] || null;
  const latestSignal = latestEvent
    ? truncateText(`${latestEvent.label}: ${latestEvent.summary}`, 120)
    : '';
  const bugSignal = [...focusEvents].reverse().find((event) => /bug|error|fail|warning|issue|friction/i.test(`${event.label} ${event.summary} ${event.meta}`));

  const projectLabel = truncateText(String(currentProjectName || currentSessionName || 'the current thread'), 70);
  const focusLabel = !isDefaultFocusStage(focusStage)
    ? truncateText(focusStage.title || focusStage.subtitle || 'the live focus surface', 70)
    : 'the live focus surface';

  const diaryBackedWonderings: WonderingRecord[] = [];

  const latestNarrative = normalizedNarratives[0];
  if (latestNarrative) {
    const narrativeText = String(latestNarrative?.narrative || '').trim();
    if (narrativeText) {
      diaryBackedWonderings.push({
        id: `wonder-narrative-${String(latestNarrative?.id || latestNarrative?.narrativeDay || 'latest')}`,
        category: 'Model Narrative',
        question: 'What is Nexus noticing about the overall thread right now?',
        answer: truncateText(narrativeText, 260),
        readerId: `narrative:${String(latestNarrative?.id || latestNarrative?.narrativeDay || '')}`,
        sourceLabel: String(latestNarrative?.narrativeDay || 'Daily narrative snapshot'),
      });
    }
  }

  const latestBugEntry = normalizedEntries.find((entry) => /bug|error|fail|warning|issue|friction/i.test(`${entry?.entryType || ''} ${entry?.activityKey || ''} ${entry?.content || ''}`));
  if (latestBugEntry) {
    diaryBackedWonderings.push({
      id: `wonder-bug-${String(latestBugEntry?.id || 'entry')}`,
      category: 'Bugs & Solutions',
      question: 'What still feels broken or contradictory in the current experience?',
      answer: truncateText(String(latestBugEntry?.content || ''), 240),
      readerId: `entry:${String(latestBugEntry?.id || '')}`,
      sourceLabel: formatDateLabel(latestBugEntry?.createdAt) || 'Diary entry',
    });
  }

  const latestContextEntry = normalizedEntries.find((entry) => /focus|workstation|browser|tool|session|project/i.test(`${entry?.entryType || ''} ${entry?.activityKey || ''} ${entry?.content || ''}`));
  if (latestContextEntry) {
    diaryBackedWonderings.push({
      id: `wonder-context-${String(latestContextEntry?.id || 'entry')}`,
      category: 'System State',
      question: 'What is the model paying attention to in the interface right now?',
      answer: truncateText(String(latestContextEntry?.content || ''), 240),
      readerId: `entry:${String(latestContextEntry?.id || '')}`,
      sourceLabel: String(latestContextEntry?.activityKey || latestContextEntry?.entryType || 'Diary entry').replace(/_/g, ' '),
    });
  }

  if (latestUserText && latestNarrative) {
    diaryBackedWonderings.push({
      id: `wonder-user-${String(latestNarrative?.id || 'latest')}`,
      category: 'User',
      question: `What does Nexus think the user is really trying to do with "${latestUserText}"?`,
      answer: truncateText(String(latestNarrative?.narrative || ''), 220),
      readerId: `narrative:${String(latestNarrative?.id || latestNarrative?.narrativeDay || '')}`,
      sourceLabel: String(latestNarrative?.narrativeDay || 'Daily narrative snapshot'),
    });
  }

  if (diaryBackedWonderings.length) {
    const seenDiary = new Set<string>();
    return diaryBackedWonderings.filter((candidate) => {
      const key = `${candidate.category}::${candidate.question}::${candidate.answer}`;
      if (seenDiary.has(key)) {
        return false;
      }
      seenDiary.add(key);
      return true;
    }).slice(0, 6);
  }

  const candidates: WonderingRecord[] = [
    latestUserText ? {
      id: 'wonder-user',
      category: 'User',
      question: `What interaction pattern would actually lower friction for the user around ${latestUserText}?`,
      answer: 'No diary-backed reflection has been generated yet, so this is still a live open question rather than a model answer.',
      sourceLabel: 'Live heuristic',
    } : {
      id: 'wonder-user',
      category: 'User',
      question: 'What is the user implicitly optimizing for right now: speed, legibility, control, or confidence?',
      answer: 'No diary-backed reflection has been generated yet, so this is still a live open question rather than a model answer.',
      sourceLabel: 'Live heuristic',
    },
    {
      id: 'wonder-environment',
      category: 'Environment',
      question: `Which panels should stay persistent around ${focusLabel}, and which ones should collapse out of the way?`,
      answer: 'The shell still needs a stronger model-owned focus surface with less competing chrome.',
      sourceLabel: 'Live heuristic',
    },
    latestSignal ? {
      id: 'wonder-tools',
      category: 'Tools',
      question: `Are the tools exposing the right outcome, or are they still leaking implementation detail through ${latestSignal}?`,
      answer: 'When the output feels like logs or staging text, the presentation layer is still underbuilt.',
      sourceLabel: 'Live heuristic',
    } : {
      id: 'wonder-tools',
      category: 'Tools',
      question: 'Which tool outcomes deserve a live visible surface, and which ones should stay quiet background context?',
      answer: 'Anything meaningful should become visible, and only low-signal plumbing should stay quiet.',
      sourceLabel: 'Live heuristic',
    },
    {
      id: 'wonder-bugs',
      category: 'Bugs & Solutions',
      question: bugSignal
        ? `What single change would remove the confusion around ${truncateText(bugSignal.summary, 110)} first?`
        : 'Where is the sharpest mismatch between what the interface says will happen and what actually happens when the user clicks?',
      answer: 'The worst contradictions come from tools claiming success while the visible surface stays generic or unchanged.',
      sourceLabel: 'Live heuristic',
    },
    {
      id: 'wonder-project',
      category: 'Project',
      question: `Inside ${projectLabel}, what belongs in AI Focus, what belongs in Workstation, and what should never compete for the same visual space?`,
      answer: 'The live agent-owned surface should stay dominant, while manual work and side controls step back until invited forward.',
      sourceLabel: 'Live heuristic',
    },
    {
      id: 'wonder-bigger-picture',
      category: 'Bigger Picture',
      question: 'What should always feel live, trustworthy, and understandable in Nexus?',
      answer: 'The larger goal is not just showing activity but making Nexus feel like a coherent operating surface.',
      sourceLabel: 'Live heuristic',
    },
    {
      id: 'wonder-self',
      category: 'Self-awareness',
      question: 'How should the model make its internal state legible without turning every action into interface noise?',
      answer: 'The right answer is visible work with clear focus, not walls of narration or implementation detail.',
      sourceLabel: 'Live heuristic',
    },
    {
      id: 'wonder-open',
      category: 'Open Curiosity',
      question: 'What is still unanswered that would make the whole product feel intentional instead of patched together?',
      answer: 'The strongest missing answer is how Focus should preserve multiple live threads without replacing one with the next.',
      sourceLabel: 'Live heuristic',
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.category}::${candidate.question}::${candidate.answer}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarizeToolExecution(toolName: string, result: any): { summary: string; meta: string } {
  const normalizedToolName = String(toolName || '').trim().toLowerCase();
  const payload = result && typeof result === 'object' ? result : null;

  if (normalizedToolName === 'list_contract_templates') {
    const templates = Array.isArray(payload?.templates) ? payload.templates : [];
    return {
      summary: templates.length
        ? `Loaded ${templates.length} contract template${templates.length === 1 ? '' : 's'} for drafting.`
        : 'Loaded the contract template catalog.',
      meta: templates.slice(0, 3).map((template: any) => String(template?.label || template?.id || '').trim()).filter(Boolean).join(' · ') || 'Contract drafting',
    };
  }

  if (normalizedToolName === 'create_contract_draft') {
    const title = String(payload?.title || payload?.message || 'contract draft').trim();
    const path = String(payload?.path || '').trim();
    return {
      summary: truncateText(`Created ${title}. Attorney review is still required before signature.`, 160),
      meta: path || 'Contract drafting',
    };
  }

  if (normalizedToolName === 'get_private_profile') {
    const profile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const visibleFields = Object.entries(profile).filter(([, value]) => String(value || '').trim().length > 0);
    return {
      summary: visibleFields.length
        ? `Loaded the secure private profile with ${visibleFields.length} populated field${visibleFields.length === 1 ? '' : 's'}.`
        : 'Loaded the secure private profile.',
      meta: visibleFields.slice(0, 3).map(([key]) => key).join(' · ') || 'Secure profile',
    };
  }

  if (normalizedToolName === 'browser_fill_private_profile') {
    const filledFields = Array.isArray(payload?.filledFields) ? payload.filledFields : [];
    return {
      summary: filledFields.length
        ? `Filled ${filledFields.length} browser field${filledFields.length === 1 ? '' : 's'} from the secure profile.`
        : truncateText(String(payload?.message || 'Applied stored private profile fields in the browser.'), 160),
      meta: filledFields.slice(0, 4).map((field: any) => String(field?.field || field?.selector || field || '').trim()).filter(Boolean).join(' · ') || 'Browser autofill',
    };
  }

  if (normalizedToolName === 'open_webpage') {
    const title = String(payload?.title || 'webpage').trim();
    const url = String(payload?.url || '').trim();
    return {
      summary: `Opened ${title}.`,
      meta: url || 'Browser',
    };
  }

  if (normalizedToolName === 'open_agent_workflow') {
    const workflow = payload?.workflow || {};
    const agentName = String(workflow?.agent?.name || 'agent').trim();
    const taskCount = Array.isArray(workflow?.tasks) ? workflow.tasks.length : 0;
    const pipelineCount = Array.isArray(workflow?.pipelines) ? workflow.pipelines.length : 0;
    const runCount = Array.isArray(workflow?.runs) ? workflow.runs.length : 0;
    return {
      summary: `Opened workflow for ${agentName}.`,
      meta: `${taskCount} tasks · ${pipelineCount} pipelines · ${runCount} runs`,
    };
  }

  if (normalizedToolName === 'draw_diagram' || normalizedToolName === 'show_diagram') {
    const title = String(payload?.name || payload?.title || 'diagram').trim();
    const nodeCount = Array.isArray(payload?.spec?.nodes) ? payload.spec.nodes.length : 0;
    const edgeCount = Array.isArray(payload?.spec?.edges) ? payload.spec.edges.length : 0;
    return {
      summary: normalizedToolName === 'draw_diagram' ? `Opened ${title}.` : `Reopened ${title}.`,
      meta: nodeCount || edgeCount ? `${nodeCount} nodes · ${edgeCount} edges` : 'Native diagram',
    };
  }

  if (typeof result === 'string') {
    return {
      summary: truncateText(result, 160) || `${toolName} completed.`,
      meta: 'Voice tool',
    };
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    const count = typeof payload?.count === 'number' ? ` · ${payload.count}` : '';
    return {
      summary: truncateText(payload.message, 160),
      meta: truncateText(
        [
          payload?.url,
          payload?.path,
          payload?.title,
          payload?.query,
        ].filter(Boolean).join(' · ') || `Voice tool${count}`,
        120,
      ),
    };
  }

  if (typeof payload?.count === 'number') {
    const noun = Array.isArray(payload?.entries)
      ? 'entries'
      : Array.isArray(payload?.agents)
        ? 'agents'
        : Array.isArray(payload?.documents)
          ? 'documents'
          : Array.isArray(payload?.results)
            ? 'results'
            : 'items';
    return {
      summary: `Found ${payload.count} ${noun}.`,
      meta: truncateText(String(payload?.query || payload?.title || payload?.url || 'Voice tool'), 120),
    };
  }

  if (typeof payload?.path === 'string' && payload.path.trim()) {
    const normalizedPath = String(payload.path).trim();
    return {
      summary: `Prepared ${normalizedPath.split('/').pop() || 'artifact'}.`,
      meta: normalizedPath,
    };
  }

  return {
    summary: truncateText(safeJsonPreview(result), 160) || `${toolName} completed.`,
    meta: 'Voice tool',
  };
}

function formatVoiceToolResultForModel(toolName: string, result: any): string {
  const normalizedToolName = String(toolName || '').trim().toLowerCase();
  const { summary, meta } = summarizeToolExecution(toolName, result);

  if (normalizedToolName === 'create_contract_draft') {
    return truncateText(
      `${summary} ${meta && meta !== 'Contract drafting' ? `Saved at ${meta}. ` : ''}`
      + 'Do not read the contract aloud. Give a brief spoken status update and mention attorney review is still required.',
      320,
    );
  }

  if (meta && meta !== 'Voice tool') {
    return truncateText(`${summary} ${meta}`, 260);
  }

  return truncateText(summary, 240) || `${toolName} completed.`;
}

function buildAgentWorkflowStage(workflow: any): StageState {
  const agentName = String(workflow?.agent?.name || 'Agent Workflow').trim() || 'Agent Workflow';
  const agentRole = String(workflow?.agent?.role || workflow?.agent?.template || 'Live orchestration view').trim();
  const tasks = Array.isArray(workflow?.tasks) ? workflow.tasks : [];
  const pipelines = Array.isArray(workflow?.pipelines) ? workflow.pipelines : [];
  const runs = Array.isArray(workflow?.runs) ? workflow.runs : [];
  const toolCalls = Array.isArray(workflow?.toolCalls) ? workflow.toolCalls : [];
  const childAgents = Array.isArray(workflow?.childAgents) ? workflow.childAgents : [];

  return {
    kind: 'activity',
    title: agentName,
    subtitle: agentRole || 'Agent workflow opened in AI Focus.',
    summary: `${tasks.length} tasks · ${pipelines.length} pipelines · ${runs.length} runs`,
    data: {
      cards: [
        {
          label: 'Child agents',
          value: childAgents.length,
          detail: childAgents[0]?.name ? `Lead child: ${childAgents[0].name}` : 'No child agents attached.',
        },
        {
          label: 'Tasks',
          value: tasks.length,
          detail: tasks[0]?.title ? String(tasks[0].title) : 'No queued tasks.',
        },
        {
          label: 'Pipelines',
          value: pipelines.length,
          detail: pipelines[0]?.name ? String(pipelines[0].name) : 'No pipelines attached.',
        },
        {
          label: 'Tool calls',
          value: toolCalls.length,
          detail: toolCalls[0]?.toolName || toolCalls[0]?.name || 'No recorded tool calls yet.',
        },
      ],
    },
  };
}

function formatEntitySubtitle(entity: any): string {
  if (!entity) {
    return 'Open CRM record';
  }

  const personBits = [entity.title, entity.company, entity.email].filter(Boolean);
  if (personBits.length) {
    return personBits.join(' · ');
  }

  const businessBits = [entity.industry, entity.location, entity.website].filter(Boolean);
  if (businessBits.length) {
    return businessBits.join(' · ');
  }

  return 'Open CRM record';
}

function normalizePanelEntityType(value: unknown): 'person' | 'business' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'person' || normalized === 'business') {
    return normalized;
  }
  return null;
}

function formatCompactNumber(value: unknown): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
}

function formatCurrencyAmount(value: unknown): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: numeric >= 100 ? 0 : 2,
  }).format(numeric);
}

function formatPercentValue(value: unknown, maximumFractionDigits: number = 0): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0%';
  }
  return `${numeric.toFixed(maximumFractionDigits)}%`;
}

function clampPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, numeric));
}

function formatDurationFromSeconds(value: unknown): string {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function buildPanelStage(
  panelKind: Exclude<HeaderPanelKind, null>,
  title: string,
  subtitle: string,
  summary: string,
  payload: any,
): StageState {
  return {
    kind: 'panel',
    title,
    subtitle,
    summary,
    data: { panelKind, payload },
  };
}

function panelKindToRoomClass(kind: HeaderPanelKind | undefined | null): string {
  switch (kind) {
    case 'entity-crm':
      return 'is-room-entity-crm';
    case 'statistics':
      return 'is-room-statistics';
    case 'task-queue':
      return 'is-room-task-queue';
    case 'bugs':
      return 'is-room-bugs';
    default:
      return '';
  }
}

function getEntityDisplayName(entityType: 'person' | 'business', entity: any): string {
  if (!entity) {
    return entityType === 'person' ? 'Person record' : 'Business record';
  }
  return String(entityType === 'person' ? entity?.full_name || entity?.name : entity?.name || entity?.full_name || 'Entity').trim() || 'Entity';
}

function describeEntity(entityType: 'person' | 'business', entity: any): string {
  if (!entity) {
    return 'No entity dossier loaded yet.';
  }

  if (entityType === 'person') {
    return [
      [entity?.title, entity?.company].filter(Boolean).join(' at '),
      entity?.location,
      entity?.bio || entity?.summary,
    ].filter(Boolean).join(' · ') || 'Person profile';
  }

  return [
    entity?.industry,
    entity?.location,
    entity?.description || entity?.summary,
  ].filter(Boolean).join(' · ') || 'Business profile';
}

function describeRelationship(entityType: 'person' | 'business', relationship: any): string {
  if (!relationship) {
    return 'Linked relationship';
  }

  if (entityType === 'person') {
    return [
      relationship?.role,
      relationship?.industry,
      relationship?.location,
      relationship?.is_founder ? 'Founder link' : '',
    ].filter(Boolean).join(' · ') || 'Linked business';
  }

  return [
    relationship?.role,
    relationship?.title,
    relationship?.company,
    relationship?.is_founder ? 'Founder link' : '',
  ].filter(Boolean).join(' · ') || 'Linked person';
}

function describeKnowledgeCluster(clusterId: string): string {
  switch (clusterId) {
    case 'graph':
      return 'Understand Anything is the canonical knowledge graph for documents, sessions, sources, topics, and artifacts.';
    case 'research':
      return 'Research Department sources and classified findings are projected into the same Understand Anything graph as documents.';
    case 'people':
      return 'Browse people extracted into the CRM and pivot directly into their records.';
    case 'businesses':
      return 'Browse companies and organizations linked to the current knowledge base.';
    case 'memory':
      return 'Working memory surfaces the live context Nexus is actively carrying into the next response cycle.';
    case 'deep-memory':
      return 'Stored memory surfaces persisted memory facts and longer-horizon context already written to the database.';
    case 'documents':
    default:
      return 'Open a document node to inspect the underlying material in the workspace.';
  }
}

function createFocusEvent(label: string, summary: string, meta: string, stage: string): FocusEventRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    summary,
    meta,
    stage,
    createdAt: Date.now(),
  };
}

function summarizeProgressEvent(evt: { stage: string; detail?: any; ts: number }): {
  label: string;
  summary: string;
  meta: string;
  stageKind: StageKind;
} {
  const stage = String(evt.stage || '').trim();
  const detail = evt.detail || {};
  const toolName = String(detail.toolName || detail.tool || detail.name || '').trim();
  const url = String(detail.url || detail.sourceUrl || '').trim();
  const query = String(detail.query || detail.q || '').trim();
  const path = String(detail.path || detail.filePath || '').trim();

  if (url || query || /scrape|search|browser|page|navigate/i.test(stage)) {
    return {
      label: query ? `Searching: ${query}` : 'Live browser focus',
      summary: url ? `Working through ${url}` : truncateText(detail.message || stage || 'Searching public sources', 120),
      meta: query || toolName || 'Web research',
      stageKind: 'browser',
    };
  }

  if (/legal|contract|agreeable|clause|review/i.test(stage) || /legal/i.test(toolName)) {
    return {
      label: 'Agreeable Agreements',
      summary: truncateText(detail.message || detail.status || 'Reviewing contract structure and risk.', 120),
      meta: toolName || 'Legal analysis',
      stageKind: 'legal',
    };
  }

  if (path || /artifact|image|video|media|diagram|presentation/i.test(stage)) {
    return {
      label: 'Presentation surface',
      summary: truncateText(path || detail.message || detail.title || 'Opening a visual artifact.', 120),
      meta: toolName || 'Artifact staging',
      stageKind: 'artifact',
    };
  }

  if (/knowledge|entity|memory|graph/i.test(stage)) {
    return {
      label: 'Knowledge surface',
      summary: truncateText(detail.message || 'Refreshing graph context and evidence.', 120),
      meta: toolName || 'Knowledge graph',
      stageKind: 'graph',
    };
  }

  return {
    label: toolName ? `Tool: ${toolName}` : 'Nexus is working',
    summary: truncateText(detail.message || detail.status || stage || 'Processing request', 120),
    meta: truncateText(safeJsonPreview(detail), 120) || 'Live execution update',
    stageKind: 'activity',
  };
}

function normalizeMessage(message: any): MessageRecord {
  return {
    id: String(message?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    role: (message?.role || 'assistant') as MessageRecord['role'],
    content: String(message?.content || ''),
    timestamp: new Date(message?.createdAt || message?.timestamp || Date.now()).getTime(),
    model: message?.model || null,
    toolCalls: Array.isArray(message?.toolCalls) ? message.toolCalls : [],
    toolResults: Array.isArray(message?.toolResults) ? message.toolResults : [],
  };
}

function normalizeSession(session: any): SessionRecord {
  return {
    id: String(session?.id || ''),
    name: String(session?.name || 'Untitled Session'),
    createdAt: new Date(session?.createdAt || Date.now()).getTime(),
    updatedAt: new Date(session?.updatedAt || session?.createdAt || Date.now()).getTime(),
    messageCount: Number(session?.messageCount || 0),
  };
}

function buildStageFromArtifact(artifact: ArtifactPayload): StageState {
  return {
    kind: 'artifact',
    title: artifact.name,
    subtitle: `${artifact.kind}${artifact.mimeType ? ` · ${artifact.mimeType}` : ''}`,
    summary: artifact.path,
    data: artifact,
  };
}

function buildStageFromDiagram(diagram: any): StageState {
  const payload = (diagram && typeof diagram === 'object' ? diagram : {}) as DiagramPayload;
  const nodeCount = Array.isArray(payload?.spec?.nodes) ? payload.spec.nodes.length : 0;
  const edgeCount = Array.isArray(payload?.spec?.edges) ? payload.spec.edges.length : 0;

  return {
    kind: 'diagram',
    title: String(payload?.name || 'Diagram'),
    subtitle: `${String(payload?.kind || 'diagram')} diagram`,
    summary: nodeCount || edgeCount ? `${nodeCount} nodes · ${edgeCount} edges` : 'Native diagram opened in AI Focus.',
    data: payload,
  };
}

function buildStageFromKnowledgeDocument(document: any): StageState {
  return {
    kind: 'artifact',
    title: String(document?.title || 'Knowledge document'),
    subtitle: String(document?.source || 'Knowledge Base'),
    summary: truncateText(document?.preview || document?.content || '', 180),
    data: {
      path: document?.artifactPath || document?.id,
      name: document?.title || 'Knowledge document',
      kind: document?.artifactPath ? String(document?.artifactKind || 'text') : 'text',
      mimeType: document?.artifactPath ? undefined : 'text/markdown',
      dataUrl: undefined,
      textContent: String(document?.content || document?.preview || ''),
    } satisfies ArtifactPayload,
  };
}

function buildTextInspectionItem(title: string, content: string, subtitle = 'Text view'): InspectionStageItem {
  return {
    id: `${title}-${content.slice(0, 24)}`,
    title,
    subtitle,
    preview: truncateText(content, 220),
    openKind: 'text',
    openTarget: {
      title,
      content,
    },
  };
}

function buildInspectionStageFromTool(
  toolName: string,
  params: Record<string, any> | null | undefined,
  payload: any,
  status: 'pending' | 'complete',
): StageState | null {
  const normalizedTool = String(toolName || '').trim();
  const query = String(
    params?.query
    || params?.q
    || payload?.query
    || ''
  ).trim();

  if (normalizedTool === 'list_contract_templates') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: 'Loading contract templates',
        subtitle: 'Nexus is opening the drafting catalog so the available NDA, services, employment, and privacy templates are visible.',
        summary: 'Contract drafting should stay on screen while the catalog loads.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const templates = Array.isArray(payload?.templates) ? payload.templates : [];
    return {
      kind: 'inspection',
      title: 'Contract template catalog',
      subtitle: `${templates.length} lawyer-style first-draft template${templates.length === 1 ? '' : 's'} available in Nexus.`,
      summary: 'Choose a template and continue into a real draft artifact.',
      data: {
        toolName: normalizedTool,
        status,
        sections: [
          {
            label: 'Available templates',
            items: templates.slice(0, 12).map((template: any, index: number) => ({
              id: String(template?.id || `${normalizedTool}-${index}`),
              title: String(template?.label || template?.id || 'Contract template'),
              subtitle: [template?.category, template?.supportedFormats?.join(', ')].filter(Boolean).join(' · '),
              preview: truncateText(
                [
                  template?.summary,
                  template?.recommendedUse,
                  Array.isArray(template?.attorneyReviewNotes) && template.attorneyReviewNotes.length
                    ? `Counsel review: ${template.attorneyReviewNotes[0]}`
                    : '',
                ].filter(Boolean).join(' '),
                220,
              ),
              badge: String(template?.category || 'contract'),
              openKind: 'text',
              openTarget: {
                title: String(template?.label || template?.id || 'Contract template'),
                content: [
                  `Category: ${String(template?.category || 'contract')}`,
                  `Recommended use: ${String(template?.recommendedUse || template?.summary || '')}`,
                  Array.isArray(template?.supportedFormats) ? `Formats: ${template.supportedFormats.join(', ')}` : '',
                  Array.isArray(template?.attorneyReviewNotes) && template.attorneyReviewNotes.length
                    ? `Attorney review notes:\n- ${template.attorneyReviewNotes.join('\n- ')}`
                    : '',
                ].filter(Boolean).join('\n\n'),
              },
            })),
          },
        ],
      },
    };
  }

  if (normalizedTool === 'create_contract_draft') {
    const template = payload?.template && typeof payload.template === 'object' ? payload.template : null;
    const artifactPath = String(payload?.path || '').trim();

    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: 'Drafting contract',
        subtitle: String(params?.templateId || params?.template || 'Contract template selected'),
        summary: 'Nexus is generating a lawyer-style first draft and should keep the draft path visible.',
        data: {
          toolName: normalizedTool,
          sections: [
            {
              label: 'Draft request',
              items: [
                {
                  id: 'contract-template',
                  title: String(params?.title || 'Contract draft in progress'),
                  subtitle: String(params?.templateId || params?.template || 'Template'),
                  preview: truncateText(
                    [
                      params?.disclosingPartyName,
                      params?.receivingPartyName,
                      params?.companyName,
                      params?.purpose,
                    ].filter(Boolean).join(' · ') || 'Generating the first draft artifact now.',
                    220,
                  ),
                  badge: 'contract',
                },
              ],
            },
          ],
          status,
        },
      };
    }

    return {
      kind: 'inspection',
      title: String(payload?.title || template?.label || 'Contract draft'),
      subtitle: template ? `${template.label} · attorney review required` : 'Lawyer-style first draft',
      summary: artifactPath || String(payload?.message || 'Contract draft created.'),
      data: {
        toolName: normalizedTool,
        status,
        sections: [
          {
            label: 'Draft output',
            items: [
              {
                id: 'contract-artifact',
                title: String(payload?.title || template?.label || 'Contract draft'),
                subtitle: artifactPath || 'Workspace artifact',
                preview: truncateText(
                  [
                    payload?.message,
                    payload?.usedStoredProfile ? 'Stored profile fields were applied.' : '',
                    'Attorney review remains required before signature or reliance.',
                  ].filter(Boolean).join(' '),
                  220,
                ),
                badge: String(payload?.type || 'docx'),
                openKind: artifactPath ? 'workspace_file' : undefined,
                openTarget: artifactPath ? { path: artifactPath } : undefined,
              },
            ],
          },
          template ? {
            label: 'Template guardrails',
            items: [
              {
                id: 'contract-template-notes',
                title: template.label,
                subtitle: String(template.category || 'contract'),
                preview: truncateText(
                  [
                    String(template.summary || ''),
                    Array.isArray(template.attorneyReviewNotes) && template.attorneyReviewNotes.length
                      ? `Counsel review: ${template.attorneyReviewNotes[0]}`
                      : '',
                  ].filter(Boolean).join(' '),
                  220,
                ),
                badge: 'review',
                openKind: 'text',
                openTarget: {
                  title: template.label,
                  content: [
                    template.summary,
                    template.recommendedUse ? `Recommended use: ${template.recommendedUse}` : '',
                    Array.isArray(template.attorneyReviewNotes) && template.attorneyReviewNotes.length
                      ? `Attorney review notes:\n- ${template.attorneyReviewNotes.join('\n- ')}`
                      : '',
                  ].filter(Boolean).join('\n\n'),
                },
              },
            ],
          } : null,
        ].filter(Boolean),
      },
    };
  }

  if (normalizedTool === 'get_private_profile') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: 'Loading secure profile',
        subtitle: 'Nexus is reading the encrypted reusable identity profile.',
        summary: 'Stored identity fields will appear here without exposing secrets in chat.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const profile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const entries = Object.entries(profile).filter(([, value]) => String(value || '').trim().length > 0);

    return {
      kind: 'inspection',
      title: 'Secure private profile',
      subtitle: `${entries.length} populated field${entries.length === 1 ? '' : 's'} ready for contracts and form fill.`,
      summary: 'Encrypted identity fields available to Nexus.',
      data: {
        toolName: normalizedTool,
        status,
        sections: [
          {
            label: 'Stored fields',
            items: entries.map(([key, value]) => ({
              id: key,
              title: key,
              subtitle: 'Encrypted profile field',
              preview: truncateText(String(value || ''), 140),
              badge: 'profile',
            })),
          },
        ],
      },
    };
  }

  if (normalizedTool === 'browser_fill_private_profile') {
    const filledFields = Array.isArray(payload?.filledFields) ? payload.filledFields : [];
    return {
      kind: 'inspection',
      title: status === 'pending' ? 'Filling browser form' : 'Secure profile autofill',
      subtitle: status === 'pending'
        ? 'Nexus is applying stored profile data to the active form.'
        : `${filledFields.length} field${filledFields.length === 1 ? '' : 's'} filled from the secure profile.`,
      summary: truncateText(String(payload?.message || 'Ordinary form fields can be completed from the encrypted profile.'), 180),
      data: {
        toolName: normalizedTool,
        status,
        sections: filledFields.length ? [
          {
            label: 'Filled fields',
            items: filledFields.slice(0, 12).map((field: any, index: number) => ({
              id: `${normalizedTool}-${index}`,
              title: String(field?.field || field?.selector || `Field ${index + 1}`),
              subtitle: String(field?.selector || 'Browser form field'),
              preview: truncateText(String(field?.value || 'Filled from secure profile.'), 180),
              badge: 'autofill',
            })),
          },
        ] : [],
      },
    };
  }

  if (normalizedTool === 'draw_diagram' || normalizedTool === 'show_diagram') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: normalizedTool === 'draw_diagram' ? 'Building native diagram' : 'Opening native diagram',
        subtitle: 'Nexus is staging the structured diagram viewer.',
        summary: 'The saved diagram should stay reopenable even after the live preview changes.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    if (isDiagramPayload(payload)) {
      return buildStageFromDiagram(payload);
    }

    const diagramId = String(payload?.id || params?.idOrName || params?.diagram || params?.name || '').trim();
    const diagramName = String(payload?.name || params?.name || 'Native diagram').trim() || 'Native diagram';
    return {
      kind: 'inspection',
      title: diagramName,
      subtitle: 'Structured Nexus diagram',
      summary: 'The native diagram was created and can be reopened directly into AI Focus.',
      data: {
        toolName: normalizedTool,
        status,
        sections: [
          {
            label: 'Diagram',
            items: [
              {
                id: diagramId || diagramName,
                title: diagramName,
                subtitle: diagramId || 'Saved diagram',
                preview: 'Open the rendered Nexus diagram instead of the raw tool payload.',
                badge: 'diagram',
                openKind: 'diagram',
                openTarget: {
                  diagramId: diagramId || diagramName,
                },
              },
            ],
          },
        ],
      },
    };
  }

  if (normalizedTool === 'search_knowledge') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: query ? `Searching knowledge for "${query}"` : 'Searching knowledge',
        subtitle: query || 'Transcripts, diary, files, and knowledge docs are about to surface here.',
        summary: 'AI Focus is opening the material Nexus is checking right now.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const allResults = Array.isArray(payload?.allResults) ? payload.allResults : [];
    const sections: InspectionStageSection[] = [];

    if (allResults.length) {
      sections.push({
        label: 'Live Matches',
        items: allResults.slice(0, 12).map((item: any, index: number) => ({
          id: String(item?.id || `${normalizedTool}-${index}`),
          title: String(item?.title || item?.name || item?.source || 'Untitled result'),
          subtitle: String(item?.source || item?.sourceType || 'Knowledge'),
          preview: String(item?.preview || ''),
          badge: String(item?.sourceType || '').replace(/_/g, ' '),
          openKind: item?.openKind === 'knowledge_document'
            ? 'knowledge_document'
            : item?.openKind === 'workspace_file'
              ? 'workspace_file'
              : item?.openKind === 'entity'
                ? 'entity'
                : item?.openKind === 'text'
                  ? 'text'
                  : undefined,
          openTarget: item?.openTarget,
        })),
      });
    }

    return {
      kind: 'inspection',
      title: query ? `Knowledge search: ${query}` : 'Knowledge search',
      subtitle: String(payload?.summary || 'Live internal search results'),
      summary: `${allResults.length} surfaced result${allResults.length === 1 ? '' : 's'}`,
      data: {
        toolName: normalizedTool,
        query,
        status,
        sections,
      },
    };
  }

  if (normalizedTool === 'search_transcripts') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: query ? `Searching transcripts for "${query}"` : 'Searching transcripts',
        subtitle: query || 'Transcript matches will appear here.',
        summary: 'Nexus is checking transcript sources live.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const matches = Array.isArray(payload?.matches) ? payload.matches : [];
    return {
      kind: 'inspection',
      title: query ? `Transcript matches: ${query}` : 'Transcript matches',
      subtitle: String(payload?.message || 'Transcript search complete'),
      summary: `${matches.length} transcript match${matches.length === 1 ? '' : 'es'} surfaced`,
      data: {
        toolName: normalizedTool,
        query,
        status,
        sections: [
          {
            label: 'Transcript Evidence',
            items: matches.slice(0, 12).map((item: any, index: number) => ({
              id: String(item?.documentId || item?.messageId || `${normalizedTool}-${index}`),
              title: String(item?.title || item?.source || 'Transcript match'),
              subtitle: String(item?.source || item?.sessionId || 'Transcript'),
              preview: String(item?.preview || ''),
              badge: item?.messageId ? 'session transcript' : 'saved transcript',
              openKind: item?.documentId ? 'knowledge_document' : 'text',
              openTarget: item?.documentId
                ? { documentId: item.documentId }
                : {
                    title: String(item?.title || 'Transcript match'),
                    content: String(item?.preview || ''),
                  },
            })),
          },
        ],
      },
    };
  }

  if (normalizedTool === 'index_video_footage') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: 'Indexing video footage',
        subtitle: 'Nexus is preparing video files for semantic search.',
        summary: 'Indexed footage should stay visible and queryable once this finishes.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const indexedPaths = Array.isArray(payload?.indexedPaths) ? payload.indexedPaths : [];
    const sourceFiles = Array.isArray(payload?.stats?.sourceFiles) ? payload.stats.sourceFiles : [];

    return {
      kind: 'inspection',
      title: 'Indexed video library',
      subtitle: `${indexedPaths.length} file${indexedPaths.length === 1 ? '' : 's'} processed for semantic video search.`,
      summary: `${Number(payload?.stats?.totalChunks || 0)} indexed chunk${Number(payload?.stats?.totalChunks || 0) === 1 ? '' : 's'} across ${Number(payload?.stats?.uniqueSourceFiles || 0)} source video${Number(payload?.stats?.uniqueSourceFiles || 0) === 1 ? '' : 's'}.`,
      data: {
        toolName: normalizedTool,
        status,
        sections: [
          {
            label: 'Indexed files',
            items: indexedPaths.slice(0, 12).map((filePath: string, index: number) => ({
              id: `${normalizedTool}-indexed-${index}`,
              title: getPathTail(filePath),
              subtitle: 'Ready for search',
              preview: String(filePath || ''),
              badge: 'video',
              openKind: 'workspace_file',
              openTarget: { path: filePath },
            })),
          },
          sourceFiles.length ? {
            label: 'Library coverage',
            items: sourceFiles.slice(0, 12).map((filePath: string, index: number) => ({
              id: `${normalizedTool}-source-${index}`,
              title: getPathTail(filePath),
              subtitle: 'Indexed source file',
              preview: String(filePath || ''),
              badge: 'library',
              openKind: 'workspace_file',
              openTarget: { path: filePath },
            })),
          } : null,
        ].filter(Boolean),
      },
    };
  }

  if (normalizedTool === 'search_video_footage') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: query ? `Searching footage for "${query}"` : 'Searching indexed footage',
        subtitle: 'Timestamped semantic matches will appear here.',
        summary: 'Nexus should surface exact video segments instead of hiding the search output in text.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const matches = Array.isArray(payload?.results) ? payload.results : [];
    const sourceFiles = Array.isArray(payload?.stats?.sourceFiles) ? payload.stats.sourceFiles : [];

    return {
      kind: 'inspection',
      title: query ? `Footage matches: ${query}` : 'Footage matches',
      subtitle: `${matches.length} timestamped video match${matches.length === 1 ? '' : 'es'} surfaced.`,
      summary: `${Number(payload?.stats?.uniqueSourceFiles || 0)} indexed source video${Number(payload?.stats?.uniqueSourceFiles || 0) === 1 ? '' : 's'} available to search.`,
      data: {
        toolName: normalizedTool,
        status,
        query,
        sections: [
          {
            label: 'Timestamped matches',
            items: matches.slice(0, 12).map((match: any, index: number) => ({
              id: `${normalizedTool}-match-${index}`,
              title: String(match?.sourceName || getPathTail(match?.sourceFile) || `Match ${index + 1}`),
              subtitle: `${formatVideoTimestamp(match?.startTime)} → ${formatVideoTimestamp(match?.endTime)} · similarity ${(Number(match?.similarityScore || 0) * 100).toFixed(0)}%`,
              preview: String(match?.sourceFile || ''),
              badge: 'segment',
              openKind: match?.sourceFile ? 'workspace_file' : undefined,
              openTarget: match?.sourceFile
                ? {
                    path: String(match.sourceFile),
                    startTime: Number(match?.startTime || 0),
                    endTime: Number(match?.endTime || 0),
                  }
                : undefined,
            })),
          },
          sourceFiles.length ? {
            label: 'Indexed sources',
            items: sourceFiles.slice(0, 8).map((filePath: string, index: number) => ({
              id: `${normalizedTool}-source-${index}`,
              title: getPathTail(filePath),
              subtitle: 'Indexed video source',
              preview: String(filePath || ''),
              badge: 'video',
              openKind: 'workspace_file',
              openTarget: { path: filePath },
            })),
          } : null,
        ].filter(Boolean),
      },
    };
  }

  if (normalizedTool === 'clip_video_segment') {
    const artifactPath = String(payload?.artifact?.path || payload?.path || '').trim();
    return {
      kind: 'inspection',
      title: status === 'pending' ? 'Creating video clip' : String(payload?.artifact?.name || 'Video clip ready'),
      subtitle: status === 'pending'
        ? 'Nexus is cutting the requested timestamp window into a new MP4.'
        : `${formatVideoTimestamp(payload?.startTime)} → ${formatVideoTimestamp(payload?.endTime)} from ${getPathTail(payload?.sourceFile)}`,
      summary: truncateText(String(payload?.summary || artifactPath || 'Generated clip output'), 200),
      data: {
        toolName: normalizedTool,
        status,
        sections: artifactPath ? [
          {
            label: 'Generated clip',
            items: [
              {
                id: `${normalizedTool}-artifact`,
                title: String(payload?.artifact?.name || getPathTail(artifactPath) || 'Video clip'),
                subtitle: artifactPath,
                preview: truncateText(String(payload?.summary || ''), 220),
                badge: 'video',
                openKind: 'workspace_file',
                openTarget: { path: artifactPath },
              },
            ],
          },
        ] : [],
      },
    };
  }

  if (normalizedTool === 'stitch_video_segments') {
    const artifactPath = String(payload?.artifact?.path || payload?.path || '').trim();
    return {
      kind: 'inspection',
      title: status === 'pending' ? 'Stitching video montage' : String(payload?.artifact?.name || 'Video montage ready'),
      subtitle: status === 'pending'
        ? 'Nexus is combining multiple clips into one generated MP4.'
        : 'Generated montage stored in the video library.',
      summary: truncateText(String(payload?.summary || artifactPath || 'Generated montage output'), 200),
      data: {
        toolName: normalizedTool,
        status,
        sections: artifactPath ? [
          {
            label: 'Generated montage',
            items: [
              {
                id: `${normalizedTool}-artifact`,
                title: String(payload?.artifact?.name || getPathTail(artifactPath) || 'Video montage'),
                subtitle: artifactPath,
                preview: truncateText(String(payload?.summary || ''), 220),
                badge: 'video',
                openKind: 'workspace_file',
                openTarget: { path: artifactPath },
              },
            ],
          },
        ] : [],
      },
    };
  }

  if (normalizedTool === 'create_narrated_slideshow') {
    const videoPath = String(payload?.artifact?.path || payload?.path || '').trim();
    const audioPath = String(payload?.audioArtifact?.path || '').trim();
    return {
      kind: 'inspection',
      title: status === 'pending' ? 'Building narrated slideshow' : String(payload?.artifact?.name || 'Narrated slideshow ready'),
      subtitle: status === 'pending'
        ? 'Nexus is rendering the slideshow video and narration track.'
        : `Narration provider: ${String(payload?.narrationProvider || 'generated')}`,
      summary: truncateText(String(payload?.summary || videoPath || 'Generated slideshow output'), 200),
      data: {
        toolName: normalizedTool,
        status,
        sections: [
          videoPath ? {
            label: 'Generated video',
            items: [
              {
                id: `${normalizedTool}-video`,
                title: String(payload?.artifact?.name || getPathTail(videoPath) || 'Narrated slideshow'),
                subtitle: videoPath,
                preview: truncateText(String(payload?.summary || ''), 220),
                badge: 'video',
                openKind: 'workspace_file',
                openTarget: { path: videoPath },
              },
            ],
          } : null,
          audioPath ? {
            label: 'Narration track',
            items: [
              {
                id: `${normalizedTool}-audio`,
                title: String(payload?.audioArtifact?.name || getPathTail(audioPath) || 'Narration audio'),
                subtitle: audioPath,
                preview: truncateText(String(payload?.narrationText || ''), 220),
                badge: 'audio',
                openKind: 'workspace_file',
                openTarget: { path: audioPath },
              },
            ],
          } : null,
        ].filter(Boolean),
      },
    };
  }

  if (normalizedTool === 'search_diary') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: query ? `Searching diary for "${query}"` : 'Searching diary',
        subtitle: query || 'Diary entries will appear here.',
        summary: 'Nexus is checking reflective history live.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const lines = String(payload || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^Found \d+ diary entries/i.test(line));

    return {
      kind: 'inspection',
      title: query ? `Diary search: ${query}` : 'Diary search',
      subtitle: lines.length ? 'Recent matching diary entries' : 'No diary matches surfaced',
      summary: `${lines.length} diary line${lines.length === 1 ? '' : 's'} surfaced`,
      data: {
        toolName: normalizedTool,
        query,
        status,
        sections: [
          {
            label: 'Diary Matches',
            items: lines.slice(0, 12).map((line, index) => buildTextInspectionItem(
              `Diary match ${index + 1}`,
              line,
              'Diary entry',
            )),
          },
        ],
      },
    };
  }

  if (normalizedTool === 'session_activity_context') {
    if (status === 'pending') {
      return {
        kind: 'inspection',
        title: 'Rebuilding recent session context',
        subtitle: 'Messages, tool calls, files, and artifacts are about to appear here.',
        summary: 'Nexus is reconstructing the live working set.',
        data: {
          toolName: normalizedTool,
          sections: [],
          status,
        },
      };
    }

    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    const knowledgeDocuments = Array.isArray(payload?.knowledgeDocuments) ? payload.knowledgeDocuments : [];

    const sections: InspectionStageSection[] = [];

    if (messages.length) {
      sections.push({
        label: 'Recent Messages',
        items: messages.slice(-8).reverse().map((message: any, index: number) => buildTextInspectionItem(
          `${String(message?.role || 'message').toUpperCase()} · ${String(message?.model || 'session')}`,
          String(message?.content || ''),
          formatDateLabel(message?.createdAt) || `Message ${index + 1}`,
        )),
      });
    }

    if (artifacts.length) {
      sections.push({
        label: 'Working Files',
        items: artifacts.slice(0, 10).map((artifact: any, index: number) => ({
          id: String(artifact?.id || `${normalizedTool}-artifact-${index}`),
          title: String(artifact?.title || artifact?.path || 'Artifact'),
          subtitle: String(artifact?.kind || artifact?.sourceType || 'artifact'),
          preview: String(artifact?.path || ''),
          badge: String(artifact?.kind || 'artifact'),
          openKind: artifact?.path ? 'workspace_file' : undefined,
          openTarget: artifact?.path ? { path: artifact.path } : undefined,
        })),
      });
    }

    if (knowledgeDocuments.length) {
      sections.push({
        label: 'Knowledge Documents',
        items: knowledgeDocuments.slice(0, 10).map((document: any, index: number) => ({
          id: String(document?.id || `${normalizedTool}-document-${index}`),
          title: String(document?.title || 'Knowledge document'),
          subtitle: String(document?.source || 'Knowledge Base'),
          preview: String(document?.preview || ''),
          badge: 'knowledge',
          openKind: document?.id ? 'knowledge_document' : undefined,
          openTarget: document?.id ? { documentId: document.id } : undefined,
        })),
      });
    }

    return {
      kind: 'inspection',
      title: String(payload?.session?.name || 'Session activity context'),
      subtitle: String(payload?.project?.name || 'Recent messages, tools, and artifacts'),
      summary: `${messages.length} messages · ${artifacts.length} artifacts · ${knowledgeDocuments.length} knowledge docs`,
      data: {
        toolName: normalizedTool,
        status,
        sections,
      },
    };
  }

  const genericPayloadPreview = payload == null
    ? ''
    : typeof payload === 'string'
      ? payload
      : safeJsonPreview(payload);
  const genericParamsPreview = params == null ? '' : safeJsonPreview(params);

  return {
    kind: 'inspection',
    title: normalizedTool || 'Visible tool trace',
    subtitle: status === 'pending' ? 'Nexus is working on this tool live.' : 'Tool output is now visible in AI Focus.',
    summary: truncateText(genericPayloadPreview || genericParamsPreview || 'Nexus is making this tool run visible.', 180),
    data: {
      toolName: normalizedTool || 'tool',
      status,
      sections: [
        {
          label: status === 'pending' ? 'Live request' : 'Tool output',
          items: [
            {
              id: `${normalizedTool || 'tool'}-generic-${status}`,
              title: normalizedTool || 'Visible tool trace',
              subtitle: status === 'pending' ? 'Running now' : 'Completed',
              preview: truncateText(genericPayloadPreview || genericParamsPreview || 'No structured output was returned.', 220),
              badge: status === 'pending' ? 'live' : 'result',
              openKind: 'text',
              openTarget: {
                title: normalizedTool || 'Tool output',
                content: genericPayloadPreview || genericParamsPreview || 'No structured output was returned.',
              },
            },
          ],
        },
      ],
    },
  };
}

function shouldPromoteWorkTraceEvent(event: WorkTraceEvent): boolean {
  if (event.phase === 'closed') {
    return false;
  }

  if (event.kind === 'system' && !event.toolName) {
    return false;
  }

  return true;
}

function buildStageFromWorkTraceEvent(event: WorkTraceEvent): StageState | null {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const status: 'pending' | 'complete' = ['queued', 'started', 'update'].includes(event.phase) ? 'pending' : 'complete';

  if (event.kind === 'diagram' && typeof payload?.svg === 'string' && payload.svg.trim()) {
    return buildStageFromDiagram(payload);
  }

  if (event.toolName) {
    return buildInspectionStageFromTool(event.toolName, payload, payload, status);
  }

  const artifactPath = String(
    event.openTarget?.path
    || payload?.path
    || payload?.artifact?.path
    || payload?.audioArtifact?.path
    || '',
  ).trim();
  if (artifactPath) {
    return {
      kind: 'inspection',
      title: event.label,
      subtitle: event.summary,
      summary: artifactPath,
      data: {
        toolName: event.kind,
        status,
        sections: [
          {
            label: 'Artifact',
            items: [
              {
                id: `${event.id}-artifact`,
                title: getPathTail(artifactPath),
                subtitle: event.detail || 'Workspace artifact',
                preview: artifactPath,
                badge: event.kind,
                openKind: 'workspace_file',
                openTarget: { path: artifactPath },
              },
            ],
          },
        ],
      },
    };
  }

  if (event.kind === 'browser') {
    const url = String(event.openTarget?.url || payload?.url || '').trim();
    return {
      kind: 'inspection',
      title: event.label,
      subtitle: event.summary,
      summary: url || event.detail || 'Live browser work',
      data: {
        toolName: event.kind,
        status,
        sections: [
          {
            label: 'Browser activity',
            items: [
              {
                id: `${event.id}-browser`,
                title: getHostLabel(url || event.summary) || event.label,
                subtitle: url || 'Browser activity',
                preview: truncateText(event.detail || event.summary, 220),
                badge: event.kind,
              },
            ],
          },
        ],
      },
    };
  }

  return {
    kind: 'inspection',
    title: event.label,
    subtitle: event.summary,
    summary: event.detail || event.kind,
    data: {
      toolName: event.toolName || event.kind,
      status,
      sections: [
        {
          label: 'Visible execution',
          items: [
            {
              id: `${event.id}-trace`,
              title: event.label,
              subtitle: describeWorkTracePhase(event.phase),
              preview: truncateText(
                [
                  event.summary,
                  event.detail,
                  event.payload && typeof event.payload !== 'object' ? String(event.payload) : '',
                ].filter(Boolean).join(' '),
                220,
              ),
              badge: event.kind,
              openKind: event.payload ? 'text' : undefined,
              openTarget: event.payload
                ? {
                    title: event.label,
                    content: typeof event.payload === 'string' ? event.payload : safeJsonPreview(event.payload),
                  }
                : undefined,
            },
          ],
        },
      ],
    },
  };
}

function CrestEmblem(): React.ReactElement {
  return (
    <svg viewBox="0 0 420 460" role="presentation">
      <defs>
        <linearGradient id="nextCrestGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f7df9d" />
          <stop offset="38%" stopColor="#d3a14a" />
          <stop offset="72%" stopColor="#8d5f23" />
          <stop offset="100%" stopColor="#f0d18a" />
        </linearGradient>
        <linearGradient id="nextCrestSteel" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#32261c" />
          <stop offset="100%" stopColor="#120d09" />
        </linearGradient>
      </defs>
      <path
        d="M210 22 L355 62 C356 160 342 282 210 420 C78 282 64 160 65 62 Z"
        fill="url(#nextCrestSteel)"
        stroke="url(#nextCrestGold)"
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <path
        d="M210 48 L335 82 C334 168 324 263 210 381 C96 263 86 168 85 82 Z"
        fill="none"
        stroke="url(#nextCrestGold)"
        strokeOpacity="0.55"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M210 108 L296 140 C296 204 286 278 210 346 C134 278 124 204 124 140 Z"
        fill="url(#nextCrestGold)"
        opacity="0.12"
      />
      <path
        d="M210 118 L286 146 C286 201 278 268 210 329 C142 268 134 201 134 146 Z"
        fill="none"
        stroke="url(#nextCrestGold)"
        strokeOpacity="0.42"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M210 144 L260 162 C260 204 253 250 210 291 C167 250 160 204 160 162 Z"
        fill="url(#nextCrestGold)"
        opacity="0.08"
      />
    </svg>
  );
}

function HeaderActionButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      className={`next-header-action${props.active ? ' is-active' : ''}`}
      type="button"
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function SidebarRow(props: {
  title: string;
  subtitle: string;
  active?: boolean;
  onClick?: () => void;
}): React.ReactElement {
  return (
    <button
      className={`next-sidebar-row${props.active ? ' is-active' : ''}`}
      type="button"
      onClick={props.onClick}
    >
      <div className="next-sidebar-row-icon">{props.title.slice(0, 1)}</div>
      <div className="next-sidebar-row-copy">
        <strong>{props.title}</strong>
        <span>{props.subtitle}</span>
      </div>
    </button>
  );
}

function AssistantDetailsPanel(props: {
  presentation: AssistantMessagePresentation;
  onClose?: () => void;
  onOpenToolResult?: (toolResult: any) => void;
}): React.ReactElement | null {
  const { presentation } = props;
  if (!presentation.hasDetails) {
    return null;
  }

  const showRawContent = Boolean(presentation.rawContent && presentation.rawContent !== presentation.cleanedContent);

  return (
    <div className="next-message-details">
      {showRawContent ? (
        <div className="next-message-detail-block">
          <div className="next-mini-label">Raw Response</div>
          <pre className="next-message-raw">{presentation.rawContent}</pre>
        </div>
      ) : null}

      {presentation.toolCalls.length ? (
        <div className="next-message-detail-block">
          <div className="next-mini-label">Tool Calls</div>
          <div className="next-tool-call-list">
            {presentation.toolCalls.map((toolCall, index) => {
              const toolName = getToolCallName(toolCall) || `Tool ${index + 1}`;
              return (
                <article className="next-tool-call-item" key={`${toolName}-${index}`}>
                  <strong>{toolName}</strong>
                  <pre className="next-tool-call-code">{getToolCallArgumentsText(toolCall)}</pre>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {presentation.toolResults.length ? (
        <div className="next-message-detail-block">
          <div className="next-mini-label">Tool Results</div>
          <div className="next-tool-call-list">
            {presentation.toolResults.map((toolResult, index) => {
              const toolName = String(toolResult?.toolName || `Tool ${index + 1}`);
              const openLabel = getToolResultOpenLabel(toolResult);
              return (
                <article className="next-tool-call-item" key={`${toolName}-result-${index}`}>
                  <strong>{toolName}</strong>
                  <pre className="next-tool-call-code">{formatToolResultPreview(toolResult)}</pre>
                  {openLabel && props.onOpenToolResult ? (
                    <div className="next-message-details-actions">
                      <button
                        type="button"
                        className="next-detail-toggle next-detail-toggle--panel"
                        onClick={() => props.onOpenToolResult?.(toolResult)}
                      >
                        {openLabel}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {props.onClose ? (
        <div className="next-message-details-actions">
          <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onClose}>
            Hide Details
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DockCards(props: {
  lastUserMessage?: MessageRecord | null;
  lastAssistantMessage?: MessageRecord | null;
  assistantDetailsOpen?: boolean;
  onToggleAssistantDetails?: () => void;
}): React.ReactElement {
  function DockSnippetText(snippetProps: { text: string; emptyText: string }): React.ReactElement {
    const rawText = String(snippetProps.text || '').trim();
    const [expanded, setExpanded] = useState(false);
    const displayText = rawText ? formatQuotedPreview(rawText) : snippetProps.emptyText;
    const canExpand = displayText.length > 220 || /\n/.test(displayText);

    return (
      <div className={`next-dock-snippet${expanded ? ' is-expanded' : ''}`}>
        <div className="next-dock-copy" title={displayText}>
          {displayText}
        </div>
        {canExpand ? (
          <button
            type="button"
            className="next-detail-toggle"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Show Less' : 'Show More'}
          </button>
        ) : null}
      </div>
    );
  }

  const assistantPresentation = getAssistantMessagePresentation(props.lastAssistantMessage);

  return (
    <div className="next-dock-cards">
      <div className={`next-dock-card${props.assistantDetailsOpen ? ' is-expanded' : ''}`}>
        <div className="next-dock-card-head">
          <div className="next-dock-label">Last Nexus Response</div>
          {props.lastAssistantMessage && assistantPresentation.hasDetails && props.onToggleAssistantDetails ? (
            <button type="button" className="next-detail-toggle" onClick={props.onToggleAssistantDetails}>
              {props.assistantDetailsOpen ? 'Hide Details' : 'Show Details'}
            </button>
          ) : null}
        </div>
        <DockSnippetText
          text={props.lastAssistantMessage ? assistantPresentation.previewText : ''}
          emptyText="Nexus has not responded yet in this session."
        />
        {props.lastAssistantMessage && props.assistantDetailsOpen ? (
          <AssistantDetailsPanel presentation={assistantPresentation} onClose={props.onToggleAssistantDetails} />
        ) : null}
      </div>
      <div className="next-dock-card">
        <div className="next-dock-card-head">
          <div className="next-dock-label">Last User Message</div>
        </div>
        <DockSnippetText
          text={props.lastUserMessage?.content || ''}
          emptyText="No user message yet in this session."
        />
      </div>
    </div>
  );
}

function JsonBlock(props: { title?: string; value: unknown }): React.ReactElement {
  return (
    <div className="next-json-block">
      {props.title ? <div className="next-mini-label">{props.title}</div> : null}
      <pre>{safeJsonPreview(props.value)}</pre>
    </div>
  );
}

function InspectionStage(props: {
  stage: StageState;
  onOpenItem?: (item: InspectionStageItem) => void;
}): React.ReactElement {
  const sections = Array.isArray(props.stage.data?.sections) ? props.stage.data.sections as InspectionStageSection[] : [];
  const status = String(props.stage.data?.status || '').trim();

  return (
    <div className="next-stage-scroll">
      <div className="next-inspection-layout">
        <section className="next-inspection-hero">
          <div className="next-mini-label">Live Inspection</div>
          <h3>{props.stage.title}</h3>
          <p>{props.stage.subtitle}</p>
          <div className="next-inspection-status-row">
            <span className={`next-inspection-status${status === 'pending' ? ' is-live' : ''}`}>
              {status === 'pending' ? 'Looking now' : 'Visible'}
            </span>
            {props.stage.summary ? <span>{props.stage.summary}</span> : null}
          </div>
        </section>

        {sections.length ? (
          <div className="next-inspection-sections">
            {sections.map((section) => (
              <section className="next-mini-panel" key={section.label}>
                <div className="next-mini-label">{section.label}</div>
                <div className="next-inspection-card-list">
                  {section.items.length ? section.items.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`next-result-card next-inspection-card${item.openKind ? ' is-openable' : ''}`}
                      onClick={() => item.openKind ? props.onOpenItem?.(item) : undefined}
                      disabled={!item.openKind}
                      title={String(item.preview || item.subtitle || item.title)}
                    >
                      <div className="next-inspection-card-head">
                        <strong>{item.title}</strong>
                        {item.badge ? <span>{item.badge}</span> : null}
                      </div>
                      {item.subtitle ? <div className="next-inspection-card-subtitle">{item.subtitle}</div> : null}
                      {item.preview ? <p>{item.preview}</p> : null}
                    </button>
                  )) : (
                    <div className="next-empty-inline">Nothing surfaced in this section yet.</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="next-empty-state">
            <strong>Nexus is opening the working material.</strong>
            <span>As the current lookup resolves, the sources being inspected should appear here instead of staying hidden.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactStage(props: {
  stage: StageState;
  target: 'focus' | 'workstation';
  onOpenFile?: (filePath: string) => void;
  onReveal?: (filePath: string) => void;
  onSaveFileAs?: (filePath: string, suggestedName?: string) => void;
  onSendToWorkstation?: () => void;
}): React.ReactElement {
  const artifact = props.stage.data as ArtifactPayload | undefined;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canReveal = isRevealableFilePath(artifact?.path);
  const canOpen = canReveal && Boolean(props.onOpenFile);
  const canSaveAs = canReveal && Boolean(props.onSaveFileAs);
  const canSendToWorkstation = props.target === 'focus' && Boolean(props.onSendToWorkstation);
  const suggestedFileName = String(
    artifact?.path?.split(/[\\/]/).pop()
      || artifact?.name
      || 'artifact',
  ).trim() || 'artifact';

  const renderArtifactActions = (className: string = 'next-inline-actions') => (
    canSendToWorkstation || canOpen || canSaveAs || canReveal ? (
      <div className={className}>
        {canSendToWorkstation ? (
          <button type="button" className="next-detail-toggle" onClick={() => props.onSendToWorkstation?.()}>
            Send to Workstation
          </button>
        ) : null}
        {canOpen ? (
          <button type="button" className="next-detail-toggle" onClick={() => props.onOpenFile?.(String(artifact?.path || ''))}>
            Open File
          </button>
        ) : null}
        {canSaveAs ? (
          <button
            type="button"
            className="next-detail-toggle"
            onClick={() => props.onSaveFileAs?.(String(artifact?.path || ''), suggestedFileName)}
          >
            Save As
          </button>
        ) : null}
        {canReveal ? (
          <button type="button" className="next-detail-toggle" onClick={() => props.onReveal?.(String(artifact?.path || ''))}>
            Reveal File
          </button>
        ) : null}
      </div>
    ) : null
  );

  useEffect(() => {
    if (!artifact || artifact.kind !== 'video' || !artifact.dataUrl || !videoRef.current) {
      return;
    }

    const videoElement = videoRef.current;
    const startTime = Number(artifact.startTime);
    const endTime = Number(artifact.endTime);
    let hasAppliedInitialSeek = false;

    const seekToStart = () => {
      if (hasAppliedInitialSeek) {
        return;
      }
      if (Number.isFinite(startTime) && startTime >= 0) {
        const boundedStart = videoElement.duration && Number.isFinite(videoElement.duration)
          ? Math.min(startTime, Math.max(videoElement.duration - 0.1, 0))
          : startTime;
        videoElement.currentTime = Math.max(0, boundedStart);
      }
      hasAppliedInitialSeek = true;
    };

    const stopAtEnd = () => {
      if (!Number.isFinite(endTime) || endTime <= 0) {
        return;
      }
      if (videoElement.currentTime >= endTime) {
        videoElement.pause();
      }
    };

    videoElement.addEventListener('loadedmetadata', seekToStart);
    videoElement.addEventListener('canplay', seekToStart);
    videoElement.addEventListener('timeupdate', stopAtEnd);
    if (videoElement.readyState >= 1) {
      seekToStart();
    }

    return () => {
      videoElement.removeEventListener('loadedmetadata', seekToStart);
      videoElement.removeEventListener('canplay', seekToStart);
      videoElement.removeEventListener('timeupdate', stopAtEnd);
    };
  }, [artifact?.dataUrl, artifact?.endTime, artifact?.kind, artifact?.startTime]);

  if (!artifact) {
    return (
      <div className="next-empty-state">
        <strong>No artifact staged</strong>
        <span>Open a file, report, image, or video to preview it here.</span>
      </div>
    );
  }

  if (artifact.kind === 'image' && artifact.dataUrl) {
    return (
      <div className="next-stage-asset">
        <img src={artifact.dataUrl} alt={artifact.name} className="next-stage-image" />
        <div className="next-overlay-card">
          <div className="next-mini-label">Image Focus</div>
          <strong>{artifact.name}</strong>
          <span>{artifact.path}</span>
          {renderArtifactActions()}
        </div>
      </div>
    );
  }

  if (artifact.kind === 'video' && artifact.dataUrl) {
    return (
      <div className="next-stage-asset">
        <video ref={videoRef} src={artifact.dataUrl} className="next-stage-video" controls playsInline />
        <div className="next-overlay-card">
          <div className="next-mini-label">Video Focus</div>
          <strong>{artifact.name}</strong>
          {Number.isFinite(Number(artifact.startTime)) ? (
            <span>
              Segment {formatVideoTimestamp(artifact.startTime)}
              {Number.isFinite(Number(artifact.endTime)) ? ` → ${formatVideoTimestamp(artifact.endTime)}` : ''}
            </span>
          ) : null}
          <span>{artifact.path}</span>
          {renderArtifactActions()}
        </div>
      </div>
    );
  }

  if (artifact.kind === 'audio' && artifact.dataUrl) {
    return (
      <div className="next-stage-asset next-stage-asset--audio">
        <div className="next-audio-orb">♪</div>
        <audio src={artifact.dataUrl} controls />
        <div className="next-overlay-card">
          <div className="next-mini-label">Audio Focus</div>
          <strong>{artifact.name}</strong>
          <span>{artifact.path}</span>
          {renderArtifactActions()}
        </div>
      </div>
    );
  }

  if ((artifact.mimeType || '').includes('pdf') || artifact.kind === 'pdf' || artifact.kind === 'html') {
    return (
      <div className="next-stage-frame">
        {renderArtifactActions('next-stage-frame-actions')}
        <iframe src={artifact.dataUrl} title={artifact.name} className="next-stage-iframe" />
      </div>
    );
  }

  if (artifact.kind === 'spreadsheet') {
    return (
      <div className="next-stage-scroll">
        <div className="next-rich-document">
          <div className="next-rich-document-header">
            <div>
              <div className="next-mini-label">Spreadsheet Focus</div>
              <h3>{artifact.name}</h3>
              <p>{artifact.path}</p>
            </div>
            {renderArtifactActions()}
          </div>
          <JsonBlock value={artifact.spreadsheetData} />
        </div>
      </div>
    );
  }

  return (
    <div className="next-stage-scroll">
      <div className="next-rich-document">
        <div className="next-rich-document-header">
            <div>
              <div className="next-mini-label">Document Focus</div>
              <h3>{artifact.name}</h3>
              <p>{artifact.path}</p>
            </div>
          {renderArtifactActions()}
        </div>
        <pre className="next-rich-document-text">{artifact.textContent || 'No text preview available.'}</pre>
      </div>
    </div>
  );
}

function DiagramStage(props: {
  stage: StageState;
  target: 'focus' | 'workstation';
  coeditEnabled?: boolean;
  onEnsureFile?: (diagram: DiagramPayload) => Promise<string | void> | string | void;
  onOpenFile?: (filePath: string) => Promise<void> | void;
  onRevealFile?: (filePath: string) => Promise<void> | void;
  onSaveFileAs?: (filePath: string, suggestedName?: string) => Promise<string | null | void> | string | null | void;
  onMoveNode?: (diagramId: string, nodeId: string, x: number, y: number) => Promise<void> | void;
  onSendToWorkstation?: () => void;
  onClose?: () => void;
}): React.ReactElement {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const diagram = props.stage.data as DiagramPayload | undefined;
  const [zoom, setZoom] = useState(1);
  const [workspacePath, setWorkspacePath] = useState('');
  const [fileActionBusy, setFileActionBusy] = useState<'open' | 'reveal' | 'save' | null>(null);
  const [fileActionStatus, setFileActionStatus] = useState('');
  const [dragStatus, setDragStatus] = useState('');
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number; pointerId: number } | null>(null);
  const diagramMotionKey = buildStageMotionKey(props.stage);

  useEffect(() => {
    setZoom(1);
  }, [diagram?.id]);

  useEffect(() => {
    setWorkspacePath('');
    setFileActionBusy(null);
    setFileActionStatus('');
  }, [diagram?.id]);

  useEffect(() => {
    let cancelled = false;

    if (!diagram || !props.onEnsureFile) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.resolve(props.onEnsureFile(diagram)).then((outputPath) => {
      if (cancelled) {
        return;
      }

      const normalizedPath = String(outputPath || '').trim();
      if (normalizedPath) {
        setWorkspacePath(normalizedPath);
      }
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [diagram?.id, diagram?.svg, diagram?.updated_at, props.onEnsureFile]);

  useStageSwapMotion(stageRef, diagramMotionKey, {
    childSelector: '.next-diagram-toolbar, .next-diagram-scroll',
    childDelayStart: 88,
  });

  if (!diagram || !String(diagram.svg || '').trim()) {
    return (
      <div className="next-empty-state">
        <strong>No diagram staged</strong>
        <span>When Nexus opens a native diagram, it should render here instead of falling back to tool JSON.</span>
      </div>
    );
  }

  const nodeCount = Array.isArray(diagram?.spec?.nodes) ? diagram.spec.nodes.length : 0;
  const edgeCount = Array.isArray(diagram?.spec?.edges) ? diagram.spec.edges.length : 0;
  const canSendToWorkstation = props.target === 'focus' && Boolean(props.onSendToWorkstation);
  const canOpenFile = Boolean(props.onOpenFile);
  const canRevealFile = Boolean(props.onRevealFile);
  const canSaveFileAs = Boolean(props.onSaveFileAs);
  const suggestedFileNameBase = String(diagram?.name || 'diagram').trim().replace(/[^a-z0-9._-]+/gi, '_') || 'diagram';
  const suggestedFileName = /\.svg$/i.test(suggestedFileNameBase) ? suggestedFileNameBase : `${suggestedFileNameBase}.svg`;

  const ensureWorkspaceFilePath = async (): Promise<string> => {
    const normalizedExistingPath = String(workspacePath || '').trim();
    if (normalizedExistingPath) {
      return normalizedExistingPath;
    }

    if (!diagram || !props.onEnsureFile) {
      throw new Error('No saved SVG is available for this diagram yet.');
    }

    const outputPath = await props.onEnsureFile(diagram);
    const normalizedOutputPath = String(outputPath || '').trim();
    if (!normalizedOutputPath) {
      throw new Error('No saved SVG is available for this diagram yet.');
    }

    setWorkspacePath(normalizedOutputPath);
    return normalizedOutputPath;
  };

  const handleOpenFile = async () => {
    if (!props.onOpenFile || fileActionBusy) {
      return;
    }
    setFileActionBusy('open');
    setFileActionStatus('');
    try {
      const outputPath = await ensureWorkspaceFilePath();
      await props.onOpenFile(outputPath);
      setFileActionStatus('Opened the saved SVG file.');
    } catch (error) {
      setFileActionStatus(error instanceof Error ? error.message : 'Could not open the saved SVG.');
    } finally {
      setFileActionBusy(null);
    }
  };

  const handleRevealFile = async () => {
    if (!props.onRevealFile || fileActionBusy) {
      return;
    }
    setFileActionBusy('reveal');
    setFileActionStatus('');
    try {
      const outputPath = await ensureWorkspaceFilePath();
      await props.onRevealFile(outputPath);
      setFileActionStatus('Revealed the saved SVG on disk.');
    } catch (error) {
      setFileActionStatus(error instanceof Error ? error.message : 'Could not reveal the saved SVG.');
    } finally {
      setFileActionBusy(null);
    }
  };

  const handleSaveFileAs = async () => {
    if (!props.onSaveFileAs || fileActionBusy) {
      return;
    }
    setFileActionBusy('save');
    setFileActionStatus('');
    try {
      const outputPath = await ensureWorkspaceFilePath();
      const savedPath = await props.onSaveFileAs(outputPath, suggestedFileName);
      setFileActionStatus(savedPath ? `Saved a copy to ${savedPath}` : 'Save cancelled.');
    } catch (error) {
      setFileActionStatus(error instanceof Error ? error.message : 'Could not save the SVG.');
    } finally {
      setFileActionBusy(null);
    }
  };

  const getSvgPoint = (event: React.PointerEvent<HTMLElement>): { x: number; y: number } | null => {
    const svg = stageRef.current?.querySelector('svg');
    if (!svg) {
      return null;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const viewBox = svg.viewBox?.baseVal;
    const width = viewBox?.width || rect.width;
    const height = viewBox?.height || rect.height;
    const x = (viewBox?.x || 0) + ((event.clientX - rect.left) / rect.width) * width;
    const y = (viewBox?.y || 0) + ((event.clientY - rect.top) / rect.height) * height;
    return { x, y };
  };

  const handleDiagramPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!props.coeditEnabled || !diagram?.id) {
      return;
    }

    const target = event.target as Element | null;
    const nodeElement = target?.closest?.('[data-node-id]') as HTMLElement | null;
    const nodeId = nodeElement?.getAttribute('data-node-id') || '';
    const node = Array.isArray(diagram.spec?.nodes)
      ? diagram.spec.nodes.find((entry: any) => String(entry?.id || '') === nodeId)
      : null;
    const point = getSvgPoint(event);
    if (!nodeId || !node || !point) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      nodeId,
      offsetX: point.x - Number(node.x || 0),
      offsetY: point.y - Number(node.y || 0),
      pointerId: event.pointerId,
    };
    setDragStatus(`Dragging ${String(node.label || nodeId)}`);
  };

  const finishDiagramDrag = async (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !diagram?.id) {
      return;
    }

    const point = getSvgPoint(event);
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // Pointer capture may already be released if the cursor left the surface.
    }

    if (!point || !props.onMoveNode) {
      setDragStatus('');
      return;
    }

    const nextX = Math.max(0, Math.round(point.x - drag.offsetX));
    const nextY = Math.max(0, Math.round(point.y - drag.offsetY));
    setDragStatus('Saving node position');
    try {
      await props.onMoveNode(String(diagram.id), drag.nodeId, nextX, nextY);
      setDragStatus('Node moved');
      window.setTimeout(() => setDragStatus(''), 1200);
    } catch (error) {
      setDragStatus(error instanceof Error ? error.message : 'Node move failed');
    }
  };

  return (
    <div className="next-diagram-stage" ref={stageRef}>
      <div className="next-diagram-toolbar">
          <div className="next-diagram-meta">
            <div className="next-mini-label">Native Diagram</div>
            <strong>{diagram.name}</strong>
            <span>{nodeCount || edgeCount ? `${nodeCount} nodes · ${edgeCount} edges` : props.stage.summary || 'Structured SVG diagram'}</span>
            {props.coeditEnabled ? <span>Co-edit on: drag a node to move it.</span> : null}
            {fileActionStatus ? <span>{fileActionStatus}</span> : null}
            {dragStatus ? <span>{dragStatus}</span> : null}
          </div>
        <div className="next-diagram-controls">
          {props.onClose ? (
            <button type="button" className="next-detail-toggle next-diagram-close" onClick={props.onClose}>
              {props.target === 'focus' ? 'Close Preview' : 'Close View'}
            </button>
          ) : null}
          {canSendToWorkstation ? (
            <button type="button" className="next-detail-toggle" onClick={() => props.onSendToWorkstation?.()}>
              Send to Workstation
            </button>
          ) : null}
          {canOpenFile ? (
            <button type="button" className="next-detail-toggle" onClick={() => void handleOpenFile()} disabled={Boolean(fileActionBusy)}>
              {fileActionBusy === 'open' ? 'Opening…' : 'Open File'}
            </button>
          ) : null}
          {canSaveFileAs ? (
            <button type="button" className="next-detail-toggle" onClick={() => void handleSaveFileAs()} disabled={Boolean(fileActionBusy)}>
              {fileActionBusy === 'save' ? 'Saving…' : 'Save SVG As'}
            </button>
          ) : null}
          {canRevealFile ? (
            <button type="button" className="next-detail-toggle" onClick={() => void handleRevealFile()} disabled={Boolean(fileActionBusy)}>
              {fileActionBusy === 'reveal' ? 'Revealing…' : 'Reveal File'}
            </button>
          ) : null}
          <button type="button" className="next-detail-toggle" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))}>-</button>
          <button type="button" className="next-detail-toggle" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="next-detail-toggle" onClick={() => setZoom((value) => Math.min(2.5, Number((value + 0.1).toFixed(2))))}>+</button>
        </div>
      </div>

      <div className="next-diagram-scroll">
        <div
          className={`next-diagram-canvas${props.coeditEnabled ? ' is-coedit-enabled' : ''}`}
          style={{
            width: `${zoom * 100}%`,
          }}
          onPointerDown={handleDiagramPointerDown}
          onPointerUp={(event) => { void finishDiagramDrag(event); }}
          onPointerCancel={(event) => { void finishDiagramDrag(event); }}
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      </div>
    </div>
  );
}

function OutputShelf(props: {
  files: any[];
  currentSessionId?: string | null;
  scope: 'session' | 'all';
  onScopeChange: (scope: 'session' | 'all') => void;
  loadingPath: string | null;
  onOpenHere: (filePath: string) => void;
  onOpenInFocus: (filePath: string) => void;
  onReveal: (filePath: string) => void;
}): React.ReactElement {
  const normalizedSessionId = String(props.currentSessionId || '').trim();
  const sessionFiles = useMemo(
    () => props.files.filter((file) => String(file?.sessionId || '').trim() === normalizedSessionId),
    [props.files, normalizedSessionId],
  );
  const canUseSessionScope = Boolean(normalizedSessionId && sessionFiles.length);
  const activeScope = props.scope === 'session' && canUseSessionScope ? 'session' : 'all';
  const visibleFiles = activeScope === 'session' ? sessionFiles : props.files;

  return (
    <div className="next-workstation-files">
      <div className="next-workstation-files-head">
        <div>
          <div className="next-mini-label">Output Shelf</div>
          <p className="next-panel-copy">
            Durable files stay here so Nexus outputs can be reopened, moved into focus, or revealed on disk.
          </p>
        </div>
        <div className="next-status-chip-row">
          <button
            type="button"
            className={`next-marketing-chip next-chip-button${activeScope === 'session' ? ' is-active' : ''}`}
            onClick={() => props.onScopeChange('session')}
            disabled={!canUseSessionScope}
          >
            {formatCompactNumber(sessionFiles.length)} this session
          </button>
          <button
            type="button"
            className={`next-marketing-chip next-chip-button${activeScope === 'all' ? ' is-active' : ''}`}
            onClick={() => props.onScopeChange('all')}
          >
            {formatCompactNumber(props.files.length)} all outputs
          </button>
        </div>
      </div>

      <div className="next-file-grid">
        {visibleFiles.length ? visibleFiles.map((file) => {
          const loading = props.loadingPath === file.path;
          return (
            <article className="next-file-card" key={file.path}>
              <strong>{file.name}</strong>
              <span>{file.kind || file.sourceType || 'artifact'}</span>
              <p>
                {[formatFileSize(file.size), formatDateLabel(file.modifiedAt)].filter(Boolean).join(' • ') || 'Saved workspace artifact'}
              </p>
              <div className="next-file-card-actions">
                <button
                  type="button"
                  className="next-card-action"
                  onClick={() => props.onOpenHere(String(file.path))}
                >
                  {loading ? 'Opening…' : 'Open Here'}
                </button>
                <button
                  type="button"
                  className="next-card-action"
                  onClick={() => props.onOpenInFocus(String(file.path))}
                >
                  {loading ? 'Sending…' : 'Send to AI Focus'}
                </button>
                {isRevealableFilePath(file.path) ? (
                  <button
                    type="button"
                    className="next-card-action"
                    onClick={() => props.onReveal(String(file.path))}
                  >
                    Reveal File
                  </button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div className="next-empty-inline">
            {activeScope === 'session'
              ? 'No durable outputs have been saved for this session yet.'
              : 'No saved workspace outputs were found yet.'}
          </div>
        )}
      </div>
    </div>
  );
}

function LegalStage(props: { stage: StageState }): React.ReactElement {
  const report = props.stage.data || {};
  const clauses = Array.isArray(report?.clauses) ? report.clauses : [];
  const improvements = Array.isArray(report?.consolidatedImprovements) ? report.consolidatedImprovements : [];

  return (
    <div className="next-stage-scroll">
      <div className="next-legal-layout">
        <section className="next-legal-main">
          <div className="next-score-grid">
            <div className="next-score-card">
              <span>Readiness</span>
              <strong>{Number(report?.readinessScore || 0)}</strong>
            </div>
            <div className="next-score-card">
              <span>Red Flags</span>
              <strong>{Number(report?.summary?.red || 0)}</strong>
            </div>
            <div className="next-score-card">
              <span>Yellow Flags</span>
              <strong>{Number(report?.summary?.yellow || 0)}</strong>
            </div>
            <div className="next-score-card">
              <span>Green Flags</span>
              <strong>{Number(report?.summary?.green || 0)}</strong>
            </div>
          </div>

          <div className="next-legal-callout">
            <div className="next-mini-label">Overall Analysis</div>
            <p>{report?.overallAnalysis || report?.introduction || 'Saved legal analysis report is ready.'}</p>
          </div>

          <div className="next-flag-list">
            {clauses.slice(0, 6).map((clause: any) => (
              <article className={`next-flag next-flag--${clause.flag || 'yellow'}`} key={`${clause.clauseNumber}-${clause.title}`}>
                <div className="next-flag-mark">
                  {clause.flag === 'red' ? '🔴' : clause.flag === 'green' ? '🟢' : '🟡'}
                </div>
                <div className="next-flag-body">
                  <strong>
                    Clause {clause.clauseNumber}: {clause.title}
                  </strong>
                  <p>{clause.reason || clause.aiAnalysis || clause.content}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="next-legal-sidebar">
          <div className="next-mini-panel">
            <div className="next-mini-label">Warnings</div>
            <ul>
              {(report?.analysisWarnings || []).length
                ? report.analysisWarnings.map((warning: string) => <li key={warning}>{warning}</li>)
                : <li>No analysis warnings on this report.</li>}
            </ul>
          </div>
          <div className="next-mini-panel">
            <div className="next-mini-label">Recommendations</div>
            <ul>
              {(report?.conclusion?.recommendations || []).slice(0, 5).map((item: string) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="next-mini-panel">
            <div className="next-mini-label">Improvements</div>
            <ul>
              {improvements.slice(0, 5).map((item: any, index: number) => (
                <li key={`${item?.clause || 'clause'}-${index}`}>
                  <strong>{item?.clause || 'Clause'}</strong>
                  <span>{item?.improvement}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BrowserStage(props: {
  stage: StageState;
  onOpenResult?: (result: any, target?: 'focus' | 'workstation') => void;
}): React.ReactElement {
  const data = props.stage.data || {};
  const results = Array.isArray(data.results) ? data.results : [];
  const page = data.page || null;
  const liveUrl = String(page?.url || data.frameUrl || '').trim();
  const canEmbedLiveUrl = /^https?:\/\//i.test(liveUrl);

  return (
    <div className="next-browser-layout">
      <aside className="next-browser-results">
        <div className="next-mini-label">Search Stack</div>
        {results.length ? results.slice(0, 6).map((result: any) => (
          <button
            className="next-result-card"
            type="button"
            key={result.url}
            onClick={() => props.onOpenResult?.(result, 'focus')}
            title={String(result.snippet || result.url || '').trim()}
          >
            <strong>{result.title}</strong>
            <p>{String(result.snippet || result.url || '').trim()}</p>
          </button>
        )) : (
          <div className="next-mini-panel">Search results will appear here once Nexus starts browsing.</div>
        )}
      </aside>
      <section className="next-browser-article">
        <div className="next-browser-hud">
          <span>{data.query ? `Query: ${data.query}` : 'Live browsing path'}</span>
          <span>{page?.url || props.stage.subtitle}</span>
        </div>
        {canEmbedLiveUrl ? (
          <div className="next-browser-liveframe">
            <iframe
              src={liveUrl}
              title={page?.title || props.stage.title}
              className="next-stage-iframe next-stage-iframe--browser"
            />
          </div>
        ) : null}
        <div className="next-browser-page">
          <h3>{page?.title || props.stage.title}</h3>
          <p>{truncateText(page?.text || props.stage.summary || props.stage.subtitle, 2200)}</p>
        </div>
      </section>
    </div>
  );
}

function WorkTraceFeed(props: {
  events: WorkTraceEvent[];
  emptyText?: string;
}): React.ReactElement {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const traceMotionKey = props.events.length
    ? props.events.map((event) => `${event.id}:${event.phase}`).join('|')
    : `empty:${props.emptyText || 'default'}`;

  useListStaggerMotion(feedRef, traceMotionKey, {
    selector: '.next-trace-row',
    axis: 'y',
    distance: 18,
    startDelay: 40,
  });

  return (
    <div className="next-trace-feed" ref={feedRef}>
      {props.events.length ? props.events.map((event) => (
        <article className={`next-trace-row is-${event.phase}`} key={event.id}>
          <div className="next-trace-row-copy">
            <div className="next-trace-row-head">
              <strong>{event.label}</strong>
              <span className="next-trace-chip">{describeWorkTracePhase(event.phase)}</span>
            </div>
            <p>{event.summary}</p>
            <div className="next-trace-row-meta">
              <span>{event.toolName || event.kind}</span>
              <span>{formatRelativeDate(event.timestamp)}</span>
            </div>
          </div>
        </article>
      )) : (
        <div className="next-empty-inline">{props.emptyText || 'Visible execution will stream here once Nexus starts working.'}</div>
      )}
    </div>
  );
}

function NexusPulsePanel(props: {
  conversationStatus: ConversationStatus;
  conversationMode: ConversationMode;
  pulseMode: NexusPulseMode;
  voiceSummary: string;
  voiceMeta: string;
  isVoiceMicMuted: boolean;
  roomVisionStatus: RoomVisionStatus;
  roomVisionError: string;
  roomVisionCameraLabel: string;
  latestRoomSnapshot: RoomVisionSnapshot | null;
  roomVideoRef: React.RefObject<HTMLVideoElement | null>;
  sessionRuntime?: SessionRuntimeState | null;
  lastUserMessage?: MessageRecord | null;
  lastAssistantMessage?: MessageRecord | null;
  workTraceEvents: WorkTraceEvent[];
  onToggleConversation: () => void;
  onToggleVoiceMicMute: () => void;
  onToggleRoomVision: () => void;
  onShareRoomSnapshot: () => void;
  onStartTextSession: () => void;
  onEndSessionRuntime: () => void;
  onRunSessionCycle: () => void;
}): React.ReactElement {
  const panelRef = useRef<HTMLElement | null>(null);
  const latestTrace = props.workTraceEvents[0] || null;
  const liveCaption = props.conversationMode === 'speaking'
    ? props.lastAssistantMessage?.content
    : props.lastUserMessage?.content;
  const pulseLabel = latestTrace?.label || props.voiceSummary;
  const pulseMeta = latestTrace?.summary || props.voiceMeta;
  const canMute = props.conversationStatus === 'connected' || props.conversationStatus === 'connecting';
  const runtimeModeLabel = props.sessionRuntime?.mode ? props.sessionRuntime.mode.replace('_', ' ') : 'chat';
  const runtimeStageLabel = props.sessionRuntime?.stageMode || 'research';
  const runtimeStatusLabel = props.sessionRuntime?.status ? props.sessionRuntime.status.replace('_', ' ') : 'idle';
  const sessionIsActive = Boolean(props.sessionRuntime && props.sessionRuntime.mode !== 'chat');
  const pulseMotionKey = [
    props.pulseMode,
    props.conversationStatus,
    props.conversationMode,
    props.roomVisionStatus,
    latestTrace?.id || 'no-trace',
    props.sessionRuntime?.status || 'no-runtime',
    String(props.sessionRuntime?.cycleCount || 0),
  ].join('|');

  useStageSwapMotion(panelRef, pulseMotionKey, {
    childSelector: '.next-voice-square, .next-pulse-copy, .next-pulse-caption, .next-pulse-tool, .next-room-view, .next-pulse-controls, .next-pulse-trace',
    childDelayStart: 70,
  });

  return (
    <section className="next-panel next-voice-panel next-pulse-panel" ref={panelRef}>
      <div
        className={`next-voice-square${props.conversationStatus === 'connected' || props.conversationStatus === 'connecting' ? ' is-live' : ''}${props.conversationStatus === 'connecting' ? ' is-connecting' : ''}${props.pulseMode === 'speaking' ? ' is-speaking' : ''}${props.pulseMode === 'listening' ? ' is-listening' : ''}${props.pulseMode === 'thinking' || props.pulseMode === 'tooling' ? ' is-thinking' : ''}${props.pulseMode === 'browsing' ? ' is-browsing' : ''}${props.pulseMode === 'approval' ? ' is-approval' : ''}${props.pulseMode === 'error' ? ' is-error' : ''}`}
        role="button"
        tabIndex={0}
        onClick={props.onToggleConversation}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onToggleConversation();
          }
        }}
        title={props.conversationStatus === 'connected' || props.conversationStatus === 'connecting' ? 'End voice session' : 'Start voice session'}
        aria-label={props.conversationStatus === 'connected' || props.conversationStatus === 'connecting' ? 'End voice session' : 'Start voice session'}
      >
        <div className="next-voice-emblem" aria-hidden="true">
          <CrestEmblem />
        </div>
        <div className="next-mic-core" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
            <path d="M18 11a6 6 0 1 1-12 0" />
            <path d="M12 17v4" />
            <path d="M8 21h8" />
          </svg>
        </div>
        <div className="next-voice-signal" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="next-pulse-copy">
        <div className="next-pulse-state-row">
          <div className="next-panel-label">Nexus Pulse</div>
          <span className={`next-pulse-state-pill is-${props.pulseMode}`}>{props.pulseMode.replace(/^\w/, (c) => c.toUpperCase())}</span>
        </div>
        <div className="next-status-copy">{pulseLabel}</div>
        <div className="next-status-meta">{pulseMeta}</div>

        {liveCaption ? (
          <div className="next-pulse-caption">
            <div className="next-mini-label">{props.conversationMode === 'speaking' ? 'Speaking' : 'Listening'}</div>
            <p>{truncateText(liveCaption, 240)}</p>
          </div>
        ) : null}

        {latestTrace ? (
          <div className="next-pulse-tool">
            <div className="next-mini-label">Current Tool</div>
            <strong>{latestTrace.toolName || latestTrace.label}</strong>
            <span>{describeWorkTracePhase(latestTrace.phase)} · {latestTrace.kind}</span>
          </div>
        ) : null}

        <div className="next-pulse-tool">
          <div className="next-mini-label">Session Runtime</div>
          <strong>{runtimeModeLabel}</strong>
          <span>{runtimeStatusLabel} · {runtimeStageLabel}</span>
        </div>

        {props.sessionRuntime?.objective ? (
          <div className="next-pulse-caption">
            <div className="next-mini-label">Objective</div>
            <p>{truncateText(props.sessionRuntime.currentTask || props.sessionRuntime.objective, 220)}</p>
          </div>
        ) : null}

        <div className="next-pulse-controls">
          {sessionIsActive ? (
            <>
              <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onRunSessionCycle}>
                Run Cycle
              </button>
              <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onEndSessionRuntime}>
                End Session
              </button>
            </>
          ) : (
            <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onStartTextSession}>
              Start Session
            </button>
          )}
          <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onToggleConversation}>
            {props.conversationStatus === 'connected' || props.conversationStatus === 'connecting' ? 'End Voice' : 'Start Voice'}
          </button>
          {canMute ? (
            <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onToggleVoiceMicMute}>
              {props.isVoiceMicMuted ? 'Unmute Mic' : 'Mute Mic'}
            </button>
          ) : null}
        </div>

        <div className={`next-room-view is-${props.roomVisionStatus}`}>
          <div className="next-room-view-top">
            <div>
              <div className="next-mini-label">Room View</div>
              <strong>{formatRoomVisionStatus(props.roomVisionStatus)}</strong>
            </div>
            <span>{props.roomVisionCameraLabel || 'Camera'}</span>
          </div>
          <div className="next-room-view-frame">
            <video ref={props.roomVideoRef} className="next-room-view-video" muted playsInline autoPlay />
            {props.latestRoomSnapshot?.dataUrl ? (
              <img src={props.latestRoomSnapshot.dataUrl} alt="Latest room snapshot" className="next-room-view-snapshot" />
            ) : null}
            {(props.roomVisionStatus === 'off' || props.roomVisionStatus === 'error') && !props.latestRoomSnapshot?.dataUrl ? (
              <div className="next-room-view-placeholder">
                {props.roomVisionStatus === 'error' ? props.roomVisionError || 'Camera failed.' : 'Start camera to share a room snapshot.'}
              </div>
            ) : null}
          </div>
          {props.latestRoomSnapshot?.description ? (
            <p>{truncateText(props.latestRoomSnapshot.description, 180)}</p>
          ) : null}
          <div className="next-room-view-actions">
            <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={props.onToggleRoomVision}>
              {props.roomVisionStatus === 'off' || props.roomVisionStatus === 'error' ? 'Start Camera' : 'Stop Camera'}
            </button>
            <button
              type="button"
              className="next-detail-toggle next-detail-toggle--panel"
              onClick={props.onShareRoomSnapshot}
              disabled={props.roomVisionStatus === 'starting' || props.roomVisionStatus === 'capturing' || props.roomVisionStatus === 'analyzing'}
            >
              {props.roomVisionStatus === 'off' || props.roomVisionStatus === 'error' ? 'Start + Share' : 'Share Snapshot'}
            </button>
          </div>
        </div>

        <div className="next-pulse-trace">
          <div className="next-mini-label">Visible Work</div>
          <WorkTraceFeed events={props.workTraceEvents.slice(0, 4)} emptyText="The next tool, search, approval, or artifact will appear here." />
        </div>
      </div>
    </section>
  );
}

function formatEyeContactStatus(status: EyeContactControlStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'looking':
      return 'Looking';
    case 'away':
      return 'Away';
    case 'error':
      return 'Error';
    case 'off':
    default:
      return 'Off';
  }
}

function ControlToggle(props: {
  label: string;
  detail: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`next-control-toggle${props.enabled ? ' is-on' : ''}`}
      onClick={props.onToggle}
      disabled={props.disabled}
    >
      <span className="next-control-switch" aria-hidden="true" />
      <span>
        <strong>{props.label}</strong>
        <small>{props.detail}</small>
      </span>
    </button>
  );
}

function NexusControlLayerPanel(props: {
  controls: ControlLayerState;
  eyeContactStatus: EyeContactControlStatus;
  gazeAssessment: GazeAssessment;
  gazeStrictness: number;
  browserQuery: string;
  browserStatus: string;
  meetingStatus: string;
  diagramPrompt: string;
  diagramStatus: string;
  codeMapStatus: string;
  busyAction: string;
  onToggleCollaboration: () => void;
  onToggleEyeContact: () => void;
  onToggleHandControl: () => void;
  onToggleBrowserControl: () => void;
  onToggleMeetingMode: () => void;
  onToggleDiagramCoEdit: () => void;
  onGazeStrictnessChange: (value: number) => void;
  onBrowserQueryChange: (value: string) => void;
  onRunBrowserSearch: () => void;
  onCaptureBrowserPage: () => void;
  onDiagramPromptChange: (value: string) => void;
  onCreatePlanningDiagram: () => void;
  onCreateCodeMap: () => void;
  onCompileMeetingBrief: () => void;
}): React.ReactElement {
  const gazeScore = Math.round((props.gazeAssessment.metrics?.smoothedScore || 0) * 100);
  const masterEnabled = props.controls.collaboration;

  return (
    <section className={`next-panel next-control-layer-panel${masterEnabled ? ' is-on' : ''}`}>
      <div className="next-control-layer-head">
        <div>
          <div className="next-panel-label">Control Layer</div>
          <strong>Shared room</strong>
        </div>
        <button
          type="button"
          className={`next-control-master${masterEnabled ? ' is-on' : ''}`}
          onClick={props.onToggleCollaboration}
        >
          {masterEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="next-control-grid">
        <ControlToggle
          label="Eye Contact"
          detail={`${formatEyeContactStatus(props.eyeContactStatus)} · ${gazeScore}% · ${props.gazeAssessment.reason}`}
          enabled={props.controls.eyeContact}
          disabled={!masterEnabled}
          onToggle={props.onToggleEyeContact}
        />
        <ControlToggle
          label="Hand Control"
          detail={props.controls.handControl ? 'Gesture layer armed for clicks and visual selection' : 'Gesture layer gated'}
          enabled={props.controls.handControl}
          disabled={!masterEnabled}
          onToggle={props.onToggleHandControl}
        />
        <ControlToggle
          label="Browser Control"
          detail={props.browserStatus}
          enabled={props.controls.browserControl}
          disabled={!masterEnabled}
          onToggle={props.onToggleBrowserControl}
        />
        <ControlToggle
          label="Meeting Mode"
          detail={props.meetingStatus}
          enabled={props.controls.meetingMode}
          disabled={!masterEnabled}
          onToggle={props.onToggleMeetingMode}
        />
        <ControlToggle
          label="Diagram Co-Edit"
          detail={props.diagramStatus}
          enabled={props.controls.diagramCoEdit}
          disabled={!masterEnabled}
          onToggle={props.onToggleDiagramCoEdit}
        />
      </div>

      <label className="next-control-range">
        <span>Gaze strictness</span>
        <input
          type="range"
          min="0.2"
          max="0.86"
          step="0.02"
          value={props.gazeStrictness}
          disabled={!masterEnabled || !props.controls.eyeContact}
          onChange={(event) => props.onGazeStrictnessChange(Number(event.currentTarget.value))}
        />
      </label>

      <div className="next-control-inline-form">
        <input
          value={props.browserQuery}
          onChange={(event) => props.onBrowserQueryChange(event.currentTarget.value)}
          placeholder="Search or open browser context"
          disabled={!masterEnabled || !props.controls.browserControl}
        />
        <button
          type="button"
          className="next-detail-toggle next-detail-toggle--panel"
          onClick={props.onRunBrowserSearch}
          disabled={!masterEnabled || !props.controls.browserControl || Boolean(props.busyAction)}
        >
          Search
        </button>
        <button
          type="button"
          className="next-detail-toggle next-detail-toggle--panel"
          onClick={props.onCaptureBrowserPage}
          disabled={!masterEnabled || !props.controls.browserControl || Boolean(props.busyAction)}
        >
          Capture
        </button>
      </div>

      <div className="next-control-inline-form">
        <input
          value={props.diagramPrompt}
          onChange={(event) => props.onDiagramPromptChange(event.currentTarget.value)}
          placeholder="Plan the meeting deliverables as a diagram"
          disabled={!masterEnabled || !props.controls.diagramCoEdit}
        />
        <button
          type="button"
          className="next-detail-toggle next-detail-toggle--panel"
          onClick={props.onCreatePlanningDiagram}
          disabled={!masterEnabled || !props.controls.diagramCoEdit || Boolean(props.busyAction)}
        >
          Diagram
        </button>
      </div>

      <div className="next-control-actions">
        <button
          type="button"
          className="next-detail-toggle next-detail-toggle--panel"
          onClick={props.onCreateCodeMap}
          disabled={!masterEnabled || Boolean(props.busyAction)}
        >
          Code Map
        </button>
        <button
          type="button"
          className="next-detail-toggle next-detail-toggle--panel"
          onClick={props.onCompileMeetingBrief}
          disabled={!props.controls.meetingMode || Boolean(props.busyAction)}
        >
          Compile Brief
        </button>
        <span>{props.busyAction || props.codeMapStatus}</span>
      </div>
    </section>
  );
}

function ActivityStage(props: {
  stage: StageState;
  focusEvents: FocusEventRecord[];
  workTraceEvents: WorkTraceEvent[];
  metrics: Array<{ label: string; value: string | number; detail: string }>;
}): React.ReactElement {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const cards = Array.isArray(props.stage.data?.cards) ? props.stage.data.cards : [];
  const isIdleFocus = isDefaultFocusStage(props.stage);
  const stageMotionKey = `${buildStageMotionKey(props.stage)}|focus-events:${props.focusEvents[0]?.id || 'none'}|trace:${props.workTraceEvents[0]?.id || 'none'}`;
  const historyMotionKey = props.focusEvents.length
    ? props.focusEvents.map((event) => event.id).join('|')
    : 'history-empty';

  useStageSwapMotion(stageRef, stageMotionKey, {
    childSelector: '.next-activity-hero, .next-mini-panel, .next-stat-card, .next-mode-card',
    childDelayStart: 90,
  });

  useListStaggerMotion(historyRef, historyMotionKey, {
    selector: '.next-event-row',
    axis: 'y',
    distance: 20,
    startDelay: 56,
  });

  return (
    <div className="next-stage-scroll" ref={stageRef}>
      <div className="next-activity-grid">
        <section className="next-activity-hero">
          {isIdleFocus ? (
            <div className="next-empty-state next-empty-state--focus">
              <strong>AI Focus is empty until Nexus looks at something real.</strong>
              <span>
                When Nexus opens a transcript, report, browser page, diagram, image, or document, it should appear here live instead of being handled offstage.
              </span>
            </div>
          ) : (
            <>
              <div className="next-mini-label">Live Mission</div>
              <h3>{props.stage.title}</h3>
              <p>{props.stage.subtitle}</p>
              <div className="next-stat-grid">
                {props.metrics.map((metric) => (
                  <div className="next-stat-card" key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <p>{metric.detail}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="next-activity-panels">
          {cards.length ? (
            <div className="next-mini-panel">
              <div className="next-mini-label">Presentation Modes</div>
              <div className="next-card-grid">
                {cards.map((card: any) => (
                  <div className="next-mode-card" key={card.label}>
                    <strong>{card.label}</strong>
                    <b>{card.value}</b>
                    <p>{card.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="next-mini-panel">
            <div className="next-mini-label">Visible Work Trace</div>
            <WorkTraceFeed events={props.workTraceEvents} emptyText="Every visible tool run will stream here once Nexus starts working." />
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Focus History</div>
            <div className="next-event-feed" ref={historyRef}>
              {props.focusEvents.length ? props.focusEvents.map((event) => (
                <article className="next-event-row" key={event.id}>
                  <div>
                    <strong>{event.label}</strong>
                    <p>{event.summary}</p>
                  </div>
                  <span>{formatRelativeDate(event.createdAt)}</span>
                </article>
              )) : (
                <div className="next-empty-inline">Focus-stage promotions will appear here as Nexus changes what it is looking at.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

interface KnowledgeGraphSelection {
  id: string;
  kind: 'cluster' | 'document' | 'person' | 'business' | 'memory' | 'graph';
  clusterId: string;
  title: string;
  subtitle: string;
  description: string;
  truthLayer?: 'Canonical' | 'Derived' | 'Live';
  metric?: string;
  actionLabel?: string;
  documentId?: string;
  entityType?: 'person' | 'business';
  entityId?: string;
}

interface KnowledgeStatsPayload {
  tier1: number;
  tier2: number;
  tier3: number;
  documents: number;
  researchSources?: number;
  researchFindings?: number;
  retrievalBackend?: string;
  understandGraph?: {
    installed?: boolean;
    graphPath?: string;
    graphExists?: boolean;
    graphUpdatedAt?: string;
    dashboardUrl?: string;
    stats?: {
      files?: number;
      nodes?: number;
      edges?: number;
      layers?: number;
      tourSteps?: number;
    };
    project?: {
      name?: string;
      description?: string;
      analyzedAt?: string;
    };
  } | null;
  workingMemory: {
    recentTurns: number;
    recentToolOutcomes: number;
    recentDocuments: number;
    activeTasks: number;
    reflectiveSignals: number;
    total: number;
  };
  health: {
    currentSessionProjectLinked: boolean;
    sessionDocumentsMissingArtifactPath: number;
    sessionDocumentsMissingArtifactRows: number;
    sessionDocumentsMissingChunks: number;
    workspaceDocumentsMissingArtifactPath: number;
    workspaceDocumentsMissingArtifactRows: number;
    workspaceDocumentsMissingChunks: number;
    workspaceChunksMissingEmbeddings: number;
    workspaceSessionsWithoutProject: number;
  };
}

const DEFAULT_KNOWLEDGE_STATS: KnowledgeStatsPayload = {
  tier1: 0,
  tier2: 0,
  tier3: 0,
  documents: 0,
  researchSources: 0,
  researchFindings: 0,
  retrievalBackend: 'understand-anything',
  understandGraph: null,
  workingMemory: {
    recentTurns: 0,
    recentToolOutcomes: 0,
    recentDocuments: 0,
    activeTasks: 0,
    reflectiveSignals: 0,
    total: 0,
  },
  health: {
    currentSessionProjectLinked: false,
    sessionDocumentsMissingArtifactPath: 0,
    sessionDocumentsMissingArtifactRows: 0,
    sessionDocumentsMissingChunks: 0,
    workspaceDocumentsMissingArtifactPath: 0,
    workspaceDocumentsMissingArtifactRows: 0,
    workspaceDocumentsMissingChunks: 0,
    workspaceChunksMissingEmbeddings: 0,
    workspaceSessionsWithoutProject: 0,
  },
};

function normalizeKnowledgeStats(value: any): KnowledgeStatsPayload {
  return {
    tier1: Number(value?.tier1 || 0),
    tier2: Number(value?.tier2 || 0),
    tier3: Number(value?.tier3 || 0),
    documents: Number(value?.documents || 0),
    researchSources: Number(value?.researchSources || 0),
    researchFindings: Number(value?.researchFindings || 0),
    retrievalBackend: String(value?.retrievalBackend || 'understand-anything'),
    understandGraph: value?.understandGraph && typeof value.understandGraph === 'object'
      ? {
          installed: Boolean(value.understandGraph.installed),
          graphPath: String(value.understandGraph.graphPath || ''),
          graphExists: Boolean(value.understandGraph.graphExists),
          graphUpdatedAt: String(value.understandGraph.graphUpdatedAt || ''),
          dashboardUrl: String(value.understandGraph.dashboardUrl || ''),
          stats: {
            files: Number(value.understandGraph.stats?.files || 0),
            nodes: Number(value.understandGraph.stats?.nodes || 0),
            edges: Number(value.understandGraph.stats?.edges || 0),
            layers: Number(value.understandGraph.stats?.layers || 0),
            tourSteps: Number(value.understandGraph.stats?.tourSteps || 0),
          },
          project: {
            name: String(value.understandGraph.project?.name || ''),
            description: String(value.understandGraph.project?.description || ''),
            analyzedAt: String(value.understandGraph.project?.analyzedAt || ''),
          },
        }
      : null,
    workingMemory: {
      recentTurns: Number(value?.workingMemory?.recentTurns || 0),
      recentToolOutcomes: Number(value?.workingMemory?.recentToolOutcomes || 0),
      recentDocuments: Number(value?.workingMemory?.recentDocuments || 0),
      activeTasks: Number(value?.workingMemory?.activeTasks || 0),
      reflectiveSignals: Number(value?.workingMemory?.reflectiveSignals || 0),
      total: Number(value?.workingMemory?.total || 0),
    },
    health: {
      currentSessionProjectLinked: Boolean(value?.health?.currentSessionProjectLinked),
      sessionDocumentsMissingArtifactPath: Number(value?.health?.sessionDocumentsMissingArtifactPath || 0),
      sessionDocumentsMissingArtifactRows: Number(value?.health?.sessionDocumentsMissingArtifactRows || 0),
      sessionDocumentsMissingChunks: Number(value?.health?.sessionDocumentsMissingChunks || 0),
      workspaceDocumentsMissingArtifactPath: Number(value?.health?.workspaceDocumentsMissingArtifactPath || 0),
      workspaceDocumentsMissingArtifactRows: Number(value?.health?.workspaceDocumentsMissingArtifactRows || 0),
      workspaceDocumentsMissingChunks: Number(value?.health?.workspaceDocumentsMissingChunks || 0),
      workspaceChunksMissingEmbeddings: Number(value?.health?.workspaceChunksMissingEmbeddings || 0),
      workspaceSessionsWithoutProject: Number(value?.health?.workspaceSessionsWithoutProject || 0),
    },
  };
}

function getWorkingMemoryTotal(stats: KnowledgeStatsPayload | any): number {
  return Number(stats?.workingMemory?.total || 0);
}

function getStoredMemoryTotal(stats: KnowledgeStatsPayload | any): number {
  return Number(stats?.tier1 || 0) + Number(stats?.tier2 || 0) + Number(stats?.tier3 || 0);
}

function InfoBubble(props: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <span className="next-info-bubble" tabIndex={0}>
      <span className="next-info-bubble-icon" aria-hidden="true">i</span>
      <span className="sr-only">{props.label}</span>
      <span className="next-info-bubble-popover" role="tooltip">
        <strong>{props.label}</strong>
        <span>{props.children}</span>
      </span>
    </span>
  );
}

function InlineLoading(props: { label: string }): React.ReactElement {
  return (
    <span className="next-loading-inline">
      <span className="next-loading-ring" aria-hidden="true" />
      <span>{props.label}</span>
    </span>
  );
}

function FlowStep(props: {
  index: number;
  label: string;
  value: string;
  detail: string;
  state?: 'ready' | 'active' | 'waiting' | 'blocked';
}): React.ReactElement {
  return (
    <div className={`next-flow-step is-${props.state || 'waiting'}`}>
      <span className="next-flow-step-index">{props.index}</span>
      <div>
        <strong>{props.label}</strong>
        <span>{props.value}</span>
        <small>{props.detail}</small>
      </div>
    </div>
  );
}

function getKnowledgeClusterLabel(clusterId: string): string {
  switch (clusterId) {
    case 'graph':
      return 'Understand Graph';
    case 'research':
      return 'Research Sources';
    case 'memory':
      return 'Working Memory';
    case 'deep-memory':
      return 'Stored Memory';
    case 'people':
      return 'People';
    case 'businesses':
      return 'Businesses';
    case 'documents':
    default:
      return 'Knowledge Docs';
  }
}

function buildKnowledgeHealthRows(stats: KnowledgeStatsPayload | any): Array<{ label: string; value: string; detail: string }> {
  const normalized = normalizeKnowledgeStats(stats);
  const graphStats = normalized.understandGraph?.stats || {};
  return [
    {
      label: 'Graph Backend',
      value: normalized.understandGraph?.graphExists ? 'Understand Anything' : 'Sync Pending',
      detail: normalized.understandGraph?.graphExists
        ? `${Number(graphStats.nodes || 0)} nodes, ${Number(graphStats.edges || 0)} edges, ${Number(graphStats.layers || 0)} layers.`
        : 'The Nexus document store will be projected into an Understand Anything graph on the next sync.',
    },
    {
      label: 'Research Intake',
      value: `${Number(normalized.researchSources || 0)} sources · ${Number(normalized.researchFindings || 0)} findings`,
      detail: 'Research Department transcripts and classifications are included in the graph sync, alongside normal knowledge documents.',
    },
    {
      label: 'Session Project',
      value: normalized.health.currentSessionProjectLinked ? 'Linked' : 'Unassigned',
      detail: normalized.health.currentSessionProjectLinked
        ? 'The current session already has a project thread.'
        : 'This session is not yet linked to a project thread.',
    },
    {
      label: 'Artifact Links',
      value: `${normalized.health.sessionDocumentsMissingArtifactRows} session · ${normalized.health.workspaceDocumentsMissingArtifactRows} workspace`,
      detail: 'Searchable documents without matching artifact rows are harder to reopen and trace.',
    },
    {
      label: 'File Metadata',
      value: `${normalized.health.sessionDocumentsMissingArtifactPath} session · ${normalized.health.workspaceDocumentsMissingArtifactPath} workspace`,
      detail: 'Documents missing artifact paths lose direct file lineage even if the text was ingested.',
    },
    {
      label: 'Retrieval Gaps',
      value: `${normalized.health.sessionDocumentsMissingChunks} session · ${normalized.health.workspaceDocumentsMissingChunks} docs · ${normalized.health.workspaceChunksMissingEmbeddings} chunks`,
      detail: 'Chunk and embedding gaps weaken retrieval even when the base document still exists.',
    },
  ];
}

function buildKnowledgeClusterItems(
  clusterId: string,
  documents: any[],
  people: any[],
  businesses: any[],
  stats: KnowledgeStatsPayload,
): KnowledgeGraphSelection[] {
  if (clusterId === 'graph') {
    const graphStats = stats?.understandGraph?.stats || {};
    return [
      {
        id: 'graph:backend',
        kind: 'graph',
        clusterId,
        title: 'Understand Anything Backend',
        subtitle: stats?.understandGraph?.graphExists ? 'Graph file ready' : 'Graph sync pending',
        description: stats?.understandGraph?.graphPath
          ? `Canonical graph path: ${stats.understandGraph.graphPath}`
          : 'The knowledge graph will be written when Nexus syncs the document store.',
        truthLayer: 'Canonical',
        metric: String(stats?.retrievalBackend || 'understand-anything'),
      },
      {
        id: 'graph:nodes',
        kind: 'graph',
        clusterId,
        title: 'Graph Nodes',
        subtitle: `${Number(graphStats.nodes || 0)} nodes`,
        description: 'Documents, Research Department sources, sessions, topics, and artifacts are projected into one graph.',
        truthLayer: 'Derived',
        metric: 'Nodes',
      },
      {
        id: 'graph:edges',
        kind: 'graph',
        clusterId,
        title: 'Graph Edges',
        subtitle: `${Number(graphStats.edges || 0)} edges`,
        description: 'Edges preserve lineage from session to document to topic, source, and artifact.',
        truthLayer: 'Derived',
        metric: 'Relationships',
      },
      {
        id: 'graph:layers',
        kind: 'graph',
        clusterId,
        title: 'Graph Layers',
        subtitle: `${Number(graphStats.layers || 0)} layers`,
        description: 'Understand Anything layers replace the old visual-only knowledge base clustering.',
        truthLayer: 'Derived',
        metric: 'Layers',
      },
    ];
  }

  if (clusterId === 'research') {
    return [
      {
        id: 'research:sources',
        kind: 'graph',
        clusterId,
        title: 'Research Sources',
        subtitle: `${Number(stats?.researchSources || 0)} synced into graph input`,
        description: 'YouTube transcripts, web results, PDFs, and captured sources from Research Department are converted into Understand Anything graph records.',
        truthLayer: 'Canonical',
        metric: 'Research',
      },
      {
        id: 'research:findings',
        kind: 'graph',
        clusterId,
        title: 'Classified Findings',
        subtitle: `${Number(stats?.researchFindings || 0)} evidence items`,
        description: 'Facts, claims, risks, methods, opinions, and open questions extracted from research sources become searchable graph context.',
        truthLayer: 'Derived',
        metric: 'Evidence',
      },
      {
        id: 'research:transcripts',
        kind: 'graph',
        clusterId,
        title: 'Transcript Lineage',
        subtitle: 'Source files stay reopenable',
        description: 'Research transcript markdown files are attached as graph artifact paths so the source material can be reopened from Nexus.',
        truthLayer: 'Canonical',
        metric: 'Artifacts',
      },
      {
        id: 'research:brief',
        kind: 'graph',
        clusterId,
        title: 'Briefing Layer',
        subtitle: 'Create Brief turns findings into synthesis',
        description: 'Once findings exist, the brief generator uses those same classified rows to produce a durable research summary.',
        truthLayer: 'Derived',
        metric: 'Synthesis',
      },
    ];
  }

  if (clusterId === 'people') {
    return people.slice(0, 14).map((person) => ({
      id: `person:${String(person.id)}`,
      kind: 'person',
      clusterId,
      title: String(person.full_name || person.name || 'Person'),
      subtitle: formatEntitySubtitle(person),
      description: truncateText(
        String(person.notes || person.summary || person.company || 'Open the CRM record to inspect linked knowledge and relationship context.'),
        180,
      ),
      truthLayer: 'Canonical',
      metric: String(person.company || person.title || 'CRM record'),
      actionLabel: 'Open Record',
      entityType: 'person',
      entityId: String(person.id),
    }));
  }

  if (clusterId === 'businesses') {
    return businesses.slice(0, 14).map((business) => ({
      id: `business:${String(business.id)}`,
      kind: 'business',
      clusterId,
      title: String(business.name || 'Business'),
      subtitle: formatEntitySubtitle(business),
      description: truncateText(
        String(business.summary || business.description || business.industry || 'Open the CRM record to inspect linked documents and relationship context.'),
        180,
      ),
      truthLayer: 'Canonical',
      metric: String(business.industry || business.location || 'CRM record'),
      actionLabel: 'Open Record',
      entityType: 'business',
      entityId: String(business.id),
    }));
  }

  if (clusterId === 'memory') {
    const workingMemory = stats?.workingMemory || DEFAULT_KNOWLEDGE_STATS.workingMemory;
    const projectLinked = Boolean(stats?.health?.currentSessionProjectLinked);
    return [
      {
        id: 'memory:recent-turns',
        kind: 'memory',
        clusterId,
        title: 'Recent Turns',
        subtitle: `${workingMemory.recentTurns} loaded into live context`,
        description: 'The most recent user and assistant turns are the first layer of active working memory.',
        truthLayer: 'Live',
        metric: 'Live Context',
      },
      {
        id: 'memory:tool-outcomes',
        kind: 'memory',
        clusterId,
        title: 'Tool Outcomes',
        subtitle: `${workingMemory.recentToolOutcomes} recent outputs`,
        description: 'Recent tool results should stay attached to the live turn so follow-ups like "show it" can open the real artifact instead of guessing.',
        truthLayer: 'Live',
        metric: 'Execution',
      },
      {
        id: 'memory:open-artifacts',
        kind: 'memory',
        clusterId,
        title: 'Recent Knowledge',
        subtitle: `${workingMemory.recentDocuments} docs closest to the thread`,
        description: 'Recent ingested documents and artifacts should stay near the active turn before they rely on deeper retrieval.',
        truthLayer: 'Live',
        metric: 'Knowledge',
      },
      {
        id: 'memory:tasks',
        kind: 'memory',
        clusterId,
        title: 'Task Cues',
        subtitle: `${workingMemory.activeTasks} active queue signals`,
        description: 'Rolling todo state and execution cues belong in live context when Nexus is still acting on them.',
        truthLayer: 'Live',
        metric: 'Tasks',
      },
      {
        id: 'memory:reflections',
        kind: 'memory',
        clusterId,
        title: 'Reflective Signals',
        subtitle: `${workingMemory.reflectiveSignals} recent diary cues`,
        description: 'Recent wonders and reflections can shape the next move, but they are still part of live context, not durable fact storage.',
        truthLayer: 'Live',
        metric: 'Diary',
      },
      {
        id: 'memory:project-thread',
        kind: 'memory',
        clusterId,
        title: 'Project Thread',
        subtitle: projectLinked ? 'Linked to project memory' : 'No project thread yet',
        description: 'Working memory gets stronger when the session is anchored to a project instead of floating as an isolated transcript.',
        truthLayer: 'Live',
        metric: 'Scope',
      },
    ];
  }

  if (clusterId === 'deep-memory') {
    return [
      {
        id: 'deep-memory:tier1',
        kind: 'memory',
        clusterId,
        title: 'Stored Tier-1 Facts',
        subtitle: `${Number(stats?.tier1 || 0)} persisted rows`,
        description: 'These are saved short-horizon facts in the database. They are durable, but they are not the same thing as live working memory.',
        truthLayer: 'Canonical',
        metric: 'Persisted',
      },
      {
        id: 'deep-memory:tier2',
        kind: 'memory',
        clusterId,
        title: 'Compressed Summaries',
        subtitle: `${Number(stats?.tier2 || 0)} tier-2 rows`,
        description: 'Tier-2 memory is where shorter context should be compressed into reusable summaries.',
        truthLayer: 'Canonical',
        metric: 'Compressed',
      },
      {
        id: 'deep-memory:tier3',
        kind: 'memory',
        clusterId,
        title: 'Long-term Memory',
        subtitle: `${Number(stats?.tier3 || 0)} tier-3 rows`,
        description: 'Tier-3 memory is reserved for durable context that should survive far beyond the current session.',
        truthLayer: 'Canonical',
        metric: 'Durable',
      },
      {
        id: 'deep-memory:total',
        kind: 'memory',
        clusterId,
        title: 'Total Persisted Memory',
        subtitle: `${getStoredMemoryTotal(stats)} stored rows`,
        description: 'This is the database-backed memory footprint, separate from the live context window used to answer the next turn.',
        truthLayer: 'Canonical',
        metric: 'Database',
      },
      {
        id: 'deep-memory:integrity',
        kind: 'memory',
        clusterId,
        title: 'Lineage Pressure',
        subtitle: `${Number(stats?.health?.workspaceDocumentsMissingArtifactRows || 0)} docs lack artifact rows`,
        description: 'When storage lineage is weak, persisted memory becomes harder to inspect and trust during drill-down.',
        truthLayer: 'Derived',
        metric: 'Health',
      },
      {
        id: 'deep-memory:retrieval',
        kind: 'memory',
        clusterId,
        title: 'Retrieval Pressure',
        subtitle: `${Number(stats?.health?.workspaceDocumentsMissingChunks || 0)} docs and ${Number(stats?.health?.workspaceChunksMissingEmbeddings || 0)} chunks need retrieval repair`,
        description: 'Persisted knowledge is only useful if it can be pulled back into context reliably.',
        truthLayer: 'Derived',
        metric: 'Retrieval',
      },
    ];
  }

  return documents.slice(0, 18).map((document) => ({
    id: `document:${String(document.id)}`,
    kind: 'document',
    clusterId: 'documents',
    title: String(document.title || 'Knowledge document'),
    subtitle: String(document.source || 'Knowledge Base'),
    description: truncateText(
      String(document.preview || document.content || 'Open this document in the workstation or promote it into AI Focus.'),
      190,
    ),
    truthLayer: 'Canonical',
    metric: String(document.source || 'Document'),
    actionLabel: 'Open in Workstation',
    documentId: String(document.id),
  }));
}

function KnowledgeGraph(props: {
  stats: KnowledgeStatsPayload;
  entityCounts: { people: number; businesses: number; links: number };
  documents: any[];
  people: any[];
  businesses: any[];
  selectedCluster: string;
  onSelectCluster: (clusterId: string) => void;
  loadingId?: string | null;
  graphBusy?: string;
  onOpenDocument: (documentId: string, target: 'focus' | 'workstation') => void;
  onOpenEntity: (entityType: 'person' | 'business', entityId: string) => void;
  onSyncGraph: () => void;
  onCreateGraphDiagram: () => void;
  onOpenGraphDashboard: () => void;
}): React.ReactElement {
  const clusterNodes = useMemo(() => [
    { id: 'graph', label: getKnowledgeClusterLabel('graph'), count: Number(props.stats?.understandGraph?.stats?.nodes || 0), x: 50, y: 13, truthLayer: 'Canonical' as const },
    { id: 'documents', label: getKnowledgeClusterLabel('documents'), count: Number(props.stats?.documents || 0), x: 84, y: 25, truthLayer: 'Canonical' as const },
    { id: 'research', label: getKnowledgeClusterLabel('research'), count: Number(props.stats?.researchSources || 0), x: 50, y: 90, truthLayer: 'Canonical' as const },
    { id: 'memory', label: getKnowledgeClusterLabel('memory'), count: getWorkingMemoryTotal(props.stats), x: 16, y: 44, truthLayer: 'Live' as const },
    { id: 'deep-memory', label: getKnowledgeClusterLabel('deep-memory'), count: getStoredMemoryTotal(props.stats), x: 22, y: 77, truthLayer: 'Canonical' as const },
    { id: 'people', label: 'People', count: Number(props.entityCounts.people || 0), x: 80, y: 43 },
    { id: 'businesses', label: 'Businesses', count: Number(props.entityCounts.businesses || 0), x: 72, y: 76 },
  ], [props.entityCounts.businesses, props.entityCounts.people, props.stats]);

  const clusterSelectionMap = useMemo(() => new Map(
    clusterNodes.map((node) => [
      `cluster:${node.id}`,
      {
        id: `cluster:${node.id}`,
        kind: 'cluster' as const,
        clusterId: node.id,
        title: node.label,
        subtitle: `${node.count} linked nodes`,
        description: describeKnowledgeCluster(node.id),
        truthLayer: node.truthLayer || 'Canonical',
        metric: `${node.count}`,
      } satisfies KnowledgeGraphSelection,
    ]),
  ), [clusterNodes]);

  const clusterItems = useMemo(
    () => buildKnowledgeClusterItems(
      props.selectedCluster,
      props.documents,
      props.people,
      props.businesses,
      props.stats,
    ),
    [props.businesses, props.documents, props.people, props.selectedCluster, props.stats],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>(`cluster:${props.selectedCluster}`);

  useEffect(() => {
    setSelectedNodeId((previous) => {
      if (!previous.startsWith(`cluster:${props.selectedCluster}`) && !clusterItems.some((item) => item.id === previous)) {
        return `cluster:${props.selectedCluster}`;
      }
      return previous;
    });
  }, [clusterItems, props.selectedCluster]);

  const orbitDots = useMemo(
    () => Array.from({ length: 164 }, (_, index) => {
      const angle = (index / 164) * Math.PI * 2;
      const radiusX = 40;
      const radiusY = 34;
      return {
        id: `orbit-${index}`,
        left: 50 + Math.cos(angle) * radiusX,
        top: 49 + Math.sin(angle) * radiusY,
      };
    }),
    [],
  );

  const cloudDots = useMemo(() => {
    const count = Math.max(48, Math.min(160, clusterItems.length * 10));
    return Array.from({ length: count }, (_, index) => {
      const angle = index * 2.399963229728653;
      const radius = Math.sqrt((index + 0.5) / count) * 18;
      return {
        id: `cloud-${index}`,
        left: 50 + Math.cos(angle) * radius * 1.28,
        top: 55 + Math.sin(angle) * radius,
      };
    });
  }, [clusterItems.length]);

  const innerSelections = useMemo(() => clusterItems.map((item, index) => {
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt((index + 0.5) / Math.max(clusterItems.length, 1)) * 15.2;
    return {
      ...item,
      left: 50 + Math.cos(angle) * radius * 1.18,
      top: 55 + Math.sin(angle) * radius,
    };
  }), [clusterItems]);

  const allSelections = useMemo(() => {
    const nextMap = new Map<string, KnowledgeGraphSelection>();
    clusterSelectionMap.forEach((value, key) => nextMap.set(key, value));
    for (const item of clusterItems) {
      nextMap.set(item.id, item);
    }
    return nextMap;
  }, [clusterItems, clusterSelectionMap]);

  const selectedSelection = allSelections.get(selectedNodeId) || clusterSelectionMap.get(`cluster:${props.selectedCluster}`) || null;
  const selectedClusterLabel = clusterNodes.find((node) => node.id === props.selectedCluster)?.label || getKnowledgeClusterLabel(props.selectedCluster);
  const selectedClusterListTitle = props.selectedCluster === 'graph'
    ? 'Graph Nodes'
    : props.selectedCluster === 'research'
    ? 'Research Graph'
    : props.selectedCluster === 'people'
    ? 'Visible People'
    : props.selectedCluster === 'businesses'
      ? 'Visible Businesses'
      : props.selectedCluster === 'documents'
        ? 'Recent Documents'
        : props.selectedCluster === 'memory'
          ? 'Live Context'
          : 'Stored Memory';
  const canOpenDocument = selectedSelection?.kind === 'document' && Boolean(selectedSelection.documentId);
  const canOpenEntity = (selectedSelection?.kind === 'person' || selectedSelection?.kind === 'business')
    && Boolean(selectedSelection.entityId && selectedSelection.entityType);
  const inspectorLoading = Boolean(canOpenDocument && selectedSelection?.documentId && props.loadingId === selectedSelection.documentId);
  const healthRows = useMemo(() => buildKnowledgeHealthRows(props.stats), [props.stats]);

  const graphStats = props.stats?.understandGraph?.stats || {};
  const graphReady = Boolean(props.stats?.understandGraph?.graphExists);
  const graphBusy = String(props.graphBusy || '');

  return (
    <div className="next-knowledge-workspace">
      <section className="next-flow-panel next-flow-panel--knowledge">
        <div className="next-flow-panel-head">
          <div>
            <div className="next-mini-label">Knowledge Graph Flow</div>
            <strong>Research, documents, memory, and artifacts in one graph</strong>
          </div>
          {graphBusy ? <InlineLoading label={graphBusy} /> : null}
        </div>
        <div className="next-flow-strip">
          <FlowStep
            index={1}
            label="Intake"
            value={`${Number(props.stats?.documents || 0)} docs · ${Number(props.stats?.researchSources || 0)} research`}
            detail="Saved material enters Nexus from files, chat, Research Department, and generated artifacts."
            state={Number(props.stats?.documents || 0) + Number(props.stats?.researchSources || 0) > 0 ? 'ready' : 'waiting'}
          />
          <FlowStep
            index={2}
            label="Sync Graph"
            value={graphReady ? `${Number(graphStats.nodes || 0)} nodes` : 'Not synced'}
            detail="The Understand Anything graph is rebuilt from the current Nexus knowledge store."
            state={graphBusy === 'Syncing graph' ? 'active' : graphReady ? 'ready' : 'waiting'}
          />
          <FlowStep
            index={3}
            label="Explore"
            value={selectedClusterLabel}
            detail="Select a cluster or point to inspect the node, source lineage, and available actions."
            state="active"
          />
          <FlowStep
            index={4}
            label="Produce"
            value="Diagram or dashboard"
            detail="Create a native diagram for AI Focus, or open the full Understand Anything dashboard."
            state={graphReady ? 'ready' : 'waiting'}
          />
        </div>
        <div className="next-flow-actions">
          <button
            type="button"
            className="next-secondary-button"
            onClick={props.onSyncGraph}
            disabled={Boolean(props.graphBusy)}
          >
            {graphBusy === 'Syncing graph' ? 'Syncing' : 'Sync Graph'}
          </button>
          <InfoBubble label="Graph Sync">
            Sync Graph pulls Research Department sources, classified findings, knowledge documents, sessions, topics, and artifacts into the Understand Anything graph.
          </InfoBubble>
          <button
            type="button"
            className="next-secondary-button"
            onClick={props.onCreateGraphDiagram}
            disabled={Boolean(props.graphBusy)}
          >
            {graphBusy === 'Creating graph diagram' ? 'Creating' : 'Create Diagram'}
          </button>
          <button
            type="button"
            className="next-secondary-button"
            onClick={props.onOpenGraphDashboard}
            disabled={Boolean(props.graphBusy)}
          >
            {graphBusy === 'Opening graph dashboard' ? 'Opening' : 'Dashboard'}
          </button>
        </div>
      </section>

      <div className="next-knowledge-layout">
      <div className="next-graph-canvas next-graph-canvas--immersive">
        <div className="next-graph-field" aria-hidden="true">
          {orbitDots.map((dot) => (
            <span
              key={dot.id}
              className="next-graph-orbit-dot"
              style={{ left: `${dot.left}%`, top: `${dot.top}%` }}
            />
          ))}
          {cloudDots.map((dot) => (
            <span
              key={dot.id}
              className="next-graph-cloud-dot"
              style={{ left: `${dot.left}%`, top: `${dot.top}%` }}
            />
          ))}
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {clusterNodes.map((node) => (
            <line key={node.id} x1="50" y1="50" x2={node.x} y2={node.y} className="next-graph-line" />
          ))}
          {innerSelections.map((item) => (
            <line key={`inner-line-${item.id}`} x1="50" y1="55" x2={item.left} y2={item.top} className="next-graph-line next-graph-line--dim" />
          ))}
        </svg>

        <div className="next-graph-hub">
          <strong>Understand Anything KB</strong>
          <span>{props.stats?.understandGraph?.graphExists ? 'Documents + research + artifacts live' : 'Graph sync pending'}</span>
        </div>

        {clusterNodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`next-graph-node next-graph-node--cluster${props.selectedCluster === node.id ? ' is-active' : ''}`}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            onClick={() => {
              props.onSelectCluster(node.id);
              setSelectedNodeId(`cluster:${node.id}`);
            }}
          >
            <strong>{node.label}</strong>
            <span>{node.count}</span>
          </button>
        ))}

        {innerSelections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`next-graph-point next-graph-point--${item.kind}${selectedNodeId === item.id ? ' is-active' : ''}`}
            style={{ left: `${item.left}%`, top: `${item.top}%` }}
            onClick={() => setSelectedNodeId(item.id)}
            aria-label={item.title}
            title={item.title}
          >
            <span className="sr-only">{item.title}</span>
          </button>
        ))}
      </div>

      <aside className="next-knowledge-sidebar next-knowledge-sidebar--floating">
        <div className="next-mini-panel">
          <div className="next-mini-label">Selected Node</div>
          <strong>{selectedSelection?.title || selectedClusterLabel}</strong>
          <p>{selectedSelection?.description || describeKnowledgeCluster(props.selectedCluster)}</p>
          <div className="next-simple-metadata">
            <span>{selectedSelection?.subtitle || `${selectedClusterLabel} cluster`}</span>
            {selectedSelection?.truthLayer ? <span>{selectedSelection.truthLayer}</span> : null}
            {selectedSelection?.metric ? <span>{selectedSelection.metric}</span> : null}
          </div>
          {canOpenDocument ? (
            <div className="next-inline-actions">
              <button
                type="button"
                className="next-secondary-button"
                onClick={() => props.onOpenDocument(String(selectedSelection.documentId), 'workstation')}
                disabled={inspectorLoading}
              >
                {inspectorLoading ? 'Opening…' : 'Open in Workstation'}
              </button>
              <button
                type="button"
                className="next-secondary-button"
                onClick={() => props.onOpenDocument(String(selectedSelection.documentId), 'focus')}
                disabled={inspectorLoading}
              >
                {inspectorLoading ? 'Sending…' : 'Send to AI Focus'}
              </button>
            </div>
          ) : null}
          {canOpenEntity ? (
            <div className="next-inline-actions">
              <button
                type="button"
                className="next-secondary-button"
                onClick={() => props.onOpenEntity(
                  selectedSelection.entityType as 'person' | 'business',
                  String(selectedSelection.entityId),
                )}
              >
                Open Record
              </button>
            </div>
          ) : null}
          <div className="next-inline-actions">
            <button
              type="button"
              className="next-secondary-button"
              onClick={props.onSyncGraph}
              disabled={Boolean(props.graphBusy)}
            >
              {props.graphBusy === 'Syncing graph' ? 'Syncing…' : 'Sync Graph'}
            </button>
            <button
              type="button"
              className="next-secondary-button"
              onClick={props.onCreateGraphDiagram}
              disabled={Boolean(props.graphBusy)}
            >
              {props.graphBusy === 'Creating graph diagram' ? 'Creating…' : 'Create Diagram'}
            </button>
            <button
              type="button"
              className="next-secondary-button"
              onClick={props.onOpenGraphDashboard}
              disabled={Boolean(props.graphBusy)}
            >
              {props.graphBusy === 'Opening graph dashboard' ? 'Opening…' : 'Dashboard'}
            </button>
          </div>
        </div>

        <div className="next-mini-panel">
          <div className="next-mini-label">{selectedClusterListTitle}</div>
          <div className="next-document-list">
            {clusterItems.length ? clusterItems.map((item) => (
              <button
                className={`next-document-row${selectedNodeId === item.id ? ' is-active' : ''}`}
                type="button"
                key={item.id}
                onClick={() => setSelectedNodeId(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
              </button>
            )) : (
              <div className="next-empty-inline">Nothing is loaded for this cluster yet.</div>
            )}
          </div>
        </div>

        <div className="next-mini-panel">
          <div className="next-mini-label">Data Health</div>
          <div className="next-knowledge-health-list">
            {healthRows.map((row) => (
              <div className="next-knowledge-health-row" key={row.label}>
                <div className="next-simple-metadata">
                  <strong>{row.label}</strong>
                  <span>{row.value}</span>
                </div>
                <p>{row.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
    </div>
  );
}

function EntityCrmOverlay(props: {
  data: EntityRoomPayload;
  onOpenEntity: (entityType: 'person' | 'business', entityId: string) => void;
  onSearch: (query: string) => void;
  onOpenKnowledgeDocument: (documentId: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onAskEntity: (
    entityType: 'person' | 'business',
    entityId: string,
    question: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<any>;
}): React.ReactElement {
  const counts = props.data?.counts || { people: 0, businesses: 0, links: 0 };
  const people = Array.isArray(props.data?.people) ? props.data.people : [];
  const businesses = Array.isArray(props.data?.businesses) ? props.data.businesses : [];
  const searchResults = Array.isArray(props.data?.searchResults) ? props.data.searchResults : [];
  const relationships = Array.isArray(props.data?.relationships) ? props.data.relationships : [];
  const knowledge = props.data?.knowledge && typeof props.data.knowledge === 'object' ? props.data.knowledge : {};
  const sessionContext = props.data?.sessionContext && typeof props.data.sessionContext === 'object' ? props.data.sessionContext : null;
  const activeEntityType = normalizePanelEntityType(props.data?.activeEntityType);
  const activeEntity = props.data?.activeEntity && typeof props.data.activeEntity === 'object' ? props.data.activeEntity : null;
  const activeEntityId = String(activeEntity?.id || '').trim();
  const activeEntityName = activeEntityType && activeEntity ? getEntityDisplayName(activeEntityType, activeEntity) : '';
  const aliases = Array.isArray(knowledge?.aliases) ? knowledge.aliases : [];
  const documents = Array.isArray(knowledge?.documents) ? knowledge.documents : [];
  const artifacts = Array.isArray(knowledge?.artifacts) ? knowledge.artifacts : [];
  const projects = Array.isArray(knowledge?.projects) ? knowledge.projects : [];
  const briefings = Array.isArray(knowledge?.briefings) ? knowledge.briefings : [];
  const facts = Array.isArray(knowledge?.facts) ? knowledge.facts : [];
  const latestSwot = knowledge?.latestSwot && typeof knowledge.latestSwot === 'object' ? knowledge.latestSwot : null;
  const sessionPeople = Array.isArray(sessionContext?.people) ? sessionContext.people : [];
  const sessionBusinesses = Array.isArray(sessionContext?.businesses) ? sessionContext.businesses : [];
  const sessionRelationships = Array.isArray(sessionContext?.relationships) ? sessionContext.relationships : [];
  const [entityQuestion, setEntityQuestion] = useState('');
  const [entityChatHistory, setEntityChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [entityChatLoading, setEntityChatLoading] = useState(false);
  const [entityChatError, setEntityChatError] = useState('');
  const [entitySearchQuery, setEntitySearchQuery] = useState(String(props.data?.query || '').trim());
  const [sessionEntityFilter, setSessionEntityFilter] = useState<'all' | 'people' | 'businesses' | 'graph'>('all');
  const [directoryFilter, setDirectoryFilter] = useState<'all' | 'people' | 'businesses'>('all');
  const [dossierFilter, setDossierFilter] = useState<'all' | 'documents' | 'artifacts' | 'briefings' | 'projects' | 'relationships'>('all');

  useEffect(() => {
    setEntityQuestion('');
    setEntityChatHistory([]);
    setEntityChatError('');
    setDossierFilter('all');
    setDirectoryFilter(activeEntityType === 'business' ? 'businesses' : activeEntityType === 'person' ? 'people' : 'all');
  }, [activeEntityId, activeEntityType]);

  useEffect(() => {
    setEntitySearchQuery(String(props.data?.query || '').trim());
  }, [props.data?.query]);

  useEffect(() => {
    setSessionEntityFilter('all');
  }, [sessionContext?.summary]);

  const handleAskEntity = async () => {
    if (!activeEntityType || !activeEntityId || !entityQuestion.trim()) {
      return;
    }

    const question = entityQuestion.trim();
    const priorHistory = entityChatHistory;
    const nextHistory = [...priorHistory, { role: 'user' as const, content: question }];
    setEntityQuestion('');
    setEntityChatError('');
    setEntityChatLoading(true);
    setEntityChatHistory(nextHistory);
    try {
      const response = await props.onAskEntity(activeEntityType, activeEntityId, question, priorHistory);
      const answer = typeof response === 'string'
        ? response
        : String(response?.answer || response?.message || safeJsonPreview(response) || 'No entity response returned.');
      setEntityChatHistory([...nextHistory, { role: 'assistant' as const, content: answer }]);
    } catch (error) {
      setEntityChatError(error instanceof Error ? error.message : 'Entity Q&A failed.');
      setEntityChatHistory(nextHistory);
    } finally {
      setEntityChatLoading(false);
    }
  };

  const sessionEntityRows = useMemo(() => {
    if (sessionEntityFilter === 'people') {
      return sessionPeople.map((person: any) => ({
        id: `session-person:${String(person.id || person.name)}`,
        title: String(person.full_name || person.name || 'Person'),
        subtitle: formatEntitySubtitle(person),
        onClick: person?.id ? () => props.onOpenEntity('person', String(person.id)) : undefined,
        disabled: !person?.id,
      }));
    }

    if (sessionEntityFilter === 'businesses') {
      return sessionBusinesses.map((business: any) => ({
        id: `session-business:${String(business.id || business.name)}`,
        title: String(business.name || 'Business'),
        subtitle: formatEntitySubtitle(business),
        onClick: business?.id ? () => props.onOpenEntity('business', String(business.id)) : undefined,
        disabled: !business?.id,
      }));
    }

    if (sessionEntityFilter === 'graph') {
      return sessionRelationships.map((relationship: any, index: number) => ({
        id: `session-relationship:${String(relationship.id || index)}`,
        title: `${String(relationship.personName || 'Person')} → ${String(relationship.businessName || 'Business')}`,
        subtitle: [
          relationship?.role ? String(relationship.role) : '',
          relationship?.isFounder ? 'founder' : '',
          relationship?.inWorkingSet ? 'working set' : '',
        ].filter(Boolean).join(' · ') || 'Relationship link',
        onClick: relationship?.personId ? () => props.onOpenEntity('person', String(relationship.personId)) : undefined,
        disabled: !relationship?.personId,
      }));
    }

    return [
      ...sessionPeople.map((person: any) => ({
        id: `session-person:${String(person.id || person.name)}`,
        title: String(person.full_name || person.name || 'Person'),
        subtitle: formatEntitySubtitle(person),
        onClick: person?.id ? () => props.onOpenEntity('person', String(person.id)) : undefined,
        disabled: !person?.id,
      })),
      ...sessionBusinesses.map((business: any) => ({
        id: `session-business:${String(business.id || business.name)}`,
        title: String(business.name || 'Business'),
        subtitle: formatEntitySubtitle(business),
        onClick: business?.id ? () => props.onOpenEntity('business', String(business.id)) : undefined,
        disabled: !business?.id,
      })),
    ];
  }, [props, sessionBusinesses, sessionEntityFilter, sessionPeople, sessionRelationships]);

  const showPeopleDirectory = directoryFilter !== 'businesses';
  const showBusinessDirectory = directoryFilter !== 'people';
  const showRelationshipsPanel = dossierFilter === 'all' || dossierFilter === 'relationships';
  const showKnowledgePanel = dossierFilter === 'all' || dossierFilter === 'documents';
  const showArtifactsPanel = dossierFilter === 'all' || dossierFilter === 'artifacts' || dossierFilter === 'briefings';
  const showProjectsPanel = dossierFilter === 'all' || dossierFilter === 'projects';

  return (
    <div className="next-entity-room">
      <div className="next-crm-metrics next-room-metrics">
        <button
          type="button"
          className={`next-score-card next-score-card--button${directoryFilter === 'people' ? ' is-active' : ''}`}
          onClick={() => setDirectoryFilter((value) => (value === 'people' ? 'all' : 'people'))}
        >
          <span>People Indexed</span>
          <strong>{Number(counts.people || 0)}</strong>
        </button>
        <button
          type="button"
          className={`next-score-card next-score-card--button${directoryFilter === 'businesses' ? ' is-active' : ''}`}
          onClick={() => setDirectoryFilter((value) => (value === 'businesses' ? 'all' : 'businesses'))}
        >
          <span>Businesses Indexed</span>
          <strong>{Number(counts.businesses || 0)}</strong>
        </button>
        <button
          type="button"
          className={`next-score-card next-score-card--button${dossierFilter === 'relationships' ? ' is-active' : ''}`}
          onClick={() => setDossierFilter((value) => (value === 'relationships' ? 'all' : 'relationships'))}
        >
          <span>Graph Links</span>
          <strong>{Number(counts.links || 0)}</strong>
        </button>
      </div>

      <div className="next-entity-room-grid">
        <aside className="next-entity-room-column next-entity-room-directory">
          <section className="next-mini-panel">
            <div className="next-mini-label">Search CRM</div>
            <div className="next-inline-form">
              <input
                value={entitySearchQuery}
                onChange={(event) => setEntitySearchQuery(event.target.value)}
                placeholder="Search people or businesses"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    props.onSearch(entitySearchQuery.trim());
                  }
                }}
              />
              <button
                type="button"
                className="next-secondary-button"
                onClick={() => props.onSearch(entitySearchQuery.trim())}
              >
                Search
              </button>
            </div>
          </section>

          {String(props.data?.query || '').trim() ? (
            <section className="next-mini-panel">
              <div className="next-mini-label">Search Results</div>
              <p className="next-panel-copy">
                CRM opened around <strong>{String(props.data?.query || '').trim()}</strong>.
              </p>
              <div className="next-document-list">
                {searchResults.length ? searchResults.map((result) => (
                  <button
                    key={`${result.type}:${result.id}`}
                    type="button"
                    className={`next-document-row${result.id === activeEntityId ? ' is-active' : ''}`}
                    onClick={() => props.onOpenEntity(result.type === 'business' ? 'business' : 'person', String(result.id))}
                  >
                    <strong>{result.name || 'Entity result'}</strong>
                    <span>{result.description || `${result.type} result`}</span>
                  </button>
                )) : (
                  <div className="next-empty-inline">No matching CRM entities were found for this search yet.</div>
                )}
              </div>
            </section>
          ) : null}

          {showPeopleDirectory ? (
            <section className="next-mini-panel">
              <div className="next-mini-label">People Directory</div>
              <div className="next-document-list">
                {people.length ? people.map((person: any) => (
                  <button
                    key={person.id}
                    type="button"
                    className={`next-document-row${String(person.id) === activeEntityId ? ' is-active' : ''}`}
                    onClick={() => props.onOpenEntity('person', String(person.id))}
                  >
                    <strong>{person.full_name || person.name || 'Person'}</strong>
                    <span>{formatEntitySubtitle(person)}</span>
                  </button>
                )) : (
                  <div className="next-empty-inline">No people have been extracted into the CRM yet.</div>
                )}
              </div>
            </section>
          ) : null}

          {showBusinessDirectory ? (
            <section className="next-mini-panel">
              <div className="next-mini-label">Business Directory</div>
              <div className="next-document-list">
                {businesses.length ? businesses.map((business: any) => (
                  <button
                    key={business.id}
                    type="button"
                    className={`next-document-row${String(business.id) === activeEntityId ? ' is-active' : ''}`}
                    onClick={() => props.onOpenEntity('business', String(business.id))}
                  >
                    <strong>{business.name || 'Business'}</strong>
                    <span>{formatEntitySubtitle(business)}</span>
                  </button>
                )) : (
                  <div className="next-empty-inline">No business records are available yet.</div>
                )}
              </div>
            </section>
          ) : null}
        </aside>

        <section className="next-entity-room-column next-entity-room-dossier">
          <div className="next-mini-panel next-entity-hero">
            <div className="next-mini-label">{activeEntityType ? `${activeEntityType} dossier` : 'Entity dossier'}</div>
            {activeEntityType && activeEntity ? (
              <>
                <div className="next-entity-hero-head">
                  <div>
                    <h3>{activeEntityName}</h3>
                    <p>{describeEntity(activeEntityType, activeEntity)}</p>
                  </div>
                  <div className="next-status-chip-row">
                    {aliases.length ? <span className="next-marketing-chip">{aliases.length} aliases</span> : null}
                    {relationships.length ? (
                      <button
                        type="button"
                        className={`next-marketing-chip next-chip-button${dossierFilter === 'relationships' ? ' is-active' : ''}`}
                        onClick={() => setDossierFilter((value) => (value === 'relationships' ? 'all' : 'relationships'))}
                      >
                        {relationships.length} relationships
                      </button>
                    ) : null}
                    {documents.length ? (
                      <button
                        type="button"
                        className={`next-marketing-chip next-chip-button${dossierFilter === 'documents' ? ' is-active' : ''}`}
                        onClick={() => setDossierFilter((value) => (value === 'documents' ? 'all' : 'documents'))}
                      >
                        {documents.length} docs
                      </button>
                    ) : null}
                    {artifacts.length ? (
                      <button
                        type="button"
                        className={`next-marketing-chip next-chip-button${dossierFilter === 'artifacts' ? ' is-active' : ''}`}
                        onClick={() => setDossierFilter((value) => (value === 'artifacts' ? 'all' : 'artifacts'))}
                      >
                        {artifacts.length} artifacts
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="next-entity-summary-grid">
                  <button
                    type="button"
                    className={`next-score-card next-score-card--button${dossierFilter === 'documents' ? ' is-active' : ''}`}
                    onClick={() => setDossierFilter((value) => (value === 'documents' ? 'all' : 'documents'))}
                  >
                    <span>Notes and Context</span>
                    <strong>{formatCompactNumber(documents.length + artifacts.length)}</strong>
                  </button>
                  <button
                    type="button"
                    className={`next-score-card next-score-card--button${dossierFilter === 'projects' ? ' is-active' : ''}`}
                    onClick={() => setDossierFilter((value) => (value === 'projects' ? 'all' : 'projects'))}
                  >
                    <span>Projects</span>
                    <strong>{formatCompactNumber(projects.length)}</strong>
                  </button>
                  <button
                    type="button"
                    className={`next-score-card next-score-card--button${dossierFilter === 'briefings' ? ' is-active' : ''}`}
                    onClick={() => setDossierFilter((value) => (value === 'briefings' ? 'all' : 'briefings'))}
                  >
                    <span>Briefings</span>
                    <strong>{formatCompactNumber(briefings.length)}</strong>
                  </button>
                </div>

                {aliases.length ? (
                  <div className="next-entity-chip-cloud">
                    {aliases.slice(0, 8).map((alias: string) => (
                      <span key={alias} className="next-entity-chip">{alias}</span>
                    ))}
                  </div>
                ) : null}

                {facts.length ? (
                  <div className="next-entity-fact-list">
                    {facts.slice(0, 6).map((fact: any, index: number) => (
                      <article key={`${activeEntityId}-fact-${index}`} className="next-entity-fact-card">
                        <strong>{String(fact?.label || fact?.title || `Fact ${index + 1}`)}</strong>
                        <p>{String(fact?.value || fact?.detail || fact?.text || '')}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="next-empty-inline">This dossier does not have structured facts yet, but linked notes and files can still appear below.</div>
                )}
              </>
            ) : (
              <div className="next-empty-state next-empty-state--focus">
                <strong>No entity selected</strong>
                <span>Select a person or business to turn this room into a live dossier with notes, relationships, and contextual memory.</span>
              </div>
            )}
          </div>

          {activeEntityType && activeEntity ? (
            <>
              {showRelationshipsPanel ? (
                <div className="next-mini-panel">
                  <div className="next-mini-label">Linked Relationships</div>
                  <div className="next-document-list">
                    {relationships.length ? relationships.map((relationship: any, index: number) => {
                      const relatedType = activeEntityType === 'person' ? 'business' : 'person';
                      const relatedId = String(relationship?.id || '').trim();
                      return (
                        <button
                          type="button"
                          key={`${relatedType}:${relatedId || index}`}
                          className="next-document-row"
                          onClick={() => relatedId ? props.onOpenEntity(relatedType, relatedId) : undefined}
                          disabled={!relatedId}
                        >
                          <strong>{getEntityDisplayName(relatedType, relationship)}</strong>
                          <span>{describeRelationship(activeEntityType, relationship)}</span>
                        </button>
                      );
                    }) : (
                      <div className="next-empty-inline">No linked relationships have been recorded for this entity yet.</div>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="next-entity-lane-grid">
                {showKnowledgePanel ? (
                  <section className="next-mini-panel">
                    <div className="next-mini-label">Knowledge Notes</div>
                    <div className="next-document-list">
                      {documents.length ? documents.map((document: any) => (
                        <button
                          type="button"
                          key={String(document.id)}
                          className="next-document-row"
                          onClick={() => props.onOpenKnowledgeDocument(String(document.id), 'workstation')}
                        >
                          <strong>{String(document.title || 'Knowledge document')}</strong>
                          <span>{String(document.source || 'Knowledge Base')}</span>
                          {document.preview ? <span className="next-document-row-preview">{String(document.preview)}</span> : null}
                        </button>
                      )) : (
                        <div className="next-empty-inline">No linked knowledge documents yet.</div>
                      )}
                    </div>
                  </section>
                ) : null}

                {showArtifactsPanel ? (
                  <section className="next-mini-panel">
                    <div className="next-mini-label">
                      {dossierFilter === 'briefings' ? 'Briefings' : 'Artifacts and Briefings'}
                    </div>
                    <div className="next-document-list">
                      {dossierFilter !== 'briefings' ? artifacts.map((artifact: any) => (
                        <button
                          type="button"
                          key={String(artifact.path || artifact.id)}
                          className="next-document-row"
                          onClick={() => artifact?.path ? props.onOpenArtifact(String(artifact.path), 'workstation') : undefined}
                          disabled={!artifact?.path}
                        >
                          <strong>{String(artifact.title || 'Artifact')}</strong>
                          <span>{String(artifact.kind || artifact.sourceType || 'artifact')}</span>
                          {artifact.path ? <span className="next-document-row-preview">{String(artifact.path)}</span> : null}
                        </button>
                      )) : null}
                      {briefings.map((briefing: any) => (
                        <button
                          type="button"
                          key={String(briefing.id)}
                          className="next-document-row"
                          onClick={() => {
                            const targetPath = String(briefing.pdfPath || briefing.docxPath || '').trim();
                            if (targetPath) {
                              props.onOpenArtifact(targetPath, 'workstation');
                            }
                          }}
                          disabled={!String(briefing.pdfPath || briefing.docxPath || '').trim()}
                        >
                          <strong>{String(briefing.title || 'Entity briefing')}</strong>
                          <span>{formatDateLabel(briefing.createdAt)}</span>
                          <span className="next-document-row-preview">{String(briefing.pdfPath || briefing.docxPath || 'No saved briefing file')}</span>
                        </button>
                      ))}
                      {!artifacts.length && !briefings.length ? (
                        <div className="next-empty-inline">No saved artifacts or briefings are linked to this entity yet.</div>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </section>

        <aside className="next-entity-room-column next-entity-room-context">
          <section className="next-mini-panel">
            <div className="next-mini-label">Session Presence</div>
            <p className="next-panel-copy">
              {String(sessionContext?.summary || 'Entity CRM can project the people and businesses active in this session as a visual impression layer.')}
            </p>
            <div className="next-status-chip-row">
              <button
                type="button"
                className={`next-marketing-chip next-chip-button${sessionEntityFilter === 'people' ? ' is-active' : ''}`}
                onClick={() => setSessionEntityFilter('people')}
              >
                {formatCompactNumber(sessionPeople.length)} people
              </button>
              <button
                type="button"
                className={`next-marketing-chip next-chip-button${sessionEntityFilter === 'businesses' ? ' is-active' : ''}`}
                onClick={() => setSessionEntityFilter('businesses')}
              >
                {formatCompactNumber(sessionBusinesses.length)} businesses
              </button>
              <button
                type="button"
                className={`next-marketing-chip next-chip-button${sessionEntityFilter === 'graph' ? ' is-active' : ''}`}
                onClick={() => setSessionEntityFilter('graph')}
              >
                {sessionContext?.mode ? String(sessionContext.mode) : 'graph'}
              </button>
              <button
                type="button"
                className={`next-marketing-chip next-chip-button${sessionEntityFilter === 'all' ? ' is-active' : ''}`}
                onClick={() => setSessionEntityFilter('all')}
              >
                all
              </button>
            </div>
          </section>

          <section className="next-mini-panel">
            <div className="next-mini-label">
              {sessionEntityFilter === 'people'
                ? 'Session People'
                : sessionEntityFilter === 'businesses'
                  ? 'Session Businesses'
                  : sessionEntityFilter === 'graph'
                    ? 'Session Relationships'
                    : 'Session Entities'}
            </div>
            <div className="next-document-list">
              {sessionEntityRows.length ? sessionEntityRows.slice(0, 12).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="next-document-row"
                  onClick={item.onClick}
                  disabled={item.disabled}
                >
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </button>
              )) : (
                <div className="next-empty-inline">
                  {sessionEntityFilter === 'graph'
                    ? 'No session relationships are active yet.'
                    : 'No session entities are active in the current context yet.'}
                </div>
              )}
            </div>
          </section>

          {showProjectsPanel ? (
            <section className="next-mini-panel">
              <div className="next-mini-label">Project Links</div>
              <div className="next-entity-project-list">
                {projects.length ? projects.map((project: any) => (
                  <article className="next-entity-project-card" key={String(project.id || project.name)}>
                    <strong>{String(project.name || 'Project')}</strong>
                    <p>
                      {[
                        project?.status,
                        project?.documentCount ? `${project.documentCount} docs` : '',
                        project?.artifactCount ? `${project.artifactCount} artifacts` : '',
                        project?.sourceCount ? `${project.sourceCount} sources` : '',
                      ].filter(Boolean).join(' · ') || 'Linked through entity graph'}
                    </p>
                  </article>
                )) : (
                  <div className="next-empty-inline">No linked projects are available for this entity yet.</div>
                )}
              </div>
            </section>
          ) : null}

          <section className="next-mini-panel">
            <div className="next-mini-label">Ask The Dossier</div>
            {activeEntityType && activeEntityId ? (
              <>
                <div className="next-entity-chat-thread">
                  {entityChatHistory.length ? entityChatHistory.map((item, index) => (
                    <article className={`next-entity-chat-message${item.role === 'assistant' ? ' is-assistant' : ''}`} key={`${item.role}-${index}`}>
                      <strong>{item.role === 'assistant' ? 'Nexus' : 'You'}</strong>
                      <p>{item.content}</p>
                    </article>
                  )) : (
                    <div className="next-empty-inline">
                      Ask about this entity’s history, relationships, context, or what Nexus already knows.
                    </div>
                  )}
                </div>
                <div className="next-diary-comment-form">
                  <textarea
                    className="next-composer next-composer--compact"
                    value={entityQuestion}
                    onChange={(event) => setEntityQuestion(event.target.value)}
                    placeholder={`Ask Nexus about ${activeEntityName}…`}
                    rows={3}
                  />
                  <button
                    type="button"
                    className="next-secondary-button"
                    disabled={entityChatLoading || !entityQuestion.trim()}
                    onClick={() => void handleAskEntity()}
                  >
                    {entityChatLoading ? 'Thinking…' : 'Ask Entity'}
                  </button>
                  {entityChatError ? <div className="next-error-copy">{entityChatError}</div> : null}
                </div>
              </>
            ) : (
              <div className="next-empty-inline">Select a person or business first, then use this space like an entity-specific conversation layer.</div>
            )}
          </section>

          {latestSwot ? (
            <section className="next-mini-panel">
              <div className="next-mini-label">Latest SWOT</div>
              <div className="next-entity-swot-grid">
                {['strengths', 'weaknesses', 'opportunities', 'threats'].map((key) => (
                  <article className="next-entity-swot-card" key={key}>
                    <strong>{key}</strong>
                    <p>{Array.isArray(latestSwot?.[key]) && latestSwot[key].length ? latestSwot[key].join(', ') : 'No notes yet.'}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function DiaryWorkbenchPanel(props: {
  data: any;
  currentSessionId: string | null;
  onCreateSessionDiary: () => Promise<void>;
  onCommentDiaryEntry: (entryId: string, comment: string) => Promise<void>;
  initialSelectedReaderId?: string | null;
}): React.ReactElement {
  const entries = Array.isArray(props.data?.entries) ? props.data.entries : [];
  const narratives = Array.isArray(props.data?.narratives) ? props.data.narratives : [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
  const [busyCreatingSessionDiary, setBusyCreatingSessionDiary] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const linkedEntries = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const entry of entries) {
      const sourceId = String(entry?.sourceId || '').trim();
      const sourceType = String(entry?.sourceType || '').trim();
      if (!sourceId || (!sourceType.startsWith('diary_comment') && entry?.entryType !== 'user_comment')) {
        continue;
      }
      const bucket = grouped.get(sourceId) || [];
      bucket.push(entry);
      grouped.set(sourceId, bucket);
    }
    return grouped;
  }, [entries]);

  const rootEntries = useMemo(
    () => entries.filter((entry: any) => {
      const sourceId = String(entry?.sourceId || '').trim();
      const sourceType = String(entry?.sourceType || '').trim();
      return !sourceId || (!sourceType.startsWith('diary_comment') && entry?.entryType !== 'user_comment');
    }),
    [entries],
  );
  const readerItems = useMemo<Array<{
    id: string;
    title: string;
    subtitle: string;
    preview: string;
    content: string;
    label: string;
    metric: string;
  }>>(() => {
    const items: Array<{
      id: string;
      title: string;
      subtitle: string;
      preview: string;
      content: string;
      label: string;
      metric: string;
    }> = [];

    for (const narrative of narratives) {
      const narrativeDay = String(narrative?.narrativeDay || 'Narrative').trim() || 'Narrative';
      const narrativeText = String(narrative?.narrative || '').trim();
      items.push({
        id: `narrative:${String(narrative?.id || narrativeDay)}`,
        title: narrativeDay,
        subtitle: 'Daily narrative snapshot',
        preview: truncateText(narrativeText, 150),
        content: narrativeText || 'No narrative text is available for this snapshot yet.',
        label: 'Narrative',
        metric: 'Diary',
      });
    }

    for (const entry of rootEntries) {
      const entryId = String(entry?.id || '').trim();
      const entryType = String(entry?.entryType || 'entry').replace(/_/g, ' ');
      const entryContent = String(entry?.content || '').trim();
      items.push({
        id: `entry:${entryId || Math.random().toString(16).slice(2)}`,
        title: formatDateLabel(entry?.createdAt),
        subtitle: entryType,
        preview: truncateText(entryContent, 150),
        content: entryContent || 'No diary entry content is available for this record yet.',
        label: 'Entry',
        metric: String(entry?.activityKey || entry?.sourceType || 'Diary'),
      });

      for (const attached of linkedEntries.get(entryId) || []) {
        const attachedContent = String(attached?.content || '').trim();
        items.push({
          id: `entry:${entryId}:attached:${String(attached?.id || '').trim()}`,
          title: formatDateLabel(attached?.createdAt),
          subtitle: String(attached?.entryType || 'follow_up').replace(/_/g, ' '),
          preview: truncateText(attachedContent, 150),
          content: attachedContent || 'No follow-up context is available for this diary item yet.',
          label: 'Follow-up',
          metric: String(attached?.sourceType || 'Diary comment'),
        });
      }
    }

    return items;
  }, [linkedEntries, narratives, rootEntries]);
  const [selectedReaderId, setSelectedReaderId] = useState('');

  useEffect(() => {
    setSelectedReaderId((previous) => (
      readerItems.some((item) => item.id === previous)
        ? previous
        : (readerItems[0]?.id || '')
    ));
  }, [readerItems]);

  useEffect(() => {
    const requestedId = String(props.initialSelectedReaderId || '').trim();
    if (!requestedId) {
      return;
    }
    if (readerItems.some((item) => item.id === requestedId)) {
      setSelectedReaderId(requestedId);
    }
  }, [props.initialSelectedReaderId, readerItems]);

  const selectedReaderItem = useMemo(
    () => readerItems.find((item) => item.id === selectedReaderId) || null,
    [readerItems, selectedReaderId],
  );

  const handleCreateSessionDiary = async () => {
    if (!props.currentSessionId) {
      return;
    }
    setErrorMessage('');
    setBusyCreatingSessionDiary(true);
    try {
      await props.onCreateSessionDiary();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create session diary.');
    } finally {
      setBusyCreatingSessionDiary(false);
    }
  };

  const handleSubmitComment = async (entryId: string) => {
    const draft = String(drafts[entryId] || '').trim();
    if (!draft) {
      return;
    }
    setErrorMessage('');
    setSavingEntryId(entryId);
    try {
      await props.onCommentDiaryEntry(entryId, draft);
      setDrafts((previous) => ({ ...previous, [entryId]: '' }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save diary comment.');
    } finally {
      setSavingEntryId(null);
    }
  };

  return (
    <div className="next-stage-scroll">
      <div className="next-panel-stage">
        <div className="next-panel-stage-top">
          <div className="next-mini-panel">
            <div className="next-mini-label">Diary Controls</div>
            <p className="next-panel-copy">
              Comment on any diary entry to add context back into the record and trigger a fresh reflection grounded in the original plus your note.
            </p>
            <button
              type="button"
              className="next-secondary-button"
              disabled={!props.currentSessionId || busyCreatingSessionDiary}
              onClick={() => void handleCreateSessionDiary()}
            >
              {busyCreatingSessionDiary ? 'Creating…' : 'Create Session Diary'}
            </button>
            {errorMessage ? <div className="next-error-copy">{errorMessage}</div> : null}

            <div className="next-diary-reader">
              <div className="next-mini-label">Diary Reader</div>
              {selectedReaderItem ? (
                <>
                  <div className="next-diary-reader-head">
                    <div>
                      <div className="next-mini-label">{selectedReaderItem.label}</div>
                      <strong>{selectedReaderItem.title}</strong>
                      <span>{selectedReaderItem.subtitle}</span>
                    </div>
                    <span>{selectedReaderItem.metric}</span>
                  </div>
                  <div className="next-diary-reader-copy">{selectedReaderItem.content}</div>
                </>
              ) : (
                <div className="next-empty-inline">
                  Daily narratives and diary records will become readable here as soon as they are available.
                </div>
              )}
            </div>
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Diary Index</div>
            <div className="next-document-list">
              {readerItems.length ? readerItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`next-document-row next-diary-index-row${selectedReaderId === item.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedReaderId(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                  <span className="next-document-row-preview">{item.preview}</span>
                </button>
              )) : (
                <div className="next-empty-inline">Daily narrative snapshots will appear here after diary compilation.</div>
              )}
            </div>
          </div>
        </div>

        <div className="next-diary-list">
          {rootEntries.length ? rootEntries.map((entry: any) => {
            const attached = linkedEntries.get(String(entry.id)) || [];
            return (
              <article key={entry.id} className="next-diary-entry">
                <div className="next-diary-entry-head">
                  <div>
                    <div className="next-mini-label">{String(entry.entryType || 'entry').replace(/_/g, ' ')}</div>
                    <strong>{formatDateLabel(entry.createdAt)}</strong>
                  </div>
                  <div className="next-diary-entry-head-actions">
                    <span>{String(entry.activityKey || entry.sourceType || 'Diary')}</span>
                    <button
                      type="button"
                      className="next-card-action"
                      onClick={() => setSelectedReaderId(`entry:${String(entry.id)}`)}
                    >
                      Open in Reader
                    </button>
                  </div>
                </div>
                <div className="next-diary-entry-copy">{entry.content}</div>

                {attached.length ? (
                  <div className="next-diary-thread">
                    <div className="next-mini-label">Follow-up Context</div>
                    {attached.map((item: any) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`next-diary-thread-item${selectedReaderId === `entry:${String(entry.id)}:attached:${String(item.id)}` ? ' is-active' : ''}`}
                        onClick={() => setSelectedReaderId(`entry:${String(entry.id)}:attached:${String(item.id)}`)}
                      >
                        <strong>{String(item.entryType || 'entry').replace(/_/g, ' ')}</strong>
                        <span>{formatDateLabel(item.createdAt)}</span>
                        <p>{item.content}</p>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="next-diary-comment-form">
                  <textarea
                    className="next-composer next-composer--compact"
                    value={drafts[entry.id] || ''}
                    onChange={(event) => setDrafts((previous) => ({ ...previous, [entry.id]: event.target.value }))}
                    placeholder="Add context, a correction, or a note to trigger a new reflection…"
                    rows={2}
                  />
                  <button
                    type="button"
                    className="next-secondary-button"
                    disabled={savingEntryId === entry.id || !String(drafts[entry.id] || '').trim()}
                    onClick={() => void handleSubmitComment(String(entry.id))}
                  >
                    {savingEntryId === entry.id ? 'Saving…' : 'Comment & Re-reflect'}
                  </button>
                </div>
              </article>
            );
          }) : (
            <div className="next-empty-inline">No diary entries are available yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarketingWorkbenchPanel(props: {
  onClose?: () => void;
}): React.ReactElement {
  const nexus = window.nexus;
  const [bridgeState, setBridgeState] = useState<any>(null);
  const [bridgeFiles, setBridgeFiles] = useState<any[]>([]);
  const [videoConfig, setVideoConfig] = useState<any>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const refreshBridgeFiles = useCallback(async () => {
    try {
      const files = await nexus.marketing.listBridgeFiles(8);
      setBridgeFiles(Array.isArray(files) ? files : []);
    } catch (error) {
      console.warn('[Nexus] Failed to refresh marketing bridge files:', error);
      setBridgeFiles([]);
    }
  }, [nexus.marketing]);

  useEffect(() => {
    let disposed = false;

    const bootstrap = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const [bridge, config, files] = await Promise.all([
          nexus.marketing.getBridgeState(),
          nexus.marketing.getVideoConfig(),
          nexus.marketing.listBridgeFiles(8),
        ]);
        if (disposed) {
          return;
        }
        setBridgeState(bridge || null);
        setVideoConfig(config || null);
        setBridgeFiles(Array.isArray(files) ? files : []);
      } catch (error: any) {
        if (!disposed) {
          setErrorMessage(String(error?.message || 'Failed to load Marketing Department.'));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    const unsubscribe = nexus.marketing.onDownloadEvent((payload: any) => {
      const message = String(
        payload?.message
        || payload?.status
        || payload?.filename
        || payload?.path
        || 'NotebookLM bridge updated.',
      ).trim();
      if (!disposed && message) {
        setDownloadStatus(message);
      }
      void refreshBridgeFiles();
    });

    void bootstrap();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [nexus.marketing, refreshBridgeFiles]);

  useEffect(() => {
    if (!props.onClose) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.onClose]);

  const workspaceName = getPathTail(bridgeState?.rootDir) || 'Marketing Workspace';
  const notebookUrl = String(bridgeState?.notebookUrl || 'https://notebooklm.google.com/');
  const notebookHost = getHostLabel(notebookUrl) || 'notebooklm.google.com';
  const voiceProfileCount = Array.isArray(videoConfig?.voiceProfiles) ? videoConfig.voiceProfiles.length : 0;
  const avatarProfileCount = Array.isArray(videoConfig?.avatarProfiles) ? videoConfig.avatarProfiles.length : 0;
  const bridgeReady = Boolean(bridgeState?.rootDir && bridgeState?.incomingDir && bridgeState?.outgoingDir);
  const providerStatuses = [
    {
      name: 'NotebookLM',
      detail: 'Primary research workspace',
      ready: Boolean(notebookUrl),
    },
    {
      name: 'HeyGen',
      detail: `${avatarProfileCount} avatar profiles available`,
      ready: Boolean(videoConfig?.heygenApiKeyConfigured),
    },
    {
      name: 'xAI',
      detail: 'Narrative and analysis assist',
      ready: Boolean(videoConfig?.xaiApiKeyConfigured),
    },
    {
      name: 'Voice Assets',
      detail: `${voiceProfileCount} reusable voice profiles`,
      ready: voiceProfileCount > 0,
    },
  ];
  const bridgePaths = [
    {
      label: 'Root Workspace',
      name: workspaceName,
      path: bridgeState?.rootDir || 'Unavailable',
      note: 'Department folder controlled by Nexus.',
    },
    {
      label: 'Incoming Lane',
      name: getPathTail(bridgeState?.incomingDir) || 'incoming',
      path: bridgeState?.incomingDir || 'Unavailable',
      note: 'NotebookLM downloads land here for preview and reuse.',
    },
    {
      label: 'Outgoing Lane',
      name: getPathTail(bridgeState?.outgoingDir) || 'outgoing',
      path: bridgeState?.outgoingDir || 'Unavailable',
      note: 'Handoff folder only. It does not auto-sync back into NotebookLM yet.',
    },
  ];
  const liveEvents = [
    {
      title: 'Incoming monitor',
      detail: downloadStatus || 'Waiting for the next NotebookLM download to land in the intake lane.',
      tone: downloadStatus ? 'live' : 'idle',
    },
    {
      title: 'External workspace',
      detail: `Connected to ${notebookHost} for research and synthesis.`,
      tone: 'ready',
    },
    {
      title: 'Delivery mode',
      detail: 'Nexus can review, relabel, and reuse outputs before they leave the studio.',
      tone: 'ready',
    },
  ];
  const bridgeFacts = [
    {
      title: 'What works',
      detail: 'Downloads triggered inside the embedded NotebookLM workspace are captured into the incoming lane and surfaced to Nexus.',
      tone: 'ready',
    },
    {
      title: 'What does not',
      detail: 'The outgoing lane is not a two-way sync. Files placed there are not uploaded back into NotebookLM automatically.',
      tone: 'warn',
    },
    {
      title: 'What to use now',
      detail: 'Create inside NotebookLM below. Use the bridge folders to inspect captured outputs and hand off finished assets.',
      tone: 'live',
    },
  ];

  if (loading) {
    return (
      <div className="next-marketing-shell">
        <div className="next-empty-inline">Loading Marketing Department…</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="next-marketing-shell">
        <div className="next-error-copy">{errorMessage}</div>
      </div>
    );
  }

  return (
    <div className="next-marketing-shell">
      <div className="next-marketing-topbar">
        <div className="next-marketing-heading">
          <div className="next-mini-label">Marketing Department</div>
          <strong>{workspaceName}</strong>
          <p className="next-marketing-subtitle">
            NotebookLM first. Nexus captures downloads and exposes the bridge folders around it.
          </p>
        </div>
        <div className="next-marketing-actions">
          <button
            type="button"
            className="next-secondary-button next-marketing-action-button"
            onClick={() => void nexus.marketing.revealFolder('incoming')}
          >
            Reveal Incoming
          </button>
          <button
            type="button"
            className="next-secondary-button next-marketing-action-button"
            onClick={() => void nexus.marketing.revealFolder('outgoing')}
          >
            Reveal Outgoing
          </button>
          <button
            type="button"
            className="next-secondary-button next-marketing-action-button"
            onClick={() => void nexus.marketing.openExternal(bridgeState?.notebookUrl)}
          >
            Open External
          </button>
          {props.onClose ? (
            <button
              type="button"
              className="next-secondary-button next-marketing-action-button"
              onClick={props.onClose}
            >
              Exit Marketing
            </button>
          ) : null}
        </div>
      </div>

      <div className="next-marketing-workspace">
        <section className="next-marketing-primary">
          <div className="next-marketing-webview-shell">
            <div className="next-marketing-webview-header">
              <div className="next-marketing-window-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="next-marketing-webview-meta">
                <strong>Embedded NotebookLM</strong>
                <span>{notebookUrl}</span>
              </div>
              <div className="next-marketing-webview-badges">
                <span className="next-marketing-badge">NotebookLM</span>
                <span className={`next-marketing-badge${bridgeReady ? ' is-live' : ' is-warn'}`}>
                  {bridgeReady ? 'Bridge live' : 'Bridge partial'}
                </span>
              </div>
            </div>
            <webview
              className="next-marketing-webview"
              src={notebookUrl}
              partition={bridgeState?.partition || 'persist:marketing-notebooklm'}
              allowpopups={true}
            />
          </div>
        </section>

        <aside className="next-marketing-inspector">
          <div className="next-mini-panel">
            <div className="next-mini-label">Bridge</div>
            <div className="next-marketing-chip-row">
              <span className={`next-marketing-chip${bridgeReady ? ' is-live' : ' is-warn'}`}>
                {bridgeReady ? 'Download bridge live' : 'Bridge partial'}
              </span>
              <span className="next-marketing-chip is-ready">{notebookHost}</span>
              <span className="next-marketing-chip is-warn">Outgoing is manual</span>
            </div>
            <div className="next-marketing-fact-list">
              {bridgeFacts.map((fact) => (
                <article className="next-marketing-fact-row" key={fact.title}>
                  <span className={`next-marketing-state${fact.tone === 'live' ? ' is-live' : fact.tone === 'ready' ? ' is-ready' : ' is-warn'}`}>
                    {fact.tone === 'live' ? 'Now' : fact.tone === 'ready' ? 'Works' : 'Limit'}
                  </span>
                  <div>
                    <strong>{fact.title}</strong>
                    <p>{fact.detail}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="next-marketing-event-list">
              {liveEvents.map((event) => (
                <article className="next-marketing-event" key={event.title}>
                  <span className={`next-marketing-state${event.tone === 'live' ? ' is-live' : event.tone === 'ready' ? ' is-ready' : ''}`}>
                    {event.tone === 'live' ? 'Live' : event.tone === 'ready' ? 'Ready' : 'Idle'}
                  </span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="next-marketing-path-list">
              {bridgePaths.map((lane) => (
                <article className="next-marketing-path-card" key={lane.label}>
                  <div className="next-marketing-path-top">
                    <span>{lane.label}</span>
                    <strong>{lane.name}</strong>
                  </div>
                  <p className="next-marketing-path-value">{lane.path}</p>
                  <p className="next-panel-copy">{lane.note}</p>
                </article>
              ))}
            </div>
            <div className="next-marketing-lane-actions">
              <button
                type="button"
                className="next-secondary-button next-marketing-inline-button"
                onClick={() => void nexus.marketing.revealFolder('root')}
              >
                Reveal Root
              </button>
              <button
                type="button"
                className="next-secondary-button next-marketing-inline-button"
                onClick={() => void nexus.marketing.revealFolder('incoming')}
              >
                Reveal Incoming
              </button>
              <button
                type="button"
                className="next-secondary-button next-marketing-inline-button"
                onClick={() => void nexus.marketing.revealFolder('outgoing')}
              >
                Reveal Outgoing
              </button>
            </div>
          </div>

          <div className="next-mini-panel">
            <div className="next-marketing-panel-top">
              <div>
                <div className="next-mini-label">Recent Bridge Files</div>
                <p className="next-panel-copy">Latest files seen in the incoming and outgoing lanes.</p>
              </div>
              <button
                type="button"
                className="next-secondary-button next-marketing-inline-button"
                onClick={() => void refreshBridgeFiles()}
              >
                Refresh
              </button>
            </div>
            <div className="next-marketing-file-list">
              {bridgeFiles.length > 0 ? bridgeFiles.map((file) => (
                <article className="next-marketing-file-row" key={`${file.path}:${file.modifiedAt}`}>
                  <span className={`next-marketing-state${String(file.lane) === 'incoming' ? ' is-live' : ''}`}>
                    {String(file.lane) === 'incoming' ? 'Incoming' : 'Outgoing'}
                  </span>
                  <div className="next-marketing-file-copy">
                    <strong>{file.name || getPathTail(file.path) || 'Untitled file'}</strong>
                    <p>{formatFileSize(file.size)}{file.modifiedAt ? ` • ${formatDateLabel(file.modifiedAt)}` : ''}</p>
                    <p className="next-marketing-file-path">{file.path}</p>
                  </div>
                  <button
                    type="button"
                    className="next-secondary-button next-marketing-inline-button"
                    onClick={() => void nexus.artifacts.reveal(String(file.path || ''))}
                  >
                    Reveal
                  </button>
                </article>
              )) : (
                <div className="next-empty-inline">
                  No bridge files yet. Create or download something in NotebookLM, then use Refresh.
                </div>
              )}
            </div>
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Providers</div>
            <div className="next-marketing-provider-list">
              {providerStatuses.map((provider) => (
                <article className="next-marketing-provider-row" key={provider.name}>
                  <div>
                    <strong>{provider.name}</strong>
                    <p>{provider.detail}</p>
                  </div>
                  <span className={`next-marketing-state${provider.ready ? ' is-ready' : ' is-warn'}`}>
                    {provider.ready ? 'Ready' : 'Missing'}
                  </span>
                </article>
              ))}
            </div>
            <div className="next-marketing-chip-row">
              <span className="next-marketing-chip">{voiceProfileCount} voice</span>
              <span className="next-marketing-chip">{avatarProfileCount} avatar</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatisticsWorkbenchPanel(props: { data: any }): React.ReactElement {
  const llm = props.data?.llm && typeof props.data.llm === 'object' ? props.data.llm : {};
  const providers = Array.isArray(llm?.providers) ? llm.providers : [];
  const recentDays = Array.isArray(llm?.recentDays) ? llm.recentDays : [];
  const elevenlabs = props.data?.elevenlabs && typeof props.data.elevenlabs === 'object' ? props.data.elevenlabs : {};
  const elevenlabsLocal = elevenlabs?.local && typeof elevenlabs.local === 'object' ? elevenlabs.local : {};
  const elevenlabsBreakdown = Array.isArray(elevenlabs?.breakdown) ? elevenlabs.breakdown : [];
  const elevenlabsNotes = Array.isArray(elevenlabs?.notes) ? elevenlabs.notes : [];
  const account = elevenlabs?.account && typeof elevenlabs.account === 'object' ? elevenlabs.account : null;
  const performance = props.data?.performance && typeof props.data.performance === 'object' ? props.data.performance : {};
  const system = performance?.system && typeof performance.system === 'object' ? performance.system : {};
  const processStats = performance?.process && typeof performance.process === 'object' ? performance.process : {};
  const electron = performance?.electron && typeof performance.electron === 'object' ? performance.electron : {};
  const runtime = performance?.runtime && typeof performance.runtime === 'object' ? performance.runtime : {};
  const electronProcesses = Array.isArray(electron?.processes) ? electron.processes : [];
  const maxRecentTokens = Math.max(1, ...recentDays.map((day: any) => Number(day?.totalTokens) || 0));
  const systemMemoryPercent = clampPercent(system?.memoryUsedPercent);
  const systemLoadPercent = clampPercent(system?.loadPercent1m);
  const heapPercent = clampPercent(
    Number(processStats?.heapTotalBytes) > 0
      ? (Number(processStats?.heapUsedBytes) / Number(processStats?.heapTotalBytes)) * 100
      : 0,
  );

  return (
    <div className="next-room-layout next-stats-room">
      <section className="next-mini-panel next-room-hero">
        <div className="next-mini-label">Observatory</div>
        <h3>Live performance dashboard</h3>
        <p>
          Live machine health, token usage, provider spend, and voice activity from the local Nexus runtime.
        </p>
        <div className="next-room-metrics">
          <article className="next-score-card">
            <span>LLM Requests</span>
            <strong>{formatCompactNumber(llm?.requestCount)}</strong>
          </article>
          <article className="next-score-card">
            <span>Total Tokens</span>
            <strong>{formatCompactNumber(llm?.totalTokens)}</strong>
          </article>
          <article className="next-score-card">
            <span>Today Tokens</span>
            <strong>{formatCompactNumber(llm?.todayTotalTokens)}</strong>
          </article>
          <article className="next-score-card">
            <span>RAM Used</span>
            <strong>{formatPercentValue(systemMemoryPercent)}</strong>
          </article>
          <article className="next-score-card">
            <span>App RAM</span>
            <strong>{formatFileSize(electron?.workingSetBytes || processStats?.rssBytes)}</strong>
          </article>
          <article className="next-score-card">
            <span>CPU Load</span>
            <strong>{formatPercentValue(systemLoadPercent)}</strong>
          </article>
        </div>
      </section>

      <div className="next-room-columns">
        <section className="next-mini-panel">
          <div className="next-mini-label">Computer Performance</div>
          <div className="next-performance-grid">
            <article className="next-room-card next-performance-card">
              <div className="next-room-card-head">
                <strong>System RAM</strong>
                <span>{formatPercentValue(systemMemoryPercent)}</span>
              </div>
              <div className="next-performance-meter" aria-hidden="true">
                <span style={{ width: `${systemMemoryPercent}%` }} />
              </div>
              <p>{formatFileSize(system?.usedMemoryBytes)} used of {formatFileSize(system?.totalMemoryBytes)} · {formatFileSize(system?.freeMemoryBytes)} free</p>
            </article>
            <article className="next-room-card next-performance-card">
              <div className="next-room-card-head">
                <strong>CPU Load</strong>
                <span>{formatPercentValue(systemLoadPercent)}</span>
              </div>
              <div className="next-performance-meter" aria-hidden="true">
                <span style={{ width: `${systemLoadPercent}%` }} />
              </div>
              <p>{formatCompactNumber(system?.cpuCount)} cores · {String(system?.cpuModel || 'CPU')}</p>
            </article>
            <article className="next-room-card next-performance-card">
              <div className="next-room-card-head">
                <strong>Nexus Memory</strong>
                <span>{formatFileSize(electron?.workingSetBytes || processStats?.rssBytes)}</span>
              </div>
              <p>{formatCompactNumber(electron?.processCount)} Electron processes · {formatFileSize(processStats?.rssBytes)} main RSS</p>
            </article>
            <article className="next-room-card next-performance-card">
              <div className="next-room-card-head">
                <strong>JS Heap</strong>
                <span>{formatPercentValue(heapPercent)}</span>
              </div>
              <div className="next-performance-meter" aria-hidden="true">
                <span style={{ width: `${heapPercent}%` }} />
              </div>
              <p>{formatFileSize(processStats?.heapUsedBytes)} used of {formatFileSize(processStats?.heapTotalBytes)}</p>
            </article>
          </div>
        </section>

        <section className="next-mini-panel">
          <div className="next-mini-label">Token Trend</div>
          <div className="next-token-day-list">
            {recentDays.length ? recentDays.map((day: any, index: number) => {
              const totalTokens = Number(day?.totalTokens) || 0;
              const width = Math.max(3, Math.min(100, (totalTokens / maxRecentTokens) * 100));
              return (
                <article className="next-token-day-row" key={String(day?.day || index)}>
                  <span>{String(day?.day || 'Unknown')}</span>
                  <div className="next-token-day-bar" aria-hidden="true">
                    <strong style={{ width: `${width}%` }} />
                  </div>
                  <em>{formatCompactNumber(totalTokens)} tokens</em>
                </article>
              );
            }) : (
              <div className="next-empty-inline">No LLM token usage has been recorded in the last seven days.</div>
            )}
          </div>
          <ul className="next-simple-list">
            <li>Today: {formatCompactNumber(llm?.todayRequestCount)} requests · {formatCompactNumber(llm?.todayTotalTokens)} tokens · {formatCurrencyAmount(llm?.todayCost)}</li>
            <li>Total cost: {formatCurrencyAmount(llm?.totalCost)}</li>
            {llm?.lastUsedAt ? <li>Last tracked model call: {formatDateLabel(llm.lastUsedAt)}</li> : null}
          </ul>
        </section>
      </div>

      <div className="next-room-columns">
        <section className="next-mini-panel">
          <div className="next-mini-label">Model Providers</div>
          <div className="next-room-card-list">
            {providers.length ? providers.map((provider: any) => (
              <article className="next-room-card" key={String(provider.provider || provider.name)}>
                <div className="next-room-card-head">
                  <strong>{String(provider.provider || provider.name || 'Provider')}</strong>
                  <span>{formatCurrencyAmount(provider.totalCost)}</span>
                </div>
                <p>{formatCompactNumber(provider.requestCount)} requests · {formatCompactNumber(provider.totalTokens)} tokens</p>
              </article>
            )) : (
              <div className="next-empty-inline">No provider usage has been tracked yet.</div>
            )}
          </div>
        </section>

        <section className="next-mini-panel">
          <div className="next-mini-label">ElevenLabs Voice</div>
          <div className="next-room-metrics">
            <article className="next-score-card">
              <span>Configured</span>
              <strong>{elevenlabs?.configured ? 'Yes' : 'No'}</strong>
            </article>
            <article className="next-score-card">
              <span>Sessions</span>
              <strong>{formatCompactNumber(elevenlabsLocal?.conversationSessionCount)}</strong>
            </article>
            <article className="next-score-card">
              <span>TTS Calls</span>
              <strong>{formatCompactNumber(elevenlabsLocal?.ttsRequestCount)}</strong>
            </article>
            <article className="next-score-card">
              <span>Characters</span>
              <strong>{formatCompactNumber(elevenlabsLocal?.characterCount)}</strong>
            </article>
          </div>
          {account ? (
            <article className="next-room-card">
              <div className="next-room-card-head">
                <strong>Subscription</strong>
                <span>{String(account?.tier || account?.plan || 'active')}</span>
              </div>
              <p>
                {account?.character_count != null && account?.character_limit != null
                  ? `${formatCompactNumber(account.character_count)} / ${formatCompactNumber(account.character_limit)} characters`
                  : 'Usage limits were not returned from the account payload.'}
              </p>
            </article>
          ) : null}
        </section>
      </div>

      <div className="next-room-columns">
        <section className="next-mini-panel">
          <div className="next-mini-label">App Process Detail</div>
          <div className="next-process-list">
            {electronProcesses.length ? electronProcesses.map((item: any) => (
              <article className="next-process-row" key={`${item.pid}-${item.type}-${item.name}`}>
                <div>
                  <strong>{String(item.name || item.type || 'Process')}</strong>
                  <span>PID {String(item.pid)} · {formatPercentValue(item.cpuPercent, 1)} CPU</span>
                </div>
                <em>{formatFileSize(item.workingSetBytes)}</em>
              </article>
            )) : (
              <div className="next-empty-inline">Electron process metrics were not available yet.</div>
            )}
          </div>
        </section>

        <section className="next-mini-panel">
          <div className="next-mini-label">Voice Breakdown</div>
          <div className="next-room-card-list">
            {elevenlabsBreakdown.length ? elevenlabsBreakdown.map((item: any) => (
              <article className="next-room-card" key={`${item.product}-${item.operation}-${item.unit}`}>
                <div className="next-room-card-head">
                  <strong>{String(item.label || item.operation || item.product || 'Usage event')}</strong>
                  <span>{formatCompactNumber(item.quantity)}</span>
                </div>
                <p>{formatCompactNumber(item.requestCount)} requests{item.lastUsedAt ? ` · ${formatDateLabel(item.lastUsedAt)}` : ''}</p>
              </article>
            )) : (
              <div className="next-empty-inline">No voice breakdown events are available yet.</div>
            )}
          </div>
        </section>

        <section className="next-mini-panel">
          <div className="next-mini-label">Operational Notes</div>
          <ul className="next-simple-list">
            <li>Last dashboard refresh: {formatDateLabel(props.data?.generatedAt)}</li>
            <li>Runtime: PID {String(processStats?.pid || 'unknown')} · up {formatDurationFromSeconds(processStats?.uptimeSeconds)} · Electron {String(runtime?.electronVersion || 'unknown')}</li>
            <li>Machine: {String(system?.hostname || 'local')} · {String(runtime?.platform || 'platform')} {String(runtime?.arch || '')}</li>
            {elevenlabs?.remoteError ? <li>ElevenLabs remote status: {String(elevenlabs.remoteError)}</li> : null}
            {elevenlabsNotes.length ? elevenlabsNotes.map((note: string) => (
              <li key={note}>{note}</li>
            )) : <li>No operational notes were returned.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function TaskQueueWorkbenchPanel(props: { data: any }): React.ReactElement {
  const board = props.data && typeof props.data === 'object' ? props.data : null;
  const items = Array.isArray(board?.items) ? board.items : [];

  if (!board?.sessionId) {
    return (
      <div className="next-empty-state">
        <strong>No task board</strong>
        <span>Select an active session before opening Task Queue so Nexus has a mission board to inspect.</span>
      </div>
    );
  }

  const columns = [
    { key: 'ready', label: 'Ready', items: items.filter((item: any) => item.status === 'ready') },
    { key: 'in_progress', label: 'In Progress', items: items.filter((item: any) => item.status === 'in_progress') },
    { key: 'blocked', label: 'Blocked', items: items.filter((item: any) => item.status === 'blocked') },
    { key: 'pending', label: 'Pending', items: items.filter((item: any) => item.status === 'pending') },
    { key: 'done', label: 'Done', items: items.filter((item: any) => item.status === 'done') },
  ];

  return (
    <div className="next-room-layout next-task-room">
      <section className="next-mini-panel next-room-hero">
        <div className="next-mini-label">Mission Control</div>
        <h3>{String(board.sessionName || 'Task Queue')}</h3>
        <p>{String(board.summary || 'This room should keep blockers, dependencies, and next actions visible at a glance.')}</p>
        <div className="next-room-metrics">
          <article className="next-score-card">
            <span>Tasks</span>
            <strong>{formatCompactNumber(items.length)}</strong>
          </article>
          <article className="next-score-card">
            <span>Needs User</span>
            <strong>{formatCompactNumber(items.filter((item: any) => item.needsUser).length)}</strong>
          </article>
          <article className="next-score-card">
            <span>Agent Help</span>
            <strong>{formatCompactNumber(items.filter((item: any) => item.canAgentHelp).length)}</strong>
          </article>
          <article className="next-score-card">
            <span>Reminder Window</span>
            <strong>{formatCompactNumber(board.remindIntervalMinutes)}m</strong>
          </article>
        </div>
      </section>

      <div className="next-task-columns">
        {columns.map((column) => (
          <section className="next-mini-panel next-task-column" key={column.key}>
            <div className="next-task-column-head">
              <div className="next-mini-label">{column.label}</div>
              <span>{formatCompactNumber(column.items.length)}</span>
            </div>
            <div className="next-task-card-list">
              {column.items.length ? column.items.map((item: any) => (
                <article className="next-task-card" key={String(item.id)}>
                  <div className="next-task-card-head">
                    <strong>{String(item.title || item.userTitle || item.agentTitle || 'Task')}</strong>
                    <span>{String(item.owner || 'shared')}</span>
                  </div>
                  <p>{String(item.nextAction || item.userNextAction || item.agentNextAction || 'No next action recorded.')}</p>
                  <div className="next-status-chip-row">
                    {item.needsUser ? <span className="next-marketing-chip">Needs user</span> : null}
                    {item.canAgentHelp ? <span className="next-marketing-chip">Agent can help</span> : null}
                    {item.isPinned ? <span className="next-marketing-chip">Pinned</span> : null}
                  </div>
                  <div className="next-task-card-meta">
                    <div>
                      <span>Reason</span>
                      <strong>{String(item.reason || item.agentReason || item.userNotes || 'No reasoning captured.')}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{formatDateLabel(item.updatedAt || item.createdAt)}</strong>
                    </div>
                  </div>
                </article>
              )) : (
                <div className="next-empty-inline">Nothing in {column.label.toLowerCase()} right now.</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function BugsWorkbenchPanel(props: {
  data: any;
  currentSessionId: string | null;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
}): React.ReactElement {
  const nexus = window.nexus;
  const reports = Array.isArray(props.data)
    ? props.data
    : Array.isArray(props.data?.reports)
      ? props.data.reports
      : [];
  const [selectedBugId, setSelectedBugId] = useState<string>('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  useEffect(() => {
    const firstId = String(reports[0]?.id || '').trim();
    if (!firstId) {
      setSelectedBugId('');
      return;
    }
    setSelectedBugId((previous) => (
      reports.some((report: any) => String(report?.id || '') === previous) ? previous : firstId
    ));
  }, [reports]);

  if (!reports.length) {
    return (
      <div className="next-empty-state">
        <strong>No bug reports</strong>
        <span>When Nexus records bugs, intended behavior, actual behavior, and suggested fixes will appear here.</span>
      </div>
    );
  }

  const selectedReport = reports.find((report: any) => String(report?.id || '') === selectedBugId) || reports[0];
  const severityCounts = reports.reduce((acc: Record<string, number>, report: any) => {
    const key = String(report?.severity || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const statusCounts = reports.reduce((acc: Record<string, number>, report: any) => {
    const key = String(report?.status || 'open').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    setExportStatus('');
    try {
      const result = await nexus.bugs.exportPdf({
        limit: 100,
        sessionId: props.currentSessionId || undefined,
      });
      const exportPath = String(result?.path || '').trim();
      setExportStatus(exportPath ? `Exported ${result?.count || reports.length} bugs to PDF.` : 'Bug report PDF exported.');
      if (exportPath) {
        await props.onOpenArtifact(exportPath, 'workstation');
      }
    } catch (error: any) {
      setExportStatus(String(error?.message || 'Failed to export bug report PDF.'));
    } finally {
      setExportingPdf(false);
    }
  }, [nexus.bugs, props.currentSessionId, props.onOpenArtifact, reports.length]);

  return (
    <div className="next-room-layout next-bugs-room">
      <section className="next-mini-panel next-room-hero">
        <div className="next-mini-label">Diagnostic Lab</div>
        <h3>Structured bug validation and evidence</h3>
        <p>The bug room should feel like a place to inspect contradictions, not a place where raw JSON gets dumped and forgotten.</p>
        <div className="next-inline-actions">
          <button
            type="button"
            className="next-secondary-button"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf}
          >
            {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </button>
          {exportStatus ? <span className="next-inline-status">{exportStatus}</span> : null}
        </div>
        <div className="next-room-metrics">
          <article className="next-score-card">
            <span>Total Bugs</span>
            <strong>{formatCompactNumber(reports.length)}</strong>
          </article>
          <article className="next-score-card">
            <span>Open</span>
            <strong>{formatCompactNumber(statusCounts.open || 0)}</strong>
          </article>
          <article className="next-score-card">
            <span>Critical</span>
            <strong>{formatCompactNumber(severityCounts.critical || 0)}</strong>
          </article>
          <article className="next-score-card">
            <span>Reviewing</span>
            <strong>{formatCompactNumber(statusCounts.reviewing || 0)}</strong>
          </article>
        </div>
      </section>

      <div className="next-room-columns">
        <section className="next-mini-panel next-bug-room-list">
          <div className="next-mini-label">Reports</div>
          <div className="next-document-list">
            {reports.map((report: any) => (
              <button
                type="button"
                key={String(report?.id || Math.random())}
                className={`next-document-row${String(report?.id || '') === String(selectedReport?.id || '') ? ' is-active' : ''}`}
                onClick={() => setSelectedBugId(String(report?.id || ''))}
              >
                <strong>{String(report?.intent || 'Bug report')}</strong>
                <span>{String(report?.severity || 'unknown')} · {String(report?.status || 'open')}</span>
                <span className="next-document-row-preview">{truncateText(report?.actual || report?.suggestedSolution || '', 140)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="next-mini-panel next-bug-room-detail">
          <div className="next-bug-report-head">
            <div>
              <div className="next-mini-label">{String(selectedReport?.source || 'app')}</div>
              <strong>{String(selectedReport?.intent || 'Bug report')}</strong>
            </div>
            <div className="next-bug-report-meta">
              <span>{String(selectedReport?.severity || 'unknown')}</span>
              <span>{String(selectedReport?.status || 'open')}</span>
              <span>{formatDateLabel(selectedReport?.createdAt)}</span>
            </div>
          </div>

          <div className="next-bug-report-block">
            <div className="next-mini-label">Expected Behavior</div>
            <p>{String(selectedReport?.intent || 'No intended behavior recorded.')}</p>
          </div>

          <div className="next-bug-report-block">
            <div className="next-mini-label">Actual Behavior</div>
            <p>{String(selectedReport?.actual || 'No actual behavior recorded.')}</p>
          </div>

          <div className="next-bug-report-block">
            <div className="next-mini-label">Suggested Fix</div>
            <p>{String(selectedReport?.suggestedSolution || 'No suggested fix recorded.')}</p>
          </div>

          {selectedReport?.context ? (
            <details className="next-bug-report-details" open>
              <summary>Context</summary>
              <pre className="next-message-raw">{safeJsonPreview(selectedReport.context)}</pre>
            </details>
          ) : null}

          {selectedReport?.stack ? (
            <details className="next-bug-report-details">
              <summary>Stack Trace</summary>
              <pre className="next-message-raw">{String(selectedReport.stack)}</pre>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function getSetupStatusTone(status: unknown): SetupCheckStatus {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'ok' || normalized === 'ready') {
    return 'healthy';
  }
  if (normalized === 'error' || normalized === 'missing' || normalized === 'failed') {
    return 'error';
  }
  return 'warning';
}

function buildSetupStatusSummary(runtimeReport: RuntimeReadinessReport | null, ollamaState: any): {
  status: SetupCheckStatus;
  label: string;
  detail: string;
} {
  const requiredErrors = Number(runtimeReport?.summary?.requiredErrors || 0);
  if (requiredErrors > 0) {
    return {
      status: 'error',
      label: 'Blocked',
      detail: `${requiredErrors} required setup item${requiredErrors === 1 ? '' : 's'} need attention.`,
    };
  }

  const warnings = Number(runtimeReport?.summary?.warnings || 0);
  const ollamaStatus = String(ollamaState?.status || '').trim().toLowerCase();
  if (warnings > 0 || ['not_installed', 'missing_models', 'error'].includes(ollamaStatus)) {
    return {
      status: 'warning',
      label: 'Usable with limits',
      detail: 'Core storage is ready, but some optional tools or release checks need attention.',
    };
  }

  return {
    status: 'healthy',
    label: 'Ready',
    detail: 'Required app storage and local profile checks are ready.',
  };
}

function SetupWizardModal(props: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  onOpenSettings: () => void;
}): React.ReactElement | null {
  const nexus = window.nexus;
  const [activeStep, setActiveStep] = useState<SetupWizardStep>('welcome');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [runtimeReport, setRuntimeReport] = useState<RuntimeReadinessReport | null>(null);
  const [networkReport, setNetworkReport] = useState<any>(null);
  const [ollamaState, setOllamaState] = useState<any>(null);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [openAiApiKey, setOpenAiApiKey] = useState('');
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState('');

  const refreshSetupState = useCallback(async (includeNetwork = false) => {
    setLoading(true);
    setErrorMessage('');
    try {
      const [
        runtime,
        ollama,
        offlineMode,
        openAiKey,
        elevenKey,
        elevenAgentId,
        network,
      ] = await Promise.all([
        nexus.diagnostics.runtimeReadiness(),
        nexus.diagnostics.ollamaStatus(),
        nexus.settings.get('offline_mode_enabled'),
        nexus.settings.get('openai_api_key'),
        nexus.settings.get('elevenlabs_api_key'),
        nexus.settings.get('elevenlabs_agent_id'),
        includeNetwork ? nexus.diagnostics.runNetworkHealth() : Promise.resolve(null),
      ]);

      setRuntimeReport(runtime || null);
      setOllamaState(ollama || null);
      setOfflineModeEnabled(String(offlineMode ?? '').trim().toLowerCase() === 'true');
      setOpenAiApiKey(String(openAiKey || ''));
      setElevenLabsApiKey(String(elevenKey || ''));
      setElevenLabsAgentId(String(elevenAgentId || ''));
      if (network) {
        setNetworkReport(network);
      }
      setStatusMessage(includeNetwork ? 'Readiness and network checks refreshed.' : 'Readiness checks refreshed.');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to refresh setup checks.');
    } finally {
      setLoading(false);
    }
  }, [nexus.diagnostics, nexus.settings]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    setActiveStep('welcome');
    setStatusMessage('');
    setErrorMessage('');
    void refreshSetupState(false);
  }, [props.open, refreshSetupState]);

  const saveCoreSettings = useCallback(async () => {
    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await nexus.settings.set('offline_mode_enabled', offlineModeEnabled ? 'true' : 'false');
      await nexus.settings.set('openai_api_key', openAiApiKey.trim());
      await nexus.settings.set('elevenlabs_api_key', elevenLabsApiKey.trim());
      await nexus.settings.set('elevenlabs_agent_id', elevenLabsAgentId.trim());
      setStatusMessage('Core settings saved.');
      await refreshSetupState(false);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to save setup settings.');
      throw error;
    } finally {
      setSaving(false);
    }
  }, [
    elevenLabsAgentId,
    elevenLabsApiKey,
    nexus.settings,
    offlineModeEnabled,
    openAiApiKey,
    refreshSetupState,
  ]);

  const finishSetup = useCallback(async () => {
    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await saveCoreSettings();
      await nexus.settings.set(SETUP_WIZARD_COMPLETED_KEY, 'true');
      await nexus.settings.set('setup_wizard_completed_at', new Date().toISOString());
      props.onComplete();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to finish setup.');
    } finally {
      setSaving(false);
    }
  }, [nexus.settings, props, saveCoreSettings]);

  const copyPath = useCallback(async (value: string, label: string) => {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }
    const copied = await nexus.clipboard.writeText(text);
    setStatusMessage(copied ? `${label} copied.` : `Unable to copy ${label.toLowerCase()}.`);
  }, [nexus.clipboard]);

  if (!props.open) {
    return null;
  }

  const setupSummary = buildSetupStatusSummary(runtimeReport, ollamaState);
  const runtimeChecks = Array.isArray(runtimeReport?.checks) ? runtimeReport.checks : [];
  const requiredChecks = runtimeChecks.filter((check) => check.required);
  const optionalChecks = runtimeChecks.filter((check) => !check.required);
  const networkChecks = Array.isArray(networkReport?.checks) ? networkReport.checks : [];
  const ollamaStatus = String(ollamaState?.status || 'unknown').replace(/_/g, ' ');

  return (
    <div className="next-setup-overlay" role="dialog" aria-modal="true" aria-label="EIG Nexus Next setup">
      <div className="next-setup-backdrop" onClick={props.onClose}></div>
      <div className="next-setup-modal">
        <header className="next-setup-header">
          <div>
            <div className="next-mini-label">First Run Setup</div>
            <h2>EIG Nexus Next</h2>
            <p>Confirm the app can store its own data, then add the credentials and local tools needed for the workflows you plan to use.</p>
          </div>
          <button type="button" className="next-close-button" onClick={props.onClose}>
            Later
          </button>
        </header>

        <div className="next-setup-progress" aria-label="Setup steps">
          {(['welcome', 'readiness', 'credentials', 'finish'] as SetupWizardStep[]).map((step, index) => (
            <button
              type="button"
              key={step}
              className={`next-setup-step${activeStep === step ? ' is-active' : ''}`}
              onClick={() => setActiveStep(step)}
            >
              <span>{index + 1}</span>
              <strong>{step === 'welcome' ? 'Start' : step === 'readiness' ? 'Checks' : step === 'credentials' ? 'Keys' : 'Finish'}</strong>
            </button>
          ))}
        </div>

        <main className="next-setup-body">
          {activeStep === 'welcome' ? (
            <section className="next-setup-section">
              <div className={`next-setup-summary is-${setupSummary.status}`}>
                <span>{setupSummary.label}</span>
                <strong>{setupSummary.detail}</strong>
              </div>
              <div className="next-setup-grid">
                <article className="next-setup-card">
                  <div className="next-mini-label">Storage</div>
                  <strong>Separate Next profile</strong>
                  <p>{runtimeReport?.userDataPath || 'Checking profile path...'}</p>
                  <button
                    type="button"
                    className="next-secondary-button"
                    onClick={() => void copyPath(runtimeReport?.userDataPath || '', 'Profile path')}
                    disabled={!runtimeReport?.userDataPath}
                  >
                    Copy Path
                  </button>
                </article>
                <article className="next-setup-card">
                  <div className="next-mini-label">Workspace</div>
                  <strong>Documents output folder</strong>
                  <p>{runtimeReport?.workspacePath || 'Checking workspace path...'}</p>
                  <button
                    type="button"
                    className="next-secondary-button"
                    onClick={() => void copyPath(runtimeReport?.workspacePath || '', 'Workspace path')}
                    disabled={!runtimeReport?.workspacePath}
                  >
                    Copy Path
                  </button>
                </article>
              </div>
              <div className="next-setup-actions">
                <button type="button" className="next-secondary-button" onClick={() => void refreshSetupState(false)} disabled={loading}>
                  {loading ? 'Checking...' : 'Refresh Checks'}
                </button>
                <button type="button" className="next-primary-button" onClick={() => setActiveStep('readiness')}>
                  Continue
                </button>
              </div>
            </section>
          ) : activeStep === 'readiness' ? (
            <section className="next-setup-section">
              <div className="next-setup-section-head">
                <div>
                  <div className="next-mini-label">Readiness Checks</div>
                  <h3>Required items must pass; warnings explain limited features.</h3>
                </div>
                <button type="button" className="next-secondary-button" onClick={() => void refreshSetupState(true)} disabled={loading}>
                  {loading ? 'Running...' : 'Run Full Checks'}
                </button>
              </div>

              <div className="next-setup-check-list">
                {[...requiredChecks, ...optionalChecks].map((check) => {
                  const tone = getSetupStatusTone(check.status);
                  return (
                    <article key={check.id} className={`next-setup-check is-${tone}`}>
                      <div className="next-setup-check-main">
                        <span className={`next-setup-dot is-${tone}`}></span>
                        <div>
                          <strong>{check.label}</strong>
                          <p>{check.message}</p>
                          {check.details ? <small>{check.details}</small> : null}
                          {check.action ? <small>{check.action}</small> : null}
                        </div>
                      </div>
                      <span className="next-setup-badge">{check.required ? 'Required' : check.area}</span>
                    </article>
                  );
                })}
              </div>

              <div className="next-setup-card">
                <div className="next-mini-label">Local AI</div>
                <strong>Ollama status: {ollamaStatus}</strong>
                <p>
                  {ollamaState?.lastError
                    ? String(ollamaState.lastError)
                    : Array.isArray(ollamaState?.models) && ollamaState.models.length
                      ? `Models detected: ${ollamaState.models.join(', ')}`
                      : 'No local models detected yet.'}
                </p>
              </div>

              {networkChecks.length ? (
                <div className="next-setup-network-grid">
                  {networkChecks.map((check: any) => {
                    const tone = getSetupStatusTone(check.status);
                    return (
                      <article key={check.service || check.label} className={`next-setup-network-card is-${tone}`}>
                        <span>{check.label}</span>
                        <strong>{check.message}</strong>
                        <small>{check.configured ? 'Configured' : 'Not configured'}{check.latencyMs ? ` | ${check.latencyMs}ms` : ''}</small>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              <div className="next-setup-actions">
                <button type="button" className="next-secondary-button" onClick={() => setActiveStep('welcome')}>
                  Back
                </button>
                <button type="button" className="next-primary-button" onClick={() => setActiveStep('credentials')}>
                  Continue
                </button>
              </div>
            </section>
          ) : activeStep === 'credentials' ? (
            <section className="next-setup-section">
              <div className="next-setup-section-head">
                <div>
                  <div className="next-mini-label">Core Settings</div>
                  <h3>Save the minimum configuration for chat, voice, and local mode.</h3>
                </div>
                <button type="button" className="next-secondary-button" onClick={props.onOpenSettings}>
                  Full Settings
                </button>
              </div>

              <label className="next-settings-check-row">
                <input
                  type="checkbox"
                  checked={offlineModeEnabled}
                  onChange={(event) => setOfflineModeEnabled(event.target.checked)}
                />
                <span>Use offline mode for text chat when local Ollama is available</span>
              </label>

              <div className="next-settings-grid">
                <label className="next-settings-field">
                  <span>OpenAI API Key</span>
                  <input
                    className="next-settings-input"
                    type="password"
                    placeholder="sk-..."
                    value={openAiApiKey}
                    onChange={(event) => setOpenAiApiKey(event.target.value)}
                  />
                  <small>Recommended for first public users unless you are distributing a local-only build.</small>
                </label>
                <label className="next-settings-field">
                  <span>ElevenLabs API Key</span>
                  <input
                    className="next-settings-input"
                    type="password"
                    placeholder="xi-..."
                    value={elevenLabsApiKey}
                    onChange={(event) => setElevenLabsApiKey(event.target.value)}
                  />
                  <small>Optional for voice. The app can still open without it.</small>
                </label>
              </div>

              <label className="next-settings-field">
                <span>ElevenLabs Agent ID</span>
                <input
                  className="next-settings-input"
                  placeholder="agent_..."
                  value={elevenLabsAgentId}
                  onChange={(event) => setElevenLabsAgentId(event.target.value)}
                />
              </label>

              <div className="next-setup-actions">
                <button type="button" className="next-secondary-button" onClick={() => setActiveStep('readiness')}>
                  Back
                </button>
                <button type="button" className="next-primary-button" onClick={() => void saveCoreSettings()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Core Settings'}
                </button>
                <button type="button" className="next-secondary-button" onClick={() => setActiveStep('finish')}>
                  Continue
                </button>
              </div>
            </section>
          ) : (
            <section className="next-setup-section">
              <div className={`next-setup-summary is-${setupSummary.status}`}>
                <span>{setupSummary.label}</span>
                <strong>{setupSummary.detail}</strong>
              </div>
              <div className="next-setup-finish-grid">
                <article className="next-setup-card">
                  <div className="next-mini-label">Install</div>
                  <strong>Move the app to Applications</strong>
                  <p>For public builds, the download should be Developer ID signed and notarized so users can open it normally.</p>
                </article>
                <article className="next-setup-card">
                  <div className="next-mini-label">Local Models</div>
                  <strong>Ollama is optional but recommended</strong>
                  <p>Install Ollama and pull nomic-embed-text if users want local embeddings and offline text workflows.</p>
                </article>
                <article className="next-setup-card">
                  <div className="next-mini-label">Media Tools</div>
                  <strong>Install Homebrew tools for media workflows</strong>
                  <p>Advanced YouTube, clipping, and video jobs use ffmpeg, ffprobe, yt-dlp, and uv when available.</p>
                </article>
              </div>
              <div className="next-setup-actions">
                <button type="button" className="next-secondary-button" onClick={() => setActiveStep('credentials')}>
                  Back
                </button>
                <button type="button" className="next-primary-button" onClick={() => void finishSetup()} disabled={saving}>
                  {saving ? 'Finishing...' : 'Finish Setup'}
                </button>
              </div>
            </section>
          )}
        </main>

        {(statusMessage || errorMessage) ? (
          <footer className="next-setup-footer">
            {statusMessage ? <span className="next-inline-status">{statusMessage}</span> : null}
            {errorMessage ? <span className="next-error-copy">{errorMessage}</span> : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function SettingsWorkbenchPanel(): React.ReactElement {
  const nexus = window.nexus;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [bridgeConfig, setBridgeConfig] = useState<any>(null);
  const [bridgeEnabled, setBridgeEnabled] = useState(true);
  const [bridgePort, setBridgePort] = useState('47831');
  const [bridgeKey, setBridgeKey] = useState('');
  const [showBridgeKey, setShowBridgeKey] = useState(false);
  const [allowedOrigins, setAllowedOrigins] = useState('');
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [openAiApiKey, setOpenAiApiKey] = useState('');
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState('');

  const refreshSettings = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const [
        bridge,
        offlineMode,
        openAiKey,
        elevenKey,
        elevenAgentId,
      ] = await Promise.all([
        nexus.nexusBridge.getConfig(),
        nexus.settings.get('offline_mode_enabled'),
        nexus.settings.get('openai_api_key'),
        nexus.settings.get('elevenlabs_api_key'),
        nexus.settings.get('elevenlabs_agent_id'),
      ]);

      setBridgeConfig(bridge || null);
      setBridgeEnabled(Boolean(bridge?.enabled));
      setBridgePort(String(bridge?.port || 47831));
      setBridgeKey(String(bridge?.key || ''));
      setAllowedOrigins(Array.isArray(bridge?.allowedOrigins) ? bridge.allowedOrigins.join('\n') : '');
      setOfflineModeEnabled(String(offlineMode ?? '').trim().toLowerCase() === 'true');
      setOpenAiApiKey(String(openAiKey || ''));
      setElevenLabsApiKey(String(elevenKey || ''));
      setElevenLabsAgentId(String(elevenAgentId || ''));
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [nexus.nexusBridge, nexus.settings]);

  useEffect(() => {
    void refreshSettings();

    const unsubscribe = nexus.nexusBridge.onStatus((status) => {
      setBridgeConfig(status || null);
      if (status?.port) {
        setBridgePort(String(status.port));
      }
      if (Array.isArray(status?.allowedOrigins)) {
        setAllowedOrigins(status.allowedOrigins.join('\n'));
      }
      if (typeof status?.enabled === 'boolean') {
        setBridgeEnabled(status.enabled);
      }
    });

    return unsubscribe;
  }, [nexus.nexusBridge, refreshSettings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const nextPort = Number.parseInt(bridgePort.trim(), 10);
      if (!Number.isFinite(nextPort) || nextPort < 1 || nextPort > 65535) {
        throw new Error('Bridge port must be between 1 and 65535.');
      }

      const origins = allowedOrigins
        .split(/[\n,]+/)
        .map((origin) => origin.trim())
        .filter(Boolean);

      await nexus.settings.set('nexus_bridge_enabled', bridgeEnabled ? 'true' : 'false');
      await nexus.settings.set('nexus_bridge_port', String(nextPort));
      await nexus.settings.set('nexus_bridge_allowed_origins', JSON.stringify(origins.length ? origins : ['*']));
      if (bridgeKey.trim()) {
        await nexus.settings.set('nexus_bridge_key', bridgeKey.trim());
      }
      await nexus.settings.set('offline_mode_enabled', offlineModeEnabled ? 'true' : 'false');
      await nexus.settings.set('openai_api_key', openAiApiKey.trim());
      await nexus.settings.set('elevenlabs_api_key', elevenLabsApiKey.trim());
      await nexus.settings.set('elevenlabs_agent_id', elevenLabsAgentId.trim());

      const synced = await nexus.nexusBridge.sync();
      const config = await nexus.nexusBridge.getConfig();
      setBridgeConfig(config || synced || null);
      setBridgeKey(String(config?.key || bridgeKey || ''));
      setStatusMessage(`Settings saved. Desktop bridge is ${config?.running ? 'listening' : 'not listening'} at ${config?.url || `http://127.0.0.1:${nextPort}`}.`);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }, [
    allowedOrigins,
    bridgeEnabled,
    bridgeKey,
    bridgePort,
    elevenLabsAgentId,
    elevenLabsApiKey,
    nexus.nexusBridge,
    nexus.settings,
    offlineModeEnabled,
    openAiApiKey,
  ]);

  const copyText = useCallback(async (value: string, label: string) => {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }

    const copied = await nexus.clipboard.writeText(text);
    setStatusMessage(copied ? `${label} copied.` : `Unable to copy ${label.toLowerCase()}.`);
  }, [nexus.clipboard]);

  const regenerateBridgeKey = useCallback(async () => {
    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const next = await nexus.nexusBridge.regenerateKey();
      setBridgeConfig(next || null);
      setBridgeKey(String(next?.key || ''));
      setStatusMessage('Bridge key regenerated. Copy the new key into the browser bridge panel.');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to regenerate bridge key.');
    } finally {
      setSaving(false);
    }
  }, [nexus.nexusBridge]);

  return (
    <div className="next-room-layout next-settings-room">
      <section className="next-mini-panel next-room-hero">
        <div className="next-mini-label">Desktop Settings</div>
        <h3>Settings that affect live Nexus behavior</h3>
        <p>
          Use this panel to manage the local browser bridge, offline chat routing, and core model credentials
          without leaving Nexus Next.
        </p>
        <div className="next-settings-status-grid">
          <article className={`next-settings-status-card${bridgeConfig?.running ? ' is-online' : ' is-offline'}`}>
            <span>Desktop Bridge</span>
            <strong>{bridgeConfig?.running ? 'Listening' : 'Offline'}</strong>
            <small>{bridgeConfig?.url || `http://127.0.0.1:${bridgePort}`}</small>
          </article>
          <article className="next-settings-status-card">
            <span>Requests Served</span>
            <strong>{formatCompactNumber(Number(bridgeConfig?.requestsServed || 0))}</strong>
            <small>{bridgeConfig?.startedAt ? `Started ${formatDateLabel(bridgeConfig.startedAt)}` : 'Not started'}</small>
          </article>
        </div>
      </section>

      {loading ? (
        <div className="next-empty-inline">Loading settings…</div>
      ) : (
        <>
          <section className="next-mini-panel next-settings-card">
            <div className="next-settings-card-head">
              <div>
                <div className="next-mini-label">Browser To Desktop Bridge</div>
                <strong>Connection values</strong>
              </div>
              <button type="button" className="next-secondary-button" onClick={() => void refreshSettings()} disabled={saving}>
                Refresh
              </button>
            </div>

            <label className="next-settings-check-row">
              <input
                type="checkbox"
                checked={bridgeEnabled}
                onChange={(event) => setBridgeEnabled(event.target.checked)}
              />
              <span>Enable Desktop Nexus Bridge</span>
            </label>

            <div className="next-settings-grid">
              <label className="next-settings-field">
                <span>Bridge URL</span>
                <div className="next-settings-copy-row">
                  <input
                    className="next-settings-input"
                    value={bridgeConfig?.url || `http://127.0.0.1:${bridgePort}`}
                    readOnly
                  />
                  <button
                    type="button"
                    className="next-secondary-button"
                    onClick={() => void copyText(bridgeConfig?.url || `http://127.0.0.1:${bridgePort}`, 'Bridge URL')}
                  >
                    Copy
                  </button>
                </div>
              </label>

              <label className="next-settings-field">
                <span>Port</span>
                <input
                  className="next-settings-input"
                  value={bridgePort}
                  onChange={(event) => setBridgePort(event.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="next-settings-field">
              <span>Bridge Key</span>
              <div className="next-settings-copy-row">
                <input
                  className="next-settings-input next-settings-key-input"
                  type={showBridgeKey ? 'text' : 'password'}
                  value={bridgeKey}
                  onChange={(event) => setBridgeKey(event.target.value)}
                />
                <button type="button" className="next-secondary-button" onClick={() => setShowBridgeKey((previous) => !previous)}>
                  {showBridgeKey ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="next-secondary-button" onClick={() => void copyText(bridgeKey, 'Bridge key')}>
                  Copy
                </button>
                <button type="button" className="next-secondary-button" onClick={() => void regenerateBridgeKey()} disabled={saving}>
                  Regenerate
                </button>
              </div>
            </label>

            <label className="next-settings-field">
              <span>Allowed Origins</span>
              <textarea
                className="next-settings-textarea"
                value={allowedOrigins}
                onChange={(event) => setAllowedOrigins(event.target.value)}
                rows={4}
              />
              <small>One origin per line. Use `*` while debugging Replit/private-network browser restrictions.</small>
            </label>

            {bridgeConfig?.lastError ? (
              <div className="next-error-copy">{String(bridgeConfig.lastError)}</div>
            ) : null}
          </section>

          <section className="next-mini-panel next-settings-card">
            <div className="next-mini-label">Chat And Model Routing</div>
            <label className="next-settings-check-row">
              <input
                type="checkbox"
                checked={offlineModeEnabled}
                onChange={(event) => setOfflineModeEnabled(event.target.checked)}
              />
              <span>Offline mode for text chat</span>
            </label>

            <div className="next-settings-grid">
              <label className="next-settings-field">
                <span>OpenAI API Key</span>
                <input
                  className="next-settings-input"
                  type="password"
                  placeholder="sk-..."
                  value={openAiApiKey}
                  onChange={(event) => setOpenAiApiKey(event.target.value)}
                />
              </label>

              <label className="next-settings-field">
                <span>ElevenLabs API Key</span>
                <input
                  className="next-settings-input"
                  type="password"
                  placeholder="xi-..."
                  value={elevenLabsApiKey}
                  onChange={(event) => setElevenLabsApiKey(event.target.value)}
                />
              </label>
            </div>

            <label className="next-settings-field">
              <span>ElevenLabs Agent ID</span>
              <input
                className="next-settings-input"
                value={elevenLabsAgentId}
                onChange={(event) => setElevenLabsAgentId(event.target.value)}
                placeholder="agent_..."
              />
            </label>
          </section>

          <div className="next-settings-actions">
            <button type="button" className="next-primary-button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            {statusMessage ? <span className="next-inline-status">{statusMessage}</span> : null}
            {errorMessage ? <span className="next-error-copy">{errorMessage}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

function ResearchDepartmentPanel(props: {
  currentSessionId: string | null;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onOpenKnowledgeBase: () => void;
  onSyncKnowledgeGraph: () => Promise<any>;
}): React.ReactElement {
  const nexus = window.nexus;
  const [status, setStatus] = useState<any>(null);
  const [daemonStatus, setDaemonStatus] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any>(null);
  const [projectName, setProjectName] = useState('');
  const [projectObjective, setProjectObjective] = useState('');
  const [youtubeChannel, setYoutubeChannel] = useState('');
  const [webQuery, setWebQuery] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const loadProject = useCallback(async (projectId: string) => {
    const detail = await nexus.research.getProject(projectId);
    setActiveProject(detail || null);
    return detail;
  }, [nexus.research]);

  const refresh = useCallback(async (preferredProjectId?: string) => {
    setErrorMessage('');
    const [nextStatus, nextDaemonStatus, nextProjects] = await Promise.all([
      nexus.research.status(),
      nexus.daemon.status(),
      nexus.research.listProjects(40),
    ]);
    setStatus(nextStatus || null);
    setDaemonStatus(nextDaemonStatus || null);
    const normalizedProjects = Array.isArray(nextProjects) ? nextProjects : [];
    setProjects(normalizedProjects);
    const targetId = preferredProjectId
      || activeProject?.id
      || normalizedProjects[0]?.id
      || '';
    if (targetId) {
      await loadProject(String(targetId));
    } else {
      setActiveProject(null);
    }
  }, [activeProject?.id, loadProject, nexus.daemon, nexus.research]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!busy || !activeProject?.id) {
      return undefined;
    }
    const projectId = String(activeProject.id);
    const timer = window.setInterval(() => {
      void loadProject(projectId).catch(() => undefined);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [activeProject?.id, busy, loadProject]);

  const runAction = async (label: string, action: () => Promise<any>) => {
    setBusy(label);
    setNotice('');
    setErrorMessage('');
    try {
      const result = await action();
      const summary = String(result?.summary || result?.message || '').trim();
      setNotice(summary || `${label} completed.`);
      const projectId = String(result?.project?.id || activeProject?.id || '').trim();
      await refresh(projectId || undefined);
      return result;
    } catch (error: any) {
      setErrorMessage(String(error?.message || error || `${label} failed.`));
      return null;
    } finally {
      setBusy('');
    }
  };

  const handleCreateProject = async () => {
    const name = projectName.trim();
    if (!name) {
      setErrorMessage('Project name is required.');
      return;
    }
    const created = await runAction('Create project', async () => nexus.research.createProject({
      name,
      objective: projectObjective.trim(),
      costMode: 'local-free',
    }));
    if (created?.id) {
      setProjectName('');
      setProjectObjective('');
      await loadProject(String(created.id));
    }
  };

  const handleAssignYoutube = async (classifyNow = false) => {
    if (!activeProject?.id || !youtubeChannel.trim()) {
      setErrorMessage('Select a project and enter a YouTube channel first.');
      return;
    }
    await runAction('Sync YouTube channel', async () => nexus.research.assignYouTubeChannel(
      activeProject.id,
      youtubeChannel.trim(),
      {
        syncNow: true,
        classifyNow,
        limit: 25,
        sessionId: props.currentSessionId || undefined,
      },
    ));
  };

  const handleCreateChannelJob = async () => {
    if (!activeProject?.id || !youtubeChannel.trim()) {
      setErrorMessage('Select a project and enter a YouTube channel first.');
      return;
    }
    await runAction('Create channel job', async () => {
      const job = await nexus.research.createJob({
        projectId: activeProject.id,
        name: `Sync ${youtubeChannel.trim()}`,
        jobType: 'youtube_channel_sync',
        scheduleType: 'interval',
        intervalMinutes: Math.max(15, Number(intervalMinutes) || 1440),
        costMode: 'local-free',
        input: {
          handleOrUrl: youtubeChannel.trim(),
          classifyNow: false,
          sessionId: props.currentSessionId || undefined,
        },
        limits: { maxVideos: 25 },
      });
      if (!daemonStatus?.running) {
        await nexus.daemon.start(5);
      }
      return {
        ...job,
        summary: `Scheduled ${youtubeChannel.trim()} and started the daemon scheduler.`,
      };
    });
  };

  const handleClassify = async () => {
    if (!activeProject?.id) {
      return;
    }
    await runAction('Classify sources', async () => nexus.research.classifyProjectSources(activeProject.id, {
      limit: 30,
      onlyPending: true,
    }));
  };

  const handleWebSearch = async () => {
    if (!activeProject?.id || !webQuery.trim()) {
      setErrorMessage('Select a project and enter a public web search query first.');
      return;
    }
    await runAction('Run web search', async () => {
      const job = await nexus.research.createJob({
        projectId: activeProject.id,
        name: `Public web search: ${webQuery.trim()}`,
        jobType: 'web_search',
        scheduleType: 'manual',
        costMode: 'free-network',
        input: { query: webQuery.trim() },
        limits: { maxResults: 8 },
      });
      return nexus.research.runJob(job.id);
    });
  };

  const handleSynthesis = async () => {
    if (!activeProject?.id) {
      return;
    }
    const result = await runAction('Create synthesis brief', async () => nexus.research.createSynthesisBrief(activeProject.id, {
      limit: 90,
    }));
    if (result?.path) {
      await props.onOpenArtifact(String(result.path), 'workstation');
    }
  };

  const handleRunJob = async (jobId: string) => {
    await runAction('Run research job', async () => nexus.research.runJob(jobId));
  };

  const handleRunDue = async () => {
    await runAction('Run due jobs', async () => {
      const runs = await nexus.research.runDueJobs();
      return { summary: `Ran ${Array.isArray(runs) ? runs.length : 0} due research job(s).`, runs };
    });
  };

  const handleStartScheduler = async () => {
    await runAction('Start scheduler', async () => {
      const nextDaemon = await nexus.daemon.start(5);
      setDaemonStatus(nextDaemon || null);
      return { summary: 'Daemon scheduler is running. Due research jobs will run on each tick.' };
    });
  };

  const handleStopScheduler = async () => {
    await runAction('Stop scheduler', async () => {
      const nextDaemon = await nexus.daemon.stop();
      setDaemonStatus(nextDaemon || null);
      return { summary: 'Daemon scheduler stopped. Manual research runs still work.' };
    });
  };

  const handleRunSchedulerTick = async () => {
    await runAction('Run scheduler tick', async () => {
      const runs = await nexus.daemon.runTick(undefined, 'research_due_jobs');
      return { summary: `Research scheduler tick completed with ${Array.isArray(runs) ? runs.length : 0} result(s).`, runs };
    });
  };

  const handleSyncKnowledgeGraph = async () => {
    await runAction('Sync knowledge graph', async () => {
      const result = await props.onSyncKnowledgeGraph();
      return {
        ...result,
        summary: `Knowledge graph synced with ${Number(result?.stats?.nodes || 0)} nodes and ${Number(result?.stats?.edges || 0)} edges.`,
      };
    });
  };

  const localModel = status?.localModel || {};
  const youtubeSyncBusy = busy === 'Sync YouTube channel';
  const classifyBusy = busy === 'Classify sources';
  const graphSyncBusy = busy === 'Sync knowledge graph';
  const activeSources = Array.isArray(activeProject?.sources) ? activeProject.sources : [];
  const classifiedSourceCount = activeSources.filter((source: any) => String(source?.classificationStatus || '') === 'classified').length;
  const pendingSourceCount = activeSources.filter((source: any) => String(source?.classificationStatus || 'pending') === 'pending').length;
  const findingsByType = Array.isArray(activeProject?.findings)
    ? activeProject.findings.reduce((acc: Record<string, number>, finding: any) => {
        const type = String(finding?.findingType || 'finding');
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="next-stage-scroll">
      <div className="next-panel-stage">
        <div className="next-panel-stage-top">
          <section className="next-mini-panel">
            <div className="next-mini-label">Autonomous Local Research</div>
            <p className="next-panel-copy">
              Local-free jobs use Ollama and public or local sources first. Cloud usage stays off unless a job is explicitly marked cloud-enabled.
            </p>
            <div className="next-status-chip-row">
              <span className={`next-marketing-chip${localModel.reachable ? ' is-ready' : ''}`}>
                Ollama {localModel.reachable ? 'ready' : 'not reachable'}
              </span>
              <span className={`next-marketing-chip${daemonStatus?.running ? ' is-ready' : ''}`}>
                Scheduler {daemonStatus?.running ? 'running' : 'stopped'}
              </span>
              <span className="next-marketing-chip">{localModel.model || 'llama3.2'}</span>
              <span className="next-marketing-chip">local-free default</span>
              <span className="next-marketing-chip">{Number(status?.activeJobCount || 0)} active jobs</span>
              <span className="next-marketing-chip">{Number(status?.dueJobCount || 0)} due now</span>
            </div>
            {localModel.error ? <div className="next-error-copy">{String(localModel.error)}</div> : null}
            <div className="next-status-chip-row">
              <button type="button" className="next-marketing-chip next-chip-button" disabled={Boolean(busy) || Boolean(daemonStatus?.running)} onClick={() => void handleStartScheduler()}>
                Start Scheduler
              </button>
              <button type="button" className="next-marketing-chip next-chip-button" disabled={Boolean(busy) || !daemonStatus?.running} onClick={() => void handleStopScheduler()}>
                Stop Scheduler
              </button>
              <button type="button" className="next-marketing-chip next-chip-button" disabled={Boolean(busy)} onClick={() => void handleRunSchedulerTick()}>
                Tick Research Jobs
              </button>
            </div>
            <div className="next-inline-form">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Research project name"
              />
              <button type="button" className="next-secondary-button" disabled={Boolean(busy)} onClick={() => void handleCreateProject()}>
                Create
              </button>
            </div>
            <textarea
              className="next-composer next-composer--compact"
              rows={3}
              value={projectObjective}
              onChange={(event) => setProjectObjective(event.target.value)}
              placeholder="Objective, target topic, or invention direction"
            />
            {notice ? <div className="next-empty-inline">{notice}</div> : null}
            {errorMessage ? <div className="next-error-copy">{errorMessage}</div> : null}
          </section>

          <section className="next-mini-panel">
            <div className="next-mini-label">Projects</div>
            <div className="next-document-list">
              {projects.length ? projects.map((project: any) => (
                <button
                  key={String(project.id)}
                  type="button"
                  className={`next-document-row${activeProject?.id === project.id ? ' is-active' : ''}`}
                  onClick={() => void loadProject(String(project.id))}
                >
                  <strong>{String(project.name || 'Research project')}</strong>
                  <span>
                    {[
                      `${Number(project.sourceCount || 0)} sources`,
                      `${Number(project.findingCount || 0)} findings`,
                      `${Number(project.jobCount || 0)} jobs`,
                    ].join(' · ')}
                  </span>
                  <span className="next-document-row-preview">{String(project.objective || 'No objective recorded yet.')}</span>
                </button>
              )) : (
                <div className="next-empty-inline">Create the first research project to start scheduling local work.</div>
              )}
            </div>
          </section>
        </div>

        {activeProject ? (
          <section className="next-flow-panel">
            <div className="next-flow-panel-head">
              <div>
                <div className="next-mini-label">Research Flow</div>
                <strong>{String(activeProject.name || 'Research project')}</strong>
              </div>
              {busy ? <InlineLoading label={`${busy} running`} /> : null}
            </div>
            <div className="next-flow-strip">
              <FlowStep
                index={1}
                label="Sync Sources"
                value={`${Number(activeProject.sourceCount || 0)} sources`}
                detail="Add a YouTube channel, web result, PDF, or capture."
                state={Number(activeProject.sourceCount || 0) > 0 ? 'ready' : youtubeSyncBusy ? 'active' : 'waiting'}
              />
              <FlowStep
                index={2}
                label="Classify"
                value={`${classifiedSourceCount} classified · ${pendingSourceCount} pending`}
                detail="Ollama extracts facts, claims, methods, risks, and questions."
                state={classifyBusy ? 'active' : pendingSourceCount > 0 ? 'waiting' : classifiedSourceCount > 0 ? 'ready' : 'waiting'}
              />
              <FlowStep
                index={3}
                label="Review Evidence"
                value={`${Number(activeProject.findingCount || 0)} findings`}
                detail="Scan evidence types, recent sources, and finding rows."
                state={Number(activeProject.findingCount || 0) > 0 ? 'ready' : 'waiting'}
              />
              <FlowStep
                index={4}
                label="Sync Graph"
                value="Knowledge Base"
                detail="Push research sources and findings into the Understand Anything graph."
                state={graphSyncBusy ? 'active' : Number(activeProject.findingCount || 0) > 0 ? 'ready' : 'waiting'}
              />
              <FlowStep
                index={5}
                label="Brief"
                value="Synthesis"
                detail="Generate a durable brief from classified findings."
                state={Number(activeProject.findingCount || 0) > 0 ? 'ready' : 'waiting'}
              />
            </div>
          </section>
        ) : null}

        {activeProject ? (
          <div className="next-panel-stage-top">
            <section className="next-mini-panel">
              <div className="next-mini-label">Project Control</div>
              <h3>{String(activeProject.name || 'Research project')}</h3>
              <p className="next-panel-copy">{String(activeProject.objective || 'No objective recorded yet.')}</p>
              <div className="next-status-chip-row">
                <span className="next-marketing-chip">{Number(activeProject.sourceCount || 0)} sources</span>
                <span className="next-marketing-chip">{Number(activeProject.findingCount || 0)} findings</span>
                <span className="next-marketing-chip">{Number(activeProject.jobCount || 0)} jobs</span>
              </div>
              {busy ? (
                <div className="next-empty-inline">
                  {busy} running...
                </div>
              ) : null}

              <div className="next-inline-form">
                <input
                  value={youtubeChannel}
                  onChange={(event) => setYoutubeChannel(event.target.value)}
                  placeholder="@channel or YouTube channel URL"
                />
                <button type="button" className="next-secondary-button" disabled={Boolean(busy)} onClick={() => void handleAssignYoutube(false)}>
                  {youtubeSyncBusy ? 'Syncing' : 'Sync'}
                </button>
              </div>
              <div className="next-status-chip-row">
                <button type="button" className="next-marketing-chip next-chip-button" disabled={Boolean(busy)} onClick={() => void handleAssignYoutube(true)}>
                  {youtubeSyncBusy ? 'Syncing' : 'Sync + Classify'}
                </button>
                <button type="button" className="next-marketing-chip next-chip-button" disabled={Boolean(busy)} onClick={() => void handleClassify()}>
                  {classifyBusy ? 'Classifying' : 'Classify Pending'}
                </button>
                <InfoBubble label="Classify Pending">
                  This can take a minute or two because Ollama reads each pending source and writes structured findings as it goes.
                </InfoBubble>
                <button type="button" className="next-marketing-chip next-chip-button" disabled={Boolean(busy)} onClick={() => void handleSynthesis()}>
                  Create Brief
                </button>
                <InfoBubble label="Create Brief">
                  Create Brief uses the classified findings, not the raw transcript list, so classify first when findings are empty.
                </InfoBubble>
              </div>

              <div className="next-inline-form">
                <input
                  value={webQuery}
                  onChange={(event) => setWebQuery(event.target.value)}
                  placeholder="Public web / white paper search"
                />
                <button type="button" className="next-secondary-button" disabled={Boolean(busy)} onClick={() => void handleWebSearch()}>
                  Search
                </button>
              </div>

              <div className="next-inline-form">
                <input
                  type="number"
                  min={15}
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(Number(event.target.value) || 1440)}
                  title="Interval minutes"
                />
                <button type="button" className="next-secondary-button" disabled={Boolean(busy)} onClick={() => void handleCreateChannelJob()}>
                  Schedule Channel Job
                </button>
              </div>
              <button type="button" className="next-secondary-button" disabled={Boolean(busy)} onClick={() => void handleRunDue()}>
                Run Due Jobs
              </button>
              <div className="next-inline-actions">
                <button type="button" className="next-secondary-button" disabled={Boolean(busy)} onClick={() => void handleSyncKnowledgeGraph()}>
                  {graphSyncBusy ? 'Syncing Graph' : 'Sync Graph'}
                </button>
                <button type="button" className="next-secondary-button" onClick={props.onOpenKnowledgeBase}>
                  Open Knowledge Base
                </button>
                <InfoBubble label="Knowledge Graph">
                  Sync Graph adds Research Department sources and findings to the same Understand Anything graph used by the Knowledge Base tab.
                </InfoBubble>
              </div>
            </section>

            <section className="next-mini-panel">
              <div className="next-mini-label">Evidence Types</div>
              <div className="next-status-chip-row">
                {Object.keys(findingsByType).length ? Object.entries(findingsByType).map(([type, count]) => (
                  <span className="next-marketing-chip" key={type}>{type.replace(/_/g, ' ')}: {Number(count || 0)}</span>
                )) : (
                  <span className="next-empty-inline">No classified evidence yet.</span>
                )}
              </div>
              <div className="next-mini-label">YouTube Channels</div>
              <div className="next-document-list">
                {Array.isArray(activeProject.youtubeChannels) && activeProject.youtubeChannels.length ? activeProject.youtubeChannels.map((channel: any) => (
                  <div className="next-document-row" key={String(channel.channelRecordId)}>
                    <strong>@{String(channel.channelHandle || 'channel')}</strong>
                    <span>
                      {[
                        String(channel.status || 'active'),
                        `${Number(channel.transcriptCount || 0)} transcripts`,
                        channel.lastSyncedAt ? `Synced ${formatDateLabel(channel.lastSyncedAt)}` : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )) : (
                  <div className="next-empty-inline">No project YouTube channels assigned yet.</div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {activeProject ? (
          <div className="next-panel-stage-top">
            <section className="next-mini-panel">
              <div className="next-mini-label">Jobs</div>
              <div className="next-document-list">
                {Array.isArray(activeProject.jobs) && activeProject.jobs.length ? activeProject.jobs.map((job: any) => (
                  <div className="next-document-row" key={String(job.id)}>
                    <strong>{String(job.name || job.jobType)}</strong>
                    <span>
                      {[
                        String(job.jobType || '').replace(/_/g, ' '),
                        String(job.scheduleType || 'manual'),
                        String(job.costMode || 'local-free'),
                      ].filter(Boolean).join(' · ')}
                    </span>
                    <span className="next-document-row-preview">
                      {job.nextRunAt ? `Next: ${formatDateLabel(job.nextRunAt)}` : 'Manual run'}
                    </span>
                    <button type="button" className="next-card-action" disabled={Boolean(busy)} onClick={() => void handleRunJob(String(job.id))}>
                      Run
                    </button>
                  </div>
                )) : (
                  <div className="next-empty-inline">No scheduled research jobs yet.</div>
                )}
              </div>
            </section>

            <section className="next-mini-panel">
              <div className="next-mini-label">Recent Sources</div>
              <div className="next-document-list">
                {Array.isArray(activeProject.sources) && activeProject.sources.length ? activeProject.sources.slice(0, 10).map((source: any) => (
                  <button
                    type="button"
                    className="next-document-row"
                    key={String(source.id)}
                    disabled={!source.filePath}
                    onClick={() => source.filePath ? props.onOpenArtifact(String(source.filePath), 'workstation') : undefined}
                  >
                    <strong>{String(source.title || 'Source')}</strong>
                    <span>{String(source.sourceType || 'source')} · {String(source.classificationStatus || 'pending')}</span>
                    <span className="next-document-row-preview">{truncateText(String(source.summary || source.url || source.filePath || ''), 160)}</span>
                  </button>
                )) : (
                  <div className="next-empty-inline">Sources from YouTube, web, PDFs, and browser captures will appear here.</div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {activeProject ? (
          <section className="next-mini-panel">
            <div className="next-mini-label">Recent Findings</div>
            <div className="next-document-list">
              {Array.isArray(activeProject.findings) && activeProject.findings.length ? activeProject.findings.slice(0, 14).map((finding: any) => (
                <div className="next-document-row" key={String(finding.id)}>
                  <strong>{String(finding.findingType || 'finding').replace(/_/g, ' ')}</strong>
                  <span>{Math.round(Number(finding.confidence || 0) * 100)}% confidence</span>
                  <span className="next-document-row-preview">{truncateText(String(finding.paraphrase || finding.text || ''), 220)}</span>
                </div>
              )) : (
                <div className="next-empty-inline">Run classification to extract facts, materials, instructions, claims, opinions, risks, and novel ingredients.</div>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

type InfluencerStudioStep = 'bible' | 'looks' | 'persona' | 'video' | 'scripts' | 'deals' | 'assets' | 'runs';

const INFLUENCER_STUDIO_STEPS: Array<{
  id: InfluencerStudioStep;
  icon: string;
  label: string;
  title: string;
  subtitle: string;
  command: string;
  prompt: string;
  script: string;
  primary: string;
  primaryAction: string;
  secondary: string;
}> = [
  {
    id: 'bible',
    icon: 'B',
    label: 'Bible',
    title: 'Lock the avatar identity first.',
    subtitle: 'Create one source of truth for face, skin, hair, style, camera rules, and negative prompts.',
    command: 'Nexus, create the avatar identity bible and save the locked face rules before generating more content.',
    prompt: 'Hyper-realistic female AI influencer, consistent oval facial structure, almond eyes, natural skin texture, realistic pores, subtle imperfections, detailed dark hair strands, modern luxury wellness aesthetic, soft editorial daylight, 9:16 social crop.',
    script: 'I am building a life that feels calm, polished, and real. Today I am taking you behind the scenes of the routines that make it possible.',
    primary: 'Save Identity Bible',
    primaryAction: 'save-bible',
    secondary: 'Refine Prompt',
  },
  {
    id: 'looks',
    icon: 'L',
    label: 'Looks',
    title: 'Build a visual look board.',
    subtitle: 'Generate variants, compare them visually, lock the best face, then swap outfits and scenes without changing identity.',
    command: 'Nexus, generate 8 identity-safe avatar looks, compare them, lock the strongest face, and reject weak variants.',
    prompt: 'Generate eight image variations using the locked identity. Change only outfit, lighting, crop, and environment. Preserve face geometry, age range, hair color family, skin texture, and modern luxury styling.',
    script: 'Use the locked identity as the source image. Create luxury street, clean studio, morning routine, product, travel, selfie, full-body, and talking-head variants.',
    primary: 'Create Grok Image',
    primaryAction: 'create-image',
    secondary: 'Stage Image Prompt',
  },
  {
    id: 'persona',
    icon: 'P',
    label: 'Persona',
    title: 'Shape the person behind the visuals.',
    subtitle: 'Define niche, voice, habits, opinions, boundaries, audience trust rules, and disclosure-safe positioning.',
    command: 'Nexus, create her personality profile, niche, tone, lifestyle, audience, content pillars, and disclosure rules.',
    prompt: 'Define her niche, tone of voice, interests, aesthetic, lifestyle, target audience, opinions, daily habits, content style, emotional positioning, and AI-generated disclosure rules.',
    script: 'I like simple systems, good lighting, and routines that make ambitious days feel lighter.',
    primary: 'Save Persona',
    primaryAction: 'save-persona',
    secondary: 'Draft Voice Samples',
  },
  {
    id: 'video',
    icon: 'V',
    label: 'Video',
    title: 'Stage a HeyGen storyboard.',
    subtitle: 'Use the selected look, spoken script, voice direction, and scene beats to stage a HeyGen video draft.',
    command: 'Nexus, turn the selected look into a HeyGen intro video draft with a 3-beat storyboard and keep final creation approval-gated.',
    prompt: 'Create a HeyGen-ready brief using the selected avatar image, a concise spoken script, voice direction, scene notes, and three storyboard beats: hook, body, CTA.',
    script: 'Three things changed how my mornings feel: better light, fewer decisions, and one routine I actually repeat.',
    primary: 'Stage HeyGen Brief',
    primaryAction: 'stage-heygen',
    secondary: 'Rewrite Script',
  },
  {
    id: 'scripts',
    icon: 'C',
    label: 'Scripts',
    title: 'Turn the identity into content cards.',
    subtitle: 'Create visual-first short-form cards with hook, script, shot prompt, caption, hashtags, and CTA.',
    command: 'Nexus, create 7 short-form script cards using this personality and selected visual identity.',
    prompt: 'Create a 30-day short-form content strategy with viral hooks, emotionally engaging scripts, relatable moments, captions, hashtags, and replay-focused formats.',
    script: 'You do not need a perfect morning. You need a first ten minutes that make the rest of the day easier.',
    primary: 'Save Script Card',
    primaryAction: 'save-script',
    secondary: 'Regenerate Hook',
  },
  {
    id: 'deals',
    icon: '$',
    label: 'Deals',
    title: 'Monetize without damaging trust.',
    subtitle: 'Map affiliate products, digital offers, sponsor categories, placement scenes, and unsent outreach drafts.',
    command: 'Nexus, create a monetization strategy with affiliate products, digital products, sponsor targets, product placements, and outreach drafts.',
    prompt: 'Identify affiliate products, digital products, sponsorship opportunities, brand deal outreach strategies, viral product placements, and conversion-focused content ideas.',
    script: 'I create visual lifestyle content for an audience that responds to polished routines, useful products, and transparent recommendations.',
    primary: 'Save Brand Kit',
    primaryAction: 'save-deals',
    secondary: 'Draft Pitch',
  },
  {
    id: 'assets',
    icon: 'S',
    label: 'Assets',
    title: 'Keep every output reusable.',
    subtitle: 'Collect identity, looks, prompts, HeyGen briefs, scripts, captions, deal drafts, and daily outputs.',
    command: 'Nexus, save this influencer project as a reusable asset library with identity, looks, scripts, HeyGen briefs, and prompt packs.',
    prompt: 'Create a durable asset library for this AI influencer project with folders for identity, image looks, video briefs, scripts, captions, monetization, and daily drafts.',
    script: 'Every new image, script, video brief, or monetization draft should point back to the identity bible and selected look.',
    primary: 'Export Project Brief',
    primaryAction: 'save-project',
    secondary: 'Open Latest',
  },
  {
    id: 'runs',
    icon: 'R',
    label: 'Runs',
    title: 'Automate drafts, not public actions.',
    subtitle: 'Daily runs create ideas, scripts, prompts, captions, and notes. Posting and paid jobs still require approval.',
    command: 'Nexus, schedule daily draft creation for this influencer, but do not post, publish, or create paid media without approval.',
    prompt: 'Build a draft-only daily workflow that generates content ideas, scripts, AI image and video prompts, captions, hashtags, performance notes, and future optimizations.',
    script: 'Draft package ready: 3 ideas, 1 script, 1 visual prompt, caption set, hashtag set, and suggested posting time.',
    primary: 'Run Daily Draft',
    primaryAction: 'daily-run',
    secondary: 'Toggle Drafts',
  },
];

const INFLUENCER_LOOKS = [
  'Street portrait',
  'Studio clean',
  'Morning reset',
  'Product soft sell',
  'Travel diary',
  'Mirror selfie',
  'Full-body fit',
  'Talking-head crop',
];

function InfluencerStudioPanel(props: {
  currentSessionId: string | null;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
}): React.ReactElement {
  const nexus = window.nexus;
  const [activeStep, setActiveStep] = useState<InfluencerStudioStep>('bible');
  const [projectName, setProjectName] = useState('Luna Vale');
  const [niche, setNiche] = useState('modern luxury wellness');
  const [selectedLook, setSelectedLook] = useState(0);
  const [style, setStyle] = useState('Modern luxury');
  const [scene, setScene] = useState('Luxury street');
  const [shot, setShot] = useState('Portrait');
  const [prompt, setPrompt] = useState(INFLUENCER_STUDIO_STEPS[0].prompt);
  const [script, setScript] = useState(INFLUENCER_STUDIO_STEPS[0].script);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState('Ready to build the first influencer project.');
  const [errorMessage, setErrorMessage] = useState('');
  const [automationOn, setAutomationOn] = useState(false);
  const [heyGenApproved, setHeyGenApproved] = useState(false);
  const [lastArtifact, setLastArtifact] = useState<any>(null);
  const [lastImage, setLastImage] = useState<any>(null);
  const [heyGenResult, setHeyGenResult] = useState<any>(null);

  const step = useMemo(
    () => INFLUENCER_STUDIO_STEPS.find((candidate) => candidate.id === activeStep) || INFLUENCER_STUDIO_STEPS[0],
    [activeStep],
  );

  const assetRows = useMemo(() => [
    { type: 'ID', title: 'avatar-identity-bible.md', detail: 'Face, texture, style, negative prompts', status: activeStep === 'bible' ? 'editing' : 'ready' },
    { type: 'IMG', title: INFLUENCER_LOOKS[selectedLook], detail: `${style} / ${scene} / ${shot}`, status: lastImage?.path ? 'generated' : 'draft' },
    { type: 'VID', title: 'heygen-intro-brief.md', detail: heyGenApproved ? 'Approved for final generation' : 'Staged, needs approval', status: heyGenResult?.videoId ? 'submitted' : 'gated' },
    { type: 'TXT', title: 'content-card-day-01.md', detail: 'Hook, script, caption, hashtags', status: activeStep === 'scripts' ? 'editing' : 'draft' },
  ], [activeStep, heyGenApproved, heyGenResult?.videoId, lastImage?.path, scene, selectedLook, shot, style]);

  const buildProjectMarkdown = useCallback((title: string): string => [
    `# ${title}`,
    '',
    `Project: ${projectName}`,
    `Niche: ${niche}`,
    `Active step: ${step.label}`,
    `Selected look: ${INFLUENCER_LOOKS[selectedLook]}`,
    `Style: ${style}`,
    `Scene: ${scene}`,
    `Shot: ${shot}`,
    `Automation: ${automationOn ? 'daily drafts on' : 'daily drafts off'}`,
    `HeyGen approval: ${heyGenApproved ? 'approved by user' : 'not approved'}`,
    '',
    '## Nexus Command',
    step.command,
    '',
    '## Current Prompt',
    prompt,
    '',
    '## Current Script',
    script,
    '',
    '## Production Rules',
    '- Preserve the locked face and age range across all generated images and videos.',
    '- Keep all public posting, brand outreach, paid media generation, and scheduling approval-gated.',
    '- Clearly disclose that the account is AI-generated where relevant, especially for sponsored content.',
    '- Save durable artifacts instead of relying on transient chat output.',
  ].join('\n'), [automationOn, heyGenApproved, niche, projectName, prompt, scene, script, selectedLook, shot, step.command, step.label, style]);

  const runWithStatus = useCallback(async (action: string, runner: () => Promise<void>) => {
    setBusyAction(action);
    setErrorMessage('');
    try {
      await runner();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || 'Unknown error'));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const saveArtifact = useCallback(async (title: string, content?: string) => {
    const artifact = await nexus.artifacts.materializeText(
      props.currentSessionId || undefined,
      title,
      content || buildProjectMarkdown(title),
      'influencer-studio',
    );
    setLastArtifact(artifact);
    setNotice(`Saved ${artifact.name || artifact.title || title}.`);
  }, [buildProjectMarkdown, nexus.artifacts, props.currentSessionId]);

  const handleStepChange = useCallback((nextStep: InfluencerStudioStep) => {
    const next = INFLUENCER_STUDIO_STEPS.find((candidate) => candidate.id === nextStep);
    if (!next) {
      return;
    }
    setActiveStep(nextStep);
    setPrompt(next.prompt);
    setScript(next.script);
    setNotice(`Loaded ${next.label}: ${next.command}`);
  }, []);

  const handleStageAssistedPrompt = useCallback(() => runWithStatus('assist', async () => {
    const target = activeStep === 'video' ? 'heygen_video' : activeStep === 'runs' ? 'grok_video' : 'grok_image';
    const result = await nexus.marketing.generateAssistedPrompt({
      target,
      brand: projectName,
      audience: `${niche} Instagram and TikTok followers`,
      tone: style,
      existingPrompt: prompt,
      brief: `${step.command}\n\nCurrent script: ${script}`,
    });
    if (result?.prompt) {
      if (target === 'heygen_video') {
        setScript(String(result.prompt));
      } else {
        setPrompt(String(result.prompt));
      }
      setNotice(`Assisted ${target.replace(/_/g, ' ')} draft updated.`);
    } else {
      setNotice('Assisted prompt request finished, but no prompt text was returned.');
    }
  }), [activeStep, nexus.marketing, niche, projectName, prompt, runWithStatus, script, step.command, style]);

  const handleCreateGrokImage = useCallback(() => runWithStatus('image', async () => {
    const result = await nexus.marketing.createGrokImage({
      title: `${projectName} ${INFLUENCER_LOOKS[selectedLook]}`,
      prompt,
      aspectRatio: '9:16',
      resolution: '1024x1792',
    });
    setLastImage(result);
    setNotice(result?.path ? `Generated image saved to ${result.path}` : 'Image generation completed.');
  }), [nexus.marketing, projectName, prompt, runWithStatus, selectedLook]);

  const handleStageHeyGenBrief = useCallback(() => runWithStatus('stage-heygen', async () => {
    await saveArtifact('heygen-intro-brief', [
      '# HeyGen Intro Brief',
      '',
      `Project: ${projectName}`,
      `Selected look: ${INFLUENCER_LOOKS[selectedLook]}`,
      `Scene: ${scene}`,
      `Style: ${style}`,
      '',
      '## Script',
      script,
      '',
      '## Storyboard',
      '1. Hook: close-camera eye contact and one clear opening line.',
      '2. Body: routine, product, or lifestyle moment matched to the selected look.',
      '3. CTA: save, comment, follow, or watch the next part.',
      '',
      '## Approval Gate',
      'Do not submit the final HeyGen job until the user clicks Approve final HeyGen job.',
    ].join('\n'));
    setNotice('HeyGen brief staged as an artifact. Final generation is still gated.');
  }), [projectName, saveArtifact, scene, script, selectedLook, style]);

  const handleCreateHeyGenVideo = useCallback(() => runWithStatus('heygen', async () => {
    if (!heyGenApproved) {
      setErrorMessage('Approve the final HeyGen job first. This prevents accidental paid generation.');
      return;
    }
    const result = await nexus.marketing.createHeyGenVideo({
      title: `${projectName} intro video`,
      script,
      caption: true,
    });
    setHeyGenResult(result);
    setNotice(result?.videoId ? `Submitted HeyGen video ${result.videoId}.` : 'HeyGen video request submitted.');
  }), [heyGenApproved, nexus.marketing, projectName, runWithStatus, script]);

  const handlePrimaryAction = useCallback(() => {
    switch (step.primaryAction) {
      case 'create-image':
        void handleCreateGrokImage();
        break;
      case 'stage-heygen':
        void handleStageHeyGenBrief();
        break;
      case 'daily-run':
        void runWithStatus('daily-run', async () => {
          await saveArtifact('influencer-daily-draft-package', buildProjectMarkdown('Influencer Daily Draft Package'));
          setNotice('Daily draft package saved. Nothing was posted or submitted.');
        });
        break;
      default:
        void runWithStatus('save', () => saveArtifact(`${projectName}-${step.id}`));
        break;
    }
  }, [buildProjectMarkdown, handleCreateGrokImage, handleStageHeyGenBrief, projectName, runWithStatus, saveArtifact, step.id, step.primaryAction]);

  return (
    <div className="next-influencer-studio">
      <div className="next-influencer-hero">
        <div>
          <div className="next-panel-label">Influencer Builder</div>
          <h2>{step.title}</h2>
          <p>{step.subtitle}</p>
        </div>
        <div className="next-influencer-project-fields">
          <label>
            <span>Project</span>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          </label>
          <label>
            <span>Niche</span>
            <input value={niche} onChange={(event) => setNiche(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="next-influencer-shell">
        <nav className="next-influencer-steps" aria-label="Influencer creation steps">
          {INFLUENCER_STUDIO_STEPS.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={`next-influencer-step${candidate.id === activeStep ? ' is-active' : ''}`}
              onClick={() => handleStepChange(candidate.id)}
            >
              <span>{candidate.icon}</span>
              <strong>{candidate.label}</strong>
            </button>
          ))}
        </nav>

        <section className="next-influencer-canvas" aria-label="Influencer visual canvas">
          <div className="next-influencer-preview">
            <div className="next-influencer-video-pill">
              {heyGenResult?.videoId ? `HeyGen ${heyGenResult.videoId}` : heyGenApproved ? 'HeyGen approved' : 'HeyGen gated'}
            </div>
            <div className="next-influencer-portrait" aria-hidden="true">
              <div className="next-influencer-portrait-body" />
            </div>
            <div className="next-influencer-shot-label">
              <strong>{INFLUENCER_LOOKS[selectedLook]}</strong>
              <span>{style} / {scene} / {shot}</span>
            </div>
          </div>

          <div className="next-influencer-look-grid" aria-label="Generated look board">
            {INFLUENCER_LOOKS.map((look, index) => (
              <button
                type="button"
                key={look}
                className={`next-influencer-look${index === selectedLook ? ' is-selected' : ''}`}
                onClick={() => {
                  setSelectedLook(index);
                  setNotice(`${look} selected as the working look.`);
                }}
              >
                <span />
                <strong>{look}</strong>
              </button>
            ))}
          </div>

          <div className="next-influencer-command">
            <span>Say to Nexus</span>
            <code>{step.command}</code>
          </div>

          <div className="next-influencer-pipeline" aria-label="Approval pipeline">
            {['Draft', 'Reviewed', 'Approved', 'Generated', 'Scheduled'].map((label, index) => (
              <div className={index === 0 || (index === 2 && heyGenApproved) ? 'is-active' : ''} key={label}>
                <strong>{label}</strong>
                <span>{index === 2 ? 'User gate' : index === 4 ? 'Manual only' : 'Visible state'}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="next-influencer-editor" aria-label="Influencer editing controls">
          <div className="next-influencer-notice">
            <strong>{busyAction ? 'Working...' : 'Status'}</strong>
            <span>{notice}</span>
          </div>
          {errorMessage ? <div className="next-error-copy">{errorMessage}</div> : null}

          <div className="next-influencer-control">
            <h3>Core Edits</h3>
            <div className="next-influencer-chip-row">
              {['Modern luxury', 'Beauty founder', 'Fitness lifestyle', 'Travel diary'].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={value === style ? 'is-active' : ''}
                  onClick={() => setStyle(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="next-influencer-field-grid">
              <label>
                <span>Scene</span>
                <select value={scene} onChange={(event) => setScene(event.target.value)}>
                  <option>Luxury street</option>
                  <option>Clean studio</option>
                  <option>Morning routine</option>
                  <option>Hotel lobby</option>
                  <option>Product shelf</option>
                </select>
              </label>
              <label>
                <span>Shot</span>
                <select value={shot} onChange={(event) => setShot(event.target.value)}>
                  <option>Portrait</option>
                  <option>Selfie</option>
                  <option>Full body</option>
                  <option>Talking head</option>
                  <option>Product placement</option>
                </select>
              </label>
            </div>
          </div>

          <div className="next-influencer-control">
            <h3>Prompt</h3>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <div className="next-influencer-action-row">
              <button type="button" className="next-detail-toggle" onClick={handleStageAssistedPrompt} disabled={Boolean(busyAction)}>
                {step.secondary}
              </button>
              <button type="button" className="next-detail-toggle" onClick={handlePrimaryAction} disabled={Boolean(busyAction)}>
                {step.primary}
              </button>
            </div>
          </div>

          <div className="next-influencer-control">
            <h3>HeyGen Script</h3>
            <textarea value={script} onChange={(event) => setScript(event.target.value)} />
            <div className="next-influencer-storyboard">
              <div><strong>Hook</strong><span>Close-camera opening.</span></div>
              <div><strong>Body</strong><span>Routine or product beat.</span></div>
              <div><strong>CTA</strong><span>Save, comment, follow.</span></div>
            </div>
            <div className="next-influencer-action-row">
              <button type="button" className="next-detail-toggle" onClick={handleStageHeyGenBrief} disabled={Boolean(busyAction)}>
                Stage HeyGen Brief
              </button>
              <button
                type="button"
                className={`next-detail-toggle${heyGenApproved ? ' is-active' : ''}`}
                onClick={() => {
                  setHeyGenApproved(true);
                  setNotice('Final HeyGen job approved. You can now submit it if profiles are configured.');
                }}
              >
                Approve final HeyGen job
              </button>
              <button type="button" className="next-detail-toggle next-detail-toggle--panel" onClick={handleCreateHeyGenVideo} disabled={Boolean(busyAction)}>
                Submit HeyGen
              </button>
            </div>
          </div>

          <div className="next-influencer-control">
            <h3>Assets</h3>
            <div className="next-influencer-asset-list">
              {assetRows.map((asset) => (
                <div className="next-influencer-asset" key={`${asset.type}-${asset.title}`}>
                  <span>{asset.type}</span>
                  <div>
                    <strong>{asset.title}</strong>
                    <small>{asset.detail}</small>
                  </div>
                  <em>{asset.status}</em>
                </div>
              ))}
            </div>
            <div className="next-influencer-action-row">
              <button type="button" className="next-detail-toggle" onClick={() => void runWithStatus('save', () => saveArtifact(`${projectName}-influencer-studio`))} disabled={Boolean(busyAction)}>
                Save Project Artifact
              </button>
              <button
                type="button"
                className="next-detail-toggle"
                disabled={!lastArtifact?.path}
                onClick={() => lastArtifact?.path ? void props.onOpenArtifact(String(lastArtifact.path), 'workstation') : undefined}
              >
                Open Latest
              </button>
              <button
                type="button"
                className={`next-detail-toggle${automationOn ? ' is-active' : ''}`}
                onClick={() => {
                  setAutomationOn((value) => !value);
                  setNotice(automationOn ? 'Daily draft automation turned off.' : 'Daily draft automation turned on. Drafts only, no public actions.');
                }}
              >
                {automationOn ? 'Daily Drafts On' : 'Daily Drafts Off'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

type HtmlStudioTemplateId = 'idea-map' | 'presentation' | 'one-page-brief' | 'workflow-board';

interface HtmlStudioTemplate {
  id: HtmlStudioTemplateId;
  label: string;
  title: string;
  headline: string;
  audience: string;
  sections: string;
  notes: string;
  cta: string;
  accent: string;
}

const HTML_STUDIO_TEMPLATES: HtmlStudioTemplate[] = [
  {
    id: 'idea-map',
    label: 'Idea Map',
    title: 'Nexus Idea Map',
    headline: 'Organize the signal into one clear map.',
    audience: 'Internal team and collaborators',
    sections: [
      'Core idea: What this is and why it matters',
      'Evidence: Signals, examples, files, and observations',
      'Connections: Related products, workflows, and people',
      'Open questions: What needs a decision',
      'Next moves: What should happen first',
    ].join('\n'),
    notes: 'Use this when the idea is still forming and needs structure before it becomes a document, task list, or pitch.',
    cta: 'Review the map and choose the next concrete move.',
    accent: '#f59e0b',
  },
  {
    id: 'presentation',
    label: 'Presentation',
    title: 'Nexus Presentation',
    headline: 'Turn the current thinking into a room-ready presentation.',
    audience: 'Prospects, partners, operators, or advisors',
    sections: [
      'Slide 1: The current problem',
      'Slide 2: The Nexus approach',
      'Slide 3: What changes for the user',
      'Slide 4: Proof, workflow, or demo path',
      'Slide 5: Decision and next step',
    ].join('\n'),
    notes: 'Each line becomes a slide-style panel. Keep each slide focused on one point.',
    cta: 'Use this HTML as a live briefing page or presentation handoff.',
    accent: '#38bdf8',
  },
  {
    id: 'one-page-brief',
    label: 'Brief',
    title: 'Nexus One Page Brief',
    headline: 'Communicate the point without burying the decision.',
    audience: 'Decision maker',
    sections: [
      'Context: What changed',
      'Recommendation: What Nexus should do',
      'Reasoning: Why this path is stronger',
      'Risks: What can break or confuse the user',
      'Decision needed: The specific yes/no or next action',
    ].join('\n'),
    notes: 'Best for concise communication after research, calls, meetings, or product direction changes.',
    cta: 'Approve, revise, or assign the next action.',
    accent: '#22c55e',
  },
  {
    id: 'workflow-board',
    label: 'Workflow',
    title: 'Nexus Workflow Board',
    headline: 'Make the work visible so the next step is obvious.',
    audience: 'Operator workspace',
    sections: [
      'Now: The active task',
      'Next: The next visible action',
      'Waiting: Inputs, approvals, or missing info',
      'Artifacts: Files, HTML pages, decks, or outputs',
      'Done: What can be trusted and reused',
    ].join('\n'),
    notes: 'Use this for product workflows like Emergent Marketing, Land Grabber, research projects, and launch planning.',
    cta: 'Move one item from Next into Now.',
    accent: '#a78bfa',
  },
];

function escapeHtmlStudioText(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitHtmlStudioLines(value: string): string[] {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildHtmlStudioDocument(input: {
  templateId: HtmlStudioTemplateId;
  title: string;
  headline: string;
  audience: string;
  sections: string;
  notes: string;
  cta: string;
  accent: string;
}): string {
  const title = escapeHtmlStudioText(input.title || 'Nexus HTML');
  const headline = escapeHtmlStudioText(input.headline || input.title || 'Nexus HTML');
  const audience = escapeHtmlStudioText(input.audience || 'Nexus workspace');
  const notes = escapeHtmlStudioText(input.notes || '');
  const cta = escapeHtmlStudioText(input.cta || 'Review and decide the next action.');
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : '#f59e0b';
  const sectionLines = splitHtmlStudioLines(input.sections);
  const sectionMarkup = sectionLines.length
    ? sectionLines.map((line, index) => {
      const [rawLabel, ...rest] = line.split(':');
      const label = rest.length ? rawLabel.trim() : `Section ${index + 1}`;
      const body = rest.length ? rest.join(':').trim() : line;
      return [
        '<article class="nexus-card">',
        `  <div class="nexus-card-index">${String(index + 1).padStart(2, '0')}</div>`,
        `  <h2>${escapeHtmlStudioText(label)}</h2>`,
        `  <p>${escapeHtmlStudioText(body)}</p>`,
        '</article>',
      ].join('\n');
    }).join('\n')
    : '<article class="nexus-card"><div class="nexus-card-index">01</div><h2>Start Here</h2><p>Add sections in Nexus Next, then save the HTML again.</p></article>';

  const generatedAt = new Date().toLocaleString();
  const modeLabel = input.templateId.replace(/-/g, ' ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      --accent: ${accent};
      --ink: #171717;
      --muted: #5f6673;
      --line: #dfe4ea;
      --paper: #fffaf2;
      --card: #ffffff;
      --dark: #111827;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--paper);
      font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 40px 0 56px;
    }
    header {
      min-height: 340px;
      display: grid;
      align-content: end;
      gap: 20px;
      padding: 36px;
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(255,255,255,.92), rgba(255,255,255,.68)),
        linear-gradient(135deg, var(--accent), #111827);
      border: 1px solid rgba(17, 24, 39, .12);
      box-shadow: 0 20px 70px rgba(17, 24, 39, .14);
    }
    .eyebrow {
      width: fit-content;
      padding: 7px 11px;
      border: 1px solid rgba(17, 24, 39, .14);
      border-radius: 999px;
      background: rgba(255,255,255,.68);
      color: var(--dark);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    h1 {
      max-width: 840px;
      margin: 0;
      font-size: clamp(34px, 7vw, 76px);
      line-height: .95;
      letter-spacing: 0;
    }
    .hero-copy {
      max-width: 720px;
      margin: 0;
      color: #303642;
      font-size: 19px;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }
    .meta-row span {
      padding: 8px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.72);
      border: 1px solid rgba(17, 24, 39, .1);
      font-size: 13px;
      color: #2f3540;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    .nexus-card,
    .notes {
      position: relative;
      min-height: 190px;
      padding: 22px;
      border-radius: 8px;
      background: var(--card);
      border: 1px solid var(--line);
      box-shadow: 0 12px 30px rgba(17, 24, 39, .08);
    }
    .nexus-card-index {
      color: var(--accent);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      margin-bottom: 22px;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 24px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .notes {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
      gap: 18px;
      align-items: start;
      background: #111827;
      color: #f8fafc;
      border-color: rgba(255,255,255,.12);
    }
    .notes p { color: #d7dde6; }
    .next-action {
      padding: 18px;
      border-radius: 8px;
      background: var(--accent);
      color: #111827;
      font-weight: 800;
    }
    footer {
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 760px) {
      main { width: min(100vw - 20px, 1120px); padding-top: 10px; }
      header { min-height: 280px; padding: 24px; }
      .grid,
      .notes { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">Nexus HTML / ${escapeHtmlStudioText(modeLabel)}</div>
      <h1>${title}</h1>
      <p class="hero-copy">${headline}</p>
      <div class="meta-row">
        <span>Audience: ${audience}</span>
        <span>Generated: ${escapeHtmlStudioText(generatedAt)}</span>
        <span>Source: EIG Nexus Next</span>
      </div>
    </header>
    <section class="grid">
${sectionMarkup}
      <article class="notes">
        <div>
          <h2>Operating Notes</h2>
          <p>${notes}</p>
        </div>
        <div class="next-action">${cta}</div>
      </article>
    </section>
    <footer>Saved by EIG Nexus Next HTML Studio.</footer>
  </main>
</body>
</html>`;
}

function HtmlStudioPanel(props: {
  currentSessionId: string | null;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onRefreshWorkspaceFiles: () => Promise<void> | void;
}): React.ReactElement {
  const nexus = window.nexus;
  const [templateId, setTemplateId] = useState<HtmlStudioTemplateId>('idea-map');
  const initialTemplate = HTML_STUDIO_TEMPLATES[0];
  const [title, setTitle] = useState(initialTemplate.title);
  const [headline, setHeadline] = useState(initialTemplate.headline);
  const [audience, setAudience] = useState(initialTemplate.audience);
  const [sections, setSections] = useState(initialTemplate.sections);
  const [notes, setNotes] = useState(initialTemplate.notes);
  const [cta, setCta] = useState(initialTemplate.cta);
  const [accent, setAccent] = useState(initialTemplate.accent);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Choose a template, edit the sections, then save a real HTML artifact.');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastArtifact, setLastArtifact] = useState<any>(null);

  const currentTemplate = useMemo(
    () => HTML_STUDIO_TEMPLATES.find((template) => template.id === templateId) || HTML_STUDIO_TEMPLATES[0],
    [templateId],
  );

  const htmlDocument = useMemo(() => buildHtmlStudioDocument({
    templateId,
    title,
    headline,
    audience,
    sections,
    notes,
    cta,
    accent,
  }), [accent, audience, cta, headline, notes, sections, templateId, title]);

  const applyTemplate = useCallback((template: HtmlStudioTemplate) => {
    setTemplateId(template.id);
    setTitle(template.title);
    setHeadline(template.headline);
    setAudience(template.audience);
    setSections(template.sections);
    setNotes(template.notes);
    setCta(template.cta);
    setAccent(template.accent);
    setStatus(`${template.label} template loaded.`);
    setErrorMessage('');
  }, []);

  const saveHtml = useCallback(async (openAfterSave: boolean) => {
    setBusy(true);
    setErrorMessage('');
    try {
      const artifact = await nexus.artifacts.materializeHtml(
        props.currentSessionId || undefined,
        title,
        htmlDocument,
        'html-studio',
      );
      setLastArtifact(artifact);
      await props.onRefreshWorkspaceFiles();
      setStatus(`Saved ${artifact.name || title}.`);
      if (openAfterSave && artifact?.path) {
        await props.onOpenArtifact(String(artifact.path), 'workstation');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  }, [htmlDocument, nexus.artifacts, props, title]);

  const copyHtml = useCallback(async () => {
    await nexus.clipboard.writeText(htmlDocument);
    setStatus('Copied the current HTML to the clipboard.');
  }, [htmlDocument, nexus.clipboard]);

  const lastPath = String(lastArtifact?.path || '').trim();

  return (
    <div className="next-html-studio">
      <div className="next-html-hero">
        <div>
          <div className="next-panel-label">HTML Studio</div>
          <h2>Make visible HTML for ideas, communication, and presentations.</h2>
          <p>
            Build standalone HTML pages that Nexus can save as durable artifacts, open in the workstation,
            and use as a clean way to organize thinking outside the chat stream.
          </p>
        </div>
        <div className="next-html-status">
          <strong>{busy ? 'Saving...' : 'Ready'}</strong>
          <span>{status}</span>
        </div>
      </div>

      {errorMessage ? <div className="next-error-copy">{errorMessage}</div> : null}

      <div className="next-html-layout">
        <section className="next-html-controls" aria-label="HTML creation controls">
          <div className="next-html-template-row">
            {HTML_STUDIO_TEMPLATES.map((template) => (
              <button
                type="button"
                key={template.id}
                className={`next-html-template${template.id === templateId ? ' is-active' : ''}`}
                onClick={() => applyTemplate(template)}
              >
                <strong>{template.label}</strong>
                <span>{template.title}</span>
              </button>
            ))}
          </div>

          <div className="next-html-field-grid">
            <label>
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>Audience</span>
              <input value={audience} onChange={(event) => setAudience(event.target.value)} />
            </label>
            <label>
              <span>Accent</span>
              <input value={accent} onChange={(event) => setAccent(event.target.value)} />
            </label>
            <label>
              <span>Template</span>
              <input value={currentTemplate.label} readOnly />
            </label>
          </div>

          <label className="next-html-wide-field">
            <span>Headline</span>
            <input value={headline} onChange={(event) => setHeadline(event.target.value)} />
          </label>

          <label className="next-html-wide-field">
            <span>Sections</span>
            <textarea value={sections} onChange={(event) => setSections(event.target.value)} rows={8} />
          </label>

          <label className="next-html-wide-field">
            <span>Operating Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
          </label>

          <label className="next-html-wide-field">
            <span>Next Action</span>
            <input value={cta} onChange={(event) => setCta(event.target.value)} />
          </label>

          <div className="next-html-actions">
            <button type="button" className="next-detail-toggle next-detail-toggle--panel" disabled={busy} onClick={() => void saveHtml(true)}>
              Save HTML
            </button>
            <button type="button" className="next-detail-toggle" disabled={busy} onClick={() => void saveHtml(false)}>
              Save Only
            </button>
            <button type="button" className="next-detail-toggle" onClick={() => void copyHtml()}>
              Copy HTML
            </button>
            <button
              type="button"
              className="next-detail-toggle"
              disabled={!lastPath}
              onClick={() => lastPath ? void nexus.artifacts.open(lastPath) : undefined}
            >
              Open File
            </button>
          </div>
          {lastPath ? <div className="next-html-path">{lastPath}</div> : null}
        </section>

        <section className="next-html-preview-shell" aria-label="HTML live preview">
          <div className="next-html-preview-top">
            <strong>Live Preview</strong>
            <span>{splitHtmlStudioLines(sections).length} sections</span>
          </div>
          <iframe title="HTML Studio Preview" className="next-html-preview" srcDoc={htmlDocument} />
        </section>
      </div>
    </div>
  );
}

function WorkstationPanelStage(props: {
  kind: HeaderPanelKind;
  data: any;
  loading: boolean;
  currentSessionId: string | null;
  initialDiaryReaderId?: string | null;
  onClose: () => void;
  onOpenEntity: (entityType: 'person' | 'business', entityId: string) => void;
  onSearchEntity: (query: string) => void;
  onOpenKnowledgeDocument: (documentId: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onAskEntity: (
    entityType: 'person' | 'business',
    entityId: string,
    question: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<any>;
  onRefreshWorkspaceFiles: () => Promise<void> | void;
  onCreateSessionDiary: () => Promise<void>;
  onCommentDiaryEntry: (entryId: string, comment: string) => Promise<void>;
  onOpenKnowledgeBase: () => void;
  onSyncKnowledgeGraph: () => Promise<any>;
}): React.ReactElement | null {
  if (!props.kind) {
    return null;
  }

  const titleMap: Record<Exclude<HeaderPanelKind, null>, string> = {
    diary: 'Diary',
    statistics: 'Statistics',
    'task-queue': 'Task Queue',
    'entity-crm': 'Entity CRM',
    research: 'Research Department',
    'influencer-studio': 'Influencer Studio',
    'html-studio': 'HTML Studio',
    bugs: 'Bugs',
    settings: 'Settings',
    info: 'About Nexus Next',
    marketing: 'Marketing Department',
    'contract-drafting': 'Contract Drafting',
    'private-profile': 'Secure Profile & Vault',
  };

  return (
    <div className="next-stage-scroll">
      <div className="next-panel-stage">
        {props.loading ? (
          <div className="next-empty-inline">Loading…</div>
        ) : props.kind === 'info' ? (

        <div className="next-info-stack">
          <p>
            Nexus Next is the parallel presentation-first shell. It keeps the existing backend, tools,
            sessions, knowledge, legal review, media, and artifact systems intact while giving AI Focus
            its own stage.
          </p>
          <ul>
            <li>`Chat` remains the full conversation surface.</li>
            <li>`AI Focus` is agent-owned and should retarget live.</li>
            <li>`Workstation` is user-owned for manual review and operation.</li>
            <li>`Knowledge Base` is the graph surface for exploration and presentation.</li>
          </ul>
        </div>
      ) : props.kind === 'diary' ? (
        <DiaryWorkbenchPanel
          data={props.data}
          currentSessionId={props.currentSessionId}
          onCreateSessionDiary={props.onCreateSessionDiary}
          onCommentDiaryEntry={props.onCommentDiaryEntry}
          initialSelectedReaderId={props.initialDiaryReaderId}
        />
      ) : props.kind === 'statistics' ? (
        <StatisticsWorkbenchPanel data={props.data} />
      ) : props.kind === 'task-queue' ? (
        <TaskQueueWorkbenchPanel data={props.data} />
      ) : props.kind === 'entity-crm' ? (
        <EntityCrmOverlay
          data={props.data}
          onOpenEntity={props.onOpenEntity}
          onSearch={props.onSearchEntity}
          onOpenKnowledgeDocument={props.onOpenKnowledgeDocument}
          onOpenArtifact={props.onOpenArtifact}
          onAskEntity={props.onAskEntity}
        />
      ) : props.kind === 'research' ? (
        <ResearchDepartmentPanel
          currentSessionId={props.currentSessionId}
          onOpenArtifact={props.onOpenArtifact}
          onOpenKnowledgeBase={props.onOpenKnowledgeBase}
          onSyncKnowledgeGraph={props.onSyncKnowledgeGraph}
        />
      ) : props.kind === 'influencer-studio' ? (
        <InfluencerStudioPanel
          currentSessionId={props.currentSessionId}
          onOpenArtifact={props.onOpenArtifact}
        />
      ) : props.kind === 'html-studio' ? (
        <HtmlStudioPanel
          currentSessionId={props.currentSessionId}
          onOpenArtifact={props.onOpenArtifact}
          onRefreshWorkspaceFiles={props.onRefreshWorkspaceFiles}
        />
      ) : props.kind === 'contract-drafting' ? (
        <ContractDraftingPanel
          currentSessionId={props.currentSessionId}
          onOpenArtifact={props.onOpenArtifact}
          onRefreshWorkspaceFiles={props.onRefreshWorkspaceFiles}
        />
      ) : props.kind === 'private-profile' ? (
        <PrivateProfilePanel />
      ) : props.kind === 'marketing' ? (
        <MarketingWorkbenchPanel onClose={props.onClose} />
      ) : props.kind === 'bugs' ? (
        <BugsWorkbenchPanel
          data={props.data}
          currentSessionId={props.currentSessionId}
          onOpenArtifact={props.onOpenArtifact}
        />
      ) : props.kind === 'settings' ? (
        <SettingsWorkbenchPanel />
      ) : (
        <JsonBlock value={props.data} />
      )}
      </div>
    </div>
  );
}

export default function NextApp(): React.ReactElement {
  const nexus = window.nexus;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const focusStageMotionRef = useRef<HTMLDivElement | null>(null);
  const workstationStageMotionRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<MessageRecord[]>([]);
  const chatTimelineRef = useRef<HTMLDivElement | null>(null);
  const focusEventsRef = useRef<FocusEventRecord[]>([]);
  const workspaceFilesRef = useRef<any[]>([]);
  const focusStageRef = useRef<StageState>(DEFAULT_ACTIVITY_STAGE);
  const workstationStageRef = useRef<StageState>(DEFAULT_WORKSTATION_STAGE);
  const currentSessionRef = useRef<SessionRecord | null>(null);
  const startConversationRef = useRef<((options?: VoiceStartOptions) => Promise<void>) | null>(null);
  const voiceRecoveryRef = useRef<{
    manualStop: boolean;
    autoResumeAttempts: number;
    scheduledResumeTimer: number | null;
    recovering: boolean;
    hiddenResumePrompt: string;
    lastToolName: string;
    lastToolSummary: string;
    lastToolMeta: string;
    lastArtifactPath: string;
    lastArtifactName: string;
  }>({
    manualStop: false,
    autoResumeAttempts: 0,
    scheduledResumeTimer: null,
    recovering: false,
    hiddenResumePrompt: '',
    lastToolName: '',
    lastToolSummary: '',
    lastToolMeta: '',
    lastArtifactPath: '',
    lastArtifactName: '',
  });

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [composer, setComposer] = useState('');
  const [activeTab, setActiveTab] = useState<SurfaceTab>('ai-focus');
  const [dockMode, setDockMode] = useState<DockMode>('full');
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [expandedMessageDetails, setExpandedMessageDetails] = useState<Record<string, boolean>>({});

  const [voiceSummary, setVoiceSummary] = useState('Maintaining live AI Focus while keeping chat and workstation separate.');
  const [voiceMeta, setVoiceMeta] = useState('The mic tile is persistent and the center viewer should keep morphing to match the current task.');

  const [focusStage, setFocusStage] = useState<StageState>(DEFAULT_ACTIVITY_STAGE);
  const [workstationStage, setWorkstationStage] = useState<StageState>(DEFAULT_WORKSTATION_STAGE);
  const [focusEvents, setFocusEvents] = useState<FocusEventRecord[]>([]);
  const [workTraceEvents, setWorkTraceEvents] = useState<WorkTraceEvent[]>([]);
  const [sessionRuntime, setSessionRuntime] = useState<SessionRuntimeState | null>(null);
  const [diaryPreviewData, setDiaryPreviewData] = useState<{ entries: any[]; narratives: any[] }>({ entries: [], narratives: [] });
  const [diaryReaderTargetId, setDiaryReaderTargetId] = useState<string | null>(null);

  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<any[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStatsPayload>(DEFAULT_KNOWLEDGE_STATS);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeResults, setKnowledgeResults] = useState<any>(null);
  const [selectedKnowledgeCluster, setSelectedKnowledgeCluster] = useState('documents');
  const [knowledgeGraphBusy, setKnowledgeGraphBusy] = useState('');
  const [understandStatus, setUnderstandStatus] = useState<any>(null);
  const [understandBusyAction, setUnderstandBusyAction] = useState('');
  const [understandMessage, setUnderstandMessage] = useState('Code graph not checked yet.');

  const [webQuery, setWebQuery] = useState('');
  const [webResults, setWebResults] = useState<any[]>([]);
  const [webLoading, setWebLoading] = useState(false);
  const [legalUrl, setLegalUrl] = useState('');
  const [legalBusy, setLegalBusy] = useState(false);
  const [workspaceFileLoadingPath, setWorkspaceFileLoadingPath] = useState<string | null>(null);
  const [outputShelfScope, setOutputShelfScope] = useState<'session' | 'all'>('session');
  const [knowledgeLoadingId, setKnowledgeLoadingId] = useState<string | null>(null);

  const [usageOverview, setUsageOverview] = useState<any>(null);
  const [entityCounts, setEntityCounts] = useState<{ people: number; businesses: number; links: number }>({
    people: 0,
    businesses: 0,
    links: 0,
  });
  const [crmPeople, setCrmPeople] = useState<any[]>([]);
  const [crmBusinesses, setCrmBusinesses] = useState<any[]>([]);
  const [mediaStatus, setMediaStatus] = useState<any>(null);
  const [currentProject, setCurrentProject] = useState<any>(null);

  const [headerPanel, setHeaderPanel] = useState<HeaderPanelKind>(null);
  const [headerPanelLoading, setHeaderPanelLoading] = useState(false);
  const [headerPanelData, setHeaderPanelData] = useState<any>(null);
  const [showMarketingDepartment, setShowMarketingDepartment] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('disconnected');
  const [conversationMode, setConversationMode] = useState<ConversationMode>('idle');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationErrorDetail, setConversationErrorDetail] = useState('');
  const [isVoiceMicMuted, setIsVoiceMicMuted] = useState(false);
  const conversationRef = useRef<any>(null);
  const voiceTextHandoffRef = useRef<VoiceTextHandoff[]>([]);
  const roomVideoRef = useRef<HTMLVideoElement | null>(null);
  const roomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const roomVisionStreamRef = useRef<MediaStream | null>(null);
  const gazeLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const gazeFrameRef = useRef<number | null>(null);
  const gazeScoreRef = useRef(0);
  const gazeStrictnessRef = useRef(0.52);
  const eyeContactModeRef = useRef(false);
  const gazeAppliedMuteRef = useRef(false);
  const lastGazeUiUpdateRef = useRef(0);
  const conversationStatusRef = useRef<ConversationStatus>('disconnected');
  const meetingModeActiveRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isBrainstormRecording, setIsBrainstormRecording] = useState(false);
  const [isBrainstormProcessing, setIsBrainstormProcessing] = useState(false);
  const [brainstormElapsedMs, setBrainstormElapsedMs] = useState(0);
  const brainstormRecorderRef = useRef<MediaRecorder | null>(null);
  const brainstormStreamRef = useRef<MediaStream | null>(null);
  const brainstormChunksRef = useRef<Blob[]>([]);
  const brainstormTimerRef = useRef<number | null>(null);
  const brainstormStartedAtRef = useRef<number | null>(null);
  const activeBrainstormIdRef = useRef<string | null>(null);
  const [roomVisionStatus, setRoomVisionStatus] = useState<RoomVisionStatus>('off');
  const [roomVisionError, setRoomVisionError] = useState('');
  const [roomVisionCameraLabel, setRoomVisionCameraLabel] = useState('Camera');
  const [latestRoomSnapshot, setLatestRoomSnapshot] = useState<RoomVisionSnapshot | null>(null);
  const [controlLayer, setControlLayer] = useState<ControlLayerState>({
    collaboration: false,
    eyeContact: false,
    handControl: false,
    browserControl: false,
    meetingMode: false,
    diagramCoEdit: false,
  });
  const [eyeContactStatus, setEyeContactStatus] = useState<EyeContactControlStatus>('off');
  const [gazeAssessment, setGazeAssessment] = useState<GazeAssessment>({
    looking: false,
    label: 'Off',
    reason: 'Eye contact mode is off',
    metrics: DEFAULT_GAZE_METRICS,
  });
  const [gazeStrictness, setGazeStrictness] = useState(0.52);
  const [controlBrowserQuery, setControlBrowserQuery] = useState('');
  const [browserControlStatus, setBrowserControlStatus] = useState('Browser control off');
  const [meetingControlStatus, setMeetingControlStatus] = useState('Meeting mode off');
  const [diagramControlPrompt, setDiagramControlPrompt] = useState('');
  const [diagramControlStatus, setDiagramControlStatus] = useState('Diagram co-edit off');
  const [controlLayerBusyAction, setControlLayerBusyAction] = useState('');

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || null,
    [sessions, currentSessionId],
  );

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'user') || null,
    [messages],
  );
  const lastAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => (
      message.role === 'assistant' && String(message.content || '').trim()
    )) || null,
    [messages],
  );
  const wonderings = useMemo(
    () => buildWonderings(
      diaryPreviewData.entries,
      diaryPreviewData.narratives,
      messages,
      focusEvents,
      focusStage,
      currentProject?.name || null,
      currentSession?.name || null,
    ),
    [currentProject?.name, currentSession?.name, diaryPreviewData.entries, diaryPreviewData.narratives, focusEvents, focusStage, messages],
  );
  const recentSignals = useMemo(
    () => [...focusEvents].reverse().slice(0, 4),
    [focusEvents],
  );
  const latestWorkTrace = useMemo(
    () => workTraceEvents[0] || null,
    [workTraceEvents],
  );
  const pulseMode = useMemo(
    () => derivePulseMode(conversationStatus, conversationMode, latestWorkTrace),
    [conversationMode, conversationStatus, latestWorkTrace],
  );
  const focusStageMotionKey = useMemo(
    () => `${activeTab === 'ai-focus' ? 'visible' : 'hidden'}|${buildStageMotionKey(focusStage)}`,
    [activeTab, focusStage],
  );
  const workstationStageMotionKey = useMemo(
    () => `${activeTab === 'workstation' ? 'visible' : 'hidden'}|${buildStageMotionKey(workstationStage)}`,
    [activeTab, workstationStage],
  );

  useStageSwapMotion(focusStageMotionRef, focusStageMotionKey, {
    childSelector: '.next-stage-close--floating, .next-stage-scroll, .next-browser-layout, .next-legal-layout, .next-stage-asset, .next-stage-frame, .next-diagram-stage, .next-inspection-layout, .next-workstation-panel, .next-graph-hub',
    childDelayStart: 84,
  });

  useStageSwapMotion(workstationStageMotionRef, workstationStageMotionKey, {
    childSelector: '.next-stage-toolbar, .next-workstation-preview, .next-workstation-files, .next-stage-scroll, .next-browser-layout, .next-legal-layout, .next-stage-asset, .next-stage-frame, .next-diagram-stage, .next-inspection-layout, .next-workstation-panel, .next-graph-hub',
    childDelayStart: 92,
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const host = chatTimelineRef.current;
    if (!host) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      host.scrollTo({
        top: host.scrollHeight,
        behavior: 'auto',
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [currentSessionId, messages.length]);

  useEffect(() => {
    focusEventsRef.current = focusEvents;
  }, [focusEvents]);

  useEffect(() => {
    workspaceFilesRef.current = workspaceFiles;
  }, [workspaceFiles]);

  useEffect(() => {
    setOutputShelfScope('session');
  }, [currentSessionId]);

  useEffect(() => {
    focusStageRef.current = focusStage;
  }, [focusStage]);

  useEffect(() => {
    workstationStageRef.current = workstationStage;
  }, [workstationStage]);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    conversationStatusRef.current = conversationStatus;
  }, [conversationStatus]);

  useEffect(() => {
    gazeStrictnessRef.current = gazeStrictness;
  }, [gazeStrictness]);

  useEffect(() => {
    const video = roomVideoRef.current;
    const stream = roomVisionStreamRef.current;
    if (!video || !stream || roomVisionStatus === 'off' || roomVisionStatus === 'error') {
      return;
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    void video.play().catch((error) => {
      console.warn('[NexusNext] room view camera preview failed to play', error);
    });
  }, [roomVisionStatus]);

  useEffect(() => () => {
    stopMediaStreamTracks(roomVisionStreamRef.current);
    roomVisionStreamRef.current = null;
    if (roomVideoRef.current) {
      roomVideoRef.current.srcObject = null;
    }
    if (gazeFrameRef.current !== null) {
      window.cancelAnimationFrame(gazeFrameRef.current);
      gazeFrameRef.current = null;
    }
    gazeLandmarkerRef.current?.close();
    gazeLandmarkerRef.current = null;
  }, []);

  useEffect(() => {
    let disposed = false;

    void nexus.settings.get(SETUP_WIZARD_COMPLETED_KEY).then((value: any) => {
      if (!disposed && String(value || '').trim().toLowerCase() !== 'true') {
        setShowSetupWizard(true);
      }
    }).catch(() => {
      if (!disposed) {
        setShowSetupWizard(true);
      }
    });

    return () => {
      disposed = true;
    };
  }, [nexus.settings]);

  useEffect(() => {
    if (!currentSessionId) {
      setSessionRuntime(null);
      return;
    }

    void nexus.settings.set('last_active_session_id', currentSessionId).catch(() => undefined);

    let disposed = false;
    void nexus.sessionRuntime.get(currentSessionId).then((state: any) => {
      if (disposed) {
        return;
      }
      setSessionRuntime(normalizeSessionRuntimeState(state, currentSessionId));
    }).catch(() => {
      if (!disposed) {
        setSessionRuntime(normalizeSessionRuntimeState(null, currentSessionId));
      }
    });

    return () => {
      disposed = true;
    };
  }, [currentSessionId, nexus.sessionRuntime, nexus.settings]);

  useEffect(() => {
    let disposed = false;

    void nexus.meetingMode.getState().then((state: any) => {
      if (disposed) {
        return;
      }
      const active = Boolean(state && state.status && state.status !== 'ended');
      meetingModeActiveRef.current = active;
      setControlLayer((previous) => active ? { ...previous, collaboration: true, meetingMode: true } : previous);
      setMeetingControlStatus(active ? `Listening · ${Array.isArray(state?.transcript) ? state.transcript.length : 0} chunks` : 'Meeting mode off');
    }).catch(() => undefined);

    const unsubscribe = nexus.meetingMode.onUpdate((update: any) => {
      const status = String(update?.payload?.status || update?.status || '').trim();
      const active = status ? status !== 'ended' : meetingModeActiveRef.current;
      meetingModeActiveRef.current = active;
      setControlLayer((previous) => ({ ...previous, meetingMode: active, collaboration: previous.collaboration || active }));
      setMeetingControlStatus(status ? `Meeting ${status}` : 'Meeting mode updated');
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [nexus.meetingMode]);

  useEffect(() => () => {
    if (voiceRecoveryRef.current.scheduledResumeTimer) {
      window.clearTimeout(voiceRecoveryRef.current.scheduledResumeTimer);
      voiceRecoveryRef.current.scheduledResumeTimer = null;
    }
  }, [currentSessionId, nexus.sessionRuntime]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return undefined;
    }

    type ScrollButtonRecord = {
      button: HTMLButtonElement;
      onScroll: () => void;
      onClick: (event: MouseEvent) => void;
      resizeObserver: ResizeObserver | null;
    };

    const records = new Map<HTMLElement, ScrollButtonRecord>();
    let refreshFrame = 0;
    let shortDelay = 0;
    let longDelay = 0;

    const isVisibleHost = (host: HTMLElement): boolean => {
      if (!host.isConnected || host.clientHeight < 36 || host.clientWidth < 36) {
        return false;
      }

      const style = window.getComputedStyle(host);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }

      return true;
    };

    const updateButtonForHost = (host: HTMLElement) => {
      const record = records.get(host);
      if (!record) {
        return;
      }

      const rect = host.getBoundingClientRect();
      const canScroll = isVisibleHost(host)
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth
        && host.scrollHeight - host.clientHeight > SCROLL_BOTTOM_THRESHOLD_PX;
      const nearBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX;
      const shouldShow = canScroll && !nearBottom;
      const left = Math.min(window.innerWidth - 12, Math.max(56, rect.right - 14));
      const top = Math.min(window.innerHeight - 12, Math.max(56, rect.bottom - 14));

      record.button.style.left = `${Math.round(left)}px`;
      record.button.style.top = `${Math.round(top)}px`;
      record.button.classList.toggle('is-hidden', !shouldShow);
      record.button.disabled = !shouldShow;
      record.button.tabIndex = shouldShow ? 0 : -1;
      record.button.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    };

    const detachHost = (host: HTMLElement) => {
      const record = records.get(host);
      if (!record) {
        return;
      }

      host.removeEventListener('scroll', record.onScroll);
      record.button.removeEventListener('click', record.onClick);
      record.resizeObserver?.disconnect();
      record.button.remove();
      records.delete(host);
    };

    const attachHost = (host: HTMLElement) => {
      const existing = records.get(host);
      if (existing) {
        if (!existing.button.isConnected) {
          document.body.appendChild(existing.button);
        }
        updateButtonForHost(host);
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'next-scroll-bottom-button is-hidden';
      button.setAttribute('aria-label', 'Scroll to bottom');
      button.setAttribute('title', 'Scroll to bottom');
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;

      const icon = document.createElement('span');
      icon.className = 'next-scroll-bottom-button-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      const srLabel = document.createElement('span');
      srLabel.className = 'sr-only';
      srLabel.textContent = 'Scroll to bottom';
      button.appendChild(srLabel);

      const onScroll = () => {
        scheduleRefresh();
      };
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        host.scrollTo({
          top: host.scrollHeight,
          behavior: 'smooth',
        });
        scheduleRefresh();
        window.setTimeout(scheduleRefresh, 260);
      };

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          scheduleRefresh();
        });
        resizeObserver.observe(host);
      }

      button.addEventListener('click', onClick);
      host.addEventListener('scroll', onScroll, { passive: true });
      document.body.appendChild(button);

      records.set(host, {
        button,
        onScroll,
        onClick,
        resizeObserver,
      });

      updateButtonForHost(host);
    };

    const refreshButtons = () => {
      refreshFrame = 0;

      const matchedHosts = Array.from(shell.querySelectorAll<HTMLElement>(SCROLL_BOTTOM_TARGET_SELECTOR));
      const activeHosts = new Set(
        matchedHosts.filter((host) => isVisibleHost(host)),
      );

      for (const host of Array.from(records.keys())) {
        if (!activeHosts.has(host)) {
          detachHost(host);
        }
      }

      for (const host of activeHosts) {
        attachHost(host);
      }

      for (const host of activeHosts) {
        updateButtonForHost(host);
      }
    };

    const scheduleRefresh = () => {
      if (refreshFrame) {
        return;
      }

      refreshFrame = window.requestAnimationFrame(refreshButtons);
    };

    const mutationObserver = new MutationObserver(() => {
      scheduleRefresh();
    });

    mutationObserver.observe(shell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });

    window.addEventListener('resize', scheduleRefresh);
    scheduleRefresh();
    shortDelay = window.setTimeout(scheduleRefresh, 250);
    longDelay = window.setTimeout(scheduleRefresh, 1200);

    return () => {
      mutationObserver.disconnect();
      window.removeEventListener('resize', scheduleRefresh);
      if (refreshFrame) {
        window.cancelAnimationFrame(refreshFrame);
      }
      window.clearTimeout(shortDelay);
      window.clearTimeout(longDelay);
      for (const host of Array.from(records.keys())) {
        detachHost(host);
      }
    };
  }, []);

  const stageMetrics = useMemo(
    () => [
      { label: 'Messages', value: messages.length, detail: 'Live turns in the current session.' },
      {
        label: 'Working Memory',
        value: getWorkingMemoryTotal(knowledgeStats),
        detail: `${knowledgeStats.workingMemory.recentTurns} turns · ${knowledgeStats.workingMemory.recentToolOutcomes} tool outcomes · ${knowledgeStats.workingMemory.activeTasks} task cues`,
      },
      { label: 'Knowledge Docs', value: Number(knowledgeStats?.documents || 0), detail: 'Documents already available to Nexus.' },
      { label: 'Workspace Files', value: workspaceFiles.length, detail: 'Generated or imported artifacts on disk.' },
    ],
    [knowledgeStats, messages.length, workspaceFiles.length],
  );

  const refreshSessions = useCallback(async (preferredSessionId?: string) => {
    const sessionRecords = await nexus.sessions.list();
    const mapped = Array.isArray(sessionRecords) ? sessionRecords.map(normalizeSession) : [];
    mapped.sort((a, b) => b.updatedAt - a.updatedAt);
    setSessions(mapped);

    const nextSessionId = preferredSessionId
      || currentSessionId
      || mapped[0]?.id
      || null;

    if (nextSessionId && mapped.some((session) => session.id === nextSessionId)) {
      setCurrentSessionId(nextSessionId);
    } else if (!mapped.length) {
      setCurrentSessionId(null);
      setMessages([]);
    }
  }, [currentSessionId, nexus.sessions]);

  const refreshKnowledge = useCallback(async (sessionId?: string | null) => {
    const [documents, stats] = await Promise.all([
      nexus.knowledge.listDocuments(sessionId || undefined, 48),
      nexus.knowledge.stats(sessionId || undefined),
    ]);
    setKnowledgeDocuments(Array.isArray(documents) ? documents : []);
    setKnowledgeStats(normalizeKnowledgeStats(stats));
  }, [nexus.knowledge]);

  const refreshUnderstandStatus = useCallback(async () => {
    try {
      const status = await nexus.understand.status();
      setUnderstandStatus(status || null);
      const stats = status?.stats || {};
      setUnderstandMessage(status?.graphExists
        ? `${stats.nodes || 0} nodes · ${stats.edges || 0} edges · ${stats.layers || 0} layers`
        : 'No Understand-Anything graph found for this workspace.');
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code graph status failed.';
      setUnderstandMessage(message);
      return null;
    }
  }, [nexus.understand]);

  const refreshWorkspaceFiles = useCallback(async () => {
    const files = await nexus.artifacts.listWorkspaceFiles(36);
    setWorkspaceFiles(Array.isArray(files) ? files : []);
  }, [nexus.artifacts]);

  const openArtifactFile = useCallback(async (filePath: string) => {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
      return;
    }
    await nexus.artifacts.open(normalizedPath);
  }, [nexus.artifacts]);

  const revealArtifactFile = useCallback(async (filePath: string) => {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
      return;
    }
    await nexus.artifacts.reveal(normalizedPath);
  }, [nexus.artifacts]);

  const saveArtifactAs = useCallback(async (filePath: string, suggestedName?: string) => {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
      return null;
    }
    return await nexus.artifacts.saveAs(normalizedPath, suggestedName);
  }, [nexus.artifacts]);

  const ensureDiagramFile = useCallback(async (diagram: DiagramPayload) => {
    const diagramId = String(diagram?.id || '').trim();
    if (!diagramId) {
      return '';
    }

    const exported = await nexus.diagrams.exportSvg(diagramId);
    await refreshWorkspaceFiles();
    return String(exported?.path || '');
  }, [nexus.diagrams, refreshWorkspaceFiles]);

  const refreshEntityPreview = useCallback(async () => {
    const [counts, people, businesses] = await Promise.all([
      nexus.entityCrm.getCounts(),
      nexus.entityCrm.listPeople(12),
      nexus.entityCrm.listBusinesses(12),
    ]);
    setEntityCounts(counts || { people: 0, businesses: 0, links: 0 });
    setCrmPeople(Array.isArray(people) ? people : []);
    setCrmBusinesses(Array.isArray(businesses) ? businesses : []);
  }, [nexus.entityCrm]);

  const loadEntityRoomData = useCallback(async (panelPayload?: any): Promise<EntityRoomPayload> => {
    const payload = panelPayload && typeof panelPayload === 'object' ? panelPayload : {};
    const query = String(payload?.query || '').trim();
    const requestedEntityType = normalizePanelEntityType(payload?.entityType);

    const [counts, people, businesses, sessionContext, searchResults] = await Promise.all([
      nexus.entityCrm.getCounts(),
      nexus.entityCrm.listPeople(12),
      nexus.entityCrm.listBusinesses(12),
      currentSessionId ? nexus.entityCrm.getSessionContext(currentSessionId, 8) : Promise.resolve(null),
      query ? nexus.entityCrm.search(query, requestedEntityType || undefined) : Promise.resolve([]),
    ]);

    let activeEntityType = requestedEntityType;
    let activeEntityId = String(payload?.focusId || '').trim();
    const normalizedSearchResults = Array.isArray(searchResults) ? searchResults : [];

    if (!activeEntityId && normalizedSearchResults.length) {
      activeEntityId = String(normalizedSearchResults[0]?.id || '').trim();
      activeEntityType = normalizePanelEntityType(normalizedSearchResults[0]?.type) || activeEntityType;
    }

    if (!activeEntityId) {
      const sessionPerson = Array.isArray((sessionContext as any)?.people) ? (sessionContext as any).people[0] : null;
      const sessionBusiness = Array.isArray((sessionContext as any)?.businesses) ? (sessionContext as any).businesses[0] : null;
      const directoryPerson = Array.isArray(people) ? people[0] : null;
      const directoryBusiness = Array.isArray(businesses) ? businesses[0] : null;
      const fallbackEntity = sessionPerson || sessionBusiness || directoryPerson || directoryBusiness;
      const fallbackType = fallbackEntity
        ? normalizePanelEntityType(
            sessionPerson || directoryPerson
              ? 'person'
              : 'business',
          )
        : null;

      if (fallbackEntity?.id && fallbackType) {
        activeEntityId = String(fallbackEntity.id).trim();
        activeEntityType = fallbackType;
      }
    }

    let activeEntity: any = null;
    let relationships: any[] = [];
    let knowledge: any = null;

    if (activeEntityType && activeEntityId) {
      [activeEntity, relationships, knowledge] = await Promise.all([
        activeEntityType === 'person'
          ? nexus.entityCrm.getPerson(activeEntityId)
          : nexus.entityCrm.getBusiness(activeEntityId),
        activeEntityType === 'person'
          ? nexus.entityCrm.getPersonBusinesses(activeEntityId)
          : nexus.entityCrm.getBusinessPeople(activeEntityId),
        nexus.entityCrm.getKnowledge(activeEntityType, activeEntityId, 8),
      ]);
    }

    return {
      counts: counts || { people: 0, businesses: 0, links: 0 },
      people: Array.isArray(people) ? people : [],
      businesses: Array.isArray(businesses) ? businesses : [],
      query,
      searchResults: normalizedSearchResults,
      activeEntityType,
      activeEntity,
      relationships,
      sessionContext: sessionContext || null,
      knowledge,
      payload,
    };
  }, [currentSessionId, nexus.entityCrm]);

  const refreshMediaStatus = useCallback(async () => {
    const status = await nexus.media.getStatus();
    setMediaStatus(status || null);
  }, [nexus.media]);

  const loadSessionMessages = useCallback(async (sessionId: string): Promise<MessageRecord[]> => {
    const sessionData = await nexus.sessions.get(sessionId);
    const sessionMessages = Array.isArray(sessionData?.messages) ? sessionData.messages.map(normalizeMessage) : [];
    setMessages(sessionMessages);
    return sessionMessages;
  }, [nexus.sessions]);

  const fileToDataUrl = useCallback((file: File): Promise<string> => (
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    })
  ), []);

  const stageFocus = useCallback((stage: StageState, targetTab: SurfaceTab = 'ai-focus') => {
    setFocusStage(stage);
    if (targetTab !== 'chat') {
      setDockMode('full');
    }
    setActiveTab(targetTab);
  }, []);

  const projectEntityRoomToFocus = useCallback((roomData: EntityRoomPayload) => {
    if (!roomData?.activeEntity && !String(roomData?.query || '').trim()) {
      return;
    }

    const activeLabel = roomData.activeEntityType && roomData.activeEntity
      ? getEntityDisplayName(roomData.activeEntityType, roomData.activeEntity)
      : String(roomData.query || 'Entity CRM').trim();

    stageFocus(
      buildPanelStage(
        'entity-crm',
        'Entity CRM',
        roomData.activeEntityType && roomData.activeEntity
          ? `${roomData.activeEntityType} dossier projected into AI Focus because it matters to the current thread.`
          : 'CRM search context is projected into AI Focus as part of the current thread.',
        activeLabel,
        roomData,
      ),
      activeTab === 'ai-focus' ? 'ai-focus' : activeTab,
    );
  }, [activeTab, stageFocus]);

  useEffect(() => {
    const unsubscribe = nexus.sessionRuntime.onUpdate((rawState: any) => {
      const normalized = normalizeSessionRuntimeState(rawState, currentSessionId);
      if (!normalized || normalized.sessionId !== currentSessionId) {
        return;
      }

      setSessionRuntime(normalized);

      if (normalized.mode === 'chat' && isSessionRuntimeStage(focusStageRef.current)) {
        stageFocus(DEFAULT_ACTIVITY_STAGE, 'ai-focus');
        return;
      }

      if (
        normalized.mode !== 'chat'
        && (isDefaultFocusStage(focusStageRef.current) || isSessionRuntimeStage(focusStageRef.current))
      ) {
        stageFocus(buildSessionRuntimeStage(normalized), 'ai-focus');
      }
    });

    return unsubscribe;
  }, [currentSessionId, nexus.sessionRuntime, stageFocus]);

  const stageWorkstation = useCallback((stage: StageState, options?: { preserveHeaderPanel?: boolean }) => {
    if (!options?.preserveHeaderPanel) {
      setHeaderPanel(null);
    }
    setWorkstationStage(stage);
    setActiveTab('workstation');
  }, []);

  const closeFocusPreview = useCallback(() => {
    setFocusStage(DEFAULT_ACTIVITY_STAGE);
  }, []);

  const closeWorkstationPreview = useCallback(() => {
    setHeaderPanel(null);
    setWorkstationStage(DEFAULT_WORKSTATION_STAGE);
  }, []);

  const openMarketingDepartment = useCallback(() => {
    setShowMarketingDepartment(true);
  }, []);

  const openContractDraftingStudio = useCallback(() => {
    stageWorkstation({
      kind: 'panel',
      title: 'Contract Drafting',
      subtitle: 'Generate structured NDA and contract drafts from secure lawyer-style templates.',
      summary: 'Template-driven drafting studio',
      data: { panelKind: 'contract-drafting', payload: null },
    });
  }, [stageWorkstation]);

  const openPrivateProfileStudio = useCallback(() => {
    stageWorkstation({
      kind: 'panel',
      title: 'Secure Profile & Vault',
      subtitle: 'Manage encrypted profile fields and login secrets that Nexus can reuse for form filling.',
      summary: 'Encrypted private profile and login vault',
      data: { panelKind: 'private-profile', payload: null },
    });
  }, [stageWorkstation]);

  const effectiveWorkstationStage = useMemo(
    () => (isDefaultWorkstationStage(workstationStage) && !isDefaultFocusStage(focusStage)
      ? focusStage
      : workstationStage),
    [focusStage, workstationStage],
  );
  const effectiveWorkstationPanelKind = (effectiveWorkstationStage.kind === 'panel'
    ? (effectiveWorkstationStage.data?.panelKind || null)
    : null) as HeaderPanelKind;
  const effectiveWorkstationRoomClass = panelKindToRoomClass(effectiveWorkstationPanelKind);
  const workstationIsFollowingFocus = isDefaultWorkstationStage(workstationStage) && !isDefaultFocusStage(focusStage);
  const workstationHasFocusedSelection = !workstationIsFollowingFocus && !isDefaultWorkstationStage(workstationStage);
  const workstationFocusedMode = activeTab === 'workstation' && workstationHasFocusedSelection;
  const showDock = !workstationFocusedMode;
  const marketingOpen = showMarketingDepartment;

  const openCurrentFocusInWorkstation = useCallback(() => {
    if (isDefaultFocusStage(focusStage)) {
      return;
    }
    setHeaderPanel(null);
    setWorkstationStage(focusStage);
    setActiveTab('workstation');
  }, [focusStage]);

  const stageBrowserPresentation = useCallback((payload: { url?: string; title?: string }) => {
    const openedUrl = String(payload?.url || '').trim();
    if (!openedUrl) {
      return;
    }

    const openedTitle = String(payload?.title || openedUrl).trim() || openedUrl;
    stageFocus({
      kind: 'browser',
      title: openedTitle,
      subtitle: openedUrl,
      summary: 'Loading the live page in AI Focus.',
      data: {
        query: '',
        results: [],
        frameUrl: openedUrl,
        page: {
          title: openedTitle,
          url: openedUrl,
          text: 'Loading the live page in AI Focus…',
        },
      },
    }, 'ai-focus');

    void nexus.scrape.url(openedUrl).then((page) => {
      stageFocus({
        kind: 'browser',
        title: String(page?.title || openedTitle),
        subtitle: String(page?.url || openedUrl),
        summary: truncateText(page?.metadata?.description || page?.text || '', 180),
        data: {
          query: '',
          results: [],
          frameUrl: String(page?.url || openedUrl),
          page,
        },
      }, 'ai-focus');
    }).catch(() => {
      stageFocus({
        kind: 'browser',
        title: openedTitle,
        subtitle: openedUrl,
        summary: 'The page is open in AI Focus even though a text scrape was not available.',
        data: {
          query: '',
          results: [],
          frameUrl: openedUrl,
          page: {
            title: openedTitle,
            url: openedUrl,
            text: 'The page is open live in AI Focus. Scraped text was unavailable for this view.',
          },
        },
      }, 'ai-focus');
    });
  }, [nexus.scrape, stageFocus]);

  const loadArtifact = useCallback(async (
    filePath: string,
    options?: { startTime?: number; endTime?: number },
  ): Promise<ArtifactPayload> => {
    const loaded = await nexus.artifacts.load(filePath);
    return {
      path: String(loaded?.path || filePath),
      name: String(loaded?.name || filePath.split('/').pop() || 'Artifact'),
      kind: String(loaded?.kind || 'text'),
      mimeType: loaded?.mimeType ? String(loaded.mimeType) : undefined,
      dataUrl: loaded?.dataUrl ? String(loaded.dataUrl) : undefined,
      textContent: loaded?.textContent ? String(loaded.textContent) : undefined,
      spreadsheetData: loaded?.spreadsheetData,
      startTime: Number.isFinite(Number(options?.startTime)) ? Number(options?.startTime) : undefined,
      endTime: Number.isFinite(Number(options?.endTime)) ? Number(options?.endTime) : undefined,
    };
  }, [nexus.artifacts]);

  const openWorkspaceFile = useCallback(async (
    filePath: string,
    target: 'focus' | 'workstation' = 'workstation',
    options?: { startTime?: number; endTime?: number },
  ) => {
    const artifact = await loadArtifact(filePath, options);
    const stage = buildStageFromArtifact(artifact);
    if (target === 'focus') {
      stageFocus(stage, 'ai-focus');
    } else {
      stageWorkstation(stage);
    }
  }, [loadArtifact, stageFocus, stageWorkstation]);

  const openKnowledgeDocument = useCallback(async (documentId: string, target: 'focus' | 'workstation' = 'workstation') => {
    const document = await nexus.knowledge.getDocument(documentId);
    const stage = buildStageFromKnowledgeDocument(document);
    if (target === 'focus') {
      stageFocus(stage, 'ai-focus');
    } else {
      stageWorkstation(stage);
    }
  }, [nexus.knowledge, stageFocus, stageWorkstation]);

  const openInspectionItem = useCallback(async (item: InspectionStageItem, target: 'focus' | 'workstation' = 'focus') => {
    if (!item.openKind || !item.openTarget) {
      return;
    }

    if (item.openKind === 'knowledge_document' && item.openTarget.documentId) {
      await openKnowledgeDocument(String(item.openTarget.documentId), target);
      return;
    }

    if (item.openKind === 'workspace_file' && item.openTarget.path) {
      await openWorkspaceFile(String(item.openTarget.path), target, {
        startTime: Number(item.openTarget.startTime),
        endTime: Number(item.openTarget.endTime),
      });
      return;
    }

    if (item.openKind === 'entity' && item.openTarget.entityId) {
      await nexus.entityCrm.openPanel(
        undefined,
        String(item.openTarget.entityType || 'person') === 'business' ? 'business' : 'person',
        String(item.openTarget.entityId),
      );
      return;
    }

    if (item.openKind === 'text') {
      const stage: StageState = {
        kind: 'artifact',
        title: String(item.openTarget.title || item.title || 'Inspection note'),
        subtitle: item.subtitle || 'Live text inspection',
        summary: truncateText(item.preview || item.openTarget.content || '', 180),
        data: {
          path: String(item.openTarget.title || item.title || 'inspection.txt'),
          name: String(item.openTarget.title || item.title || 'Inspection note'),
          kind: 'text',
          mimeType: 'text/plain',
          textContent: String(item.openTarget.content || item.preview || ''),
        } satisfies ArtifactPayload,
      };

      if (target === 'focus') {
        stageFocus(stage, 'ai-focus');
      } else {
        stageWorkstation(stage);
      }
    }
    
    if (item.openKind === 'diagram' && item.openTarget.diagramId) {
      const diagram = await nexus.diagrams.get(String(item.openTarget.diagramId));
      if (!diagram) {
        return;
      }
      const stage = buildStageFromDiagram(diagram);
      if (target === 'focus') {
        stageFocus(stage, 'ai-focus');
      } else {
        stageWorkstation(stage);
      }
    }
  }, [nexus.diagrams, nexus.entityCrm, openKnowledgeDocument, openWorkspaceFile, stageFocus, stageWorkstation]);

  const openToolResultPreview = useCallback(async (
    toolResult: any,
    target: 'focus' | 'workstation' = 'focus',
  ): Promise<boolean> => {
    const toolName = String(toolResult?.toolName || '').trim();
    if (!toolName || toolResult?.error) {
      return false;
    }

    const payload = unwrapToolResultPayload(toolResult);

    if (isDiagramPayload(payload)) {
      const stage = buildStageFromDiagram(payload);
      if (target === 'focus') {
        stageFocus(stage, 'ai-focus');
      } else {
        stageWorkstation(stage);
      }
      return true;
    }

    if (toolName === 'draw_diagram' || toolName === 'show_diagram') {
      const diagramRef = String(
        payload?.id
        || payload?.name
        || toolResult?.args?.idOrName
        || toolResult?.args?.diagram
        || toolResult?.args?.name
        || '',
      ).trim();
      if (diagramRef) {
        const diagram = await nexus.diagrams.get(diagramRef);
        if (diagram) {
          const stage = buildStageFromDiagram(diagram);
          if (target === 'focus') {
            stageFocus(stage, 'ai-focus');
          } else {
            stageWorkstation(stage);
          }
          return true;
        }
      }
    }

    const artifactPath = String(payload?.path || '').trim();
    if (artifactPath) {
      await openWorkspaceFile(artifactPath, target, {
        startTime: Number(payload?.startTime),
        endTime: Number(payload?.endTime),
      });
      return true;
    }

    const inspectionStage = buildInspectionStageFromTool(toolName, toolResult?.args || {}, payload, 'complete');
    if (!inspectionStage) {
      return false;
    }

    if (target === 'focus') {
      stageFocus(inspectionStage, 'ai-focus');
    } else {
      stageWorkstation(inspectionStage);
    }
    return true;
  }, [nexus.diagrams, openWorkspaceFile, stageFocus, stageWorkstation]);

  const presentLatestAssistantToolResults = useCallback(async (sessionMessages: MessageRecord[]) => {
    const latestAssistantMessage = [...sessionMessages].reverse().find((message) => (
      message.role === 'assistant' && Array.isArray(message.toolResults) && message.toolResults.length > 0
    ));

    if (!latestAssistantMessage) {
      return;
    }

    const toolResults = Array.isArray(latestAssistantMessage.toolResults) ? latestAssistantMessage.toolResults : [];
    for (let index = toolResults.length - 1; index >= 0; index -= 1) {
      const entry = toolResults[index];
      try {
        const reopened = await openToolResultPreview(entry, 'focus');
        if (reopened) {
          return;
        }
      } catch (error) {
        console.warn('[NexusNext] failed to restage latest assistant tool result', error);
      }
    }
  }, [openToolResultPreview]);

  const handleFileSelection = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!currentSessionId || files.length === 0) {
      event.target.value = '';
      return;
    }

    setIsUploadingFiles(true);
    let primaryArtifactPath = '';

    try {
      for (const file of files) {
        const fileDataUrl = await fileToDataUrl(file);
        const result = await nexus.knowledge.ingestFile(
          currentSessionId,
          file.name,
          file.type || 'application/octet-stream',
          fileDataUrl,
        );
        const artifactPath = String(result?.filePath || '').trim();
        if (files.length === 1 && artifactPath) {
          primaryArtifactPath = artifactPath;
        }
        setFocusEvents((previous) => [
          createFocusEvent('File ingested', file.name, artifactPath || 'Knowledge upload', 'file'),
          ...previous,
        ].slice(0, 12));
      }

      await Promise.all([
        refreshWorkspaceFiles(),
        refreshKnowledge(currentSessionId),
        refreshSessions(currentSessionId),
      ]);

      if (primaryArtifactPath) {
        await openWorkspaceFile(primaryArtifactPath, activeTab === 'workstation' ? 'workstation' : 'focus');
        return;
      }
    } catch (error) {
      setFocusEvents((previous) => [
        createFocusEvent(
          'File upload failed',
          error instanceof Error ? error.message : 'Unknown upload error',
          'Attachment ingest',
          'error',
        ),
        ...previous,
      ].slice(0, 12));
    } finally {
      setIsUploadingFiles(false);
      event.target.value = '';
    }
  }, [
    activeTab,
    currentSessionId,
    fileToDataUrl,
    nexus.knowledge,
    openWorkspaceFile,
    refreshKnowledge,
    refreshSessions,
    refreshWorkspaceFiles,
  ]);

  const appendFocusEvent = useCallback((event: FocusEventRecord) => {
    setFocusEvents((previous) => [event, ...previous].slice(0, 12));
  }, []);

  const appendWorkTraceEvent = useCallback((event: WorkTraceEvent) => {
    setWorkTraceEvents((previous) => {
      const next = [event, ...previous.filter((entry) => entry.id !== event.id)];
      next.sort((a, b) => b.timestamp - a.timestamp);
      return next.slice(0, 32);
    });
  }, []);

  const rememberVoiceTextHandoff = useCallback((content: string) => {
    const normalized = normalizeHandoffText(content);
    if (!normalized) {
      return;
    }

    const now = Date.now();
    voiceTextHandoffRef.current = [
      ...voiceTextHandoffRef.current.filter((entry) => now - entry.createdAt < 30000),
      { content: normalized, createdAt: now },
    ].slice(-8);
  }, []);

  const consumeVoiceTextHandoff = useCallback((content: string): boolean => {
    const normalized = normalizeHandoffText(content);
    if (!normalized) {
      return false;
    }

    const now = Date.now();
    let consumed = false;
    voiceTextHandoffRef.current = voiceTextHandoffRef.current.filter((entry) => {
      const expired = now - entry.createdAt > 30000;
      const matches = !consumed && !expired && entry.content === normalized;
      if (matches) {
        consumed = true;
        return false;
      }
      return !expired;
    });
    return consumed;
  }, []);

  const stopRoomVision = useCallback(() => {
    stopMediaStreamTracks(roomVisionStreamRef.current);
    roomVisionStreamRef.current = null;
    if (roomVideoRef.current) {
      roomVideoRef.current.srcObject = null;
    }
    eyeContactModeRef.current = false;
    if (gazeFrameRef.current !== null) {
      window.cancelAnimationFrame(gazeFrameRef.current);
      gazeFrameRef.current = null;
    }
    setRoomVisionStatus('off');
    setRoomVisionError('');
    setRoomVisionCameraLabel('Camera');
    setEyeContactStatus('off');
    setGazeAssessment({
      looking: false,
      label: 'Off',
      reason: 'Room camera is off',
      metrics: DEFAULT_GAZE_METRICS,
    });
    setControlLayer((previous) => previous.eyeContact ? { ...previous, eyeContact: false } : previous);
  }, []);

  const waitForRoomVideoReady = useCallback(async (timeoutMs = 4500): Promise<void> => {
    const video = roomVideoRef.current;
    const stream = roomVisionStreamRef.current;
    if (!video || !stream) {
      throw new Error('Start Room View before sharing a snapshot.');
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    try {
      await video.play();
    } catch {
      // Muted autoplay is expected to work, but loadedmetadata/canplay can still settle the frame.
    }

    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const targetVideo = video;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const startedAt = Date.now();
      let frame = 0;
      let timer = 0;

      const cleanup = () => {
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
        if (timer) {
          window.clearTimeout(timer);
        }
        targetVideo.removeEventListener('loadedmetadata', check);
        targetVideo.removeEventListener('canplay', check);
        targetVideo.removeEventListener('playing', check);
      };

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      function check() {
        if (targetVideo.videoWidth > 0 && targetVideo.videoHeight > 0 && targetVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          finish();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          finish(new Error('Camera preview opened but no video frame arrived yet.'));
          return;
        }
        frame = window.requestAnimationFrame(check);
      }

      targetVideo.addEventListener('loadedmetadata', check);
      targetVideo.addEventListener('canplay', check);
      targetVideo.addEventListener('playing', check);
      timer = window.setTimeout(check, 120);
      check();
    });
  }, []);

  const startRoomVision = useCallback(async () => {
    if (roomVisionStatus === 'starting' || roomVisionStatus === 'live' || roomVisionStatus === 'capturing' || roomVisionStatus === 'analyzing') {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRoomVisionStatus('error');
      setRoomVisionError('Camera capture is not supported in this environment.');
      return;
    }

    setRoomVisionStatus('starting');
    setRoomVisionError('');

    try {
      stopMediaStreamTracks(roomVisionStreamRef.current);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15, max: 20 },
          facingMode: 'user',
        },
      });

      roomVisionStreamRef.current = stream;
      if (roomVideoRef.current) {
        roomVideoRef.current.srcObject = stream;
        void roomVideoRef.current.play().catch((error) => {
          console.warn('[NexusNext] room view preview did not autoplay immediately', error);
        });
      }
      const videoTrack = stream.getVideoTracks()[0];
      setRoomVisionCameraLabel(videoTrack?.label || 'Camera active');
      setRoomVisionStatus('live');
      appendFocusEvent(createFocusEvent('Room view on', 'Camera preview is live.', videoTrack?.label || 'Camera', 'voice'));
    } catch (error) {
      const detail = describeRoomVisionError(error);
      stopMediaStreamTracks(roomVisionStreamRef.current);
      roomVisionStreamRef.current = null;
      setRoomVisionStatus('error');
      setRoomVisionError(detail);
      appendFocusEvent(createFocusEvent('Room view failed', truncateText(detail, 140), 'Camera', 'error'));
    }
  }, [appendFocusEvent, roomVisionStatus]);

  const captureRoomFrameDataUrl = useCallback((): string => {
    const video = roomVideoRef.current;
    const canvas = roomCanvasRef.current;
    if (!roomVisionStreamRef.current || !video || !canvas) {
      throw new Error('Start Room View before sharing a snapshot.');
    }

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('Camera preview is not ready yet. Try again in a moment.');
    }

    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not capture a camera frame.');
    }

    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }, []);

  const shareRoomSnapshot = useCallback(async () => {
    if (!currentSessionId) {
      setRoomVisionError('Create or select a session before sharing Room View.');
      setVoiceSummary('Room view needs a session.');
      setVoiceMeta('Create or select a session before sharing camera context.');
      appendFocusEvent(createFocusEvent('Room view needs session', 'Create or select a session before sharing camera context.', 'Room View', 'error'));
      return;
    }

    if (roomVisionStatus !== 'live' || !roomVisionStreamRef.current) {
      await startRoomVision();
      if (!roomVisionStreamRef.current) {
        return;
      }
    }

    let capturedDataUrl = '';
    try {
      await waitForRoomVideoReady();
      setRoomVisionStatus('capturing');
      capturedDataUrl = captureRoomFrameDataUrl();
      setRoomVisionStatus('analyzing');
      setVoiceSummary('Room snapshot captured.');
      setVoiceMeta('Nexus is converting the camera frame into context the live agent can use.');

      const snapshotTitle = `Room View ${new Date().toLocaleString()}`;
      const analysis = await nexus.images.analyzeDataUrl(capturedDataUrl, {
        sessionId: currentSessionId,
        title: snapshotTitle,
        prompt: ROOM_VISION_PROMPT,
      });

      const description = String(analysis?.description || '').trim();
      const snapshot: RoomVisionSnapshot = {
        dataUrl: capturedDataUrl,
        description,
        capturedAt: Date.now(),
        provider: String(analysis?.provider || ''),
        model: String(analysis?.model || ''),
        path: String(analysis?.path || ''),
        name: String(analysis?.name || snapshotTitle),
      };
      setLatestRoomSnapshot(snapshot);

      const roomContextMessage = [
        '[ROOM_VIEW_SNAPSHOT]',
        `Captured: ${new Date(snapshot.capturedAt).toLocaleString()}`,
        snapshot.path ? `Image file: ${snapshot.path}` : '',
        snapshot.provider || snapshot.model ? `Vision model: ${[snapshot.provider, snapshot.model].filter(Boolean).join(' / ')}` : '',
        'Use this as the current visual context from the user-facing room camera. Do not claim continuous video; ask for another snapshot if the scene may have changed.',
        description,
      ].filter(Boolean).join('\n\n');

      const visibleMessage = [
        'Room view snapshot shared with Nexus.',
        description ? `Vision: ${truncateText(description, 900)}` : '',
        snapshot.path ? `Image: ${snapshot.path}` : '',
      ].filter(Boolean).join('\n\n');

      setMessages((previous) => [
        ...previous,
        {
          id: `room-view-${Date.now()}`,
          role: 'user',
          content: visibleMessage,
          timestamp: Date.now(),
          model: snapshot.model || 'Room View',
        },
      ]);
      await nexus.chat.append(currentSessionId, 'user', visibleMessage);

      const activeVoiceHandle = conversationStatus === 'connected' ? conversationRef.current : null;
      if (activeVoiceHandle && typeof activeVoiceHandle.sendUserMessage === 'function') {
        rememberVoiceTextHandoff(roomContextMessage);
        activeVoiceHandle.sendUserMessage(roomContextMessage);
        setVoiceSummary('Room view shared with the live voice agent.');
        setVoiceMeta('The current camera snapshot is now part of the active ElevenLabs conversation.');
      } else {
        setVoiceSummary('Room view saved to this session.');
        setVoiceMeta('Start voice or ask in chat, and Nexus can use the latest room snapshot context.');
      }

      stageFocus({
        kind: 'artifact',
        title: snapshot.name || snapshotTitle,
        subtitle: `${snapshot.provider || 'vision'}${snapshot.model ? ` · ${snapshot.model}` : ''}`,
        summary: truncateText(description, 180),
        data: {
          path: snapshot.path || snapshotTitle,
          name: snapshot.name || snapshotTitle,
          kind: 'image',
          mimeType: 'image/jpeg',
          dataUrl: capturedDataUrl,
        } satisfies ArtifactPayload,
      }, 'ai-focus');

      appendFocusEvent(createFocusEvent('Room view snapshot', truncateText(description || 'Camera snapshot analyzed.', 140), snapshot.path || 'Room View', 'image'));
      await Promise.allSettled([
        refreshKnowledge(currentSessionId),
        refreshSessions(currentSessionId),
        refreshWorkspaceFiles(),
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Room snapshot failed.';
      stopMediaStreamTracks(roomVisionStreamRef.current);
      roomVisionStreamRef.current = null;
      if (roomVideoRef.current) {
        roomVideoRef.current.srcObject = null;
      }
      setRoomVisionStatus('error');
      setRoomVisionError(detail);
      setVoiceSummary('Room view failed.');
      setVoiceMeta(detail);
      appendFocusEvent(createFocusEvent('Room view failed', truncateText(detail, 140), 'Snapshot analysis', 'error'));
      return;
    }

    setRoomVisionStatus(roomVisionStreamRef.current ? 'live' : 'off');
  }, [
    appendFocusEvent,
    captureRoomFrameDataUrl,
    conversationStatus,
    currentSessionId,
    nexus.chat,
    nexus.images,
    refreshKnowledge,
    refreshSessions,
    refreshWorkspaceFiles,
    rememberVoiceTextHandoff,
    roomVisionStatus,
    stageFocus,
    startRoomVision,
    waitForRoomVideoReady,
  ]);

  const toggleRoomVision = useCallback(() => {
    if (roomVisionStatus === 'off' || roomVisionStatus === 'error') {
      void startRoomVision();
      return;
    }
    stopRoomVision();
  }, [roomVisionStatus, startRoomVision, stopRoomVision]);

  const ensureGazeLandmarker = useCallback(async (): Promise<FaceLandmarker> => {
    if (gazeLandmarkerRef.current) {
      return gazeLandmarkerRef.current;
    }

    const vision = await FilesetResolver.forVisionTasks(rendererAssetUrl('./mediapipe/wasm'));
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: rendererAssetUrl('./models/face_landmarker.task'),
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    gazeLandmarkerRef.current = landmarker;
    return landmarker;
  }, []);

  const applyEyeContactVoiceGate = useCallback((looking: boolean) => {
    const conversation = conversationRef.current;
    if (!eyeContactModeRef.current || !conversation || conversationStatusRef.current !== 'connected') {
      return;
    }

    try {
      conversation.setMicMuted(!looking);
      gazeAppliedMuteRef.current = !looking;
      setIsVoiceMicMuted(!looking);
      if (!looking) {
        setVoiceSummary('Eye Contact Mode is holding the microphone.');
        setVoiceMeta('Look at the camera to reopen the live voice input, or turn Eye Contact Mode off.');
      }
    } catch (error) {
      setEyeContactStatus('error');
      appendFocusEvent(createFocusEvent(
        'Gaze gate failed',
        error instanceof Error ? error.message : 'Could not apply microphone gate.',
        'Eye Contact Mode',
        'error',
      ));
    }
  }, [appendFocusEvent]);

  const runGazeFrame = useCallback((timeMs: number) => {
    if (!eyeContactModeRef.current) {
      gazeFrameRef.current = null;
      return;
    }

    const landmarker = gazeLandmarkerRef.current;
    const video = roomVideoRef.current;
    if (!landmarker || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      gazeFrameRef.current = window.requestAnimationFrame(runGazeFrame);
      return;
    }

    try {
      const result = landmarker.detectForVideo(video, timeMs);
      const assessment = assessGaze(result, gazeScoreRef.current, gazeStrictnessRef.current, null);
      gazeScoreRef.current = assessment.metrics.smoothedScore;
      const nextStatus: EyeContactControlStatus = assessment.looking ? 'looking' : 'away';
      applyEyeContactVoiceGate(assessment.looking);

      if (timeMs - lastGazeUiUpdateRef.current > 130 || nextStatus !== eyeContactStatus) {
        lastGazeUiUpdateRef.current = timeMs;
        setGazeAssessment(assessment);
        setEyeContactStatus(nextStatus);
      }
    } catch (error) {
      setEyeContactStatus('error');
      setGazeAssessment({
        looking: false,
        label: 'Error',
        reason: error instanceof Error ? error.message : 'Gaze detection failed',
        metrics: DEFAULT_GAZE_METRICS,
      });
    }

    gazeFrameRef.current = window.requestAnimationFrame(runGazeFrame);
  }, [applyEyeContactVoiceGate, eyeContactStatus]);

  const startEyeContactMode = useCallback(async () => {
    if (eyeContactModeRef.current) {
      return;
    }

    setEyeContactStatus('starting');
    setControlLayerBusyAction('Starting eye contact');
    try {
      if (!roomVisionStreamRef.current || roomVisionStatus === 'off' || roomVisionStatus === 'error') {
        await startRoomVision();
      }

      await waitForRoomVideoReady(6000);
      await ensureGazeLandmarker();
      eyeContactModeRef.current = true;
      setControlLayer((previous) => ({ ...previous, collaboration: true, eyeContact: true }));
      setEyeContactStatus('starting');
      appendFocusEvent(createFocusEvent('Eye Contact Mode on', 'Nexus Gaze is gating live voice input.', 'Control Layer', 'voice'));
      if (gazeFrameRef.current !== null) {
        window.cancelAnimationFrame(gazeFrameRef.current);
      }
      gazeFrameRef.current = window.requestAnimationFrame(runGazeFrame);
    } catch (error) {
      eyeContactModeRef.current = false;
      setControlLayer((previous) => ({ ...previous, eyeContact: false }));
      setEyeContactStatus('error');
      setGazeAssessment({
        looking: false,
        label: 'Error',
        reason: error instanceof Error ? error.message : 'Eye Contact Mode failed',
        metrics: DEFAULT_GAZE_METRICS,
      });
      appendFocusEvent(createFocusEvent(
        'Eye Contact Mode failed',
        error instanceof Error ? error.message : 'Could not start gaze gate.',
        'Control Layer',
        'error',
      ));
    } finally {
      setControlLayerBusyAction('');
    }
  }, [appendFocusEvent, ensureGazeLandmarker, roomVisionStatus, runGazeFrame, startRoomVision, waitForRoomVideoReady]);

  const stopEyeContactMode = useCallback(() => {
    eyeContactModeRef.current = false;
    if (gazeFrameRef.current !== null) {
      window.cancelAnimationFrame(gazeFrameRef.current);
      gazeFrameRef.current = null;
    }
    if (gazeAppliedMuteRef.current && conversationRef.current && conversationStatusRef.current === 'connected') {
      try {
        conversationRef.current.setMicMuted(false);
        setIsVoiceMicMuted(false);
      } catch {
        // Voice session may already be closing.
      }
    }
    gazeAppliedMuteRef.current = false;
    setEyeContactStatus('off');
    setGazeAssessment({
      looking: false,
      label: 'Off',
      reason: 'Eye contact mode is off',
      metrics: DEFAULT_GAZE_METRICS,
    });
    setControlLayer((previous) => previous.eyeContact ? { ...previous, eyeContact: false } : previous);
    appendFocusEvent(createFocusEvent('Eye Contact Mode off', 'Voice input returned to manual mic control.', 'Control Layer', 'voice'));
  }, [appendFocusEvent]);

  const toggleEyeContactMode = useCallback(() => {
    if (eyeContactModeRef.current || controlLayer.eyeContact) {
      stopEyeContactMode();
      return;
    }
    void startEyeContactMode();
  }, [controlLayer.eyeContact, startEyeContactMode, stopEyeContactMode]);

  const sendCurrentWorkstationStageToFocus = useCallback(() => {
    if (isDefaultWorkstationStage(effectiveWorkstationStage)) {
      return;
    }
    stageFocus(effectiveWorkstationStage, 'ai-focus');
    appendFocusEvent(createFocusEvent(
      'Sent from workstation',
      `Promoted ${effectiveWorkstationStage.title} into AI Focus.`,
      effectiveWorkstationStage.subtitle || 'AI Focus',
      'workstation',
    ));
  }, [appendFocusEvent, effectiveWorkstationStage, stageFocus]);

  const toggleMessageDetails = useCallback((messageId: string) => {
    setExpandedMessageDetails((previous) => ({
      ...previous,
      [messageId]: !previous[messageId],
    }));
  }, []);

  const fetchDiaryPreview = useCallback(async () => {
    const [entries, narratives] = await Promise.all([
      nexus.masterDiary.list(20),
      nexus.masterDiary.narratives(8),
    ]);
    const payload = { entries, narratives };
    setDiaryPreviewData({
      entries: Array.isArray(entries) ? entries : [],
      narratives: Array.isArray(narratives) ? narratives : [],
    });
    return payload;
  }, [nexus.masterDiary]);

  useEffect(() => {
    void fetchDiaryPreview().catch((error) => {
      console.warn('[NexusNext] failed to refresh diary preview', error);
    });
  }, [currentSessionId, fetchDiaryPreview]);

  const refreshDiaryPanel = useCallback(async () => {
    const payload = await fetchDiaryPreview();
    setHeaderPanelData(payload);
    return payload;
  }, [fetchDiaryPreview]);

  const handleCreateSessionDiaryFromWorkstation = useCallback(async () => {
    if (!currentSessionId) {
      throw new Error('No active session selected.');
    }
    await nexus.masterDiary.createSessionDiary(currentSessionId);
    await refreshDiaryPanel();
  }, [currentSessionId, nexus.masterDiary, refreshDiaryPanel]);

  const handleCommentDiaryEntry = useCallback(async (entryId: string, comment: string) => {
    await nexus.masterDiary.comment(entryId, comment);
    await refreshDiaryPanel();
  }, [nexus.masterDiary, refreshDiaryPanel]);

  const startTextSession = useCallback(async () => {
    if (!currentSessionId) {
      return;
    }

    const state = await nexus.sessionRuntime.start(currentSessionId, {
      mode: 'text_session',
      trigger: 'manual_start',
    });
    const normalized = normalizeSessionRuntimeState(state, currentSessionId);
    if (normalized) {
      setSessionRuntime(normalized);
      stageFocus(buildSessionRuntimeStage(normalized), 'ai-focus');
    }
    setActiveTab('ai-focus');
    setDockMode('full');
    setVoiceSummary('Text session mode is active.');
    setVoiceMeta('Nexus can keep coordinating visible work in AI Focus without voice transport.');
    appendFocusEvent(createFocusEvent(
      'Text session started',
      'Bounded text autonomy is active for this session.',
      'Session runtime',
      'activity',
    ));
  }, [appendFocusEvent, currentSessionId, nexus.sessionRuntime, stageFocus]);

  const endSessionRuntime = useCallback(async () => {
    if (!currentSessionId) {
      return;
    }

    const state = await nexus.sessionRuntime.end(currentSessionId);
    const normalized = normalizeSessionRuntimeState(state, currentSessionId);
    setSessionRuntime(normalized);
    setVoiceSummary('Returned to chat mode.');
    setVoiceMeta('Nexus is back to one-off turns until you start session mode or voice again.');
    appendFocusEvent(createFocusEvent(
      'Session mode ended',
      'Returned to normal chat mode.',
      'Session runtime',
      'activity',
    ));
  }, [appendFocusEvent, currentSessionId, nexus.sessionRuntime]);

  const runSessionCycle = useCallback(async (trigger: string = 'manual_cycle', objective?: string) => {
    if (!currentSessionId) {
      return;
    }

    const state = await nexus.sessionRuntime.runCycle(currentSessionId, {
      trigger,
      objective,
    });
    const normalized = normalizeSessionRuntimeState(state, currentSessionId);
    if (normalized) {
      setSessionRuntime(normalized);
      stageFocus(buildSessionRuntimeStage(normalized), 'ai-focus');
    }
    setActiveTab('ai-focus');
    setDockMode('full');
  }, [currentSessionId, nexus.sessionRuntime, stageFocus]);

  const loadHeaderPanel = useCallback(async (kind: HeaderPanelKind) => {
    if (!kind) {
      setHeaderPanel(null);
      return;
    }

    if (headerPanel === kind) {
      closeWorkstationPreview();
      return;
    }

    setHeaderPanel(kind);
    setHeaderPanelLoading(true);
    setHeaderPanelData(null);

    try {
      switch (kind) {
        case 'diary': {
          stageWorkstation({
            kind: 'panel',
            title: 'Diary',
            subtitle: 'Comment on entries, add context, and trigger fresh reflection inside the manual review surface.',
            summary: 'Loading diary…',
            data: { panelKind: kind, payload: null },
          }, { preserveHeaderPanel: true });
          const payload = await refreshDiaryPanel();
          stageWorkstation({
            kind: 'panel',
            title: 'Diary',
            subtitle: 'Comment on entries, add context, and trigger fresh reflection inside the manual review surface.',
            summary: `${Array.isArray(payload.entries) ? payload.entries.length : 0} entries`,
            data: { panelKind: kind, payload },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'statistics': {
          const overview = await nexus.usage.overview();
          setUsageOverview(overview || null);
          setHeaderPanelData(overview || null);
          stageWorkstation({
            kind: 'panel',
            title: 'Statistics',
            subtitle: 'Manual inspection surface for usage, providers, and shell-level operational telemetry.',
            summary: 'Usage overview',
            data: { panelKind: kind, payload: overview || null },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'task-queue': {
          if (!currentSessionId) {
            setHeaderPanelData({ error: 'No active session selected.' });
            stageWorkstation({
              kind: 'panel',
              title: 'Task Queue',
              subtitle: 'No active session is selected, so there is no task queue context to inspect.',
              summary: 'No active session',
              data: { panelKind: kind, payload: { error: 'No active session selected.' } },
            }, { preserveHeaderPanel: true });
            break;
          }
          const todo = await nexus.rollingTodo.get(currentSessionId);
          setHeaderPanelData(todo);
          stageWorkstation({
            kind: 'panel',
            title: 'Task Queue',
            subtitle: 'Manual inspection surface for rolling tasks, dependencies, and next work items.',
            summary: 'Session task queue',
            data: { panelKind: kind, payload: todo },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'entity-crm': {
          const roomData = await loadEntityRoomData();
          setEntityCounts(roomData.counts || { people: 0, businesses: 0, links: 0 });
          setCrmPeople(Array.isArray(roomData.people) ? roomData.people : []);
          setCrmBusinesses(Array.isArray(roomData.businesses) ? roomData.businesses : []);
          setHeaderPanelData(roomData);
          stageWorkstation(
            buildPanelStage(
              kind,
              'Entity CRM',
              'Manual browsing surface for people, businesses, notes, and relationship intelligence.',
              `${Number(roomData?.counts?.people || 0)} people · ${Number(roomData?.counts?.businesses || 0)} businesses`,
              roomData,
            ),
            { preserveHeaderPanel: true },
          );
          break;
        }
        case 'research': {
          const status = await nexus.research.status();
          setHeaderPanelData(status || null);
          stageWorkstation({
            kind: 'panel',
            title: 'Research Department',
            subtitle: 'Autonomous local-free research projects, scheduled jobs, source intake, and classified evidence.',
            summary: `${Number(status?.projectCount || 0)} research projects · ${Number(status?.activeJobCount || 0)} active jobs`,
            data: { panelKind: kind, payload: status || null },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'influencer-studio': {
          const payload = { project: 'AI Influencer Studio', mode: 'visual-creator', activeSessionId: currentSessionId };
          setHeaderPanelData(payload);
          stageWorkstation({
            kind: 'panel',
            title: 'Influencer Studio',
            subtitle: 'Visual creator workflow for identity, image generation prompts, HeyGen briefs, content cards, assets, and draft automation.',
            summary: 'Identity Bible -> Look Board -> HeyGen -> Content',
            data: { panelKind: kind, payload },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'html-studio': {
          const payload = { project: 'HTML Studio', mode: 'artifact-builder', activeSessionId: currentSessionId };
          setHeaderPanelData(payload);
          stageWorkstation({
            kind: 'panel',
            title: 'HTML Studio',
            subtitle: 'Create standalone HTML pages for idea maps, presentations, briefs, and workflow boards.',
            summary: 'Idea Map -> Presentation -> Brief -> Workflow',
            data: { panelKind: kind, payload },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'bugs': {
          const reports = await nexus.bugs.list({ limit: 40, sessionId: currentSessionId || undefined });
          setHeaderPanelData(reports || []);
          stageWorkstation({
            kind: 'panel',
            title: 'Bugs',
            subtitle: 'Manual review surface for current bug reports and validation backlog.',
            summary: `${Array.isArray(reports) ? reports.length : 0} bug reports`,
            data: { panelKind: kind, payload: reports || [] },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'settings': {
          const bridge = await nexus.nexusBridge.getConfig();
          setHeaderPanelData({ bridge });
          stageWorkstation({
            kind: 'panel',
            title: 'Settings',
            subtitle: 'Desktop bridge, local routing, and core provider configuration.',
            summary: bridge?.url || 'Desktop settings',
            data: { panelKind: kind, payload: { bridge } },
          }, { preserveHeaderPanel: true });
          break;
        }
        case 'info': {
          setHeaderPanelData({ shell: 'next', activeSessionId: currentSessionId, activeTab });
          stageWorkstation({
            kind: 'panel',
            title: 'About Nexus Next',
            subtitle: 'Operating model notes for how Chat, AI Focus, Workstation, and Knowledge Base should divide responsibility.',
            summary: 'Shell overview',
            data: { panelKind: kind, payload: { shell: 'next', activeSessionId: currentSessionId, activeTab } },
          }, { preserveHeaderPanel: true });
          break;
        }
      }
    } catch (error) {
      setHeaderPanelData({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setHeaderPanelLoading(false);
    }
  }, [
    activeTab,
    currentSessionId,
    closeWorkstationPreview,
    headerPanel,
    nexus.bugs,
    nexus.entityCrm,
    nexus.research,
    loadEntityRoomData,
    nexus.masterDiary,
    nexus.nexusBridge,
    refreshDiaryPanel,
    nexus.rollingTodo,
    nexus.usage,
    stageWorkstation,
  ]);

  useEffect(() => {
    if (headerPanel !== 'statistics') {
      return undefined;
    }

    let cancelled = false;
    const refreshStatistics = async () => {
      try {
        const overview = await nexus.usage.overview();
        if (!cancelled) {
          setUsageOverview(overview || null);
          setHeaderPanelData(overview || null);
        }
      } catch (error) {
        console.warn('[NexusNext] failed to refresh statistics dashboard', error);
      }
    };

    const timer = window.setInterval(() => {
      void refreshStatistics();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [headerPanel, nexus.usage]);

  const openFullSettingsFromSetup = useCallback(() => {
    setShowSetupWizard(false);
    setActiveTab('workstation');
    void loadHeaderPanel('settings');
  }, [loadHeaderPanel]);

  const openWonderingInDiary = useCallback((wondering: WonderingRecord) => {
    if (wondering.readerId) {
      setDiaryReaderTargetId(wondering.readerId);
    }
    setActiveTab('workstation');
    if (headerPanel !== 'diary') {
      void loadHeaderPanel('diary');
    }
  }, [headerPanel, loadHeaderPanel]);

  const openEntityRecord = useCallback(async (entityType: 'person' | 'business', entityId: string) => {
    await nexus.entityCrm.openPanel(undefined, entityType, entityId);
  }, [nexus.entityCrm]);

  const createSession = useCallback(async () => {
    const stamp = new Date().toLocaleString();
    const created = await nexus.sessions.create(`Session ${stamp}`, 'Created from Nexus Next shell');
    await refreshSessions(created?.id);
    if (created?.id) {
      await loadSessionMessages(created.id);
      await refreshKnowledge(created.id);
    }
  }, [loadSessionMessages, nexus.sessions, refreshKnowledge, refreshSessions]);

  const ensureControlSession = useCallback(async (): Promise<string> => {
    if (currentSessionId) {
      return currentSessionId;
    }

    const stamp = new Date().toLocaleString();
    const created = await nexus.sessions.create(`Collaboration ${stamp}`, 'Shared visual, voice, browser, and planning workspace.');
    const sessionId = String(created?.id || '').trim();
    if (!sessionId) {
      throw new Error('Could not create a Nexus session for the control layer.');
    }

    await refreshSessions(sessionId);
    await loadSessionMessages(sessionId);
    await refreshKnowledge(sessionId);
    return sessionId;
  }, [currentSessionId, loadSessionMessages, nexus.sessions, refreshKnowledge, refreshSessions]);

  const toggleMeetingMode = useCallback(async () => {
    setControlLayerBusyAction(meetingModeActiveRef.current ? 'Ending meeting' : 'Starting meeting');
    try {
      if (meetingModeActiveRef.current) {
        const result = await nexus.meetingMode.end();
        meetingModeActiveRef.current = false;
        setControlLayer((previous) => ({ ...previous, meetingMode: false }));
        const transcriptCount = Array.isArray(result?.meeting?.transcript) ? result.meeting.transcript.length : 0;
        const briefingPath = String(result?.persistence?.briefingPath || '').trim();
        setMeetingControlStatus(briefingPath ? `Ended · ${transcriptCount} chunks · briefing saved` : `Ended · ${transcriptCount} chunks`);
        appendFocusEvent(createFocusEvent('Meeting ended', `${transcriptCount} transcript chunks processed.`, briefingPath || 'Meeting Mode', 'artifact'));
        if (briefingPath) {
          const artifact = await loadArtifact(briefingPath);
          stageFocus({
            kind: 'artifact',
            title: artifact.name || 'Meeting Briefing',
            subtitle: 'Meeting Mode deliverable',
            summary: briefingPath,
            data: artifact,
          }, 'ai-focus');
          await refreshWorkspaceFiles();
        }
        return;
      }

      const sessionId = await ensureControlSession();
      const meeting = await nexus.meetingMode.start(sessionId);
      meetingModeActiveRef.current = true;
      setControlLayer((previous) => ({ ...previous, collaboration: true, meetingMode: true }));
      setMeetingControlStatus(`Listening · ${String(meeting?.id || '').slice(0, 8)}`);
      appendFocusEvent(createFocusEvent('Meeting Mode on', 'Transcript and planning intelligence are being captured.', 'Control Layer', 'voice'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meeting Mode failed.';
      setMeetingControlStatus(message);
      appendFocusEvent(createFocusEvent('Meeting Mode failed', truncateText(message, 140), 'Control Layer', 'error'));
    } finally {
      setControlLayerBusyAction('');
    }
  }, [appendFocusEvent, ensureControlSession, loadArtifact, nexus.meetingMode, refreshWorkspaceFiles, stageFocus]);

  const compileMeetingBrief = useCallback(async () => {
    if (!meetingModeActiveRef.current) {
      setMeetingControlStatus('Start Meeting Mode before compiling.');
      return;
    }

    setControlLayerBusyAction('Compiling brief');
    try {
      const briefing = await nexus.meetingMode.compileBriefing();
      const summary = String(briefing?.summary || '').trim();
      setMeetingControlStatus(summary ? 'Brief compiled' : 'Brief compiled with limited transcript');
      stageFocus({
        kind: 'inspection',
        title: 'Live Meeting Brief',
        subtitle: 'Compiled from the active Meeting Mode transcript.',
        summary: truncateText(summary || 'No summary generated yet.', 180),
        data: {
          sections: [
            {
              label: 'Summary',
              items: [
                buildTextInspectionItem('Executive summary', summary || 'No summary generated yet.', 'Meeting Mode'),
              ],
            },
            {
              label: 'Signals',
              items: [
                buildTextInspectionItem('Entities', `${Array.isArray(briefing?.entities) ? briefing.entities.length : 0}`, 'Detected entities'),
                buildTextInspectionItem('Facts', `${Array.isArray(briefing?.facts) ? briefing.facts.length : 0}`, 'Detected facts'),
                buildTextInspectionItem('Topics', `${Array.isArray(briefing?.topics) ? briefing.topics.length : 0}`, 'Detected topics'),
                buildTextInspectionItem('Research', `${Array.isArray(briefing?.researchSuggestions) ? briefing.researchSuggestions.length : 0}`, 'Suggested follow-up searches'),
              ],
            },
          ],
        },
      }, 'ai-focus');
      appendFocusEvent(createFocusEvent('Meeting brief compiled', truncateText(summary || 'Live brief created.', 140), 'Meeting Mode', 'artifact'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Brief compile failed.';
      setMeetingControlStatus(message);
      appendFocusEvent(createFocusEvent('Brief compile failed', truncateText(message, 140), 'Meeting Mode', 'error'));
    } finally {
      setControlLayerBusyAction('');
    }
  }, [appendFocusEvent, nexus.meetingMode, stageFocus]);

  const toggleBrowserControl = useCallback(() => {
    setControlLayer((previous) => {
      const next = !previous.browserControl;
      setBrowserControlStatus(next ? 'Browser control enabled' : 'Browser control off');
      if (next) {
        appendFocusEvent(createFocusEvent('Browser Control on', 'Nexus can open, search, capture, and inspect browser pages.', 'Control Layer', 'browser'));
      }
      return { ...previous, collaboration: previous.collaboration || next, browserControl: next };
    });
  }, [appendFocusEvent]);

  const runControlledBrowserSearch = useCallback(async () => {
    const query = (controlBrowserQuery.trim() || webQuery.trim() || 'meeting planning ideas').trim();
    if (!query) {
      return;
    }

    setControlLayerBusyAction('Browser search');
    setBrowserControlStatus('Opening controlled browser');
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const [browserResult, searchResult] = await Promise.allSettled([
        nexus.browserAutomation.open(url),
        nexus.scrape.search(query),
      ]);
      const searchResults = searchResult.status === 'fulfilled' && Array.isArray(searchResult.value) ? searchResult.value : [];
      setWebQuery(query);
      setWebResults(searchResults);
      stageFocus({
        kind: 'browser',
        title: `Browser search: ${query}`,
        subtitle: url,
        summary: searchResults.length ? `${searchResults.length} source results staged.` : 'Controlled browser opened. Search scrape returned no source list yet.',
        data: {
          query,
          results: searchResults,
          frameUrl: url,
          page: {
            title: `Search: ${query}`,
            url,
            text: browserResult.status === 'fulfilled'
              ? String(browserResult.value?.message || 'Controlled browser opened.')
              : 'Controlled browser launch failed, but source search was still staged.',
          },
        },
      }, 'ai-focus');
      const browserMessage = browserResult.status === 'fulfilled'
        ? String(browserResult.value?.message || 'Browser opened.')
        : browserResult.reason instanceof Error ? browserResult.reason.message : 'Browser launch failed.';
      setBrowserControlStatus(browserMessage);
      appendFocusEvent(createFocusEvent('Controlled browser search', query, browserMessage, 'browser'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browser search failed.';
      setBrowserControlStatus(message);
      appendFocusEvent(createFocusEvent('Browser search failed', truncateText(message, 140), 'Control Layer', 'error'));
    } finally {
      setControlLayerBusyAction('');
    }
  }, [appendFocusEvent, controlBrowserQuery, nexus.browserAutomation, nexus.scrape, stageFocus, webQuery]);

  const captureControlledBrowserPage = useCallback(async () => {
    setControlLayerBusyAction('Capturing browser');
    setBrowserControlStatus('Reading active browser page');
    try {
      const page = await nexus.browserAutomation.getContent();
      stageFocus({
        kind: 'browser',
        title: String(page?.title || 'Controlled Browser'),
        subtitle: String(page?.url || 'Active browser page'),
        summary: truncateText(page?.text || page?.message || '', 180),
        data: {
          query: controlBrowserQuery || webQuery,
          results: webResults,
          page: {
            title: String(page?.title || 'Controlled Browser'),
            url: String(page?.url || ''),
            text: String(page?.text || page?.message || ''),
          },
        },
      }, 'ai-focus');
      setBrowserControlStatus(page?.success === false ? 'Browser content capture failed' : 'Browser content captured');
      appendFocusEvent(createFocusEvent('Browser page captured', String(page?.title || page?.url || 'Active page'), 'Controlled browser', 'browser'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browser capture failed.';
      setBrowserControlStatus(message);
      appendFocusEvent(createFocusEvent('Browser capture failed', truncateText(message, 140), 'Control Layer', 'error'));
    } finally {
      setControlLayerBusyAction('');
    }
  }, [appendFocusEvent, controlBrowserQuery, nexus.browserAutomation, stageFocus, webQuery, webResults]);

  const toggleDiagramCoEdit = useCallback(() => {
    setControlLayer((previous) => {
      const next = !previous.diagramCoEdit;
      setDiagramControlStatus(next ? 'Co-edit on: drag native diagram nodes' : 'Diagram co-edit off');
      if (next) {
        appendFocusEvent(createFocusEvent('Diagram Co-Edit on', 'Native diagrams can be created and dragged in AI Focus.', 'Control Layer', 'diagram'));
      }
      return { ...previous, collaboration: previous.collaboration || next, diagramCoEdit: next };
    });
  }, [appendFocusEvent]);

  const createPlanningDiagram = useCallback(async () => {
    setControlLayerBusyAction('Creating diagram');
    try {
      const sessionId = await ensureControlSession();
      const prompt = diagramControlPrompt.trim() || 'Meeting notes, transcript, planning ideas, browser research, action items, and deliverables';
      const now = new Date();
      const spec = {
        kind: 'mindmap',
        title: 'Shared Meeting Workspace',
        subtitle: truncateText(prompt, 90),
        width: 1440,
        height: 760,
        layout: 'manual',
        nodes: [
          { id: 'meeting', label: 'Meeting', sub: 'Live transcript', x: 600, y: 260, w: 220, h: 86, color: 'amber', shape: 'pill' },
          { id: 'notes', label: 'Notes', sub: 'Raw capture', x: 180, y: 130, w: 210, h: 78, color: 'blue' },
          { id: 'research', label: 'Browser Research', sub: 'Sources and searches', x: 185, y: 420, w: 230, h: 78, color: 'cyan' },
          { id: 'ideas', label: 'Planning Ideas', sub: 'Options and concepts', x: 595, y: 80, w: 230, h: 78, color: 'purple' },
          { id: 'decisions', label: 'Decisions', sub: 'What changed', x: 1000, y: 130, w: 220, h: 78, color: 'green' },
          { id: 'tasks', label: 'Action Plan', sub: 'Owners and next steps', x: 990, y: 420, w: 240, h: 78, color: 'pink' },
          { id: 'deliverables', label: 'Deliverables', sub: 'Briefs, diagrams, files', x: 600, y: 560, w: 240, h: 82, color: 'slate' },
        ],
        edges: [
          { from: 'notes', to: 'meeting', label: 'feeds' },
          { from: 'research', to: 'meeting', label: 'informs' },
          { from: 'ideas', to: 'meeting', label: 'shapes' },
          { from: 'meeting', to: 'decisions', label: 'commits' },
          { from: 'meeting', to: 'tasks', label: 'assigns' },
          { from: 'tasks', to: 'deliverables', label: 'produces' },
          { from: 'decisions', to: 'deliverables', label: 'frames' },
        ],
      };
      const diagram = await nexus.diagrams.create(`Shared Meeting Workspace ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, spec, sessionId);
      setDiagramControlStatus('Diagram created · drag nodes to arrange');
      stageFocus(buildStageFromDiagram(diagram), 'ai-focus');
      appendFocusEvent(createFocusEvent('Planning diagram created', truncateText(prompt, 140), 'Diagram Co-Edit', 'diagram'));
      await refreshWorkspaceFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Diagram creation failed.';
      setDiagramControlStatus(message);
      appendFocusEvent(createFocusEvent('Diagram creation failed', truncateText(message, 140), 'Control Layer', 'error'));
    } finally {
      setControlLayerBusyAction('');
    }
  }, [appendFocusEvent, diagramControlPrompt, ensureControlSession, nexus.diagrams, refreshWorkspaceFiles, stageFocus]);

  const createUnderstandDiagram = useCallback(async (mode: string = 'overview') => {
    setUnderstandBusyAction(`Creating ${mode} map`);
    try {
      const sessionId = currentSessionId || await ensureControlSession();
      const diagram = await nexus.understand.createDiagram({
        mode,
        sessionId,
        show: true,
      });
      await refreshUnderstandStatus();
      await refreshWorkspaceFiles();
      setUnderstandMessage(`Created ${diagram?.name || mode} diagram.`);
      stageFocus(buildStageFromDiagram(diagram), 'ai-focus');
      appendFocusEvent(createFocusEvent('Code map created', String(diagram?.name || mode), 'Understand-Anything', 'diagram'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code map creation failed.';
      setUnderstandMessage(message);
      appendFocusEvent(createFocusEvent('Code map failed', truncateText(message, 140), 'Understand-Anything', 'error'));
    } finally {
      setUnderstandBusyAction('');
    }
  }, [appendFocusEvent, currentSessionId, ensureControlSession, nexus.understand, refreshUnderstandStatus, refreshWorkspaceFiles, stageFocus]);

  const ingestUnderstandKnowledge = useCallback(async () => {
    setUnderstandBusyAction('Ingesting code knowledge');
    try {
      const sessionId = currentSessionId || await ensureControlSession();
      const result = await nexus.understand.ingestKnowledge({ sessionId });
      await Promise.all([refreshKnowledge(sessionId), refreshUnderstandStatus(), refreshWorkspaceFiles()]);
      setUnderstandMessage(result?.message || `Ingested ${Number(result?.count || 0)} code graph documents.`);
      appendFocusEvent(createFocusEvent('Code knowledge ingested', result?.message || 'Understand-Anything graph summaries are searchable now.', 'Knowledge Base', 'knowledge'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code knowledge ingest failed.';
      setUnderstandMessage(message);
      appendFocusEvent(createFocusEvent('Code knowledge failed', truncateText(message, 140), 'Understand-Anything', 'error'));
    } finally {
      setUnderstandBusyAction('');
    }
  }, [appendFocusEvent, currentSessionId, ensureControlSession, nexus.understand, refreshKnowledge, refreshUnderstandStatus, refreshWorkspaceFiles]);

  const openUnderstandDashboard = useCallback(async () => {
    setUnderstandBusyAction('Opening graph dashboard');
    try {
      const result = await nexus.understand.openDashboard({ open: true });
      await refreshUnderstandStatus();
      setUnderstandMessage(result?.url ? `Dashboard open: ${result.url}` : 'Dashboard requested.');
      appendFocusEvent(createFocusEvent('Code graph dashboard', String(result?.url || 'Dashboard opened'), 'Understand-Anything', 'browser'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard open failed.';
      setUnderstandMessage(message);
    } finally {
      setUnderstandBusyAction('');
    }
  }, [appendFocusEvent, nexus.understand, refreshUnderstandStatus]);

  const moveDiagramNode = useCallback(async (diagramId: string, nodeId: string, x: number, y: number) => {
    const updated = await nexus.diagrams.moveNode(diagramId, nodeId, x, y);
    setDiagramControlStatus(`Moved ${nodeId}`);
    stageFocus(buildStageFromDiagram(updated), 'ai-focus');
    appendFocusEvent(createFocusEvent('Diagram node moved', `${nodeId} -> ${x}, ${y}`, 'Diagram Co-Edit', 'diagram'));
    await refreshWorkspaceFiles();
  }, [appendFocusEvent, nexus.diagrams, refreshWorkspaceFiles, stageFocus]);

  const toggleHandControl = useCallback(() => {
    setControlLayer((previous) => {
      const next = !previous.handControl;
      if (next) {
        appendFocusEvent(createFocusEvent('Hand Control on', 'Gesture input is treated as an active collaboration surface.', 'Control Layer', 'voice'));
      }
      return { ...previous, collaboration: previous.collaboration || next, handControl: next };
    });
  }, [appendFocusEvent]);

  const toggleCollaborationLayer = useCallback(() => {
    if (!controlLayer.collaboration) {
      setControlLayer((previous) => ({ ...previous, collaboration: true }));
      appendFocusEvent(createFocusEvent('Collaboration Mode on', 'Shared voice, browser, meeting, and diagram controls are available.', 'Control Layer', 'activity'));
      return;
    }

    stopEyeContactMode();
    if (meetingModeActiveRef.current) {
      void toggleMeetingMode();
    }
    setControlLayer({
      collaboration: false,
      eyeContact: false,
      handControl: false,
      browserControl: false,
      meetingMode: false,
      diagramCoEdit: false,
    });
    setBrowserControlStatus('Browser control off');
    setDiagramControlStatus('Diagram co-edit off');
    appendFocusEvent(createFocusEvent('Collaboration Mode off', 'Shared control toggles are off.', 'Control Layer', 'activity'));
  }, [appendFocusEvent, controlLayer.collaboration, stopEyeContactMode, toggleMeetingMode]);

  const handleCreateBriefing = useCallback(async () => {
    if (!currentSessionId || !currentSession) {
      return;
    }
    const briefing = await nexus.sessions.generateBriefing(currentSessionId, currentSession.name, messages);
    if (briefing?.markdownPath) {
      const artifact = await loadArtifact(String(briefing.markdownPath));
      stageFocus({
        kind: 'artifact',
        title: briefing.title || 'Generated Briefing',
        subtitle: 'Presentation-ready written briefing',
        summary: String(briefing.markdownPath),
        data: artifact,
      });
      await refreshWorkspaceFiles();
    }
  }, [currentSession, currentSessionId, loadArtifact, messages, nexus.sessions, refreshWorkspaceFiles, stageFocus]);

  const handleExportPdf = useCallback(async () => {
    if (!currentSessionId || !currentSession) {
      return;
    }
    const result = await nexus.sessions.exportPdf(currentSessionId, currentSession.name, messages);
    if (result?.path) {
      const artifact = await loadArtifact(String(result.path));
      stageFocus({
        kind: 'artifact',
        title: result.name || 'Session PDF',
        subtitle: 'Exported from current session',
        summary: String(result.path),
        data: artifact,
      });
      await refreshWorkspaceFiles();
    }
  }, [currentSession, currentSessionId, loadArtifact, messages, nexus.sessions, refreshWorkspaceFiles, stageFocus]);

  const handleSend = useCallback(async () => {
    const trimmed = composer.trim();
    if (!trimmed || !currentSessionId) {
      return;
    }

    setComposer('');
    setIsSending(true);
    setMessages((previous) => [
      ...previous,
      {
        id: `${Date.now()}-user`,
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      },
    ]);
    setVoiceSummary('Routing your request through the shared Nexus backend.');
    setVoiceMeta('AI Focus will retarget as new evidence, tools, or artifacts appear.');
    appendFocusEvent(createFocusEvent('User request', truncateText(trimmed, 140), 'Composer input sent to Nexus', 'chat'));

    try {
      if (meetingModeActiveRef.current) {
        await nexus.meetingMode.addTranscript(trimmed, 'User');
        setMeetingControlStatus('Transcript captured');
      }

      const activeVoiceHandle = conversationStatus === 'connected' ? conversationRef.current : null;
      if (activeVoiceHandle && typeof activeVoiceHandle.sendUserMessage === 'function') {
        try {
          await nexus.chat.append(currentSessionId, 'user', trimmed);
          rememberVoiceTextHandoff(trimmed);
          activeVoiceHandle.sendUserMessage(trimmed);

          const sessionMessages = await loadSessionMessages(currentSessionId);
          await Promise.all([
            refreshSessions(currentSessionId),
            refreshKnowledge(currentSessionId),
            refreshWorkspaceFiles(),
          ]);
          setVoiceSummary('Sent to the live ElevenLabs agent.');
          setVoiceMeta('Typed or pasted content is now handed to voice and saved in the current Nexus session.');
          appendFocusEvent(createFocusEvent('Voice text handoff', truncateText(trimmed, 140), 'Sent to active ElevenLabs session', 'voice'));
          await presentLatestAssistantToolResults(sessionMessages);
          if (activeTab !== 'chat') {
            setDockMode('full');
          }
          return;
        } catch (voiceError) {
          consumeVoiceTextHandoff(trimmed);
          appendFocusEvent(createFocusEvent(
            'Voice handoff failed',
            voiceError instanceof Error ? voiceError.message : 'Falling back to text chat.',
            'Composer input was not accepted by ElevenLabs',
            'error',
          ));
        }
      }

      await nexus.chat.send(currentSessionId, trimmed);
      const sessionMessages = await loadSessionMessages(currentSessionId);
      await Promise.all([
        refreshSessions(currentSessionId),
        refreshKnowledge(currentSessionId),
        refreshWorkspaceFiles(),
      ]);
      await presentLatestAssistantToolResults(sessionMessages);
      if (sessionRuntime?.mode === 'text_session') {
        await runSessionCycle('user_message', trimmed);
      }
      if (activeTab !== 'chat') {
        setDockMode('full');
      }
    } catch (error) {
      appendFocusEvent(createFocusEvent('Send failed', error instanceof Error ? error.message : 'Unknown error', 'Chat send error', 'error'));
    } finally {
      setIsSending(false);
    }
  }, [
    activeTab,
    appendFocusEvent,
    composer,
    consumeVoiceTextHandoff,
    conversationStatus,
    currentSessionId,
    loadSessionMessages,
    nexus.chat,
    nexus.meetingMode,
    presentLatestAssistantToolResults,
    refreshKnowledge,
    refreshSessions,
    refreshWorkspaceFiles,
    rememberVoiceTextHandoff,
    runSessionCycle,
    sessionRuntime?.mode,
  ]);

  const handleSearchWeb = useCallback(async () => {
    const query = webQuery.trim();
    if (!query) {
      return;
    }
    setWebLoading(true);
    try {
      const results = await nexus.scrape.search(query);
      const normalizedResults = Array.isArray(results) ? results : [];
      setWebResults(normalizedResults);
      setFocusStage({
        kind: 'browser',
        title: `Searching: ${query}`,
        subtitle: 'Results staged in AI Focus',
        summary: 'Nexus can now pivot across sources and open the best match.',
        data: { query, results: normalizedResults, page: null },
      });
      setActiveTab('ai-focus');
      setDockMode('full');
      appendFocusEvent(createFocusEvent('Web search', query, `${normalizedResults.length} results`, 'search'));
    } finally {
      setWebLoading(false);
    }
  }, [appendFocusEvent, nexus.scrape, webQuery]);

  const openSearchResult = useCallback(async (result: any, target: 'focus' | 'workstation' = 'focus') => {
    if (!result?.url) {
      return;
    }
    const page = await nexus.scrape.url(String(result.url));
    const stage: StageState = {
      kind: 'browser',
      title: String(page?.title || result.title || 'Browser focus'),
      subtitle: String(page?.url || result.url),
      summary: truncateText(page?.metadata?.description || page?.text || result.snippet || '', 180),
      data: {
        query: webQuery.trim(),
        results: webResults,
        page,
      },
    };

    if (target === 'focus') {
      stageFocus(stage, 'ai-focus');
    } else {
      stageWorkstation(stage);
    }

    appendFocusEvent(createFocusEvent('Opened source', String(page?.title || result.title || result.url), String(page?.url || result.url), 'browser'));
  }, [appendFocusEvent, nexus.scrape, stageFocus, stageWorkstation, webQuery, webResults]);

  const handleKnowledgeSearch = useCallback(async () => {
    const query = knowledgeQuery.trim();
    if (!query) {
      return;
    }
    const results = await nexus.knowledge.globalSearch(query, {
      sessionId: currentSessionId || undefined,
      limitPerSource: 8,
    });
    setKnowledgeResults(results || null);
    setSelectedKnowledgeCluster('documents');
    stageWorkstation({
      kind: 'graph',
      title: `Knowledge search: ${query}`,
      subtitle: 'Clustered evidence surfaced from the current knowledge base.',
      summary: 'Click documents to open them in the workstation or present them in AI Focus.',
      data: results,
    });
  }, [currentSessionId, knowledgeQuery, nexus.knowledge, stageWorkstation]);

  const createKnowledgeGraphDiagram = useCallback(async () => {
    setKnowledgeGraphBusy('Creating graph diagram');
    try {
      const result = await nexus.knowledge.createGraphDiagram({
        sessionId: currentSessionId || undefined,
        maxNodes: 24,
        show: true,
      });
      await Promise.all([refreshKnowledge(currentSessionId), refreshWorkspaceFiles()]);
      appendFocusEvent(createFocusEvent(
        'Knowledge graph diagram',
        String(result?.name || 'Created Nexus knowledge graph diagram.'),
        'Understand Anything',
        'diagram',
      ));
    } catch (error) {
      appendFocusEvent(createFocusEvent(
        'Knowledge graph failed',
        truncateText(error instanceof Error ? error.message : 'Knowledge graph diagram failed.', 140),
        'Understand Anything',
        'error',
      ));
    } finally {
      setKnowledgeGraphBusy('');
    }
  }, [appendFocusEvent, currentSessionId, nexus.knowledge, refreshKnowledge, refreshWorkspaceFiles]);

  const openKnowledgeGraphDashboard = useCallback(async () => {
    setKnowledgeGraphBusy('Opening graph dashboard');
    try {
      const result = await nexus.knowledge.openGraphDashboard({
        sessionId: currentSessionId || undefined,
        open: true,
      });
      await refreshKnowledge(currentSessionId);
      appendFocusEvent(createFocusEvent(
        'Knowledge graph dashboard',
        String(result?.url || 'Understand Anything dashboard opened.'),
        'Understand Anything',
        'browser',
      ));
    } catch (error) {
      appendFocusEvent(createFocusEvent(
        'Knowledge dashboard failed',
        truncateText(error instanceof Error ? error.message : 'Knowledge graph dashboard failed.', 140),
        'Understand Anything',
        'error',
      ));
    } finally {
      setKnowledgeGraphBusy('');
    }
  }, [appendFocusEvent, currentSessionId, nexus.knowledge, refreshKnowledge]);

  const syncKnowledgeGraph = useCallback(async () => {
    setKnowledgeGraphBusy('Syncing graph');
    try {
      const result = await nexus.knowledge.graphStatus(currentSessionId || undefined);
      await refreshKnowledge(currentSessionId);
      appendFocusEvent(createFocusEvent(
        'Knowledge graph synced',
        `${Number(result?.stats?.nodes || 0)} nodes and ${Number(result?.stats?.edges || 0)} edges are available in Understand Anything.`,
        'Understand Anything',
        'knowledge',
      ));
      return result;
    } catch (error) {
      appendFocusEvent(createFocusEvent(
        'Knowledge sync failed',
        truncateText(error instanceof Error ? error.message : 'Knowledge graph sync failed.', 140),
        'Understand Anything',
        'error',
      ));
      throw error;
    } finally {
      setKnowledgeGraphBusy('');
    }
  }, [appendFocusEvent, currentSessionId, nexus.knowledge, refreshKnowledge]);

  const handleAnalyzeUpload = useCallback(async () => {
    if (!currentSessionId) {
      return;
    }
    setLegalBusy(true);
    try {
      await nexus.legal.pickAndAnalyzeUpload(currentSessionId);
      await Promise.all([refreshKnowledge(currentSessionId), refreshWorkspaceFiles()]);
    } finally {
      setLegalBusy(false);
    }
  }, [currentSessionId, nexus.legal, refreshKnowledge, refreshWorkspaceFiles]);

  const handleAnalyzeLegalUrl = useCallback(async () => {
    if (!currentSessionId || !legalUrl.trim()) {
      return;
    }
    setLegalBusy(true);
    try {
      await nexus.legal.analyzeUrl(currentSessionId, legalUrl.trim());
      await Promise.all([refreshKnowledge(currentSessionId), refreshWorkspaceFiles()]);
    } finally {
      setLegalBusy(false);
    }
  }, [currentSessionId, legalUrl, nexus.legal, refreshKnowledge, refreshWorkspaceFiles]);

  const handleOpenLatestReport = useCallback(async () => {
    if (!currentSessionId) {
      return;
    }
    setLegalBusy(true);
    try {
      await nexus.legal.openReport(currentSessionId, { latest: true });
    } finally {
      setLegalBusy(false);
    }
  }, [currentSessionId, nexus.legal]);

  const recordVoiceTurn = useCallback(async (
    role: MessageRecord['role'],
    content: string,
    model: string,
  ) => {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent || !currentSessionId) {
      return;
    }

    setMessages((previous) => [
      ...previous,
      {
        id: `voice-${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        content: normalizedContent,
        timestamp: Date.now(),
        model,
      },
    ]);

    try {
      await nexus.chat.append(currentSessionId, role === 'system' ? 'assistant' : role, normalizedContent);
      if (meetingModeActiveRef.current) {
        await nexus.meetingMode.addTranscript(normalizedContent, role === 'assistant' ? 'Nexus' : 'User');
        setMeetingControlStatus('Transcript captured');
      }
      await refreshSessions(currentSessionId);
    } catch (error) {
      console.warn('[NexusNext] failed to persist voice turn', error);
    }
  }, [currentSessionId, nexus.chat, nexus.meetingMode, refreshSessions]);

  const buildVoiceResumeContext = useCallback((reason: string, attempt: number): string => {
    const messageHistory = messagesRef.current
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-6);
    const lastUserMessageText = [...messageHistory].reverse().find((message) => message.role === 'user')?.content || '';
    const lastAssistantMessageText = [...messageHistory].reverse().find((message) => message.role === 'assistant')?.content || '';
    const recentEventLines = focusEventsRef.current
      .slice(-4)
      .map((event) => truncateText(`${event.label}: ${event.summary}${event.meta ? ` (${event.meta})` : ''}`, 140));
    const recentFileLines = workspaceFilesRef.current
      .slice(0, 4)
      .map((file) => String(file?.name || getPathTail(file?.path || '')).trim())
      .filter(Boolean);
    const focusStageSnapshot = focusStageRef.current;
    const workstationStageSnapshot = workstationStageRef.current;
    const focusStageLine = isDefaultFocusStage(focusStageSnapshot)
      ? ''
      : `${focusStageSnapshot.title}: ${truncateText(focusStageSnapshot.subtitle || focusStageSnapshot.summary || '', 140)}`;
    const workstationStageLine = isDefaultWorkstationStage(workstationStageSnapshot)
      ? ''
      : `${workstationStageSnapshot.title}: ${truncateText(workstationStageSnapshot.subtitle || workstationStageSnapshot.summary || '', 140)}`;
    const lastToolLine = voiceRecoveryRef.current.lastToolName
      ? `${voiceRecoveryRef.current.lastToolName}: ${truncateText(
          `${voiceRecoveryRef.current.lastToolSummary}${voiceRecoveryRef.current.lastToolMeta ? ` (${voiceRecoveryRef.current.lastToolMeta})` : ''}`,
          180,
        )}`
      : '';
    const artifactLine = voiceRecoveryRef.current.lastArtifactPath
      ? `${voiceRecoveryRef.current.lastArtifactName || getPathTail(voiceRecoveryRef.current.lastArtifactPath)} @ ${voiceRecoveryRef.current.lastArtifactPath}`
      : '';

    return [
      `Resume attempt ${attempt} after disconnect: ${truncateText(reason, 180)}`,
      currentSessionRef.current?.name ? `Session: ${currentSessionRef.current.name}` : '',
      lastUserMessageText ? `Last user request: ${truncateText(lastUserMessageText, 260)}` : '',
      lastAssistantMessageText ? `Last assistant message: ${truncateText(lastAssistantMessageText, 220)}` : '',
      lastToolLine ? `Latest tool state: ${lastToolLine}` : '',
      artifactLine ? `Known artifact: ${artifactLine}` : '',
      focusStageLine ? `AI Focus: ${focusStageLine}` : '',
      workstationStageLine ? `Workstation: ${workstationStageLine}` : '',
      recentEventLines.length ? `Recent execution: ${recentEventLines.join(' | ')}` : '',
      recentFileLines.length ? `Recent files: ${recentFileLines.join(' | ')}` : '',
      'If the task is long, continue from existing files or tool state instead of restarting. Break the work into smaller steps and keep the next spoken response extremely short.',
    ].filter(Boolean).join('\n');
  }, []);

  const scheduleVoiceAutoResume = useCallback((reason: string, targetSessionId: string) => {
    const recovery = voiceRecoveryRef.current;

    if (recovery.manualStop) {
      recovery.manualStop = false;
      recovery.autoResumeAttempts = 0;
      recovery.recovering = false;
      recovery.hiddenResumePrompt = '';
      return;
    }

    if (recovery.scheduledResumeTimer) {
      window.clearTimeout(recovery.scheduledResumeTimer);
      recovery.scheduledResumeTimer = null;
    }

    const nextAttempt = recovery.autoResumeAttempts + 1;
    recovery.autoResumeAttempts = nextAttempt;

    if (nextAttempt > MAX_VOICE_AUTO_RESUME_ATTEMPTS) {
      recovery.recovering = false;
      recovery.hiddenResumePrompt = '';
      appendFocusEvent(createFocusEvent(
        'Voice recovery exhausted',
        'Voice disconnected repeatedly during the same task.',
        'Manual follow-up or typed continuation may be needed.',
        'voice',
      ));
      setVoiceSummary('Voice dropped too many times during one task.');
      setVoiceMeta('The task context is preserved, but automatic voice recovery has stopped for now.');
      return;
    }

    const resumeContext = buildVoiceResumeContext(reason, nextAttempt);
    const hiddenUserMessage = [
      HIDDEN_VOICE_RESUME_PREFIX,
      `Resume the interrupted task immediately. Do not restart from the beginning. Use any completed tools, files, and artifacts that already exist. ${nextAttempt > 1 ? 'Be even shorter this time.' : 'Keep your next spoken response under 18 words.'}`,
      'If the task is something like drafting an NDA, finish the artifact first, then give only a short status update.',
      resumeContext,
    ].join('\n');

    recovery.recovering = true;
    recovery.hiddenResumePrompt = hiddenUserMessage;

    appendFocusEvent(createFocusEvent(
      'Voice recovery',
      'Session dropped during an active task. Reconnecting with saved task context.',
      `Attempt ${nextAttempt} of ${MAX_VOICE_AUTO_RESUME_ATTEMPTS}`,
      'voice',
    ));
    setVoiceSummary('Voice session dropped. Resuming without restarting the task.');
    setVoiceMeta(`Reconnect attempt ${nextAttempt} of ${MAX_VOICE_AUTO_RESUME_ATTEMPTS}. Nexus is reusing the last tool and artifact context.`);

    recovery.scheduledResumeTimer = window.setTimeout(() => {
      recovery.scheduledResumeTimer = null;
      void startConversationRef.current?.({
        suppressGreeting: true,
        recoveryAttempt: nextAttempt,
        resumeContext,
        hiddenUserMessage,
      });
    }, 1200);
  }, [appendFocusEvent, buildVoiceResumeContext]);

  const startConversation = useCallback(async (options: VoiceStartOptions = {}) => {
    if (conversationStatus === 'connected' || conversationStatus === 'connecting') {
      return;
    }

    voiceRecoveryRef.current.manualStop = false;

    let targetSessionId = currentSessionId;
    if (!targetSessionId) {
      try {
        const stamp = new Date().toLocaleString();
        const created = await nexus.sessions.create(`Session ${stamp}`, 'Created from Nexus Next shell');
        targetSessionId = String(created?.id || '').trim() || null;
        if (!targetSessionId) {
          throw new Error('Could not create a session for the voice conversation.');
        }
        setCurrentSessionId(targetSessionId);
        await Promise.all([
          loadSessionMessages(targetSessionId),
          refreshKnowledge(targetSessionId),
          refreshSessions(targetSessionId),
        ]);
      } catch (error: any) {
        const detail = String(error?.message || 'Unknown error');
        setConversationStatus('error');
        setConversationErrorDetail(detail);
        appendFocusEvent(createFocusEvent('Voice start failed', truncateText(detail, 140), 'Session creation error', 'voice'));
        return;
      }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setConversationStatus('error');
      setConversationErrorDetail('Microphone capture is not supported in this environment.');
      setVoiceSummary('Voice channel unavailable on this device.');
      setVoiceMeta('Microphone capture is not supported in this environment.');
      return;
    }

    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch {
        // Ignore stale session teardown failures.
      }
      conversationRef.current = null;
    }

    setConversationStatus('connecting');
    setConversationMode('idle');
    setConversationErrorDetail('');

    try {
      let microphonePreflightStream: MediaStream | null = null;
      try {
        microphonePreflightStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error: any) {
        throw new Error(describeVoiceInitError(error));
      } finally {
        stopMediaStreamTracks(microphonePreflightStream);
      }

      const { Conversation } = await import('@elevenlabs/client');
      const agentConfig = await nexus.elevenlabs.getAgentConfig(targetSessionId);

      if (!agentConfig?.agentId) {
        throw new Error('ElevenLabs Agent ID is missing. Open Settings and save a valid agent.');
      }

      let activeConversationId = conversationId || '';
      let activeConversationHandle: any = null;
      const sessionOptions: Record<string, any> = {};
      let signedUrlStartupError = '';

      if (agentConfig.hasApiKey) {
        try {
          const { signedUrl } = await nexus.elevenlabs.getSignedUrl();
          sessionOptions.signedUrl = signedUrl;
          sessionOptions.connectionType = 'websocket';
        } catch (error: any) {
          signedUrlStartupError = describeVoiceInitError(error);
          sessionOptions.agentId = agentConfig.agentId;
          sessionOptions.connectionType = 'websocket';
          activeConversationId = `conv_${Date.now()}`;
          setConversationId(activeConversationId);
          appendFocusEvent(createFocusEvent(
            'Voice transport fallback',
            truncateText(signedUrlStartupError, 140),
            'Falling back to direct agent startup',
            'voice',
          ));
        }
      } else {
        sessionOptions.agentId = agentConfig.agentId;
        sessionOptions.connectionType = 'websocket';
        activeConversationId = `conv_${Date.now()}`;
        setConversationId(activeConversationId);
      }

      const clientTools: Record<string, (params: any) => Promise<string>> = {};
      for (const toolDef of Array.isArray(agentConfig.toolDefinitions) ? agentConfig.toolDefinitions : []) {
        const toolName = String(toolDef?.name || '').trim();
        if (!toolName) {
          continue;
        }

        clientTools[toolName] = async (params: any) => {
          voiceRecoveryRef.current.lastToolName = toolName;
          const pendingInspectionStage = buildInspectionStageFromTool(toolName, params || {}, null, 'pending');
          if (pendingInspectionStage) {
            stageFocus(pendingInspectionStage, 'ai-focus');
          }
          const result = await nexus.elevenlabs.executeToolCall(
            toolName,
            params || {},
            activeConversationId,
            targetSessionId,
          );

          await Promise.allSettled([
            refreshKnowledge(targetSessionId),
            refreshWorkspaceFiles(),
            refreshEntityPreview(),
            refreshMediaStatus(),
            refreshSessions(targetSessionId),
          ]);

          if (!result?.success) {
            const message = String(result?.error || `${toolName} failed`).trim();
            voiceRecoveryRef.current.lastToolSummary = truncateText(message, 180);
            voiceRecoveryRef.current.lastToolMeta = 'Tool failed';
            appendFocusEvent(createFocusEvent(`Tool failed: ${toolName}`, truncateText(message, 140), 'Voice tool', 'error'));
            return `Error: ${message}`;
          }

          const isShellDrivenPresentation = toolName === 'open_webpage'
            || toolName === 'draw_diagram'
            || toolName === 'show_diagram'
            || (toolName === 'open_agent_workflow' && result.result?.workflow);
          if (!isShellDrivenPresentation) {
            const { summary, meta } = summarizeToolExecution(toolName, result.result);
            voiceRecoveryRef.current.lastToolSummary = summary;
            voiceRecoveryRef.current.lastToolMeta = meta;
            const inspectionStage = buildInspectionStageFromTool(toolName, params || {}, result.result, 'complete');
            if (inspectionStage) {
              stageFocus(inspectionStage, 'ai-focus');
            }
            const artifactPath = String(result?.result?.path || '').trim();
            if (artifactPath) {
              voiceRecoveryRef.current.lastArtifactPath = artifactPath;
              voiceRecoveryRef.current.lastArtifactName = String(result?.result?.title || getPathTail(artifactPath)).trim();
              void loadArtifact(artifactPath).then((artifact) => {
                stageFocus(buildStageFromArtifact(artifact), 'ai-focus');
              }).catch((error) => {
                console.warn('[NexusNext] failed to stage created artifact in AI Focus', error);
              });
            }
            appendFocusEvent(createFocusEvent(`Tool: ${toolName}`, summary, meta, 'tool'));
          }

          return formatVoiceToolResultForModel(toolName, result.result);
        };
      }

      const startSessionWithOptions = async (optionsForSession: Record<string, any>) => Conversation.startSession({
        ...sessionOptions,
        ...optionsForSession,
        workletPaths: {
          rawAudioProcessor: rawAudioProcessorWorkletUrl,
          audioConcatProcessor: audioConcatProcessorWorkletUrl,
        },
        libsampleratePath: libsamplerateWorkletUrl,
        overrides: agentConfig.overrides,
        clientTools,
        onConnect: ({ conversationId: connectedConversationId }: any) => {
          activeConversationId = connectedConversationId || activeConversationId;
          if (activeConversationId) {
            setConversationId(activeConversationId);
          }
          setConversationStatus('connected');
          setConversationMode('listening');
          setConversationErrorDetail('');
          try {
            activeConversationHandle?.setMicMuted?.(isVoiceMicMuted);
          } catch {
            // Ignore mic mute application errors on connect.
          }
          if (options.recoveryAttempt) {
            appendFocusEvent(createFocusEvent(
              'Voice resumed',
              'Reconnected to continue the interrupted task.',
              `Recovery attempt ${options.recoveryAttempt}`,
              'voice',
            ));
          }
          appendFocusEvent(createFocusEvent('Voice connected', 'ElevenLabs conversation is live.', 'Microphone channel ready', 'voice'));
          if (targetSessionId) {
            void nexus.sessionRuntime.start(targetSessionId, {
              mode: 'voice_session',
              trigger: options.recoveryAttempt ? 'voice_reconnect' : 'voice_connect',
              runInitialCycle: !options.recoveryAttempt,
            }).catch((error) => {
              console.warn('[NexusNext] failed to start voice session runtime', error);
            });
          }
        },
        onDisconnect: async (details: any) => {
          if (conversationRef.current === activeConversationHandle) {
            conversationRef.current = null;
          }
          setConversationStatus('disconnected');
          setConversationMode('idle');
          setIsVoiceMicMuted(false);

          const wasManualStop = voiceRecoveryRef.current.manualStop;

          const reason = String(
            details?.message
            || details?.closeReason
            || details?.context?.message
            || details?.reason
            || '',
          ).trim();

          if (activeConversationId) {
            try {
              await nexus.elevenlabs.endSession(activeConversationId, targetSessionId);
            } catch (error) {
              console.warn('[NexusNext] failed to finalize voice session', error);
            }
          }

          if (shouldAutoResumeVoiceDisconnect(details, reason, wasManualStop)) {
            scheduleVoiceAutoResume(reason || 'Voice session disconnected unexpectedly.', targetSessionId);
          } else if (reason) {
            appendFocusEvent(createFocusEvent('Voice disconnected', truncateText(reason, 140), 'ElevenLabs session ended', 'voice'));
          }
        },
        onMessage: (message: any) => {
          const transcriptText = String(message?.message || '').replace(/\s+/g, ' ').trim();
          const source = String(message?.source || message?.role || '').toLowerCase();
          const isFinal = typeof message?.isFinal === 'boolean' ? message.isFinal : true;

          if (!transcriptText || !isFinal) {
            return;
          }

          if (source === 'user') {
            if (transcriptText.startsWith(HIDDEN_VOICE_RESUME_PREFIX)) {
              return;
            }
            const alreadyPersistedTextHandoff = consumeVoiceTextHandoff(transcriptText);
            void nexus.elevenlabs.addTranscript(activeConversationId, 'user', transcriptText);
            if (!alreadyPersistedTextHandoff) {
              void recordVoiceTurn('user', transcriptText, 'ElevenLabs Transcript');
            }
            return;
          }

          if (source === 'ai' || source === 'agent') {
            void nexus.elevenlabs.addTranscript(activeConversationId, 'agent', transcriptText);
            void recordVoiceTurn('assistant', transcriptText, 'ElevenLabs Voice');
            if (voiceRecoveryRef.current.recovering) {
              voiceRecoveryRef.current.recovering = false;
              voiceRecoveryRef.current.autoResumeAttempts = 0;
              voiceRecoveryRef.current.hiddenResumePrompt = '';
              setVoiceSummary('Voice recovered and continued the active task.');
              setVoiceMeta('Nexus resumed from the interruption without restarting the workflow.');
            }
          }
        },
        onError: (message: string, context?: any) => {
          setConversationStatus('error');
          const contextText = context
            ? ` (${typeof context === 'string' ? context : safeJsonPreview(context)})`
            : '';
          setConversationErrorDetail(`${message}${contextText}`);
          appendFocusEvent(createFocusEvent('Voice error', truncateText(`${message}${contextText}`, 140), 'ElevenLabs conversation error', 'voice'));
        },
        onModeChange: (mode: any) => {
          setConversationMode(mode?.mode === 'speaking' ? 'speaking' : 'listening');
        },
        onStatusChange: (status: any) => {
          if (status?.status) {
            setConversationStatus(status.status as ConversationStatus);
          }
        },
      } as any);

      let conversation: any;
      try {
        conversation = await startSessionWithOptions({});
      } catch (error: any) {
        const startupError = describeVoiceInitError(error);
        const canFallbackDirectly = !sessionOptions.agentId && !!agentConfig.agentId;
        if (!canFallbackDirectly) {
          throw error;
        }

        activeConversationId = `conv_${Date.now()}`;
        setConversationId(activeConversationId);
        appendFocusEvent(createFocusEvent(
          'Voice transport fallback',
          truncateText(startupError, 140),
          'Signed URL startup failed, retrying direct agent startup',
          'voice',
        ));

        conversation = await startSessionWithOptions({
          agentId: agentConfig.agentId,
          connectionType: 'websocket',
          signedUrl: undefined,
        });
      }

      activeConversationHandle = conversation;
      conversationRef.current = conversation;

      if (signedUrlStartupError) {
        setVoiceMeta(`Direct agent fallback is active. ${signedUrlStartupError}`);
      }

      if (agentConfig.contextualPrompt || options.resumeContext) {
        window.setTimeout(() => {
          try {
            const contextualUpdate = [
              options.suppressGreeting
                ? 'This is a reconnection after an interrupted live session. Do not greet, do not restart the task, and keep the next spoken response extremely short.'
                : '',
              agentConfig.contextualPrompt,
              options.resumeContext,
            ]
              .filter((value) => String(value || '').trim())
              .join('\n\n');
            activeConversationHandle?.sendContextualUpdate?.(contextualUpdate);
          } catch {
            // Ignore contextual update failures.
          }
        }, 300);
      }

      if (options.hiddenUserMessage) {
        window.setTimeout(() => {
          try {
            activeConversationHandle?.sendUserMessage?.(options.hiddenUserMessage);
          } catch {
            // Ignore hidden resume signal failures.
          }
        }, 850);
      }
    } catch (error: any) {
      const detail = describeVoiceInitError(error);
      conversationRef.current = null;
      setConversationId(null);
      setConversationStatus('error');
      setConversationErrorDetail(detail);
      void nexus.bugs.record({
        sessionId: targetSessionId || undefined,
        source: options.recoveryAttempt ? 'renderer:voice_recovery_start' : 'renderer:voice_start',
        severity: 'high',
        intent: options.recoveryAttempt
          ? 'Reconnect and resume the ElevenLabs voice session.'
          : 'Start a live ElevenLabs voice session from the Nexus Next shell.',
        actual: detail,
        suggestedSolution: 'Check microphone permission, ElevenLabs configuration, signed URL startup, and direct agent fallback behavior.',
        context: {
          recoveryAttempt: options.recoveryAttempt || 0,
          sessionId: targetSessionId || undefined,
          currentConversationId: conversationId || undefined,
        },
        stack: error?.stack,
      }).catch(() => undefined);
      if (options.recoveryAttempt) {
        appendFocusEvent(createFocusEvent(
          'Voice recovery failed',
          truncateText(detail, 140),
          `Reconnect attempt ${options.recoveryAttempt}`,
          'voice',
        ));
        setVoiceSummary('Voice recovery failed.');
        setVoiceMeta('Nexus kept the task context, but the reconnect attempt did not complete.');
      }
      appendFocusEvent(createFocusEvent('Voice start failed', truncateText(detail, 140), 'ElevenLabs initialization error', 'voice'));
    }
  }, [
    appendFocusEvent,
    consumeVoiceTextHandoff,
    conversationId,
    conversationStatus,
    currentSessionId,
    isVoiceMicMuted,
    loadSessionMessages,
    nexus.elevenlabs,
    nexus.sessionRuntime,
    nexus.sessions,
    recordVoiceTurn,
    refreshEntityPreview,
    refreshKnowledge,
    refreshMediaStatus,
    refreshSessions,
    refreshWorkspaceFiles,
    loadArtifact,
    stageFocus,
  ]);

  const endConversation = useCallback(async () => {
    voiceRecoveryRef.current.manualStop = true;
    voiceRecoveryRef.current.recovering = false;
    voiceRecoveryRef.current.autoResumeAttempts = 0;
    voiceRecoveryRef.current.hiddenResumePrompt = '';
    if (voiceRecoveryRef.current.scheduledResumeTimer) {
      window.clearTimeout(voiceRecoveryRef.current.scheduledResumeTimer);
      voiceRecoveryRef.current.scheduledResumeTimer = null;
    }
    try {
      await conversationRef.current?.endSession?.();
    } catch {
      // Ignore provider shutdown failures.
    }
    conversationRef.current = null;
    setConversationId(null);
    setConversationStatus('disconnected');
    setConversationMode('idle');
    setConversationErrorDetail('');
    setIsVoiceMicMuted(false);
    if (currentSessionId) {
      void nexus.sessionRuntime.end(currentSessionId).catch(() => undefined);
    }
  }, []);

  const toggleVoiceMicMute = useCallback(async () => {
    const nextMuted = !isVoiceMicMuted;
    setIsVoiceMicMuted(nextMuted);
    try {
      await conversationRef.current?.setMicMuted?.(nextMuted);
    } catch (error) {
      console.warn('[NexusNext] failed to toggle ElevenLabs microphone mute', error);
    }
  }, [isVoiceMicMuted]);

  const releaseBrainstormResources = useCallback(() => {
    if (brainstormTimerRef.current !== null) {
      window.clearInterval(brainstormTimerRef.current);
      brainstormTimerRef.current = null;
    }

    const stream = brainstormStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      brainstormStreamRef.current = null;
    }

    brainstormRecorderRef.current = null;
    brainstormChunksRef.current = [];
    brainstormStartedAtRef.current = null;
  }, []);

  const blobToDataUrl = useCallback((blob: Blob): Promise<string> => (
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read brainstorm recording'));
      reader.readAsDataURL(blob);
    })
  ), []);

  const processBrainstormRecording = useCallback(async (brainstormId: string, chunks: Blob[]) => {
    const audioBlob = new Blob(chunks, { type: 'audio/webm' });
    const audioBase64 = await blobToDataUrl(audioBlob);
    const record = await nexus.brainstorm.processAudio(brainstormId, audioBase64);
    const sessionId = String(record?.sessionId || currentSessionId || '').trim();

    await Promise.allSettled([
      refreshWorkspaceFiles(),
      sessionId ? refreshKnowledge(sessionId) : Promise.resolve(),
      refreshSessions(sessionId || undefined),
    ]);

    return record as BrainstormSessionRecord;
  }, [blobToDataUrl, currentSessionId, nexus.brainstorm, refreshKnowledge, refreshSessions, refreshWorkspaceFiles]);

  const beginBrainstormCapture = useCallback(async () => {
    if (!currentSessionId) {
      throw new Error('Create or select a session before starting a brainstorm.');
    }

    if (isBrainstormRecording) {
      throw new Error('A brainstorm recording is already in progress.');
    }

    if (isBrainstormProcessing) {
      throw new Error('A brainstorm is already being processed.');
    }

    if (conversationStatus === 'connected' || conversationStatus === 'connecting') {
      await endConversation();
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This environment does not support microphone capture.');
    }

    const title = `${truncateText(currentSession?.name || 'Brainstorm', 48)} Brainstorm`;
    const record = await nexus.brainstorm.start(currentSessionId, title);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    brainstormStreamRef.current = stream;

    const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    brainstormChunksRef.current = [];
    activeBrainstormIdRef.current = String(record?.id || '').trim() || null;
    brainstormRecorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        brainstormChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      releaseBrainstormResources();
      activeBrainstormIdRef.current = null;
      setIsBrainstormRecording(false);
      setIsBrainstormProcessing(false);
      setBrainstormElapsedMs(0);
      appendFocusEvent(createFocusEvent('Brainstorm failed', 'Recording failed before processing could begin.', 'Microphone capture error', 'error'));
      setVoiceSummary('Brainstorm recording failed.');
      setVoiceMeta('Check microphone access and try again.');
    };

    recorder.onstop = async () => {
      const brainstormId = activeBrainstormIdRef.current;
      const chunksSnapshot = [...brainstormChunksRef.current];

      releaseBrainstormResources();
      setIsBrainstormRecording(false);

      if (!brainstormId) {
        setIsBrainstormProcessing(false);
        setBrainstormElapsedMs(0);
        return;
      }

      if (chunksSnapshot.length === 0) {
        activeBrainstormIdRef.current = null;
        setIsBrainstormProcessing(false);
        setBrainstormElapsedMs(0);
        appendFocusEvent(createFocusEvent('Brainstorm empty', 'The brainstorm recording did not capture audio.', 'No audio chunks saved', 'error'));
        setVoiceSummary('Brainstorm recording was empty.');
        setVoiceMeta('Try again after checking microphone input.');
        return;
      }

      try {
        const processed = await processBrainstormRecording(brainstormId, chunksSnapshot);
        const primaryArtifact = String(processed?.briefingPdfPath || processed?.transcriptPdfPath || '').trim();
        if (primaryArtifact) {
          await openWorkspaceFile(primaryArtifact, 'focus');
        }
        appendFocusEvent(createFocusEvent(
          'Brainstorm ready',
          truncateText(processed?.summaryExcerpt || processed?.title || 'Transcript and briefing are ready.', 140),
          primaryArtifact || 'Saved to knowledge',
          'artifact',
        ));
        setVoiceSummary('Brainstorm processed successfully.');
        setVoiceMeta('Transcript, briefing, and knowledge artifacts are ready.');
      } catch (error: any) {
        appendFocusEvent(createFocusEvent(
          'Brainstorm processing failed',
          truncateText(error?.message || 'Unknown brainstorm processing error', 140),
          'Brainstorm',
          'error',
        ));
        setVoiceSummary('Brainstorm processing failed.');
        setVoiceMeta(String(error?.message || 'Unknown brainstorm processing error'));
      } finally {
        activeBrainstormIdRef.current = null;
        setIsBrainstormProcessing(false);
        setBrainstormElapsedMs(0);
      }
    };

    recorder.start(1000);
    brainstormStartedAtRef.current = Date.now();
    setIsBrainstormRecording(true);
    setIsBrainstormProcessing(false);
    setBrainstormElapsedMs(0);
    brainstormTimerRef.current = window.setInterval(() => {
      const startedAt = brainstormStartedAtRef.current;
      if (startedAt) {
        setBrainstormElapsedMs(Date.now() - startedAt);
      }
    }, 250);

    appendFocusEvent(createFocusEvent('Brainstorm recording', `Recording "${record?.title || title}" live.`, 'Stop when you want transcript and briefing generation to begin.', 'voice'));
    setVoiceSummary('Brainstorm recording live.');
    setVoiceMeta('Speak freely, then hit Stop Brainstorm to process transcript and briefing.');
  }, [
    appendFocusEvent,
    conversationStatus,
    currentSession?.name,
    currentSessionId,
    endConversation,
    isBrainstormProcessing,
    isBrainstormRecording,
    nexus.brainstorm,
    openWorkspaceFile,
    processBrainstormRecording,
    releaseBrainstormResources,
  ]);

  const stopBrainstormCapture = useCallback(async () => {
    const recorder = brainstormRecorderRef.current;

    if (!recorder || recorder.state === 'inactive') {
      throw new Error('No active brainstorm recording to stop.');
    }

    setIsBrainstormRecording(false);
    setIsBrainstormProcessing(true);
    recorder.stop();
    appendFocusEvent(createFocusEvent('Brainstorm stopping', 'Recording stopped. Processing transcript and briefing now.', 'Brainstorm', 'voice'));
    setVoiceSummary('Brainstorm processing started.');
    setVoiceMeta('Transcribing audio, drafting briefing, and saving artifacts now.');
  }, [appendFocusEvent]);

  const toggleConversation = useCallback(() => {
    void (
      conversationStatus === 'connected' || conversationStatus === 'connecting'
        ? endConversation()
        : startConversation()
    );
  }, [conversationStatus, endConversation, startConversation]);

  useEffect(() => {
    startConversationRef.current = startConversation;
  }, [startConversation]);

  useEffect(() => {
    let disposed = false;

    const bootstrap = async () => {
      try {
        const [sessionRecords] = await Promise.all([
          nexus.sessions.list(),
          refreshWorkspaceFiles(),
          refreshEntityPreview(),
          refreshMediaStatus(),
          refreshUnderstandStatus(),
        ]);

        if (disposed) {
          return;
        }

        const mapped = Array.isArray(sessionRecords) ? sessionRecords.map(normalizeSession).sort((a, b) => b.updatedAt - a.updatedAt) : [];
        setSessions(mapped);
        if (mapped[0]?.id) {
          setCurrentSessionId(mapped[0].id);
        }
      } catch (error) {
        console.error('[NexusNext] bootstrap failed', error);
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
    };
  }, [nexus.sessions, refreshEntityPreview, refreshMediaStatus, refreshUnderstandStatus, refreshWorkspaceFiles]);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      setCurrentProject(null);
      return;
    }

    let disposed = false;

    const refresh = async () => {
      try {
        const [sessionData, docs, stats, project] = await Promise.all([
          nexus.sessions.get(currentSessionId),
          nexus.knowledge.listDocuments(currentSessionId, 48),
          nexus.knowledge.stats(currentSessionId),
          nexus.projects.getForSession(currentSessionId).catch(() => null),
        ]);

        if (disposed) {
          return;
        }

        setMessages(Array.isArray(sessionData?.messages) ? sessionData.messages.map(normalizeMessage) : []);
        setKnowledgeDocuments(Array.isArray(docs) ? docs : []);
        setKnowledgeStats(normalizeKnowledgeStats(stats));
        setCurrentProject(project || null);
      } catch (error) {
        console.error('[NexusNext] session refresh failed', error);
      }
    };

    void refresh();
    return () => {
      disposed = true;
    };
  }, [currentSessionId, nexus.knowledge, nexus.projects, nexus.sessions]);

  useEffect(() => {
    setExpandedMessageDetails({});
  }, [currentSessionId]);

  useEffect(() => {
    const unsubscribe = nexus.entityCrm.onOpenPanel((payload: any) => {
      void (async () => {
        setHeaderPanel('entity-crm');
        setHeaderPanelLoading(true);
        try {
          const roomData = await loadEntityRoomData(payload);
          setEntityCounts(roomData.counts || { people: 0, businesses: 0, links: 0 });
          setCrmPeople(Array.isArray(roomData.people) ? roomData.people : []);
          setCrmBusinesses(Array.isArray(roomData.businesses) ? roomData.businesses : []);
          setHeaderPanelData(roomData);
          setWorkstationStage(
            buildPanelStage(
              'entity-crm',
              'Entity CRM',
              'Manual browsing surface for people, businesses, notes, and relationship intelligence.',
              roomData.activeEntityType && roomData.activeEntity
                ? getEntityDisplayName(roomData.activeEntityType, roomData.activeEntity)
                : `${Number(roomData?.counts?.people || 0)} people · ${Number(roomData?.counts?.businesses || 0)} businesses`,
              roomData,
            ),
          );
          projectEntityRoomToFocus(roomData);
          if (payload?.entityType === 'business') {
            setSelectedKnowledgeCluster('businesses');
          } else if (payload?.entityType === 'person') {
            setSelectedKnowledgeCluster('people');
          }
        } catch (error) {
          setHeaderPanelData({
            error: error instanceof Error ? error.message : 'Unknown CRM overlay error',
          });
        } finally {
          setHeaderPanelLoading(false);
        }
      })();
    });

    return () => {
      unsubscribe();
    };
  }, [loadEntityRoomData, nexus.entityCrm, projectEntityRoomToFocus]);

  useEffect(() => {
    if (isBrainstormRecording) {
      setVoiceSummary('Brainstorm recording live.');
      setVoiceMeta(`Captured ${formatElapsedTime(brainstormElapsedMs)} so far. Hit Stop Brainstorm when you want processing to begin.`);
      return;
    }

    if (isBrainstormProcessing) {
      setVoiceSummary('Brainstorm is processing.');
      setVoiceMeta('Transcribing audio, separating speakers, drafting a briefing, and saving artifacts.');
      return;
    }

    if (conversationStatus === 'connected') {
      setVoiceSummary(conversationMode === 'speaking' ? 'Nexus is speaking in the live ElevenLabs session.' : 'Nexus is listening on the live ElevenLabs session.');
      setVoiceMeta('Use the mic control again to end the conversation, or keep talking to continue.');
      return;
    }

    if (conversationStatus === 'connecting') {
      setVoiceSummary('Securing the ElevenLabs voice channel.');
      setVoiceMeta('Microphone access and agent connection are being initialized.');
      return;
    }

    if (conversationStatus === 'error') {
      setVoiceSummary('Voice channel failed to initialize cleanly.');
      setVoiceMeta(conversationErrorDetail || 'Check ElevenLabs configuration in Settings, then try the mic again.');
      return;
    }

    setVoiceSummary('Maintaining live AI Focus while keeping chat and workstation separate.');
    setVoiceMeta('Click the mic tile to start a live ElevenLabs session, or use text mode below.');
  }, [brainstormElapsedMs, conversationErrorDetail, conversationMode, conversationStatus, isBrainstormProcessing, isBrainstormRecording]);

  useEffect(() => () => {
    void endConversation();
  }, [endConversation]);

  useEffect(() => {
    let cancelled = false;

    void nexus.workTrace.getRecent(32, currentSessionId || undefined).then((events: any[]) => {
      if (cancelled) {
        return;
      }
      const normalized = Array.isArray(events)
        ? events.map(normalizeWorkTraceEvent).sort((a, b) => b.timestamp - a.timestamp)
        : [];
      setWorkTraceEvents(normalized.slice(0, 32));
    }).catch((error) => {
      console.warn('[NexusNext] failed to seed work trace events', error);
    });

    const unsubscribe = nexus.workTrace.onEvent((rawEvent: any) => {
      const event = normalizeWorkTraceEvent(rawEvent);
      if (currentSessionId && event.sessionId && event.sessionId !== currentSessionId) {
        return;
      }

      appendWorkTraceEvent(event);

      if (!shouldPromoteWorkTraceEvent(event)) {
        return;
      }

      const traceSummary = summarizeWorkTraceEvent(event);
      setVoiceSummary(traceSummary.summary);
      setVoiceMeta(traceSummary.meta);

      const normalizedTraceTool = String(event.toolName || '').trim().toLowerCase();
      if ((normalizedTraceTool === 'draw_diagram' || normalizedTraceTool === 'show_diagram') && event.phase === 'complete') {
        const diagramPayload = event.payload && typeof event.payload === 'object' ? event.payload : null;
        if (diagramPayload && typeof diagramPayload.svg === 'string' && diagramPayload.svg.trim()) {
          stageFocus(buildStageFromDiagram(diagramPayload), 'ai-focus');
          return;
        }

        const diagramRef = String(
          event.openTarget?.diagramId
          || diagramPayload?.id
          || diagramPayload?.name
          || '',
        ).trim();
        if (diagramRef) {
          void nexus.diagrams.get(diagramRef).then((diagram: any) => {
            if (diagram) {
              stageFocus(buildStageFromDiagram(diagram), 'ai-focus');
            }
          }).catch((error) => {
            console.warn('[NexusNext] failed to restage diagram from work trace event', error);
          });
        }
        return;
      }

      const artifactPath = String(event.openTarget?.path || event.payload?.path || '').trim();
      if (artifactPath && !['queued', 'started'].includes(event.phase)) {
        void loadArtifact(artifactPath).then((artifact) => {
          stageFocus(buildStageFromArtifact(artifact), 'ai-focus');
        }).catch((error) => {
          console.warn('[NexusNext] failed to stage work trace artifact', error);
        });
        return;
      }

      const stage = buildStageFromWorkTraceEvent(event);
      if (stage) {
        stageFocus(stage, 'ai-focus');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [appendWorkTraceEvent, currentSessionId, loadArtifact, nexus.workTrace, stageFocus]);

  useEffect(() => () => {
    const recorder = brainstormRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore recorder shutdown failures during unmount.
      }
    }
    releaseBrainstormResources();
  }, [releaseBrainstormResources]);

  useEffect(() => {
    const unsubscribeProgress = nexus.chat.onProgress((evt) => {
      if (currentSessionId && evt.sessionId && evt.sessionId !== currentSessionId) {
        return;
      }

      const summary = summarizeProgressEvent(evt);
      const progressToolName = String(evt?.detail?.name || evt?.detail?.toolName || '').trim();
      if (evt.stage === 'tool_call_start' && progressToolName) {
        const pendingInspectionStage = buildInspectionStageFromTool(progressToolName, evt.detail || {}, null, 'pending');
        if (pendingInspectionStage) {
          stageFocus(pendingInspectionStage, 'ai-focus');
        }
      }
      const event = createFocusEvent(summary.label, summary.summary, summary.meta, evt.stage);
      appendFocusEvent(event);
      setVoiceSummary(summary.summary);
      setVoiceMeta(summary.meta);

      setFocusStage((previous) => {
        if (previous.kind !== 'activity' && summary.stageKind === 'activity') {
          return previous;
        }

        if (summary.stageKind === 'browser' && previous.kind === 'browser') {
          return {
            ...previous,
            title: summary.label,
            subtitle: summary.summary,
            summary: summary.meta,
          };
        }

        if (summary.stageKind !== 'activity' && previous.kind === 'activity') {
          return {
            kind: summary.stageKind,
            title: summary.label,
            subtitle: summary.summary,
            summary: summary.meta,
            data: previous.data,
          };
        }

        return {
          kind: 'activity',
          title: summary.label,
          subtitle: summary.summary,
          summary: summary.meta,
          data: {
            cards: previous.data?.cards || DEFAULT_ACTIVITY_STAGE.data?.cards,
          },
        };
      });
    });

    const unsubscribeLegal = nexus.legal.onOpenReport((report: any) => {
      stageFocus({
        kind: 'legal',
        title: String(report?.reportTitle || report?.sourceTitle || 'Agreeable Agreements'),
        subtitle: String(report?.sourceLabel || report?.sourceUrl || 'Saved legal review'),
        summary: truncateText(report?.overallAnalysis || report?.introduction || '', 180),
        data: report,
      });
      appendFocusEvent(createFocusEvent('Opened report', String(report?.reportTitle || 'Agreeable Agreements'), String(report?.sourceTitle || report?.sourceLabel || ''), 'legal'));
    });

    const unsubscribePresentArtifact = nexus.workspace.onPresentArtifact((payload: any) => {
      const filePath = String(payload?.path || '').trim();
      if (!filePath) {
        return;
      }
      void loadArtifact(filePath).then((artifact) => {
        stageFocus(buildStageFromArtifact(artifact));
        appendFocusEvent(createFocusEvent('Presented artifact', artifact.name, artifact.path, 'artifact'));
      }).catch((error) => {
        console.error('[NexusNext] failed to open presented artifact', error);
      });
    });

    const unsubscribeCloseStage = nexus.workspace.onCloseActiveStage(() => {
      setFocusStage(DEFAULT_ACTIVITY_STAGE);
    });

    const unsubscribeBrowserOpen = nexus.browser.onOpen((payload: any) => {
      stageBrowserPresentation(payload || {});
      appendFocusEvent(createFocusEvent(
        'Opened webpage',
        `Opened ${String(payload?.title || payload?.url || 'webpage')}.`,
        String(payload?.url || '').trim() || 'Browser',
        'browser',
      ));
    });

    const unsubscribeBrowserClose = nexus.browser.onClose(() => {
      setFocusStage(DEFAULT_ACTIVITY_STAGE);
      appendFocusEvent(createFocusEvent('Browser closed', 'Closed the live browser presentation.', 'AI Focus', 'browser'));
    });

    const unsubscribeDiagramOpen = nexus.diagrams.onOpen((diagram: any) => {
      stageFocus(buildStageFromDiagram(diagram), 'ai-focus');
      const nodeCount = Array.isArray(diagram?.spec?.nodes) ? diagram.spec.nodes.length : 0;
      const edgeCount = Array.isArray(diagram?.spec?.edges) ? diagram.spec.edges.length : 0;
      appendFocusEvent(createFocusEvent(
        'Opened diagram',
        `Opened ${String(diagram?.name || 'diagram')} in AI Focus.`,
        nodeCount || edgeCount ? `${nodeCount} nodes · ${edgeCount} edges` : String(diagram?.kind || 'diagram'),
        'diagram',
      ));
    });

    const unsubscribeDiagramUpdated = nexus.diagrams.onUpdated((diagram: any) => {
      if (focusStageRef.current.kind === 'diagram') {
        stageFocus(buildStageFromDiagram(diagram), 'ai-focus');
      }
      const nodeCount = Array.isArray(diagram?.spec?.nodes) ? diagram.spec.nodes.length : 0;
      const edgeCount = Array.isArray(diagram?.spec?.edges) ? diagram.spec.edges.length : 0;
      appendFocusEvent(createFocusEvent(
        'Updated diagram',
        `Updated ${String(diagram?.name || 'diagram')}.`,
        nodeCount || edgeCount ? `${nodeCount} nodes · ${edgeCount} edges` : String(diagram?.kind || 'diagram'),
        'diagram',
      ));
    });

    const unsubscribeDiagramClose = nexus.diagrams.onClose(() => {
      if (focusStageRef.current.kind === 'diagram') {
        setFocusStage(DEFAULT_ACTIVITY_STAGE);
      }
      appendFocusEvent(createFocusEvent('Diagram closed', 'Closed the native diagram viewer.', 'AI Focus', 'diagram'));
    });

    const unsubscribeScreenshot = nexus.browser.onScreenshotSaved((data: any) => {
      const filePath = String(data?.path || '').trim();
      if (!filePath) {
        return;
      }
      void loadArtifact(filePath).then((artifact) => {
        stageFocus(buildStageFromArtifact(artifact));
      }).catch(() => undefined);
    });

    const unsubscribeImage = nexus.images.onGenerated((data: any) => {
      const filePath = String(data?.path || '').trim();
      if (!filePath) {
        return;
      }
      void loadArtifact(filePath).then((artifact) => {
        stageFocus({
          kind: 'artifact',
          title: data?.category ? `${data.category} image` : artifact.name,
          subtitle: truncateText(data?.prompt || data?.revisedPrompt || '', 110),
          summary: artifact.path,
          data: artifact,
        });
      }).catch(() => undefined);
    });

    const unsubscribeAgentWorkflowOpen = nexus.agents.onWorkflowOpen((workflow: any) => {
      stageFocus(buildAgentWorkflowStage(workflow), 'ai-focus');
      appendFocusEvent(createFocusEvent(
        'Opened agent workflow',
        `Opened workflow for ${String(workflow?.agent?.name || 'agent')}.`,
        `${Array.isArray(workflow?.tasks) ? workflow.tasks.length : 0} tasks · ${Array.isArray(workflow?.pipelines) ? workflow.pipelines.length : 0} pipelines`,
        'activity',
      ));
    });

    return () => {
      unsubscribeProgress();
      unsubscribeLegal();
      unsubscribePresentArtifact();
      unsubscribeCloseStage();
      unsubscribeBrowserOpen();
      unsubscribeBrowserClose();
      unsubscribeDiagramOpen();
      unsubscribeDiagramUpdated();
      unsubscribeDiagramClose();
      unsubscribeScreenshot();
      unsubscribeImage();
      unsubscribeAgentWorkflowOpen();
    };
  }, [
    appendFocusEvent,
    currentSessionId,
    loadArtifact,
    nexus.agents,
    nexus.browser,
    nexus.chat,
    nexus.images,
    nexus.legal,
    nexus.workspace,
    stageBrowserPresentation,
    stageFocus,
  ]);

  const missionSnapshotState = useMemo(() => ({
    activeTab,
    currentSessionId,
    currentSessionName: currentSession?.name || null,
    focusStage: {
      kind: focusStage.kind,
      title: focusStage.title,
      subtitle: focusStage.subtitle,
      summary: focusStage.summary,
    },
    workstationStage: {
      kind: effectiveWorkstationStage.kind,
      title: effectiveWorkstationStage.title,
      subtitle: effectiveWorkstationStage.subtitle,
      summary: effectiveWorkstationStage.summary,
    },
    sessionRuntime: sessionRuntime ? {
      status: sessionRuntime.status,
      mode: sessionRuntime.mode,
      stageMode: sessionRuntime.stageMode,
      objective: sessionRuntime.objective,
      currentTask: sessionRuntime.currentTask,
      cycleCount: sessionRuntime.cycleCount,
    } : null,
    latestWorkTrace: latestWorkTrace ? {
      id: latestWorkTrace.id,
      label: latestWorkTrace.label,
      summary: latestWorkTrace.summary,
      phase: latestWorkTrace.phase,
      kind: latestWorkTrace.kind,
      toolName: latestWorkTrace.toolName,
    } : null,
    workspaceFiles: workspaceFiles.slice(0, 8).map((file: any) => ({
      name: file.name,
      path: file.path,
      kind: file.kind,
      updatedAt: file.updatedAt,
    })),
  }), [
    activeTab,
    currentSession?.name,
    currentSessionId,
    effectiveWorkstationStage.kind,
    effectiveWorkstationStage.subtitle,
    effectiveWorkstationStage.summary,
    effectiveWorkstationStage.title,
    focusStage.kind,
    focusStage.subtitle,
    focusStage.summary,
    focusStage.title,
    latestWorkTrace,
    sessionRuntime,
    workspaceFiles,
  ]);

  const handleResumeMission = useCallback((mission: MissionRecord) => {
    setActiveTab('chat');
    setDockMode('full');
    setComposer([
      `Resume mission: ${mission.title}`,
      mission.nextStep ? `Next step: ${mission.nextStep}` : '',
      mission.objective ? `Objective: ${mission.objective}` : '',
    ].filter(Boolean).join('\n'));
    setVoiceSummary(`Mission ready: ${mission.title}`);
    setVoiceMeta(mission.nextStep || mission.objective || 'Review the mission timeline, then send the resume prompt.');
    appendFocusEvent(createFocusEvent(
      'Mission resumed',
      mission.nextStep || mission.objective || mission.title,
      'Mission Recorder',
      'activity',
    ));
  }, [appendFocusEvent]);

  const renderStage = (stage: StageState, target: 'focus' | 'workstation') => {
    switch (stage.kind) {
      case 'browser':
        return <BrowserStage stage={stage} onOpenResult={(result) => void openSearchResult(result, target)} />;
      case 'legal':
        return <LegalStage stage={stage} />;
      case 'artifact':
        return (
          <ArtifactStage
            stage={stage}
            target={target}
            onOpenFile={(filePath) => { void openArtifactFile(filePath); }}
            onReveal={(filePath) => { void revealArtifactFile(filePath); }}
            onSaveFileAs={(filePath, suggestedName) => { void saveArtifactAs(filePath, suggestedName); }}
            onSendToWorkstation={target === 'focus' ? () => stageWorkstation(stage) : undefined}
          />
        );
      case 'diagram':
        return (
          <DiagramStage
            stage={stage}
            target={target}
            coeditEnabled={controlLayer.diagramCoEdit}
            onSendToWorkstation={target === 'focus' ? () => stageWorkstation(stage) : undefined}
            onEnsureFile={ensureDiagramFile}
            onOpenFile={(filePath) => { void openArtifactFile(filePath); }}
            onRevealFile={(filePath) => { void revealArtifactFile(filePath); }}
            onSaveFileAs={saveArtifactAs}
            onMoveNode={moveDiagramNode}
            onClose={target === 'focus' ? closeFocusPreview : closeWorkstationPreview}
          />
        );
      case 'inspection':
        return <InspectionStage stage={stage} onOpenItem={(item) => void openInspectionItem(item, target)} />;
      case 'panel':
        return (
          <WorkstationPanelStage
            kind={(stage.data?.panelKind || null) as HeaderPanelKind}
            data={
              headerPanel && headerPanel === stage.data?.panelKind && headerPanelData != null
                ? headerPanelData
                : stage.data?.payload
            }
            loading={Boolean(headerPanelLoading && headerPanel === stage.data?.panelKind)}
            currentSessionId={currentSessionId}
            initialDiaryReaderId={diaryReaderTargetId}
            onClose={target === 'focus' ? closeFocusPreview : closeWorkstationPreview}
            onOpenEntity={openEntityRecord}
            onSearchEntity={(query) => {
              void nexus.entityCrm.openPanel(query || undefined);
            }}
            onOpenKnowledgeDocument={openKnowledgeDocument}
            onOpenArtifact={openWorkspaceFile}
            onAskEntity={(entityType, entityId, question, history) => nexus.entityCrm.chat(entityType, entityId, question, history)}
            onRefreshWorkspaceFiles={refreshWorkspaceFiles}
            onCreateSessionDiary={handleCreateSessionDiaryFromWorkstation}
            onCommentDiaryEntry={handleCommentDiaryEntry}
            onOpenKnowledgeBase={() => {
              setHeaderPanel(null);
              setActiveTab('knowledge-base');
            }}
            onSyncKnowledgeGraph={syncKnowledgeGraph}
          />
        );
      case 'graph':
        return (
          <KnowledgeGraph
            stats={knowledgeStats}
            entityCounts={entityCounts}
            documents={knowledgeDocuments}
            people={crmPeople}
            businesses={crmBusinesses}
            selectedCluster={selectedKnowledgeCluster}
            loadingId={knowledgeLoadingId}
            graphBusy={knowledgeGraphBusy}
            onSelectCluster={setSelectedKnowledgeCluster}
            onOpenDocument={(documentId, nextTarget) => {
              setKnowledgeLoadingId(documentId);
              void openKnowledgeDocument(documentId, nextTarget).finally(() => setKnowledgeLoadingId(null));
            }}
            onOpenEntity={openEntityRecord}
            onSyncGraph={() => { void syncKnowledgeGraph(); }}
            onCreateGraphDiagram={() => { void createKnowledgeGraphDiagram(); }}
            onOpenGraphDashboard={() => { void openKnowledgeGraphDashboard(); }}
          />
        );
      case 'activity':
      default:
        return <ActivityStage stage={stage} focusEvents={focusEvents} workTraceEvents={workTraceEvents} metrics={stageMetrics} />;
    }
  };

  return (
    <div className={`next-shell${workstationFocusedMode ? ' is-workstation-focused' : ''}`} ref={shellRef}>
      <header className="next-brand-bar">
        <div className="next-brand">
          <strong>{currentSession?.name || 'Nexus Next'}</strong>
          <span>
            {sessions.length} sessions · {activeTab.replace('-', ' ')} surface
          </span>
        </div>

        <div className="next-header-actions">
          <HeaderActionButton label="Diary" active={headerPanel === 'diary'} onClick={() => void loadHeaderPanel('diary')} />
          <HeaderActionButton label="Statistics" active={headerPanel === 'statistics'} onClick={() => void loadHeaderPanel('statistics')} />
          <HeaderActionButton label="Task Queue" active={headerPanel === 'task-queue'} onClick={() => void loadHeaderPanel('task-queue')} />
          <HeaderActionButton label="Entity CRM" active={headerPanel === 'entity-crm'} onClick={() => void loadHeaderPanel('entity-crm')} />
          <HeaderActionButton label="Research" active={headerPanel === 'research'} onClick={() => void loadHeaderPanel('research')} />
          <HeaderActionButton label="Influencer" active={headerPanel === 'influencer-studio'} onClick={() => void loadHeaderPanel('influencer-studio')} />
          <HeaderActionButton label="HTML Studio" active={headerPanel === 'html-studio'} onClick={() => void loadHeaderPanel('html-studio')} />
          <HeaderActionButton label="Missions" active={activeTab === 'missions'} onClick={() => setActiveTab('missions')} />
          <HeaderActionButton label="Create Briefing" onClick={() => void handleCreateBriefing()} />
          <HeaderActionButton label="Bugs" active={headerPanel === 'bugs'} onClick={() => void loadHeaderPanel('bugs')} />
          <HeaderActionButton label="Export PDF" onClick={() => void handleExportPdf()} />
          <HeaderActionButton label="Setup" active={showSetupWizard} onClick={() => setShowSetupWizard(true)} />
          <button type="button" className="next-chrome-button" onClick={() => void loadHeaderPanel('info')}>ⓘ</button>
          <button
            type="button"
            className={`next-chrome-button${headerPanel === 'settings' ? ' is-active' : ''}`}
            onClick={() => void loadHeaderPanel('settings')}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <aside className="next-side-rail">
        <NexusPulsePanel
          conversationStatus={conversationStatus}
          conversationMode={conversationMode}
          pulseMode={pulseMode}
          voiceSummary={voiceSummary}
          voiceMeta={voiceMeta}
          isVoiceMicMuted={isVoiceMicMuted}
          roomVisionStatus={roomVisionStatus}
          roomVisionError={roomVisionError}
          roomVisionCameraLabel={roomVisionCameraLabel}
          latestRoomSnapshot={latestRoomSnapshot}
          roomVideoRef={roomVideoRef}
          sessionRuntime={sessionRuntime}
          lastUserMessage={lastUserMessage}
          lastAssistantMessage={lastAssistantMessage}
          workTraceEvents={workTraceEvents}
          onToggleConversation={toggleConversation}
          onToggleVoiceMicMute={() => { void toggleVoiceMicMute(); }}
          onToggleRoomVision={toggleRoomVision}
          onShareRoomSnapshot={() => { void shareRoomSnapshot(); }}
          onStartTextSession={() => { void startTextSession(); }}
          onEndSessionRuntime={() => { void endSessionRuntime(); }}
          onRunSessionCycle={() => { void runSessionCycle(); }}
        />

        <NexusControlLayerPanel
          controls={controlLayer}
          eyeContactStatus={eyeContactStatus}
          gazeAssessment={gazeAssessment}
          gazeStrictness={gazeStrictness}
          browserQuery={controlBrowserQuery}
          browserStatus={browserControlStatus}
          meetingStatus={meetingControlStatus}
          diagramPrompt={diagramControlPrompt}
          diagramStatus={diagramControlStatus}
          codeMapStatus={understandMessage}
          busyAction={controlLayerBusyAction}
          onToggleCollaboration={toggleCollaborationLayer}
          onToggleEyeContact={toggleEyeContactMode}
          onToggleHandControl={toggleHandControl}
          onToggleBrowserControl={toggleBrowserControl}
          onToggleMeetingMode={() => { void toggleMeetingMode(); }}
          onToggleDiagramCoEdit={toggleDiagramCoEdit}
          onGazeStrictnessChange={setGazeStrictness}
          onBrowserQueryChange={setControlBrowserQuery}
          onRunBrowserSearch={() => { void runControlledBrowserSearch(); }}
          onCaptureBrowserPage={() => { void captureControlledBrowserPage(); }}
          onDiagramPromptChange={setDiagramControlPrompt}
          onCreatePlanningDiagram={() => { void createPlanningDiagram(); }}
          onCreateCodeMap={() => { void createUnderstandDiagram('overview'); }}
          onCompileMeetingBrief={() => { void compileMeetingBrief(); }}
        />

        <section className="next-panel next-launch-panel">
          <div className="next-panel-label">Quick Launch</div>
          <button
            type="button"
            className={`next-launch-tile${marketingOpen ? ' is-active' : ''}`}
            onClick={openMarketingDepartment}
          >
            <div className="next-launch-icon">▣</div>
            <div className="next-launch-copy">
              <strong>Marketing</strong>
              <span>Campaign studio</span>
            </div>
          </button>
          <button
            type="button"
            className={`next-launch-tile${headerPanel === 'research' ? ' is-active' : ''}`}
            onClick={() => void loadHeaderPanel('research')}
          >
            <div className="next-launch-icon">⌕</div>
            <div className="next-launch-copy">
              <strong>Research</strong>
              <span>Local jobs</span>
            </div>
          </button>
          <button
            type="button"
            className={`next-launch-tile${headerPanel === 'influencer-studio' ? ' is-active' : ''}`}
            onClick={() => void loadHeaderPanel('influencer-studio')}
          >
            <div className="next-launch-icon">◎</div>
            <div className="next-launch-copy">
              <strong>Influencer</strong>
              <span>Visual studio</span>
            </div>
          </button>
          <button
            type="button"
            className={`next-launch-tile${headerPanel === 'html-studio' ? ' is-active' : ''}`}
            onClick={() => void loadHeaderPanel('html-studio')}
          >
            <div className="next-launch-icon">H</div>
            <div className="next-launch-copy">
              <strong>HTML Studio</strong>
              <span>Ideas and decks</span>
            </div>
          </button>
        </section>

        <section className="next-panel next-session-panel">
          <div className="next-session-panel-top">
            <div className="next-panel-label">Sessions</div>
            <div className="next-session-panel-actions">
              <span>{sessions.length}</span>
              <button
                type="button"
                className="next-detail-toggle next-detail-toggle--panel"
                onClick={() => setSessionsExpanded((previous) => !previous)}
              >
                {sessionsExpanded ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <button type="button" className="next-new-session" onClick={() => void createSession()}>
            + New Session
          </button>
          {sessionsExpanded ? (
            <div className="next-session-list">
              {sessions.map((session) => (
                <button
                  type="button"
                  className={`next-session-row${session.id === currentSessionId ? ' is-active' : ''}`}
                  key={session.id}
                  onClick={() => {
                    setCurrentSessionId(session.id);
                    setSessionsExpanded(false);
                  }}
                >
                  <strong>{session.name}</strong>
                  <span>{formatDateLabel(session.updatedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="next-empty-inline">Session list is collapsed by default. Click `Show` when you want to browse previous sessions.</div>
          )}
        </section>

        <section className="next-panel next-mode-panel">
          <div className="next-panel-label">Preview Modes</div>
          <div className="next-mode-list">
            <SidebarRow
              title="Browser"
              subtitle="Live source search and evidence path"
              active={focusStage.kind === 'browser'}
              onClick={() => setActiveTab('ai-focus')}
            />
            <SidebarRow
              title="Legal Review"
              subtitle="Agreeable Agreements report presenter"
              active={focusStage.kind === 'legal'}
              onClick={() => setActiveTab('ai-focus')}
            />
            <SidebarRow
              title="Missions"
              subtitle="Timeline, evidence, and next step"
              active={activeTab === 'missions'}
              onClick={() => setActiveTab('missions')}
            />
            <SidebarRow
              title="Workstation"
              subtitle="Manual browsing and tool actions"
              active={activeTab === 'workstation'}
              onClick={() => setActiveTab('workstation')}
            />
            <SidebarRow
              title="Knowledge Graph"
              subtitle="Clusters, categories, and clickable evidence"
              active={activeTab === 'knowledge-base'}
              onClick={() => setActiveTab('knowledge-base')}
            />
          </div>
        </section>
      </aside>

      <div className="next-tab-strip">
        <nav className="next-tabs" aria-label="Primary tabs">
          {[
            ['chat', 'Chat'],
            ['ai-focus', 'AI Focus'],
            ['missions', 'Missions'],
            ['workstation', 'Workstation'],
            ['knowledge-base', 'Knowledge Base'],
          ].map(([tabId, label]) => (
            <button
              type="button"
              className={`next-tab${activeTab === tabId ? ' is-active' : ''}`}
              key={tabId}
              onClick={() => setActiveTab(tabId as SurfaceTab)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`next-tab next-tab--brainstorm${isBrainstormRecording ? ' is-recording' : ''}${isBrainstormProcessing ? ' is-processing' : ''}`}
            onClick={() => {
              void (isBrainstormRecording ? stopBrainstormCapture() : beginBrainstormCapture()).catch((error: any) => {
                appendFocusEvent(createFocusEvent(
                  'Brainstorm unavailable',
                  truncateText(error?.message || 'Unknown brainstorm error', 140),
                  'Brainstorm',
                  'error',
                ));
                setVoiceSummary('Brainstorm action failed.');
                setVoiceMeta(String(error?.message || 'Unknown brainstorm error'));
              });
            }}
            disabled={!currentSessionId || isBrainstormProcessing}
            title={isBrainstormRecording ? 'Stop brainstorm recording and process it' : 'Start a live brainstorm recording'}
          >
            {isBrainstormProcessing
              ? 'Processing…'
              : isBrainstormRecording
                ? `Stop Brainstorm ${formatElapsedTime(brainstormElapsedMs)}`
                : 'Brainstorm'}
          </button>
        </nav>
      </div>

      <main className={`next-main-stage${showDock && activeTab !== 'chat' && dockMode === 'full' ? ' has-full-dock' : ' has-collapsed-dock'}${workstationFocusedMode ? ' is-workstation-focused' : ''}`}>
        {activeTab === 'chat' ? (
          <div className={`next-chat-surface${chatSidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
            <button
              type="button"
              className={`next-chat-sidebar-toggle${chatSidebarCollapsed ? ' is-collapsed' : ''}`}
              onClick={() => setChatSidebarCollapsed((previous) => !previous)}
              aria-label={chatSidebarCollapsed ? 'Expand wonderings sidebar' : 'Collapse wonderings sidebar'}
              title={chatSidebarCollapsed ? 'Expand wonderings sidebar' : 'Collapse wonderings sidebar'}
            >
              {chatSidebarCollapsed ? 'Wonderings' : 'Hide Rail'}
            </button>
            <div className={`next-chat-sidebar${chatSidebarCollapsed ? ' is-collapsed' : ''}`}>
              <div className="next-mini-panel">
                <div className="next-mini-label">Wonderings</div>
                <strong>Live threads worth following</strong>
                {wonderings.length ? (
                  <div className="next-wondering-list">
                    {wonderings.map((wondering) => (
                      <button
                        type="button"
                        key={wondering.id}
                        className={`next-wondering-item${wondering.readerId ? ' is-openable' : ''}`}
                        onClick={() => wondering.readerId ? openWonderingInDiary(wondering) : undefined}
                      >
                        <div className="next-wondering-category">{wondering.category}</div>
                        <strong>{wondering.question}</strong>
                        <p>{wondering.answer}</p>
                        {wondering.sourceLabel ? <span className="next-wondering-source">{wondering.sourceLabel}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>No live questions yet. Start typing or open the mic to seed the thread.</p>
                )}
              </div>
              <div className="next-mini-panel">
                <div className="next-mini-label">Recent Signals</div>
                {recentSignals.length ? (
                  <ul className="next-simple-list">
                    {recentSignals.map((event) => (
                      <li key={event.id}>
                        {event.label}: {truncateText(event.summary, 90)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Execution updates, tool traces, and browser pivots will accumulate here.</p>
                )}
              </div>
              <div className="next-mini-panel">
                <div className="next-mini-label">System State</div>
                <ul className="next-simple-list">
                  <li>{messages.length} visible messages</li>
                  <li>{knowledgeStats.documents || 0} knowledge docs</li>
                  <li>{workspaceFiles.length} workspace artifacts</li>
                </ul>
              </div>
            </div>
            <div className="next-chat-timeline" ref={chatTimelineRef}>
              {messages.length ? messages.map((message) => (
                <article className={`next-chat-bubble next-chat-bubble--${message.role}`} key={message.id}>
                  <div className="next-chat-bubble-head">
                    <div className="next-chat-bubble-role">{message.role === 'assistant' ? 'Nexus' : message.role === 'user' ? 'You' : 'System'}</div>
                    {message.role === 'assistant' && getAssistantMessagePresentation(message).hasDetails ? (
                      <button
                        type="button"
                        className="next-detail-toggle"
                        onClick={() => toggleMessageDetails(message.id)}
                      >
                        {expandedMessageDetails[message.id] ? 'Hide Details' : 'Show Details'}
                      </button>
                    ) : null}
                  </div>
                  <div className="next-chat-bubble-copy">
                    {message.role === 'assistant'
                      ? getAssistantMessagePresentation(message).previewText
                      : message.content}
                  </div>
                  {message.role === 'assistant' && expandedMessageDetails[message.id] ? (
                    <AssistantDetailsPanel
                      presentation={getAssistantMessagePresentation(message)}
                      onClose={() => toggleMessageDetails(message.id)}
                      onOpenToolResult={(toolResult) => {
                        void openToolResultPreview(toolResult, 'focus');
                      }}
                    />
                  ) : null}
                  <div className="next-chat-bubble-meta">{formatDateLabel(message.timestamp)}</div>
                </article>
              )) : (
                <div className="next-empty-state">
                  <strong>No messages yet</strong>
                  <span>Create or select a session, then start talking to Nexus.</span>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'ai-focus' ? (
          <div className="next-stage-motion-shell" ref={focusStageMotionRef}>
            {focusStage.kind !== 'activity' && focusStage.kind !== 'diagram' ? (
              <button type="button" className="next-stage-close next-stage-close--floating" onClick={closeFocusPreview}>
                Close Preview
              </button>
            ) : null}
            {renderStage(focusStage, 'focus')}
          </div>
        ) : activeTab === 'missions' ? (
          <MissionRecorderPanel
            currentSessionId={currentSessionId}
            currentSessionName={currentSession?.name || null}
            workTraceEvents={workTraceEvents}
            sessionRuntime={sessionRuntime}
            snapshotState={missionSnapshotState}
            onResumeMission={handleResumeMission}
          />
        ) : activeTab === 'workstation' ? (
          <div className={`next-workstation-layout${workstationFocusedMode ? ' is-focused-item' : ''}`}>
            {!workstationFocusedMode ? (
              <aside className="next-workstation-left">
                <div className="next-mini-panel">
                  <div className="next-mini-label">AI Focus Context</div>
                  {!isDefaultFocusStage(focusStage) ? (
                    <div className="next-focus-context-card">
                      <strong>{focusStage.title}</strong>
                      <p>{focusStage.subtitle}</p>
                      <div className="next-inline-actions">
                        <button
                          type="button"
                          className="next-secondary-button"
                          onClick={openCurrentFocusInWorkstation}
                        >
                          Open Here
                        </button>
                        <button
                          type="button"
                          className="next-secondary-button"
                          disabled
                        >
                          Already in AI Focus
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="next-empty-inline">
                      AI Focus is not currently carrying a distinct live context. When Nexus stages one, you can open it here or follow it automatically.
                    </div>
                  )}
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Agreeable Agreements</div>
                  <div className="next-form-stack">
                    <button type="button" className="next-primary-button" onClick={() => void handleAnalyzeUpload()} disabled={!currentSessionId || legalBusy}>
                      {legalBusy ? 'Working…' : 'Upload & Analyze'}
                    </button>
                    <button type="button" className="next-secondary-button" onClick={() => void handleOpenLatestReport()} disabled={!currentSessionId || legalBusy}>
                      Open Latest Report
                    </button>
                    <div className="next-inline-form">
                      <input
                        value={legalUrl}
                        onChange={(event) => setLegalUrl(event.target.value)}
                        placeholder="Analyze document by URL"
                      />
                      <button type="button" className="next-secondary-button" onClick={() => void handleAnalyzeLegalUrl()} disabled={!currentSessionId || legalBusy}>
                        Analyze
                      </button>
                    </div>
                  </div>
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Contract Drafting</div>
                  <p className="next-panel-copy">
                    Open the drafting studio for NDA, MSA, SOW, contractor, consulting, employment IP, and DPA templates.
                  </p>
                  <div className="next-inline-actions">
                    <button type="button" className="next-secondary-button" onClick={openContractDraftingStudio}>
                      Open Draft Studio
                    </button>
                  </div>
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Secure Profile</div>
                  <p className="next-panel-copy">
                    Manage encrypted identity fields and login secrets, then reuse them to fill forms in the active browser.
                  </p>
                  <div className="next-inline-actions">
                    <button type="button" className="next-secondary-button" onClick={openPrivateProfileStudio}>
                      Open Secure Profile
                    </button>
                  </div>
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Web Research</div>
                  <div className="next-inline-form">
                    <input
                      value={webQuery}
                      onChange={(event) => setWebQuery(event.target.value)}
                      placeholder="Search the web from Nexus"
                    />
                    <button type="button" className="next-secondary-button" onClick={() => void handleSearchWeb()} disabled={webLoading}>
                      {webLoading ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                  <div className="next-mini-list">
                    {webResults.slice(0, 4).map((result) => (
                      <button
                        type="button"
                        className="next-list-row"
                        key={result.url}
                        onClick={() => void openSearchResult(result, 'workstation')}
                        title={String(result.snippet || result.url || '').trim()}
                      >
                        <strong>{result.title}</strong>
                        <span>{String(result.snippet || result.url || '').trim()}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Code Map</div>
                  <ul className="next-simple-list">
                    <li>Graph: {understandStatus?.graphExists ? 'Ready' : 'Missing'}</li>
                    <li>Nodes: {understandStatus?.stats?.nodes || 0}</li>
                    <li>Edges: {understandStatus?.stats?.edges || 0}</li>
                    <li>Layers: {understandStatus?.stats?.layers || 0}</li>
                  </ul>
                  <div className="next-inline-actions">
                    <button
                      type="button"
                      className="next-secondary-button"
                      onClick={() => { void createUnderstandDiagram('overview'); }}
                      disabled={Boolean(understandBusyAction)}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      className="next-secondary-button"
                      onClick={() => { void createUnderstandDiagram('tools'); }}
                      disabled={Boolean(understandBusyAction)}
                    >
                      Tools
                    </button>
                    <button
                      type="button"
                      className="next-secondary-button"
                      onClick={() => { void createUnderstandDiagram('diagrams'); }}
                      disabled={Boolean(understandBusyAction)}
                    >
                      Diagrams
                    </button>
                  </div>
                  <div className="next-inline-actions">
                    <button
                      type="button"
                      className="next-secondary-button"
                      onClick={() => { void ingestUnderstandKnowledge(); }}
                      disabled={Boolean(understandBusyAction)}
                    >
                      Ingest KB
                    </button>
                    <button
                      type="button"
                      className="next-secondary-button"
                      onClick={() => { void openUnderstandDashboard(); }}
                      disabled={Boolean(understandBusyAction)}
                    >
                      Dashboard
                    </button>
                  </div>
                  <div className="next-mini-note">{understandBusyAction || understandMessage}</div>
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Knowledge Search</div>
                  <div className="next-inline-form">
                    <input
                      value={knowledgeQuery}
                      onChange={(event) => setKnowledgeQuery(event.target.value)}
                      placeholder="Search local knowledge"
                    />
                    <button type="button" className="next-secondary-button" onClick={() => void handleKnowledgeSearch()}>
                      Search
                    </button>
                  </div>
                  {knowledgeResults ? <JsonBlock value={knowledgeResults} /> : null}
                </div>

                <div className="next-mini-panel">
                  <div className="next-mini-label">Media Status</div>
                  <ul className="next-simple-list">
                    <li>SentrySearch ready: {mediaStatus?.sentrysearchReady ? 'Yes' : 'No'}</li>
                    <li>FFmpeg: {mediaStatus?.ffmpegPath ? 'Configured' : 'Missing'}</li>
                    <li>FFprobe: {mediaStatus?.ffprobePath ? 'Configured' : 'Missing'}</li>
                    <li>Indexed chunks: {mediaStatus?.stats?.totalChunks || 0}</li>
                  </ul>
                </div>
              </aside>
            ) : null}

            <section
              className={`next-workstation-right${effectiveWorkstationStage.kind === 'panel' ? ' is-panel-stage' : ''}${effectiveWorkstationRoomClass ? ` ${effectiveWorkstationRoomClass}` : ''}${workstationFocusedMode ? ' is-fullscreen' : ''}`}
              ref={workstationStageMotionRef}
            >
              <div className={`next-stage-toolbar${effectiveWorkstationRoomClass ? ` ${effectiveWorkstationRoomClass}` : ''}`}>
                <div className="next-stage-toolbar-copy">
                  <h2>{effectiveWorkstationStage.title}</h2>
                  <p>
                    {workstationIsFollowingFocus
                      ? `Following AI Focus context. ${effectiveWorkstationStage.subtitle}`
                      : effectiveWorkstationStage.subtitle}
                  </p>
                </div>
                <div className="next-stage-toolbar-actions">
                  {!isDefaultWorkstationStage(effectiveWorkstationStage) ? (
                    <button
                      type="button"
                      className="next-stage-close"
                      onClick={sendCurrentWorkstationStageToFocus}
                      disabled={stagesMatch(effectiveWorkstationStage, focusStage)}
                    >
                      {stagesMatch(effectiveWorkstationStage, focusStage) ? 'In AI Focus' : 'Send to AI Focus'}
                    </button>
                  ) : null}
                  {!workstationIsFollowingFocus && !isDefaultWorkstationStage(workstationStage) ? (
                    <button type="button" className="next-stage-close" onClick={closeWorkstationPreview}>
                      Clear Local View
                    </button>
                  ) : null}
                </div>
              </div>

              <div className={`next-workstation-preview${effectiveWorkstationStage.kind === 'panel' ? ' is-panel-stage' : ''}${effectiveWorkstationRoomClass ? ` ${effectiveWorkstationRoomClass}` : ''}${workstationFocusedMode ? ' is-fullscreen' : ''}`}>
                {renderStage(effectiveWorkstationStage, 'workstation')}
              </div>

              {!workstationFocusedMode && effectiveWorkstationStage.kind !== 'panel' ? (
                <OutputShelf
                  files={workspaceFiles}
                  currentSessionId={currentSessionId}
                  scope={outputShelfScope}
                  onScopeChange={setOutputShelfScope}
                  loadingPath={workspaceFileLoadingPath}
                  onOpenHere={(filePath) => {
                    setWorkspaceFileLoadingPath(filePath);
                    void openWorkspaceFile(filePath, 'workstation').finally(() => setWorkspaceFileLoadingPath(null));
                  }}
                  onOpenInFocus={(filePath) => {
                    setWorkspaceFileLoadingPath(filePath);
                    void openWorkspaceFile(filePath, 'focus').finally(() => setWorkspaceFileLoadingPath(null));
                  }}
                  onReveal={(filePath) => { void nexus.artifacts.reveal(filePath); }}
                />
              ) : null}
            </section>
          </div>
        ) : activeTab === 'knowledge-base' ? (
          <div className="next-knowledge-base-room">
            <YouTubeKnowledgeWorkbench />
            <section className="next-knowledge-graph-band">
              <div className="next-mini-label">Canonical Nexus Graph</div>
              <KnowledgeGraph
                stats={knowledgeStats}
                entityCounts={entityCounts}
                documents={knowledgeDocuments}
                people={crmPeople}
                businesses={crmBusinesses}
                selectedCluster={selectedKnowledgeCluster}
                loadingId={knowledgeLoadingId}
                graphBusy={knowledgeGraphBusy}
                onSelectCluster={setSelectedKnowledgeCluster}
                onOpenDocument={(documentId, target) => {
                  setKnowledgeLoadingId(documentId);
                  void openKnowledgeDocument(documentId, target).finally(() => setKnowledgeLoadingId(null));
                }}
                onOpenEntity={openEntityRecord}
                onSyncGraph={() => { void syncKnowledgeGraph(); }}
                onCreateGraphDiagram={() => { void createKnowledgeGraphDiagram(); }}
                onOpenGraphDashboard={() => { void openKnowledgeGraphDashboard(); }}
              />
            </section>
          </div>
        ) : null}

        {showDock ? (
          <div className={`next-dock${activeTab === 'chat' ? ' is-chat' : ''}${dockMode === 'collapsed' ? ' is-collapsed' : ' is-full'}`}>
            {activeTab !== 'chat' && dockMode === 'full' ? (
            <div className="next-dock-top">
              <DockCards
                lastUserMessage={lastUserMessage}
                lastAssistantMessage={lastAssistantMessage}
                assistantDetailsOpen={Boolean(lastAssistantMessage && expandedMessageDetails[lastAssistantMessage.id])}
                onToggleAssistantDetails={lastAssistantMessage
                  ? () => toggleMessageDetails(lastAssistantMessage.id)
                  : undefined}
              />
            </div>
            ) : null}

            <div className="next-dock-bottom">
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileSelection}
                multiple
                accept=".pdf,.xlsx,.xls,.csv,.tsv,.txt,.md,.markdown,.json,.html,.htm,.xml,.yaml,.yml,.log,.js,.ts,.jsx,.tsx,.doc,.docx,.rtf,.odt,.pages,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.tiff,.ico,.mp4,.mov,.m4v,.mkv,.webm,.avi"
              />
              <textarea
                className="next-composer"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Type a message or dictate speech to text…"
                rows={1}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />

              <div className="next-dock-actions">
                {activeTab !== 'chat' ? (
                  <button
                    type="button"
                    className="next-dock-button"
                    onClick={() => setDockMode((previous) => previous === 'full' ? 'collapsed' : 'full')}
                    aria-label={dockMode === 'full' ? 'Collapse chat' : 'Expand chat'}
                  >
                    {dockMode === 'full' ? 'Collapse Chat' : 'Expand Chat'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`next-icon-button${isUploadingFiles ? ' is-live' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  title={isUploadingFiles ? 'Uploading files…' : 'Upload and ingest files'}
                  disabled={!currentSessionId || isUploadingFiles}
                >
                  {isUploadingFiles ? '…' : '📎'}
                </button>
                <button
                  type="button"
                  className={`next-icon-button${conversationStatus === 'connected' || conversationStatus === 'connecting' ? ' is-live' : ''}`}
                  onClick={toggleConversation}
                  title={conversationStatus === 'connected' || conversationStatus === 'connecting' ? 'End voice session' : 'Start voice session'}
                >
                  🎙
                </button>
                {conversationStatus === 'connected' ? (
                  <button
                    type="button"
                    className={`next-icon-button${isVoiceMicMuted ? ' is-muted' : ''}`}
                    onClick={() => void toggleVoiceMicMute()}
                    title={isVoiceMicMuted ? 'Unmute ElevenLabs microphone' : 'Mute ElevenLabs microphone'}
                  >
                    {isVoiceMicMuted ? 'Unmute' : 'Mute'}
                  </button>
                ) : null}
                <button type="button" className="next-send-button" onClick={() => void handleSend()} disabled={isSending || !composer.trim() || !currentSessionId}>
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {knowledgeLoadingId ? (
          <div className="next-loading-toast">Opening knowledge document…</div>
        ) : null}
      </main>

      <canvas ref={roomCanvasRef} className="next-room-view-canvas" aria-hidden="true" />

      {showMarketingDepartment ? (
        <div className="next-marketing-modal-overlay" role="dialog" aria-modal="true" aria-label="Marketing Department">
          <div className="next-marketing-modal-backdrop" onClick={() => setShowMarketingDepartment(false)} />
          <div className="next-marketing-modal">
            <MarketingWorkbenchPanel onClose={() => setShowMarketingDepartment(false)} />
          </div>
        </div>
      ) : null}

      <SetupWizardModal
        open={showSetupWizard}
        onClose={() => setShowSetupWizard(false)}
        onComplete={() => setShowSetupWizard(false)}
        onOpenSettings={openFullSettingsFromSetup}
      />
    </div>
  );
}
