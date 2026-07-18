import { useEffect, useMemo, useState } from 'react';

type LibraryApi = {
  status: () => Promise<any>;
  getChannelBases: () => Promise<any[]>;
  addChannelBase: (input: { name?: string; handleOrUrl: string }) => Promise<any>;
  buildChannelBase: (input: { baseId: string; batchSize?: number; sessionId?: string }) => Promise<any>;
  overview: () => Promise<any>;
  search: (input?: { query?: string; kinds?: string[]; tags?: string[]; claimTypes?: string[]; videoId?: string; limit?: number }) => Promise<SearchResult[]>;
  getVideo: (videoId: string) => Promise<VideoDetail>;
  chat: (input: { question: string; scope?: string; tags?: string[]; videoId?: string; limit?: number }) => Promise<any>;
  saveVideoArtifact: (input: { videoId: string; artifactType: 'transcript' | 'brief' }) => Promise<any>;
  createInfographic: (input?: { query?: string; title?: string; tags?: string[]; mode?: string; limit?: number }) => Promise<any>;
  createSlideDeck: (input?: { query?: string; title?: string; tags?: string[]; mode?: string; limit?: number }) => Promise<any>;
  openSourceUrl: (url: string) => Promise<any>;
  reveal: () => Promise<any>;
};

type NexusBridge = {
  nateLibrary?: LibraryApi;
  clipboard?: {
    writeText?: (text: string) => Promise<boolean>;
  };
};

type SearchResult = {
  kind: string;
  recordType?: string;
  refId: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  sourceTime: string | null;
  sourceTimeSeconds: number | null;
  sourceUrlAtTime: string;
  text: string;
  pmAgentUse?: string | null;
  tags: unknown[];
  concepts: unknown[];
  claimTypes?: string[];
  numbers?: Array<Record<string, any>>;
  prediction?: Record<string, any> | null;
  confidence?: string | null;
  rank: number;
};

type KnowledgeSelection = {
  key: string;
  kind: string;
  recordType?: string;
  videoId: string;
  videoTitle: string;
  sourceTime: string | null;
  sourceUrlAtTime: string;
  label: string;
  text: string;
  pmAgentUse?: string | null;
  tags: unknown[];
  concepts: unknown[];
  confidence?: string | null;
};

type ChannelBase = {
  id: string;
  name: string;
  handleOrUrl: string;
  channelUrl: string;
  slug: string;
  status: 'ready' | 'pending_build' | 'fetching_transcripts' | 'needs_analysis' | 'failed';
  active: boolean;
  dbPath: string;
  outputDir: string;
  notes: string;
};

type OverviewVideo = {
  id: string;
  orderIndex: number;
  title: string;
  url: string;
  durationSeconds: number | null;
  publishedDate: string | null;
  transcriptStatus: string;
  transcriptWords: number;
  transcriptSegments: number;
  topics: Array<{ id?: string; label?: string; score?: number }>;
  topTerms: unknown[];
  projectManagerRelevance?: string;
  guidanceCount: number;
  predictionCount: number;
  numberCount: number;
  sourceRecordCount?: number;
  sourceFactCount?: number;
  sourceInstructionCount?: number;
  sourcePredictionCount?: number;
  sourceNumberCount?: number;
  perfectProcessCount?: number;
};

type VideoDetail = {
  video: OverviewVideo & {
    projectManagerRelevance?: string;
  };
  segments: Array<{
    id: string;
    segment_index: number;
    start_seconds: number;
    duration_ms: number;
    text: string;
    source_url_at_time: string;
  }>;
  facts: Array<Record<string, any>>;
  assertions: Array<Record<string, any>>;
  curated: Array<Record<string, any>>;
  sourceRecords: Array<Record<string, any>>;
  perfectProcess: Array<Record<string, any>>;
};

const KIND_OPTIONS = [
  { id: 'perfect_process', label: 'Process' },
  { id: 'source_record', label: 'Grounded' },
  { id: 'transcript_segment', label: 'Transcript' },
  { id: 'curated', label: 'Legacy' },
];

const CLAIM_TYPE_OPTIONS = [
  { id: 'fact', label: 'Facts' },
  { id: 'claim', label: 'Claims' },
  { id: 'recommendation', label: 'Recs' },
  { id: 'instruction', label: 'Instructions' },
  { id: 'belief', label: 'Beliefs' },
  { id: 'prediction', label: 'Predictions' },
  { id: 'noun_number', label: 'Numbers' },
];

