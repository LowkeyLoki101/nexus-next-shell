import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export const RECOGNIZED_GESTURES = ['fist', 'peace', 'index', 'open_hand', 'pinch'] as const;
export type RecognizedGestureId = (typeof RECOGNIZED_GESTURES)[number];
export type GestureId = RecognizedGestureId | 'none';

export const FILTER_IDS = ['none', 'dither', 'vhs', 'spotlight', 'water_ripple'] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export const ACTION_IDS = [
  'none',
  'pause_agent',
  'start_recording',
  'select_object',
  'open_command_palette',
  'wake_agent',
  'capture_moment',
  'trigger_voice_agent',
  'navigate_next',
  'navigate_previous',
  'system_click',
  'create_code_map',
  'ingest_code_knowledge',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export interface GestureMapping {
  visual: FilterId;
  action: ActionId;
}

export type GestureMappings = Record<RecognizedGestureId, GestureMapping>;

export interface CustomGesturePrompt {
  id: string;
  prompt: string;
  mappedGesture: RecognizedGestureId;
  visual: FilterId;
  action: ActionId;
  createdAt: string;
}

export interface VisionGestureSettings {
  version: number;
  mappings: GestureMappings;
  customPrompts: CustomGesturePrompt[];
  updatedAt: string;
}

export interface FingerStates {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface DetectedGesture {
  id: GestureId;
  label: string;
  confidence: number;
  handedness: string;
  fingerStates: FingerStates;
  reason: string;
  metrics?: {
    pinchCloseness?: number;
    pinchGapRatio?: number;
  };
}

export interface HandTrackingFrame {
  landmarks: NormalizedLandmark[] | null;
  worldLandmarks?: unknown[] | null;
  handedness: string;
  confidence: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GestureActionEvent {
  id: string;
  at: string;
  gesture: RecognizedGestureId;
  gestureLabel: string;
  action: ActionId;
  visual: FilterId;
  title: string;
  detail: string;
  point?: ScreenPoint;
}

export interface VisionGestureRuntimeState {
  cameraStatus: 'booting' | 'starting' | 'tracking' | 'blank' | 'error';
  cameraLabel: string;
  fps: number;
  confidence: number;
  gesture: DetectedGesture;
  activeFilter: FilterId;
  frameBrightness: number;
}

export const GESTURE_LABELS: Record<GestureId, string> = {
  none: 'No Gesture',
  fist: 'Fist',
  peace: 'Peace',
  index: 'Pointing',
  open_hand: 'Open Hand',
  pinch: 'Pinch',
};

export const FILTER_LABELS: Record<FilterId, string> = {
  none: 'Clean',
  dither: 'Dither',
  vhs: 'VHS',
  spotlight: 'Spotlight',
  water_ripple: 'Water Ripple',
};

export const ACTION_LABELS: Record<ActionId, string> = {
  none: 'No Action',
  pause_agent: 'Pause Agent',
  start_recording: 'Start Recording',
  select_object: 'Analyze Region',
  open_command_palette: 'Command Palette',
  wake_agent: 'Wake Nexus',
  capture_moment: 'Capture Moment',
  trigger_voice_agent: 'Voice Agent',
  navigate_next: 'Next',
  navigate_previous: 'Previous',
  system_click: 'Screen Click',
  create_code_map: 'Create Code Map',
  ingest_code_knowledge: 'Ingest Code KB',
};

export const DEFAULT_MAPPINGS: GestureMappings = {
  fist: {
    visual: 'dither',
    action: 'pause_agent',
  },
  peace: {
    visual: 'vhs',
    action: 'start_recording',
  },
  index: {
    visual: 'spotlight',
    action: 'select_object',
  },
  open_hand: {
    visual: 'water_ripple',
    action: 'open_command_palette',
  },
  pinch: {
    visual: 'spotlight',
    action: 'system_click',
  },
};
