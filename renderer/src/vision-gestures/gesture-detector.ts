import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  GESTURE_LABELS,
  type DetectedGesture,
  type FingerStates,
  type GestureId,
  type ScreenPoint,
} from './types';

const WRIST = 0;
const THUMB = { mcp: 2, ip: 3, tip: 4 };
const INDEX = { mcp: 5, pip: 6, tip: 8 };
const MIDDLE = { mcp: 9, pip: 10, tip: 12 };
const RING = { mcp: 13, pip: 14, tip: 16 };
const PINKY = { mcp: 17, pip: 18, tip: 20 };

const EMPTY_FINGERS: FingerStates = {
  thumb: false,
  index: false,
  middle: false,
  ring: false,
  pinky: false,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const z = (a.z || 0) - (b.z || 0);
  return Math.hypot(a.x - b.x, a.y - b.y, z * 0.35);
}

function distance2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hasRequiredLandmarks(landmarks: NormalizedLandmark[] | null): landmarks is NormalizedLandmark[] {
  return Boolean(landmarks && landmarks.length >= 21 && landmarks[WRIST] && landmarks[INDEX.tip]);
}

function fingerExtended(
  landmarks: NormalizedLandmark[],
  finger: { mcp: number; pip: number; tip: number },
  palmScale: number,
): boolean {
  const wrist = landmarks[WRIST];
  const mcp = landmarks[finger.mcp];
  const pip = landmarks[finger.pip];
  const tip = landmarks[finger.tip];
  const wristToTip = distance(wrist, tip);
  const wristToPip = distance(wrist, pip);
  const mcpToTip = distance(mcp, tip);
  const mcpToPip = distance(mcp, pip);
  const verticalLift = tip.y < pip.y - palmScale * 0.08;
  const lengthened = wristToTip > wristToPip * 1.1 && mcpToTip > mcpToPip * 1.32;
  return verticalLift || lengthened;
}

function thumbExtended(landmarks: NormalizedLandmark[], palmWidth: number): boolean {
  const wrist = landmarks[WRIST];
  const tip = landmarks[THUMB.tip];
  const ip = landmarks[THUMB.ip];
  const indexMcp = landmarks[INDEX.mcp];
  const awayFromPalm = distance(tip, indexMcp) > palmWidth * 0.62;
  const lengthened = distance(wrist, tip) > distance(wrist, ip) * 1.06;
  return awayFromPalm && lengthened;
}

function buildFingerStates(landmarks: NormalizedLandmark[]): FingerStates {
  const palmWidth = Math.max(0.001, distance(landmarks[INDEX.mcp], landmarks[PINKY.mcp]));
  const palmScale = Math.max(0.001, distance(landmarks[WRIST], landmarks[MIDDLE.mcp]));

  return {
    thumb: thumbExtended(landmarks, palmWidth),
    index: fingerExtended(landmarks, INDEX, palmScale),
    middle: fingerExtended(landmarks, MIDDLE, palmScale),
    ring: fingerExtended(landmarks, RING, palmScale),
    pinky: fingerExtended(landmarks, PINKY, palmScale),
  };
}

function countExtended(states: FingerStates): number {
  return Number(states.thumb)
    + Number(states.index)
    + Number(states.middle)
    + Number(states.ring)
    + Number(states.pinky);
}

function createDetectedGesture(
  id: GestureId,
  confidence: number,
  handedness: string,
  fingerStates: FingerStates,
  reason: string,
  metrics?: DetectedGesture['metrics'],
): DetectedGesture {
  return {
    id,
    label: GESTURE_LABELS[id],
    confidence: clamp(confidence),
    handedness,
    fingerStates,
    reason,
    metrics,
  };
}

export function detectGesture(
  landmarks: NormalizedLandmark[] | null,
  handConfidence: number,
  handedness = 'Hand',
): DetectedGesture {
  if (!hasRequiredLandmarks(landmarks)) {
    return createDetectedGesture('none', 0, handedness, EMPTY_FINGERS, 'No hand landmarks');
  }

  const fingers = buildFingerStates(landmarks);
  const extendedCount = countExtended(fingers);
  const baseConfidence = clamp(handConfidence || 0.65, 0.45, 1);
  const foldedFingers = [fingers.index, fingers.middle, fingers.ring, fingers.pinky].filter((isExtended) => !isExtended).length;
  const palmWidth = Math.max(0.001, distance(landmarks[INDEX.mcp], landmarks[PINKY.mcp]));
  const palmScale = Math.max(0.001, distance(landmarks[WRIST], landmarks[MIDDLE.mcp]));
  const pinchDistance = distance2d(landmarks[THUMB.tip], landmarks[INDEX.tip]);
  const indexReach = distance2d(landmarks[INDEX.mcp], landmarks[INDEX.tip]);
  const middleReach = distance2d(landmarks[MIDDLE.mcp], landmarks[MIDDLE.tip]);
  const pinchScale = Math.max(0.001, palmWidth * 0.58);
  const pinchGapRatio = pinchDistance / pinchScale;
  const pinchCloseness = clamp(1 - pinchGapRatio);
  const pinchIsClose = pinchGapRatio < 1;
  const indexIsAvailable = fingers.index || indexReach > palmScale * 0.28 || indexReach > middleReach * 0.58;
  const notTightFist = indexReach > palmScale * 0.22 || fingers.index || fingers.thumb;
  const pinchMetrics = {
    pinchCloseness,
    pinchGapRatio,
  };

  if (pinchIsClose && indexIsAvailable && notTightFist) {
    return createDetectedGesture(
      'pinch',
      baseConfidence * Math.max(0.72, pinchCloseness),
      handedness,
      fingers,
      `Thumb and index pinched (${Math.round(pinchCloseness * 100)}%)`,
      pinchMetrics,
    );
  }

  if (fingers.index && fingers.middle && fingers.ring && fingers.pinky && extendedCount >= 4) {
    return createDetectedGesture(
      'open_hand',
      baseConfidence * (fingers.thumb ? 1 : 0.84),
      handedness,
      fingers,
      'Four fingers extended',
      pinchMetrics,
    );
  }

  if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
    return createDetectedGesture(
      'peace',
      baseConfidence * (fingers.thumb ? 0.88 : 1),
      handedness,
      fingers,
      'Index and middle extended',
      pinchMetrics,
    );
  }

  if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return createDetectedGesture(
      'index',
      baseConfidence,
      handedness,
      fingers,
      'Index finger isolated',
      pinchMetrics,
    );
  }

  if (foldedFingers >= 4) {
    return createDetectedGesture(
      'fist',
      baseConfidence * (fingers.thumb ? 0.82 : 1),
      handedness,
      fingers,
      'Fingers folded',
      pinchMetrics,
    );
  }

  return createDetectedGesture('none', baseConfidence * 0.2, handedness, fingers, 'Gesture not mapped', pinchMetrics);
}

export function getIndexTipPoint(
  landmarks: NormalizedLandmark[] | null,
  width: number,
  height: number,
): ScreenPoint | null {
  if (!hasRequiredLandmarks(landmarks)) {
    return null;
  }

  const tip = landmarks[INDEX.tip];
  return {
    x: (1 - tip.x) * width,
    y: tip.y * height,
  };
}

export function getMirroredLandmarkPoint(
  landmark: NormalizedLandmark,
  width: number,
  height: number,
): ScreenPoint {
  return {
    x: (1 - landmark.x) * width,
    y: landmark.y * height,
  };
}

export const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
