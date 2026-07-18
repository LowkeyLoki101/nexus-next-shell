import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GestureActionRouter } from './vision-gestures/action-router';
import {
  listVisionCameras,
  startVisionCamera,
  stopVisionCamera,
  type VisionCameraDevice,
  type VisionCameraSession,
} from './vision-gestures/camera';
import { detectGesture, getIndexTipPoint } from './vision-gestures/gesture-detector';
import { GestureFilterEngine } from './vision-gestures/filter-engine';
import { createHandTrackingController, type HandTrackingController } from './vision-gestures/hand-tracking';
import { drawHandOverlay } from './vision-gestures/overlay';
import {
  applyNaturalLanguageMappingPrompt,
  clickScreenAtNormalizedPoint,
  createDefaultVisionGestureSettings,
  loadVisionGestureSettings,
  normalizeVisionGestureSettings,
  openAccessibilitySettings,
  saveVisionGestureSettings,
  setDesktopControlMode,
} from './vision-gestures/settings-config';
import {
  ACTION_IDS,
  ACTION_LABELS,
  FILTER_IDS,
  FILTER_LABELS,
  GESTURE_LABELS,
  RECOGNIZED_GESTURES,
  type ActionId,
  type DetectedGesture,
  type FilterId,
  type GestureActionEvent,
  type GestureId,
  type RecognizedGestureId,
  type ScreenPoint,
  type VisionGestureRuntimeState,
  type VisionGestureSettings,
} from './vision-gestures/types';
import './nexus-vision-gestures.css';

const EMPTY_GESTURE: DetectedGesture = {
  id: 'none',
  label: GESTURE_LABELS.none,
  confidence: 0,
  handedness: 'Hand',
  fingerStates: {
    thumb: false,
    index: false,
    middle: false,
    ring: false,
    pinky: false,
  },
  reason: 'Waiting for hand',
};

const INITIAL_RUNTIME: VisionGestureRuntimeState = {
  cameraStatus: 'booting',
  cameraLabel: 'Camera starting',
  fps: 0,
  confidence: 0,
  gesture: EMPTY_GESTURE,
  activeFilter: 'none',
  frameBrightness: 0,
};

interface StableGestureState {
  candidate: GestureId;
  count: number;
  active: GestureId;
}

interface FrameLightSample {
  brightness: number;
  maxChannel: number;
}

type InteractionTarget = 'grab' | 'click';

interface GestureInteractionState {
  pointerX: number;
  pointerY: number;
  hasPointer: boolean;
  pinchCloseness: number;
  pinching: boolean;
  hoverTarget: InteractionTarget | null;
  dragging: boolean;
  grabX: number;
  grabY: number;
  clickCount: number;
  clickPulse: number;
  lastAction: string;
}

interface ActiveGrabSession {
  active: boolean;
  offsetX: number;
  offsetY: number;
}

interface InteractionFrameResult {
  consumed: boolean;
}

const INITIAL_INTERACTION: GestureInteractionState = {
  pointerX: 0.5,
  pointerY: 0.5,
  hasPointer: false,
  pinchCloseness: 0,
  pinching: false,
  hoverTarget: null,
  dragging: false,
  grabX: 0.48,
  grabY: 0.47,
  clickCount: 0,
  clickPulse: 0,
  lastAction: 'Ready',
};

const GRAB_TARGET_RADIUS = 0.075;
const CLICK_TARGET = {
  x: 0.66,
  y: 0.47,
  width: 0.17,
  height: 0.105,
};

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInteractionX(value: number): number {
  return Math.max(0.14, Math.min(0.86, value));
}

function clampInteractionY(value: number): number {
  return Math.max(0.24, Math.min(0.72, value));
}

function getDistance(aX: number, aY: number, bX: number, bY: number): number {
  return Math.hypot(aX - bX, aY - bY);
}

function isPointInClickTarget(x: number, y: number): boolean {
  return Math.abs(x - CLICK_TARGET.x) <= CLICK_TARGET.width / 2
    && Math.abs(y - CLICK_TARGET.y) <= CLICK_TARGET.height / 2;
}

