import React from 'react';
import type { WorkTraceEvent } from '../../../../shared/work-trace';

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - Number(timestamp || 0);
  if (!Number.isFinite(deltaMs) || deltaMs < 30_000) {
    return 'now';
  }
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export default function ToolActivityTimeline(props: { events: WorkTraceEvent[] }): React.ReactElement | null {
  if (!props.events.length) {
    return null;
  }

  return (
    <div className="nexus-pulse-timeline">
      {props.events.map((event) => (
        <article className={`nexus-pulse-timeline-item is-${event.phase}`} key={event.id}>
          <div className="nexus-pulse-timeline-top">
            <strong>{event.label}</strong>
            <span>{formatRelativeTime(event.timestamp)}</span>
          </div>
          <p>{event.summary}</p>
          {event.toolName ? <div className="nexus-pulse-chip">{event.toolName}</div> : null}
        </article>
      ))}
    </div>
  );
}
