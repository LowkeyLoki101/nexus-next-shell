import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  type Classifications,
  type FaceLandmarkerResult,
  type Matrix,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import './eye-contact.css';

type TrackingState = 'booting' | 'ready' | 'tracking' | 'looking' | 'not-looking' | 'error';

interface CalibrationBias {
  leftX: number;
  rightX: number;
  leftY: number;
  rightY: number;
  yaw: number;
  pitch: number;
}

interface EyeRatios {
  x: number;
  y: number;
  center: { x: number; y: number };
}

interface GazeMetrics {
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

interface GazeAssessment {
  looking: boolean;
  label: string;
  reason: string;
  metrics: GazeMetrics;
}

const DEFAULT_METRICS: GazeMetrics = {
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

function rendererAssetUrl(relativePath: string): string {
  return new URL(relativePath, window.location.href).toString();
}

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

function assessGaze(
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
        ...DEFAULT_METRICS,
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

function drawOverlay(
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

export default function EyeContactApp(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const previousScoreRef = useRef(0);
  const lastAssessmentRef = useRef<GazeAssessment | null>(null);
  const calibrationRef = useRef<CalibrationBias | null>(null);
  const strictnessRef = useRef(0.52);
  const isStartingRef = useRef(false);

  const [trackingState, setTrackingState] = useState<TrackingState>('booting');
  const [assessment, setAssessment] = useState<GazeAssessment>({
    looking: false,
    label: 'Starting',
    reason: 'Loading model',
    metrics: DEFAULT_METRICS,
  });
  const [strictness, setStrictness] = useState(0.52);
  const [cameraLabel, setCameraLabel] = useState('Camera');
  const [calibrationLabel, setCalibrationLabel] = useState('Default center');

  const scorePercent = Math.round(assessment.metrics.smoothedScore * 100);
  const indicatorClass = assessment.looking ? 'is-looking' : 'is-not-looking';

  const stopTracking = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTrackingState('ready');
    setAssessment((current) => ({
      ...current,
      looking: false,
      label: 'Stopped',
      reason: 'Camera stopped',
      metrics: {
        ...current.metrics,
        smoothedScore: 0,
      },
    }));
    previousScoreRef.current = 0;
  }, []);

  const runFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      frameRef.current = requestAnimationFrame(runFrame);
      return;
    }

    const result = landmarker.detectForVideo(video, performance.now());
    const nextAssessment = assessGaze(result, previousScoreRef.current, strictnessRef.current, calibrationRef.current);
    previousScoreRef.current = nextAssessment.metrics.smoothedScore;
    lastAssessmentRef.current = nextAssessment;
    setAssessment(nextAssessment);
    setTrackingState(nextAssessment.looking ? 'looking' : 'not-looking');
    drawOverlay(canvas, video, result.faceLandmarks[0], nextAssessment.looking);
    frameRef.current = requestAnimationFrame(runFrame);
  }, []);

  const startTracking = useCallback(async () => {
    if (isStartingRef.current) {
      return;
    }

    isStartingRef.current = true;
    setTrackingState('booting');
    setAssessment((current) => ({
      ...current,
      label: 'Starting',
      reason: landmarkerRef.current ? 'Opening camera' : 'Loading model',
    }));

    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(rendererAssetUrl('./mediapipe/wasm'));
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: rendererAssetUrl('./models/face_landmarker.task'),
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.55,
          minFacePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element is not ready.');
      }

      video.srcObject = stream;
      await video.play();
      const videoTrack = stream.getVideoTracks()[0];
      setCameraLabel(videoTrack?.label || 'Camera active');
      setTrackingState('tracking');
      frameRef.current = requestAnimationFrame(runFrame);
    } catch (error) {
      stopTracking();
      setTrackingState('error');
      setAssessment({
        looking: false,
        label: 'Camera error',
        reason: error instanceof Error ? error.message : 'Unable to start camera',
        metrics: DEFAULT_METRICS,
      });
    } finally {
      isStartingRef.current = false;
    }
  }, [runFrame, stopTracking]);

  const calibrate = useCallback(() => {
    const current = lastAssessmentRef.current;
    if (!current?.metrics.hasIris) {
      setCalibrationLabel('No eyes locked');
      return;
    }

    calibrationRef.current = {
      leftX: current.metrics.leftX - 0.5,
      rightX: current.metrics.rightX - 0.5,
      leftY: current.metrics.leftY - 0.5,
      rightY: current.metrics.rightY - 0.5,
      yaw: current.metrics.yaw,
      pitch: current.metrics.pitch,
    };
    setCalibrationLabel('Calibrated');
  }, []);

  const resetCalibration = useCallback(() => {
    calibrationRef.current = null;
    setCalibrationLabel('Default center');
  }, []);

  useEffect(() => {
    void startTracking();

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [startTracking]);

  useEffect(() => {
    strictnessRef.current = strictness;
  }, [strictness]);

  const detailRows = useMemo(() => [
    ['Score', `${scorePercent}%`],
    ['Head', `${assessment.metrics.yaw.toFixed(0)} yaw / ${assessment.metrics.pitch.toFixed(0)} pitch`],
    ['Eyes', assessment.metrics.hasIris ? 'Locked' : 'Searching'],
    ['Camera', cameraLabel],
  ], [assessment.metrics.hasIris, assessment.metrics.pitch, assessment.metrics.yaw, cameraLabel, scorePercent]);

  return (
    <main className={`eye-contact-app ${indicatorClass}`}>
      <section className="eye-contact-stage" aria-label="Eye contact camera preview">
        <video ref={videoRef} className="eye-video-layer" playsInline muted />
        <canvas ref={canvasRef} className="eye-video-layer eye-overlay" />
        <div className="eye-stage-shade" />
        <div className="eye-indicator-wrap">
          <div className="eye-indicator" aria-hidden="true">
            <span />
          </div>
          <div className="eye-status">
            <strong>{assessment.label}</strong>
            <span>{assessment.reason}</span>
          </div>
        </div>
      </section>

      <aside className="eye-control-panel" aria-label="Eye contact controls">
        <div className="eye-control-header">
          <span className="eye-mode-kicker">Eye Contact</span>
          <strong>{trackingState === 'error' ? 'Needs Camera' : 'Live Monitor'}</strong>
        </div>

        <div className="eye-score-block">
          <div className="eye-score-meter">
            <span style={{ width: `${scorePercent}%` }} />
          </div>
          <div className="eye-score-line">
            <span>Confidence</span>
            <strong>{scorePercent}%</strong>
          </div>
        </div>

        <div className="eye-detail-grid">
          {detailRows.map(([label, value]) => (
            <div key={label} className="eye-detail-row">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <label className="eye-slider">
          <span>Sensitivity</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(strictness * 100)}
            onChange={(event) => setStrictness(Number(event.currentTarget.value) / 100)}
          />
        </label>

        <div className="eye-actions">
          <button type="button" onClick={startTracking} disabled={trackingState === 'booting' || trackingState === 'tracking' || trackingState === 'looking' || trackingState === 'not-looking'}>
            Start
          </button>
          <button type="button" onClick={stopTracking} disabled={trackingState === 'ready' || trackingState === 'booting'}>
            Stop
          </button>
        </div>

        <div className="eye-actions">
          <button type="button" onClick={calibrate}>
            Calibrate
          </button>
          <button type="button" onClick={resetCalibration}>
            Reset
          </button>
        </div>

        <div className="eye-calibration-state">{calibrationLabel}</div>
      </aside>
    </main>
  );
}
