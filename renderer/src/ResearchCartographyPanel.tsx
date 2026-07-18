import React, { useCallback, useEffect, useMemo, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Type declarations for the Research Graph API surface                       */
/* -------------------------------------------------------------------------- */

interface Capsule {
  id: string;
  title: string;
  claim: string;
  evidence: string[];
  confidence: number;
  confidenceHistory: { timestamp: number; value: number; reason?: string }[];
  perspective: string;
  investigationId: string;
  linkedPaths: string[];
  tags: string[];
  predictions: string[];
  edgeConditions: string[];
  state: string;
  createdAt: number;
  updatedAt: number;
}

interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  connectionType: string;
  justification: string;
  confidence: number;
  bidirectional: boolean;
}

interface Obligation {
  id: string;
  capsuleId: string;
  obligationType: string;
  description: string;
  priority: string;
  status: string;
  dueCondition: string;
}

interface Scaffold {
  id: string;
  title: string;
  dimensions: string[];
  capsuleIds: string[];
  fillRate: number;
}

interface Branch {
  id: string;
  title: string;
  hypothesis: string;
  status: string;
  revivalConditions: string[];
  history: { timestamp: number; action: string; note?: string }[];
}

interface AttentionEntry {
  id: string;
  title: string;
  score: number;
  factors: {
    openObligations: number;
    untestedPredictions: number;
    edgeConditions: number;
    contradictionDensity: number;
    uncertaintyScore: number;
    connectionCount: number;
  };
}

interface NodeContext {
  capsule: Capsule;
  connections: Connection[];
  obligations: Obligation[];
  branches: Branch[];
  connectedCapsules: Capsule[];
  inScaffolds: Scaffold[];
}

interface ResearchSummary {
  capsules: { total: number; byState: Record<string, number>; avgConfidence: number };
  connections: { total: number; byType: Record<string, number> };
  obligations: { totalOpen: number; totalResolved: number; byType: Record<string, number> };
  scaffolds: { total: number; avgFillRate: number };
  branches: { total: number; byStatus: Record<string, number> };
}

interface ResearchGraphAPI {
  createCapsule(input: unknown): Promise<Capsule>;
  updateConfidence(capsuleId: string, input: unknown): Promise<Capsule>;
  getCapsule(id: string): Promise<Capsule | null>;
  listCapsules(filters?: unknown): Promise<Capsule[]>;
  searchCapsules(query: string): Promise<Capsule[]>;
  getCapsulesByPath(pathPrefix: string): Promise<Capsule[]>;
  createConnection(input: unknown): Promise<Connection>;
  listConnections(filters?: unknown): Promise<Connection[]>;
  getConnectionsFor(capsuleId: string): Promise<Connection[]>;
  createObligation(input: unknown): Promise<Obligation>;
  resolveObligation(id: string, input: unknown): Promise<Obligation>;
  listObligations(filters?: unknown): Promise<Obligation[]>;
  getObligationDebt(): Promise<{ totalOpen: number; totalResolved: number; byType: Record<string, number> }>;
  createScaffold(input: unknown): Promise<Scaffold>;
  attachToScaffold(scaffoldId: string, capsuleId: string): Promise<Scaffold>;
  listScaffolds(filters?: unknown): Promise<Scaffold[]>;
  createBranch(input: unknown): Promise<Branch>;
  updateBranch(id: string, input: unknown): Promise<Branch>;
  listBranches(filters?: unknown): Promise<Branch[]>;
  checkRevivals(capsuleId: string): Promise<{ capsuleId: string; score: number; reason: string }[]>;
  attentionField(): Promise<AttentionEntry[]>;
  summary(): Promise<ResearchSummary>;
  nodeContext(capsuleId: string): Promise<NodeContext>;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

type TabId = 'overview' | 'capsules' | 'connections' | 'obligations' | 'attention';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'capsules', label: 'Capsules' },
  { id: 'connections', label: 'Connections' },
  { id: 'obligations', label: 'Obligations' },
  { id: 'attention', label: 'Attention' },
];