const STARTER_QUERIES = [
  'project room source inventory conflict log',
  'vibe coding blind spots',
  'agentic workflows',
  'MCP servers',
  'prompting context',
  'AI coding',
  'prediction future work',
  'build buy strategy',
];

function api(): LibraryApi {
  const library = ((window as any).nexus as NexusBridge | undefined)?.nateLibrary;
  if (!library) {
    throw new Error('Nate library bridge is not available. Relaunch the Nate KB shell so the preload API can attach.');
  }
  return library;
}

function bridge(): NexusBridge {
  return ((window as any).nexus || {}) as NexusBridge;
}

function fmtNumber(value: unknown): string {
  return Number(value || 0).toLocaleString();
}

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function sourceLabel(result: SearchResult): string {
  return [result.recordType || result.kind.replace(/_/g, ' '), result.sourceTime || null, result.confidence || null].filter(Boolean).join(' · ');
}

function fmtTime(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function tokenLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record.label || record.id || record.name || record.text || '').trim();
  }
  return String(value).trim();
}

function selectionFromResult(result: SearchResult): KnowledgeSelection {
  return {
    key: `${result.kind}:${result.refId}`,
    kind: result.kind,
    recordType: result.recordType,
    videoId: result.videoId,
    videoTitle: result.videoTitle,
    sourceTime: result.sourceTime,
    sourceUrlAtTime: result.sourceUrlAtTime,
    label: sourceLabel(result),
    text: result.text,
    pmAgentUse: result.pmAgentUse,
    tags: result.tags || [],
    concepts: result.concepts || [],
    confidence: result.confidence,
  };
}

function selectionFromDetailRecord(record: Record<string, any>, video: OverviewVideo): KnowledgeSelection {
  const kind = record.item_type ? 'perfect_process' : 'source_record';
  const recordType = record.item_type || record.record_type;
  const text = record.text || record.source_text || '';
  return {
    key: `${kind}:${record.id}`,
    kind,
    recordType,
    videoId: video.id,
    videoTitle: video.title,
    sourceTime: record.source_time || fmtTime(record.source_time_seconds),
    sourceUrlAtTime: record.source_url_at_time || video.url,
    label: [recordType || kind, record.source_time || fmtTime(record.source_time_seconds), record.confidence].filter(Boolean).join(' · '),
    text,
    pmAgentUse: record.pm_agent_use || (kind === 'perfect_process' ? 'Manual-grade process extraction for PM-agent operating knowledge.' : null),
    tags: record.tags || [],
    concepts: [record.item_type, record.item_id, ...(record.concepts || [])].filter(Boolean),
    confidence: record.confidence || (kind === 'perfect_process' ? 'manual_baseline_process' : null),
  };
}

function selectionFromSegment(segment: VideoDetail['segments'][number], video: OverviewVideo): KnowledgeSelection {
  return {
    key: `transcript_segment:${segment.id}`,
    kind: 'transcript_segment',
    recordType: 'transcript',
    videoId: video.id,
    videoTitle: video.title,
    sourceTime: fmtTime(segment.start_seconds),
    sourceUrlAtTime: segment.source_url_at_time,
    label: `transcript · ${fmtTime(segment.start_seconds) || '0:00'}`,
    text: segment.text,
    tags: [],
    concepts: ['transcript'],
    confidence: null,
  };
}

