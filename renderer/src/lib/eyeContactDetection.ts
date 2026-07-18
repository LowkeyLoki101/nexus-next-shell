import type {
  Classifications,
  FaceLandmarkerResult,
  Matrix,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';

export interface CalibrationBias {
  leftX: number;
  rightX: number;
  leftY: number;
  rightY: number;
  yaw: number;
  pitch: number;
}

export interface GazeMetrics {
  hasIris: boolean;
  leftX: number;
  rightX: number;
  leftY: number;
  rightY: number;
  yaw: number;
  pitch: number;
  faceCenterOffset: number;
  eyeLookAway: number;
  rawScore: number;
  smoothedScore: number;
}

export interface GazeAssessment {
  looking: boolean;
  label: string;
  reason: string;
  metrics: GazeMetrics;
}

interface EyeRatios {
  x: number;
  y: number;
  center: { x: number; y: number };
}

export const DEFAULT_GAZE_METRICS: GazeMetrics = {
  hasIris: false,
  leftX: 0.5,
  rightX: 0.5,
  leftY: 0.5,
  rightY: 0.5,
  yaw: 0,
  pitch: 0,
  faceCenterOffset: 1,
  eyeLookAway: 0,
  rawScore: 0,
  smoothedScore: 0,
};

const LEFT_EYE = {
  corners: [33, 133],
  top: 159,
  bottom: 145,
  iris: [468, 469, 470, 471],
};

const RIGHT_EYE = {
  corners: [362, 263],
  top: 386,
  bottom: 374,
  iris: [473, 474, 475, 476],
};

const RAD_TO_DEG = 180 / Math.PI;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function averageLandmarks(landmarks: NormalizedLandmark[], indexes: number[]): { x: number; y: number } | null {
  const points = indexes.map((index) => landmarks[index]).filter(Boolean);
  if (points.length === 0) {
    return null;
  }

  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function getEyeRatios(
  landmarks: NormalizedLandmark[],
  eye: typeof LEFT_EYE,
): EyeRatios | null {
  const cornerA = landmarks[eye.corners[0]];
  const cornerB = landmarks[eye.corners[1]];
  const top = landmarks[eye.top];
  const bottom = landmarks[eye.bottom];
  const irisCenter = averageLandmarks(landmarks, eye.iris);

  if (!cornerA || !cornerB || !top || !bottom || !irisCenter) {
    return null;
  }

  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(top.y, bottom.y);
  const maxY = Math.max(top.y, bottom.y);
  const width = Math.max(0.0001, maxX - minX);
  const height = Math.max(0.0001, maxY - minY);

  return {
    x: clamp((irisCenter.x - minX) / width),
    y: clamp((irisCenter.y - minY) / height),
    center: irisCenter,
  };
}

function matrixToAngles(matrix: Matrix | undefined): { yaw: number; pitch: number } {
  const data = matrix?.data;
  if (!data || data.length < 11) {
    return { yaw: 0, pitch: 0 };
  }

  const yaw = Math.atan2(data[2], data[0]) * RAD_TO_DEG;
  const pitch = Math.atan2(-data[6], Math.sqrt((data[7] * data[7]) + (data[8] * data[8]))) * RAD_TO_DEG;
  return {
    yaw: Number.isFinite(yaw) ? yaw : 0,
    pitch: Number.isFinite(pitch) ? pitch : 0,
  };
}

function categoryScore(blendshapes: Classifications[] | undefined, name: string): number {
  const categories = blendshapes?.[0]?.categories ?? [];
  return categories.find((category) => category.categoryName === name)?.score ?? 0;
}

function centeredScore(value: number, target: number, tolerance: number): number {
  return clamp(1 - Math.abs(value - target) / Math.max(0.001, tolerance));
}

function limitScore(value: number, limit: number): number {
  return clamp(1 - Math.abs(value) / Math.max(0.001, limit));
}

export function assessGaze(
  result: FaceLandmarkerResult,
  previousScore: number,
  strictness: number,
  calibration: CalibrationBias | null,
): GazeAssessment {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks) {
    return {
      looking: false,
      label: 'No face',
      reason: 'No face in frame',
      metrics: {
        ...DEFAULT_GAZE_METRICS,
        smoothedScore: previousScore * 0.72,
      },
    };
  }

  const leftEye = getEyeRatios(landmarks, LEFT_EYE);
  const rightEye = getEyeRatios(landmarks, RIGHT_EYE);
  const hasIris = Boolean(leftEye && rightEye);
  const angles = matrixToAngles(result.facialTransformationMatrixes?.[0]);
  const leftX = leftEye?.x ?? 0.5;
  const rightX = rightEye?.x ?? 0.5;
  const leftY = leftEye?.y ?? 0.5;
  const rightY = rightEye?.y ?? 0.5;
  const expectedLeftX = clamp(0.5 + (calibration?.leftX ?? 0), 0.2, 0.8);
  const expectedRightX = clamp(0.5 + (calibration?.rightX ?? 0), 0.2, 0.8);
  const expectedLeftY = clamp(0.5 + (calibration?.leftY ?? 0), 0.2, 0.8);
  const expectedRightY = clamp(0.5 + (calibration?.rightY ?? 0), 0.2, 0.8);
  const yaw = angles.yaw - (calibration?.yaw ?? 0);
  const pitch = angles.pitch - (calibration?.pitch ?? 0);
  const gazeTolerance = 0.28 - strictness * 0.11;
  const verticalTolerance = 0.34 - strictness * 0.12;
  const yawLimit = 24 - strictness * 10;
  const pitchLimit = 22 - strictness * 8;
  const nose = landmarks[1] ?? landmarks[4] ?? landmarks[0];
  const faceCenterOffset = nose
    ? Math.hypot(nose.x - 0.5, (nose.y - 0.5) * 0.75)
    : 1;
  const faceCenterScore = clamp(1 - faceCenterOffset / 0.34);
  const eyeLookAway = Math.max(
    categoryScore(result.faceBlendshapes, 'eyeLookInLeft'),
    categoryScore(result.faceBlendshapes, 'eyeLookOutLeft'),
    categoryScore(result.faceBlendshapes, 'eyeLookInRight'),
    categoryScore(result.faceBlendshapes, 'eyeLookOutRight'),
    categoryScore(result.faceBlendshapes, 'eyeLookUpLeft'),
    categoryScore(result.faceBlendshapes, 'eyeLookUpRight'),
    categoryScore(result.faceBlendshapes, 'eyeLookDownLeft'),
    categoryScore(result.faceBlendshapes, 'eyeLookDownRight'),
  );
  const blendshapeScore = clamp(1 - eyeLookAway / 0.42);
  const eyeScore = hasIris
    ? (
        centeredScore(leftX, expectedLeftX, gazeTolerance)
        + centeredScore(rightX, expectedRightX, gazeTolerance)
        + centeredScore(leftY, expectedLeftY, verticalTolerance) * 0.65
        + centeredScore(rightY, expectedRightY, verticalTolerance) * 0.65
      ) / 3.3
    : 0.55;
  const headScore = (limitScore(yaw, yawLimit) + limitScore(pitch, pitchLimit)) / 2;
  const rawScore = clamp((eyeScore * 0.52) + (headScore * 0.32) + (faceCenterScore * 0.10) + (blendshapeScore * 0.06));
  const smoothedScore = (previousScore * 0.68) + (rawScore * 0.32);
  const threshold = 0.62 + strictness * 0.12;
  const looking = hasIris && smoothedScore >= threshold;

  let reason = 'Eye contact';
  if (!hasIris) {
    reason = 'Eyes not clear';
  } else if (headScore < 0.46) {
    reason = 'Head turned';
  } else if (eyeScore < 0.48) {
    reason = 'Eyes off camera';
  } else if (faceCenterScore < 0.24) {
    reason = 'Face off center';
  } else if (!looking) {
    reason = 'Almost centered';
  }

  return {
    looking,
    label: looking ? 'Looking' : 'Not looking',
    reason,
    metrics: {
      hasIris,
      leftX,
      rightX,
      leftY,
      rightY,
      yaw,
      pitch,
      faceCenterOffset,
      eyeLookAway,
      rawScore,
      smoothedScore,
    },
  };
}

export function drawGazeOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[] | undefined,
  looking: boolean,
): void {
  if (canvas.width !== video.videoWidth) {
    canvas.width = video.videoWidth;
  }
  if (canvas.height !== video.videoHeight) {
    canvas.height = video.videoHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) {
    return;
  }

  const stroke = looking ? '#29d46f' : '#ff4545';
  const leftEye = getEyeRatios(landmarks, LEFT_EYE);
  const rightEye = getEyeRatios(landmarks, RIGHT_EYE);
  const points = [leftEye?.center, rightEye?.center].filter(Boolean) as Array<{ x: number; y: number }>;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = Math.max(2, canvas.width / 420);

  for (const point of points) {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(4, canvas.width / 170), 0, Math.PI * 2);
    ctx.fill();
  }

  const nose = landmarks[1] ?? landmarks[4];
  if (nose) {
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.arc(nose.x * canvas.width, nose.y * canvas.height, Math.max(5, canvas.width / 145), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
