import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type DiagramKind = 'architecture' | 'flowchart' | 'sequence' | 'mindmap' | 'erd' | 'concept' | 'custom';
type DiagramColor = 'blue' | 'green' | 'purple' | 'red' | 'amber' | 'cyan' | 'pink' | 'slate';
type DiagramShape = 'rect' | 'pill' | 'diamond' | 'circle' | 'cylinder' | 'note';

interface DiagramNode {
  id: string;
  label: string;
  sub?: string;
  meta?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: DiagramColor;
  shape?: DiagramShape;
  group?: string;
}

interface DiagramEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  color?: DiagramColor;
  dashed?: boolean;
  curve?: 'straight' | 'orthogonal' | 'curved';
}

interface DiagramRecord {
  id: string;
  name: string;
  kind: DiagramKind;
  spec: {
    kind: DiagramKind;
    title?: string;
    subtitle?: string;
    layout?: 'manual' | 'grid' | 'horizontal' | 'vertical' | 'radial';
    nodes?: DiagramNode[];
    edges?: DiagramEdge[];
    groups?: Array<Record<string, any>>;
    [key: string]: any;
  };
  svg: string;
  session_id?: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  diagram: DiagramRecord;
  onClose: () => void;
}

const PALETTE: DiagramColor[] = ['blue', 'green', 'purple', 'red', 'amber', 'cyan', 'pink', 'slate'];
const KINDS: DiagramKind[] = ['flowchart', 'architecture', 'sequence', 'mindmap', 'erd', 'concept', 'custom'];
const LAYOUTS = ['manual', 'grid', 'horizontal', 'vertical', 'radial'] as const;
const SHAPES: DiagramShape[] = ['rect', 'pill', 'diamond', 'circle', 'cylinder', 'note'];

function createBlankNodeDraft(): DiagramNode {
  return {
    id: '',
    label: '',
    sub: '',
    meta: '',
    color: 'blue',
    shape: 'rect',
    x: undefined,
    y: undefined,
    w: undefined,
    h: undefined,
  };
}

function createBlankEdgeDraft(): DiagramEdge {
  return {
    from: '',
    to: '',
    label: '',
    color: 'slate',
    dashed: false,
    curve: 'curved',
  };
}