function knowledgeMarkdown(item: KnowledgeSelection): string {
  const tags = [...(item.tags || []), ...(item.concepts || [])].map(tokenLabel).filter(Boolean);
  return [
    `### ${item.recordType || item.kind}${item.sourceTime ? ` · ${item.sourceTime}` : ''}`,
    '',
    item.text,
    item.pmAgentUse ? `\nPM-agent use: ${item.pmAgentUse}` : '',
    '',
    `Source: ${item.videoTitle}${item.sourceTime ? ` at ${item.sourceTime}` : ''}`,
    `URL: ${item.sourceUrlAtTime}`,
    tags.length ? `Tags: ${unique(tags).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function briefMarkdown(items: KnowledgeSelection[]): string {
  return [
    '# Nate Jones Knowledge Brief',
    '',
    'Use these selected records as internal PM-agent operating context. Verify source timestamps before external sharing.',
    '',
    ...items.map(knowledgeMarkdown),
    '',
  ].join('\n');
}

export function NateJonesKnowledgeApp() {
  const [overview, setOverview] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [channelBases, setChannelBases] = useState<ChannelBase[]>([]);
  const [showAddBase, setShowAddBase] = useState(false);
  const [newBaseName, setNewBaseName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [query, setQuery] = useState('project room source inventory conflict log');
  const [selectedKinds, setSelectedKinds] = useState<string[]>(['perfect_process', 'source_record']);
  const [selectedClaimTypes, setSelectedClaimTypes] = useState<string[]>(['fact', 'claim', 'recommendation', 'instruction', 'prediction', 'noun_number']);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [videoDetail, setVideoDetail] = useState<VideoDetail | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeSelection | null>(null);
  const [briefItems, setBriefItems] = useState<KnowledgeSelection[]>([]);
  const [chatQuestion, setChatQuestion] = useState('What are the biggest blind spots in vibe coding?');
  const [chatScope, setChatScope] = useState<'global' | 'video'>('video');
  const [chatAnswer, setChatAnswer] = useState<any>(null);
  const [busy, setBusy] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextStatus, nextOverview, nextBases] = await Promise.all([api().status(), api().overview(), api().getChannelBases()]);
        if (cancelled) return;
        setStatus(nextStatus);
        setOverview(nextOverview);
        setChannelBases(nextBases);
        const firstVideo = nextOverview.videos?.[0];
        if (firstVideo?.id) {
          setSelectedVideoId(firstVideo.id);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function runSearch() {
      try {
        const rows = await api().search({ query, kinds: selectedKinds, tags: selectedTags, claimTypes: selectedClaimTypes, limit: 64 });
        if (!cancelled) setResults(rows);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
      }
    }
    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [query, selectedKinds, selectedTags, selectedClaimTypes]);

  useEffect(() => {
    if (!selectedVideoId) return;
    let cancelled = false;
    async function loadVideo() {
      try {
        const detail = await api().getVideo(selectedVideoId);
        if (!cancelled) setVideoDetail(detail);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
      }
    }
    void loadVideo();
    return () => {
      cancelled = true;
    };
  }, [selectedVideoId]);

  useEffect(() => {
    if (results.length === 0) return;
    if (selectedVideoId && results.some((result) => result.videoId === selectedVideoId)) return;
    setSelectedVideoId(results[0].videoId);
  }, [results, selectedVideoId]);

  useEffect(() => {
    if (results.length === 0) return;
    setSelectedKnowledge((current) => {
      if (current && results.some((result) => `${result.kind}:${result.refId}` === current.key)) return current;
      return selectionFromResult(results[0]);
    });
  }, [results]);

  const videos: OverviewVideo[] = overview?.videos || [];
  const tagCounts: Array<{ tag: string; count: number }> = overview?.tagCounts || [];
  const activeVideo = videoDetail?.video || videos.find((video) => video.id === selectedVideoId);
  const activeVideoTranscript = useMemo(() => {
    return (videoDetail?.segments || []).map((segment) => tokenLabel(segment.text)).filter(Boolean).join(' ');
  }, [videoDetail]);
  const activeVideoBrief = useMemo(() => {
    if (!activeVideo) return '';
    const processRows = videoDetail?.perfectProcess || [];
    const artifacts = processRows.filter((record) => record.item_type === 'artifact');
    const rules = processRows.filter((record) => record.item_type === 'operating_rule');
    const grounded = videoDetail?.sourceRecords || [];
    return [
      `# ${activeVideo.title}`,
      '',
      activeVideo.projectManagerRelevance || '',
      '',
      '## Process Knowledge',
      ...processRows.slice(0, 12).map((record) => `- ${record.source_time || ''} ${record.item_type || ''}: ${record.text || record.source_text || ''}`),
      '',
      '## Artifacts',
      ...(artifacts.length ? artifacts.map((record) => `- ${record.item_id || record.title}: ${record.text}`) : ['- No manual-grade artifacts yet.']),
      '',
      '## Rules',
      ...(rules.length ? rules.map((record) => `- ${record.item_id || record.title}: ${record.text}`) : ['- No manual-grade rules yet.']),
      '',
      '## Grounded Records',
      ...grounded.slice(0, 12).map((record) => `- ${record.source_time || ''} ${record.record_type || ''}: ${record.source_text || record.text || ''}`),
    ].filter(Boolean).join('\n');
  }, [activeVideo, videoDetail]);
  const filteredTimeline = useMemo(() => {
    if (selectedTags.length === 0) return videos;
    return videos.filter((video) => {
      const topicIds = (video.topics || []).map((topic) => topicLabel(topic));
      return selectedTags.some((tag) => topicIds.includes(tag));
    });
  }, [selectedTags, videos]);
  const availableConcepts = unique(results.flatMap((result) => result.concepts || []).map(tokenLabel).filter(Boolean)).slice(0, 16);

  function topicLabel(topic: unknown): string {
    return tokenLabel(topic);
  }

  async function askData(overrides?: { scope?: 'global' | 'video'; question?: string }) {
    setBusy('chat');
    setNotice('Searching the private library for a grounded answer...');
    const nextScope = overrides?.scope || chatScope;
    const nextQuestion = overrides?.question || chatQuestion;
    try {
      const answer = await api().chat({
        question: nextQuestion,
        scope: query,
        tags: selectedTags,
        videoId: nextScope === 'video' ? selectedVideoId : undefined,
        limit: 12,
      });
      setChatAnswer(answer);
      setNotice(`Chat answer ready from ${(answer.citations || []).length} timestamped sources.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function createInfographic() {
    setBusy('infographic');
    setNotice('Creating infographic from the current query and filters...');
    try {
      const output = await api().createInfographic({ query, tags: selectedTags, title: query || 'Nate Jones Knowledge Map', limit: 36 });
      setNotice(`Infographic created: ${output.path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function createDeck() {
    setBusy('deck');
    setNotice('Creating slide deck from the current query and filters...');
    try {
      const output = await api().createSlideDeck({ query, tags: selectedTags, title: query || 'Nate Jones PM Agent Deck', limit: 28 });
      setNotice(`Deck created: ${output.pptxPath}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function saveVideoArtifact(artifactType: 'transcript' | 'brief') {
    if (!selectedVideoId) return;
    setBusy(`save-${artifactType}`);
    setNotice(`Saving ${artifactType} markdown for the selected video...`);
    try {
      const output = await api().saveVideoArtifact({ videoId: selectedVideoId, artifactType });
      setNotice(`Saved ${artifactType}: ${output.path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  function chatWithSelectedVideo(question?: string) {
    const nextQuestion = question || chatQuestion;
    setChatScope('video');
    setChatQuestion(nextQuestion);
    void askData({ scope: 'video', question: nextQuestion });
  }

  async function addChannelBase() {
    if (!newBaseUrl.trim()) {
      setNotice('Paste a YouTube handle or channel URL before creating a channel base.');
      return;
    }
    setBusy('add-base');
    setNotice('Registering the new channel base...');
    try {
      const added = await api().addChannelBase({ name: newBaseName, handleOrUrl: newBaseUrl });
      const nextBases = await api().getChannelBases();
      setChannelBases(nextBases);
      setNewBaseName('');
      setNewBaseUrl('');
      setShowAddBase(false);
      setNotice(`Added ${added.name} as a separate channel base. It is registered and ready for transcript/build import.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function buildChannelBase(base: ChannelBase) {
    setBusy(`build-base:${base.id}`);
    setNotice(`Fetching transcripts for ${base.name}. This can take a while on large channels.`);
    try {
      const result = await api().buildChannelBase({ baseId: base.id, batchSize: 25 });
      const nextBases = await api().getChannelBases();
      setChannelBases(nextBases);
      setNotice(result.message || `${base.name} transcript fetch complete.`);
    } catch (error) {
      const nextBases = await api().getChannelBases().catch(() => channelBases);
      setChannelBases(nextBases);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function revealLibrary() {
    setBusy('reveal');
    setNotice('Opening the private library folder...');
    try {
      const result = await api().reveal();
      setNotice(`Opened library folder: ${result.path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function openUrl(url: string | null | undefined, label = 'source') {
    if (!url) {
      setNotice(`No ${label} URL is available for this record.`);
      return;
    }
    try {
      await api().openSourceUrl(url);
      setNotice(`Opened ${label}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function openSource(item: KnowledgeSelection | null = selectedKnowledge) {
    void openUrl(item?.sourceUrlAtTime, item?.sourceTime ? `source timestamp ${item.sourceTime}` : 'source timestamp');
  }

  async function copyText(value: string, message: string) {
    try {
      const copied = await bridge().clipboard?.writeText?.(value);
      if (copied) {
        setNotice(message);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setNotice(message);
        return;
      }
      setNotice('Clipboard copy is not available in this shell.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Clipboard copy was blocked by the browser shell.');
    }
  }

  function selectKnowledge(item: KnowledgeSelection) {
    setSelectedKnowledge(item);
    setSelectedVideoId(item.videoId);
    setNotice(`Selected ${item.recordType || item.kind}${item.sourceTime ? ` at ${item.sourceTime}` : ''}.`);
  }

  function selectVideo(videoId: string) {
    setSelectedVideoId(videoId);
    setChatScope('video');
    const video = videos.find((item) => item.id === videoId);
    setNotice(video ? `Loaded video workspace: ${video.title}` : 'Loaded video workspace.');
  }

  function addToBrief(item: KnowledgeSelection | null = selectedKnowledge) {
    if (!item) return;
    setBriefItems((current) => current.some((existing) => existing.key === item.key) ? current : [...current, item]);
    setNotice('Added to working brief.');
  }

  function removeFromBrief(key: string) {
    setBriefItems((current) => current.filter((item) => item.key !== key));
    setNotice('Removed record from the working brief.');
  }

  function toggleKind(kind: string) {
    const next = selectedKinds.includes(kind) ? selectedKinds.filter((item) => item !== kind) : [...selectedKinds, kind];
    const normalized = next.length ? next : [kind];
    setSelectedKinds(normalized);
    setNotice(`Data filters: ${normalized.map((id) => KIND_OPTIONS.find((item) => item.id === id)?.label || id).join(', ')}.`);
  }

  function toggleTag(tag: string) {
    const next = selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag];
    setSelectedTags(next);
    setNotice(next.length ? `Tag filters: ${next.join(', ')}.` : 'Tag filters cleared.');
  }

  function toggleClaimType(type: string) {
    const next = selectedClaimTypes.includes(type) ? selectedClaimTypes.filter((item) => item !== type) : [...selectedClaimTypes, type];
    setSelectedClaimTypes(next);
    setNotice(next.length ? `Claim filters: ${next.join(', ')}.` : 'Claim filters cleared.');
  }

  function setQueryWithNotice(nextQuery: string, source: string) {
    setQuery(nextQuery);
    setNotice(`${source}: searching "${nextQuery}".`);
  }

  function searchSimilarSelected() {
    if (!selectedKnowledge) return;
    const nextQuery = unique([selectedKnowledge.recordType, ...selectedKnowledge.concepts.map(tokenLabel)].filter(Boolean)).slice(0, 6).join(' ');
    setQuery(nextQuery);
    setNotice(`Searching similar records: ${nextQuery}.`);
  }

  return (
    <div className="nate-shell">
      <aside className="nate-sidebar">
        <div className="brand-block">
          <div className="brand-mark">YT</div>
          <div>
            <h1>YouTube Knowledge Library</h1>
            <p>Channel bases · private transcript intelligence</p>
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric-tile">
            <strong>{fmtNumber(status?.videos || 0)}</strong>
            <span>Videos</span>
          </div>
          <div className="metric-tile">
            <strong>{fmtNumber(status?.transcripts || 0)}</strong>
            <span>Transcripts</span>
          </div>
          <div className="metric-tile">
            <strong>{fmtNumber(status?.report?.totals?.transcript_words || 0)}</strong>
            <span>Words</span>
          </div>
          <div className="metric-tile">
            <strong>{fmtNumber(status?.perfectProcessRows || 0)}</strong>
            <span>Process records</span>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="sidebar-title-row">
            <h2>Channel Bases</h2>
            <button onClick={() => {
              setShowAddBase((current) => !current);
              setNotice(showAddBase ? 'Closed the channel-base form.' : 'Opened the channel-base form.');
            }}>{showAddBase ? 'Close' : 'Add'}</button>
          </div>
          <div className="base-list">
            {channelBases.map((base) => (
              <article key={base.id} className={base.active ? 'base-card active' : 'base-card'}>
                <div>
                  <strong>{base.name}</strong>
                  <span>{base.channelUrl}</span>
                </div>
                <small>{base.active ? 'Active' : base.status === 'ready' ? 'Ready' : base.status === 'fetching_transcripts' ? 'Fetching' : base.status === 'needs_analysis' ? 'Needs analysis' : base.status === 'failed' ? 'Failed' : 'Needs build'}</small>
                {!base.active && base.status !== 'ready' && (
                  <button
                    className="base-action"
                    disabled={busy === `build-base:${base.id}` || base.status === 'fetching_transcripts'}
                    onClick={() => buildChannelBase(base)}
                  >
                    {busy === `build-base:${base.id}` || base.status === 'fetching_transcripts' ? 'Fetching...' : 'Fetch Transcripts'}
                  </button>
                )}
                {base.notes && <p>{base.notes}</p>}
              </article>
            ))}
          </div>
          {showAddBase && (
            <div className="add-base-form">
              <input value={newBaseName} onChange={(event) => setNewBaseName(event.target.value)} placeholder="Channel name" />
              <input value={newBaseUrl} onChange={(event) => setNewBaseUrl(event.target.value)} placeholder="@handle or YouTube channel URL" />
              <button disabled={busy === 'add-base' || !newBaseUrl.trim()} onClick={addChannelBase}>
                {busy === 'add-base' ? 'Adding...' : 'Create Base'}
              </button>
            </div>
          )}
        </section>

        <section className="sidebar-section">
          <h2>Tags</h2>
          <div className="tag-list">
            {tagCounts.slice(0, 12).map((item) => (
              <button
                key={item.tag}
                className={selectedTags.includes(item.tag) ? 'tag active' : 'tag'}
                onClick={() => toggleTag(item.tag)}
              >
                <span>{item.tag}</span>
                <small>{item.count}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section">
          <h2>Outputs</h2>
          <button className="command-button" disabled={busy === 'infographic'} onClick={createInfographic}>
            {busy === 'infographic' ? 'Creating...' : 'Infographic'}
          </button>
          <button className="command-button" disabled={busy === 'deck'} onClick={createDeck}>
            {busy === 'deck' ? 'Creating...' : 'Slide Deck'}
          </button>
          <button className="ghost-button" disabled={busy === 'reveal'} onClick={() => void revealLibrary()}>
            {busy === 'reveal' ? 'Opening...' : 'Library Folder'}
          </button>
        </section>
      </aside>

      <main className="nate-main">
        <header className="topbar">
          <div className="search-wrap">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search transcripts, facts, predictions, recommendations, numbers..."
            />
          </div>
          <div className="kind-controls">
            {KIND_OPTIONS.map((kind) => (
              <button
                key={kind.id}
                className={selectedKinds.includes(kind.id) ? 'kind active' : 'kind'}
                onClick={() => toggleKind(kind.id)}
              >
                {kind.label}
              </button>
            ))}
          </div>
        </header>

        <section className="claim-filter-row">
          {CLAIM_TYPE_OPTIONS.map((item) => (
            <button
              key={item.id}
              className={selectedClaimTypes.includes(item.id) ? 'claim-chip active' : 'claim-chip'}
              onClick={() => toggleClaimType(item.id)}
            >
              {item.label}
            </button>
          ))}
        </section>

        {notice && <div className="notice">{notice}</div>}

        <section className="starter-row">
          {STARTER_QUERIES.map((item) => (
            <button key={item} onClick={() => setQueryWithNotice(item, 'Starter query')}>{item}</button>
          ))}
        </section>

        <section className="timeline-panel">
          <div className="section-head">
            <h2>Video Timeline</h2>
            <span>{filteredTimeline.length} videos</span>
          </div>
          <div className="video-timeline">
            {filteredTimeline.map((video) => (
              <button
                key={video.id}
                className={video.id === selectedVideoId ? 'timeline-item active' : 'timeline-item'}
                onClick={() => selectVideo(video.id)}
                title={video.title}
              >
                <span className="timeline-date">{video.publishedDate || `#${video.orderIndex}`}</span>
                <span className="timeline-title">{video.title}</span>
                <span className="timeline-counts">{video.perfectProcessCount || 0} process · {video.sourceInstructionCount || 0} instr · {video.sourceNumberCount || 0} nums</span>
              </button>
            ))}
          </div>
        </section>

        <div className="content-grid">
          <section className="results-panel">
            <div className="section-head">
              <h2>Search Database</h2>
              <span>{results.length} records</span>
            </div>
            <div className="concept-row">
              {availableConcepts.map((concept) => (
                <button key={concept} onClick={() => setQueryWithNotice(concept, 'Concept filter')}>{concept}</button>
              ))}
            </div>
            <div className="result-list">
              {results.map((result) => {
                const item = selectionFromResult(result);
                const isSelected = selectedKnowledge?.key === item.key;
                return (
                <article
                  key={`${result.kind}-${result.refId}`}
                  className={isSelected ? 'result-card selected' : 'result-card'}
                  onClick={() => selectKnowledge(item)}
                >
                  <div className="record-meta">
                    <span>{sourceLabel(result)}</span>
                    <div className="record-actions">
                      <button onClick={(event) => { event.stopPropagation(); selectKnowledge(item); }}>Use</button>
                      <button onClick={(event) => { event.stopPropagation(); addToBrief(item); }}>Brief</button>
                      <button onClick={(event) => { event.stopPropagation(); openSource(item); }}>Source</button>
                    </div>
                  </div>
                  <p>{result.text}</p>
                  {result.pmAgentUse && <p className="pm-use">{result.pmAgentUse}</p>}
                  {(result.numbers || []).length > 0 && (
                    <div className="number-row">
                      {(result.numbers || []).slice(0, 3).map((number, index) => (
                        <span key={`${result.refId}-number-${index}`}>
                          {String(number.full_phrase || `${number.raw_value || ''} ${number.noun_phrase || ''}`).trim()}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="record-tags">
                    {(result.claimTypes || []).slice(0, 4).map((type) => <span key={`${result.refId}-${type}`}>{type}</span>)}
                    {(result.tags || []).slice(0, 4).map((tag) => {
                      const label = tokenLabel(tag);
                      return label ? <span key={label}>{label}</span> : null;
                    })}
                  </div>
                  <button
                    className="inline-link"
                    onClick={(event) => { event.stopPropagation(); selectVideo(result.videoId); }}
                  >
                    Show source drilldown: {result.videoTitle}
                  </button>
                </article>
                );
              })}
            </div>
          </section>

          <section className="detail-panel">
            <div className="section-head">
              <h2>Knowledge Workspace</h2>
              <span>{activeVideo?.publishedDate || 'No publish date'}</span>
            </div>
            {activeVideo && (
              <div className="video-workspace">
                <div className="video-workspace-head">
                  <div>
                    <span>Selected video</span>
                    <h3>{activeVideo.title}</h3>
                  </div>
                  <button onClick={() => void openUrl(activeVideo.url, 'video')}>Open Video</button>
                </div>
                <p>{(activeVideo as any).projectManagerRelevance || activeVideo.topTerms?.slice(0, 8).map(tokenLabel).filter(Boolean).join(', ')}</p>
                <div className="video-metrics">
                  <span>{fmtNumber(activeVideo.transcriptSegments || videoDetail?.segments?.length || 0)} segments</span>
                  <span>{fmtNumber(activeVideo.transcriptWords || 0)} words</span>
                  <span>{fmtNumber(videoDetail?.perfectProcess?.length || 0)} process</span>
                  <span>{fmtNumber(videoDetail?.sourceRecords?.length || 0)} grounded</span>
                </div>
                <div className="workspace-actions">
                  <button disabled={!activeVideoTranscript} onClick={() => void copyText(activeVideoTranscript, 'Transcript copied.')}>Copy Transcript</button>
                  <button disabled={!activeVideoTranscript || busy === 'save-transcript'} onClick={() => void saveVideoArtifact('transcript')}>
                    {busy === 'save-transcript' ? 'Saving...' : 'Save Transcript'}
                  </button>
                  <button disabled={!activeVideoBrief} onClick={() => void copyText(activeVideoBrief, 'Video brief copied.')}>Copy Video Brief</button>
                  <button disabled={!activeVideoBrief || busy === 'save-brief'} onClick={() => void saveVideoArtifact('brief')}>
                    {busy === 'save-brief' ? 'Saving...' : 'Save Brief'}
                  </button>
                  <button onClick={() => chatWithSelectedVideo('What is useful in this video for a PM agent?')}>Chat This Video</button>
                </div>
              </div>
            )}
            <div className="selected-knowledge">
              <div className="selected-meta">
                <span>{selectedKnowledge?.label || 'Select a record'}</span>
                <strong>{selectedKnowledge?.videoTitle || 'No knowledge selected'}</strong>
              </div>
              <p>{selectedKnowledge?.text || 'Click a search record, process item, grounded item, or transcript segment to inspect it here without leaving the app.'}</p>
              {selectedKnowledge?.pmAgentUse && <p className="pm-use">{selectedKnowledge.pmAgentUse}</p>}
              <div className="record-tags">
                {unique([...(selectedKnowledge?.tags || []), ...(selectedKnowledge?.concepts || [])].map(tokenLabel).filter(Boolean)).slice(0, 8).map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="workspace-actions">
                <button disabled={!selectedKnowledge} onClick={() => addToBrief()}>Add To Brief</button>
                <button disabled={!selectedKnowledge} onClick={() => selectedKnowledge && void copyText(knowledgeMarkdown(selectedKnowledge), 'Selected knowledge copied.')}>Copy Knowledge</button>
                <button disabled={!selectedKnowledge} onClick={searchSimilarSelected}>Search Similar</button>
                <button disabled={!selectedKnowledge} onClick={() => openSource()}>Open Source Timestamp</button>
              </div>
            </div>
            {activeVideo && (
              <>
                <div className="video-summary compact">
                  <h3>{activeVideo.title}</h3>
                  <div className="record-tags">
                    {(activeVideo.topics || []).slice(0, 4).map((topic) => {
                      const label = topicLabel(topic);
                      return label ? <span key={label}>{label}</span> : null;
                    })}
                  </div>
                </div>

                <div className="source-bars">
                  {[...(videoDetail?.perfectProcess || []), ...(videoDetail?.sourceRecords || [])].slice(0, 22).map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => selectKnowledge(selectionFromDetailRecord(record, activeVideo))}
                      className={`source-bar ${record.item_type || record.record_type || ''}`}
                      style={{ left: `${Math.min(96, Math.max(0, ((record.source_time_seconds || 0) / Math.max(activeVideo.durationSeconds || 1, 1)) * 100))}%` }}
                      title={`${record.item_type || record.record_type} ${record.source_time || ''}`}
                    />
                  ))}
                </div>

                <div className="drilldown-columns">
                  <div>
                    <h3>Process + Grounded</h3>
                    <div className="mini-list">
                      {[...(videoDetail?.perfectProcess || []), ...(videoDetail?.sourceRecords || [])].slice(0, 34).map((record) => (
                        <button key={record.id} type="button" onClick={() => selectKnowledge(selectionFromDetailRecord(record, activeVideo))}>
                          <strong>{record.source_time || '0:00'}</strong>
                          <span><b>{record.item_type || record.record_type}</b> {record.text || record.source_text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>Transcript</h3>
                    <div className="mini-list transcript-list">
                      {(videoDetail?.segments || []).slice(0, 80).map((segment) => (
                        <button key={segment.id} type="button" onClick={() => selectKnowledge(selectionFromSegment(segment, activeVideo))}>
                          <strong>{Math.floor(segment.start_seconds / 60)}:{String(segment.start_seconds % 60).padStart(2, '0')}</strong>
                          <span>{segment.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        <section className="brief-panel">
          <div className="section-head">
            <h2>Working Brief</h2>
            <span>{briefItems.length} selected records</span>
          </div>
          {briefItems.length === 0 ? (
            <p className="empty-brief">Add process rules, grounded facts, or transcript moments here before generating an output.</p>
          ) : (
            <>
              <div className="brief-list">
                {briefItems.map((item) => (
                  <article key={item.key}>
                    <button className="remove-brief" onClick={() => removeFromBrief(item.key)}>Remove</button>
                    <strong>{item.recordType || item.kind}{item.sourceTime ? ` · ${item.sourceTime}` : ''}</strong>
                    <span>{item.text}</span>
                  </article>
                ))}
              </div>
              <div className="workspace-actions">
                <button onClick={() => void copyText(briefMarkdown(briefItems), 'Working brief copied.')}>Copy Brief</button>
                <button onClick={() => { setBriefItems([]); setNotice('Working brief cleared.'); }}>Clear Brief</button>
              </div>
            </>
          )}
        </section>

        <section className="chat-panel">
          <div className="section-head">
            <h2>Chat With Data</h2>
            <span>{busy === 'chat' ? 'Searching...' : chatScope === 'video' ? 'Selected video' : 'Global library'}</span>
          </div>
          <div className="scope-toggle">
            <button className={chatScope === 'video' ? 'active' : ''} onClick={() => { setChatScope('video'); setNotice('Chat scope set to the selected video.'); }} disabled={!selectedVideoId}>
              This Video
            </button>
            <button className={chatScope === 'global' ? 'active' : ''} onClick={() => { setChatScope('global'); setNotice('Chat scope set to the full private library.'); }}>
              Global Library
            </button>
            {chatScope === 'video' && activeVideo && <span>{activeVideo.title}</span>}
          </div>
          <div className="chat-input-row">
            <input value={chatQuestion} onChange={(event) => setChatQuestion(event.target.value)} />
            <button disabled={busy === 'chat'} onClick={() => void askData()}>{busy === 'chat' ? 'Asking...' : 'Ask'}</button>
          </div>
          {chatAnswer && (
            <div className="chat-answer">
              <p>{chatAnswer.answer}</p>
              <div className="citation-row">
                {(chatAnswer.citations || []).slice(0, 8).map((citation: any) => (
                  <button key={`${citation.kind}-${citation.refId}`} onClick={() => void openUrl(citation.url, 'chat source')}>
                    Open source · {citation.kind} · {citation.time || 'source'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