function createInteractionEvent(
  title: string,
  detail: string,
  action: ActionId,
): GestureActionEvent {
  return {
    id: `interaction-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    gesture: 'pinch',
    gestureLabel: GESTURE_LABELS.pinch,
    action,
    visual: 'spotlight',
    title,
    detail,
  };
}

function sampleVideoLight(
  video: HTMLVideoElement,
  sampleCanvas: HTMLCanvasElement,
): FrameLightSample {
  const width = 24;
  const height = 14;
  if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
    sampleCanvas.width = width;
    sampleCanvas.height = height;
  }

  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { brightness: 0, maxChannel: 0 };
  }

  ctx.drawImage(video, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  let total = 0;
  let maxChannel = 0;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    total += red * 0.2126 + green * 0.7152 + blue * 0.0722;
    maxChannel = Math.max(maxChannel, red, green, blue);
  }

  return {
    brightness: total / (data.length / 4),
    maxChannel,
  };
}

function stabilizeGesture(detected: DetectedGesture, stable: StableGestureState): GestureId {
  const confidenceFloor = detected.id === 'pinch' ? 0.24 : 0.32;
  const candidate = detected.confidence >= confidenceFloor ? detected.id : 'none';
  if (candidate === stable.candidate) {
    stable.count += 1;
  } else {
    stable.candidate = candidate;
    stable.count = 1;
  }

  const threshold = candidate === 'none' ? 2 : candidate === 'pinch' ? 2 : 3;
  if (stable.count >= threshold) {
    stable.active = candidate;
  }

  return stable.active;
}

function createSettingsEvent(message: string, settings: VisionGestureSettings): GestureActionEvent {
  const gesture = RECOGNIZED_GESTURES.find((id) => message.includes(id)) || 'index';
  const mapping = settings.mappings[gesture];
  return {
    id: `settings-${Date.now()}`,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    gesture,
    gestureLabel: GESTURE_LABELS[gesture],
    action: mapping.action,
    visual: mapping.visual,
    title: 'Mapping saved',
    detail: message,
  };
}

function updateGestureMapping(
  settings: VisionGestureSettings,
  gesture: RecognizedGestureId,
  patch: Partial<VisionGestureSettings['mappings'][RecognizedGestureId]>,
): VisionGestureSettings {
  return normalizeVisionGestureSettings({
    ...settings,
    mappings: {
      ...settings.mappings,
      [gesture]: {
        ...settings.mappings[gesture],
        ...patch,
      },
    },
    updatedAt: new Date().toISOString(),
  });
}

export default function NexusVisionGesturesApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<VisionCameraSession | null>(null);
  const trackerRef = useRef<HandTrackingController | null>(null);
  const filterEngineRef = useRef(new GestureFilterEngine());
  const actionRouterRef = useRef(new GestureActionRouter());
  const frameRef = useRef<number | null>(null);
  const stableGestureRef = useRef<StableGestureState>({ candidate: 'none', count: 0, active: 'none' });
  const settingsRef = useRef<VisionGestureSettings>(createDefaultVisionGestureSettings());
  const runtimeRef = useRef<VisionGestureRuntimeState>(INITIAL_RUNTIME);
  const lastUiUpdateRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const lastGestureRef = useRef<GestureId>('none');
  const lastFilterRef = useRef<FilterId>('none');
  const blankFrameSinceRef = useRef<number | null>(null);
  const lightSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedDeviceIdRef = useRef('');
  const screenClickArmedRef = useRef(false);
  const interactionRef = useRef<GestureInteractionState>(INITIAL_INTERACTION);
  const pinchHeldRef = useRef(false);
  const activeGrabRef = useRef<ActiveGrabSession>({ active: false, offsetX: 0, offsetY: 0 });
  const lastInteractionUiUpdateRef = useRef(0);
  const interactionConsumesPinchRef = useRef(false);

  const [runtime, setRuntime] = useState<VisionGestureRuntimeState>(INITIAL_RUNTIME);
  const [settings, setSettings] = useState<VisionGestureSettings>(() => createDefaultVisionGestureSettings());
  const [events, setEvents] = useState<GestureActionEvent[]>([]);
  const [interaction, setInteraction] = useState<GestureInteractionState>(INITIAL_INTERACTION);
  const [cameraDevices, setCameraDevices] = useState<VisionCameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cameraRestartNonce, setCameraRestartNonce] = useState(0);
  const [screenClickArmed, setScreenClickArmed] = useState(false);
  const [clickStatus, setClickStatus] = useState('Screen clicks off');
  const [codeMapStatus, setCodeMapStatus] = useState('Code graph not checked');
  const [codeMapBusy, setCodeMapBusy] = useState('');
  const [codeMapStats, setCodeMapStats] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('Default mappings loaded');

  const updateRuntime = useCallback((patch: Partial<VisionGestureRuntimeState>) => {
    runtimeRef.current = {
      ...runtimeRef.current,
      ...patch,
    };
    setRuntime(runtimeRef.current);
  }, []);

  const appendEvent = useCallback((event: GestureActionEvent) => {
    setEvents((current) => [event, ...current].slice(0, 10));
  }, []);

  const appendSystemEvent = useCallback((title: string, detail: string) => {
    appendEvent({
      id: `code-map-${Date.now()}`,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      gesture: 'open_hand',
      gestureLabel: 'Code Map',
      action: 'create_code_map',
      visual: 'spotlight',
      title,
      detail,
    });
  }, [appendEvent]);

  const refreshCodeMapStatus = useCallback(async () => {
    const api = (window as any).nexus?.understand;
    if (!api?.status) {
      setCodeMapStatus('Understand-Anything bridge unavailable');
      return null;
    }

    try {
      const status = await api.status();
      setCodeMapStats(status?.stats || null);
      setCodeMapStatus(status?.graphExists
        ? `${status.stats?.nodes || 0} nodes · ${status.stats?.edges || 0} edges`
        : 'No graph found');
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code graph status failed';
      setCodeMapStatus(message);
      return null;
    }
  }, []);

  const runCodeMapAction = useCallback(async (action: 'create_code_map' | 'ingest_code_knowledge', sourceEvent?: GestureActionEvent) => {
    const api = (window as any).nexus?.understand;
    if (!api) {
      setCodeMapStatus('Understand-Anything bridge unavailable');
      return;
    }

    setCodeMapBusy(action === 'create_code_map' ? 'Creating vision map' : 'Ingesting code KB');
    try {
      if (action === 'create_code_map') {
        const diagram = await api.createDiagram({ mode: 'vision', show: true });
        const message = `${diagram?.name || 'Vision code map'} created`;
        setCodeMapStatus(message);
        appendEvent({
          ...(sourceEvent || {
            id: `code-map-${Date.now()}`,
            at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            gesture: 'open_hand' as const,
            gestureLabel: 'Code Map',
            action,
            visual: 'spotlight' as const,
            title: 'Vision Code Map',
            detail: message,
          }),
          id: `${sourceEvent?.id || 'code-map'}-created-${Date.now()}`,
          title: 'Vision Code Map Created',
          detail: message,
        });
      } else {
        const result = await api.ingestKnowledge({});
        const message = result?.message || 'Code graph knowledge ingested';
        setCodeMapStatus(message);
        appendSystemEvent('Code Knowledge Ingested', message);
      }
      await refreshCodeMapStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code map action failed';
      setCodeMapStatus(message);
      appendSystemEvent('Code Map Failed', message);
    } finally {
      setCodeMapBusy('');
    }
  }, [appendEvent, appendSystemEvent, refreshCodeMapStatus]);

  const persistSettings = useCallback(async (nextSettings: VisionGestureSettings) => {
    const normalized = normalizeVisionGestureSettings(nextSettings);
    settingsRef.current = normalized;
    setSettings(normalized);
    try {
      await saveVisionGestureSettings(normalized);
      setSettingsStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      console.warn('[Nexus Vision Gestures] settings save failed', error);
      setSettingsStatus('Save failed');
    }
  }, []);

  const handleSystemClickEvent = useCallback((
    event: GestureActionEvent,
    point: { x: number; y: number } | null,
    width: number,
    height: number,
  ) => {
    if (!screenClickArmedRef.current) {
      appendEvent({
        ...event,
        id: `${event.id}-blocked`,
        title: `${event.gestureLabel} -> Screen Click Off`,
        detail: 'Screen Click Mode is not armed.',
      });
      setClickStatus('Screen clicks off');
      return;
    }

    if (!point) {
      appendEvent({
        ...event,
        id: `${event.id}-missing-point`,
        title: `${event.gestureLabel} -> No Target`,
        detail: 'No fingertip target is available.',
      });
      setClickStatus('No click target');
      return;
    }

    const normalizedX = Math.max(0, Math.min(1, point.x / Math.max(1, width)));
    const normalizedY = Math.max(0, Math.min(1, point.y / Math.max(1, height)));
    appendEvent({
      ...event,
      detail: `Click requested at ${Math.round(normalizedX * 100)}%, ${Math.round(normalizedY * 100)}%.`,
    });
    setClickStatus('Click requested');

    void clickScreenAtNormalizedPoint({ normalizedX, normalizedY })
      .then((result) => {
        const payload = result && typeof result === 'object' ? result as { ok?: boolean; x?: number; y?: number; message?: string } : {};
        const ok = payload.ok !== false;
        setClickStatus(ok ? 'Last click sent' : 'Click blocked');
        appendEvent({
          ...event,
          id: `${event.id}-result`,
          title: ok ? 'Screen Click Sent' : 'Screen Click Blocked',
          detail: payload.message || (ok ? 'Click sent.' : 'Click failed.'),
        });
      })
      .catch((error) => {
        setClickStatus('Click failed');
        appendEvent({
          ...event,
          id: `${event.id}-error`,
          title: 'Screen Click Failed',
          detail: error instanceof Error ? error.message : 'Click failed.',
        });
      });
  }, [appendEvent]);

  const commitInteractionState = useCallback((
    nextState: GestureInteractionState,
    timeMs: number,
    force = false,
  ) => {
    interactionRef.current = nextState;
    if (force || timeMs - lastInteractionUiUpdateRef.current > 42) {
      lastInteractionUiUpdateRef.current = timeMs;
      setInteraction(nextState);
    }
  }, []);

  const handleInteractionFrame = useCallback((
    pointer: ScreenPoint | null,
    detected: DetectedGesture,
    stableGestureId: GestureId,
    width: number,
    height: number,
    timeMs: number,
  ): InteractionFrameResult => {
    const current = interactionRef.current;
    const rawPinch = detected.metrics?.pinchCloseness ?? 0;
    const pinchCloseness = clampUnit(rawPinch);
    const wasPinching = pinchHeldRef.current;
    const isPinching = stableGestureId === 'pinch'
      || pinchCloseness >= 0.6
      || (wasPinching && pinchCloseness > 0.36);
    const justStarted = isPinching && !wasPinching;
    const justEnded = !isPinching && wasPinching;
    pinchHeldRef.current = isPinching;

    if (!pointer) {
      let nextNoPointer = {
        ...current,
        hasPointer: false,
        pinchCloseness,
        pinching: isPinching,
        hoverTarget: null,
      };
      if (activeGrabRef.current.active) {
        activeGrabRef.current = { active: false, offsetX: 0, offsetY: 0 };
        nextNoPointer = {
          ...nextNoPointer,
          dragging: false,
          lastAction: 'Released',
        };
        appendEvent(createInteractionEvent('Grab Released', 'Pointer tracking was lost, so the movable target was released.', 'select_object'));
      }
      interactionConsumesPinchRef.current = false;
      commitInteractionState(nextNoPointer, timeMs, justEnded);
      return { consumed: false };
    }

    const pointerX = clampUnit(pointer.x / Math.max(1, width));
    const pointerY = clampUnit(pointer.y / Math.max(1, height));
    const overGrabTarget = getDistance(pointerX, pointerY, current.grabX, current.grabY) <= GRAB_TARGET_RADIUS;
    const overClickTarget = isPointInClickTarget(pointerX, pointerY);
    const hoverTarget: InteractionTarget | null = overGrabTarget ? 'grab' : overClickTarget ? 'click' : null;
    let grabX = current.grabX;
    let grabY = current.grabY;
    let clickCount = current.clickCount;
    let clickPulse = current.clickPulse;
    let lastAction = current.lastAction;
    let consumed = false;

    if (justStarted && overGrabTarget) {
      activeGrabRef.current = {
        active: true,
        offsetX: current.grabX - pointerX,
        offsetY: current.grabY - pointerY,
      };
      lastAction = 'Grabbed';
      consumed = true;
      appendEvent(createInteractionEvent('Target Grabbed', 'The movable Nexus target is attached to your pinch.', 'select_object'));
    } else if (justStarted && overClickTarget) {
      clickCount += 1;
      clickPulse = timeMs;
      lastAction = `Clicked ${clickCount}`;
      consumed = true;
      appendEvent(createInteractionEvent('Click Target Pressed', `In-app click target count is now ${clickCount}.`, 'system_click'));
    }

    if (isPinching && activeGrabRef.current.active) {
      grabX = clampInteractionX(pointerX + activeGrabRef.current.offsetX);
      grabY = clampInteractionY(pointerY + activeGrabRef.current.offsetY);
      lastAction = 'Dragging';
      consumed = true;
    }

    if (justEnded && activeGrabRef.current.active) {
      activeGrabRef.current = { active: false, offsetX: 0, offsetY: 0 };
      lastAction = 'Dropped';
      consumed = true;
      appendEvent(createInteractionEvent('Target Dropped', 'The movable Nexus target was released at its new position.', 'select_object'));
    }

    const next = {
      ...current,
      pointerX,
      pointerY,
      hasPointer: true,
      pinchCloseness,
      pinching: isPinching,
      hoverTarget,
      dragging: activeGrabRef.current.active,
      grabX,
      grabY,
      clickCount,
      clickPulse,
      lastAction,
    };

    interactionConsumesPinchRef.current = isPinching && (consumed || activeGrabRef.current.active || hoverTarget !== null);
    commitInteractionState(next, timeMs, consumed || justEnded);
    return { consumed };
  }, [appendEvent, commitInteractionState]);

  const renderFrame = useCallback((timeMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const tracker = trackerRef.current;

    if (!video || !canvas || !tracker || video.readyState < 2) {
      frameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    const width = video.videoWidth || canvas.clientWidth || 1280;
    const height = video.videoHeight || canvas.clientHeight || 720;
    if (!lightSampleCanvasRef.current) {
      lightSampleCanvasRef.current = document.createElement('canvas');
    }
    const light = sampleVideoLight(video, lightSampleCanvasRef.current);
    const isBlankFrame = light.maxChannel < 12 && light.brightness < 4;
    if (isBlankFrame) {
      blankFrameSinceRef.current = blankFrameSinceRef.current ?? timeMs;
    } else {
      blankFrameSinceRef.current = null;
    }
    const blankForMs = blankFrameSinceRef.current ? timeMs - blankFrameSinceRef.current : 0;
    const cameraLooksBlank = blankForMs > 1800;
    const tracking = tracker.detect(video, timeMs);
    const detected = detectGesture(tracking.landmarks, tracking.confidence, tracking.handedness);
    const stableGestureId = stabilizeGesture(detected, stableGestureRef.current);
    const mapping = stableGestureId !== 'none'
      ? settingsRef.current.mappings[stableGestureId as RecognizedGestureId]
      : null;
    const activeFilter = mapping?.visual || 'none';
    const pointer = getIndexTipPoint(tracking.landmarks, width, height);
    const pinchCloseness = detected.metrics?.pinchCloseness ?? 0;

    filterEngineRef.current.render({
      video,
      canvas,
      filter: activeFilter,
      pointer,
      timeMs,
    });

    const overlayContext = canvas.getContext('2d');
    if (overlayContext) {
      drawHandOverlay(overlayContext, tracking.landmarks, pointer, canvas.width, canvas.height, pinchCloseness);
    }

    const interactionResult = handleInteractionFrame(
      pointer,
      detected,
      stableGestureId,
      canvas.width || width,
      canvas.height || height,
      timeMs,
    );
    const inAppInteractionActive = interactionResult.consumed || interactionConsumesPinchRef.current;

    const elapsed = lastFrameTimeRef.current > 0 ? timeMs - lastFrameTimeRef.current : 33;
    lastFrameTimeRef.current = timeMs;
    const fps = Math.round(1000 / Math.max(1, elapsed));

    if (stableGestureId !== 'none' && mapping) {
      const event = actionRouterRef.current.route({
        gesture: stableGestureId as RecognizedGestureId,
        mapping,
        point: pointer,
        confidence: detected.confidence,
        nowMs: timeMs,
      });
        if (event) {
          if (event.action === 'system_click') {
            if (!inAppInteractionActive) {
              handleSystemClickEvent(event, pointer, canvas.width || width, canvas.height || height);
            }
          } else if (event.action === 'create_code_map' || event.action === 'ingest_code_knowledge') {
            appendEvent(event);
            void runCodeMapAction(event.action, event);
          } else {
            appendEvent(event);
          }
        }
    } else if (stableGestureId === 'none') {
      actionRouterRef.current.reset();
    }

    const shouldUpdateUi = timeMs - lastUiUpdateRef.current > 120
      || lastGestureRef.current !== stableGestureId
      || lastFilterRef.current !== activeFilter;

    if (shouldUpdateUi) {
      const gestureForUi = stableGestureId === detected.id
        ? detected
        : {
            ...detected,
            id: stableGestureId,
            label: GESTURE_LABELS[stableGestureId],
            reason: stableGestureId === 'none' ? detected.reason : 'Gesture locked',
          };
      lastUiUpdateRef.current = timeMs;
      lastGestureRef.current = stableGestureId;
      lastFilterRef.current = activeFilter;
      updateRuntime({
        cameraStatus: cameraLooksBlank ? 'blank' : 'tracking',
        fps,
        confidence: tracking.confidence,
        gesture: gestureForUi,
        activeFilter,
        frameBrightness: light.brightness,
      });
    }

    frameRef.current = requestAnimationFrame(renderFrame);
  }, [appendEvent, handleInteractionFrame, handleSystemClickEvent, runCodeMapAction, updateRuntime]);

  useEffect(() => {
    let disposed = false;

    loadVisionGestureSettings().then((loaded) => {
      if (disposed) return;
      settingsRef.current = loaded;
      setSettings(loaded);
      setSettingsStatus('Mappings ready');
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    void refreshCodeMapStatus();
  }, [refreshCodeMapStatus]);

  useEffect(() => {
    let disposed = false;

    async function refreshCameraDevices() {
      try {
        const devices = await listVisionCameras();
        if (!disposed) {
          setCameraDevices(devices);
        }
      } catch (error) {
        console.warn('[Nexus Vision Gestures] camera list failed', error);
      }
    }

    async function boot() {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      try {
        updateRuntime({
          cameraStatus: 'starting',
          cameraLabel: 'Opening camera',
        });
        const camera = await startVisionCamera(video, selectedDeviceIdRef.current || undefined);
        if (disposed) {
          stopVisionCamera(camera);
          return;
        }
        cameraRef.current = camera;
        if (camera.deviceId && selectedDeviceIdRef.current !== camera.deviceId) {
          selectedDeviceIdRef.current = camera.deviceId;
          setSelectedDeviceId(camera.deviceId);
        }
        void refreshCameraDevices();
        updateRuntime({
          cameraStatus: 'starting',
          cameraLabel: `${camera.label}${camera.width && camera.height ? ` (${camera.width}x${camera.height})` : ''}`,
        });

        const tracker = await createHandTrackingController();
        if (disposed) {
          tracker.close();
          return;
        }
        trackerRef.current = tracker;
        updateRuntime({
          cameraStatus: 'tracking',
          cameraLabel: `${camera.label}${camera.width && camera.height ? ` (${camera.width}x${camera.height})` : ''}`,
        });
        frameRef.current = requestAnimationFrame(renderFrame);
      } catch (error) {
        console.error('[Nexus Vision Gestures] startup failed', error);
        updateRuntime({
          cameraStatus: 'error',
          cameraLabel: error instanceof Error ? error.message : 'Camera unavailable',
          gesture: {
            ...EMPTY_GESTURE,
            reason: 'Camera or hand model failed',
          },
        });
      }
    }

    void boot();

    return () => {
      disposed = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      trackerRef.current?.close();
      trackerRef.current = null;
      stopVisionCamera(cameraRef.current);
      cameraRef.current = null;
      filterEngineRef.current.dispose();
    };
  }, [cameraRestartNonce, renderFrame, updateRuntime]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    screenClickArmedRef.current = screenClickArmed;
    setClickStatus(screenClickArmed ? 'Screen clicks armed' : 'Screen clicks off');
    void setDesktopControlMode(screenClickArmed).catch((error) => {
      console.warn('[Nexus Vision Gestures] desktop control mode failed', error);
      setClickStatus('Desktop mode failed');
    });
  }, [screenClickArmed]);

  useEffect(() => () => {
    void setDesktopControlMode(false);
  }, []);

  const activeMapping = runtime.gesture.id !== 'none'
    ? settings.mappings[runtime.gesture.id as RecognizedGestureId]
    : null;

  const statusRows = useMemo(() => [
    ['FPS', runtime.fps > 0 ? String(runtime.fps) : '--'],
    ['Hand', formatPercent(runtime.confidence)],
    ['Pinch', runtime.gesture.metrics?.pinchCloseness !== undefined ? formatPercent(runtime.gesture.metrics.pinchCloseness) : '--'],
    ['Target', interaction.dragging ? 'Grabbed' : interaction.hoverTarget === 'grab' ? 'Move' : interaction.hoverTarget === 'click' ? 'Click' : interaction.lastAction],
    ['Mode', FILTER_LABELS[runtime.activeFilter]],
    ['Camera', runtime.cameraStatus === 'error' ? 'Error' : runtime.cameraStatus === 'blank' ? 'Blank' : runtime.cameraStatus === 'tracking' ? 'Live' : 'Starting'],
    ['Click', screenClickArmed ? 'Armed' : 'Off'],
    ['Last', clickStatus],
    ['Code', codeMapBusy || `${codeMapStats?.nodes || 0} nodes`],
  ], [clickStatus, codeMapBusy, codeMapStats?.nodes, interaction.dragging, interaction.hoverTarget, interaction.lastAction, runtime.activeFilter, runtime.cameraStatus, runtime.confidence, runtime.fps, runtime.gesture.metrics?.pinchCloseness, screenClickArmed]);

  const restartCamera = useCallback(() => {
    blankFrameSinceRef.current = null;
    stableGestureRef.current = { candidate: 'none', count: 0, active: 'none' };
    updateRuntime({
      cameraStatus: 'starting',
      cameraLabel: 'Restarting camera',
      gesture: EMPTY_GESTURE,
      confidence: 0,
      frameBrightness: 0,
    });
    setCameraRestartNonce((value) => value + 1);
  }, [updateRuntime]);

  const handleCameraSelect = useCallback((deviceId: string) => {
    selectedDeviceIdRef.current = deviceId;
    setSelectedDeviceId(deviceId);
    restartCamera();
  }, [restartCamera]);

  const handleMappingChange = useCallback((
    gesture: RecognizedGestureId,
    field: 'visual' | 'action',
    value: string,
  ) => {
    const next = updateGestureMapping(settingsRef.current, gesture, { [field]: value });
    void persistSettings(next);
  }, [persistSettings]);

  const handlePromptSubmit = useCallback(() => {
    const result = applyNaturalLanguageMappingPrompt(settingsRef.current, promptText);
    void persistSettings(result.settings);
    appendEvent(createSettingsEvent(result.message, result.settings));
    setPromptText('');
  }, [appendEvent, persistSettings, promptText]);

  const handleResetSettings = useCallback(() => {
    const defaults = createDefaultVisionGestureSettings();
    void persistSettings(defaults);
    appendEvent(createSettingsEvent('Default gesture mappings restored.', defaults));
  }, [appendEvent, persistSettings]);

  const cursorSize = Math.max(14, 58 - interaction.pinchCloseness * 42);

  return (
    <main className={`vision-gestures-app gesture-${runtime.gesture.id}`}>
      <video ref={videoRef} className="vision-hidden-video" muted playsInline />
      <canvas ref={canvasRef} className="vision-canvas" />

      <div className="vision-detection-frame" aria-hidden="true" />

      <div className="vision-interaction-layer" aria-hidden="true">
        <div
          className={[
            'vision-precision-cursor',
            interaction.hasPointer ? 'visible' : '',
            interaction.pinching ? 'pinching' : '',
            interaction.hoverTarget ? 'hovering' : '',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${interaction.pointerX * 100}%`,
            top: `${interaction.pointerY * 100}%`,
            width: cursorSize,
            height: cursorSize,
          }}
        />

        <div
          className={[
            'vision-test-object',
            interaction.hoverTarget === 'grab' ? 'hovered' : '',
            interaction.dragging ? 'dragging' : '',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${interaction.grabX * 100}%`,
            top: `${interaction.grabY * 100}%`,
          }}
        >
          <span>Move Node</span>
          <strong>{interaction.dragging ? 'Grabbed' : 'Nexus Target'}</strong>
        </div>

        <div
          className={[
            'vision-click-target',
            interaction.hoverTarget === 'click' ? 'hovered' : '',
            interaction.pinching && interaction.hoverTarget === 'click' ? 'pressed' : '',
            interaction.clickPulse > 0 ? 'clicked' : '',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${CLICK_TARGET.x * 100}%`,
            top: `${CLICK_TARGET.y * 100}%`,
          }}
        >
          <span>Click Target</span>
          <strong>{interaction.clickCount}</strong>
        </div>
      </div>

      {runtime.cameraStatus === 'blank' || runtime.cameraStatus === 'error' ? (
        <section className="vision-camera-warning" aria-label="Camera warning">
          <span className="vision-kicker">{runtime.cameraStatus === 'error' ? 'Camera Error' : 'Blank Camera Feed'}</span>
          <strong>{runtime.cameraStatus === 'error' ? 'Camera needs attention' : 'Camera is live, but frames are black'}</strong>
          <p>{runtime.cameraStatus === 'error' ? runtime.cameraLabel : 'Pick another camera, restart the stream, or check the camera privacy indicator/shutter.'}</p>
          <div className="vision-camera-actions">
            <button type="button" onClick={restartCamera}>Restart Camera</button>
            <button type="button" onClick={() => setSettingsOpen(true)}>Camera Settings</button>
          </div>
        </section>
      ) : null}

      <section className="vision-hud vision-hud-primary" aria-label="Nexus Vision status">
        <div className="vision-brand-row">
          <span className="vision-live-dot" />
          <span>Nexus Vision Gestures</span>
        </div>
        <div className="vision-status-grid">
          {statusRows.map(([label, value]) => (
            <div key={label} className="vision-status-row">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="vision-camera-detail">{runtime.cameraLabel}</div>
      </section>

      <section className="vision-gesture-card" aria-label="Active gesture">
        <span className="vision-kicker">Gesture</span>
        <strong>{runtime.gesture.label}</strong>
        <span>{runtime.gesture.reason}</span>
        {activeMapping ? (
          <div className="vision-mapping-pill">
            <span>{FILTER_LABELS[activeMapping.visual]}</span>
            <span>{ACTION_LABELS[activeMapping.action]}</span>
          </div>
        ) : null}
      </section>

      <button
        type="button"
        className="vision-settings-toggle"
        onClick={() => setSettingsOpen((open) => !open)}
        aria-pressed={settingsOpen}
      >
        Settings
      </button>

      <section className="vision-event-log" aria-label="Gesture action log">
        <div className="vision-log-header">
          <span>Action Log</span>
          <strong>{events.length ? events[0].at : '--'}</strong>
        </div>
        <div className="vision-log-list">
          {events.length === 0 ? (
            <div className="vision-log-empty">Waiting for gesture action</div>
          ) : events.map((event) => (
            <article key={event.id} className="vision-log-item">
              <div>
                <strong>{event.title}</strong>
                <span>{event.detail}</span>
              </div>
              <small>{event.at}</small>
            </article>
          ))}
        </div>
      </section>

      <aside className={`vision-settings-panel ${settingsOpen ? 'open' : ''}`} aria-label="Gesture settings">
        <div className="vision-panel-header">
          <div>
            <span className="vision-kicker">Router</span>
            <strong>Gesture Mapping</strong>
          </div>
          <button type="button" onClick={() => setSettingsOpen(false)}>Close</button>
        </div>

        <div className="vision-mapping-list">
          <div className="vision-mapping-row">
            <strong>Code Map</strong>
            <span className="vision-code-map-status">{codeMapBusy || codeMapStatus}</span>
            <button type="button" onClick={() => { void runCodeMapAction('create_code_map'); }} disabled={Boolean(codeMapBusy)}>
              Vision Map
            </button>
            <button type="button" onClick={() => { void runCodeMapAction('ingest_code_knowledge'); }} disabled={Boolean(codeMapBusy)}>
              Ingest KB
            </button>
          </div>

          <div className="vision-mapping-row vision-click-mode-row">
            <strong>Screen Click Mode</strong>
            <label className="vision-switch-row">
              <input
                type="checkbox"
                checked={screenClickArmed}
                onChange={(event) => setScreenClickArmed(event.currentTarget.checked)}
              />
              <span>{screenClickArmed ? 'Armed' : 'Off'}</span>
            </label>
            <button type="button" onClick={() => void openAccessibilitySettings()}>Accessibility</button>
          </div>

          <div className="vision-mapping-row">
            <strong>Camera Source</strong>
            <select
              aria-label="Camera source"
              value={selectedDeviceId}
              onChange={(event) => handleCameraSelect(event.currentTarget.value)}
            >
              <option value="">Default Camera</option>
              {cameraDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={restartCamera}>Restart Camera</button>
          </div>

          {RECOGNIZED_GESTURES.map((gesture) => (
            <div key={gesture} className="vision-mapping-row">
              <strong>{GESTURE_LABELS[gesture]}</strong>
              <select
                aria-label={`${GESTURE_LABELS[gesture]} visual`}
                value={settings.mappings[gesture].visual}
                onChange={(event) => handleMappingChange(gesture, 'visual', event.currentTarget.value)}
              >
                {FILTER_IDS.map((filter) => (
                  <option key={filter} value={filter}>{FILTER_LABELS[filter]}</option>
                ))}
              </select>
              <select
                aria-label={`${GESTURE_LABELS[gesture]} action`}
                value={settings.mappings[gesture].action}
                onChange={(event) => handleMappingChange(gesture, 'action', event.currentTarget.value)}
              >
                {ACTION_IDS.map((action) => (
                  <option key={action} value={action}>{ACTION_LABELS[action]}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <label className="vision-prompt-box">
          <span>Natural Mapping</span>
          <textarea
            value={promptText}
            onChange={(event) => setPromptText(event.currentTarget.value)}
            placeholder="Open palm should wake Nexus with water ripple"
            rows={4}
          />
        </label>

        <div className="vision-panel-actions">
          <button type="button" onClick={handlePromptSubmit}>Apply Prompt</button>
          <button type="button" onClick={handleResetSettings}>Reset</button>
        </div>

        <div className="vision-settings-status">{settingsStatus}</div>
      </aside>
    </main>
  );
}
