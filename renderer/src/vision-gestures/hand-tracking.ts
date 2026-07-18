import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandTrackingFrame } from './types';

function rendererAssetUrl(relativePath: string): string {
  return new URL(relativePath, window.location.href).toString();
}

function resolveHandedness(result: HandLandmarkerResult): { label: string; confidence: number } {
  const category = result.handedness?.[0]?.[0] || result.handednesses?.[0]?.[0];
  return {
    label: category?.categoryName || 'Hand',
    confidence: typeof category?.score === 'number' ? category.score : 0,
  };
}

export interface HandTrackingController {
  detect: (video: HTMLVideoElement, timestampMs: number) => HandTrackingFrame;
  close: () => void;
}

export async function createHandTrackingController(): Promise<HandTrackingController> {
  const vision = await FilesetResolver.forVisionTasks(rendererAssetUrl('./mediapipe/wasm'));
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: rendererAssetUrl('./models/hand_landmarker.task'),
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.38,
    minHandPresenceConfidence: 0.38,
    minTrackingConfidence: 0.38,
  });

  return {
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      const handedness = resolveHandedness(result);
      return {
        landmarks: result.landmarks?.[0] || null,
        worldLandmarks: result.worldLandmarks?.[0] || null,
        handedness: handedness.label,
        confidence: handedness.confidence,
      };
    },
    close() {
      landmarker.close();
    },
  };
}
