import { useCallback, useEffect, useMemo, useState } from 'react';

type ChatScope = 'video' | 'global';
type ArtifactType = 'transcript' | 'brief';

interface YoutubeVideoRow {
  id: string;
  title: string;
  url: string;
  publishedDate?: string | null;
  transcriptWords?: number;
  transcriptSegments?: number;
  perfectProcessCount?: number;
  sourceRecordCount?: number;
  sourceInstructionCount?: number;
  sourceNumberCount?: number;
  projectManagerRelevance?: string;
  topTerms?: unknown[];
}

interface YoutubeVideoDetail {
  video: YoutubeVideoRow;
  segments: Array<{
    id: string;
    start_seconds: number;
    text: string;
    source_url_at_time?: string;
  }>;
  sourceRecords: Array<Record<string, any>>;
  perfectProcess: Array<Record<string, any>>;
}

interface YoutubeSearchResult {
  kind: string;
  recordType?: string;
  refId: string;
  videoId: string;
  videoTitle: string;
  sourceTime?: string | null;
  sourceUrlAtTime?: string;
  text: string;
  pmAgentUse?: string | null;
  confidence?: string | null;
}

function api(): any {
  return (window as any).nexus?.nateLibrary;
}

function compactNumber(value: unknown): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
}

function plainNumber(value: unknown): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return numeric.toLocaleString();
}

function tokenLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  const record = value as Record<string, unknown>;
  return String(record.label || record.id || record.name || record.text || '').trim();
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value: unknown, max = 220): string {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatTime(seconds: unknown): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function recordText(record: Record<string, any>): string {
  return normalizeText(record.text || record.source_text || record.canonical_text || record.claim || '');
}

function recordTime(record: Record<string, any>): string {
  return String(record.source_time || '').trim() || formatTime(record.source_time_seconds);
}

function transcriptText(detail: YoutubeVideoDetail | null): string {
  return (detail?.segments || [])
    .map((segment) => normalizeText(segment.text))
    .filter(Boolean)
    .join(' ');
}

function buildVideoBrief(video: YoutubeVideoRow | null | undefined, detail: YoutubeVideoDetail | null): string {
  if (!video) return '';
  const processRows = detail?.perfectProcess || [];
  const groundedRows = detail?.sourceRecords || [];
  const artifacts = processRows.filter((record) => record.item_type === 'artifact');
  const rules = processRows.filter((record) => record.item_type === 'operating_rule');
  return [
    `# ${video.title}`,
    '',
    `Video: ${video.url || ''}`,
    video.publishedDate ? `Published: ${video.publishedDate}` : '',
    '',
    '## Summary',
    video.projectManagerRelevance || (video.topTerms || []).map(tokenLabel).filter(Boolean).join(', ') || 'No generated summary is available yet.',
    '',
    '## Process Knowledge',
    ...processRows.slice(0, 16).map((record) => `- ${recordTime(record)} ${record.item_type || ''}: ${recordText(record)}`),
    '',
    '## Artifacts',
    ...(artifacts.length ? artifacts.map((record) => `- ${record.item_id || record.title || 'artifact'}: ${recordText(record)}`) : ['- No manual-grade artifact records for this video yet.']),
    '',
    '## Operating Rules',
    ...(rules.length ? rules.map((record) => `- ${record.item_id || record.title || 'rule'}: ${recordText(record)}`) : ['- No manual-grade operating rule records for this video yet.']),
    '',
    '## Grounded Records',
    ...groundedRows.slice(0, 20).map((record) => `- ${recordTime(record)} ${record.record_type || ''}: ${recordText(record)}`),
    '',
  ].filter(Boolean).join('\n');
}

export default function YouTubeKnowledgeWorkbench(): React.ReactElement {
  const [status, setStatus] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [detail, setDetail] = useState<YoutubeVideoDetail | null>(null);
  const [query, setQuery] = useState('vibe coding blind spots');
  const [results, setResults] = useState<YoutubeSearchResult[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<YoutubeSearchResult | null>(null);
  const [chatQuestion, setChatQuestion] = useState('What is useful in this video for a PM agent?');
  const [chatScope, setChatScope] = useState<ChatScope>('video');
  const [chatAnswer, setChatAnswer] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const videos: YoutubeVideoRow[] = Array.isArray(overview?.videos) ? overview.videos : [];
  const activeVideo = detail?.video || videos.find((video) => video.id === selectedVideoId) || null;
  const activeTranscript = useMemo(() => transcriptText(detail), [detail]);
  const activeBrief = useMemo(() => buildVideoBrief(activeVideo, detail), [activeVideo, detail]);
  const processRows = detail?.perfectProcess || [];
  const groundedRows = detail?.sourceRecords || [];

  useEffect(() => {
    let disposed = false;
    async function load() {
      setBusy('loading');
      setNotice('');
      try {
        const library = api();
        if (!library) throw new Error('YouTube knowledge API is not available in this shell.');
        const [nextStatus, nextOverview] = await Promise.all([library.status(), library.overview()]);
        if (disposed) return;
        setStatus(nextStatus);
        setOverview(nextOverview);
        const firstVideo = nextOverview?.videos?.[0];
        if (firstVideo?.id) setSelectedVideoId(String(firstVideo.id));
      } catch (error) {
        if (!disposed) setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) setBusy('');
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedVideoId) return;
    let disposed = false;
    async function loadVideo() {
      setBusy('video');
      setNotice('');
      try {
        const nextDetail = await api().getVideo(selectedVideoId);
        if (!disposed) {
          setDetail(nextDetail);
          setSelectedRecord(null);
        }
      } catch (error) {
        if (!disposed) setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) setBusy('');
      }
    }
    void loadVideo();
    return () => {
      disposed = true;
    };
  }, [selectedVideoId]);

  const runSearch = useCallback(async (scope: ChatScope = chatScope) => {
    const nextQuery = query.trim();
    if (!nextQuery) return;
    setBusy('search');
    setNotice('');
    try {
      const rows = await api().search({
        query: nextQuery,
        kinds: ['perfect_process', 'source_record', 'transcript_segment', 'curated'],
        videoId: scope === 'video' ? selectedVideoId : undefined,
        limit: 36,
      });
      setResults(Array.isArray(rows) ? rows : []);
      setNotice(`${Array.isArray(rows) ? rows.length : 0} ${scope === 'video' ? 'video' : 'global'} records found.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }, [chatScope, query, selectedVideoId]);

  const ask = useCallback(async (scope: ChatScope = chatScope, question = chatQuestion) => {
    const nextQuestion = question.trim();
    if (!nextQuestion) return;
    setBusy('chat');
    setNotice('');
    try {
      const answer = await api().chat({
        question: nextQuestion,
        scope: query,
        videoId: scope === 'video' ? selectedVideoId : undefined,
        limit: 10,
      });
      setChatAnswer(answer);
      setChatScope(scope);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }, [chatQuestion, chatScope, query, selectedVideoId]);

  const copyText = useCallback(async (text: string, message: string) => {
    if (!text) return;
    try {
      await (window as any).nexus?.clipboard?.writeText?.(text);
      setNotice(message);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setNotice(message);
      } catch {
        setNotice('Clipboard copy was blocked.');
      }
    }
  }, []);

  const saveArtifact = useCallback(async (artifactType: ArtifactType) => {
    if (!selectedVideoId) return;
    setBusy(`save-${artifactType}`);
    setNotice('');
    try {
      const result = await api().saveVideoArtifact({ videoId: selectedVideoId, artifactType });
      setNotice(`Saved ${artifactType}: ${result?.path || 'output file'}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }, [selectedVideoId]);

  return (
    <section className="next-youtube-kb-room">
      <div className="next-youtube-kb-head next-mini-panel">
        <div>
          <div className="next-mini-label">YouTube Channel Base</div>
          <h2>{status?.appName || 'YouTube Knowledge Library'}</h2>
          <p>{status?.activeBase?.name || 'Nate B. Jones'} transcript intelligence inside Nexus Next.</p>
        </div>
        <div className="next-youtube-kb-metrics">
          <span><strong>{plainNumber(status?.videos)}</strong> videos</span>
          <span><strong>{plainNumber(status?.transcripts)}</strong> transcripts</span>
          <span><strong>{compactNumber(status?.report?.totals?.transcript_words)}</strong> words</span>
          <span><strong>{plainNumber(status?.perfectProcessRows)}</strong> process</span>
        </div>
      </div>

      {notice ? <div className="next-youtube-notice">{notice}</div> : null}

      <div className="next-youtube-kb-grid">
        <aside className="next-mini-panel next-youtube-video-list-panel">
          <div className="next-mini-label">Videos</div>
          <div className="next-youtube-video-list">
            {videos.slice(0, 120).map((video) => (
              <button
                type="button"
                key={video.id}
                className={`next-youtube-video-row${video.id === selectedVideoId ? ' is-active' : ''}`}
                onClick={() => {
                  setSelectedVideoId(video.id);
                  setChatScope('video');
                }}
              >
                <strong>{video.title}</strong>
                <span>{video.publishedDate || 'No publish date'} · {compactNumber(video.transcriptWords)} words</span>
                <small>{plainNumber(video.perfectProcessCount)} process · {plainNumber(video.sourceRecordCount)} grounded</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="next-mini-panel next-youtube-video-workspace">
          <div className="next-youtube-video-head">
            <div>
              <div className="next-mini-label">Selected Video</div>
              <h3>{activeVideo?.title || 'Select a video'}</h3>
              <p>{activeVideo?.projectManagerRelevance || truncateText((activeVideo?.topTerms || []).map(tokenLabel).filter(Boolean).join(', '), 220) || 'Click a video to inspect its transcript, process records, source records, and saved outputs.'}</p>
            </div>
            {activeVideo?.url ? (
              <button type="button" className="next-secondary-button" onClick={() => window.open(activeVideo.url, '_blank', 'noopener,noreferrer')}>
                Open Video
              </button>
            ) : null}
          </div>

          <div className="next-youtube-fact-strip">
            <span>{plainNumber(activeVideo?.transcriptSegments || detail?.segments?.length)} segments</span>
            <span>{compactNumber(activeVideo?.transcriptWords)} words</span>
            <span>{plainNumber(processRows.length)} process</span>
            <span>{plainNumber(groundedRows.length)} grounded</span>
          </div>

          <div className="next-youtube-action-row">
            <button type="button" className="next-secondary-button" disabled={!activeTranscript} onClick={() => void copyText(activeTranscript, 'Transcript copied.')}>Copy Transcript</button>
            <button type="button" className="next-secondary-button" disabled={!activeTranscript || busy === 'save-transcript'} onClick={() => void saveArtifact('transcript')}>{busy === 'save-transcript' ? 'Saving...' : 'Save Transcript'}</button>
            <button type="button" className="next-secondary-button" disabled={!activeBrief} onClick={() => void copyText(activeBrief, 'Video brief copied.')}>Copy Brief</button>
            <button type="button" className="next-secondary-button" disabled={!activeBrief || busy === 'save-brief'} onClick={() => void saveArtifact('brief')}>{busy === 'save-brief' ? 'Saving...' : 'Save Brief'}</button>
            <button type="button" className="next-secondary-button" disabled={!selectedVideoId || busy === 'chat'} onClick={() => void ask('video', 'What is useful in this video for a PM agent?')}>Chat This Video</button>
          </div>

          <div className="next-youtube-drilldown">
            <div>
              <div className="next-mini-label">Process + Grounded</div>
              <div className="next-youtube-record-list">
                {[...processRows, ...groundedRows].slice(0, 40).map((record, index) => (
                  <button
                    type="button"
                    key={String(record.id || `record-${index}`)}
                    onClick={() => setSelectedRecord({
                      kind: record.item_type ? 'perfect_process' : 'source_record',
                      recordType: record.item_type || record.record_type,
                      refId: String(record.id || index),
                      videoId: selectedVideoId,
                      videoTitle: activeVideo?.title || '',
                      sourceTime: recordTime(record),
                      sourceUrlAtTime: record.source_url_at_time || activeVideo?.url || '',
                      text: recordText(record),
                    })}
                  >
                    <strong>{recordTime(record)}</strong>
                    <span><b>{record.item_type || record.record_type || 'record'}</b> {recordText(record)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="next-mini-label">Transcript</div>
              <div className="next-youtube-record-list">
                {(detail?.segments || []).slice(0, 80).map((segment) => (
                  <button
                    type="button"
                    key={segment.id}
                    onClick={() => setSelectedRecord({
                      kind: 'transcript_segment',
                      recordType: 'transcript',
                      refId: segment.id,
                      videoId: selectedVideoId,
                      videoTitle: activeVideo?.title || '',
                      sourceTime: formatTime(segment.start_seconds),
                      sourceUrlAtTime: segment.source_url_at_time || activeVideo?.url || '',
                      text: segment.text,
                    })}
                  >
                    <strong>{formatTime(segment.start_seconds)}</strong>
                    <span>{segment.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="next-mini-panel next-youtube-chat-panel">
          <div className="next-mini-label">Ask The Library</div>
          <div className="next-youtube-scope-row">
            <button type="button" className={chatScope === 'video' ? 'is-active' : ''} onClick={() => setChatScope('video')}>This Video</button>
            <button type="button" className={chatScope === 'global' ? 'is-active' : ''} onClick={() => setChatScope('global')}>Global</button>
          </div>
          <div className="next-inline-form">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this channel base" />
            <button type="button" className="next-secondary-button" disabled={busy === 'search'} onClick={() => void runSearch(chatScope)}>{busy === 'search' ? 'Searching...' : 'Search'}</button>
          </div>
          <div className="next-inline-form next-youtube-chat-form">
            <input value={chatQuestion} onChange={(event) => setChatQuestion(event.target.value)} placeholder="Ask transcript-backed question" />
            <button type="button" className="next-secondary-button" disabled={busy === 'chat'} onClick={() => void ask(chatScope)}>{busy === 'chat' ? 'Asking...' : 'Ask'}</button>
          </div>

          {selectedRecord ? (
            <article className="next-youtube-selected-record">
              <div className="next-mini-label">Selected Record</div>
              <strong>{selectedRecord.recordType || selectedRecord.kind} {selectedRecord.sourceTime ? `· ${selectedRecord.sourceTime}` : ''}</strong>
              <p>{selectedRecord.text}</p>
              <div className="next-youtube-action-row">
                <button type="button" className="next-secondary-button" onClick={() => void copyText(selectedRecord.text, 'Record copied.')}>Copy</button>
                {selectedRecord.sourceUrlAtTime ? (
                  <button type="button" className="next-secondary-button" onClick={() => window.open(selectedRecord.sourceUrlAtTime, '_blank', 'noopener,noreferrer')}>Source</button>
                ) : null}
              </div>
            </article>
          ) : null}

          {chatAnswer ? (
            <article className="next-youtube-answer">
              <strong>{chatScope === 'video' ? 'Video answer' : 'Global answer'}</strong>
              <p>{chatAnswer.answer}</p>
              <div className="next-youtube-citation-list">
                {(chatAnswer.citations || []).slice(0, 6).map((citation: any) => (
                  <button
                    type="button"
                    key={`${citation.kind}-${citation.refId}`}
                    onClick={() => citation.url ? window.open(citation.url, '_blank', 'noopener,noreferrer') : undefined}
                  >
                    {citation.kind} · {citation.time || 'source'}
                  </button>
                ))}
              </div>
            </article>
          ) : null}

          <div className="next-youtube-search-results">
            {results.slice(0, 12).map((result) => (
              <button
                type="button"
                key={`${result.kind}-${result.refId}`}
                className="next-youtube-search-result"
                onClick={() => {
                  setSelectedRecord(result);
                  if (result.videoId) setSelectedVideoId(result.videoId);
                }}
              >
                <strong>{result.recordType || result.kind} {result.sourceTime ? `· ${result.sourceTime}` : ''}</strong>
                <span>{truncateText(result.text, 170)}</span>
                <small>{result.videoTitle}</small>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
