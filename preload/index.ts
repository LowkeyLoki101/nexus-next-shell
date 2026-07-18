import { clipboard, contextBridge, ipcRenderer } from 'electron';
import type {
  MissionAppendEventInput,
  MissionCreateInput,
  MissionExportResult,
  MissionRecord,
  MissionUpdateInput,
} from '../shared/mission-recorder';

/**
 * Type definitions for the Nexus API
 */
interface ChatAPI {
  send: (sessionId: string, message: string) => Promise<any>;
  sendWithTools: (sessionId: string, message: string, tools: string[]) => Promise<any>;
  append: (sessionId: string, role: 'user' | 'assistant' | 'system', content: string) => Promise<any>;
  stopCurrentTask: (sessionId: string) => Promise<{ stopped: boolean }>;
  onProgress: (handler: (evt: { sessionId: string; stage: string; detail?: any; ts: number }) => void) => () => void;
}

interface SessionsAPI {
  create: (name: string, description: string) => Promise<any>;
  list: () => Promise<any[]>;
  get: (id: string) => Promise<any>;
  rename: (id: string, name: string) => Promise<any>;
  backfillTitles: () => Promise<{ scanned: number; updated: number; sessions: any[] }>;
  delete: (id: string) => Promise<{ id: string; deleted: boolean }>;
  exportPdf: (
    id: string,
    sessionName: string,
    messages?: Array<Record<string, any>>
  ) => Promise<{ path: string; name: string; messageCount: number }>;
  generateBriefing: (
    id: string,
    sessionName: string,
    messages?: Array<Record<string, any>>
  ) => Promise<{ title: string; markdownPath: string; pdfPath: string; docxPath: string; content: string }>;
  syncArchive: (
    id: string,
    sessionName: string,
    messages: Array<Record<string, any>>
  ) => Promise<{ path: string; messageCount: number }>;
}

interface SessionRuntimeAPI {
  get: (sessionId: string) => Promise<any>;
  start: (sessionId: string, options?: Record<string, any>) => Promise<any>;
  runCycle: (sessionId: string, options?: Record<string, any>) => Promise<any>;
  end: (sessionId: string) => Promise<any>;
  onUpdate: (callback: (state: any) => void) => () => void;
}

interface ProjectsAPI {
  create: (input: { name: string; description?: string; topics?: string[]; status?: string }) => Promise<any>;
  list: (limit?: number) => Promise<any[]>;
  get: (projectId: string) => Promise<any>;
  getForSession: (sessionId: string) => Promise<any>;
  assignSession: (sessionId: string, projectId: string, options?: { confidence?: number; assignedBy?: string }) => Promise<any>;
  ensureSession: (sessionId: string, hintText?: string) => Promise<any>;
}

interface ResearchAPI {
  status: () => Promise<any>;
  createProject: (input: { name: string; objective?: string; topics?: string[]; status?: string; costMode?: string }) => Promise<any>;
  listProjects: (limit?: number) => Promise<any[]>;
  getProject: (projectId: string) => Promise<any>;
  assignYouTubeChannel: (
    projectId: string,
    handleOrUrl: string,
    options?: { syncNow?: boolean; classifyNow?: boolean; limit?: number; sessionId?: string }
  ) => Promise<any>;
  classifyProjectSources: (projectId: string, options?: { limit?: number; onlyPending?: boolean }) => Promise<any>;
  createJob: (input: Record<string, any>) => Promise<any>;
  listJobs: (projectId: string) => Promise<any[]>;
  runJob: (jobId: string) => Promise<any>;
  runDueJobs: () => Promise<any[]>;
  createSynthesisBrief: (projectId: string, input?: Record<string, any>) => Promise<any>;
}

interface AgentsAPI {
  create: (config: Record<string, any>) => Promise<any>;
  spawnChild: (parentId: string, config: Record<string, any>) => Promise<any>;
  run: (agentId: string, sessionId: string, input: string) => Promise<any>;
  list: (sessionId?: string) => Promise<any[]>;
  workflow: (agentId: string, sessionId?: string) => Promise<any>;
  onWorkflowOpen: (callback: (workflow: any) => void) => () => void;
}

interface BugsAPI {
  record: (input: Record<string, any>) => Promise<any>;
  list: (options?: { status?: string; limit?: number; sessionId?: string }) => Promise<any[]>;
  exportPdf: (options?: { status?: string; limit?: number; sessionId?: string }) => Promise<{ path: string; name: string; count: number; content: string }>;
}

interface AgentHubAPI {
  list: (options?: { status?: string; category?: string; query?: string; limit?: number }) => Promise<any[]>;
  createListing: (input: Record<string, any>) => Promise<any>;
  install: (listingId: string, config?: Record<string, any>) => Promise<any>;
}

interface DaemonAPI {
  start: (intervalMinutes?: number) => Promise<any>;
  stop: () => Promise<any>;
  status: () => Promise<any>;
  setAgentAutonomous: (agentId: string, enabled: boolean) => Promise<any>;
  runTick: (agentId?: string, activityKey?: string) => Promise<any[]>;
  listActivities: () => Promise<any[]>;
}

interface MasterDiaryAPI {
  list: (limit?: number) => Promise<any[]>;
  narratives: (limit?: number) => Promise<any[]>;
  createSessionDiary: (sessionId: string) => Promise<{ entry: any; narrative: any }>;
  audioEntries: (limit?: number) => Promise<any[]>;
  comment: (entryId: string, comment: string) => Promise<any>;
}

interface YouTubeAPI {
  fetchTranscript: (urlOrId: string, sessionId?: string) => Promise<any>;
  subscribeChannel: (handleOrUrl: string, sessionId?: string) => Promise<any>;
  syncChannel: (channelRecordId: string, sessionId?: string) => Promise<any>;
  pauseChannel: (channelRecordId: string) => Promise<any>;
  resumeChannel: (channelRecordId: string) => Promise<any>;
  deleteChannel: (channelRecordId: string, deleteTranscripts?: boolean) => Promise<any>;
  deleteTranscript: (transcriptId: string) => Promise<any>;
  listChannels: () => Promise<any[]>;
  listTranscripts: (options?: { channelId?: string; limit?: number; offset?: number; search?: string }) => Promise<any[]>;
  getTranscript: (transcriptId: string) => Promise<any>;
  exportTranscriptPdf: (transcriptId: string) => Promise<{ path: string; name: string; transcript: any }>;
  stats: () => Promise<{ channels: number; transcripts: number; totalChars: number }>;
}

interface NateLibraryAPI {
  status: () => Promise<any>;
  getChannelBases: () => Promise<any[]>;
  addChannelBase: (input: { name?: string; handleOrUrl: string }) => Promise<any>;
  buildChannelBase: (input: { baseId: string; batchSize?: number; sessionId?: string }) => Promise<any>;
  overview: () => Promise<any>;
  search: (input?: { query?: string; kinds?: string[]; tags?: string[]; claimTypes?: string[]; videoId?: string; limit?: number }) => Promise<any[]>;
  getVideo: (videoId: string) => Promise<any>;
  chat: (input: { question: string; scope?: string; tags?: string[]; videoId?: string; limit?: number }) => Promise<any>;
  saveVideoArtifact: (input: { videoId: string; artifactType: 'transcript' | 'brief' }) => Promise<any>;
  createInfographic: (input?: { query?: string; title?: string; tags?: string[]; mode?: string; limit?: number }) => Promise<any>;
  createSlideDeck: (input?: { query?: string; title?: string; tags?: string[]; mode?: string; limit?: number }) => Promise<any>;
  openSourceUrl: (url: string) => Promise<any>;
  reveal: () => Promise<any>;
}

interface TasksAPI {
  create: (
    agentId: string,
    sessionId: string,
    description: string,
    priority: number,
    dependencies?: string[]
  ) => Promise<any>;
  processQueue: () => Promise<any[]>;
  list: (sessionId: string) => Promise<any[]>;
}

interface ToolsAPI {
  execute: (name: string, args: Record<string, any>) => Promise<any>;
  list: () => Promise<any[]>;
}

interface ClipboardAPI {
  writeText: (text: string) => Promise<boolean>;
}

