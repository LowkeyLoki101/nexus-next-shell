import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface ContractTemplateDefinition {
  id: string;
  label: string;
  category: string;
  summary: string;
  recommendedUse: string;
  attorneyReviewNotes: string[];
  supportedFormats: string[];
}

interface PrivateProfileRecord {
  fullName?: string;
  email?: string;
  company?: string;
  title?: string;
}

interface ContractDraftFormState {
  title: string;
  effectiveDate: string;
  governingLaw: string;
  purpose: string;
  disclosingPartyName: string;
  receivingPartyName: string;
  serviceProviderName: string;
  clientName: string;
  workerName: string;
  companyName: string;
  projectName: string;
  scopeSummary: string;
  paymentTerms: string;
  termLength: string;
  confidentialityTerm: string;
  returnOrDestroyWindow: string;
  customClauses: string;
}

interface DraftResult {
  title?: string;
  path?: string;
  type?: string;
  message?: string;
  template?: ContractTemplateDefinition;
}

export interface ContractDraftingPanelProps {
  currentSessionId: string | null;
  onOpenArtifact: (filePath: string, target?: 'focus' | 'workstation') => Promise<void> | void;
  onRefreshWorkspaceFiles: () => Promise<void> | void;
}

const EMPTY_FORM: ContractDraftFormState = {
  title: '',
  effectiveDate: '',
  governingLaw: '',
  purpose: '',
  disclosingPartyName: '',
  receivingPartyName: '',
  serviceProviderName: '',
  clientName: '',
  workerName: '',
  companyName: '',
  projectName: '',
  scopeSummary: '',
  paymentTerms: '',
  termLength: '',
  confidentialityTerm: '',
  returnOrDestroyWindow: '',
  customClauses: '',
};

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function categoryLabel(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ContractDraftingPanel(props: ContractDraftingPanelProps): React.ReactElement {
  const nexus = window.nexus;
  const [templates, setTemplates] = useState<ContractTemplateDefinition[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('mutual_nda');
  const [outputType, setOutputType] = useState<'docx' | 'pdf' | 'md' | 'txt'>('docx');
  const [useStoredProfile, setUseStoredProfile] = useState(true);
  const [storedProfile, setStoredProfile] = useState<PrivateProfileRecord | null>(null);
  const [form, setForm] = useState<ContractDraftFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);

  const refreshBootstrap = useCallback(async () => {
    const [templateResponse, profile] = await Promise.all([
      nexus.tools.execute('list_contract_templates', {}),
      nexus.privateProfile.get(),
    ]);
    const nextTemplates: ContractTemplateDefinition[] = Array.isArray(templateResponse?.result?.templates)
      ? templateResponse.result.templates as ContractTemplateDefinition[]
      : [];
    setTemplates(nextTemplates);
    setStoredProfile(profile || null);
    if (nextTemplates.length > 0 && !nextTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(nextTemplates[0].id);
    }
  }, [nexus.privateProfile, nexus.tools, selectedTemplateId]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setErrorMessage('');

    void refreshBootstrap()
      .catch((error) => {
        if (!disposed) {
          setErrorMessage(safeMessage(error, 'Failed to load contract drafting tools.'));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [refreshBootstrap]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates],
  );

  const profileSummary = useMemo(() => {
    const parts = [
      storedProfile?.company,
      storedProfile?.fullName,
      storedProfile?.email,
      storedProfile?.title,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'No stored private profile yet.';
  }, [storedProfile]);

  const handleFieldChange = useCallback((key: keyof ContractDraftFormState, value: string) => {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplateId) {
      setErrorMessage('Choose a contract template first.');
      return;
    }

    setIsGenerating(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await nexus.tools.execute('create_contract_draft', {
        templateId: selectedTemplateId,
        type: outputType,
        sessionId: props.currentSessionId || undefined,
        useStoredProfile,
        ...form,
      });

      if (!response?.success) {
        throw new Error(String(response?.error || 'Contract draft generation failed.'));
      }

      const result = (response?.result || {}) as DraftResult;
      setDraftResult(result);
      await props.onRefreshWorkspaceFiles();
      setStatusMessage(String(result.message || `${selectedTemplate?.label || 'Contract draft'} created.`));
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Contract draft generation failed.'));
      setDraftResult(null);
    } finally {
      setIsGenerating(false);
    }
  }, [
    form,
    nexus.tools,
    outputType,
    props,
    selectedTemplate?.label,
    selectedTemplateId,
    useStoredProfile,
  ]);

  if (loading) {
    return <div className="next-empty-inline">Loading contract drafting tools…</div>;
  }

  return (
    <div className="next-stage-scroll">
      <div className="next-panel-stage">
        <div className="next-panel-stage-top">
          <div className="next-mini-panel">
            <div className="next-mini-label">Template Library</div>
            <p className="next-panel-copy">
              These are structured lawyer-style first drafts. They are meant to get you to a serious draft faster, not to replace counsel.
            </p>
            <div className="next-contract-template-list">
              {templates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={`next-document-row next-contract-template-row${selectedTemplateId === template.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <strong>{template.label}</strong>
                  <span>{categoryLabel(template.category)}</span>
                  <span className="next-document-row-preview">{template.summary}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Selected Template</div>
            {selectedTemplate ? (
              <div className="next-contract-template-detail">
                <div className="next-status-chip-row">
                  <span className="next-marketing-chip is-live">{selectedTemplate.label}</span>
                  <span className="next-marketing-chip">{categoryLabel(selectedTemplate.category)}</span>
                  <span className="next-marketing-chip">{selectedTemplate.supportedFormats.join(', ')}</span>
                </div>
                <p className="next-panel-copy">{selectedTemplate.recommendedUse}</p>
                <div className="next-mini-label">Attorney Review Notes</div>
                <ul className="next-simple-list">
                  {selectedTemplate.attorneyReviewNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <div className="next-mini-label">Stored Profile</div>
                <p className="next-panel-copy">{profileSummary}</p>
              </div>
            ) : (
              <div className="next-empty-inline">No contract templates are available.</div>
            )}
          </div>
        </div>

        <div className="next-profile-grid">
          <div className="next-mini-panel">
            <div className="next-mini-label">Draft Settings</div>
            <div className="next-form-grid">
              <label className="next-field-group next-field-group--full">
                <span>Document Title</span>
                <input
                  value={form.title}
                  onChange={(event) => handleFieldChange('title', event.target.value)}
                  placeholder="Mutual NDA - Emergent Intelligence Group"
                />
              </label>
              <label className="next-field-group">
                <span>Output Type</span>
                <select value={outputType} onChange={(event) => setOutputType(event.target.value as 'docx' | 'pdf' | 'md' | 'txt')}>
                  <option value="docx">DOCX</option>
                  <option value="pdf">PDF</option>
                  <option value="md">Markdown</option>
                  <option value="txt">Text</option>
                </select>
              </label>
              <label className="next-field-group">
                <span>Effective Date</span>
                <input
                  value={form.effectiveDate}
                  onChange={(event) => handleFieldChange('effectiveDate', event.target.value)}
                  placeholder="April 23, 2026"
                />
              </label>
              <label className="next-field-group next-field-group--full next-inline-check">
                <input
                  type="checkbox"
                  checked={useStoredProfile}
                  onChange={(event) => setUseStoredProfile(event.target.checked)}
                />
                <span>Use the stored private profile to prefill company, name, and contact details where helpful.</span>
              </label>
            </div>
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Core Terms</div>
            <div className="next-form-grid">
              <label className="next-field-group">
                <span>Governing Law</span>
                <input
                  value={form.governingLaw}
                  onChange={(event) => handleFieldChange('governingLaw', event.target.value)}
                  placeholder="Texas"
                />
              </label>
              <label className="next-field-group">
                <span>Purpose / Deal Context</span>
                <input
                  value={form.purpose}
                  onChange={(event) => handleFieldChange('purpose', event.target.value)}
                  placeholder="evaluating Nexus product collaboration"
                />
              </label>
              <label className="next-field-group">
                <span>Disclosing Party</span>
                <input
                  value={form.disclosingPartyName}
                  onChange={(event) => handleFieldChange('disclosingPartyName', event.target.value)}
                  placeholder="Emergent Intelligence Group"
                />
              </label>
              <label className="next-field-group">
                <span>Receiving Party</span>
                <input
                  value={form.receivingPartyName}
                  onChange={(event) => handleFieldChange('receivingPartyName', event.target.value)}
                  placeholder="Counterparty"
                />
              </label>
              <label className="next-field-group">
                <span>Service Provider</span>
                <input
                  value={form.serviceProviderName}
                  onChange={(event) => handleFieldChange('serviceProviderName', event.target.value)}
                  placeholder="Consultant / Contractor"
                />
              </label>
              <label className="next-field-group">
                <span>Client</span>
                <input
                  value={form.clientName}
                  onChange={(event) => handleFieldChange('clientName', event.target.value)}
                  placeholder="Client entity"
                />
              </label>
              <label className="next-field-group">
                <span>Worker Name</span>
                <input
                  value={form.workerName}
                  onChange={(event) => handleFieldChange('workerName', event.target.value)}
                  placeholder="Named worker"
                />
              </label>
              <label className="next-field-group">
                <span>Company Name</span>
                <input
                  value={form.companyName}
                  onChange={(event) => handleFieldChange('companyName', event.target.value)}
                  placeholder="Company / employer"
                />
              </label>
              <label className="next-field-group">
                <span>Project Name</span>
                <input
                  value={form.projectName}
                  onChange={(event) => handleFieldChange('projectName', event.target.value)}
                  placeholder="Nexus platform initiative"
                />
              </label>
              <label className="next-field-group">
                <span>Term Length</span>
                <input
                  value={form.termLength}
                  onChange={(event) => handleFieldChange('termLength', event.target.value)}
                  placeholder="12 months"
                />
              </label>
              <label className="next-field-group">
                <span>Confidentiality Term</span>
                <input
                  value={form.confidentialityTerm}
                  onChange={(event) => handleFieldChange('confidentialityTerm', event.target.value)}
                  placeholder="3 years after each disclosure"
                />
              </label>
              <label className="next-field-group">
                <span>Return / Destroy Window</span>
                <input
                  value={form.returnOrDestroyWindow}
                  onChange={(event) => handleFieldChange('returnOrDestroyWindow', event.target.value)}
                  placeholder="10 business days"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="next-profile-grid">
          <div className="next-mini-panel">
            <div className="next-mini-label">Scope and Commercial Terms</div>
            <div className="next-form-stack">
              <label className="next-field-group next-field-group--full">
                <span>Scope Summary</span>
                <textarea
                  className="next-composer next-composer--compact"
                  rows={4}
                  value={form.scopeSummary}
                  onChange={(event) => handleFieldChange('scopeSummary', event.target.value)}
                  placeholder="Describe the project scope, deliverables, acceptance language, or the confidentiality context."
                />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Payment Terms</span>
                <textarea
                  className="next-composer next-composer--compact"
                  rows={3}
                  value={form.paymentTerms}
                  onChange={(event) => handleFieldChange('paymentTerms', event.target.value)}
                  placeholder="Retainer, milestone schedule, net terms, reimbursement rules, and late fee language."
                />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Custom Clauses</span>
                <textarea
                  className="next-composer next-composer--compact"
                  rows={5}
                  value={form.customClauses}
                  onChange={(event) => handleFieldChange('customClauses', event.target.value)}
                  placeholder="Insert special instructions, carveouts, liability language, assignment clauses, or counsel notes."
                />
              </label>
            </div>
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Generate Draft</div>
            <p className="next-panel-copy">
              Nexus will create a real document artifact you can open immediately, analyze, or send into AI Focus.
            </p>
            <div className="next-inline-actions">
              <button
                type="button"
                className="next-primary-button"
                disabled={isGenerating || !selectedTemplateId}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? 'Generating…' : `Create ${outputType.toUpperCase()}`}
              </button>
            </div>
            {statusMessage ? <div className="next-success-copy">{statusMessage}</div> : null}
            {errorMessage ? <div className="next-error-copy">{errorMessage}</div> : null}

            {draftResult?.path ? (
              <div className="next-contract-result-card">
                <div className="next-mini-label">Latest Draft</div>
                <strong>{draftResult.title || selectedTemplate?.label || 'Contract draft'}</strong>
                <p className="next-panel-copy">{draftResult.path}</p>
                <div className="next-inline-actions">
                  <button
                    type="button"
                    className="next-secondary-button"
                    onClick={() => void props.onOpenArtifact(String(draftResult.path || ''), 'workstation')}
                  >
                    Open Here
                  </button>
                  <button
                    type="button"
                    className="next-secondary-button"
                    onClick={() => void props.onOpenArtifact(String(draftResult.path || ''), 'focus')}
                  >
                    Send to AI Focus
                  </button>
                  <button
                    type="button"
                    className="next-secondary-button"
                    onClick={() => void nexus.artifacts.reveal(String(draftResult.path || ''))}
                  >
                    Reveal in Finder
                  </button>
                </div>
              </div>
            ) : (
              <div className="next-empty-inline">
                Generate a draft to materialize a real DOCX, PDF, Markdown, or text contract in the workspace.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
