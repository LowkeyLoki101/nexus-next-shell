/**
 * Research Cartography Preload Additions
 *
 * Add this interface to the preload type definitions section,
 * and the implementation to the contextBridge.exposeInMainWorld block.
 *
 * 1. Add this interface alongside the existing ResearchAPI interface:
 */

interface ResearchGraphAPI {
  // Capsules
  createCapsule: (input: {
    title: string;
    claim: string;
    evidence?: string[];
    confidence?: number;
    perspective?: string;
    investigationId?: string;
    linkedPaths?: string[];
    tags?: string[];
    predictions?: string[];
    edgeConditions?: string[];
    alternativeGenerators?: string[];
  }) => Promise<any>;
  updateConfidence: (capsuleId: string, input: {
    newConfidence: number;
    reason: string;
    evidenceAdded?: string[];
    wouldReverseIf?: string;
  }) => Promise<any>;
  getCapsule: (id: string) => Promise<any>;
  listCapsules: (filters?: {
    investigationId?: string;
    state?: string;
    tags?: string[];
    perspective?: string;
  }) => Promise<any[]>;
  searchCapsules: (query: string) => Promise<any[]>;
  getCapsulesByPath: (pathPrefix: string) => Promise<any[]>;

  // Connections
  createConnection: (input: {
    sourceId: string;
    targetId: string;
    connectionType: string;
    justification: string;
    confidence?: number;
    perspective?: string;
    bidirectional?: boolean;
  }) => Promise<any>;
  listConnections: (filters?: {
    capsuleId?: string;
    connectionType?: string;
  }) => Promise<any[]>;
  getConnectionsFor: (capsuleId: string) => Promise<any[]>;

  // Obligations
  createObligation: (input: {
    capsuleId: string;
    obligationType: string;
    description: string;
    priority?: string;
    dueCondition?: string;
    investigationId?: string;
  }) => Promise<any>;
  resolveObligation: (id: string, input: {
    resolution: string;
    newStatus: string;
    evidenceRef?: string;
  }) => Promise<any>;
  listObligations: (filters?: {
    capsuleId?: string;
    status?: string;
    obligationType?: string;
    priority?: string;
  }) => Promise<any[]>;
  getObligationDebt: () => Promise<any>;

  // Scaffolds
  createScaffold: (input: {
    title: string;
    description?: string;
    dimensions: string[];
    investigationId?: string;
  }) => Promise<any>;
  attachToScaffold: (scaffoldId: string, capsuleId: string) => Promise<any>;
  listScaffolds: (filters?: { investigationId?: string }) => Promise<any[]>;

  // Branches
  createBranch: (input: {
    title: string;
    hypothesis: string;
    status?: string;
    rejectionReason?: string;
    revivalConditions?: string[];
    capsuleId?: string;
    investigationId?: string;
  }) => Promise<any>;
  updateBranch: (id: string, input: {
    newStatus: string;
    reason: string;
  }) => Promise<any>;
  listBranches: (filters?: {
    status?: string;
    capsuleId?: string;
  }) => Promise<any[]>;
  checkRevivals: (capsuleId: string) => Promise<any[]>;

  // Graph queries
  attentionField: () => Promise<any>;
  summary: () => Promise<any>;
  nodeContext: (capsuleId: string) => Promise<any>;
}


/**
 * 2. Add 'researchGraph: ResearchGraphAPI' to the NexusAPI interface
 *    (where 'research: ResearchAPI' already exists)
 *
 * 3. Add this implementation block inside the contextBridge.exposeInMainWorld
 *    call, alongside the existing 'research: { ... }' block:
 */

const researchGraphImpl = {
  // Capsules
  createCapsule: (input: any) =>
    ipcRenderer.invoke('research-graph:create-capsule', input),
  updateConfidence: (capsuleId: string, input: any) =>
    ipcRenderer.invoke('research-graph:update-confidence', capsuleId, input),
  getCapsule: (id: string) =>
    ipcRenderer.invoke('research-graph:get-capsule', id),
  listCapsules: (filters?: any) =>
    ipcRenderer.invoke('research-graph:list-capsules', filters),
  searchCapsules: (query: string) =>
    ipcRenderer.invoke('research-graph:search-capsules', query),
  getCapsulesByPath: (pathPrefix: string) =>
    ipcRenderer.invoke('research-graph:get-capsules-by-path', pathPrefix),

  // Connections
  createConnection: (input: any) =>
    ipcRenderer.invoke('research-graph:create-connection', input),
  listConnections: (filters?: any) =>
    ipcRenderer.invoke('research-graph:list-connections', filters),
  getConnectionsFor: (capsuleId: string) =>
    ipcRenderer.invoke('research-graph:get-connections-for', capsuleId),

  // Obligations
  createObligation: (input: any) =>
    ipcRenderer.invoke('research-graph:create-obligation', input),
  resolveObligation: (id: string, input: any) =>
    ipcRenderer.invoke('research-graph:resolve-obligation', id, input),
  listObligations: (filters?: any) =>
    ipcRenderer.invoke('research-graph:list-obligations', filters),
  getObligationDebt: () =>
    ipcRenderer.invoke('research-graph:get-obligation-debt'),

  // Scaffolds
  createScaffold: (input: any) =>
    ipcRenderer.invoke('research-graph:create-scaffold', input),
  attachToScaffold: (scaffoldId: string, capsuleId: string) =>
    ipcRenderer.invoke('research-graph:attach-to-scaffold', scaffoldId, capsuleId),
  listScaffolds: (filters?: any) =>
    ipcRenderer.invoke('research-graph:list-scaffolds', filters),

  // Branches
  createBranch: (input: any) =>
    ipcRenderer.invoke('research-graph:create-branch', input),
  updateBranch: (id: string, input: any) =>
    ipcRenderer.invoke('research-graph:update-branch', id, input),
  listBranches: (filters?: any) =>
    ipcRenderer.invoke('research-graph:list-branches', filters),
  checkRevivals: (capsuleId: string) =>
    ipcRenderer.invoke('research-graph:check-revivals', capsuleId),

  // Graph queries
  attentionField: () =>
    ipcRenderer.invoke('research-graph:attention-field'),
  summary: () =>
    ipcRenderer.invoke('research-graph:summary'),
  nodeContext: (capsuleId: string) =>
    ipcRenderer.invoke('research-graph:node-context', capsuleId),
};
