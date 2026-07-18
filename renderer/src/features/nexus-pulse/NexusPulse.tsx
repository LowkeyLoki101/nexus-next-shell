import React from 'react';
import type { NexusPulseMode } from './types';

function MicGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M18 11a6 6 0 1 1-12 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

export default function NexusPulse(props: {
  mode: NexusPulseMode;
  audioLevel: number;
  muted?: boolean;
  onClick?: () => void;
  title?: string;
}): React.ReactElement {
  const amplitude = Math.max(0, Math.min(Number(props.audioLevel) || 0, 1));

  return (
    <button
      type="button"
      className={`nexus-pulse-core is-${props.mode}${props.muted ? ' is-muted' : ''}`}
      onClick={props.onClick}
      title={props.title}
      style={{ ['--nexus-pulse-audio' as any]: String(0.18 + amplitude * 0.82) }}
    >
      <span className="nexus-pulse-ring nexus-pulse-ring--outer" />
      <span className="nexus-pulse-ring nexus-pulse-ring--middle" />
      <span className="nexus-pulse-ring nexus-pulse-ring--inner" />
      <span className="nexus-pulse-core-center">
        <MicGlyph />
      </span>
    </button>
  );
}