interface KnowledgeAPI {
  ingest: (sessionId: string, content: string, title: string, source: string) => Promise<any>;
  ingestFile: (sessionId: string, fileName: string, mimeType: string, dataBase64: string) => Promise<any>;
  search: (query: string, sessionId?: string) => Promise<any[]>;
  globalSearch: (query: string, options?: { sessionId?: string; limitPerSource?: number; globalScope?: boolean }) => Promise<any>;
  listDocuments: (sessionId?: string, limit?: number) => Promise<any[]>;
  graphStatus: (sessionId?: string) => Promise<any>;
  createGraphDiagram: (input?: { sessionId?: string; maxNodes?: number; show?: boolean }) => Promise<any>;
  openGraphDashboard: (input?: { sessionId?: string; open?: boolean }) => Promise<any>;
  stats: (sessionId?: string) => Promise<{
    tier1: number;
    tier2: number;
    tier3: number;
    documents: number;
    workingMemory?: {
      recentTurns: number;
      recentToolOutcomes: number;
      recentDocuments: number;
      activeTasks: number;
      reflectiveSignals: number;
      total: number;
    };
    health?: {
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
  }>;
  getDocument: (documentId: string) => Promise<any>;
}

interface LegalAnalysisAPI {
  analyzeDocument: (sessionId: string, documentId: string) => Promise<any>;
  analyzeUpload: (sessionId: string, fileName: string, mimeType: string, dataBase64: string) => Promise<any>;
  pickAndAnalyzeUpload: (sessionId: string) => Promise<any>;
  analyzeUrl: (sessionId: string, url: string, titleHint?: string) => Promise<any>;
  openReport: (sessionId: string, options?: { query?: string; documentId?: string; latest?: boolean; limit?: number }) => Promise<any>;
  onOpenReport: (callback: (data: any) => void) => () => void;
}

interface MemoryAPI {
  add: (sessionId: string, content: string, sourceType: string) => Promise<any>;
  get: (sessionId: string, tier?: string, query?: string) => Promise<any[]>;
}

interface PipelinesAPI {
  create: (sessionId: string, name: string, templateName?: string) => Promise<any>;
  advance: (pipelineId: string) => Promise<any>;
  status: (pipelineId: string) => Promise<any>;
  list: (sessionId: string) => Promise<any[]>;
}

interface VoiceAPI {
  transcribe: (audioBase64: string, sessionId?: string) => Promise<any>;
}

interface ScrapeAPI {
  url: (url: string) => Promise<any>;
  search: (query: string) => Promise<any[]>;
}

interface SettingsAPI {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<any>;
}

interface NexusBridgeAPI {
  getStatus: () => Promise<any>;
  getConfig: () => Promise<any>;
  sync: () => Promise<any>;
  regenerateKey: () => Promise<any>;
  onStatus: (callback: (status: any) => void) => () => void;
}

interface DiagnosticsAPI {
  runNetworkHealth: () => Promise<any>;
  runtimeReadiness: () => Promise<any>;
  ollamaStatus: () => Promise<any>;
  ollamaRestart: () => Promise<any>;
}

interface UsageAPI {
  overview: () => Promise<any>;
}

interface ArtifactsAPI {
  load: (filePath: string) => Promise<any>;
  open: (filePath: string) => Promise<boolean>;
  reveal: (filePath: string) => Promise<boolean>;
  saveAs: (filePath: string, suggestedName?: string) => Promise<string | null>;
  listWorkspaceFiles: (limit?: number) => Promise<any[]>;
  materializeText: (sessionId: string | undefined, title: string, content: string, source?: string) => Promise<any>;
  materializeHtml: (sessionId: string | undefined, title: string, html: string, source?: string) => Promise<any>;
}

interface MediaAPI {
  getStatus: () => Promise<any>;
  indexVideos: (videoPaths: string[], options?: Record<string, any>) => Promise<any>;
  searchVideos: (query: string, options?: Record<string, any>) => Promise<any>;
  clipVideo: (input: Record<string, any>) => Promise<any>;
  stitchVideos: (input: Record<string, any>) => Promise<any>;
  createNarratedSlideshow: (input: Record<string, any>) => Promise<any>;
}

interface PresentationAPI {
  prepare: (options: Record<string, any>) => Promise<any>;
  start: (options?: Record<string, any>) => Promise<any>;
  control: (action: string, options?: Record<string, any>) => Promise<any>;
  onReady: (callback: (data: any) => void) => () => void;
  onOpen: (callback: (data: any) => void) => () => void;
  onControl: (callback: (data: any) => void) => () => void;
  onError: (callback: (data: any) => void) => () => void;
}

interface BrowserAPI {
  open: (url: string, title?: string) => Promise<any>;
  onOpen: (callback: (data: any) => void) => () => void;
  onClose: (callback: (data: any) => void) => () => void;
  onScreenshotSaved: (callback: (data: any) => void) => () => void;
}

interface VisionGesturesAPI {
  loadSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<any>;
  revealSettings: () => Promise<any>;
  clickScreen: (point: { normalizedX: number; normalizedY: number }) => Promise<any>;
  setDesktopControlMode: (enabled: boolean) => Promise<any>;
  openAccessibilitySettings: () => Promise<any>;
}

interface WorkspaceAPI {
  onPresentArtifact: (callback: (data: any) => void) => () => void;
  onOpenTutorial: (callback: (data: any) => void) => () => void;
  onCloseActiveStage: (callback: (data: any) => void) => () => void;
}

interface MarketingAPI {
  getBridgeState: () => Promise<any>;
  listBridgeFiles: (limit?: number) => Promise<any[]>;
  openExternal: (url?: string) => Promise<any>;
  revealFolder: (folder: 'root' | 'incoming' | 'outgoing') => Promise<any>;
  onDownloadEvent: (callback: (data: any) => void) => () => void;
  getVideoConfig: () => Promise<any>;
  saveVideoConfig: (input: Record<string, any>) => Promise<any>;
  createHeyGenVideo: (input: Record<string, any>) => Promise<any>;
  getHeyGenStatus: (videoId: string) => Promise<any>;
  generateAssistedPrompt: (input: Record<string, any>) => Promise<any>;
  createGrokImage: (input: Record<string, any>) => Promise<any>;
  createGrokVideo: (input: Record<string, any>) => Promise<any>;
  getGrokVideoStatus: (requestId: string) => Promise<any>;
}

interface SpreadsheetsAPI {
  open: (filePath: string) => Promise<any>;
  inspect: (filePath: string, sheetName?: string) => Promise<any>;
  query: (filePath: string, query: string, sheetName?: string, limit?: number) => Promise<any>;
  filter: (filePath: string, query: string, sheetName?: string, limit?: number) => Promise<any>;
  sort: (filePath: string, column: string, direction?: 'asc' | 'desc', sheetName?: string, limit?: number, query?: string) => Promise<any>;
  updateCells: (filePath: string, sheetName: string, updates: unknown) => Promise<any>;
  exportTable: (
    filePath: string,
    outputPath: string,
    options?: { format?: 'xlsx' | 'xls' | 'csv' | 'tsv' | 'json'; sheetName?: string; query?: string; sortColumn?: string; direction?: 'asc' | 'desc'; sessionId?: string; title?: string }
  ) => Promise<any>;
  generateChart: (
    filePath: string,
    outputPath: string,
    options: { labelColumn: string; valueColumn: string; chartType?: 'bar' | 'line'; sheetName?: string; query?: string; sortColumn?: string; direction?: 'asc' | 'desc'; limit?: number; title?: string; sessionId?: string }
  ) => Promise<any>;
  create: (outputPath: string, options?: { sheetName?: string; rows?: unknown; sheets?: unknown }) => Promise<any>;
  appendRows: (filePath: string, sheetName: string, rows: unknown) => Promise<any>;
}

interface ImagesAPI {
  generate: (prompt: string, options?: Record<string, any>) => Promise<any>;
  analyze: (filePath: string, options?: { prompt?: string; sessionId?: string; title?: string }) => Promise<any>;
  analyzeDataUrl: (dataUrl: string, options?: { prompt?: string; sessionId?: string; title?: string }) => Promise<any>;
  openFolder: () => Promise<{ success: boolean; path: string }>;
  onGenerated: (callback: (data: { path: string; mimeType: string; prompt: string; revisedPrompt?: string; category?: string }) => void) => () => void;
}

interface BrainstormAPI {
  start: (sessionId: string, title: string) => Promise<any>;
  processAudio: (brainstormId: string, audioBase64: string) => Promise<any>;
  list: (sessionId: string) => Promise<any[]>;
  get: (brainstormId: string) => Promise<any>;
  delete: (brainstormId: string) => Promise<{ id: string; deleted: boolean }>;
  showYouTube: (url: string) => Promise<any>;
  openYouTubeWindow: (embedUrl: string, title?: string) => Promise<boolean>;
}

interface EntityCrmAPI {
  listPeople: (limit?: number) => Promise<any[]>;
  listBusinesses: (limit?: number) => Promise<any[]>;
  search: (query: string, entityType?: string) => Promise<any[]>;
  getSessionContext: (sessionId: string, limit?: number) => Promise<any>;
  getKnowledge: (entityType: 'person' | 'business', entityId: string, limit?: number) => Promise<any>;
  chat: (
    entityType: 'person' | 'business',
    entityId: string,
    question: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<any>;
  getPerson: (idOrName: string) => Promise<any>;
  getBusiness: (idOrName: string) => Promise<any>;
  getCounts: () => Promise<{ people: number; businesses: number; links: number }>;
  getPersonBusinesses: (personId: string) => Promise<any[]>;
  getBusinessPeople: (businessId: string) => Promise<any[]>;
  createPerson: (data: any) => Promise<any>;
  updatePerson: (id: string, data: any) => Promise<any>;
  deletePerson: (id: string) => Promise<boolean>;
  createBusiness: (data: any) => Promise<any>;
  updateBusiness: (id: string, data: any) => Promise<any>;
  deleteBusiness: (id: string) => Promise<boolean>;
  mergePerson: (primaryId: string, duplicateId: string) => Promise<any>;
  mergeBusiness: (primaryId: string, duplicateId: string) => Promise<any>;
  linkPersonBusiness: (personId: string, businessId: string, role?: string, isFounder?: boolean) => Promise<any>;
  unlinkPersonBusiness: (personId: string, businessId: string) => Promise<boolean>;
  backfillFromKnowledge: () => Promise<any>;
  openPanel: (query?: string, entityType?: string, focusId?: string) => Promise<any>;
  onBackfillProgress: (callback: (data: any) => void) => () => void;
  onOpenPanel: (callback: (data: any) => void) => () => void;
}

interface MeetingModeAPI {
  start: (sessionId: string) => Promise<any>;
  end: () => Promise<any>;
  addTranscript: (text: string, speaker?: string) => Promise<any>;
  getState: () => Promise<any>;
  compileBriefing: () => Promise<any>;
  isActive: () => Promise<boolean>;
  onUpdate: (callback: (data: any) => void) => () => void;
}

interface RollingTodoAPI {
  get: (sessionId: string) => Promise<any>;
  refresh: (sessionId: string, force?: boolean, reason?: string) => Promise<any>;
  updateItem: (sessionId: string, slotIndex: number, patch: Record<string, any>) => Promise<any>;
  exportPdf: (sessionId: string) => Promise<any>;
  emailPdf: (sessionId: string, to: string, subject?: string) => Promise<any>;
  claimReminder: (sessionId: string) => Promise<any>;
}

interface ElevenLabsAPI {
  getSignedUrl: () => Promise<{ signedUrl: string; conversationId: string }>;
  getAgentConfig: (sessionId?: string) => Promise<any>;
  isConfigured: () => Promise<boolean>;
  executeToolCall: (
    toolName: string,
    parameters: Record<string, any>,
    conversationId: string,
    sessionId?: string
  ) => Promise<any>;
  addTranscript: (conversationId: string, role: 'user' | 'agent', text: string) => Promise<void>;
  endSession: (conversationId: string, sessionId?: string) => Promise<any>;
  ttsSpeak: (text: string) => Promise<string>;
}

interface NexusCoreAPI {
  call: (action: string, input?: Record<string, any>) => Promise<any>;
  capabilities: () => Promise<any>;
  providersStatus: () => Promise<any>;
  chat: (input: {
    prompt?: string;
    message?: string;
    text?: string;
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<any>;
  voiceSignedUrl: () => Promise<{ signedUrl: string; conversationId?: string }>;
  voiceAgentConfig: (input?: { sessionId?: string }) => Promise<any>;
  usageOverview: () => Promise<any>;
}

interface BrowserAutomationAPI {
  open: (url: string) => Promise<any>;
  close: () => Promise<any>;
  navigate: (url: string, pageId?: string) => Promise<any>;
  searchYouTube: (query: string) => Promise<any>;
  screenshot: (options?: { fullPage?: boolean; pageId?: string }) => Promise<any>;
  getContent: (pageId?: string) => Promise<any>;
  click: (selector: string, pageId?: string) => Promise<any>;
  type: (selector: string, text: string, pageId?: string) => Promise<any>;
  scroll: (amount?: number, pageId?: string) => Promise<any>;
  back: (pageId?: string) => Promise<any>;
  listPages: () => Promise<any>;
  isRunning: () => Promise<boolean>;
}

interface PrivateProfileAPI {
  getAvailability: () => Promise<{ available: boolean; backend?: string; message: string }>;
  get: () => Promise<any>;
  save: (input: Record<string, any>) => Promise<any>;
  clear: () => Promise<{ cleared: boolean }>;
}

interface SecretVaultAPI {
  getAvailability: () => Promise<{ available: boolean; backend?: string; message: string }>;
  list: () => Promise<any[]>;
  save: (input: Record<string, any>) => Promise<any>;
  delete: (id: string) => Promise<{ id: string; deleted: boolean }>;
}

interface VoiceToolsAPI {
  /** Route a tool through the VoiceToolRouter with validation + permission gating */
  execute: (toolName: string, parameters: Record<string, any>) => Promise<any>;
  /** Get recent voice tool execution logs */
  getLogs: (limit?: number) => Promise<any[]>;
  /** Resolve a pending approval request */
  resolveApproval: (id: string, approved: boolean) => Promise<void>;
  /** Listen for approval requests from the VoiceToolRouter */
  onApprovalRequired: (callback: (request: any) => void) => () => void;
  /** Listen for tool execution events */
  onToolExecuted: (callback: (log: any) => void) => () => void;
  /** Show a native notification */
  showNotification: (title: string, body?: string) => Promise<any>;
}

interface NexusAPI {
  api: NexusCoreAPI;
  chat: ChatAPI;
  sessions: SessionsAPI;
  sessionRuntime: SessionRuntimeAPI;
  projects: ProjectsAPI;
  research: ResearchAPI;
  agents: AgentsAPI;
  agentHub: AgentHubAPI;
  bugs: BugsAPI;
  daemon: DaemonAPI;
  masterDiary: MasterDiaryAPI;
  tasks: TasksAPI;
  tools: ToolsAPI;
  clipboard: ClipboardAPI;
  knowledge: KnowledgeAPI;
  legal: LegalAnalysisAPI;
  memory: MemoryAPI;
  pipelines: PipelinesAPI;
  voice: VoiceAPI;
  scrape: ScrapeAPI;
  settings: SettingsAPI;
  nexusBridge: NexusBridgeAPI;
  diagnostics: DiagnosticsAPI;
  usage: UsageAPI;
  artifacts: ArtifactsAPI;
  media: MediaAPI;
  presentation: PresentationAPI;
  browser: BrowserAPI;
  visionGestures: VisionGesturesAPI;
  workspace: WorkspaceAPI;
  marketing: MarketingAPI;
  spreadsheets: SpreadsheetsAPI;
  images: ImagesAPI;
  brainstorm: BrainstormAPI;
  elevenlabs: ElevenLabsAPI;
  entityCrm: EntityCrmAPI;
  meetingMode: MeetingModeAPI;
  rollingTodo: RollingTodoAPI;
  browserAutomation: BrowserAutomationAPI;
  privateProfile: PrivateProfileAPI;
  secretVault: SecretVaultAPI;
  voiceTools: VoiceToolsAPI;
  workTrace: WorkTraceAPI;
  missions: MissionsAPI;
  youtube: YouTubeAPI;
  nateLibrary: NateLibraryAPI;
  diagrams: DiagramsAPI;
  understand: UnderstandAnythingAPI;
}

interface WorkTraceAPI {
  getRecent: (limit?: number, sessionId?: string) => Promise<any[]>;
  onEvent: (callback: (event: any) => void) => () => void;
}

interface MissionsAPI {
  list: () => Promise<MissionRecord[]>;
  get: (missionId: string) => Promise<MissionRecord | null>;
  create: (input: MissionCreateInput) => Promise<MissionRecord>;
  update: (missionId: string, input: MissionUpdateInput) => Promise<MissionRecord>;
  appendEvent: (missionId: string, input: MissionAppendEventInput) => Promise<MissionRecord>;
  attachWorkTrace: (missionId: string, event: any) => Promise<MissionRecord>;
  exportMarkdown: (missionId: string) => Promise<MissionExportResult>;
  onChanged: (callback: (payload: any) => void) => () => void;
}

interface DiagramsAPI {
  create: (name: string, spec: any, sessionId?: string) => Promise<any>;
  list: (limit?: number) => Promise<any[]>;
  get: (idOrName: string) => Promise<any>;
  generateFromPrompt: (request: {
    prompt: string;
    name?: string;
    kind?: string;
    sessionId?: string;
    filePaths?: string[];
    diagramId?: string;
    show?: boolean;
  }) => Promise<any>;
  delete: (id: string) => Promise<boolean>;
  rename: (id: string, newName: string) => Promise<any>;
  addNode: (id: string, node: any) => Promise<any>;
  removeNode: (id: string, nodeId: string) => Promise<any>;
  updateNode: (id: string, nodeId: string, patch: any) => Promise<any>;
  addEdge: (id: string, edge: any) => Promise<any>;
  removeEdge: (id: string, fromId: string, toId: string) => Promise<any>;
  recolorNode: (id: string, nodeId: string, color: string) => Promise<any>;
  moveNode: (id: string, nodeId: string, x: number, y: number) => Promise<any>;
  show: (idOrName: string) => Promise<any>;
  close: () => Promise<any>;
  exportSvg: (id: string, targetPath?: string) => Promise<{ path: string }>;
  replaceSpec: (id: string, spec: any) => Promise<any>;
  onOpen: (cb: (rec: any) => void) => () => void;
  onUpdated: (cb: (rec: any) => void) => () => void;
  onClose: (cb: () => void) => () => void;
}

interface UnderstandAnythingAPI {
  status: (projectPath?: string) => Promise<any>;
  createDiagram: (input?: {
    mode?: string;
    projectPath?: string;
    maxNodes?: number;
    name?: string;
    sessionId?: string;
    show?: boolean;
  }) => Promise<any>;
  ingestKnowledge: (input?: { projectPath?: string; sessionId?: string }) => Promise<any>;
  openDashboard: (input?: { projectPath?: string; open?: boolean }) => Promise<any>;
}

/**
 * Build the Nexus API object
 */
const nexusAPI: NexusAPI = {
  // ============ NEXUS API FACADE ============
  api: {
    call: (action: string, input: Record<string, any> = {}) =>
      ipcRenderer.invoke('nexus:api', { action, input }),
    capabilities: () =>
      ipcRenderer.invoke('nexus:capabilities'),
    providersStatus: () =>
      ipcRenderer.invoke('nexus:providers.status'),
    chat: (input) =>
      ipcRenderer.invoke('nexus:chat', input),
    voiceSignedUrl: () =>
      ipcRenderer.invoke('nexus:voice.signed-url'),
    voiceAgentConfig: (input = {}) =>
      ipcRenderer.invoke('nexus:voice.agent-config', input),
    usageOverview: () =>
      ipcRenderer.invoke('nexus:api', { action: 'usage.overview' }),
  },

  // ============ CHAT API ============
  chat: {
    send: (sessionId: string, message: string) =>
      ipcRenderer.invoke('chat:send', sessionId, message),
    sendWithTools: (sessionId: string, message: string, tools: string[]) =>
      ipcRenderer.invoke('chat:send-with-tools', sessionId, message, tools),
    append: (sessionId: string, role: 'user' | 'assistant' | 'system', content: string) =>
      ipcRenderer.invoke('chat:append', sessionId, role, content),
    stopCurrentTask: (sessionId: string) =>
      ipcRenderer.invoke('chat:stop-current-task', sessionId),
    onProgress: (handler: (evt: { sessionId: string; stage: string; detail?: any; ts: number }) => void) => {
      const listener = (_: unknown, evt: any) => handler(evt);
      ipcRenderer.on('chat:progress', listener);
      return () => ipcRenderer.removeListener('chat:progress', listener);
    },
  },

  // ============ SESSIONS API ============
  sessions: {
    create: (name: string, description: string) =>
      ipcRenderer.invoke('session:create', name, description),
    list: () =>
      ipcRenderer.invoke('session:list'),
    get: (id: string) =>
      ipcRenderer.invoke('session:get', id),
    rename: (id: string, name: string) =>
      ipcRenderer.invoke('session:rename', id, name),
    backfillTitles: () =>
      ipcRenderer.invoke('session:backfill-titles'),
    delete: (id: string) =>
      ipcRenderer.invoke('session:delete', id),
    exportPdf: (id: string, sessionName: string, messages?: Array<Record<string, any>>) =>
      ipcRenderer.invoke('session:export-pdf', id, sessionName, messages),
    generateBriefing: (id: string, sessionName: string, messages?: Array<Record<string, any>>) =>
      ipcRenderer.invoke('session:generate-briefing', id, sessionName, messages),
    syncArchive: (id: string, sessionName: string, messages: Array<Record<string, any>>) =>
      ipcRenderer.invoke('session:sync-archive', id, sessionName, messages),
  },

  sessionRuntime: {
    get: (sessionId: string) =>
      ipcRenderer.invoke('session-runtime:get', sessionId),
    start: (sessionId: string, options?: Record<string, any>) =>
      ipcRenderer.invoke('session-runtime:start', sessionId, options),
    runCycle: (sessionId: string, options?: Record<string, any>) =>
      ipcRenderer.invoke('session-runtime:run-cycle', sessionId, options),
    end: (sessionId: string) =>
      ipcRenderer.invoke('session-runtime:end', sessionId),
    onUpdate: (callback: (state: any) => void) => {
      const handler = (_event: any, state: any) => callback(state);
      ipcRenderer.on('session-runtime:update', handler);
      return () => ipcRenderer.removeListener('session-runtime:update', handler);
    },
  },

  projects: {
    create: (input: { name: string; description?: string; topics?: string[]; status?: string }) =>
      ipcRenderer.invoke('project:create', input),
    list: (limit?: number) =>
      ipcRenderer.invoke('project:list', limit),
    get: (projectId: string) =>
      ipcRenderer.invoke('project:get', projectId),
    getForSession: (sessionId: string) =>
      ipcRenderer.invoke('project:get-for-session', sessionId),
    assignSession: (sessionId: string, projectId: string, options?: { confidence?: number; assignedBy?: string }) =>
      ipcRenderer.invoke('project:assign-session', sessionId, projectId, options),
    ensureSession: (sessionId: string, hintText?: string) =>
      ipcRenderer.invoke('project:ensure-session', sessionId, hintText),
  },

  research: {
    status: () =>
      ipcRenderer.invoke('research:status'),
    createProject: (input: { name: string; objective?: string; topics?: string[]; status?: string; costMode?: string }) =>
      ipcRenderer.invoke('research:create-project', input),
    listProjects: (limit?: number) =>
      ipcRenderer.invoke('research:list-projects', limit),
    getProject: (projectId: string) =>
      ipcRenderer.invoke('research:get-project', projectId),
    assignYouTubeChannel: (
      projectId: string,
      handleOrUrl: string,
      options?: { syncNow?: boolean; classifyNow?: boolean; limit?: number; sessionId?: string }
    ) =>
      ipcRenderer.invoke('research:assign-youtube-channel', projectId, handleOrUrl, options),
    classifyProjectSources: (projectId: string, options?: { limit?: number; onlyPending?: boolean }) =>
      ipcRenderer.invoke('research:classify-project-sources', projectId, options),
    createJob: (input: Record<string, any>) =>
      ipcRenderer.invoke('research:create-job', input),
    listJobs: (projectId: string) =>
      ipcRenderer.invoke('research:list-jobs', projectId),
    runJob: (jobId: string) =>
      ipcRenderer.invoke('research:run-job', jobId),
    runDueJobs: () =>
      ipcRenderer.invoke('research:run-due-jobs'),
    createSynthesisBrief: (projectId: string, input?: Record<string, any>) =>
      ipcRenderer.invoke('research:create-synthesis-brief', projectId, input),
  },

  // ============ AGENTS API ============
  agents: {
    create: (config: Record<string, any>) =>
      ipcRenderer.invoke('agent:create', config),
    spawnChild: (parentId: string, config: Record<string, any>) =>
      ipcRenderer.invoke('agent:spawn-child', parentId, config),
    run: (agentId: string, sessionId: string, input: string) =>
      ipcRenderer.invoke('agent:run', agentId, sessionId, input),
    list: (sessionId?: string) =>
      ipcRenderer.invoke('agent:list', sessionId),
    workflow: (agentId: string, sessionId?: string) =>
      ipcRenderer.invoke('agent:workflow', agentId, sessionId),
    onWorkflowOpen: (callback: (workflow: any) => void) => {
      const handler = (_event: any, workflow: any) => callback(workflow);
      ipcRenderer.on('agent:workflow-open', handler);
      return () => ipcRenderer.removeListener('agent:workflow-open', handler);
    },
  },

  bugs: {
    record: (input: Record<string, any>) =>
      ipcRenderer.invoke('bug-report:record', input),
    list: (options?: { status?: string; limit?: number; sessionId?: string }) =>
      ipcRenderer.invoke('bug-report:list', options),
    exportPdf: (options?: { status?: string; limit?: number; sessionId?: string }) =>
      ipcRenderer.invoke('bug-report:export-pdf', options),
  },

  agentHub: {
    list: (options?: { status?: string; category?: string; query?: string; limit?: number }) =>
      ipcRenderer.invoke('agent-hub:list', options),
    createListing: (input: Record<string, any>) =>
      ipcRenderer.invoke('agent-hub:create-listing', input),
    install: (listingId: string, config?: Record<string, any>) =>
      ipcRenderer.invoke('agent-hub:install', listingId, config),
  },

  // ============ DAEMON API ============
  daemon: {
    start: (intervalMinutes?: number) =>
      ipcRenderer.invoke('daemon:start', intervalMinutes),
    stop: () =>
      ipcRenderer.invoke('daemon:stop'),
    status: () =>
      ipcRenderer.invoke('daemon:status'),
    setAgentAutonomous: (agentId: string, enabled: boolean) =>
      ipcRenderer.invoke('daemon:set-agent-autonomous', agentId, enabled),
    runTick: (agentId?: string, activityKey?: string) =>
      ipcRenderer.invoke('daemon:run-tick', agentId, activityKey),
    listActivities: () =>
      ipcRenderer.invoke('daemon:list-activities'),
  },

  // ============ MASTER DIARY API ============
  masterDiary: {
    list: (limit?: number) =>
      ipcRenderer.invoke('master-diary:list', limit),
    narratives: (limit?: number) =>
      ipcRenderer.invoke('master-diary:narratives', limit),
    createSessionDiary: (sessionId: string) =>
      ipcRenderer.invoke('master-diary:create-session-diary', sessionId),
    audioEntries: (limit?: number) =>
      ipcRenderer.invoke('master-diary:audio-entries', limit),
    comment: (entryId: string, comment: string) =>
      ipcRenderer.invoke('master-diary:comment', entryId, comment),
  },

  // ============ YOUTUBE TRANSCRIPT API ============
  youtube: {
    fetchTranscript: (urlOrId: string, sessionId?: string) =>
      ipcRenderer.invoke('youtube:fetch-transcript', urlOrId, sessionId),
    subscribeChannel: (handleOrUrl: string, sessionId?: string) =>
      ipcRenderer.invoke('youtube:subscribe-channel', handleOrUrl, sessionId),
    syncChannel: (channelRecordId: string, sessionId?: string) =>
      ipcRenderer.invoke('youtube:sync-channel', channelRecordId, sessionId),
    pauseChannel: (channelRecordId: string) =>
      ipcRenderer.invoke('youtube:pause-channel', channelRecordId),
    resumeChannel: (channelRecordId: string) =>
      ipcRenderer.invoke('youtube:resume-channel', channelRecordId),
    deleteChannel: (channelRecordId: string, deleteTranscripts?: boolean) =>
      ipcRenderer.invoke('youtube:delete-channel', channelRecordId, deleteTranscripts),
    deleteTranscript: (transcriptId: string) =>
      ipcRenderer.invoke('youtube:delete-transcript', transcriptId),
    listChannels: () =>
      ipcRenderer.invoke('youtube:list-channels'),
    listTranscripts: (options?: { channelId?: string; limit?: number; offset?: number; search?: string }) =>
      ipcRenderer.invoke('youtube:list-transcripts', options),
    getTranscript: (transcriptId: string) =>
      ipcRenderer.invoke('youtube:get-transcript', transcriptId),
    exportTranscriptPdf: (transcriptId: string) =>
      ipcRenderer.invoke('youtube:export-transcript-pdf', transcriptId),
    stats: () =>
      ipcRenderer.invoke('youtube:stats'),
  },

  nateLibrary: {
    status: () =>
      ipcRenderer.invoke('nate-library:status'),
    getChannelBases: () =>
      ipcRenderer.invoke('nate-library:get-channel-bases'),
    addChannelBase: (input: { name?: string; handleOrUrl: string }) =>
      ipcRenderer.invoke('nate-library:add-channel-base', input),
    buildChannelBase: (input: { baseId: string; batchSize?: number; sessionId?: string }) =>
      ipcRenderer.invoke('nate-library:build-channel-base', input),
    overview: () =>
      ipcRenderer.invoke('nate-library:overview'),
    search: (input?: { query?: string; kinds?: string[]; tags?: string[]; claimTypes?: string[]; videoId?: string; limit?: number }) =>
      ipcRenderer.invoke('nate-library:search', input),
    getVideo: (videoId: string) =>
      ipcRenderer.invoke('nate-library:get-video', videoId),
    chat: (input: { question: string; scope?: string; tags?: string[]; videoId?: string; limit?: number }) =>
      ipcRenderer.invoke('nate-library:chat', input),
    saveVideoArtifact: (input: { videoId: string; artifactType: 'transcript' | 'brief' }) =>
      ipcRenderer.invoke('nate-library:save-video-artifact', input),
    createInfographic: (input?: { query?: string; title?: string; tags?: string[]; mode?: string; limit?: number }) =>
      ipcRenderer.invoke('nate-library:create-infographic', input),
    createSlideDeck: (input?: { query?: string; title?: string; tags?: string[]; mode?: string; limit?: number }) =>
      ipcRenderer.invoke('nate-library:create-slide-deck', input),
    openSourceUrl: (url: string) =>
      ipcRenderer.invoke('nate-library:open-source-url', url),
    reveal: () =>
      ipcRenderer.invoke('nate-library:reveal'),
  },

  // ============ TASKS API ============
  tasks: {
    create: (agentId: string, sessionId: string, description: string, priority: number, dependencies?: string[]) =>
      ipcRenderer.invoke('task:create', agentId, sessionId, description, priority, dependencies),
    processQueue: () =>
      ipcRenderer.invoke('task:process-queue'),
    list: (sessionId: string) =>
      ipcRenderer.invoke('task:list', sessionId),
  },

  // ============ TOOLS API ============
  tools: {
    execute: (name: string, args: Record<string, any>) =>
      ipcRenderer.invoke('tool:execute', name, args),
    list: () =>
      ipcRenderer.invoke('tool:list'),
  },

  clipboard: {
    writeText: async (text: string) => {
      if (!clipboard?.writeText) {
        return false;
      }

      clipboard.writeText(String(text || ''));
      return true;
    },
  },

  // ============ KNOWLEDGE API ============
  knowledge: {
    ingest: (sessionId: string, content: string, title: string, source: string) =>
      ipcRenderer.invoke('knowledge:ingest', sessionId, content, title, source),
    ingestFile: (sessionId: string, fileName: string, mimeType: string, dataBase64: string) =>
      ipcRenderer.invoke('knowledge:ingest-file', sessionId, fileName, mimeType, dataBase64),
    search: (query: string, sessionId?: string) =>
      ipcRenderer.invoke('knowledge:search', query, sessionId),
    globalSearch: (query: string, options?: { sessionId?: string; limitPerSource?: number; globalScope?: boolean }) =>
      ipcRenderer.invoke('knowledge:global-search', query, options),
    listDocuments: (sessionId?: string, limit?: number) =>
      ipcRenderer.invoke('knowledge:list-documents', sessionId, limit),
    graphStatus: (sessionId?: string) =>
      ipcRenderer.invoke('knowledge:graph-status', sessionId),
    createGraphDiagram: (input?: { sessionId?: string; maxNodes?: number; show?: boolean }) =>
      ipcRenderer.invoke('knowledge:create-graph-diagram', input),
    openGraphDashboard: (input?: { sessionId?: string; open?: boolean }) =>
      ipcRenderer.invoke('knowledge:open-graph-dashboard', input),
    stats: (sessionId?: string) =>
      ipcRenderer.invoke('knowledge:stats', sessionId),
    getDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document', documentId),
  },

  legal: {
    analyzeDocument: (sessionId: string, documentId: string) =>
      ipcRenderer.invoke('legal:analyze-document', sessionId, documentId),
    analyzeUpload: (sessionId: string, fileName: string, mimeType: string, dataBase64: string) =>
      ipcRenderer.invoke('legal:analyze-upload', sessionId, fileName, mimeType, dataBase64),
    pickAndAnalyzeUpload: (sessionId: string) =>
      ipcRenderer.invoke('legal:pick-and-analyze-upload', sessionId),
    analyzeUrl: (sessionId: string, url: string, titleHint?: string) =>
      ipcRenderer.invoke('legal:analyze-url', sessionId, url, titleHint),
    openReport: (sessionId: string, options?: { query?: string; documentId?: string; latest?: boolean; limit?: number }) =>
      ipcRenderer.invoke('legal:open-report', sessionId, options),
    onOpenReport: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('legal:report-open', handler);
      return () => ipcRenderer.removeListener('legal:report-open', handler);
    },
  } satisfies LegalAnalysisAPI,

  // ============ MEMORY API ============
  memory: {
    add: (sessionId: string, content: string, sourceType: string) =>
      ipcRenderer.invoke('memory:add', sessionId, content, sourceType),
    get: (sessionId: string, tier?: string, query?: string) =>
      ipcRenderer.invoke('memory:get', sessionId, tier, query),
  },

  // ============ PIPELINES API ============
  pipelines: {
    create: (sessionId: string, name: string, templateName?: string) =>
      ipcRenderer.invoke('pipeline:create', sessionId, name, templateName),
    advance: (pipelineId: string) =>
      ipcRenderer.invoke('pipeline:advance', pipelineId),
    status: (pipelineId: string) =>
      ipcRenderer.invoke('pipeline:status', pipelineId),
    list: (sessionId: string) =>
      ipcRenderer.invoke('pipeline:list', sessionId),
  },

  // ============ VOICE API ============
  voice: {
    transcribe: (audioBase64: string, sessionId?: string) =>
      ipcRenderer.invoke('voice:transcribe', audioBase64, sessionId),
  },

  // ============ SCRAPE API ============
  scrape: {
    url: (url: string) =>
      ipcRenderer.invoke('scrape:url', url),
    search: (query: string) =>
      ipcRenderer.invoke('scrape:search', query),
  },

  // ============ SETTINGS API ============
  settings: {
    get: (key: string) =>
      ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) =>
      ipcRenderer.invoke('settings:set', key, value),
  },