const CONNECTION_TYPE_COLORS: Record<string, string> = {
  supports: '#4caf50',
  contradicts: '#f44336',
  extends: '#2196f3',
  specializes: '#9c27b0',
  generalizes: '#ff9800',
  analogizes: '#00bcd4',
  depends_on: '#ff5722',
  temporal: '#795548',
  causal: '#e91e63',
  contextual: '#607d8b',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#f44336',
  high: '#ff5722',
  medium: '#ff9800',
  low: '#4caf50',
};

const FACTOR_COLORS: Record<string, string> = {
  openObligations: '#e94560',
  untestedPredictions: '#ff9800',
  edgeConditions: '#2196f3',
  contradictionDensity: '#f44336',
  uncertaintyScore: '#9c27b0',
  connectionCount: '#4caf50',
};

const FACTOR_LABELS: Record<string, string> = {
  openObligations: 'Open Obligations',
  untestedPredictions: 'Untested Predictions',
  edgeConditions: 'Edge Conditions',
  contradictionDensity: 'Contradiction Density',
  uncertaintyScore: 'Uncertainty',
  connectionCount: 'Connections',
};

/* -------------------------------------------------------------------------- */
/*  Inline styles                                                             */
/* -------------------------------------------------------------------------- */

const S = {
  root: {
    background: '#1a1a2e',
    color: '#e0e0e0',
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    fontSize: 13,
    lineHeight: 1.5,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px 0',
    gap: 8,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e0e0e0',
    letterSpacing: '0.02em',
  },
  refreshBtn: {
    background: '#0f3460',
    border: 'none',
    color: '#e0e0e0',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  tabBar: {
    display: 'flex',
    gap: 2,
    padding: '8px 12px 0',
    borderBottom: '1px solid #0f3460',
  },
  tab: (active: boolean) => ({
    background: active ? '#0f3460' : 'transparent',
    color: active ? '#e0e0e0' : '#a0a0b0',
    border: 'none',
    borderRadius: '4px 4px 0 0',
    padding: '5px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    transition: 'background 0.15s',
  }),
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '10px 12px 12px',
  },
  card: {
    background: '#16213e',
    borderRadius: 6,
    padding: '10px 12px',
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: 11,
    color: '#a0a0b0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
  },
  statValue: {
    fontWeight: 600,
    fontSize: 14,
    color: '#e0e0e0',
  },
  secondaryText: {
    color: '#a0a0b0',
    fontSize: 12,
  },
  badge: (bg: string) => ({
    display: 'inline-block',
    background: bg,
    color: '#fff',
    borderRadius: 3,
    padding: '1px 6px',
    fontSize: 11,
    fontWeight: 500,
    marginRight: 4,
    marginBottom: 2,
  }),
  confidenceBar: (value: number, width?: number) => ({
    height: 6,
    borderRadius: 3,
    background: value < 0.4 ? '#f44336' : value < 0.7 ? '#ff9800' : '#4caf50',
    width: `${(value * 100).toFixed(0)}%`,
    maxWidth: width ?? 'unset',
    transition: 'width 0.3s',
  }),
  confidenceTrack: {
    height: 6,
    borderRadius: 3,
    background: '#0a0a1a',
    width: '100%',
    overflow: 'hidden' as const,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    background: '#0a0a1a',
    width: '100%',
    overflow: 'hidden' as const,
    marginTop: 2,
  },
  progressFill: (pct: number, color: string) => ({
    height: '100%',
    borderRadius: 4,
    background: color,
    width: `${Math.min(100, Math.max(0, pct)).toFixed(0)}%`,
    transition: 'width 0.3s',
  }),
  searchInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#0a0a1a',
    border: '1px solid #0f3460',
    borderRadius: 4,
    padding: '6px 8px',
    color: '#e0e0e0',
    fontSize: 12,
    marginBottom: 8,
    outline: 'none',
  },
  capsuleRow: (expanded: boolean) => ({
    background: expanded ? '#1a2a4e' : '#16213e',
    borderRadius: 6,
    padding: '8px 10px',
    marginBottom: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
  }),
  capsuleTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  capsuleTitle: {
    flex: 1,
    fontWeight: 500,
    fontSize: 13,
    color: '#e0e0e0',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  expandedSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: '1px solid #0f3460',
  },
  subheading: {
    fontSize: 11,
    color: '#a0a0b0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginTop: 8,
    marginBottom: 4,
  },
  evidenceItem: {
    fontSize: 12,
    color: '#c0c0d0',
    padding: '2px 0 2px 8px',
    borderLeft: '2px solid #0f3460',
    marginBottom: 3,
  },
  connectionRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid rgba(15,52,96,0.4)',
  },
  arrow: {
    color: '#a0a0b0',
    fontSize: 12,
    flexShrink: 0,
    paddingTop: 1,
  },
  obligationRow: {
    background: '#16213e',
    borderRadius: 6,
    padding: '8px 10px',
    marginBottom: 6,
  },
  attentionRow: {
    background: '#16213e',
    borderRadius: 6,
    padding: '8px 10px',
    marginBottom: 6,
    cursor: 'pointer',
  },
  factorBar: {
    display: 'flex',
    height: 10,
    borderRadius: 4,
    overflow: 'hidden' as const,
    background: '#0a0a1a',
    marginTop: 4,
  },
  factorSegment: (color: string, pct: number) => ({
    height: '100%',
    background: color,
    width: `${pct}%`,
    minWidth: pct > 0 ? 2 : 0,
  }),
  emptyState: {
    color: '#a0a0b0',
    fontSize: 12,
    textAlign: 'center' as const,
    padding: '24px 0',
  },
  loading: {
    color: '#a0a0b0',
    fontSize: 12,
    textAlign: 'center' as const,
    padding: '32px 0',
  },
  error: {
    background: 'rgba(233,69,96,0.15)',
    color: '#e94560',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 12,
    marginBottom: 8,
  },
  notConnected: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 200,
    color: '#a0a0b0',
    fontSize: 13,
    textAlign: 'center' as const,
    padding: 24,
  },
  obligationTabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 8,
  },
  obligationTab: (active: boolean) => ({
    background: active ? '#0f3460' : 'transparent',
    color: active ? '#e0e0e0' : '#a0a0b0',
    border: '1px solid #0f3460',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    cursor: 'pointer',
  }),
  debtBar: {
    display: 'flex',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden' as const,
    background: '#0a0a1a',
  },
  debtSegment: (color: string, pct: number) => ({
    height: '100%',
    background: color,
    width: `${pct}%`,
    transition: 'width 0.3s',
  }),
  groupHeading: {
    fontSize: 12,
    fontWeight: 600,
    color: '#e0e0e0',
    marginTop: 12,
    marginBottom: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 10,
    color: '#a0a0b0',
  },
  legendDot: (color: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }),
} as const;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function getApi(): ResearchGraphAPI | null {
  return (window as any).nexus?.researchGraph ?? null;
}

