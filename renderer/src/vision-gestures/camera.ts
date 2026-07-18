export interface VisionCameraSession {
  stream: MediaStream;
  label: string;
  deviceId: string;
  width: number;
  height: number;
  frameRate: number;
}

export interface VisionCameraDevice {
  deviceId: string;
  label: string;
}

export async function listVisionCameras(): Promise<VisionCameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));
}

export async function startVisionCamera(
  video: HTMLVideoElement,
  deviceId?: string,
): Promise<VisionCameraSession> {
  const videoConstraints: MediaTrackConstraints = deviceId
    ? {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      }
    : {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: 'user',
      };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints,
  });

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings?.() || {};
  return {
    stream,
    label: videoTrack?.label || 'Camera active',
    deviceId: settings.deviceId || deviceId || '',
    width: settings.width || video.videoWidth || 0,
    height: settings.height || video.videoHeight || 0,
    frameRate: settings.frameRate || 0,
  };
}

export function stopVisionCamera(session: VisionCameraSession | null): void {
  session?.stream.getTracks().forEach((track) => track.stop());
}
