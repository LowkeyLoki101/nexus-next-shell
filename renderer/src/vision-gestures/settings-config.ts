import {
  ACTION_IDS,
  DEFAULT_MAPPINGS,
  FILTER_IDS,
  RECOGNIZED_GESTURES,
  type ActionId,
  type CustomGesturePrompt,
  type FilterId,
  type GestureMappings,
  type RecognizedGestureId,
  type VisionGestureSettings,
} from './types';

const SETTINGS_VERSION = 1;

interface VisionGesturesBridge {
  loadSettings?: () => Promise<unknown>;
  saveSettings?: (settings: VisionGestureSettings) => Promise<unknown>;
  revealSettings?: () => Promise<unknown>;
  clickScreen?: (point: { normalizedX: number; normalizedY: number }) => Promise<unknown>;
  setDesktopControlMode?: (enabled: boolean) => Promise<unknown>;
  openAccessibilitySettings?: () => Promise<unknown>;
}

function cloneDefaultMappings(): GestureMappings {
  return {
    fist: { ...DEFAULT_MAPPINGS.fist },
    peace: { ...DEFAULT_MAPPINGS.peace },
    index: { ...DEFAULT_MAPPINGS.index },
    open_hand: { ...DEFAULT_MAPPINGS.open_hand },
    pinch: { ...DEFAULT_MAPPINGS.pinch },
  };
}

function bridge(): VisionGesturesBridge | null {
  return ((window as any).nexus?.visionGestures || null) as VisionGesturesBridge | null;
}

function isRecognizedGesture(value: unknown): value is RecognizedGestureId {
  return RECOGNIZED_GESTURES.includes(value as RecognizedGestureId);
}

function isFilter(value: unknown): value is FilterId {
  return FILTER_IDS.includes(value as FilterId);
}

function isAction(value: unknown): value is ActionId {
  return ACTION_IDS.includes(value as ActionId);
}

export function createDefaultVisionGestureSettings(): VisionGestureSettings {
  return {
    version: SETTINGS_VERSION,
    mappings: cloneDefaultMappings(),
    customPrompts: [],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeVisionGestureSettings(input: unknown): VisionGestureSettings {
  const defaults = createDefaultVisionGestureSettings();
  const candidate = input && typeof input === 'object' ? input as Partial<VisionGestureSettings> : {};
  const candidateMappings = candidate.mappings && typeof candidate.mappings === 'object'
    ? candidate.mappings as Partial<Record<RecognizedGestureId, Partial<{ visual: unknown; action: unknown }>>>
    : {};

  for (const gesture of RECOGNIZED_GESTURES) {
    const mapping = candidateMappings[gesture];
    if (mapping?.visual && isFilter(mapping.visual)) {
      defaults.mappings[gesture].visual = mapping.visual;
    }
    if (mapping?.action && isAction(mapping.action)) {
      defaults.mappings[gesture].action = mapping.action;
    }
  }

  if (Array.isArray(candidate.customPrompts)) {
    defaults.customPrompts = candidate.customPrompts
      .filter((entry): entry is CustomGesturePrompt => (
        Boolean(entry)
        && typeof entry.id === 'string'
        && typeof entry.prompt === 'string'
        && isRecognizedGesture(entry.mappedGesture)
        && isFilter(entry.visual)
        && isAction(entry.action)
        && typeof entry.createdAt === 'string'
      ))
      .slice(-24);
  }

  defaults.updatedAt = typeof candidate.updatedAt === 'string'
    ? candidate.updatedAt
    : defaults.updatedAt;
  return defaults;
}

export async function loadVisionGestureSettings(): Promise<VisionGestureSettings> {
  const api = bridge();
  if (!api?.loadSettings) {
    return createDefaultVisionGestureSettings();
  }

  try {
    const loaded = await api.loadSettings();
    return normalizeVisionGestureSettings(loaded);
  } catch (error) {
    console.warn('[Nexus Vision Gestures] settings load failed', error);
    return createDefaultVisionGestureSettings();
  }
}

export async function saveVisionGestureSettings(settings: VisionGestureSettings): Promise<void> {
  const normalized = normalizeVisionGestureSettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  });
  const api = bridge();
  if (!api?.saveSettings) {
    window.localStorage.setItem('nexus-vision-gestures-settings', JSON.stringify(normalized));
    return;
  }

  await api.saveSettings(normalized);
}