  nexusBridge: {
    getStatus: () =>
      ipcRenderer.invoke('nexus-bridge:get-status'),
    getConfig: () =>
      ipcRenderer.invoke('nexus-bridge:get-config'),
    sync: () =>
      ipcRenderer.invoke('nexus-bridge:sync'),
    regenerateKey: () =>
      ipcRenderer.invoke('nexus-bridge:regenerate-key'),
    onStatus: (callback: (status: any) => void) => {
      const handler = (_event: any, status: any) => callback(status);
      ipcRenderer.on('nexus-bridge:status', handler);
      return () => ipcRenderer.removeListener('nexus-bridge:status', handler);
    },
  },

  // ============ DIAGNOSTICS API ============
  diagnostics: {
    runNetworkHealth: () =>
      ipcRenderer.invoke('diagnostics:network-health'),
    runtimeReadiness: () =>
      ipcRenderer.invoke('diagnostics:runtime-readiness'),
    ollamaStatus: () =>
      ipcRenderer.invoke('ollama:status'),
    ollamaRestart: () =>
      ipcRenderer.invoke('ollama:restart'),
  },

  usage: {
    overview: () =>
      ipcRenderer.invoke('usage:overview'),
  },

  // ============ ARTIFACTS API ============
  artifacts: {
    load: (filePath: string) =>
      ipcRenderer.invoke('artifact:load', filePath),
    open: (filePath: string) =>
      ipcRenderer.invoke('artifact:open', filePath),
    reveal: (filePath: string) =>
      ipcRenderer.invoke('artifact:reveal', filePath),
    saveAs: (filePath: string, suggestedName?: string) =>
      ipcRenderer.invoke('artifact:save-as', filePath, suggestedName),
    listWorkspaceFiles: (limit?: number) =>
      ipcRenderer.invoke('artifact:list-workspace-files', limit),
    materializeText: (sessionId: string | undefined, title: string, content: string, source?: string) =>
      ipcRenderer.invoke('artifact:materialize-text', sessionId, title, content, source),
    materializeHtml: (sessionId: string | undefined, title: string, html: string, source?: string) =>
      ipcRenderer.invoke('artifact:materialize-html', sessionId, title, html, source),
  },

