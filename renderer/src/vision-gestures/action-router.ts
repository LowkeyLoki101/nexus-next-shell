import {
  ACTION_LABELS,
  FILTER_LABELS,
  GESTURE_LABELS,
  type GestureActionEvent,
  type GestureMapping,
  type RecognizedGestureId,
  type ScreenPoint,
} from './types';

interface RouteInput {
  gesture: RecognizedGestureId;
  mapping: GestureMapping;
  point: ScreenPoint | null;
  confidence: number;
  nowMs: number;
}

const ACTION_DETAILS: Record<string, string> = {
  none: 'No routed action.',
  pause_agent: 'Agent hold state requested.',
  start_recording: 'Recording callback queued for the active workspace.',
  select_object: 'Selected region sent to the visual analysis lane.',
  open_command_palette: 'Command palette callback requested.',
  wake_agent: 'Attention state requested.',
  capture_moment: 'Moment capture callback requested.',
  trigger_voice_agent: 'Voice agent callback requested.',
  navigate_next: 'Presentation next callback requested.',
  navigate_previous: 'Presentation previous callback requested.',
  system_click: 'Desktop click callback requested.',
  create_code_map: 'Understand-Anything code map creation requested.',
  ingest_code_knowledge: 'Understand-Anything knowledge ingestion requested.',
};

export class GestureActionRouter {
  private lastGesture: RecognizedGestureId | null = null;
  private lastActionAt = 0;

  route(input: RouteInput): GestureActionEvent | null {
    const enoughTimeElapsed = input.nowMs - this.lastActionAt > 1400;
    if (input.gesture === this.lastGesture && !enoughTimeElapsed) {
      return null;
    }

    this.lastGesture = input.gesture;
    this.lastActionAt = input.nowMs;

    const event: GestureActionEvent = {
      id: `${input.gesture}-${Math.round(input.nowMs)}`,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      gesture: input.gesture,
      gestureLabel: GESTURE_LABELS[input.gesture],
      action: input.mapping.action,
      visual: input.mapping.visual,
      title: `${GESTURE_LABELS[input.gesture]} -> ${ACTION_LABELS[input.mapping.action]}`,
      detail: buildActionDetail(input),
      point: input.point || undefined,
    };

    console.info('[Nexus Vision Gestures] action routed', event);
    return event;
  }

  reset(): void {
    this.lastGesture = null;
    this.lastActionAt = 0;
  }
}

function buildActionDetail(input: RouteInput): string {
  const filter = FILTER_LABELS[input.mapping.visual];
  const actionDetail = ACTION_DETAILS[input.mapping.action] || 'Custom callback requested.';
  const point = input.point
    ? ` Focus ${Math.round(input.point.x)}, ${Math.round(input.point.y)}.`
    : '';
  return `${actionDetail} Visual mode: ${filter}. Confidence ${Math.round(input.confidence * 100)}%.${point}`;
}
