import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { getMirroredLandmarkPoint, HAND_CONNECTIONS } from './gesture-detector';
import type { ScreenPoint } from './types';

export function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[] | null,
  indexTip: ScreenPoint | null,
  width: number,
  height: number,
  pinchCloseness = 0,
): void {
  if (!landmarks || landmarks.length < 21) {
    return;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, width * 0.002);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';

  for (const [from, to] of HAND_CONNECTIONS) {
    const start = getMirroredLandmarkPoint(landmarks[from], width, height);
    const end = getMirroredLandmarkPoint(landmarks[to], width, height);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (const landmark of landmarks) {
    const point = getMirroredLandmarkPoint(landmark, width, height);
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2.2, width * 0.003), 0, Math.PI * 2);
    ctx.fill();
  }

  if (indexTip) {
    const precision = Math.max(0, Math.min(1, pinchCloseness));
    const dotRadius = Math.max(3, width * (0.008 - precision * 0.0045));
    const ringRadius = Math.max(8, width * (0.024 - precision * 0.016));

    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = precision > 0.55 ? '#ffe566' : '#ffffff';
    ctx.beginPath();
    ctx.arc(indexTip.x, indexTip.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = precision > 0.55 ? 'rgba(255, 229, 102, 0.92)' : 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(indexTip.x, indexTip.y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
