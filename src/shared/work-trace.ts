export type WorkTracePhase =
  | 'queued'
  | 'started'
  | 'update'
  | 'artifact'
  | 'complete'
  | 'error'
  | 'closed';

export type WorkTraceKind =
  | 'voice'
  | 'search'
  | 'browser'
  | 'file'
  | 'crm'
  | 'legal'
  | 'contract'
  | 'diagram'
  | 'image'
  | 'agent'
  | 'artifact'
  | 'approval'
  | 'system'
  | 'unknown';

export interface WorkTraceEvent {
  id: string;
  runId: string;
  turnId?: string;
  sessionId?: string;
  toolName?: string;
  kind: WorkTraceKind;
  phase: WorkTracePhase;
  label: string;
  summary: string;
  detail?: string;
  payload?: Record<string, any>;
  openTarget?: Record<string, any>;
  timestamp: number;
}

export function inferWorkTraceKind(toolName: unknown): WorkTraceKind {
  const normalized = String(toolName || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  if (
    normalized.includes('contract')
    || normalized.includes('private_profile')
    || normalized.includes('private-profile')
    || normalized.includes('secret')
  ) {
    return 'contract';
  }

  if (
    normalized.includes('legal')
    || normalized.includes('agreeable')
    || normalized.includes('clause')
  ) {
    return 'legal';
  }

  if (
    normalized.startsWith('browser_')
    || normalized.startsWith('chrome_')
    || normalized === 'open_webpage'
    || normalized === 'close_website'
    || normalized === 'show_youtube'
  ) {
    return 'browser';
  }

  if (
    normalized.includes('search')
    || normalized.includes('scrape')
    || normalized.includes('recall_memory')
    || normalized.includes('session_activity_context')
  ) {
    return 'search';
  }

  if (
    normalized.includes('entity')
    || normalized.includes('person_profile')
    || normalized.includes('business_profile')
    || normalized.includes('swot')
    || normalized.includes('crm')
  ) {
    return 'crm';
  }

  if (
    normalized.includes('diagram')
    || normalized.includes('mermaid')
    || normalized.includes('figma')
  ) {
    return 'diagram';
  }

  if (
    normalized.includes('image')
    || normalized.includes('video')
    || normalized.includes('slideshow')
    || normalized.includes('heygen')
    || normalized.includes('elevenlabs_audio')
    || normalized.includes('grok')
  ) {
    return 'image';
  }

  if (
    normalized.includes('agent')
    || normalized.includes('task')
    || normalized.includes('pipeline')
  ) {
    return 'agent';
  }

  if (
    normalized.includes('file')
    || normalized.includes('document')
    || normalized.includes('spreadsheet')
    || normalized.includes('pdf')
    || normalized.includes('deck')
    || normalized.includes('transcript')
    || normalized.includes('briefing')
  ) {
    return 'file';
  }

  return 'unknown';
}