  media: {
    getStatus: () =>
      ipcRenderer.invoke('media:get-status'),
    indexVideos: (videoPaths: string[], options?: Record<string, any>) =>
      ipcRenderer.invoke('media:index-videos', videoPaths, options),
    searchVideos: (query: string, options?: Record<string, any>) =>
      ipcRenderer.invoke('media:search-videos', query, options),
    clipVideo: (input: Record<string, any>) =>
      ipcRenderer.invoke('media:clip-video', input),
    stitchVideos: (input: Record<string, any>) =>
      ipcRenderer.invoke('media:stitch-videos', input),
    createNarratedSlideshow: (input: Record<string, any>) =>
      ipcRenderer.invoke('media:create-narrated-slideshow', input),
  },

  presentation: {
    prepare: (options: Record<string, any>) =>
      ipcRenderer.invoke('presentation:prepare', options),
    start: (options?: Record<string, any>) =>
      ipcRenderer.invoke('presentation:start', options),
    control: (action: string, options?: Record<string, any>) =>
      ipcRenderer.invoke('presentation:control', action, options),
    onReady: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('presentation:ready', handler);
      return () => ipcRenderer.removeListener('presentation:ready', handler);
    },
    onOpen: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('presentation:open', handler);
      return () => ipcRenderer.removeListener('presentation:open', handler);
    },
    onControl: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('presentation:control', handler);
      return () => ipcRenderer.removeListener('presentation:control', handler);
    },
    onError: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('presentation:error', handler);
      return () => ipcRenderer.removeListener('presentation:error', handler);
    },
  },

  browser: {
    open: (url: string, title?: string) =>
      ipcRenderer.invoke('browser:open', url, title),
    onOpen: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('browser:opened', handler);
      return () => ipcRenderer.removeListener('browser:opened', handler);
    },
    onClose: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('browser:closed', handler);
      return () => ipcRenderer.removeListener('browser:closed', handler);
    },
    onScreenshotSaved: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('browser:screenshot-saved', handler);
      return () => ipcRenderer.removeListener('browser:screenshot-saved', handler);
    },
  },

  visionGestures: {
    loadSettings: () =>
      ipcRenderer.invoke('vision-gestures:load-settings'),
    saveSettings: (settings: any) =>
      ipcRenderer.invoke('vision-gestures:save-settings', settings),
    revealSettings: () =>
      ipcRenderer.invoke('vision-gestures:reveal-settings'),
    clickScreen: (point: { normalizedX: number; normalizedY: number }) =>
      ipcRenderer.invoke('vision-gestures:click-screen', point),
    setDesktopControlMode: (enabled: boolean) =>
      ipcRenderer.invoke('vision-gestures:set-desktop-control-mode', enabled),
    openAccessibilitySettings: () =>
      ipcRenderer.invoke('vision-gestures:open-accessibility-settings'),
  },

  workspace: {
    onPresentArtifact: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('workspace:present-artifact', handler);
      return () => ipcRenderer.removeListener('workspace:present-artifact', handler);
    },
    onOpenTutorial: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('workspace:tutorial-open', handler);
      return () => ipcRenderer.removeListener('workspace:tutorial-open', handler);
    },
    onCloseActiveStage: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('workspace:close-active-stage', handler);
      return () => ipcRenderer.removeListener('workspace:close-active-stage', handler);
    },
  },

  marketing: {
    getBridgeState: () =>
      ipcRenderer.invoke('marketing:get-bridge-state'),
    listBridgeFiles: (limit?: number) =>
      ipcRenderer.invoke('marketing:list-bridge-files', limit),
    openExternal: (url?: string) =>
      ipcRenderer.invoke('marketing:open-external', url),
    revealFolder: (folder: 'root' | 'incoming' | 'outgoing') =>
      ipcRenderer.invoke('marketing:reveal-folder', folder),
    onDownloadEvent: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on('marketing:download-event', handler);
      return () => ipcRenderer.removeListener('marketing:download-event', handler);
    },
    getVideoConfig: () =>
      ipcRenderer.invoke('marketing-video:get-config'),
    saveVideoConfig: (input: Record<string, any>) =>
      ipcRenderer.invoke('marketing-video:save-config', input),
    createHeyGenVideo: (input: Record<string, any>) =>
      ipcRenderer.invoke('marketing-video:create-heygen-video', input),
    getHeyGenStatus: (videoId: string) =>
      ipcRenderer.invoke('marketing-video:get-heygen-status', videoId),
    generateAssistedPrompt: (input: Record<string, any>) =>
      ipcRenderer.invoke('marketing-video:generate-assisted-prompt', input),
    createGrokImage: (input: Record<string, any>) =>
      ipcRenderer.invoke('marketing-video:create-grok-image', input),
    createGrokVideo: (input: Record<string, any>) =>
      ipcRenderer.invoke('marketing-video:create-grok-video', input),
    getGrokVideoStatus: (requestId: string) =>
      ipcRenderer.invoke('marketing-video:get-grok-video-status', requestId),
  },

  spreadsheets: {
    open: (filePath: string) =>
      ipcRenderer.invoke('spreadsheet:open', filePath),
    inspect: (filePath: string, sheetName?: string) =>
      ipcRenderer.invoke('spreadsheet:inspect', filePath, sheetName),
    query: (filePath: string, query: string, sheetName?: string, limit?: number) =>
      ipcRenderer.invoke('spreadsheet:query', filePath, query, sheetName, limit),
    filter: (filePath: string, query: string, sheetName?: string, limit?: number) =>
      ipcRenderer.invoke('spreadsheet:filter', filePath, query, sheetName, limit),
    sort: (filePath: string, column: string, direction?: 'asc' | 'desc', sheetName?: string, limit?: number, query?: string) =>
      ipcRenderer.invoke('spreadsheet:sort', filePath, column, direction, sheetName, limit, query),
    updateCells: (filePath: string, sheetName: string, updates: unknown) =>
      ipcRenderer.invoke('spreadsheet:update-cells', filePath, sheetName, updates),
    exportTable: (filePath: string, outputPath: string, options?: { format?: 'xlsx' | 'xls' | 'csv' | 'tsv' | 'json'; sheetName?: string; query?: string; sortColumn?: string; direction?: 'asc' | 'desc'; sessionId?: string; title?: string }) =>
      ipcRenderer.invoke('spreadsheet:export-table', filePath, outputPath, options),
    generateChart: (filePath: string, outputPath: string, options: { labelColumn: string; valueColumn: string; chartType?: 'bar' | 'line'; sheetName?: string; query?: string; sortColumn?: string; direction?: 'asc' | 'desc'; limit?: number; title?: string; sessionId?: string }) =>
      ipcRenderer.invoke('spreadsheet:generate-chart', filePath, outputPath, options),
    create: (outputPath: string, options?: { sheetName?: string; rows?: unknown; sheets?: unknown }) =>
      ipcRenderer.invoke('spreadsheet:create', outputPath, options),
    appendRows: (filePath: string, sheetName: string, rows: unknown) =>
      ipcRenderer.invoke('spreadsheet:append-rows', filePath, sheetName, rows),
  },

  // ============ IMAGES API ============
  images: {
    generate: (prompt: string, options?: Record<string, any>) =>
      ipcRenderer.invoke('image:generate', prompt, options),
    analyze: (filePath: string, options?: { prompt?: string; sessionId?: string; title?: string }) =>
      ipcRenderer.invoke('image:analyze', filePath, options),
    analyzeDataUrl: (dataUrl: string, options?: { prompt?: string; sessionId?: string; title?: string }) =>
      ipcRenderer.invoke('image:analyze-data-url', dataUrl, options),
    openFolder: () =>
      ipcRenderer.invoke('image:open-folder'),
    onGenerated: (callback: (data: { path: string; mimeType: string; prompt: string; revisedPrompt?: string; category?: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('image:generated', handler);
      return () => ipcRenderer.removeListener('image:generated', handler);
    },
  },

  // ============ BRAINSTORM API ============
  brainstorm: {
    start: (sessionId: string, title: string) =>
      ipcRenderer.invoke('brainstorm:start', sessionId, title),
    processAudio: (brainstormId: string, audioBase64: string) =>
      ipcRenderer.invoke('brainstorm:process-audio', brainstormId, audioBase64),
    list: (sessionId: string) =>
      ipcRenderer.invoke('brainstorm:list', sessionId),
    get: (brainstormId: string) =>
      ipcRenderer.invoke('brainstorm:get', brainstormId),
    delete: (brainstormId: string) =>
      ipcRenderer.invoke('brainstorm:delete', brainstormId),
    showYouTube: (url: string) =>
      ipcRenderer.invoke('brainstorm:show-youtube', url),
    openYouTubeWindow: (embedUrl: string, title?: string) =>
      ipcRenderer.invoke('brainstorm:open-youtube-window', embedUrl, title),
  },

  // ============ ELEVENLABS API ============
  elevenlabs: {
    getSignedUrl: () =>
      ipcRenderer.invoke('elevenlabs:get-signed-url'),
    getAgentConfig: (sessionId?: string) =>
      ipcRenderer.invoke('elevenlabs:get-agent-config', sessionId),
    isConfigured: () =>
      ipcRenderer.invoke('elevenlabs:is-configured'),
    executeToolCall: (toolName: string, parameters: Record<string, any>, conversationId: string, sessionId?: string) =>
      ipcRenderer.invoke('elevenlabs:execute-tool-call', toolName, parameters, conversationId, sessionId),
    addTranscript: (conversationId: string, role: 'user' | 'agent', text: string) =>
      ipcRenderer.invoke('elevenlabs:add-transcript', conversationId, role, text),
    endSession: (conversationId: string, sessionId?: string) =>
      ipcRenderer.invoke('elevenlabs:end-session', conversationId, sessionId),
    ttsSpeak: (text: string): Promise<string> =>
      ipcRenderer.invoke('elevenlabs:tts-speak', text),
  },

  // ============ ENTITY CRM API ============
  entityCrm: {
    listPeople: (limit?: number) =>
      ipcRenderer.invoke('entity:list-people', limit),
    listBusinesses: (limit?: number) =>
      ipcRenderer.invoke('entity:list-businesses', limit),
    search: (query: string, entityType?: string) =>
      ipcRenderer.invoke('entity:search', query, entityType),
    getSessionContext: (sessionId: string, limit?: number) =>
      ipcRenderer.invoke('entity:get-session-context', sessionId, limit),
    getKnowledge: (entityType: 'person' | 'business', entityId: string, limit?: number) =>
      ipcRenderer.invoke('entity:get-knowledge', entityType, entityId, limit),
    chat: (
      entityType: 'person' | 'business',
      entityId: string,
      question: string,
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
    ) =>
      ipcRenderer.invoke('entity:chat', entityType, entityId, question, history),
    getPerson: (idOrName: string) =>
      ipcRenderer.invoke('entity:get-person', idOrName),
    getBusiness: (idOrName: string) =>
      ipcRenderer.invoke('entity:get-business', idOrName),
    getCounts: () =>
      ipcRenderer.invoke('entity:get-counts'),
    getPersonBusinesses: (personId: string) =>
      ipcRenderer.invoke('entity:get-person-businesses', personId),
    getBusinessPeople: (businessId: string) =>
      ipcRenderer.invoke('entity:get-business-people', businessId),
    createPerson: (data: any) =>
      ipcRenderer.invoke('entity:create-person', data),
    updatePerson: (id: string, data: any) =>
      ipcRenderer.invoke('entity:update-person', id, data),
    deletePerson: (id: string) =>
      ipcRenderer.invoke('entity:delete-person', id),
    createBusiness: (data: any) =>
      ipcRenderer.invoke('entity:create-business', data),
    updateBusiness: (id: string, data: any) =>
      ipcRenderer.invoke('entity:update-business', id, data),
    deleteBusiness: (id: string) =>
      ipcRenderer.invoke('entity:delete-business', id),
    mergePerson: (primaryId: string, duplicateId: string) =>
      ipcRenderer.invoke('entity:merge-person', primaryId, duplicateId),
    mergeBusiness: (primaryId: string, duplicateId: string) =>
      ipcRenderer.invoke('entity:merge-business', primaryId, duplicateId),
    linkPersonBusiness: (personId: string, businessId: string, role?: string, isFounder?: boolean) =>
      ipcRenderer.invoke('entity:link-person-business', personId, businessId, role, isFounder),
    unlinkPersonBusiness: (personId: string, businessId: string) =>
      ipcRenderer.invoke('entity:unlink-person-business', personId, businessId),
    backfillFromKnowledge: () =>
      ipcRenderer.invoke('entity:backfill-from-knowledge'),
    openPanel: (query?: string, entityType?: string, focusId?: string) =>
      ipcRenderer.invoke('entity:open-panel', query, entityType, focusId),
    onBackfillProgress: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('entity:backfill-progress', handler);
      return () => ipcRenderer.removeListener('entity:backfill-progress', handler);
    },
    onOpenPanel: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('entity:open-panel', handler);
      return () => ipcRenderer.removeListener('entity:open-panel', handler);
    },
  },

  // ============ MEETING MODE API ============
  meetingMode: {
    start: (sessionId: string) =>
      ipcRenderer.invoke('meeting-mode:start', sessionId),
    end: () =>
      ipcRenderer.invoke('meeting-mode:end'),
    addTranscript: (text: string, speaker?: string) =>
      ipcRenderer.invoke('meeting-mode:add-transcript', text, speaker),
    getState: () =>
      ipcRenderer.invoke('meeting-mode:get-state'),
    compileBriefing: () =>
      ipcRenderer.invoke('meeting-mode:compile-briefing'),
    isActive: () =>
      ipcRenderer.invoke('meeting-mode:is-active'),
    onUpdate: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('meeting-mode:update', handler);
      return () => ipcRenderer.removeListener('meeting-mode:update', handler);
    },
  },

  rollingTodo: {
    get: (sessionId: string) =>
      ipcRenderer.invoke('rolling-todo:get', sessionId),
    refresh: (sessionId: string, force?: boolean, reason?: string) =>
      ipcRenderer.invoke('rolling-todo:refresh', sessionId, force, reason),
    updateItem: (sessionId: string, slotIndex: number, patch: Record<string, any>) =>
      ipcRenderer.invoke('rolling-todo:update-item', sessionId, slotIndex, patch),
    exportPdf: (sessionId: string) =>
      ipcRenderer.invoke('rolling-todo:export-pdf', sessionId),
    emailPdf: (sessionId: string, to: string, subject?: string) =>
      ipcRenderer.invoke('rolling-todo:email-pdf', sessionId, to, subject),
    claimReminder: (sessionId: string) =>
      ipcRenderer.invoke('rolling-todo:claim-reminder', sessionId),
  },

  // ============ BROWSER AUTOMATION API (Playwright) ============
  browserAutomation: {
    open: (url: string) =>
      ipcRenderer.invoke('browser-automation:open', url),
    close: () =>
      ipcRenderer.invoke('browser-automation:close'),
    navigate: (url: string, pageId?: string) =>
      ipcRenderer.invoke('browser-automation:navigate', url, pageId),
    searchYouTube: (query: string) =>
      ipcRenderer.invoke('browser-automation:search-youtube', query),
    screenshot: (options?: { fullPage?: boolean; pageId?: string }) =>
      ipcRenderer.invoke('browser-automation:screenshot', options),
    getContent: (pageId?: string) =>
      ipcRenderer.invoke('browser-automation:get-content', pageId),
    click: (selector: string, pageId?: string) =>
      ipcRenderer.invoke('browser-automation:click', selector, pageId),
    type: (selector: string, text: string, pageId?: string) =>
      ipcRenderer.invoke('browser-automation:type', selector, text, pageId),
    scroll: (amount?: number, pageId?: string) =>
      ipcRenderer.invoke('browser-automation:scroll', amount, pageId),
    back: (pageId?: string) =>
      ipcRenderer.invoke('browser-automation:back', pageId),
    listPages: () =>
      ipcRenderer.invoke('browser-automation:list-pages'),
    isRunning: () =>
      ipcRenderer.invoke('browser-automation:is-running'),
  },

  privateProfile: {
    getAvailability: () =>
      ipcRenderer.invoke('private-profile:get-availability'),
    get: () =>
      ipcRenderer.invoke('private-profile:get'),
    save: (input: Record<string, any>) =>
      ipcRenderer.invoke('private-profile:save', input),
    clear: () =>
      ipcRenderer.invoke('private-profile:clear'),
  },

  secretVault: {
    getAvailability: () =>
      ipcRenderer.invoke('secret-vault:get-availability'),
    list: () =>
      ipcRenderer.invoke('secret-vault:list'),
    save: (input: Record<string, any>) =>
      ipcRenderer.invoke('secret-vault:save', input),
    delete: (id: string) =>
      ipcRenderer.invoke('secret-vault:delete', id),
  },

  // ============ VOICE TOOLS API (Router with permissions) ============
  voiceTools: {
    execute: (toolName: string, parameters: Record<string, any>) =>
      ipcRenderer.invoke('voice-tools:execute', toolName, parameters),
    getLogs: (limit?: number) =>
      ipcRenderer.invoke('voice-tools:get-logs', limit),
    resolveApproval: (id: string, approved: boolean) =>
      ipcRenderer.invoke('voice-tools:resolve-approval', id, approved),
    onApprovalRequired: (callback: (request: any) => void) => {
      const handler = (_event: any, request: any) => callback(request);
      ipcRenderer.on('voice-tools:approval-required', handler);
      return () => ipcRenderer.removeListener('voice-tools:approval-required', handler);
    },
    onToolExecuted: (callback: (log: any) => void) => {
      const handler = (_event: any, log: any) => callback(log);
      ipcRenderer.on('voice-tools:tool-executed', handler);
      return () => ipcRenderer.removeListener('voice-tools:tool-executed', handler);
    },
    showNotification: (title: string, body?: string) =>
      ipcRenderer.invoke('voice-tools:show-notification', title, body),
  },

  workTrace: {
    getRecent: (limit?: number, sessionId?: string) =>
      ipcRenderer.invoke('work-trace:get-recent', limit, sessionId),
    onEvent: (callback: (event: any) => void) => {
      const handler = (_event: any, event: any) => callback(event);
      ipcRenderer.on('work-trace:event', handler);
      return () => ipcRenderer.removeListener('work-trace:event', handler);
    },
  },

  missions: {
    list: () => ipcRenderer.invoke('mission:list'),
    get: (missionId: string) => ipcRenderer.invoke('mission:get', missionId),
    create: (input: MissionCreateInput) => ipcRenderer.invoke('mission:create', input),
    update: (missionId: string, input: MissionUpdateInput) => ipcRenderer.invoke('mission:update', missionId, input),
    appendEvent: (missionId: string, input: MissionAppendEventInput) =>
      ipcRenderer.invoke('mission:append-event', missionId, input),
    attachWorkTrace: (missionId: string, event: any) =>
      ipcRenderer.invoke('mission:attach-work-trace', missionId, event),
    exportMarkdown: (missionId: string) => ipcRenderer.invoke('mission:export-markdown', missionId),
    onChanged: (callback: (payload: any) => void) => {
      const handler = (_event: any, payload: any) => callback(payload);
      ipcRenderer.on('mission:changed', handler);
      return () => ipcRenderer.removeListener('mission:changed', handler);
    },
  },

  // ============ DIAGRAMS API ============
  diagrams: {
    create: (name, spec, sessionId) => ipcRenderer.invoke('diagram:create', name, spec, sessionId),
    list: (limit) => ipcRenderer.invoke('diagram:list', limit),
    get: (idOrName) => ipcRenderer.invoke('diagram:get', idOrName),
    generateFromPrompt: (request) => ipcRenderer.invoke('diagram:generate-from-prompt', request),
    delete: (id) => ipcRenderer.invoke('diagram:delete', id),
    rename: (id, newName) => ipcRenderer.invoke('diagram:rename', id, newName),
    addNode: (id, node) => ipcRenderer.invoke('diagram:add-node', id, node),
    removeNode: (id, nodeId) => ipcRenderer.invoke('diagram:remove-node', id, nodeId),
    updateNode: (id, nodeId, patch) => ipcRenderer.invoke('diagram:update-node', id, nodeId, patch),
    addEdge: (id, edge) => ipcRenderer.invoke('diagram:add-edge', id, edge),
    removeEdge: (id, fromId, toId) => ipcRenderer.invoke('diagram:remove-edge', id, fromId, toId),
    recolorNode: (id, nodeId, color) => ipcRenderer.invoke('diagram:recolor-node', id, nodeId, color),
    moveNode: (id, nodeId, x, y) => ipcRenderer.invoke('diagram:move-node', id, nodeId, x, y),
    show: (idOrName) => ipcRenderer.invoke('diagram:show', idOrName),
    close: () => ipcRenderer.invoke('diagram:close'),
    exportSvg: (id, targetPath) => ipcRenderer.invoke('diagram:export', id, targetPath),
    replaceSpec: (id, spec) => ipcRenderer.invoke('diagram:replace-spec', id, spec),
    onOpen: (cb) => {
      const h = (_e: any, rec: any) => cb(rec);
      ipcRenderer.on('diagram:open', h);
      return () => ipcRenderer.removeListener('diagram:open', h);
    },
    onUpdated: (cb) => {
      const h = (_e: any, rec: any) => cb(rec);
      ipcRenderer.on('diagram:updated', h);
      return () => ipcRenderer.removeListener('diagram:updated', h);
    },
    onClose: (cb) => {
      const h = () => cb();
      ipcRenderer.on('diagram:close', h);
      return () => ipcRenderer.removeListener('diagram:close', h);
    },
  },

  // ============ UNDERSTAND ANYTHING API ============
  understand: {
    status: (projectPath) => ipcRenderer.invoke('understand:status', projectPath),
    createDiagram: (input) => ipcRenderer.invoke('understand:create-diagram', input || {}),
    ingestKnowledge: (input) => ipcRenderer.invoke('understand:ingest-knowledge', input || {}),
    openDashboard: (input) => ipcRenderer.invoke('understand:open-dashboard', input || {}),
  },
};

/**
 * Expose the Nexus API to the renderer process
 */
contextBridge.exposeInMainWorld('nexus', nexusAPI);

/**
 * Extend Window interface to include nexus API
 */
declare global {
  interface Window {
    nexus: NexusAPI;
  }
}