function slugify(value: string, fallback = 'node'): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return undefined;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseFilePaths(raw: string): string[] {
  return String(raw || '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return '';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function buildTemplateSpec(kind: DiagramKind): DiagramRecord['spec'] {
  if (kind === 'architecture') {
    return {
      kind,
      title: 'Architecture Overview',
      subtitle: 'Client, services, storage, and supporting systems',
      layout: 'horizontal',
      nodes: [
        { id: 'client', label: 'Client App', sub: 'UI / browser / desktop', color: 'blue', shape: 'rect' },
        { id: 'api', label: 'Application Layer', sub: 'routing + auth + orchestration', color: 'purple', shape: 'rect' },
        { id: 'workers', label: 'Worker Services', sub: 'jobs, automations, async tasks', color: 'cyan', shape: 'rect' },
        { id: 'db', label: 'Primary Database', sub: 'state + records + metadata', color: 'green', shape: 'cylinder' },
        { id: 'integrations', label: 'External Integrations', sub: 'APIs, webhooks, providers', color: 'amber', shape: 'pill' },
      ],
      edges: [
        { from: 'client', to: 'api', label: 'requests', color: 'slate' },
        { from: 'api', to: 'workers', label: 'dispatch', color: 'purple' },
        { from: 'api', to: 'db', label: 'read/write', color: 'green' },
        { from: 'workers', to: 'db', label: 'results', color: 'green' },
        { from: 'workers', to: 'integrations', label: 'provider calls', color: 'amber' },
      ],
    };
  }

  if (kind === 'sequence') {
    return {
      kind,
      title: 'Sequence Flow',
      subtitle: 'Interaction between the requester, orchestrator, tools, and result',
      layout: 'vertical',
      nodes: [
        { id: 'requester', label: 'Requester', color: 'blue', shape: 'pill' },
        { id: 'nexus', label: 'Nexus', sub: 'planning + routing', color: 'purple', shape: 'rect' },
        { id: 'tools', label: 'Tools / Services', sub: 'execution layer', color: 'cyan', shape: 'rect' },
        { id: 'output', label: 'Visible Output', sub: 'artifact / workspace / chat', color: 'green', shape: 'note' },
      ],
      edges: [
        { from: 'requester', to: 'nexus', label: 'request', color: 'slate' },
        { from: 'nexus', to: 'tools', label: 'tool calls', color: 'purple' },
        { from: 'tools', to: 'nexus', label: 'results', color: 'cyan' },
        { from: 'nexus', to: 'output', label: 'deliver / stage', color: 'green' },
      ],
    };
  }

  if (kind === 'mindmap') {
    return {
      kind,
      title: 'Idea Map',
      subtitle: 'Center concept with branches and sub-topics',
      layout: 'radial',
      nodes: [
        { id: 'center', label: 'Core Idea', sub: 'main problem or system', color: 'purple', shape: 'circle', w: 180, h: 180 },
        { id: 'branch-1', label: 'Inputs', color: 'blue', shape: 'rect' },
        { id: 'branch-2', label: 'Process', color: 'cyan', shape: 'rect' },
        { id: 'branch-3', label: 'Outputs', color: 'green', shape: 'rect' },
        { id: 'branch-4', label: 'Risks', color: 'red', shape: 'diamond' },
      ],
      edges: [
        { from: 'center', to: 'branch-1', color: 'blue' },
        { from: 'center', to: 'branch-2', color: 'cyan' },
        { from: 'center', to: 'branch-3', color: 'green' },
        { from: 'center', to: 'branch-4', color: 'red' },
      ],
    };
  }

  if (kind === 'erd') {
    return {
      kind,
      title: 'Data Model',
      subtitle: 'Entities and relationships',
      layout: 'grid',
      nodes: [
        { id: 'users', label: 'users', sub: 'id, email, role', color: 'blue', shape: 'cylinder' },
        { id: 'projects', label: 'projects', sub: 'id, owner_id, name', color: 'green', shape: 'cylinder' },
        { id: 'tasks', label: 'tasks', sub: 'id, project_id, assignee_id', color: 'amber', shape: 'cylinder' },
        { id: 'artifacts', label: 'artifacts', sub: 'id, task_id, path', color: 'purple', shape: 'cylinder' },
      ],
      edges: [
        { from: 'users', to: 'projects', label: 'owns', color: 'slate' },
        { from: 'projects', to: 'tasks', label: 'contains', color: 'slate' },
        { from: 'users', to: 'tasks', label: 'assigned', color: 'slate', dashed: true },
        { from: 'tasks', to: 'artifacts', label: 'produces', color: 'slate' },
      ],
    };
  }

  return {
    kind,
    title: kind === 'concept' ? 'Concept Map' : 'Workflow Diagram',
    subtitle: 'Editable builder scratchpad',
    layout: 'horizontal',
    nodes: [
      { id: 'start', label: 'Start', sub: 'entry point', color: 'blue', shape: 'pill' },
      { id: 'plan', label: 'Plan', sub: 'scope the work', color: 'purple', shape: 'rect' },
      { id: 'build', label: 'Build', sub: 'execute the workflow', color: 'cyan', shape: 'rect' },
      { id: 'review', label: 'Review', sub: 'verify and iterate', color: 'green', shape: 'diamond' },
    ],
    edges: [
      { from: 'start', to: 'plan', color: 'slate' },
      { from: 'plan', to: 'build', color: 'slate' },
      { from: 'build', to: 'review', color: 'slate' },
    ],
  };
}

export const DiagramViewer: React.FC<Props> = ({ diagram, onClose }) => {
  const nexus = (window as any).nexus;
  const [current, setCurrent] = useState<DiagramRecord>(diagram);
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showSpec, setShowSpec] = useState(false);
  const [specText, setSpecText] = useState(JSON.stringify(diagram.spec, null, 2));
  const [savingSpec, setSavingSpec] = useState(false);
  const [status, setStatus] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [diagramNameInput, setDiagramNameInput] = useState(diagram.name);
  const [titleInput, setTitleInput] = useState(String(diagram.spec?.title || ''));
  const [subtitleInput, setSubtitleInput] = useState(String(diagram.spec?.subtitle || ''));
  const [layoutInput, setLayoutInput] = useState<NonNullable<DiagramRecord['spec']['layout']>>(diagram.spec?.layout || 'grid');
  const [kindInput, setKindInput] = useState<DiagramKind>(diagram.kind || diagram.spec?.kind || 'flowchart');
  const [nodeDraft, setNodeDraft] = useState<DiagramNode>(createBlankNodeDraft());
  const [newNodeDraft, setNewNodeDraft] = useState<DiagramNode>(createBlankNodeDraft());
  const [edgeDraft, setEdgeDraft] = useState<DiagramEdge>(createBlankEdgeDraft());
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<DiagramKind>('flowchart');
  const [draftFilePaths, setDraftFilePaths] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const nodes = useMemo<DiagramNode[]>(
    () => (Array.isArray(current.spec?.nodes) ? current.spec.nodes : []),
    [current.spec],
  );
  const edges = useMemo<DiagramEdge[]>(
    () => (Array.isArray(current.spec?.edges) ? current.spec.edges : []),
    [current.spec],
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const setStatusMessage = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => {
      setStatus((currentValue) => currentValue === message ? '' : currentValue);
    }, 3200);
  }, []);

  const upsertDiagramRecord = useCallback((record: DiagramRecord) => {
    setDiagrams((previous) => {
      const next = previous.some((item) => item.id === record.id)
        ? previous.map((item) => item.id === record.id ? record : item)
        : [record, ...previous];

      return [...next].sort((left, right) => {
        const leftTime = new Date(left.updated_at).getTime();
        const rightTime = new Date(right.updated_at).getTime();
        return rightTime - leftTime;
      });
    });
  }, []);

  const syncFromRecord = useCallback((record: DiagramRecord) => {
    setCurrent(record);
    setSpecText(JSON.stringify(record.spec, null, 2));
    setDiagramNameInput(record.name);
    setTitleInput(String(record.spec?.title || ''));
    setSubtitleInput(String(record.spec?.subtitle || ''));
    setLayoutInput(record.spec?.layout || 'grid');
    setKindInput(record.kind || record.spec?.kind || 'flowchart');
    setDraftName((currentValue) => currentValue || record.name);
    setDraftKind(record.kind || record.spec?.kind || 'flowchart');
    setSelectedNodeId((currentValue) => (
      Array.isArray(record.spec?.nodes) && record.spec.nodes.some((node: DiagramNode) => node.id === currentValue)
        ? currentValue
        : ''
    ));
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      setLoadingLibrary(true);
      const items = await nexus.diagrams.list(100);
      setDiagrams(Array.isArray(items) ? items : []);
    } catch (error: any) {
      setStatusMessage(`Failed to load diagrams: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoadingLibrary(false);
    }
  }, [nexus.diagrams, setStatusMessage]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    syncFromRecord(diagram);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [diagram.id, syncFromRecord]);

  useEffect(() => {
    const off = nexus?.diagrams?.onUpdated?.((record: DiagramRecord) => {
      if (!record) {
        return;
      }
      upsertDiagramRecord(record);
      if (record.id === current.id) {
        syncFromRecord(record);
      }
    });

    return () => { try { off?.(); } catch { /* ignore */ } };
  }, [current.id, nexus.diagrams, syncFromRecord, upsertDiagramRecord]);

  useEffect(() => {
    if (!selectedNode) {
      setNodeDraft(createBlankNodeDraft());
      return;
    }

    setNodeDraft({
      id: selectedNode.id,
      label: selectedNode.label,
      sub: selectedNode.sub || '',
      meta: selectedNode.meta || '',
      color: selectedNode.color || 'blue',
      shape: selectedNode.shape || 'rect',
      x: selectedNode.x,
      y: selectedNode.y,
      w: selectedNode.w,
      h: selectedNode.h,
      group: selectedNode.group || '',
    });
  }, [selectedNode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const nodeElements = Array.from(canvas.querySelectorAll('[data-node-id]')) as HTMLElement[];
    nodeElements.forEach((element) => {
      const isSelected = element.getAttribute('data-node-id') === selectedNodeId;
      element.style.cursor = 'pointer';
      element.style.filter = isSelected ? 'drop-shadow(0 0 18px rgba(56, 189, 248, 0.9))' : '';
      element.style.opacity = isSelected ? '1' : '0.96';
    });
  }, [current.svg, selectedNodeId]);

  const filteredDiagrams = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) {
      return diagrams;
    }

    return diagrams.filter((item) => {
      const haystack = [
        item.name,
        item.kind,
        item.spec?.title,
        item.spec?.subtitle,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [diagrams, libraryQuery]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1.1 : 0.9;
    setZoom((value) => Math.min(4, Math.max(0.2, value * delta)));
  }, []);

  const handleMouseDown = (event: React.MouseEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-node-id]')) {
      return;
    }

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!dragRef.current) {
      return;
    }

    setPan({
      x: dragRef.current.panX + (event.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (event.clientY - dragRef.current.startY),
    });
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const handleCanvasClick = (event: React.MouseEvent) => {
    const nodeElement = (event.target as Element | null)?.closest?.('[data-node-id]');
    if (nodeElement) {
      setSelectedNodeId(String(nodeElement.getAttribute('data-node-id') || ''));
      return;
    }

    setSelectedNodeId('');
  };

  const openDiagram = async (idOrName: string) => {
    try {
      const record = await nexus.diagrams.get(idOrName);
      if (!record) {
        setStatusMessage(`Diagram not found: ${idOrName}`);
        return;
      }
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (error: any) {
      setStatusMessage(`Failed to open diagram: ${error?.message || 'Unknown error'}`);
    }
  };

  const createTemplate = async (kind: DiagramKind) => {
    try {
      const record = await nexus.diagrams.create(
        kind === 'architecture' ? 'Architecture Builder' : kind === 'flowchart' ? 'Workflow Builder' : `${kind[0].toUpperCase()}${kind.slice(1)} Builder`,
        buildTemplateSpec(kind),
        current.session_id,
      );
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setStatusMessage(`Created ${kind} template.`);
    } catch (error: any) {
      setStatusMessage(`Failed to create template: ${error?.message || 'Unknown error'}`);
    }
  };

  const exportSvg = async () => {
    try {
      const result = await nexus.diagrams.exportSvg(current.id);
      setStatusMessage(`Exported SVG to ${result.path}`);
    } catch (error: any) {
      setStatusMessage(`Export failed: ${error?.message || 'Unknown error'}`);
    }
  };

  const saveSpec = async () => {
    try {
      setSavingSpec(true);
      const parsed = JSON.parse(specText);
      const record = await nexus.diagrams.replaceSpec(current.id, parsed);
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setStatusMessage('Spec changes applied.');
    } catch (error: any) {
      setStatusMessage(`Invalid spec JSON: ${error?.message || 'Unknown error'}`);
    } finally {
      setSavingSpec(false);
    }
  };

  const saveDiagramMetadata = async () => {
    try {
      let record = await nexus.diagrams.replaceSpec(current.id, {
        ...current.spec,
        kind: kindInput,
        title: titleInput.trim() || undefined,
        subtitle: subtitleInput.trim() || undefined,
        layout: layoutInput,
      });

      if (diagramNameInput.trim()) {
        record = await nexus.diagrams.rename(record.id, diagramNameInput.trim());
      }

      syncFromRecord(record);
      upsertDiagramRecord(record);
      setStatusMessage('Diagram details updated.');
    } catch (error: any) {
      setStatusMessage(`Failed to save diagram details: ${error?.message || 'Unknown error'}`);
    }
  };

  const addNode = async () => {
    const label = String(newNodeDraft.label || '').trim();
    if (!label) {
      setStatusMessage('Add a node label first.');
      return;
    }

    const nodeId = slugify(newNodeDraft.id || label, 'node');

    try {
      const record = await nexus.diagrams.addNode(current.id, {
        ...newNodeDraft,
        id: nodeId,
        label,
        sub: String(newNodeDraft.sub || '').trim() || undefined,
        meta: String(newNodeDraft.meta || '').trim() || undefined,
        group: String(newNodeDraft.group || '').trim() || undefined,
        x: parseOptionalNumber(String(newNodeDraft.x ?? '')),
        y: parseOptionalNumber(String(newNodeDraft.y ?? '')),
        w: parseOptionalNumber(String(newNodeDraft.w ?? '')),
        h: parseOptionalNumber(String(newNodeDraft.h ?? '')),
      });
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setSelectedNodeId(nodeId);
      setNewNodeDraft(createBlankNodeDraft());
      setStatusMessage(`Added node "${label}".`);
    } catch (error: any) {
      setStatusMessage(`Failed to add node: ${error?.message || 'Unknown error'}`);
    }
  };

  const saveSelectedNode = async () => {
    if (!selectedNodeId) {
      setStatusMessage('Select a node first.');
      return;
    }

    try {
      const record = await nexus.diagrams.updateNode(current.id, selectedNodeId, {
        label: String(nodeDraft.label || '').trim() || selectedNodeId,
        sub: String(nodeDraft.sub || '').trim() || undefined,
        meta: String(nodeDraft.meta || '').trim() || undefined,
        color: nodeDraft.color || undefined,
        shape: nodeDraft.shape || undefined,
        group: String(nodeDraft.group || '').trim() || undefined,
        x: parseOptionalNumber(String(nodeDraft.x ?? '')),
        y: parseOptionalNumber(String(nodeDraft.y ?? '')),
        w: parseOptionalNumber(String(nodeDraft.w ?? '')),
        h: parseOptionalNumber(String(nodeDraft.h ?? '')),
      });
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setStatusMessage(`Updated node "${selectedNodeId}".`);
    } catch (error: any) {
      setStatusMessage(`Failed to update node: ${error?.message || 'Unknown error'}`);
    }
  };

  const removeSelectedNode = async () => {
    if (!selectedNodeId) {
      setStatusMessage('Select a node to remove.');
      return;
    }

    if (!window.confirm(`Remove node "${selectedNodeId}" and its connected edges?`)) {
      return;
    }

    try {
      const record = await nexus.diagrams.removeNode(current.id, selectedNodeId);
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setSelectedNodeId('');
      setStatusMessage(`Removed node "${selectedNodeId}".`);
    } catch (error: any) {
      setStatusMessage(`Failed to remove node: ${error?.message || 'Unknown error'}`);
    }
  };

  const addEdge = async () => {
    if (!edgeDraft.from || !edgeDraft.to) {
      setStatusMessage('Choose both a source and target node.');
      return;
    }

    try {
      const record = await nexus.diagrams.addEdge(current.id, {
        from: edgeDraft.from,
        to: edgeDraft.to,
        label: String(edgeDraft.label || '').trim() || undefined,
        color: edgeDraft.color || undefined,
        dashed: Boolean(edgeDraft.dashed),
        curve: edgeDraft.curve || 'curved',
      });
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setEdgeDraft(createBlankEdgeDraft());
      setStatusMessage(`Connected ${edgeDraft.from} to ${edgeDraft.to}.`);
    } catch (error: any) {
      setStatusMessage(`Failed to add edge: ${error?.message || 'Unknown error'}`);
    }
  };

  const removeEdge = async (edge: DiagramEdge) => {
    try {
      const record = await nexus.diagrams.removeEdge(current.id, edge.from, edge.to);
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setStatusMessage(`Removed edge ${edge.from} → ${edge.to}.`);
    } catch (error: any) {
      setStatusMessage(`Failed to remove edge: ${error?.message || 'Unknown error'}`);
    }
  };

  const deleteCurrentDiagram = async () => {
    if (!window.confirm(`Delete "${current.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await nexus.diagrams.delete(current.id);
      const remaining = await nexus.diagrams.list(100);
      setDiagrams(Array.isArray(remaining) ? remaining : []);

      if (Array.isArray(remaining) && remaining.length > 0) {
        syncFromRecord(remaining[0]);
      } else {
        const fresh = await nexus.diagrams.create('Workflow Builder', buildTemplateSpec('flowchart'), current.session_id);
        syncFromRecord(fresh);
        setDiagrams([fresh]);
      }

      setStatusMessage('Diagram deleted.');
    } catch (error: any) {
      setStatusMessage(`Failed to delete diagram: ${error?.message || 'Unknown error'}`);
    }
  };

  const generateFromPrompt = async (diagramId?: string) => {
    const prompt = draftPrompt.trim();
    if (!prompt) {
      setStatusMessage('Describe the workflow or architecture first.');
      return;
    }

    try {
      setIsGenerating(true);
      const record = await nexus.diagrams.generateFromPrompt({
        prompt,
        name: draftName.trim() || undefined,
        kind: draftKind,
        sessionId: current.session_id,
        filePaths: parseFilePaths(draftFilePaths),
        diagramId,
        show: false,
      });
      syncFromRecord(record);
      upsertDiagramRecord(record);
      setStatusMessage(diagramId ? 'Revised the current diagram from your prompt.' : 'Drafted a new diagram from your prompt.');
    } catch (error: any) {
      setStatusMessage(`Diagram drafting failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <div className="artifact-viewer-overlay" onClick={onClose} />
      <div
        className="artifact-viewer-modal"
        style={{
          position: 'fixed',
          inset: 'auto',
          top: '3vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(97vw, 1780px)',
          height: '94vh',
          background: '#08101d',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          borderRadius: 20,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
          boxShadow: '0 34px 100px rgba(2, 6, 23, 0.72)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(10, 15, 28, 0.96))',
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700 }}>Workflow Builder</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>
              Figma-style workflow and architecture editing for Nexus diagrams, code maps, and system plans.
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setZoom((value) => Math.max(0.2, value * 0.85))} style={btnStyle}>−</button>
            <span style={{ color: '#94a3b8', fontSize: 12, minWidth: 46, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => Math.min(4, value * 1.15))} style={btnStyle}>+</button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={btnStyle}>Reset View</button>
            <button onClick={() => setShowSpec((value) => !value)} style={btnStyle}>{showSpec ? 'Hide JSON' : 'Show JSON'}</button>
            <button onClick={exportSvg} style={btnStyle}>Export SVG</button>
            <button onClick={onClose} style={{ ...btnStyle, color: '#fca5a5' }}>Close</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr) 420px', flex: 1, minHeight: 0 }}>
          <div style={sidebarStyle}>
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Draft From Prompt</div>
              <textarea
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                placeholder="Describe the workflow, architecture, code path, or system you want visualized."
                spellCheck={false}
                style={textareaStyle}
              />
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Optional diagram name"
                style={inputStyle}
              />
              <select
                value={draftKind}
                onChange={(event) => setDraftKind(event.target.value as DiagramKind)}
                style={inputStyle}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
              <textarea
                value={draftFilePaths}
                onChange={(event) => setDraftFilePaths(event.target.value)}
                placeholder="Optional file paths, one per line, to use as code/architecture source context"
                spellCheck={false}
                style={{ ...textareaStyle, minHeight: 88 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void generateFromPrompt()} disabled={isGenerating} style={{ ...btnStyle, flex: 1, background: '#1d4ed8', color: '#fff' }}>
                  {isGenerating ? 'Drafting…' : 'Create Diagram'}
                </button>
                <button onClick={() => void generateFromPrompt(current.id)} disabled={isGenerating} style={{ ...btnStyle, flex: 1 }}>
                  Revise Current
                </button>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Quick Templates</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {['flowchart', 'architecture', 'sequence', 'mindmap', 'erd', 'concept'].map((kind) => (
                  <button
                    key={kind}
                    onClick={() => void createTemplate(kind as DiagramKind)}
                    style={{ ...btnStyle, width: '100%' }}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...cardStyle, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Diagram Library</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => void loadLibrary()} style={btnStyle}>
                  {loadingLibrary ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search saved diagrams"
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <div style={{ overflowY: 'auto', display: 'grid', gap: 8 }}>
                {filteredDiagrams.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openDiagram(item.id)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: item.id === current.id ? '1px solid rgba(59, 130, 246, 0.8)' : '1px solid rgba(148, 163, 184, 0.12)',
                      background: item.id === current.id ? 'rgba(37, 99, 235, 0.16)' : 'rgba(15, 23, 42, 0.6)',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                      {item.kind} · {(item.spec?.nodes || []).length} nodes · {(item.spec?.edges || []).length} edges
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                      Updated {formatTimestamp(item.updated_at)}
                    </div>
                  </button>
                ))}
                {filteredDiagrams.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 12, padding: '10px 2px' }}>
                    No diagrams match the current filter.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderLeft: '1px solid rgba(148, 163, 184, 0.12)', borderRight: '1px solid rgba(148, 163, 184, 0.12)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(148, 163, 184, 0.12)', background: 'rgba(15, 23, 42, 0.72)' }}>
              <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 700 }}>{current.name}</div>
              <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                {current.kind} · {(nodes || []).length} nodes · {(edges || []).length} edges · updated {formatTimestamp(current.updated_at)}
              </div>
              {status ? (
                <div style={{ color: '#38bdf8', fontSize: 11, marginTop: 8 }}>{status}</div>
              ) : null}
            </div>

            <div
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handleCanvasClick}
              style={{
                flex: 1,
                overflow: 'hidden',
                cursor: dragRef.current ? 'grabbing' : 'grab',
                background:
                  'linear-gradient(#0f1524, #0f1524) padding-box,' +
                  'repeating-linear-gradient(0deg, transparent 0 23px, rgba(255,255,255,0.03) 23px 24px),' +
                  'repeating-linear-gradient(90deg, transparent 0 23px, rgba(255,255,255,0.03) 23px 24px)',
              }}
            >
              <div
                ref={canvasRef}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center',
                  transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
                }}
                dangerouslySetInnerHTML={{ __html: current.svg }}
              />
            </div>
          </div>

          <div style={sidebarStyle}>
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Diagram Details</div>
              <input value={diagramNameInput} onChange={(event) => setDiagramNameInput(event.target.value)} placeholder="Diagram name" style={inputStyle} />
              <input value={titleInput} onChange={(event) => setTitleInput(event.target.value)} placeholder="Canvas title" style={inputStyle} />
              <input value={subtitleInput} onChange={(event) => setSubtitleInput(event.target.value)} placeholder="Subtitle" style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select value={kindInput} onChange={(event) => setKindInput(event.target.value as DiagramKind)} style={inputStyle}>
                  {KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
                <select value={layoutInput} onChange={(event) => setLayoutInput(event.target.value as typeof LAYOUTS[number])} style={inputStyle}>
                  {LAYOUTS.map((layout) => <option key={layout} value={layout}>{layout}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveDiagramMetadata} style={{ ...btnStyle, flex: 1 }}>Apply</button>
                <button onClick={deleteCurrentDiagram} style={{ ...btnStyle, flex: 1, color: '#fca5a5' }}>Delete</button>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Add Node</div>
              <input value={newNodeDraft.label || ''} onChange={(event) => setNewNodeDraft((currentValue) => ({ ...currentValue, label: event.target.value, id: currentValue.id || slugify(event.target.value, 'node') }))} placeholder="Node label" style={inputStyle} />
              <input value={newNodeDraft.id || ''} onChange={(event) => setNewNodeDraft((currentValue) => ({ ...currentValue, id: slugify(event.target.value, 'node') }))} placeholder="node-id" style={inputStyle} />
              <input value={newNodeDraft.sub || ''} onChange={(event) => setNewNodeDraft((currentValue) => ({ ...currentValue, sub: event.target.value }))} placeholder="Optional secondary line" style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select value={newNodeDraft.color || 'blue'} onChange={(event) => setNewNodeDraft((currentValue) => ({ ...currentValue, color: event.target.value as DiagramColor }))} style={inputStyle}>
                  {PALETTE.map((color) => <option key={color} value={color}>{color}</option>)}
                </select>
                <select value={newNodeDraft.shape || 'rect'} onChange={(event) => setNewNodeDraft((currentValue) => ({ ...currentValue, shape: event.target.value as DiagramShape }))} style={inputStyle}>
                  {SHAPES.map((shape) => <option key={shape} value={shape}>{shape}</option>)}
                </select>
              </div>
              <button onClick={addNode} style={{ ...btnStyle, width: '100%' }}>Add Node</button>
            </div>

            <div style={{ ...cardStyle, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <div style={sectionTitleStyle}>Nodes</div>
              <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                {nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNodeId(node.id)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: node.id === selectedNodeId ? '1px solid rgba(56, 189, 248, 0.8)' : '1px solid rgba(148, 163, 184, 0.12)',
                      background: node.id === selectedNodeId ? 'rgba(8, 145, 178, 0.14)' : 'rgba(15, 23, 42, 0.5)',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{node.label}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{node.id}</div>
                  </button>
                ))}
              </div>

              <div style={{ ...sectionTitleStyle, marginTop: 0 }}>Selected Node</div>
              {selectedNode ? (
                <>
                  <input value={nodeDraft.label || ''} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, label: event.target.value }))} placeholder="Label" style={inputStyle} />
                  <input value={nodeDraft.sub || ''} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, sub: event.target.value }))} placeholder="Secondary line" style={inputStyle} />
                  <input value={nodeDraft.meta || ''} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, meta: event.target.value }))} placeholder="Meta line" style={inputStyle} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select value={nodeDraft.color || 'blue'} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, color: event.target.value as DiagramColor }))} style={inputStyle}>
                      {PALETTE.map((color) => <option key={color} value={color}>{color}</option>)}
                    </select>
                    <select value={nodeDraft.shape || 'rect'} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, shape: event.target.value as DiagramShape }))} style={inputStyle}>
                      {SHAPES.map((shape) => <option key={shape} value={shape}>{shape}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    <input value={String(nodeDraft.x ?? '')} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, x: parseOptionalNumber(event.target.value) }))} placeholder="x" style={inputStyle} />
                    <input value={String(nodeDraft.y ?? '')} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, y: parseOptionalNumber(event.target.value) }))} placeholder="y" style={inputStyle} />
                    <input value={String(nodeDraft.w ?? '')} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, w: parseOptionalNumber(event.target.value) }))} placeholder="width" style={inputStyle} />
                    <input value={String(nodeDraft.h ?? '')} onChange={(event) => setNodeDraft((currentValue) => ({ ...currentValue, h: parseOptionalNumber(event.target.value) }))} placeholder="height" style={inputStyle} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveSelectedNode} style={{ ...btnStyle, flex: 1 }}>Save Node</button>
                    <button onClick={removeSelectedNode} style={{ ...btnStyle, flex: 1, color: '#fca5a5' }}>Remove</button>
                  </div>
                </>
              ) : (
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
                  Click a node in the canvas or list to edit it.
                </div>
              )}

              <div style={{ ...sectionTitleStyle, marginTop: 18 }}>Add Edge</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select value={edgeDraft.from} onChange={(event) => setEdgeDraft((currentValue) => ({ ...currentValue, from: event.target.value }))} style={inputStyle}>
                  <option value="">From node</option>
                  {nodes.map((node) => <option key={`from-${node.id}`} value={node.id}>{node.label}</option>)}
                </select>
                <select value={edgeDraft.to} onChange={(event) => setEdgeDraft((currentValue) => ({ ...currentValue, to: event.target.value }))} style={inputStyle}>
                  <option value="">To node</option>
                  {nodes.map((node) => <option key={`to-${node.id}`} value={node.id}>{node.label}</option>)}
                </select>
              </div>
              <input value={edgeDraft.label || ''} onChange={(event) => setEdgeDraft((currentValue) => ({ ...currentValue, label: event.target.value }))} placeholder="Optional edge label" style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select value={edgeDraft.color || 'slate'} onChange={(event) => setEdgeDraft((currentValue) => ({ ...currentValue, color: event.target.value as DiagramColor }))} style={inputStyle}>
                  {PALETTE.map((color) => <option key={color} value={color}>{color}</option>)}
                </select>
                <select value={edgeDraft.curve || 'curved'} onChange={(event) => setEdgeDraft((currentValue) => ({ ...currentValue, curve: event.target.value as DiagramEdge['curve'] }))} style={inputStyle}>
                  <option value="curved">curved</option>
                  <option value="straight">straight</option>
                  <option value="orthogonal">orthogonal</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12, marginBottom: 10 }}>
                <input type="checkbox" checked={Boolean(edgeDraft.dashed)} onChange={(event) => setEdgeDraft((currentValue) => ({ ...currentValue, dashed: event.target.checked }))} />
                Dashed edge
              </label>
              <button onClick={addEdge} style={{ ...btnStyle, width: '100%' }}>Add Edge</button>

              <div style={{ ...sectionTitleStyle, marginTop: 18 }}>Edges</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {edges.map((edge, index) => (
                  <div
                    key={`${edge.from}-${edge.to}-${index}`}
                    style={{
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.12)',
                      background: 'rgba(15, 23, 42, 0.46)',
                    }}
                  >
                    <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 700 }}>
                      {edge.from} → {edge.to}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                      {edge.label || 'unlabeled'} · {edge.curve || 'curved'}{edge.dashed ? ' · dashed' : ''}
                    </div>
                    <button onClick={() => void removeEdge(edge)} style={{ ...btnStyle, marginTop: 8, color: '#fca5a5' }}>
                      Remove Edge
                    </button>
                  </div>
                ))}
              </div>

              {showSpec ? (
                <div style={{ marginTop: 18 }}>
                  <div style={sectionTitleStyle}>Spec JSON</div>
                  <textarea
                    value={specText}
                    onChange={(event) => setSpecText(event.target.value)}
                    spellCheck={false}
                    style={{ ...textareaStyle, minHeight: 240, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveSpec} disabled={savingSpec} style={{ ...btnStyle, flex: 1, background: '#1d4ed8', color: '#fff' }}>
                      {savingSpec ? 'Saving…' : 'Apply JSON'}
                    </button>
                    <button onClick={() => setSpecText(JSON.stringify(current.spec, null, 2))} style={{ ...btnStyle, flex: 1 }}>
                      Revert
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid rgba(148, 163, 184, 0.12)',
            color: '#64748b',
            fontSize: 11,
            background: 'rgba(15, 23, 42, 0.88)',
          }}
        >
          Ask Nexus for diagrams in chat or voice, then refine them here. You can also draft from a prompt with optional code file paths and iterate visually inside the builder.
        </div>
      </div>
    </>
  );
};

const sidebarStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 14,
  background: 'rgba(2, 6, 23, 0.9)',
  minHeight: 0,
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.68)',
  border: '1px solid rgba(148, 163, 184, 0.12)',
  borderRadius: 14,
  padding: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 10,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: 'rgba(8, 15, 28, 0.9)',
  color: '#e2e8f0',
  fontSize: 12,
  outline: 'none',
  marginBottom: 8,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 112,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: 'rgba(8, 15, 28, 0.9)',
  color: '#e2e8f0',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
  outline: 'none',
  marginBottom: 8,
};

const btnStyle: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  color: '#e2e8f0',
  padding: '8px 12px',
  borderRadius: 10,
  fontSize: 12,
  cursor: 'pointer',
};

export default DiagramViewer;
