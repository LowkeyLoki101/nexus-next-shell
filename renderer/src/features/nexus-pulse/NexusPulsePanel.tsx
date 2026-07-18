import React from 'react';
import type { NexusPulseSnapshot } from './types';
import NexusPulse from './NexusPulse';
import ToolActivityTimeline from './ToolActivityTimeline';
import './nexus-pulse.css';

function formatModeLabel(mode: NexusPulseSnapshot['mode']): string {
  switch (mode) {
    case 'tool_calling':
      return 'Using tools';
    case 'needs_confirmation':
      return 'Needs approval';
    default:
      return mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, ' ');
  }
}

export default function NexusPulsePanel(props: {
  snapshot: NexusPulseSnapshot;
  onToggleConversation: () => void;
  conversationActive: boolean;
  canMute: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
}): React.ReactElement {
  const visibleText = props.snapshot.caption || props.snapshot.transcript || props.snapshot.statusText;

  return (
    <section className="next-panel nexus-pulse-panel">
      <div className="nexus-pulse-header">
        <div>
          <div className="next-panel-label">Nexus Pulse</div>
          <strong>{formatModeLabel(props.snapshot.mode)}</strong>
        </div>
        {props.canMute ? (
          <button type="button" className="nexus-pulse-secondary" onClick={props.onToggleMute}>
            {props.isMuted ? 'Unmute' : 'Mute'}
          </button>
        ) : null}
      </div>

      <div className="nexus-pulse-body">
        <NexusPulse
          mode={props.snapshot.mode}
          audioLevel={props.snapshot.audioLevel}
          muted={props.isMuted}
          onClick={props.onToggleConversation}
          title={props.conversationActive ? 'End voice session' : 'Start voice session'}
        />

        <div className="nexus-pulse-copy">
          <div className="nexus-pulse-status">{props.snapshot.statusText}</div>
          <div className="nexus-pulse-live-text">{visibleText}</div>
          {props.snapshot.currentTool ? (
            <div className="nexus-pulse-tool">
              <span className="nexus-pulse-chip">{props.snapshot.currentTool.name}</span>
              <p>{props.snapshot.currentTool.detail || props.snapshot.currentTool.phase}</p>
            </div>
          ) : null}
          {props.snapshot.requiresApproval ? (
            <div className="nexus-pulse-alert">Nexus is waiting for approval before it continues.</div>
          ) : null}
          {props.snapshot.error ? (
            <div className="nexus-pulse-alert is-error">{props.snapshot.error}</div>
          ) : null}
        </div>
      </div>

      <ToolActivityTimeline events={props.snapshot.recentEvents} />
    </section>
  );
}