function confidenceColor(v: number): string {
  return v < 0.4 ? '#f44336' : v < 0.7 ? '#ff9800' : '#4caf50';
}

function connectionColor(type: string): string {
  return CONNECTION_TYPE_COLORS[type] ?? '#607d8b';
}

function priorityColor(p: string): string {
  return PRIORITY_COLORS[p?.toLowerCase()] ?? '#607d8b';
}

function stateColor(state: string): string {
  switch (state) {
    case 'active': return '#4caf50';
    case 'archived': return '#607d8b';
    case 'contradicted': return '#f44336';
    case 'superseded': return '#ff9800';
    case 'provisional': return '#2196f3';
    default: return '#0f3460';
  }
}

function truncate(s: string, len: number): string {
  const clean = (s || '').trim();
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean;
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/* -------------------------------------------------------------------------- */
/*  Sub-views                                                                 */
/* -------------------------------------------------------------------------- */

function OverviewView(props: {
  summary: ResearchSummary | null;
  scaffolds: Scaffold[];
  attention: AttentionEntry[];
  onAttentionClick: (id: string) => void;
}): React.ReactElement {
  const { summary: s, scaffolds, attention } = props;

  if (!s) {
    return <div style={S.emptyState}>No summary data available.</div>;
  }

  const totalObl = s.obligations.totalOpen + s.obligations.totalResolved;

  return (
    <div>
      {/* Counts */}
      <div style={S.card}>
        <div style={S.cardLabel}>Research Totals</div>
        <div style={S.statRow}>
          <span style={S.secondaryText}>Capsules</span>
          <span style={S.statValue}>{s.capsules.total}</span>
        </div>
        <div style={S.statRow}>
          <span style={S.secondaryText}>Connections</span>
          <span style={S.statValue}>{s.connections.total}</span>
        </div>
        <div style={S.statRow}>
          <span style={S.secondaryText}>Obligations</span>
          <span style={S.statValue}>{s.obligations.totalOpen + s.obligations.totalResolved}</span>
        </div>
        <div style={S.statRow}>
          <span style={S.secondaryText}>Scaffolds</span>
          <span style={S.statValue}>{s.scaffolds.total}</span>
        </div>
        <div style={S.statRow}>
          <span style={S.secondaryText}>Branches</span>
          <span style={S.statValue}>{s.branches.total}</span>
        </div>
      </div>

      {/* Obligation debt */}
      <div style={S.card}>
        <div style={S.cardLabel}>Obligation Debt</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
          <span style={{ color: '#e94560' }}>Open {s.obligations.totalOpen}</span>
          <span style={{ color: '#4caf50' }}>Resolved {s.obligations.totalResolved}</span>
        </div>
        <div style={S.debtBar}>
          <div style={S.debtSegment('#e94560', pct(s.obligations.totalOpen, totalObl))} />
          <div style={S.debtSegment('#4caf50', pct(s.obligations.totalResolved, totalObl))} />
        </div>
      </div>

      {/* Average confidence */}
      <div style={S.card}>
        <div style={S.cardLabel}>Average Confidence</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ ...S.confidenceTrack, flex: 1 }}>
            <div style={S.confidenceBar(s.capsules.avgConfidence)} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: confidenceColor(s.capsules.avgConfidence) }}>
            {(s.capsules.avgConfidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Scaffold fill rates */}
      {scaffolds.length > 0 && (
        <div style={S.card}>
          <div style={S.cardLabel}>Scaffold Fill Rates</div>
          {scaffolds.map((sc) => (
            <div key={sc.id} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                <span style={{ color: '#e0e0e0' }}>{truncate(sc.title, 30)}</span>
                <span style={{ color: '#a0a0b0' }}>{(sc.fillRate * 100).toFixed(0)}%</span>
              </div>
              <div style={S.progressTrack}>
                <div style={S.progressFill(sc.fillRate * 100, '#2196f3')} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top 5 attention */}
      <div style={S.card}>
        <div style={S.cardLabel}>Top Attention (Focus Next)</div>
        {attention.length === 0 && (
          <div style={{ ...S.secondaryText, padding: '4px 0' }}>No attention entries.</div>
        )}
        {attention.slice(0, 5).map((entry) => (
          <div
            key={entry.id}
            style={{ ...S.statRow, cursor: 'pointer', padding: '4px 0' }}
            onClick={() => props.onAttentionClick(entry.id)}
          >
            <span style={{ fontSize: 12, color: '#e0e0e0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {truncate(entry.title, 34)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e94560', flexShrink: 0, marginLeft: 8 }}>
              {entry.score.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapsulesView(props: {
  capsules: Capsule[];
  expandedId: string | null;
  nodeContexts: Record<string, NodeContext>;
  onToggle: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}): React.ReactElement {
  const filtered = useMemo(() => {
    if (!props.searchQuery.trim()) return props.capsules;
    const q = props.searchQuery.toLowerCase();
    return props.capsules.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.claim.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [props.capsules, props.searchQuery]);

  return (
    <div>
      <input
        type="text"
        placeholder="Search capsules..."
        value={props.searchQuery}
        onChange={(e) => props.onSearchChange(e.target.value)}
        style={S.searchInput}
      />
      {filtered.length === 0 && <div style={S.emptyState}>No capsules found.</div>}
      {filtered.map((cap) => {
        const expanded = props.expandedId === cap.id;
        const ctx = expanded ? props.nodeContexts[cap.id] : null;

        return (
          <div key={cap.id} style={S.capsuleRow(expanded)} onClick={() => props.onToggle(cap.id)}>
            <div style={S.capsuleTitleRow}>
              <span style={S.capsuleTitle}>{cap.title}</span>
              <div style={{ ...S.confidenceTrack, width: 48, flexShrink: 0 }}>
                <div style={S.confidenceBar(cap.confidence)} />
              </div>
              <span style={S.badge(stateColor(cap.state))}>{cap.state}</span>
            </div>
            {cap.tags.length > 0 && (
              <div style={{ marginTop: 3 }}>
                {cap.tags.map((tag) => (
                  <span key={tag} style={S.badge('#0f3460')}>{tag}</span>
                ))}
              </div>
            )}

            {expanded && (
              <div style={S.expandedSection}>
                <div style={S.subheading}>Claim</div>
                <div style={{ fontSize: 12, color: '#c0c0d0', marginBottom: 4 }}>{cap.claim || 'No claim recorded.'}</div>

                {cap.evidence.length > 0 && (
                  <>
                    <div style={S.subheading}>Evidence ({cap.evidence.length})</div>
                    {cap.evidence.map((ev, i) => (
                      <div key={i} style={S.evidenceItem}>{ev}</div>
                    ))}
                  </>
                )}

                {cap.predictions.length > 0 && (
                  <>
                    <div style={S.subheading}>Predictions</div>
                    {cap.predictions.map((p, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#c0c0d0', padding: '1px 0' }}>- {p}</div>
                    ))}
                  </>
                )}

                {cap.edgeConditions.length > 0 && (
                  <>
                    <div style={S.subheading}>Edge Conditions</div>
                    {cap.edgeConditions.map((ec, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#ff9800', padding: '1px 0' }}>- {ec}</div>
                    ))}
                  </>
                )}

                {ctx && ctx.connectedCapsules.length > 0 && (
                  <>
                    <div style={S.subheading}>Connected Capsules</div>
                    {ctx.connectedCapsules.map((cc) => (
                      <div key={cc.id} style={{ fontSize: 12, color: '#c0c0d0', padding: '1px 0' }}>
                        {cc.title} <span style={{ color: '#a0a0b0' }}>({(cc.confidence * 100).toFixed(0)}%)</span>
                      </div>
                    ))}
                  </>
                )}

                {ctx && ctx.obligations.length > 0 && (
                  <>
                    <div style={S.subheading}>Obligations</div>
                    {ctx.obligations.map((ob) => (
                      <div key={ob.id} style={{ fontSize: 12, color: '#c0c0d0', padding: '2px 0' }}>
                        <span style={S.badge(priorityColor(ob.priority))}>{ob.priority}</span>
                        <span style={S.badge('#0f3460')}>{ob.obligationType}</span>
                        {truncate(ob.description, 60)}
                      </div>
                    ))}
                  </>
                )}

                <div style={{ marginTop: 6, fontSize: 11, color: '#a0a0b0' }}>
                  Confidence: {(cap.confidence * 100).toFixed(0)}% | Perspective: {cap.perspective || 'none'} | ID: {cap.id.slice(0, 8)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConnectionsView(props: {
  connections: Connection[];
  capsuleTitles: Record<string, string>;
}): React.ReactElement {
  const grouped = useMemo(() => {
    const groups: Record<string, Connection[]> = {};
    for (const conn of props.connections) {
      const key = conn.connectionType || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(conn);
    }
    return groups;
  }, [props.connections]);

  const types = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  if (props.connections.length === 0) {
    return <div style={S.emptyState}>No connections recorded.</div>;
  }

  return (
    <div>
      {types.map((type) => (
        <div key={type}>
          <div style={S.groupHeading}>
            <span style={S.badge(connectionColor(type))}>{type}</span>
            <span style={{ color: '#a0a0b0', fontWeight: 400, fontSize: 11 }}>({grouped[type].length})</span>
          </div>
          {grouped[type].map((conn) => (
            <div key={conn.id} style={S.connectionRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                    {props.capsuleTitles[conn.sourceId] || conn.sourceId.slice(0, 8)}
                  </span>
                  <span style={S.arrow}>{conn.bidirectional ? '↔' : '→'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                    {props.capsuleTitles[conn.targetId] || conn.targetId.slice(0, 8)}
                  </span>
                </div>
                {conn.justification && (
                  <div style={{ fontSize: 11, color: '#a0a0b0', marginTop: 2 }}>{truncate(conn.justification, 80)}</div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ ...S.confidenceTrack, width: 32 }}>
                  <div style={S.confidenceBar(conn.confidence)} />
                </div>
                <span style={{ fontSize: 11, color: confidenceColor(conn.confidence) }}>
                  {(conn.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ObligationsView(props: {
  obligations: Obligation[];
  capsuleTitles: Record<string, string>;
}): React.ReactElement {
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open');

  const filtered = useMemo(() => {
    if (filter === 'all') return props.obligations;
    if (filter === 'open') return props.obligations.filter((o) => o.status !== 'resolved');
    return props.obligations.filter((o) => o.status === 'resolved');
  }, [props.obligations, filter]);

  const openCount = useMemo(
    () => props.obligations.filter((o) => o.status !== 'resolved').length,
    [props.obligations],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e94560' }}>
          {openCount} open
        </span>
        <div style={S.obligationTabBar}>
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button key={f} style={S.obligationTab(filter === f)} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && <div style={S.emptyState}>No {filter} obligations.</div>}

      {filtered.map((ob) => (
        <div key={ob.id} style={S.obligationRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={S.badge('#0f3460')}>{ob.obligationType}</span>
            <span style={S.badge(priorityColor(ob.priority))}>{ob.priority}</span>
            {ob.status === 'resolved' && <span style={S.badge('#4caf50')}>resolved</span>}
          </div>
          <div style={{ fontSize: 12, color: '#e0e0e0', marginBottom: 3 }}>{truncate(ob.description, 100)}</div>
          <div style={{ fontSize: 11, color: '#a0a0b0' }}>
            Capsule: {props.capsuleTitles[ob.capsuleId] || ob.capsuleId.slice(0, 8)}
            {ob.dueCondition && <> | Due: {truncate(ob.dueCondition, 40)}</>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttentionView(props: {
  attention: AttentionEntry[];
  onCapsuleClick: (id: string) => void;
}): React.ReactElement {
  if (props.attention.length === 0) {
    return <div style={S.emptyState}>No attention field entries.</div>;
  }

  const sorted = useMemo(
    () => [...props.attention].sort((a, b) => b.score - a.score),
    [props.attention],
  );

  return (
    <div>
      {/* Factor legend */}
      <div style={S.legend}>
        {Object.entries(FACTOR_LABELS).map(([key, label]) => (
          <div key={key} style={S.legendItem}>
            <div style={S.legendDot(FACTOR_COLORS[key])} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {sorted.map((entry) => {
        const totalFactor =
          entry.factors.openObligations +
          entry.factors.untestedPredictions +
          entry.factors.edgeConditions +
          entry.factors.contradictionDensity +
          entry.factors.uncertaintyScore +
          entry.factors.connectionCount;

        return (
          <div
            key={entry.id}
            style={S.attentionRow}
            onClick={() => props.onCapsuleClick(entry.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.title}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e94560', flexShrink: 0, marginLeft: 8 }}>
                {entry.score.toFixed(2)}
              </span>
            </div>
            <div style={S.factorBar}>
              {Object.entries(entry.factors).map(([key, val]) => (
                <div
                  key={key}
                  style={S.factorSegment(FACTOR_COLORS[key] || '#607d8b', pct(val as number, totalFactor))}
                  title={`${FACTOR_LABELS[key] || key}: ${val}`}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10, color: '#a0a0b0', flexWrap: 'wrap' }}>
              {Object.entries(entry.factors).map(([key, val]) => (
                <span key={key}>{(FACTOR_LABELS[key] || key).split(' ').map((w) => w[0]).join('')}: {val}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export default function ResearchCartographyPanel(props: {
  currentSessionId: string | null;
}): React.ReactElement {
  const api = getApi();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Data stores
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [scaffolds, setScaffolds] = useState<Scaffold[]>([]);
  const [attention, setAttention] = useState<AttentionEntry[]>([]);

  // Capsule detail
  const [expandedCapsuleId, setExpandedCapsuleId] = useState<string | null>(null);
  const [nodeContexts, setNodeContexts] = useState<Record<string, NodeContext>>({});
  const [capsuleSearch, setCapsuleSearch] = useState('');

  // Build a capsule ID -> title lookup
  const capsuleTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of capsules) map[c.id] = c.title;
    return map;
  }, [capsules]);

  const loadAll = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError('');
    try {
      const [sum, caps, conns, obls, scafs, attn] = await Promise.all([
        api.summary(),
        api.listCapsules(),
        api.listConnections(),
        api.listObligations(),
        api.listScaffolds(),
        api.attentionField(),
      ]);
      setSummary(sum);
      setCapsules(caps);
      setConnections(conns);
      setObligations(obls);
      setScaffolds(scafs);
      setAttention(attn);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load research data.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    void loadAll().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  // Load node context when expanding a capsule
  const handleCapsuleToggle = useCallback(
    async (id: string) => {
      if (expandedCapsuleId === id) {
        setExpandedCapsuleId(null);
        return;
      }
      setExpandedCapsuleId(id);
      if (!nodeContexts[id] && api) {
        try {
          const ctx = await api.nodeContext(id);
          setNodeContexts((prev) => ({ ...prev, [id]: ctx }));
        } catch {
          // Silently handle — expanded view works without context
        }
      }
    },
    [expandedCapsuleId, nodeContexts, api],
  );

  // Navigate to capsule from attention view
  const handleAttentionCapsuleClick = useCallback(
    (id: string) => {
      setActiveTab('capsules');
      setExpandedCapsuleId(id);
      // Load node context
      if (!nodeContexts[id] && api) {
        void api.nodeContext(id).then((ctx) => {
          setNodeContexts((prev) => ({ ...prev, [id]: ctx }));
        }).catch(() => {});
      }
    },
    [nodeContexts, api],
  );

  // Not connected
  if (!api) {
    return (
      <div style={S.root}>
        <div style={S.notConnected}>
          Research Graph not connected.
          <br />
          The researchGraph API is not available on window.nexus.
        </div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.headerTitle}>Research Cartography</span>
        <button style={S.refreshBtn} onClick={loadAll} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Tab bar */}
      <div style={S.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={S.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={S.body}>
        {error && <div style={S.error}>{error}</div>}

        {loading && !summary ? (
          <div style={S.loading}>Loading research data…</div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewView
                summary={summary}
                scaffolds={scaffolds}
                attention={attention}
                onAttentionClick={handleAttentionCapsuleClick}
              />
            )}

            {activeTab === 'capsules' && (
              <CapsulesView
                capsules={capsules}
                expandedId={expandedCapsuleId}
                nodeContexts={nodeContexts}
                onToggle={handleCapsuleToggle}
                searchQuery={capsuleSearch}
                onSearchChange={setCapsuleSearch}
              />
            )}

            {activeTab === 'connections' && (
              <ConnectionsView connections={connections} capsuleTitles={capsuleTitles} />
            )}

            {activeTab === 'obligations' && (
              <ObligationsView obligations={obligations} capsuleTitles={capsuleTitles} />
            )}

            {activeTab === 'attention' && (
              <AttentionView
                attention={attention}
                onCapsuleClick={handleAttentionCapsuleClick}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