export async function clickScreenAtNormalizedPoint(point: { normalizedX: number; normalizedY: number }): Promise<unknown> {
  const api = bridge();
  if (!api?.clickScreen) {
    throw new Error('Screen click bridge is unavailable.');
  }

  return api.clickScreen(point);
}

export async function setDesktopControlMode(enabled: boolean): Promise<void> {
  const api = bridge();
  if (!api?.setDesktopControlMode) {
    return;
  }

  await api.setDesktopControlMode(enabled);
}

export async function openAccessibilitySettings(): Promise<void> {
  const api = bridge();
  if (!api?.openAccessibilitySettings) {
    return;
  }

  await api.openAccessibilitySettings();
}

const GESTURE_KEYWORDS: Array<[RecognizedGestureId, string[]]> = [
  ['fist', ['fist', 'closed hand', 'hold', 'stop']],
  ['peace', ['peace', 'victory', 'two fingers', 'two finger']],
  ['index', ['point', 'pointing', 'index', 'finger', 'focus']],
  ['open_hand', ['open hand', 'open palm', 'palm', 'wake']],
  ['pinch', ['pinch', 'click', 'tap', 'press']],
];

const FILTER_KEYWORDS: Array<[FilterId, string[]]> = [
  ['dither', ['dither', 'pixel', 'threshold']],
  ['vhs', ['vhs', 'tape', 'chromatic', 'glitch']],
  ['spotlight', ['spotlight', 'focus', 'highlight', 'select']],
  ['water_ripple', ['water', 'ripple', 'distort', 'wave']],
  ['none', ['clean', 'none', 'normal']],
];

const ACTION_KEYWORDS: Array<[ActionId, string[]]> = [
  ['pause_agent', ['pause', 'stop', 'hold']],
  ['start_recording', ['record', 'recording']],
  ['select_object', ['analyze', 'select', 'focus', 'look at']],
  ['open_command_palette', ['command', 'palette', 'menu']],
  ['wake_agent', ['wake', 'listen', 'attention']],
  ['capture_moment', ['capture', 'screenshot', 'clip', 'save']],
  ['trigger_voice_agent', ['voice', 'talk', 'speak']],
  ['navigate_next', ['next', 'forward']],
  ['navigate_previous', ['previous', 'back']],
  ['system_click', ['click', 'tap', 'press', 'button']],
  ['create_code_map', ['code map', 'architecture map', 'diagram graph', 'graph diagram']],
  ['ingest_code_knowledge', ['code knowledge', 'knowledge base', 'ingest graph', 'ingest code']],
];

function chooseKeyword<T extends string>(text: string, options: Array<[T, string[]]>, fallback: T): T {
  const normalized = text.toLowerCase();
  return options.find(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))?.[0] || fallback;
}

export function applyNaturalLanguageMappingPrompt(
  settings: VisionGestureSettings,
  prompt: string,
): { settings: VisionGestureSettings; message: string } {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) {
    return { settings, message: 'Prompt is empty.' };
  }

  const current = normalizeVisionGestureSettings(settings);
  const mappedGesture = chooseKeyword(cleanPrompt, GESTURE_KEYWORDS, 'index');
  const visual = chooseKeyword(cleanPrompt, FILTER_KEYWORDS, current.mappings[mappedGesture].visual);
  const action = chooseKeyword(cleanPrompt, ACTION_KEYWORDS, current.mappings[mappedGesture].action);
  const customPrompt: CustomGesturePrompt = {
    id: `prompt-${Date.now()}`,
    prompt: cleanPrompt,
    mappedGesture,
    visual,
    action,
    createdAt: new Date().toISOString(),
  };

  const next = normalizeVisionGestureSettings({
    ...current,
    mappings: {
      ...current.mappings,
      [mappedGesture]: { visual, action },
    },
    customPrompts: [...current.customPrompts, customPrompt].slice(-24),
    updatedAt: new Date().toISOString(),
  });

  return {
    settings: next,
    message: `Mapped ${mappedGesture} to ${visual} and ${action}.`,
  };
}
