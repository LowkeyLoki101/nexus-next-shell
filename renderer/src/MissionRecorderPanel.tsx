import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MissionEventRecord,
  MissionRecord,
  MissionStatus,
} from '../../shared/mission-recorder';
import type { WorkTraceEvent } from '../../shared/work-trace';
import type { SessionRuntimeState } from '../../shared/session-runtime';

interface MissionRecorderPanelProps {
  currentSessionId: string | null;
  currentSessionName: string | null;
  workTraceEvents: WorkTraceEvent[];
  sessionRuntime: SessionRuntimeState | null;
  snapshotState: Record<string, unknown>;
  onResumeMission: (mission: MissionRecord) => void;
}

function formatDateLabel(timestamp: number | undefined): string {
  if (!timestamp) {
    return 'n/a';
  }

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) return 'just now';
  if (elapsedMs < 3_600_000) return `${Math.max(1, Math.round(elapsedMs / 60_000))}m ago`;
  if (elapsedMs < 86_400_000) return `${Math.max(1, Math.round(elapsedMs / 3_600_000))}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function missionStatusLabel(status: MissionStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'paused':
      return 'Paused';
    case 'active':
    default:
      return 'Active';
  }
}

function truncate(value: string, maxLength: number): string {
  const clean = String(value || '').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

function eventMeta(event: MissionEventRecord): string {
  return [
    event.toolName || event.workTraceKind || event.type,
    event.workTracePhase,
    formatDateLabel(event.timestamp),
  ].filter(Boolean).join(' · ');
}

function getEventClassName(event: MissionEventRecord): string {
  return `next-mission-event is-${event.type}${event.workTracePhase ? ` is-phase-${event.workTracePhase}` : ''}`;
}

export default function MissionRecorderPanel(props: MissionRecorderPanelProps): React.ReactElement {
  const nexus = window.nexus;
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [noteText, setNoteText] = useState('');
  const [nextStepDraft, setNextStepDraft] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const activeMission = useMemo(
    () => missions.find((mission) => mission.id === activeMissionId) || null,
    [activeMissionId, missions],
  );

  const activeArtifacts = useMemo(
    () => activeMission?.events
      .filter((event) => event.artifactPath)
      .slice()
      .reverse()
      .slice(0, 8) || [],
    [activeMission],
  );

  const activeFailures = useMemo(
    () => activeMission?.events
      .filter((event) => event.type === 'failure')
      .slice()
      .reverse()
      .slice(0, 4) || [],
    [activeMission],
  );

  const loadMissions = useCallback(async () => {
    const records = await nexus.missions.list();
    setMissions(records);
    setActiveMissionId((current) => {
      if (current && records.some((mission) => mission.id === current)) {
        return current;
      }

      const sessionActive = records.find(
        (mission) => mission.status === 'active' && mission.sessionId === props.currentSessionId,
      );
      const anyActive = records.find((mission) => mission.status === 'active');
      return sessionActive?.id || anyActive?.id || records[0]?.id || null;
    });
  }, [nexus.missions, props.currentSessionId]);

  useEffect(() => {
    let cancelled = false;

    void loadMissions().catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : 'Mission list failed.');
      }
    });

    const unsubscribe = nexus.missions.onChanged((payload: any) => {
      if (cancelled) {
        return;
      }
      if (Array.isArray(payload?.missions)) {
        setMissions(payload.missions);
        if (payload.missionId) {
          setActiveMissionId((current) => current || payload.missionId);
        }
      } else {
        void loadMissions();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadMissions, nexus.missions]);

  useEffect(() => {
    if (activeMission) {
      setNextStepDraft(activeMission.nextStep || '');
    }
  }, [activeMission?.id, activeMission?.nextStep]);

  const runMissionAction = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusyAction(label);
    setError('');
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${label} failed.`);
    } finally {
      setBusyAction('');
    }
  }, []);

  const startMission = useCallback(() => runMissionAction('Starting mission', async () => {
    const missionTitle = title.trim() || props.currentSessionName || 'Nexus Next Mission';
    const missionObjective = objective.trim() || props.sessionRuntime?.objective || 'Capture this Nexus run end to end.';
    const mission = await nexus.missions.create({
      title: missionTitle,
      objective: missionObjective,
      sessionId: props.currentSessionId || undefined,
      nextStep: 'Run the first action and verify the captured evidence.',
    });

    for (const event of props.workTraceEvents.slice(0, 8).reverse()) {
      await nexus.missions.attachWorkTrace(mission.id, event);
    }

    setActiveMissionId(mission.id);
    setTitle('');
    setObjective('');
    setNotice('Mission started.');
    await loadMissions();
  }), [
    loadMissions,
    nexus.missions,
    objective,
    props.currentSessionId,
    props.currentSessionName,
    props.sessionRuntime?.objective,
    props.workTraceEvents,
    runMissionAction,
    title,
  ]);

  const appendNote = useCallback(() => {
    if (!activeMission || !noteText.trim()) {
      return;
    }

    void runMissionAction('Adding note', async () => {
      const updated = await nexus.missions.appendEvent(activeMission.id, {
        type: 'note',
        label: 'Operator note',
        summary: noteText.trim(),
        sessionId: props.currentSessionId || activeMission.sessionId,
      });
      setActiveMissionId(updated.id);
      setNoteText('');
      setNotice('Note added.');
      await loadMissions();
    });
  }, [activeMission, loadMissions, nexus.missions, noteText, props.currentSessionId, runMissionAction]);

  const captureSnapshot = useCallback(() => {
    if (!activeMission) {
      return;
    }

    void runMissionAction('Capturing snapshot', async () => {
      const detail = JSON.stringify({
        ...props.snapshotState,
        capturedAt: new Date().toISOString(),
      }, null, 2);
      await nexus.missions.appendEvent(activeMission.id, {
        type: 'snapshot',
        label: 'Nexus state snapshot',
        summary: `${props.snapshotState.activeTab || 'Nexus'} state captured with ${props.workTraceEvents.length} visible trace events.`,
        detail,
        sessionId: props.currentSessionId || activeMission.sessionId,
      });
      setNotice('Snapshot captured.');
      await loadMissions();
    });
  }, [activeMission, loadMissions, nexus.missions, props.currentSessionId, props.snapshotState, props.workTraceEvents.length, runMissionAction]);

  const updateMissionStatus = useCallback((status: MissionStatus) => {
    if (!activeMission) {
      return;
    }

    void runMissionAction('Updating mission', async () => {
      await nexus.missions.update(activeMission.id, {
        status,
        nextStep: nextStepDraft.trim() || activeMission.nextStep,
      });
      await nexus.missions.appendEvent(activeMission.id, {
        type: status === 'failed' ? 'failure' : 'system',
        label: status === 'completed' ? 'Mission completed' : status === 'failed' ? 'Mission marked failed' : 'Mission status changed',
        summary: nextStepDraft.trim() || missionStatusLabel(status),
        sessionId: props.currentSessionId || activeMission.sessionId,
      });
      setNotice(`Mission ${missionStatusLabel(status).toLowerCase()}.`);
      await loadMissions();
    });
  }, [activeMission, loadMissions, nexus.missions, nextStepDraft, props.currentSessionId, runMissionAction]);

  const saveNextStep = useCallback(() => {
    if (!activeMission) {
      return;
    }

    void runMissionAction('Saving next step', async () => {
      await nexus.missions.update(activeMission.id, {
        nextStep: nextStepDraft.trim(),
      });
      setNotice('Next step saved.');
      await loadMissions();
    });
  }, [activeMission, loadMissions, nexus.missions, nextStepDraft, runMissionAction]);

  const exportMission = useCallback(() => {
    if (!activeMission) {
      return;
    }

    void runMissionAction('Exporting mission', async () => {
      const result = await nexus.missions.exportMarkdown(activeMission.id);
      setNotice(`Exported ${result.name}`);
      await loadMissions();
      await nexus.artifacts.reveal(result.path);
    });
  }, [activeMission, loadMissions, nexus.artifacts, nexus.missions, runMissionAction]);

  const resumeMission = useCallback(() => {
    if (!activeMission) {
      return;
    }

    void runMissionAction('Resuming mission', async () => {
      const mission = await nexus.missions.update(activeMission.id, { status: 'active' });
      await nexus.missions.appendEvent(activeMission.id, {
        type: 'resume',
        label: 'Mission resumed',
        summary: mission.nextStep || mission.objective,
        sessionId: props.currentSessionId || activeMission.sessionId,
      });
      props.onResumeMission(mission);
      setNotice('Mission resumed in chat.');
      await loadMissions();
    });
  }, [activeMission, loadMissions, nexus.missions, props, runMissionAction]);

  return (
    <div className="next-mission-layout">
      <aside className="next-mission-sidebar">
        <section className="next-mission-start">
          <div className="next-mission-section-head">
            <div>
              <div className="next-mini-label">New Mission</div>
              <strong>{props.currentSessionName || 'Nexus Next'}</strong>
            </div>
            <span>{props.currentSessionId ? 'Session linked' : 'No session'}</span>
          </div>
          <div className="next-form-stack">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Mission title"
              disabled={Boolean(busyAction)}
            />
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Objective"
              rows={4}
              disabled={Boolean(busyAction)}
            />
            <button
              type="button"
              className="next-primary-button"
              onClick={() => void startMission()}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'Starting mission' ? 'Starting…' : 'Start Mission'}
            </button>
          </div>
        </section>

        <section className="next-mission-list-panel">
          <div className="next-mission-section-head">
            <div className="next-mini-label">Missions</div>
            <span>{missions.length}</span>
          </div>
          <div className="next-mission-list">
            {missions.length ? missions.map((mission) => (
              <button
                type="button"
                key={mission.id}
                className={`next-mission-row is-${mission.status}${mission.id === activeMissionId ? ' is-active' : ''}`}
                onClick={() => setActiveMissionId(mission.id)}
              >
                <span>{missionStatusLabel(mission.status)}</span>
                <strong>{mission.title}</strong>
                <small>{mission.eventCount} events · {formatDateLabel(mission.updatedAt)}</small>
              </button>
            )) : (
              <div className="next-empty-inline">Start a mission to pin the next run.</div>
            )}
          </div>
        </section>
      </aside>

      <section className="next-mission-main">
        {activeMission ? (
          <>
            <div className="next-mission-toolbar">
              <div className="next-stage-toolbar-copy">
                <div className="next-mini-label">Mission Recorder</div>
                <h2>{activeMission.title}</h2>
                <p>{activeMission.objective || 'No objective recorded.'}</p>
              </div>
              <div className="next-mission-actions">
                <button type="button" className="next-secondary-button" onClick={captureSnapshot} disabled={Boolean(busyAction)}>
                  Snapshot
                </button>
                <button type="button" className="next-secondary-button" onClick={resumeMission} disabled={Boolean(busyAction)}>
                  Resume
                </button>
                <button type="button" className="next-secondary-button" onClick={exportMission} disabled={Boolean(busyAction)}>
                  Export Report
                </button>
              </div>
            </div>

            <div className="next-mission-body">
              <div className="next-mission-timeline">
                <div className="next-mission-stat-strip">
                  <div className="next-mission-stat">
                    <span>Status</span>
                    <strong>{missionStatusLabel(activeMission.status)}</strong>
                  </div>
                  <div className="next-mission-stat">
                    <span>Events</span>
                    <strong>{activeMission.eventCount}</strong>
                  </div>
                  <div className="next-mission-stat">
                    <span>Artifacts</span>
                    <strong>{activeMission.artifactCount}</strong>
                  </div>
                  <div className="next-mission-stat">
                    <span>Failures</span>
                    <strong>{activeMission.failureCount}</strong>
                  </div>
                </div>

                <div className="next-mission-feed">
                  {activeMission.events.length ? activeMission.events.slice().reverse().map((event) => (
                    <article className={getEventClassName(event)} key={event.id}>
                      <div className="next-mission-event-marker" aria-hidden="true" />
                      <div className="next-mission-event-copy">
                        <div className="next-mission-event-head">
                          <strong>{event.label}</strong>
                          <span>{eventMeta(event)}</span>
                        </div>
                        <p>{event.summary}</p>
                        {event.detail ? <pre>{truncate(event.detail, 1400)}</pre> : null}
                        {event.artifactPath ? (
                          <div className="next-inline-actions">
                            <button type="button" className="next-secondary-button" onClick={() => void nexus.artifacts.open(event.artifactPath as string)}>
                              Open
                            </button>
                            <button type="button" className="next-secondary-button" onClick={() => void nexus.artifacts.reveal(event.artifactPath as string)}>
                              Reveal
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )) : (
                    <div className="next-empty-state">
                      <strong>No events yet</strong>
                      <span>Run Nexus or add a note to start the timeline.</span>
                    </div>
                  )}
                </div>
              </div>

              <aside className="next-mission-inspector">
                <section className="next-mission-inspector-panel">
                  <div className="next-mini-label">Next Step</div>
                  <textarea
                    value={nextStepDraft}
                    onChange={(event) => setNextStepDraft(event.target.value)}
                    rows={4}
                    placeholder="Next action"
                  />
                  <button type="button" className="next-secondary-button" onClick={saveNextStep} disabled={Boolean(busyAction)}>
                    Save Next Step
                  </button>
                </section>

                <section className="next-mission-inspector-panel">
                  <div className="next-mini-label">Add Note</div>
                  <textarea
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    rows={4}
                    placeholder="What changed?"
                  />
                  <button type="button" className="next-secondary-button" onClick={appendNote} disabled={!noteText.trim() || Boolean(busyAction)}>
                    Add Note
                  </button>
                </section>

                <section className="next-mission-inspector-panel">
                  <div className="next-mini-label">Artifacts</div>
                  <div className="next-mission-mini-list">
                    {activeArtifacts.length ? activeArtifacts.map((event) => (
                      <button
                        type="button"
                        className="next-mission-mini-row"
                        key={event.id}
                        onClick={() => event.artifactPath ? void nexus.artifacts.open(event.artifactPath) : undefined}
                      >
                        <strong>{event.artifactName || event.label}</strong>
                        <span>{formatDateLabel(event.timestamp)}</span>
                      </button>
                    )) : (
                      <div className="next-empty-inline">No artifacts captured yet.</div>
                    )}
                  </div>
                </section>

                {activeFailures.length ? (
                  <section className="next-mission-inspector-panel is-failure">
                    <div className="next-mini-label">Failures</div>
                    <div className="next-mission-mini-list">
                      {activeFailures.map((event) => (
                        <div className="next-mission-mini-row" key={event.id}>
                          <strong>{event.label}</strong>
                          <span>{truncate(event.summary, 120)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="next-mission-inspector-panel">
                  <div className="next-mini-label">Status</div>
                  <div className="next-mission-status-actions">
                    <button type="button" className="next-secondary-button" onClick={() => updateMissionStatus('active')} disabled={Boolean(busyAction)}>
                      Active
                    </button>
                    <button type="button" className="next-secondary-button" onClick={() => updateMissionStatus('paused')} disabled={Boolean(busyAction)}>
                      Pause
                    </button>
                    <button type="button" className="next-secondary-button" onClick={() => updateMissionStatus('completed')} disabled={Boolean(busyAction)}>
                      Complete
                    </button>
                    <button type="button" className="next-secondary-button" onClick={() => updateMissionStatus('failed')} disabled={Boolean(busyAction)}>
                      Failed
                    </button>
                  </div>
                </section>

                {notice ? <div className="next-mission-notice">{notice}</div> : null}
                {error ? <div className="next-mission-error">{error}</div> : null}
              </aside>
            </div>
          </>
        ) : (
          <div className="next-empty-state">
            <strong>No mission selected</strong>
            <span>Start a mission from the left rail.</span>
          </div>
        )}
      </section>
    </div>
  );
}
