import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import './styles/global.css';
import { DiagramViewer } from './components/DiagramViewer';
import rawAudioProcessorWorkletUrl from '../vendor/elevenlabs/rawAudioProcessor.worklet.js?url';
import audioConcatProcessorWorkletUrl from '../vendor/elevenlabs/audioConcatProcessor.worklet.js?url';
import libsamplerateWorkletUrl from '../vendor/elevenlabs/libsamplerate.worklet.js?url';
import {
  DEFAULT_ELEVENLABS_AGENT_ID,
  DEFAULT_ELEVENLABS_AGENT_NAME,
  DEFAULT_ELEVENLABS_VOICE_ID,
  resolveElevenLabsAgentId,
  resolveElevenLabsVoiceId,
} from '../../shared/elevenlabs';
import {
  BUILTIN_TUTORIALS,
  getBuiltinTutorialById,
  getBuiltinTutorialMarkdown,
  getBuiltinTutorialPlaybackText,
} from '../../shared/builtin-knowledge';

// ============================================================
// Tech-Themed Icon System (SVG + PNG support)
// ============================================================

/** Inline SVG icon component — renders crisp at any size */
const Icon: React.FC<{ name: string; size?: number; color?: string; className?: string }> = ({
  name, size = 16, color = 'currentColor', className = ''
}) => {
  const paths: Record<string, React.ReactNode> = {
    // ── Navigation & UI ────────────────────────────────────
    menu: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    info: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    // ── Voice & Audio ──────────────────────────────────────
    mic: <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>,
    micOff: <><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 8V4a3 3 0 0 0-5.78-1"/><path d="M17 10v2a5 5 0 0 1-.59 2.35"/><path d="M7 10v2a5 5 0 0 0 8.56 3.54"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="4" y1="4" x2="20" y2="20"/></>,
    volume: <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></>,
    // ── Status ─────────────────────────────────────────────
    check: <><polyline points="20 6 9 17 4 12"/></>,
    alertTriangle: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    loader: <><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></>,
    // ── Agents & Bots ──────────────────────────────────────
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></>,
    bot: <><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></>,
    // ── Tasks & Pipelines ──────────────────────────────────
    clipboard: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>,
    gitBranch: <><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    // ── Intelligence & Knowledge ───────────────────────────
    brain: <><path d="M12 2C8 2 5 5 5 9c0 2.4 1.2 4.5 3 5.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3c1.8-1.2 3-3.3 3-5.7 0-4-3-7-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="12" y1="6" x2="12" y2="12"/></>,
    compass: <><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></>,
    // ── Files & Documents ──────────────────────────────────
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    folder: <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
    fileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>,
    // ── Communication ──────────────────────────────────────
    paperclip: <><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></>,
    send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    scissors: <><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></>,
    // ── Meeting Mode ───────────────────────────────────────
    radio: <><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></>,
    activity: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
    target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    // ── Media & Web ────────────────────────────────────────
    globe: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>,
    // ── Data & Spreadsheet ─────────────────────────────────
    barChart: <><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
    table: <><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></>,
    // ── Image & Code ───────────────────────────────────────
    image: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    code: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>,
    terminal: <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>,
    // ── Search & Knowledge ─────────────────────────────────
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    bookOpen: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>,
    // ── People & Entities ──────────────────────────────────
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    building: <><rect x="4" y="2" width="16" height="20" rx="1"/><line x1="9" y1="6" x2="9" y2="6"/><line x1="15" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="9" y2="14"/><line x1="15" y1="14" x2="15" y2="14"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    // ── Project & Workspace ────────────────────────────────
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>,
    // ── Brainstorm ─────────────────────────────────────────
    zap: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
    sparkles: <><path d="M12 3L14 9L20 9L15 13L17 19L12 15L7 19L9 13L4 9L10 9Z"/></>,
    // ── Stop ───────────────────────────────────────────────
    square: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></>,
    // ── Play / YouTube ─────────────────────────────────────
    play: <><polygon points="5 3 19 12 5 21 5 3"/></>,
    // ── Plus ───────────────────────────────────────────────
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    // ── X / Close ──────────────────────────────────────────
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    // ── Spider / Scrape ────────────────────────────────────
    spider: <><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></>,
    // ── Notebook / Marketing ───────────────────────────────
    notebook: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`nexus-icon ${className}`}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {paths[name] || paths.settings}
    </svg>
  );
};

/** Map tool names to tech-themed icon names */
const TOOL_ICON_MAP: Record<string, string> = {
  // Agent Management
  create_agent: 'bot', run_agent: 'cpu', list_agents: 'users', open_agent_workflow: 'gitBranch',
  // Web & Search
  scrape_url: 'spider', web_search: 'search',
  // Pipeline
  create_pipeline: 'gitBranch',
  // Tasks
  create_task: 'clipboard',
  // Knowledge
  search_knowledge: 'bookOpen', ingest_document: 'database', patent_compare: 'fileText',
  // Memory
  store_memory: 'brain', recall_memory: 'brain',
  // Communication
  send_email: 'send', send_imessage: 'send',
  // Code
  execute_code: 'terminal',
  // File Ops
  create_document: 'fileText', replace_pdf_footer_brand: 'file', build_slide_deck: 'fileText',
  prepare_presentation_mode: 'play', start_presentation_mode: 'play', control_presentation_mode: 'activity',
  // Data
  lead_score: 'barChart',
  // Land Grabbers
  run_land_grabber_model: 'compass',
  // Brainstorm
  start_brainstorm: 'zap', stop_brainstorm: 'square',
  // Media
  show_youtube: 'play', open_webpage: 'globe', close_website: 'x',
  // Spreadsheet
  open_spreadsheet: 'table', inspect_spreadsheet: 'table',
  query_table: 'search', filter_table: 'table', sort_table: 'barChart',
  update_cells: 'table', export_table: 'inbox', generate_table_chart: 'barChart',
  create_spreadsheet: 'table', append_rows: 'plus',
  // Image
  generate_image: 'image', analyze_image: 'image',
  // Marketing Media
  generate_marketing_media_prompt: 'notebook',
  create_heygen_video: 'play',
  get_heygen_video_status: 'activity',
  create_elevenlabs_audio: 'volume',
  create_grok_image: 'image',
  create_grok_video: 'play',
  get_grok_video_status: 'activity',
  open_legal_report: 'fileText',
  open_tutorial: 'bookOpen',
  close_workspace_item: 'x',
  analyze_legal_document: 'fileText',
  analyze_legal_file: 'fileText',
  analyze_legal_url: 'globe',
  index_video_footage: 'database',
  search_video_footage: 'search',
  clip_video_segment: 'scissors',
  stitch_video_segments: 'layers',
  create_narrated_slideshow: 'play',
  // Lincutterz Growth
  lincutterz_klaviyo_manage: 'send',
  lincutterz_social_post: 'send',
  lincutterz_notion_manage: 'notebook',
  lincutterz_figma_create: 'image',
  lincutterz_publish_a_plus: 'inbox',
  // Transcripts
  save_transcript: 'fileText', open_transcript: 'file',
  search_transcripts: 'search', generate_session_briefing: 'fileText',
  backfill_session_titles: 'refresh', list_bug_reports: 'alertTriangle', export_bug_report_pdf: 'fileText',
  // Entity Intelligence
  identify_entities: 'users', create_person_profile: 'user',
  get_person_profile: 'user', create_business_profile: 'building',
  get_business_profile: 'building', link_person_to_business: 'link',
  generate_person_briefing: 'fileText', search_entities: 'search',
  backfill_entities: 'database', research_and_add_entity: 'search',
  open_entity_crm: 'users',
  // Diary
  search_diary: 'bookOpen', activity_summary: 'activity',
  session_activity_context: 'activity',
  // Workspace & Files
  open_file: 'file', find_file: 'search', upload_file: 'inbox',
  // Project Management
  create_project: 'layers', list_projects: 'folder',
  switch_project: 'layers', cross_project_insights: 'compass',
  project_context: 'compass',
  // Meeting Intelligence
  start_meeting_mode: 'radio', end_meeting_mode: 'square',
  meeting_add_context: 'plus', meeting_present_summary: 'activity',
};

/** Get the icon name for a tool, with fallback */
const getToolIconName = (toolName: string): string => TOOL_ICON_MAP[toolName] || 'settings';

const normalizeUiPath = (value: string): string => String(value || '').replace(/\\/g, '/').trim();

const basenameFromUiPath = (value: string): string => {
  const normalized = normalizeUiPath(value).replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

const dirnameFromUiPath = (value: string): string => {
  const normalized = normalizeUiPath(value).replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return normalized.startsWith('/') ? '/' : normalized;
  }
  const prefix = normalized.startsWith('/') ? '/' : '';
  return `${prefix}${parts.slice(0, -1).join('/')}`;
};

const formatPathForPanel = (value: string, segments: number = 4): string => {
  const normalized = normalizeUiPath(value).replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= segments) {
    return normalized;
  }
  return `${normalized.startsWith('/') ? '…/' : ''}${parts.slice(-segments).join('/')}`;
};

const looksLikeUiPath = (value: string): boolean => {
  const normalized = normalizeUiPath(value);
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return false;
  }
  return normalized.startsWith('/')
    || normalized.startsWith('~/')
    || /^[A-Za-z]:[\\/]/.test(normalized);
};

const collectPathReferences = (value: unknown, seen = new Set<string>()): string[] => {
  if (value == null) {
    return [];
  }

  if (typeof value === 'string') {
    const normalized = normalizeUiPath(value);
    if (looksLikeUiPath(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      return [normalized];
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPathReferences(item, seen));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectPathReferences(item, seen));
  }

  return [];
};

const uniqBy = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/** PNG icon support — load custom PNG icons from workspace assets folder */
const PngIcon: React.FC<{ src: string; size?: number; alt?: string; className?: string }> = ({
  src, size = 16, alt = '', className = ''
}) => (
  <img
    src={src}
    width={size}
    height={size}
    alt={alt}
    className={`nexus-icon png-icon ${className}`}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, objectFit: 'contain' }}
    draggable={false}
  />
);

// ============================================================
// Types
// ============================================================

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string | null;
  tier?: number | null;
  type?: 'text' | 'tool-call' | 'agent-notification' | 'pipeline-update' | 'scrape-preview' | 'voice-transcript';
  toolCalls?: any[];
  toolStatus?: 'pending' | 'success' | 'error';
  toolStartedAt?: number;
  toolFinishedAt?: number;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: any;
  agentId?: string;
  agentName?: string;
  pipelineId?: string;
  pipelineStage?: string;
  scrapeUrl?: string;
  scrapeTitle?: string;
  scrapeContent?: string;
  isFinal?: boolean;
}

interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'running' | 'idle' | 'error';
  createdAt: number;
  description?: string;
  parentId?: string | null;
  scratchpad?: string;
  isAutonomous?: boolean;
  config?: Record<string, any>;
}

interface AgentHubListing {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  category?: string;
  sellerName?: string;
  sellerContact?: string;
  priceCents?: number;
  currency?: string;
  template?: string;
  systemPrompt?: string;
  tools?: string[];
  llmTier?: 1 | 2 | 3;
  version?: string;
  status?: string;
  installCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface AgentHubDraft {
  name: string;
  tagline: string;
  description: string;
  category: string;
  sellerName: string;
  sellerContact: string;
  priceDollars: string;
  template: string;
}

interface Task {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  progress: number;
  dependencies?: string[];
  status: 'pending' | 'running' | 'completed';
  agentId?: string;
  sessionId?: string;
  sessionName?: string;
  result?: string;
  createdAt?: string;
  completedAt?: string;
}

interface Pipeline {
  id: string;
  name: string;
  stages: { name: string; status: 'pending' | 'active' | 'completed' | 'error' }[];
  progress: number;
  sessionId?: string;
  sessionName?: string;
  status?: string;
  currentStage?: string;
  createdAt?: string;
}

type OperatorCommunicationChannel = 'notification' | 'text' | 'both';

interface AgentWorkflowViewer {
  agent: Agent;
  childAgents: Agent[];
  runs: Array<Record<string, any>>;
  tasks: Task[];
  pipelines: Pipeline[];
  toolCalls: Array<Record<string, any>>;
}

interface SurfaceTab {
  id: 'chat' | 'workspace';
  label: string;
  icon: string;
}

interface BugReportRecord {
  id: string;
  sessionId?: string | null;
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'reviewing' | 'fixed' | 'ignored';
  intent: string;
  actual: string;
  suggestedSolution?: string;
  context?: unknown;
  stack?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface KnowledgeStats {
  tier1: number;
  tier2: number;
  tier3: number;
  documents: number;
  workingMemory?: {
    recentTurns: number;
    recentToolOutcomes: number;
    recentDocuments: number;
    activeTasks: number;
    reflectiveSignals: number;
    total: number;
  };
  health?: {
    currentSessionProjectLinked: boolean;
    sessionDocumentsMissingArtifactPath: number;
    sessionDocumentsMissingArtifactRows: number;
    sessionDocumentsMissingChunks: number;
    workspaceDocumentsMissingArtifactPath: number;
    workspaceDocumentsMissingArtifactRows: number;
    workspaceDocumentsMissingChunks: number;
    workspaceChunksMissingEmbeddings: number;
    workspaceSessionsWithoutProject: number;
  };
}

interface UsageProviderRecord {
  provider: string;
  requestCount: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  totalCost: number;
}

interface UsageBreakdownRecord {
  product: string;
  operation: string;
  unit: string;
  label: string;
  requestCount: number;
  quantity: number;
  lastUsedAt?: string | null;
}

interface UsageSeriesPointRecord {
  timestamp: number;
  value: number;
}

interface UsageOverviewRecord {
  generatedAt: string;
  llm: {
    requestCount: number;
    tokensIn: number;
    tokensOut: number;
    totalTokens: number;
    totalCost: number;
    todayCost: number;
    providers: UsageProviderRecord[];
    note?: string;
  };
  elevenlabs: {
    configured: boolean;
    account: {
      tier: string;
      status: string;
      characterCount: number;
      characterLimit: number;
      remainingCharacters: number;
      percentUsed: number;
      nextResetUnix?: number | null;
      canExtendCharacterLimit?: boolean;
      allowedToExtendCharacterLimit?: boolean;
      currency?: string | null;
    } | null;
    local: {
      requestCount: number;
      ttsRequestCount: number;
      conversationSessionCount: number;
      characterCount: number;
    };
    recent: {
      credits: number;
      characters: number;
      minutesUsed: number;
      requestCount: number;
      fiatUnitsSpent: number;
    } | null;
    dailyCredits: UsageSeriesPointRecord[];
    breakdown: UsageBreakdownRecord[];
    dailyCharacters: UsageSeriesPointRecord[];
    remoteError?: string | null;
    notes: string[];
  };
}

interface DiaryEntry {
  id: string;
  sessionId: string;
  entryType: string;
  activityKey: string;
  content: string;
  createdAt: string;
}

interface NarrativeSnapshot {
  id: string;
  sessionId: string;
  narrativeDay: string;
  narrative: string;
  compressedHistory: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectEventRecord {
  id: string;
  eventType: string;
  title: string;
  content: string;
  importance?: number;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, any> | null;
  createdAt: string;
}

interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  topics?: string[];
  status?: string;
  confidence?: number;
  assignedBy?: string;
  sessionCount?: number;
  eventCount?: number;
  recentEvents?: ProjectEventRecord[];
  recentArtifacts?: Array<Record<string, any>>;
  pipelines?: Array<Record<string, any>>;
  agentRuns?: Array<Record<string, any>>;
  tasks?: Array<Record<string, any>>;
  sessions?: Array<Record<string, any>>;
  createdAt?: string;
  updatedAt?: string;
}

interface WorkingSetFolderRecord {
  path: string;
  label: string;
}

interface SessionEntityMatchRecord {
  id: string;
  full_name?: string;
  name?: string;
  title?: string;
  company?: string;
  industry?: string;
  location?: string;
  score?: number;
  mentionCount?: number;
  sourceCount?: number;
  documentCount?: number;
  artifactCount?: number;
  projectCount?: number;
  lastSeenAt?: string;
  reasons?: string[];
}

interface SessionEntityRelationshipRecord {
  id: string;
  personId: string;
  businessId: string;
  personName: string;
  businessName: string;
  role?: string;
  isFounder?: boolean;
  inWorkingSet?: boolean;
}

interface SessionEntityContextRecord {
  people: SessionEntityMatchRecord[];
  businesses: SessionEntityMatchRecord[];
  relationships: SessionEntityRelationshipRecord[];
  summary?: string;
  mode?: 'graph' | 'inferred';
}

interface EntityKnowledgeDocumentRecord {
  id: string;
  title: string;
  source?: string;
  preview?: string;
  artifactPath?: string;
  artifactKind?: string;
  confidence?: number;
  mentionCount?: number;
  linkedAt?: string;
}

interface EntityKnowledgeArtifactRecord {
  id: string;
  title: string;
  path: string;
  kind?: string;
  sourceType?: string;
  confidence?: number;
  mentionCount?: number;
  linkedAt?: string;
}

interface EntityKnowledgeFactRecord {
  id: string;
  text: string;
  category: string;
  sourceLabels: string[];
  confidence?: number;
}

interface EntityKnowledgeSourceRecord {
  id: string;
  sourceType: 'profile' | 'relationship' | 'document' | 'artifact' | 'project' | 'briefing' | 'swot';
  title: string;
  subtitle?: string;
  preview?: string;
  documentId?: string;
  artifactPath?: string;
  artifactKind?: string;
  projectId?: string;
  confidence?: number;
  mentionCount?: number;
  linkedAt?: string;
}

interface EntityKnowledgeProjectRecord {
  id: string;
  name: string;
  status?: string;
  confidence?: number;
  mentionCount?: number;
  sourceCount?: number;
  documentCount?: number;
  artifactCount?: number;
  lastSeenAt?: string;
}

interface EntityKnowledgeRecord {
  entityType: 'person' | 'business';
  entityId: string;
  aliases: string[];
  relationships: any[];
  facts: EntityKnowledgeFactRecord[];
  sourceMaterials: EntityKnowledgeSourceRecord[];
  documents: EntityKnowledgeDocumentRecord[];
  artifacts: EntityKnowledgeArtifactRecord[];
  projects: EntityKnowledgeProjectRecord[];
  briefings?: Array<Record<string, any>>;
  latestSwot?: Record<string, any> | null;
  stats?: Record<string, number>;
}

interface CrmChatMessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: string[];
  timestamp: number;
}

interface CrmMergeState {
  type: 'person' | 'business';
  primaryId: string;
  primaryName: string;
  query: string;
  selectedCandidateId: string;
}

type ConversationStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type ConversationMode = 'listening' | 'speaking' | 'idle';
type ArtifactKind = 'image' | 'pdf' | 'text' | 'html' | 'spreadsheet' | 'audio' | 'video';

interface SpreadsheetSheetData {
  name: string;
  headers: string[];
  rowCount: number;
  columnCount: number;
  rows: Array<Record<string, any>>;
  truncated: boolean;
}

interface SpreadsheetWorkbookData {
  path: string;
  name: string;
  format: 'xlsx' | 'xls' | 'csv' | 'tsv';
  sheetNames: string[];
  sheets: SpreadsheetSheetData[];
  summary: string;
}

interface SpreadsheetCellEditor {
  sheetName: string;
  rowIndex: number;
  column: string;
  value: string;
}

interface ArtifactReference {
  path: string;
  kind: ArtifactKind;
  name: string;
}

interface LoadedArtifact extends ArtifactReference {
  dataUrl: string;
  mimeType: string;
  textContent?: string;
  spreadsheetData?: SpreadsheetWorkbookData;
}

interface LegalSuggestedFixRecord {
  id: string;
  label: string;
  fixedText: string;
  explanation: string;
}

interface LegalClauseAnalysisRecord {
  clauseNumber: number;
  title: string;
  content: string;
  flag: 'red' | 'yellow' | 'green';
  severity: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  harmExamples: string[];
  suggestedFixes: LegalSuggestedFixRecord[];
  aiAnalysis: string;
  suggestion?: string | null;
}

interface LegalAnalysisSummaryRecord {
  red: number;
  yellow: number;
  green: number;
  total: number;
}

interface LegalAnalysisImprovementRecord {
  clause: string;
  improvement: string;
}

interface LegalAnalysisConclusionRecord {
  keyFindings: string[];
  recommendations: string[];
}

interface LegalAnalysisReportRecord {
  id: string;
  sessionId: string;
  reportTitle: string;
  sourceType: 'knowledge_document' | 'uploaded_file' | 'url';
  sourceTitle: string;
  sourceLabel: string;
  sourceDocumentId?: string;
  sourceArtifactPath?: string | null;
  sourceUrl?: string | null;
  analyzedAt: string;
  analysisWarnings: string[];
  truncated: boolean;
  summary: LegalAnalysisSummaryRecord;
  readinessScore: number;
  overallAnalysis: string;
  introduction: string;
  clauses: LegalClauseAnalysisRecord[];
  consolidatedImprovements: LegalAnalysisImprovementRecord[];
  conclusion: LegalAnalysisConclusionRecord;
  markdownPath: string;
  pdfPath: string;
}

interface LegalWebSearchResultRecord {
  title: string;
  url: string;
  snippet?: string;
}

interface PresentationModeSlide {
  slideNumber: number;
  title: string;
  subtitle?: string;
  bullets: string[];
  keyMessage: string;
  speakerNotes: string;
  reviewFixes: string[];
  reviewPasses: number;
  issuesRemaining: string[];
  sourcePath: string;
  sourceKind: string;
  pageNumber?: number;
  imagePath?: string;
  imageDataUrl?: string;
}

interface PresentationModeDeck {
  id: string;
  title: string;
  sourcePath: string;
  sourceName: string;
  outputDir: string;
  notesPath: string;
  reviewReportPath: string;
  manifestPath: string;
  slideCount: number;
  createdAt: string;
  footerText: string;
  slides: PresentationModeSlide[];
  message?: string;
}

interface WorkspaceFileRecord {
  path: string;
  name: string;
  size?: number;
  modifiedAt?: string;
  kind?: ArtifactKind | null;
  sourceType?: string;
  sessionId?: string | null;
}

interface MediaStatusRecord {
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  uvPath?: string | null;
  sentrysearchReady: boolean;
  geminiConfigured: boolean;
  backend?: string | null;
  model?: string | null;
  stats: {
    totalChunks: number;
    uniqueSourceFiles: number;
    sourceFiles: string[];
  };
}

interface MediaSearchResultRecord {
  sourceFile: string;
  sourceName: string;
  startTime: number;
  endTime: number;
  similarityScore: number;
}

interface MediaSearchResponseRecord {
  query: string;
  backend: string;
  model?: string | null;
  stats: {
    totalChunks: number;
    uniqueSourceFiles: number;
    sourceFiles: string[];
  };
  results: MediaSearchResultRecord[];
}

interface KnowledgeDocumentRecord {
  id: string;
  sessionId?: string;
  title: string;
  source?: string;
  content?: string;
  preview?: string;
  artifactPath?: string;
  artifactKind?: string;
  createdAt?: string;
}

interface NetworkHealthCheck {
  service: string;
  label: string;
  host: string;
  configured: boolean;
  dns: 'ok' | 'failed' | 'not_applicable';
  reachable: boolean;
  status: 'healthy' | 'warning' | 'error';
  message: string;
  details?: string;
  latencyMs?: number;
  httpStatus?: number;
}

interface NetworkHealthReport {
  checkedAt: string;
  checks: NetworkHealthCheck[];
}

interface OllamaDiagnosticsState {
  status: 'not_installed' | 'stopped' | 'starting' | 'running' | 'pulling_models' | 'ready' | 'error';
  binaryPath: string | null;
  url: string;
  models: string[];
  missingModels: string[];
  error?: string;
  managedProcess: boolean;
  checkedAt?: string;
}

interface BrainstormSegment {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
}

interface BrainstormSessionRecord {
  id: string;
  sessionId: string;
  title: string;
  status: 'recording' | 'processing' | 'completed' | 'error';
  transcript: string;
  diarization: BrainstormSegment[];
  transcriptPdfPath: string;
  briefingContent: string;
  briefingPdfPath: string;
  knowledgeDocumentIds: string[];
  error: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  actionItemCount: number;
  summaryExcerpt: string;
}

interface YouTubeTranscriptRecord {
  id: string;
  channel_id: string | null;
  video_id: string;
  video_title: string;
  video_url: string;
  transcript_text: string;
  summary_text: string | null;
  document_id: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  fetched_at: string;
  pdf_path: string | null;
  status: 'active' | 'deleted';
}

interface GlobalSearchResultRecord {
  id: string;
  sourceType: string;
  title: string;
  preview?: string;
  createdAt?: string;
  source?: string;
  openKind?: 'knowledge_document' | 'youtube_transcript' | 'text' | 'workspace_file' | 'entity' | 'tutorial';
  openTarget?: {
    documentId?: string;
    transcriptId?: string;
    title?: string;
    content?: string;
    path?: string;
    kind?: string;
    name?: string;
    entityId?: string;
    entityType?: string;
    tutorialId?: string;
  };
  [key: string]: any;
}

interface GlobalSearchPayload {
  query: string;
  globalScope: boolean;
  counts: Record<string, number>;
  resultsBySource: Record<string, GlobalSearchResultRecord[]>;
  allResults: GlobalSearchResultRecord[];
  summary: string;
}

interface YouTubeViewer {
  title: string;
  sourceUrl: string;
  embedUrl: string;
  videoId: string;
}

interface WorkspaceMissionStageTab {
  id: 'mission-control';
  sourceKey: 'mission-control';
  type: 'mission';
  label: string;
  icon: string;
  closable: false;
}

interface WorkspaceArtifactStageTab {
  id: string;
  sourceKey: string;
  type: 'artifact';
  label: string;
  icon: string;
  closable: true;
  artifact: LoadedArtifact;
}

interface WorkspaceYouTubeStageTab {
  id: string;
  sourceKey: string;
  type: 'youtube';
  label: string;
  icon: string;
  closable: true;
  viewer: YouTubeViewer;
}

interface WorkspaceLegalReportStageTab {
  id: string;
  sourceKey: string;
  type: 'legal-report';
  label: string;
  icon: string;
  closable: true;
  report: LegalAnalysisReportRecord;
}

interface WorkspaceTutorialStageTab {
  id: string;
  sourceKey: string;
  type: 'tutorials';
  label: string;
  icon: string;
  closable: true;
  tutorialId: string;
}

type WorkspaceStageTab =
  | WorkspaceMissionStageTab
  | WorkspaceArtifactStageTab
  | WorkspaceYouTubeStageTab
  | WorkspaceLegalReportStageTab
  | WorkspaceTutorialStageTab;

interface MarketingBridgeState {
  notebookUrl: string;
  partition: string;
  rootDir: string;
  incomingDir: string;
  outgoingDir: string;
}

interface MarketingVoiceProfile {
  id: string;
  name: string;
  agentId?: string;
  voiceId?: string;
  modelId?: string;
}

interface HeyGenAvatarProfile {
  id: string;
  name: string;
  avatarId: string;
  avatarStyle?: string;
  width?: number;
  height?: number;
}

interface MarketingVideoConfig {
  heygenApiKeyConfigured: boolean;
  xaiApiKeyConfigured: boolean;
  voiceProfiles: MarketingVoiceProfile[];
  avatarProfiles: HeyGenAvatarProfile[];
}

interface StartConversationOptions {
  suppressGreeting?: boolean;
  initialUserMessage?: string;
}

type RollingTodoOwner = 'agent' | 'user' | 'shared';
type RollingTodoStatus = 'pending' | 'ready' | 'blocked' | 'in_progress' | 'done';

interface RollingTodoItemRecord {
  id: string;
  slotIndex: number;
  title: string;
  nextAction: string;
  reason: string;
  owner: RollingTodoOwner;
  status: RollingTodoStatus;
  needsUser: boolean;
  canAgentHelp: boolean;
  remindAfterAt: string | null;
  userTitle: string;
  userNextAction: string;
  userNotes: string;
  isPinned: boolean;
  updatedBy: string;
  agentTitle: string;
  agentNextAction: string;
  agentReason: string;
}

interface RollingTodoBoardRecord {
  id: string;
  sessionId: string;
  sessionName: string;
  projectId: string | null;
  projectName: string | null;
  summary: string;
  remindIntervalMinutes: number;
  lastAutoRefreshAt: string | null;
  lastReminderAt: string | null;
  pdfPath: string | null;
  items: RollingTodoItemRecord[];
}

interface RollingTodoItemDraft {
  userTitle: string;
  userNextAction: string;
  userNotes: string;
  owner: RollingTodoOwner;
  status: RollingTodoStatus;
  needsUser: boolean;
  canAgentHelp: boolean;
  isPinned: boolean;
  remindAfterMinutes: number;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string | boolean;
      };
    }
  }
}

// ============================================================
// Nexus Bridge
// ============================================================

const nexus = (window as any).nexus || {
  chat: {
    send: async () => ({ role: 'assistant', content: 'Mock response' }),
    sendWithTools: async () => ({ role: 'assistant', content: 'Mock response', toolResults: '[]' }),
    append: async () => ({}),
    stopCurrentTask: async () => ({ stopped: true }),
  },
  sessions: {
    list: async () => [],
    get: async () => null,
    create: async () => ({ id: '1', name: 'New Session', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 }),
    rename: async (id: string, name: string) => ({ id, name, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 }),
    backfillTitles: async () => ({ scanned: 0, updated: 0, sessions: [] }),
    delete: async () => ({ id: '1', deleted: true }),
    exportPdf: async () => ({ path: '', name: 'session-export.pdf', messageCount: 0 }),
    generateBriefing: async () => ({ title: 'Session Briefing', markdownPath: '', pdfPath: '', content: '' }),
    syncArchive: async () => ({ path: '', messageCount: 0 }),
  },
  projects: {
    create: async () => ({ id: 'project-1', name: 'Untitled Project', topics: [] }),
    list: async () => [],
    get: async () => null,
    getForSession: async () => null,
    assignSession: async () => null,
    ensureSession: async () => null,
  },
  knowledge: {
    ingestFile: async () => ({}),
    globalSearch: async () => ({ query: '', globalScope: true, counts: {}, resultsBySource: {}, allResults: [], summary: '' }),
    listDocuments: async () => [],
    stats: async () => ({
      tier1: 0,
      tier2: 0,
      tier3: 0,
      documents: 0,
      workingMemory: {
        recentTurns: 0,
        recentToolOutcomes: 0,
        recentDocuments: 0,
        activeTasks: 0,
        reflectiveSignals: 0,
        total: 0,
      },
      health: {
        currentSessionProjectLinked: false,
        sessionDocumentsMissingArtifactPath: 0,
        sessionDocumentsMissingArtifactRows: 0,
        sessionDocumentsMissingChunks: 0,
        workspaceDocumentsMissingArtifactPath: 0,
        workspaceDocumentsMissingArtifactRows: 0,
        workspaceDocumentsMissingChunks: 0,
        workspaceChunksMissingEmbeddings: 0,
        workspaceSessionsWithoutProject: 0,
      },
    }),
    getDocument: async () => null,
  },
  legal: {
    analyzeDocument: async () => ({ markdownPath: '', pdfPath: '', reportTitle: 'Agreeable Agreements Report', analysisWarnings: [], truncated: false, summary: { red: 0, yellow: 0, green: 0, total: 0 }, readinessScore: 0, clauses: [], conclusion: { keyFindings: [], recommendations: [] } }),
    analyzeUpload: async () => ({ markdownPath: '', pdfPath: '', reportTitle: 'Agreeable Agreements Report', analysisWarnings: [], truncated: false, summary: { red: 0, yellow: 0, green: 0, total: 0 }, readinessScore: 0, clauses: [], conclusion: { keyFindings: [], recommendations: [] } }),
    pickAndAnalyzeUpload: async () => null,
    analyzeUrl: async () => ({ markdownPath: '', pdfPath: '', reportTitle: 'Agreeable Agreements Report', analysisWarnings: [], truncated: false, summary: { red: 0, yellow: 0, green: 0, total: 0 }, readinessScore: 0, clauses: [], conclusion: { keyFindings: [], recommendations: [] } }),
    openReport: async () => null,
    onOpenReport: () => () => {},
  },
  agents: {
    create: async () => ({ id: '1', name: 'Agent' }),
    list: async () => [],
    workflow: async () => ({ agent: { id: '1', name: 'Agent' }, childAgents: [], runs: [], tasks: [], pipelines: [], toolCalls: [] }),
    onWorkflowOpen: () => () => {},
  },
  bugs: {
    record: async (input: Record<string, any>) => ({ id: 'bug-1', ...input }),
    list: async () => [],
    exportPdf: async () => ({ path: '', name: 'bug-report.pdf', count: 0, content: '' }),
  },
  agentHub: {
    list: async () => [],
    createListing: async (input: Record<string, any>) => ({ id: 'listing-1', ...input, installCount: 0 }),
    install: async (_listingId: string) => ({ agent: { id: '1', name: 'Agent' }, message: 'Installed agent.' }),
  },
  tools: { list: async () => [] },
  clipboard: {
    writeText: async (text: string) => {
      const normalized = String(text || '');
      if (!normalized) {
        return true;
      }
      if (typeof document === 'undefined') {
        return false;
      }
      const textarea = document.createElement('textarea');
      textarea.value = normalized;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, normalized.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    },
  },
  masterDiary: {
    list: async () => [],
    narratives: async () => [],
    createSessionDiary: async () => ({ entry: null, narrative: null }),
    audioEntries: async () => [],
    comment: async () => ({}),
  },
  youtube: {
    fetchTranscript: async () => null,
    subscribeChannel: async () => null,
    syncChannel: async () => null,
    pauseChannel: async () => null,
    resumeChannel: async () => null,
    deleteChannel: async () => ({ success: true }),
    deleteTranscript: async () => ({ success: true }),
    listChannels: async () => [],
    listTranscripts: async () => [],
    getTranscript: async () => null,
    exportTranscriptPdf: async () => ({ path: '', name: 'youtube-transcript.pdf', transcript: null }),
    stats: async () => ({ channels: 0, transcripts: 0, totalChars: 0 }),
  },
  voice: { transcribe: async () => 'Mock transcript' },
  scraper: { scrape: async () => ({ content: '' }) },
  elevenlabs: {
    getSignedUrl: async () => ({ signedUrl: '', conversationId: '' }),
    getAgentConfig: async () => ({}),
    isConfigured: async () => false,
    executeToolCall: async () => ({ success: true, result: 'Mock result' }),
    addTranscript: async () => {},
    endSession: async () => {},
  },
  settings: {
    get: async () => '',
    set: async () => {},
  },
  diagnostics: {
    runNetworkHealth: async () => ({ checkedAt: new Date().toISOString(), checks: [] }),
    ollamaStatus: async () => ({
      status: 'stopped',
      binaryPath: null,
      url: 'http://localhost:11434',
      models: [],
      missingModels: [],
      managedProcess: false,
    }),
    ollamaRestart: async () => ({
      status: 'starting',
      binaryPath: null,
      url: 'http://localhost:11434',
      models: [],
      missingModels: [],
      managedProcess: false,
    }),
  },
  usage: {
    overview: async () => ({
      generatedAt: new Date().toISOString(),
      llm: {
        requestCount: 0,
        tokensIn: 0,
        tokensOut: 0,
        totalTokens: 0,
        totalCost: 0,
        todayCost: 0,
        providers: [],
        note: 'LLM totals currently reflect router-tracked chat usage from the api_usage table.',
      },
      elevenlabs: {
        configured: false,
        account: null,
        local: {
          requestCount: 0,
          ttsRequestCount: 0,
          conversationSessionCount: 0,
          characterCount: 0,
        },
        recent: null,
        dailyCredits: [],
        breakdown: [],
        dailyCharacters: [],
        remoteError: 'ElevenLabs API key is not configured.',
        notes: [],
      },
    }),
  },
  artifacts: {
    load: async () => ({ dataUrl: '', mimeType: 'application/pdf', kind: 'pdf', path: '', name: '', textContent: '' }),
    reveal: async () => true,
    listWorkspaceFiles: async () => [],
    materializeText: async () => ({ path: '', name: 'viewer-artifact.md', kind: 'text' }),
  },
  media: {
    getStatus: async () => ({
      sentrysearchReady: false,
      geminiConfigured: false,
      backend: null,
      model: null,
      stats: { totalChunks: 0, uniqueSourceFiles: 0, sourceFiles: [] },
    }),
    indexVideos: async () => ({ backend: 'gemini', indexedPaths: [], stdout: '', stderr: '', stats: { totalChunks: 0, uniqueSourceFiles: 0, sourceFiles: [] } }),
    searchVideos: async () => ({ query: '', backend: 'gemini', stats: { totalChunks: 0, uniqueSourceFiles: 0, sourceFiles: [] }, results: [] }),
    clipVideo: async () => ({ artifact: { path: '', name: 'clip.mp4', kind: 'video' } }),
    stitchVideos: async () => ({ artifact: { path: '', name: 'stitched.mp4', kind: 'video' } }),
    createNarratedSlideshow: async () => ({
      artifact: { path: '', name: 'slideshow.mp4', kind: 'video' },
      audioArtifact: { path: '', name: 'narration.m4a', kind: 'audio' },
      narrationText: '',
      narrationProvider: 'mock',
    }),
  },
  presentation: {
    prepare: async () => ({ id: 'presentation-job', status: 'running' }),
    start: async () => ({}),
    control: async () => ({ sent: true }),
    onReady: () => () => {},
    onOpen: () => () => {},
    onControl: () => () => {},
    onError: () => () => {},
  },
  browser: {
    open: async () => ({ success: true, url: '', title: 'Emergent Browser' }),
    onOpen: () => () => {},
    onClose: () => () => {},
    onScreenshotSaved: () => () => {},
  },
  workspace: {
    onPresentArtifact: () => () => {},
    onOpenTutorial: () => () => {},
    onCloseActiveStage: () => () => {},
  },
  marketing: {
    getBridgeState: async () => ({
      notebookUrl: 'https://notebooklm.google.com/',
      partition: 'persist:marketing-notebooklm',
      rootDir: '',
      incomingDir: '',
      outgoingDir: '',
    }),
    openExternal: async () => ({ success: true, url: 'https://notebooklm.google.com/' }),
    revealFolder: async () => ({ success: true, path: '' }),
    onDownloadEvent: () => () => {},
    getVideoConfig: async () => ({ heygenApiKeyConfigured: false, xaiApiKeyConfigured: false, voiceProfiles: [], avatarProfiles: [] }),
    saveVideoConfig: async (input: Record<string, any>) => ({
      heygenApiKeyConfigured: false,
      xaiApiKeyConfigured: false,
      voiceProfiles: input.voiceProfiles || [],
      avatarProfiles: input.avatarProfiles || [],
    }),
    createHeyGenVideo: async () => ({ success: true, videoId: 'mock-video-id', status: 'submitted' }),
    getHeyGenStatus: async (videoId: string) => ({ success: true, videoId, raw: { data: { status: 'mock' } } }),
    generateAssistedPrompt: async (input: Record<string, any>) => ({ success: true, target: input.target || 'grok_image', prompt: input.brief || 'Mock assisted prompt' }),
    createGrokImage: async () => ({ success: true, path: '/mock/grok-image.jpg' }),
    createGrokVideo: async () => ({ success: true, requestId: 'mock-grok-video-request', status: 'submitted' }),
    getGrokVideoStatus: async (requestId: string) => ({ success: true, requestId, status: 'mock' }),
  },
  spreadsheets: {
    open: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    inspect: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    query: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    filter: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    sort: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    updateCells: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    exportTable: async () => ({ path: '', name: 'spreadsheet-export.xlsx', format: 'xlsx', summary: '', rowCount: 0, columnCount: 0, sheetName: 'Sheet1' }),
    generateChart: async () => ({ path: '', name: 'spreadsheet-chart.svg', summary: '', chartType: 'bar', labelColumn: '', valueColumn: '', rowCount: 0 }),
    create: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
    appendRows: async () => ({ path: '', name: 'spreadsheet.xlsx', format: 'xlsx', sheetNames: [], sheets: [], summary: '' }),
  },
  brainstorm: {
    start: async () => ({ id: 'brainstorm-1', title: 'New Brainstorm', status: 'recording' }),
    processAudio: async () => ({ id: 'brainstorm-1', title: 'New Brainstorm', status: 'completed' }),
    list: async () => [],
    get: async () => null,
    delete: async () => ({ id: 'brainstorm-1', deleted: true }),
    showYouTube: async (url: string) => ({
      title: 'YouTube Video',
      sourceUrl: url,
      embedUrl: url,
      videoId: '',
    }),
    openYouTubeWindow: async () => true,
  },
  entityCrm: {
    listPeople: async () => [],
    listBusinesses: async () => [],
    search: async () => [],
    getSessionContext: async () => ({ people: [], businesses: [], relationships: [], summary: 'Mock entity context' }),
    getKnowledge: async () => ({ entityType: 'person', entityId: '', aliases: [], relationships: [], facts: [], sourceMaterials: [], documents: [], artifacts: [], projects: [], stats: {} }),
    chat: async () => ({ content: 'Mock CRM answer', sources: [] }),
    getPerson: async () => null,
    getBusiness: async () => null,
    getCounts: async () => ({ people: 0, businesses: 0, links: 0 }),
    getPersonBusinesses: async () => [],
    getBusinessPeople: async () => [],
    createPerson: async (data: any) => ({ id: 'mock-person', ...data }),
    updatePerson: async (_id: string, data: any) => ({ id: 'mock-person', ...data }),
    deletePerson: async () => true,
    createBusiness: async (data: any) => ({ id: 'mock-business', ...data }),
    updateBusiness: async (_id: string, data: any) => ({ id: 'mock-business', ...data }),
    deleteBusiness: async () => true,
    mergePerson: async (primaryId: string) => ({ id: primaryId }),
    mergeBusiness: async (primaryId: string) => ({ id: primaryId }),
    linkPersonBusiness: async () => ({ success: true }),
    unlinkPersonBusiness: async () => true,
    backfillFromKnowledge: async () => ({ success: true, processed: 0, peopleCreated: 0, businessesCreated: 0, message: 'Mock' }),
    openPanel: async () => ({ success: true }),
    onBackfillProgress: () => () => {},
    onOpenPanel: () => () => {},
  },
  meetingMode: {
    start: async () => ({ success: true, meetingId: '', status: 'listening' }),
    end: async () => ({ success: true, ended: false }),
    addTranscript: async () => ({ success: true }),
    getState: async () => ({ active: false }),
    compileBriefing: async () => ({ success: false, error: 'No active meeting' }),
    isActive: async () => false,
    onUpdate: () => () => {},
  },
  rollingTodo: {
    get: async () => null,
    refresh: async () => null,
    updateItem: async () => null,
    exportPdf: async () => ({ path: '', name: 'rolling-2-do.pdf', board: null }),
    emailPdf: async () => ({ success: true, path: '', messageId: 'mock-message-id' }),
    claimReminder: async () => null,
  },
};

const PRODUCT_NAME = 'Emergent Intelligence';
const DEFAULT_VOICE_GREETING = `Hey, I'm ${DEFAULT_ELEVENLABS_AGENT_NAME} — your AI operations hub. What would you like to get done?`;
const TOOL_PAYLOAD_FIELD_LIMIT = 12;
const TOOL_TEXT_PREVIEW_LIMIT = 420;
const AGENT_HUB_TEMPLATES = [
  'orchestrator',
  'research_scout',
  'market_analyst',
  'strategy_architect',
  'document_producer',
  'web_scraper',
  'sales_outreach',
  'code_builder',
  'qa_reviewer',
  'presentation_agent',
  'land_grabber_model',
  'lincutterz_growth_agent',
  'patent_scout',
  'custom',
];
const DEFAULT_TEXT_CHAT_TOOL_NAMES = [
  'read_file',
  'write_file',
  'list_directory',
  'generate_pdf',
  'replace_pdf_footer_brand',
  'build_slide_deck',
  'prepare_presentation_mode',
  'start_presentation_mode',
  'control_presentation_mode',
  'run_land_grabber_model',
  'process_xlsx',
  'open_spreadsheet',
  'inspect_spreadsheet',
  'query_table',
  'filter_table',
  'sort_table',
  'update_cells',
  'export_table',
  'generate_table_chart',
  'generate_image',
  'analyze_image',
  'generate_marketing_media_prompt',
  'create_heygen_video',
  'get_heygen_video_status',
  'create_elevenlabs_audio',
  'create_grok_image',
  'create_grok_video',
  'get_grok_video_status',
  'open_legal_report',
  'analyze_legal_document',
  'analyze_legal_file',
  'analyze_legal_url',
  'index_video_footage',
  'search_video_footage',
  'clip_video_segment',
  'stitch_video_segments',
  'create_narrated_slideshow',
  'lincutterz_klaviyo_manage',
  'lincutterz_social_post',
  'lincutterz_notion_manage',
  'lincutterz_figma_create',
  'lincutterz_publish_a_plus',
  'create_spreadsheet',
  'append_rows',
  'send_email',
  'send_imessage',
  'shell_exec',
  'python_run',
  'node_run',
  'git_ops',
  'sqlite_query',
  'crm_update',
  'pipeline_track',
  'lead_score',
  'scrape_url',
  'search_google',
  'search_knowledge',
  'youtube_get_transcript',
  'youtube_subscribe_channel',
  'youtube_list_channels',
  'youtube_sync_channel',
  'youtube_pause_channel',
  'youtube_resume_channel',
  'youtube_delete_channel',
  'youtube_stats',
  'patent_compare',
  'open_webpage',
  'close_website',
  'identify_entities',
  'create_person_profile',
  'get_person_profile',
  'create_business_profile',
  'get_business_profile',
  'link_person_to_business',
  'generate_person_briefing',
  'search_entities',
  'open_entity_crm',
  'activity_summary',
  'session_activity_context',
  'open_agent_workflow',
  'backfill_session_titles',
  'list_bug_reports',
  'export_bug_report_pdf',
  'project_context',
  'open_file',
  'find_file',
  'start_meeting_mode',
  'end_meeting_mode',
  'meeting_add_context',
  'meeting_present_summary',
  'backfill_entities',
  'research_and_add_entity',
  'list_tasks',
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateDisplayText(value: string, maxLength: number = TOOL_TEXT_PREVIEW_LIMIT): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sanitizeOperatorFocusLabel(value: string): string {
  const normalized = normalizeWhitespace(String(value || ''));
  if (!normalized) {
    return '';
  }

  const cleaned = normalizeWhitespace(
    normalized
      .replace(/\bcreated from emergent intelligence ui\b/gi, ' ')
      .replace(/\bcreated emergent intelligence\b/gi, ' ')
      .replace(/\bopen file\b/gi, ' ')
      .replace(/\bopen source\b/gi, ' ')
      .replace(/\bopen review\b/gi, ' ')
      .replace(/\bopen pdf\b/gi, ' ')
  );

  if (!cleaned) {
    return '';
  }

  return truncateDisplayText(cleaned, 80);
}

function matchesDataSearch(query: string, values: unknown[]): boolean {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return values
    .map((value) => normalizeWhitespace(String(value || '')).toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function stringifySessionSearchValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (depth > 3) {
      return '';
    }
    return value.map((item) => stringifySessionSearchValue(item, depth + 1)).join(' ');
  }

  if (typeof value === 'object') {
    if (depth > 3) {
      return '';
    }
    return Object.values(value as Record<string, unknown>)
      .map((entryValue) => stringifySessionSearchValue(entryValue, depth + 1))
      .join(' ');
  }

  return String(value);
}

function buildSessionMessageSearchText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return '';
  }

  return normalizeWhitespace(messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return stringifySessionSearchValue(message);
    }

    const record = message as Record<string, unknown>;
    return [
      record.role,
      record.type,
      record.content,
      record.toolName,
      record.toolStatus,
      record.toolArgs,
      record.toolResult,
      record.scrapeTitle,
      record.scrapeUrl,
      record.scrapeContent,
    ].map((value) => stringifySessionSearchValue(value)).join(' ');
  }).join(' '));
}

function extractTaskSummary(value: string): string {
  const taskMatch = value.match(/##\s*Task\s*([\s\S]*?)(?:\n##\s+|$)/i);
  if (taskMatch?.[1]) {
    return truncateDisplayText(taskMatch[1], 260);
  }
  return '';
}

function inferRollingTodoReminderMinutes(remindAfterAt: string | null | undefined): number {
  if (!remindAfterAt) {
    return 45;
  }

  const timestamp = new Date(remindAfterAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return 45;
  }

  return Math.max(15, Math.min(240, Math.round(Math.max(timestamp - Date.now(), 15 * 60 * 1000) / 60000)));
}

function looksLikeInternalAgentContext(value: string): boolean {
  const normalized = value.trim();
  return (
    /^You are the .* agent\./i.test(normalized)
    || /##\s*Context/i.test(normalized)
    || /##\s*Key Memories/i.test(normalized)
    || /##\s*Recent Conversation/i.test(normalized)
    || /Soul Document/i.test(normalized)
  );
}

function shouldRecordSystemMessageBug(content: string): boolean {
  const normalized = normalizeWhitespace(content).toLowerCase();
  // User-initiated disconnects are not bugs
  if (/^voice session disconnected:\s*user\b/.test(normalized)) {
    return false;
  }
  // ElevenLabs LLM timeout is a transient provider issue, not a local bug
  if (/llm response took too long|generating the llm response/i.test(normalized)) {
    return false;
  }

  return /\b(failed|error|unavailable|disconnected|not found|forbidden|timeout|took too long)\b/i.test(content);
}

function summarizeToolString(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (looksLikeInternalAgentContext(trimmed)) {
    const taskSummary = extractTaskSummary(trimmed);
    return taskSummary
      ? `Internal agent prompt/context hidden. Task summary: ${taskSummary}`
      : 'Internal agent prompt/context hidden.';
  }

  return truncateDisplayText(trimmed);
}

function sanitizeToolPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return summarizeToolString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const sanitizedItems = value.slice(0, TOOL_PAYLOAD_FIELD_LIMIT).map((item) => sanitizeToolPayload(item, depth + 1));
    if (value.length > TOOL_PAYLOAD_FIELD_LIMIT) {
      sanitizedItems.push(`[${value.length - TOOL_PAYLOAD_FIELD_LIMIT} additional items hidden]`);
    }
    return sanitizedItems;
  }

  if (typeof value === 'object') {
    if (depth >= 4) {
      return '[nested content hidden]';
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const sanitizedEntries = entries
      .slice(0, TOOL_PAYLOAD_FIELD_LIMIT)
      .map(([key, entryValue]) => [key, sanitizeToolPayload(entryValue, depth + 1)] as const);

    if (entries.length > TOOL_PAYLOAD_FIELD_LIMIT) {
      sanitizedEntries.push([
        '_truncated',
        `${entries.length - TOOL_PAYLOAD_FIELD_LIMIT} additional fields hidden`,
      ]);
    }

    return Object.fromEntries(sanitizedEntries);
  }

  return String(value);
}

function formatTimestampLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSecondsLabel(totalSeconds?: number | null): string {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getGlobalSourceLabel(sourceType: string): string {
  const normalized = String(sourceType || '').toLowerCase();
  switch (normalized) {
    case 'knowledge':
    case 'knowledge_document':
      return 'Knowledge';
    case 'youtube_transcript':
      return 'YouTube';
    case 'transcript':
    case 'transcript_document':
      return 'Transcript';
    case 'transcript_message':
      return 'Transcript Msg';
    case 'session_message':
      return 'Session Msg';
    case 'diary':
    case 'diary_entry':
      return 'Diary';
    case 'workspace_file':
      return 'Workspace';
    case 'builtin_guide':
      return 'Tutorial';
    case 'entity':
      return 'Entity';
    default:
      return sourceType || 'Result';
  }
}

function formatSessionDateLabel(session: Session): string {
  return new Date(session.updatedAt || session.createdAt).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatModelLabel(model?: string | null, tier?: number | null): string {
  const trimmedModel = String(model || '').trim();
  if (!trimmedModel) {
    return tier ? `Tier ${tier}` : '';
  }

  return tier ? `${trimmedModel} · Tier ${tier}` : trimmedModel;
}

function getOllamaStatusTone(status?: OllamaDiagnosticsState['status']): 'healthy' | 'warning' | 'error' {
  switch (status) {
    case 'ready':
    case 'running':
      return 'healthy';
    case 'starting':
    case 'pulling_models':
    case undefined:
      return 'warning';
    default:
      return 'error';
  }
}

function formatOllamaStatusLabel(status?: OllamaDiagnosticsState['status']): string {
  switch (status) {
    case 'not_installed':
      return 'Not Installed';
    case 'stopped':
      return 'Stopped';
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Running';
    case 'pulling_models':
      return 'Pulling Models';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Checking';
  }
}

function isAutoGeneratedSessionName(name: string): boolean {
  return /^(new session|session \d+|agent run(?: .*)?|primary workspace session)$/i.test(name.trim());
}

function deriveSessionTitle(content: string): string {
  const normalized = normalizeWhitespace(content)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, 'link')
    .replace(/^[>"'\s]+/, '')
    .replace(/^(hey|ok|okay|please|can you|could you|would you|i want|i need|lets|let's)\s+/i, '')
    .trim();

  if (normalized.length < 8) {
    return '';
  }

  const firstThought = normalizeWhitespace(
    normalized
      .split(/(?:[.!?]\s+|\n+)/)[0]
      .replace(/[{}\[\]`*_#<>]/g, ' ')
  );
  const title = firstThought || normalized;

  if (title.split(/\s+/).filter(Boolean).length < 2) {
    return '';
  }

  return title.length > 58 ? `${title.slice(0, 55).trimEnd()}...` : title;
}

const WORKSPACE_MISSION_STAGE_TAB: WorkspaceMissionStageTab = {
  id: 'mission-control',
  sourceKey: 'mission-control',
  type: 'mission',
  label: 'Mission Control',
  icon: 'compass',
  closable: false,
};

const WORKSPACE_TUTORIAL_STAGE_ID = 'tutorials';

function createDefaultWorkspaceStageTabs(): WorkspaceStageTab[] {
  return [{ ...WORKSPACE_MISSION_STAGE_TAB }];
}

const DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT = 'Send To Me CLI';
const DEFAULT_OPERATOR_DAILY_BRIEFING_TIME = '08:30';
function normalizeBooleanSetting(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeOperatorCommunicationChannel(value: unknown): OperatorCommunicationChannel {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'text' || normalized === 'both') {
    return normalized;
  }
  return 'notification';
}

function getOperatorBriefingDateKey(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function countActivePipelines(pipelines: Pipeline[]): number {
  return pipelines.filter((pipeline) => {
    const normalizedStatus = String(pipeline.status || '').trim().toLowerCase();
    if (['active', 'running', 'in_progress', 'in-progress'].includes(normalizedStatus)) {
      return true;
    }
    if (['completed', 'done', 'success', 'idle'].includes(normalizedStatus)) {
      return false;
    }
    return Array.isArray(pipeline.stages) && pipeline.stages.some((stage) => stage.status === 'active');
  }).length;
}

function getWorkspaceArtifactTabIcon(kind: ArtifactKind): string {
  switch (kind) {
    case 'image':
      return 'image';
    case 'audio':
      return 'volume';
    case 'video':
      return 'play';
    case 'spreadsheet':
      return 'table';
    case 'pdf':
    case 'html':
      return 'file';
    case 'text':
    default:
      return 'fileText';
  }
}

function inferArtifactKindFromPath(filePath: string): ArtifactKind | null {
  const normalizedPath = String(filePath || '').toLowerCase();

  if (normalizedPath.endsWith('.pdf')) {
    return 'pdf';
  }

  if (
    normalizedPath.endsWith('.png')
    || normalizedPath.endsWith('.jpg')
    || normalizedPath.endsWith('.jpeg')
    || normalizedPath.endsWith('.gif')
    || normalizedPath.endsWith('.webp')
    || normalizedPath.endsWith('.svg')
  ) {
    return 'image';
  }

  if (
    normalizedPath.endsWith('.xlsx')
    || normalizedPath.endsWith('.xls')
    || normalizedPath.endsWith('.csv')
    || normalizedPath.endsWith('.tsv')
  ) {
    return 'spreadsheet';
  }

  if (
    normalizedPath.endsWith('.mp3')
    || normalizedPath.endsWith('.wav')
    || normalizedPath.endsWith('.m4a')
    || normalizedPath.endsWith('.ogg')
    || normalizedPath.endsWith('.webm')
  ) {
    return 'audio';
  }

  if (
    normalizedPath.endsWith('.mp4')
    || normalizedPath.endsWith('.mov')
    || normalizedPath.endsWith('.m4v')
    || normalizedPath.endsWith('.mkv')
  ) {
    return 'video';
  }

  if (
    normalizedPath.endsWith('.html')
    || normalizedPath.endsWith('.htm')
  ) {
    return 'html';
  }

  if (
    normalizedPath.endsWith('.txt')
    || normalizedPath.endsWith('.md')
    || normalizedPath.endsWith('.markdown')
    || normalizedPath.endsWith('.json')
    || normalizedPath.endsWith('.xml')
    || normalizedPath.endsWith('.yml')
    || normalizedPath.endsWith('.yaml')
    || normalizedPath.endsWith('.log')
    || normalizedPath.endsWith('.js')
    || normalizedPath.endsWith('.ts')
    || normalizedPath.endsWith('.jsx')
    || normalizedPath.endsWith('.tsx')
  ) {
    return 'text';
  }

  return null;
}

function isGeneratedLegalAnalysisDocument(document: KnowledgeDocumentRecord): boolean {
  const title = String(document.title || '').toLowerCase();
  const source = String(document.source || '').toLowerCase();
  const artifactPath = String(document.artifactPath || '').toLowerCase();

  return title.includes('agreeable agreements report')
    || title.includes('legal analysis report')
    || source.includes('legal_analysis_')
    || artifactPath.includes('/generated/legal-analysis/')
    || artifactPath.includes('/generated/assets/legal-analysis/');
}

function formatLegalReportStageLabel(report: LegalAnalysisReportRecord): string {
  const sourceTitle = String(report.sourceTitle || '').trim();
  if (!sourceTitle) {
    return 'Agreeable Review';
  }

  return sourceTitle.length > 34
    ? `${sourceTitle.slice(0, 31).trimEnd()}...`
    : sourceTitle;
}

function formatTutorialStageLabel(tutorialId?: string): string {
  const tutorial = tutorialId ? getBuiltinTutorialById(tutorialId) : null;
  const baseLabel = tutorial?.title || 'Tutorials';
  return baseLabel.length > 34
    ? `${baseLabel.slice(0, 31).trimEnd()}...`
    : baseLabel;
}

function getLegalFlagEmoji(flag: 'red' | 'yellow' | 'green'): string {
  switch (flag) {
    case 'red':
      return '🔴';
    case 'yellow':
      return '🟡';
    default:
      return '🟢';
  }
}

function getLegalFlagLabel(flag: 'red' | 'yellow' | 'green'): string {
  switch (flag) {
    case 'red':
      return 'Red Flag';
    case 'yellow':
      return 'Yellow Flag';
    default:
      return 'Green Flag';
  }
}

// ============================================================
// App Component
// ============================================================

const App: React.FC = () => {
  // ---- Session state ----
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectRecord | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatThinking, setChatThinking] = useState<{ stage: string; tool?: string } | null>(null);

  // ---- Voice / ElevenLabs state ----
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('disconnected');
  const [conversationMode, setConversationMode] = useState<ConversationMode>('idle');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isElevenLabsConfigured, setIsElevenLabsConfigured] = useState(false);
  const [isVoiceMicMuted, setIsVoiceMicMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const conversationRef = useRef<any>(null);
  const audioLevelInterval = useRef<any>(null);
  const finalizedVoiceSessionsRef = useRef<Set<string>>(new Set());
  const activeChatRequestRef = useRef<{ requestId: number; cancelled: boolean } | null>(null);
  const presentationUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const tutorialUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  // ---- UI state ----
  const [showSettings, setShowSettings] = useState(false);
  const [showContextPanel, setShowContextPanel] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [activeSurfaceTabId, setActiveSurfaceTabId] = useState<'chat' | 'workspace'>('chat');
  const [workspaceStageTabs, setWorkspaceStageTabs] = useState<WorkspaceStageTab[]>(createDefaultWorkspaceStageTabs);
  const [activeWorkspaceStageTabId, setActiveWorkspaceStageTabId] = useState<string>(WORKSPACE_MISSION_STAGE_TAB.id);
  const [workspacePresenterOpen, setWorkspacePresenterOpen] = useState(false);
  const [activeTutorialPlaybackId, setActiveTutorialPlaybackId] = useState<string | null>(null);
  const [showDiaryViewer, setShowDiaryViewer] = useState(false);
  const [showBugReportViewer, setShowBugReportViewer] = useState(false);
  const [showUsageViewer, setShowUsageViewer] = useState(false);
  const [usageOverview, setUsageOverview] = useState<UsageOverviewRecord | null>(null);
  const [isLoadingUsageOverview, setIsLoadingUsageOverview] = useState(false);
  const [showMarketingDepartment, setShowMarketingDepartment] = useState(false);
  const [showAgentHub, setShowAgentHub] = useState(false);
  const [agentHubListings, setAgentHubListings] = useState<AgentHubListing[]>([]);
  const [agentHubLoading, setAgentHubLoading] = useState(false);
  const [agentHubPublishing, setAgentHubPublishing] = useState(false);
  const [agentHubInstallingId, setAgentHubInstallingId] = useState<string | null>(null);
  const [agentHubDraft, setAgentHubDraft] = useState<AgentHubDraft>({
    name: '',
    tagline: '',
    description: '',
    category: 'General',
    sellerName: '',
    sellerContact: '',
    priceDollars: '0',
    template: 'lincutterz_growth_agent',
  });
  const [artifactViewer, setArtifactViewer] = useState<LoadedArtifact | null>(null);
  const [selectedLegalDocumentId, setSelectedLegalDocumentId] = useState('');
  const [legalUrlInput, setLegalUrlInput] = useState('');
  const [legalWebSearchQuery, setLegalWebSearchQuery] = useState('');
  const [legalWebSearchResults, setLegalWebSearchResults] = useState<LegalWebSearchResultRecord[]>([]);
  const [isLegalWebSearching, setIsLegalWebSearching] = useState(false);
  const [isLegalAnalyzing, setIsLegalAnalyzing] = useState(false);
  const [lastLegalAnalysisReport, setLastLegalAnalysisReport] = useState<LegalAnalysisReportRecord | null>(null);
  const [mediaStatus, setMediaStatus] = useState<MediaStatusRecord | null>(null);
  const [isLoadingMediaStatus, setIsLoadingMediaStatus] = useState(false);
  const [mediaBackend, setMediaBackend] = useState<'gemini' | 'local'>('gemini');
  const [mediaModel, setMediaModel] = useState('');
  const [selectedMediaVideoPaths, setSelectedMediaVideoPaths] = useState<string[]>([]);
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [mediaSearchResults, setMediaSearchResults] = useState<MediaSearchResultRecord[]>([]);
  const [isMediaIndexing, setIsMediaIndexing] = useState(false);
  const [isMediaSearching, setIsMediaSearching] = useState(false);
  const [isMediaStitching, setIsMediaStitching] = useState(false);
  const [isMediaRendering, setIsMediaRendering] = useState(false);
  const [selectedStitchVideoPaths, setSelectedStitchVideoPaths] = useState<string[]>([]);
  const [mediaStitchTitle, setMediaStitchTitle] = useState('Workspace Montage');
  const [selectedSlideshowImagePaths, setSelectedSlideshowImagePaths] = useState<string[]>([]);
  const [mediaSlideshowTitle, setMediaSlideshowTitle] = useState('Narrated Slideshow');
  const [mediaNarrationText, setMediaNarrationText] = useState('');
  const [presentationDeck, setPresentationDeck] = useState<PresentationModeDeck | null>(null);
  const [presentationSlideIndex, setPresentationSlideIndex] = useState(0);
  const [presentationAutoPlay, setPresentationAutoPlay] = useState(false);
  const [presentationStatus, setPresentationStatus] = useState<'idle' | 'preparing' | 'presenting' | 'paused'>('idle');
  const [activeSpreadsheetSheet, setActiveSpreadsheetSheet] = useState<string>('');
  const [spreadsheetFilterQuery, setSpreadsheetFilterQuery] = useState('');
  const [spreadsheetSortColumn, setSpreadsheetSortColumn] = useState('');
  const [spreadsheetSortDirection, setSpreadsheetSortDirection] = useState<'asc' | 'desc'>('asc');
  const [spreadsheetExportFormat, setSpreadsheetExportFormat] = useState<'xlsx' | 'xls' | 'csv' | 'tsv' | 'json'>('xlsx');
  const [spreadsheetChartType, setSpreadsheetChartType] = useState<'bar' | 'line'>('bar');
  const [spreadsheetChartLabelColumn, setSpreadsheetChartLabelColumn] = useState('');
  const [spreadsheetChartValueColumn, setSpreadsheetChartValueColumn] = useState('');
  const [spreadsheetOperationLabel, setSpreadsheetOperationLabel] = useState<string | null>(null);
  const [spreadsheetEditor, setSpreadsheetEditor] = useState<SpreadsheetCellEditor | null>(null);
  const [pipelineViewer, setPipelineViewer] = useState<Pipeline | null>(null);
  const [agentWorkflowViewer, setAgentWorkflowViewer] = useState<AgentWorkflowViewer | null>(null);
  const [agentWorkflowLoadingId, setAgentWorkflowLoadingId] = useState<string | null>(null);
  const [youtubeViewer, setYoutubeViewer] = useState<YouTubeViewer | null>(null);
  const [diagramViewer, setDiagramViewer] = useState<any | null>(null);
  const [bugReports, setBugReports] = useState<BugReportRecord[]>([]);
  const [isLoadingBugReports, setIsLoadingBugReports] = useState(false);
  const [isExportingBugReport, setIsExportingBugReport] = useState(false);
  const [marketingBridgeState, setMarketingBridgeState] = useState<MarketingBridgeState | null>(null);
  const [marketingDownloadStatus, setMarketingDownloadStatus] = useState<string | null>(null);
  const [artifactLoadingPath, setArtifactLoadingPath] = useState<string | null>(null);
  const [inlineImageCache, setInlineImageCache] = useState<Record<string, string>>({});
  const [isExportingSession, setIsExportingSession] = useState(false);
  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [networkHealthReport, setNetworkHealthReport] = useState<NetworkHealthReport | null>(null);
  const [isRunningNetworkHealth, setIsRunningNetworkHealth] = useState(false);
  const [ollamaState, setOllamaState] = useState<OllamaDiagnosticsState | null>(null);
  const [isRefreshingOllamaStatus, setIsRefreshingOllamaStatus] = useState(false);
  const [isRestartingOllama, setIsRestartingOllama] = useState(false);
  const [appliedVoiceAgentId, setAppliedVoiceAgentId] = useState('');

  // ---- Entity CRM state ----
  const [showEntityCrm, setShowEntityCrm] = useState(false);
  const [crmPeople, setCrmPeople] = useState<any[]>([]);
  const [crmBusinesses, setCrmBusinesses] = useState<any[]>([]);
  const [crmCounts, setCrmCounts] = useState<{ people: number; businesses: number; links: number }>({ people: 0, businesses: 0, links: 0 });
  const [crmSearchQuery, setCrmSearchQuery] = useState('');
  const [crmSearchResults, setCrmSearchResults] = useState<any[]>([]);
  const [crmActiveTab, setCrmActiveTab] = useState<'people' | 'businesses' | 'search'>('people');
  const [crmSelectedPerson, setCrmSelectedPerson] = useState<any | null>(null);
  const [crmSelectedBusiness, setCrmSelectedBusiness] = useState<any | null>(null);
  const [crmPersonBusinesses, setCrmPersonBusinesses] = useState<any[]>([]);
  const [crmBusinessPeople, setCrmBusinessPeople] = useState<any[]>([]);
  const [crmSessionContext, setCrmSessionContext] = useState<SessionEntityContextRecord | null>(null);
  const [crmEntityKnowledge, setCrmEntityKnowledge] = useState<EntityKnowledgeRecord | null>(null);
  const [crmEntityKnowledgeLoading, setCrmEntityKnowledgeLoading] = useState(false);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmBackfillRunning, setCrmBackfillRunning] = useState(false);
  const [crmBackfillProgress, setCrmBackfillProgress] = useState('');
  const [crmEditMode, setCrmEditMode] = useState(false);
  const [crmEditData, setCrmEditData] = useState<any>({});
  const crmEditDataRef = useRef<any>({});
  const crmSelectedPersonRef = useRef<any>(null);
  const crmSelectedBusinessRef = useRef<any>(null);
  const [crmShowCreateForm, setCrmShowCreateForm] = useState<'person' | 'business' | null>(null);
  const [crmCreateData, setCrmCreateData] = useState<any>({});
  const [crmDeleteConfirm, setCrmDeleteConfirm] = useState<{ type: 'person' | 'business'; id: string; name: string } | null>(null);
  const [crmMergeState, setCrmMergeState] = useState<CrmMergeState | null>(null);
  const [crmMergeResults, setCrmMergeResults] = useState<any[]>([]);
  const [crmMerging, setCrmMerging] = useState(false);
  const [crmChatThreads, setCrmChatThreads] = useState<Record<string, CrmChatMessageRecord[]>>({});
  const [crmChatInput, setCrmChatInput] = useState('');
  const [crmChatLoadingKey, setCrmChatLoadingKey] = useState<string | null>(null);
  const crmChatMessagesRef = useRef<HTMLDivElement | null>(null);

  // ---- Meeting Mode state ----
  const [meetingModeActive, setMeetingModeActive] = useState(false);
  const [meetingModeStatus, setMeetingModeStatus] = useState<'listening' | 'generating' | 'paused' | 'ended'>('listening');
  const [meetingEntities, setMeetingEntities] = useState<any[]>([]);
  const [meetingFacts, setMeetingFacts] = useState<any[]>([]);
  const [meetingTopics, setMeetingTopics] = useState<any[]>([]);
  const [meetingInfographics, setMeetingInfographics] = useState<any[]>([]);
  const [meetingSentiment, setMeetingSentiment] = useState<any[]>([]);
  const [meetingResearchSuggestions, setMeetingResearchSuggestions] = useState<any[]>([]);
  const [meetingBriefing, setMeetingBriefing] = useState<any | null>(null);
  const [showMeetingBriefing, setShowMeetingBriefing] = useState(false);
  const [meetingCarouselIndex, setMeetingCarouselIndex] = useState(0);

  // ---- Task Queue state ----
  const [rollingTodoBoard, setRollingTodoBoard] = useState<RollingTodoBoardRecord | null>(null);
  const [rollingTodoDrafts, setRollingTodoDrafts] = useState<Record<number, RollingTodoItemDraft>>({});
  const [showRollingTodoModal, setShowRollingTodoModal] = useState(false);
  const [isRollingTodoLoading, setIsRollingTodoLoading] = useState(false);
  const [isRollingTodoRefreshing, setIsRollingTodoRefreshing] = useState(false);
  const [isRollingTodoExporting, setIsRollingTodoExporting] = useState(false);
  const [isRollingTodoEmailing, setIsRollingTodoEmailing] = useState(false);
  const [rollingTodoSavingSlot, setRollingTodoSavingSlot] = useState<number | null>(null);
  const [rollingTodoRecipient, setRollingTodoRecipient] = useState('');
  const [rollingTodoEmailSubject, setRollingTodoEmailSubject] = useState('');

  const resetWorkspaceStageTabs = useCallback(() => {
    setWorkspaceStageTabs(createDefaultWorkspaceStageTabs());
    setActiveWorkspaceStageTabId(WORKSPACE_MISSION_STAGE_TAB.id);
    setWorkspacePresenterOpen(false);
  }, []);

  const activateWorkspaceStageTab = useCallback((tab: WorkspaceStageTab, options?: { present?: boolean }) => {
    setActiveSurfaceTabId('workspace');
    setActiveWorkspaceStageTabId(tab.id);
    const shouldPresent = options?.present ?? tab.type !== 'mission';
    setWorkspacePresenterOpen(shouldPresent && tab.type !== 'mission');

    if (tab.type === 'artifact') {
      setArtifactViewer(tab.artifact);
      setYoutubeViewer(null);
      return;
    }

    if (tab.type === 'legal-report') {
      setArtifactViewer(null);
      setYoutubeViewer(null);
      return;
    }

    if (tab.type === 'youtube') {
      setYoutubeViewer(tab.viewer);
      setArtifactViewer(null);
      return;
    }

    setArtifactViewer(null);
    setYoutubeViewer(null);
  }, []);

  const upsertWorkspaceStageTab = useCallback((tab: WorkspaceStageTab) => {
    const existing = workspaceStageTabs.find((candidate) => candidate.sourceKey === tab.sourceKey);
    const resolvedTab = existing ? { ...tab, id: existing.id } as WorkspaceStageTab : tab;
    const nextTabs = existing
      ? workspaceStageTabs.map((candidate) => candidate.id === existing.id ? resolvedTab : candidate)
      : [...workspaceStageTabs, resolvedTab];

    setWorkspaceStageTabs(nextTabs);
    activateWorkspaceStageTab(resolvedTab, { present: resolvedTab.type !== 'mission' });
    return resolvedTab;
  }, [activateWorkspaceStageTab, workspaceStageTabs]);

  const closeWorkspaceStageTab = useCallback((tabId: string) => {
    const target = workspaceStageTabs.find((candidate) => candidate.id === tabId);
    if (!target || !target.closable) {
      return;
    }

    const remainingTabs = workspaceStageTabs.filter((candidate) => candidate.id !== tabId);
    setWorkspaceStageTabs(remainingTabs);

    if (activeWorkspaceStageTabId !== tabId) {
      return;
    }

    const fallbackTab = remainingTabs[remainingTabs.length - 1] || WORKSPACE_MISSION_STAGE_TAB;
    activateWorkspaceStageTab(fallbackTab, { present: fallbackTab.type !== 'mission' });
  }, [activateWorkspaceStageTab, activeWorkspaceStageTabId, workspaceStageTabs]);

  const stageArtifactInWorkspace = useCallback((loaded: LoadedArtifact) => {
    upsertWorkspaceStageTab({
      id: `artifact:${loaded.path}`,
      sourceKey: `artifact:${loaded.path}`,
      type: 'artifact',
      label: loaded.name || basenameFromUiPath(loaded.path) || 'Artifact',
      icon: getWorkspaceArtifactTabIcon(loaded.kind),
      closable: true,
      artifact: loaded,
    });
  }, [upsertWorkspaceStageTab]);

  const stageYouTubeViewerInWorkspace = useCallback((viewer: YouTubeViewer) => {
    const sourceKey = `youtube:${viewer.videoId || viewer.sourceUrl}`;
    upsertWorkspaceStageTab({
      id: sourceKey,
      sourceKey,
      type: 'youtube',
      label: viewer.title || 'Video',
      icon: 'play',
      closable: true,
      viewer,
    });
  }, [upsertWorkspaceStageTab]);

  const stageLegalReportInWorkspace = useCallback((report: LegalAnalysisReportRecord) => {
    upsertWorkspaceStageTab({
      id: `legal-report:${report.id}`,
      sourceKey: `legal-report:${report.id}`,
      type: 'legal-report',
      label: formatLegalReportStageLabel(report),
      icon: report.summary.red > 0 ? 'alertTriangle' : 'fileText',
      closable: true,
      report,
    });
  }, [upsertWorkspaceStageTab]);

  const stageTutorialsInWorkspace = useCallback((tutorialId?: string) => {
    const resolvedTutorialId = getBuiltinTutorialById(tutorialId || '')?.id || BUILTIN_TUTORIALS[0]?.id || '';
    upsertWorkspaceStageTab({
      id: WORKSPACE_TUTORIAL_STAGE_ID,
      sourceKey: WORKSPACE_TUTORIAL_STAGE_ID,
      type: 'tutorials',
      label: formatTutorialStageLabel(resolvedTutorialId),
      icon: 'bookOpen',
      closable: true,
      tutorialId: resolvedTutorialId,
    });
  }, [upsertWorkspaceStageTab]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoRenamedSessionIdsRef = useRef<Set<string>>(new Set());

  const touchSessionActivity = useCallback((sessionId?: string, timestamp = Date.now()) => {
    if (!sessionId) {
      return;
    }

    setSessions((prev) => {
      const next = prev.map((session) => (
        session.id === sessionId
          ? { ...session, updatedAt: Math.max(session.updatedAt || 0, timestamp) }
          : session
      ));

      next.sort((left, right) => {
        const leftTime = left.updatedAt || left.createdAt || 0;
        const rightTime = right.updatedAt || right.createdAt || 0;
        return rightTime - leftTime;
      });

      return next;
    });

    setCurrentSession((prev) => (
      prev && prev.id === sessionId
        ? { ...prev, updatedAt: Math.max(prev.updatedAt || 0, timestamp) }
        : prev
    ));
  }, []);

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const message: Message = {
      ...msg,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, message]);
    touchSessionActivity(currentSession?.id, message.timestamp);
    return message.id;
  }, [currentSession?.id, touchSessionActivity]);

  const addSystemMessage = useCallback((content: string) => {
    addMessage({ role: 'system', content, type: 'text' });
    if (shouldRecordSystemMessageBug(content)) {
      void nexus.bugs.record({
        sessionId: currentSession?.id,
        source: 'renderer:system-message',
        intent: 'Complete the app action that produced this system status message.',
        actual: content,
      }).catch((error: any) => {
        console.warn('[Emergent] Failed to record bug report:', error);
      });
    }
  }, [addMessage, currentSession?.id]);

  const openWorkflowBuilder = useCallback(async () => {
    try {
      const existing = await nexus.diagrams.list(1);
      if (Array.isArray(existing) && existing.length > 0) {
        setDiagramViewer(existing[0]);
        return;
      }

      const created = await nexus.diagrams.create('Workflow Builder', {
        kind: 'flowchart',
        title: 'Workflow Builder',
        subtitle: 'Builder scratchpad',
        layout: 'horizontal',
        nodes: [
          { id: 'start', label: 'Start', sub: 'entry point', color: 'blue', shape: 'pill' },
          { id: 'plan', label: 'Plan', sub: 'scope the workflow', color: 'purple', shape: 'rect' },
          { id: 'build', label: 'Build', sub: 'execute the work', color: 'cyan', shape: 'rect' },
          { id: 'review', label: 'Review', sub: 'inspect and refine', color: 'green', shape: 'diamond' },
        ],
        edges: [
          { from: 'start', to: 'plan', color: 'slate' },
          { from: 'plan', to: 'build', color: 'slate' },
          { from: 'build', to: 'review', color: 'slate' },
        ],
      }, currentSession?.id);
      setDiagramViewer(created);
    } catch (error: any) {
      addSystemMessage(`Failed to open Workflow Builder: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, currentSession?.id]);

  const hydrateRollingTodoDrafts = useCallback((board: RollingTodoBoardRecord | null) => {
    if (!board) {
      setRollingTodoDrafts({});
      return;
    }

    const nextDrafts = board.items.reduce<Record<number, RollingTodoItemDraft>>((accumulator, item) => {
      accumulator[item.slotIndex] = {
        userTitle: item.userTitle || '',
        userNextAction: item.userNextAction || '',
        userNotes: item.userNotes || '',
        owner: item.owner || 'shared',
        status: item.status || 'pending',
        needsUser: Boolean(item.needsUser),
        canAgentHelp: Boolean(item.canAgentHelp),
        isPinned: Boolean(item.isPinned),
        remindAfterMinutes: inferRollingTodoReminderMinutes(item.remindAfterAt),
      };
      return accumulator;
    }, {});

    setRollingTodoDrafts(nextDrafts);
  }, []);

  // ---- Settings state ----
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState(DEFAULT_ELEVENLABS_AGENT_ID);
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(DEFAULT_ELEVENLABS_VOICE_ID);
  const [heyGenApiKey, setHeyGenApiKey] = useState('');
  const [xaiApiKey, setXaiApiKey] = useState('');
  const [klaviyoApiKey, setKlaviyoApiKey] = useState('');
  const [notionApiKey, setNotionApiKey] = useState('');
  const [lincutterzNotionDatabaseId, setLincutterzNotionDatabaseId] = useState('');
  const [socialSchedulerWebhookUrl, setSocialSchedulerWebhookUrl] = useState('');
  const [figmaBridgeWebhookUrl, setFigmaBridgeWebhookUrl] = useState('');
  const [marketplaceBridgeWebhookUrl, setMarketplaceBridgeWebhookUrl] = useState('');
  const [marketingVoiceProfiles, setMarketingVoiceProfiles] = useState<MarketingVoiceProfile[]>([]);
  const [heyGenAvatarProfiles, setHeyGenAvatarProfiles] = useState<HeyGenAvatarProfile[]>([]);
  const [marketingVideoConfig, setMarketingVideoConfig] = useState<MarketingVideoConfig | null>(null);
  const [heyGenVideoTitle, setHeyGenVideoTitle] = useState('Lincutterz prospect video');
  const [heyGenVideoScript, setHeyGenVideoScript] = useState('');
  const [selectedMarketingVoiceProfileId, setSelectedMarketingVoiceProfileId] = useState('');
  const [selectedHeyGenAvatarProfileId, setSelectedHeyGenAvatarProfileId] = useState('');
  const [heyGenCaptionEnabled, setHeyGenCaptionEnabled] = useState(false);
  const [isCreatingHeyGenVideo, setIsCreatingHeyGenVideo] = useState(false);
  const [isAssistingHeyGenScript, setIsAssistingHeyGenScript] = useState(false);
  const [heyGenVideoResult, setHeyGenVideoResult] = useState<Record<string, any> | null>(null);
  const [grokMediaMode, setGrokMediaMode] = useState<'image' | 'video'>('image');
  const [grokMediaTitle, setGrokMediaTitle] = useState('Lincutterz Grok media');
  const [grokMediaPrompt, setGrokMediaPrompt] = useState('');
  const [grokMediaImageUrl, setGrokMediaImageUrl] = useState('');
  const [grokMediaImagePath, setGrokMediaImagePath] = useState('');
  const [grokImageAspectRatio, setGrokImageAspectRatio] = useState('16:9');
  const [grokImageResolution, setGrokImageResolution] = useState('1k');
  const [grokVideoDuration, setGrokVideoDuration] = useState(8);
  const [grokVideoAspectRatio, setGrokVideoAspectRatio] = useState('16:9');
  const [grokVideoResolution, setGrokVideoResolution] = useState('720p');
  const [isAssistingGrokPrompt, setIsAssistingGrokPrompt] = useState(false);
  const [isCreatingGrokMedia, setIsCreatingGrokMedia] = useState(false);
  const [grokMediaResult, setGrokMediaResult] = useState<Record<string, any> | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [openAiApiKey, setOpenAiApiKey] = useState('');
  const [deepgramApiKey, setDeepgramApiKey] = useState('');
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [operatorCommChannel, setOperatorCommChannel] = useState<OperatorCommunicationChannel>('notification');
  const [operatorSelfTextShortcutName, setOperatorSelfTextShortcutName] = useState(DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT);
  const [operatorTaskAlertsEnabled, setOperatorTaskAlertsEnabled] = useState(false);
  const [operatorDailyBriefingEnabled, setOperatorDailyBriefingEnabled] = useState(false);
  const [operatorDailyBriefingTime, setOperatorDailyBriefingTime] = useState(DEFAULT_OPERATOR_DAILY_BRIEFING_TIME);
  const [operatorCommsStatus, setOperatorCommsStatus] = useState('');
  const [isSendingOperatorTest, setIsSendingOperatorTest] = useState(false);
  const [isSendingOperatorBriefing, setIsSendingOperatorBriefing] = useState(false);
  const [masterDiaryEntries, setMasterDiaryEntries] = useState<DiaryEntry[]>([]);
  const [masterNarratives, setMasterNarratives] = useState<NarrativeSnapshot[]>([]);
  const [creatingSessionDiary, setCreatingSessionDiary] = useState(false);
  const [diaryAudioPlaying, setDiaryAudioPlaying] = useState<string | null>(null);
  const diaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const seenTaskStatusRef = useRef<Map<string, Task['status']>>(new Map());
  const taskAlertContextRef = useRef('');
  const lastDailyBriefingDateRef = useRef('');
  const lastDailyBriefingAttemptRef = useRef('');
  const ollamaStatusTone = getOllamaStatusTone(ollamaState?.status);
  const ollamaStatusLabel = formatOllamaStatusLabel(ollamaState?.status);
  const ollamaStatusIcon = ollamaStatusTone === 'healthy'
    ? 'check'
    : ollamaStatusTone === 'warning'
      ? 'loader'
      : 'alertTriangle';
  const ollamaStatusSummary = ollamaState?.error
    ? ollamaState.error
    : ollamaState?.status === 'ready'
      ? 'Local Ollama is ready for offline text chat.'
      : ollamaState?.status === 'running'
        ? 'Local Ollama is running and available.'
        : ollamaState?.status === 'starting'
          ? 'Local Ollama is starting up.'
          : ollamaState?.status === 'pulling_models'
            ? 'Local Ollama is pulling required models.'
            : ollamaState?.status === 'not_installed'
              ? 'Ollama is not installed on this machine.'
              : ollamaState?.status === 'stopped'
                ? 'Local Ollama is not running.'
                : 'Checking local Ollama status.';

  const stopDiaryAudio = useCallback(() => {
    if (diaryAudioRef.current) {
      diaryAudioRef.current.pause();
      diaryAudioRef.current.onended = null;
      diaryAudioRef.current.onerror = null;
      diaryAudioRef.current = null;
    }
    window.speechSynthesis.cancel();
    setDiaryAudioPlaying(null);
  }, []);

  const playDiaryWithElevenLabs = useCallback(async (entryId: string, text: string) => {
    // Stop any currently playing audio (HTML5 Audio or browser speech)
    if (diaryAudioRef.current) {
      diaryAudioRef.current.pause();
      diaryAudioRef.current.onended = null;
      diaryAudioRef.current.onerror = null;
      diaryAudioRef.current = null;
    }
    window.speechSynthesis.cancel();

    // Toggle off if same entry is already playing
    if (diaryAudioPlaying === entryId) {
      setDiaryAudioPlaying(null);
      return;
    }

    // Track which entry we're loading audio for (guards against race conditions)
    const requestedEntry = entryId;
    setDiaryAudioPlaying(entryId);

    try {
      const dataUrl = await nexus.elevenlabs.ttsSpeak(text);

      // Guard: if user clicked a different entry while we were fetching, abort
      if (diaryAudioRef.current !== null) {
        return; // Another entry started playing during our fetch
      }

      const audio = new Audio(dataUrl);
      diaryAudioRef.current = audio;

      const cleanup = () => {
        setDiaryAudioPlaying((current) => current === requestedEntry ? null : current);
        if (diaryAudioRef.current === audio) {
          diaryAudioRef.current = null;
        }
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;
      await audio.play();
    } catch (err: any) {
      console.warn('[Diary] ElevenLabs TTS failed, falling back to browser speech:', err.message);
      // Fallback to browser speech synthesis if ElevenLabs unavailable
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.onend = () => setDiaryAudioPlaying((current) => current === requestedEntry ? null : current);
      utterance.onerror = () => setDiaryAudioPlaying((current) => current === requestedEntry ? null : current);
      window.speechSynthesis.speak(utterance);
    }
  }, [diaryAudioPlaying]);

  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileRecord[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocumentRecord[]>([]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [sessionSearchIndex, setSessionSearchIndex] = useState<Record<string, string>>({});
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [brainstormSearchQuery, setBrainstormSearchQuery] = useState('');
  const [diarySearchQuery, setDiarySearchQuery] = useState('');
  const [workspaceFileSearchQuery, setWorkspaceFileSearchQuery] = useState('');
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState('');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [pipelineSearchQuery, setPipelineSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchPayload | null>(null);
  const [isGlobalSearchLoading, setIsGlobalSearchLoading] = useState(false);
  const [copiedTextKey, setCopiedTextKey] = useState<string | null>(null);

  // ---- Knowledge Stats ----
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats>({
    tier1: 0, tier2: 0, tier3: 0, documents: 0,
  });

  const legalAnalyzableDocuments = useMemo(
    () => knowledgeDocuments.filter((document) => !isGeneratedLegalAnalysisDocument(document)),
    [knowledgeDocuments]
  );

  // ---- YouTube Transcript state ----
  const [ytChannels, setYtChannels] = useState<any[]>([]);
  const [ytTranscripts, setYtTranscripts] = useState<YouTubeTranscriptRecord[]>([]);
  const [ytStats, setYtStats] = useState<{ channels: number; transcripts: number; totalChars: number }>({ channels: 0, transcripts: 0, totalChars: 0 });
  const [ytUrlInput, setYtUrlInput] = useState('');
  const [ytChannelInput, setYtChannelInput] = useState('');
  const [ytLoading, setYtLoading] = useState(false);
  const [ytExpandedChannel, setYtExpandedChannel] = useState<string | null>(null);
  const [ytSelectedTranscript, setYtSelectedTranscript] = useState<YouTubeTranscriptRecord | null>(null);
  const [ytTranscriptLoadingId, setYtTranscriptLoadingId] = useState<string | null>(null);
  const [ytExportingTranscriptId, setYtExportingTranscriptId] = useState<string | null>(null);

  // ---- Brainstorm state ----
  const [brainstormTitle, setBrainstormTitle] = useState('');
  const [brainstormSessions, setBrainstormSessions] = useState<BrainstormSessionRecord[]>([]);
  const [selectedBrainstormId, setSelectedBrainstormId] = useState<string | null>(null);
  const [isBrainstormRecording, setIsBrainstormRecording] = useState(false);
  const [isBrainstormProcessing, setIsBrainstormProcessing] = useState(false);
  const [isDeletingBrainstormId, setIsDeletingBrainstormId] = useState<string | null>(null);
  const [editingSpeakerIndex, setEditingSpeakerIndex] = useState<number | null>(null);
  const [editingSpeakerValue, setEditingSpeakerValue] = useState('');
  const [brainstormElapsedMs, setBrainstormElapsedMs] = useState(0);
  const brainstormRecorderRef = useRef<MediaRecorder | null>(null);
  const brainstormStreamRef = useRef<MediaStream | null>(null);
  const brainstormChunksRef = useRef<Blob[]>([]);
  const brainstormTimerRef = useRef<number | null>(null);
  const brainstormStartedAtRef = useRef<number | null>(null);
  const activeBrainstormIdRef = useRef<string | null>(null);
  const startConversationRef = useRef<((options?: StartConversationOptions) => Promise<void>) | null>(null);
  const sessionSearchIndexLoadingRef = useRef<Set<string>>(new Set());

  const mapSessionRecord = useCallback((session: any): Session => ({
    id: session.id,
    name: session.name,
    createdAt: new Date(session.createdAt || Date.now()).getTime(),
    updatedAt: new Date(session.updatedAt || session.createdAt || Date.now()).getTime(),
    messageCount: session.messageCount || 0,
  }), []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const sessionData = await nexus.sessions.get(sessionId);
      if (sessionData?.messages) {
        setSessionSearchIndex((prev) => {
          const nextText = buildSessionMessageSearchText(sessionData.messages);
          return prev[sessionId] === nextText ? prev : { ...prev, [sessionId]: nextText };
        });

        setMessages(sessionData.messages.map((message: any) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: new Date(message.createdAt || Date.now()).getTime(),
          model: message.model || null,
          tier: typeof message.tier === 'number' ? message.tier : (message.tier ? Number(message.tier) : null),
          toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : [],
          type: 'text' as const,
        })));
      } else {
        setSessionSearchIndex((prev) => (
          prev[sessionId] === '' ? prev : { ...prev, [sessionId]: '' }
        ));
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, []);

  const loadBrainstormSessions = useCallback(async (sessionId: string) => {
    try {
      const records = await nexus.brainstorm.list(sessionId);
      setBrainstormSessions(records || []);
    } catch {
      setBrainstormSessions([]);
    }
  }, []);

  const refreshMasterDiary = useCallback(async () => {
    try {
      const [entries, narratives] = await Promise.all([
        nexus.masterDiary.list(12),
        nexus.masterDiary.narratives(4),
      ]);
      setMasterDiaryEntries(entries || []);
      setMasterNarratives(narratives || []);
    } catch (error) {
      console.error('[Emergent] Failed to refresh master diary:', error);
    }
  }, []);

  const openDiaryViewer = useCallback(async () => {
    try {
      const [entries, narratives] = await Promise.all([
        nexus.masterDiary.list(80),
        nexus.masterDiary.narratives(14),
      ]);
      setMasterDiaryEntries(entries || []);
      setMasterNarratives(narratives || []);
    } catch (error) {
      console.error('[Emergent] Failed to expand master diary viewer:', error);
    }

    setShowDiaryViewer(true);
  }, []);

  const loadBugReports = useCallback(async () => {
    setIsLoadingBugReports(true);
    try {
      const reports = await nexus.bugs.list({ limit: 120 });
      setBugReports((reports || []) as BugReportRecord[]);
    } catch (error) {
      console.error('[Emergent] Failed to load bug reports:', error);
    } finally {
      setIsLoadingBugReports(false);
    }
  }, []);

  const openBugReportViewer = useCallback(async () => {
    setShowBugReportViewer(true);
    await loadBugReports();
  }, [loadBugReports]);

  const loadUsageOverview = useCallback(async () => {
    setIsLoadingUsageOverview(true);
    try {
      const overview = await nexus.usage.overview();
      setUsageOverview((overview || null) as UsageOverviewRecord | null);
    } catch (error) {
      console.error('[Emergent] Failed to load usage overview:', error);
    } finally {
      setIsLoadingUsageOverview(false);
    }
  }, []);

  const openUsageViewer = useCallback(async () => {
    setShowUsageViewer(true);
    await loadUsageOverview();
  }, [loadUsageOverview]);

  const refreshWorkspaceFiles = useCallback(async () => {
    try {
      const files = await nexus.artifacts.listWorkspaceFiles(24);
      setWorkspaceFiles(files || []);
    } catch (error) {
      console.error('[Emergent] Failed to load workspace files:', error);
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const records = await nexus.projects.list(18);
      setProjects(records || []);
    } catch (error) {
      console.error('[Emergent] Failed to load projects:', error);
    }
  }, []);

  const refreshCurrentProject = useCallback(async (sessionId?: string, hintText?: string) => {
    if (!sessionId) {
      setCurrentProject(null);
      return;
    }

    try {
      const ensured = await nexus.projects.ensureSession(sessionId, hintText);
      setCurrentProject(ensured || null);
      void refreshProjects();
    } catch (error) {
      console.error('[Emergent] Failed to resolve current project:', error);
    }
  }, [refreshProjects]);

  const refreshKnowledgeDocuments = useCallback(async (sessionId?: string) => {
    try {
      const docs = await nexus.knowledge.listDocuments(sessionId, 18);
      setKnowledgeDocuments(docs || []);
    } catch (error) {
      console.error('[Emergent] Failed to load knowledge documents:', error);
    }
  }, []);

  const refreshKnowledgeStats = useCallback(async (sessionId?: string) => {
    try {
      const stats = await nexus.knowledge.stats(sessionId);
      setKnowledgeStats({
        tier1: Number(stats?.tier1) || 0,
        tier2: Number(stats?.tier2) || 0,
        tier3: Number(stats?.tier3) || 0,
        documents: Number(stats?.documents) || 0,
      });
    } catch (error) {
      console.error('[Emergent] Failed to load knowledge stats:', error);
    }
  }, []);

  const refreshYouTubeData = useCallback(async () => {
    try {
      const [channels, stats, transcripts] = await Promise.all([
        nexus.youtube.listChannels(),
        nexus.youtube.stats(),
        nexus.youtube.listTranscripts({ limit: 20 }),
      ]);
      setYtChannels(channels || []);
      setYtStats(stats || { channels: 0, transcripts: 0, totalChars: 0 });
      setYtTranscripts((transcripts || []) as YouTubeTranscriptRecord[]);
    } catch (error) {
      console.error('[Emergent] Failed to load YouTube data:', error);
    }
  }, []);

  const markTextCopied = useCallback((key: string) => {
    setCopiedTextKey(key);
    if (copyFeedbackTimerRef.current) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedTextKey((current) => (current === key ? null : current));
    }, 1600);
  }, []);

  const copyTextValue = useCallback(async (value: string, key: string) => {
    const normalized = String(value || '');
    if (!normalized.trim()) {
      return;
    }

    try {
      let copied = false;

      if (nexus.clipboard?.writeText) {
        try {
          copied = await nexus.clipboard.writeText(normalized);
        } catch (error) {
          console.warn('[Emergent] Clipboard bridge copy failed:', error);
        }
      }

      if (!copied && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(normalized);
          copied = true;
        } catch (error) {
          console.warn('[Emergent] Navigator clipboard copy failed:', error);
        }
      }

      if (!copied && typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = normalized;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, normalized.length);
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      if (!copied) {
        throw new Error('Clipboard write was not permitted in this renderer context.');
      }

      markTextCopied(key);
    } catch (error: any) {
      addSystemMessage(`Failed to copy text: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, markTextCopied]);

  const renderFieldCopyRow = useCallback((value: string, key: string, label: string = 'Copy') => {
    const normalized = String(value || '');
    if (!normalized.trim()) {
      return null;
    }

    return (
      <div className="field-copy-row">
        <button
          type="button"
          className="field-copy-button"
          onClick={() => void copyTextValue(normalized, key)}
        >
          <Icon name={copiedTextKey === key ? 'check' : 'clipboard'} size={12} />
          <span>{copiedTextKey === key ? 'Copied' : label}</span>
        </button>
      </div>
    );
  }, [copiedTextKey, copyTextValue]);

  const runGlobalSearch = useCallback(async (query: string) => {
    setIsGlobalSearchLoading(true);
    try {
      const results = await nexus.knowledge.globalSearch(query, {
        sessionId: currentSession?.id,
        limitPerSource: 4,
        globalScope: true,
      });
      setGlobalSearchResults((results || null) as GlobalSearchPayload | null);
    } catch (error) {
      console.error('[Emergent] Failed to run global search:', error);
    } finally {
      setIsGlobalSearchLoading(false);
    }
  }, [currentSession?.id]);

  const openYouTubeTranscript = useCallback(async (transcriptId: string) => {
    setYtTranscriptLoadingId(transcriptId);
    try {
      const transcript = await nexus.youtube.getTranscript(transcriptId);
      if (!transcript) {
        addSystemMessage('That YouTube transcript could not be loaded.');
        return;
      }
      setYtSelectedTranscript(transcript as YouTubeTranscriptRecord);
    } catch (error: any) {
      addSystemMessage(`Failed to open YouTube transcript: ${error.message || 'Unknown error'}`);
    } finally {
      setYtTranscriptLoadingId(null);
    }
  }, [addSystemMessage]);

  const exportYouTubeTranscriptPdf = useCallback(async (transcript: YouTubeTranscriptRecord) => {
    setYtExportingTranscriptId(transcript.id);
    try {
      const exported = await nexus.youtube.exportTranscriptPdf(transcript.id);
      const updatedTranscript = (exported?.transcript || transcript) as YouTubeTranscriptRecord;
      setYtSelectedTranscript(updatedTranscript);
      addSystemMessage(`YouTube transcript PDF created at ${exported.path}`);
      if (exported.path) {
        const loaded = await nexus.artifacts.load(exported.path);
        stageArtifactInWorkspace({
          path: loaded.path,
          name: loaded.name,
          kind: loaded.kind,
          dataUrl: loaded.dataUrl,
          mimeType: loaded.mimeType,
          textContent: loaded.textContent,
          spreadsheetData: loaded.spreadsheetData,
        });
      }
      await refreshYouTubeData();
    } catch (error: any) {
      addSystemMessage(`Failed to export YouTube transcript PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setYtExportingTranscriptId(null);
    }
  }, [addSystemMessage, refreshYouTubeData, stageArtifactInWorkspace]);

  const handleFetchYouTubeTranscript = useCallback(async () => {
    const value = ytUrlInput.trim();
    if (!value) {
      return;
    }

    setYtLoading(true);
    try {
      const transcript = await nexus.youtube.fetchTranscript(value, currentSession?.id);
      setYtUrlInput('');
      if (transcript) {
        setYtSelectedTranscript(transcript as YouTubeTranscriptRecord);
      }
      await refreshYouTubeData();
      if (currentSession?.id) {
        await Promise.all([
          refreshKnowledgeDocuments(currentSession.id),
          refreshKnowledgeStats(currentSession.id),
        ]);
      }
      void runGlobalSearch(globalSearchQuery);
    } catch (error: any) {
      console.error('[YouTube] Transcript fetch failed:', error);
      addSystemMessage(`Failed to fetch YouTube transcript: ${error.message || 'Unknown error'}`);
    } finally {
      setYtLoading(false);
    }
  }, [
    addSystemMessage,
    currentSession?.id,
    globalSearchQuery,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshYouTubeData,
    runGlobalSearch,
    ytUrlInput,
  ]);

  const handleSubscribeYouTubeChannel = useCallback(async () => {
    const value = ytChannelInput.trim();
    if (!value) {
      return;
    }

    setYtLoading(true);
    try {
      await nexus.youtube.subscribeChannel(value, currentSession?.id);
      setYtChannelInput('');
      await refreshYouTubeData();
      if (currentSession?.id) {
        await Promise.all([
          refreshKnowledgeDocuments(currentSession.id),
          refreshKnowledgeStats(currentSession.id),
        ]);
      }
      void runGlobalSearch(globalSearchQuery);
    } catch (error: any) {
      console.error('[YouTube] Channel subscribe failed:', error);
      addSystemMessage(`Failed to subscribe to YouTube channel: ${error.message || 'Unknown error'}`);
    } finally {
      setYtLoading(false);
    }
  }, [
    addSystemMessage,
    currentSession?.id,
    globalSearchQuery,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshYouTubeData,
    runGlobalSearch,
    ytChannelInput,
  ]);

  const refreshRollingTodoBoard = useCallback(async (
    sessionId?: string,
    options: { force?: boolean; reason?: string; silent?: boolean } = {}
  ) => {
    if (!sessionId) {
      setRollingTodoBoard(null);
      hydrateRollingTodoDrafts(null);
      return null;
    }

    const shouldShowBusy = !options.silent;

    if (shouldShowBusy) {
      if (options.force) {
        setIsRollingTodoRefreshing(true);
      } else {
        setIsRollingTodoLoading(true);
      }
    }

    try {
      const board = options.force
        ? await nexus.rollingTodo.refresh(sessionId, true, options.reason || 'renderer_manual_refresh')
        : await nexus.rollingTodo.refresh(sessionId, false, options.reason || 'renderer_sync');
      setRollingTodoBoard(board || null);
      hydrateRollingTodoDrafts(board || null);
      void refreshSessionContext(sessionId);
      return board || null;
    } catch (error) {
      console.error('[Emergent] Failed to refresh task queue board:', error);
      return null;
    } finally {
      if (shouldShowBusy) {
        setIsRollingTodoLoading(false);
        setIsRollingTodoRefreshing(false);
      }
    }
  }, [hydrateRollingTodoDrafts]);

  const updateRollingTodoDraft = useCallback((
    slotIndex: number,
    field: keyof RollingTodoItemDraft,
    value: string | boolean | RollingTodoOwner | RollingTodoStatus | number
  ) => {
    setRollingTodoDrafts((previous) => ({
      ...previous,
      [slotIndex]: {
        ...(previous[slotIndex] || {
          userTitle: '',
          userNextAction: '',
          userNotes: '',
          owner: 'shared',
          status: 'pending',
          needsUser: false,
          canAgentHelp: true,
          isPinned: false,
          remindAfterMinutes: 45,
        }),
        [field]: value,
      },
    }));
  }, []);

  const saveRollingTodoItem = useCallback(async (slotIndex: number) => {
    if (!currentSession?.id) {
      addSystemMessage('Select or create a session before editing the task queue.');
      return;
    }

    const draft = rollingTodoDrafts[slotIndex];
    if (!draft) {
      return;
    }

    setRollingTodoSavingSlot(slotIndex);

    try {
      const board = await nexus.rollingTodo.updateItem(currentSession.id, slotIndex, {
        userTitle: draft.userTitle,
        userNextAction: draft.userNextAction,
        userNotes: draft.userNotes,
        owner: draft.owner,
        status: draft.status,
        needsUser: draft.needsUser,
        canAgentHelp: draft.canAgentHelp,
        isPinned: draft.isPinned,
        remindAfterMinutes: draft.remindAfterMinutes,
      });
      setRollingTodoBoard(board || null);
      hydrateRollingTodoDrafts(board || null);
      void refreshSessionContext(currentSession.id);
      addSystemMessage(`Task Queue item ${slotIndex + 1} saved.`);
    } catch (error: any) {
      addSystemMessage(`Failed to save Task Queue item ${slotIndex + 1}: ${error.message || 'Unknown error'}`);
    } finally {
      setRollingTodoSavingSlot(null);
    }
  }, [addSystemMessage, currentSession?.id, hydrateRollingTodoDrafts, rollingTodoDrafts]);

  const mapAgentRecord = useCallback((agent: any): Agent => {
    let parsedConfig: Record<string, any> = {};
    try {
      parsedConfig = typeof agent?.config === 'string'
        ? JSON.parse(agent.config)
        : (agent?.config || {});
    } catch {
      parsedConfig = {};
    }

    return {
      id: agent?.id,
      name: agent?.name || 'Agent',
      role: agent?.template || agent?.role || parsedConfig.type || 'custom',
      status: agent?.status === 'running' || agent?.status === 'error' ? agent.status : 'idle',
      createdAt: new Date(agent?.createdAt || Date.now()).getTime(),
      description: agent?.description || parsedConfig.description || '',
      parentId: agent?.parentId || parsedConfig.parentId || null,
      scratchpad: agent?.scratchpad || parsedConfig.scratchpad || '',
      isAutonomous: Boolean(agent?.isAutonomous ?? parsedConfig.isAutonomous),
      config: parsedConfig,
    };
  }, []);

  const mapTaskRecord = useCallback((task: any): Task => {
    const normalizedStatus = task.status === 'completed'
      ? 'completed'
      : task.status === 'running' || task.status === 'in_progress'
        ? 'running'
        : 'pending';
    const numericPriority = Number(task.priority || 0);

    return {
      id: task.id,
      title: task.description || task.title || 'Untitled task',
      priority: numericPriority >= 8 ? 'high' : numericPriority >= 4 ? 'medium' : 'low',
      progress: normalizedStatus === 'completed' ? 100 : normalizedStatus === 'running' ? 55 : 12,
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      status: normalizedStatus,
      agentId: task.agentId,
      sessionId: task.sessionId,
      result: task.result,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    };
  }, []);

  const mapPipelineRecord = useCallback((pipeline: any): Pipeline => {
    const stageNames = Array.isArray(pipeline.stages) ? pipeline.stages : [];
    const currentStageName = String(pipeline.currentStage || '');
    const currentIndex = stageNames.findIndex((stage: any) => (
      String(typeof stage === 'string' ? stage : stage?.name || '') === currentStageName
    ));

    const stages = stageNames.map((stage: any, index: number) => {
      const name = String(typeof stage === 'string' ? stage : stage?.name || `Stage ${index + 1}`);
      let status: 'pending' | 'active' | 'completed' | 'error' = 'pending';

      if (pipeline.status === 'failed' || pipeline.status === 'error') {
        status = index === currentIndex ? 'error' : index < currentIndex ? 'completed' : 'pending';
      } else if (pipeline.status === 'completed') {
        status = 'completed';
      } else if (currentIndex !== -1) {
        status = index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'pending';
      } else if (typeof stage === 'object' && stage?.status) {
        status = stage.status;
      }

      return { name, status };
    });

    const completedCount = stages.filter((stage: { status: 'pending' | 'active' | 'completed' | 'error' }) => stage.status === 'completed').length;
    const progress = stages.length > 0
      ? Math.round(((completedCount + (stages.some((stage: { status: 'pending' | 'active' | 'completed' | 'error' }) => stage.status === 'active') ? 0.5 : 0)) / stages.length) * 100)
      : 0;

    return {
      id: pipeline.id,
      name: pipeline.name || 'Pipeline',
      stages,
      progress,
      sessionId: pipeline.sessionId,
      sessionName: pipeline.sessionName,
      status: pipeline.status,
      currentStage: pipeline.currentStage,
      createdAt: pipeline.createdAt,
    };
  }, []);

  const mapAgentWorkflowRecord = useCallback((workflow: any): AgentWorkflowViewer => ({
    agent: mapAgentRecord(workflow?.agent || {}),
    childAgents: (workflow?.childAgents || []).map(mapAgentRecord),
    runs: Array.isArray(workflow?.runs) ? workflow.runs : [],
    tasks: (workflow?.tasks || []).map(mapTaskRecord),
    pipelines: (workflow?.pipelines || []).map(mapPipelineRecord),
    toolCalls: Array.isArray(workflow?.toolCalls) ? workflow.toolCalls : [],
  }), [mapAgentRecord, mapPipelineRecord, mapTaskRecord]);

  const openAgentWorkflow = useCallback(async (agent: Agent) => {
    if (!agent?.id) {
      return;
    }

    setAgentWorkflowLoadingId(agent.id);
    try {
      const workflow = await nexus.agents.workflow(agent.id, currentSession?.id);
      setAgentWorkflowViewer(mapAgentWorkflowRecord(workflow));
    } catch (error: any) {
      addSystemMessage(`Failed to load agent workflow: ${error.message || 'Unknown error'}`);
    } finally {
      setAgentWorkflowLoadingId(null);
    }
  }, [addSystemMessage, currentSession?.id, mapAgentWorkflowRecord]);

  const refreshSessionContext = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setAgents([]);
      setTasks([]);
      setPipelines([]);
      return;
    }

    try {
      const [agentRecords, taskRecords, pipelineRecords] = await Promise.all([
        nexus.agents.list(sessionId),
        nexus.tasks.list(sessionId),
        nexus.pipelines.list(sessionId),
      ]);

      setAgents((agentRecords || []).map(mapAgentRecord));
      setTasks((taskRecords || []).map(mapTaskRecord));
      setPipelines((pipelineRecords || []).map(mapPipelineRecord));
    } catch (error) {
      console.error('[Emergent] Failed to refresh session context:', error);
    }
  }, [mapAgentRecord, mapPipelineRecord, mapTaskRecord]);

  const upsertBrainstormSession = useCallback((record: BrainstormSessionRecord) => {
    setBrainstormSessions((prev) => {
      const next = [record, ...prev.filter((session) => session.id !== record.id)];
      return next.sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return rightTime - leftTime;
      });
    });
    setSelectedBrainstormId(record.id);
  }, []);

  const releaseBrainstormResources = useCallback(() => {
    if (brainstormTimerRef.current !== null) {
      window.clearInterval(brainstormTimerRef.current);
      brainstormTimerRef.current = null;
    }

    const stream = brainstormStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      brainstormStreamRef.current = null;
    }

    brainstormRecorderRef.current = null;
    brainstormChunksRef.current = [];
    brainstormStartedAtRef.current = null;
    setBrainstormElapsedMs(0);
  }, []);

  const cancelBrainstormCapture = useCallback(async (discardActiveSession = false) => {
    const recorder = brainstormRecorderRef.current;
    const activeBrainstormId = activeBrainstormIdRef.current;

    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // Ignore cleanup stop errors.
      }
    }

    releaseBrainstormResources();
    setIsBrainstormRecording(false);
    setIsBrainstormProcessing(false);
    activeBrainstormIdRef.current = null;

    if (discardActiveSession && activeBrainstormId) {
      try {
        await nexus.brainstorm.delete(activeBrainstormId);
      } catch {
        // Ignore cleanup deletion errors.
      }
      setBrainstormSessions((prev) => prev.filter((session) => session.id !== activeBrainstormId));
    }
  }, [releaseBrainstormResources]);

  const blobToDataUrl = useCallback((blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read brainstorm recording'));
    reader.readAsDataURL(blob);
  }), []);

  const fileToDataUrl = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  }), []);

  // ============================================================
  // Scroll to bottom on new messages
  // ============================================================
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const recordRendererError = (source: string, actual: string, context?: unknown) => {
      void nexus.bugs.record({
        sessionId: currentSession?.id,
        source,
        intent: 'Render and operate the Nexus UI without a client-side error.',
        actual,
        context,
      }).catch(() => {});
    };

    const onError = (event: ErrorEvent) => {
      recordRendererError('renderer:error', event.message || 'Unknown renderer error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unknown rejection');
      recordRendererError('renderer:unhandledRejection', reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [currentSession?.id]);

  // ============================================================
  // Initialize on mount
  // ============================================================
  useEffect(() => {
    const init = async () => {
      try {
        let initialSessionId = '';
        await nexus.sessions.backfillTitles().catch((error: any) => {
          console.warn('[Emergent] Session title backfill failed:', error);
        });
        const existingSessions = await nexus.sessions.list();

        if (existingSessions.length > 0) {
          const normalizedSessions = existingSessions.map(mapSessionRecord);

          setSessions(normalizedSessions);
          setCurrentSession(normalizedSessions[0]);
          initialSessionId = normalizedSessions[0].id;
          await loadSessionMessages(normalizedSessions[0].id);
          await loadBrainstormSessions(normalizedSessions[0].id);
        } else {
          const created = await nexus.sessions.create('New Session', 'Primary workspace session');
          const initialSession = mapSessionRecord(created);
          setSessions([initialSession]);
          setCurrentSession(initialSession);
          initialSessionId = initialSession.id;
          setBrainstormSessions([]);
        }

        const [
          savedElevenLabsApiKey,
          savedElevenLabsAgentId,
          savedElevenLabsVoiceId,
          savedHeyGenApiKey,
          savedXaiApiKey,
          savedKlaviyoApiKey,
          savedNotionApiKey,
          savedLincutterzNotionDatabaseId,
          savedSocialSchedulerWebhookUrl,
          savedFigmaBridgeWebhookUrl,
          savedMarketplaceBridgeWebhookUrl,
          savedMarketingVideoConfig,
          savedGeminiApiKey,
          savedAnthropicApiKey,
          savedOpenAiApiKey,
          savedDeepgramApiKey,
          savedOfflineModeEnabled,
          savedOperatorCommChannel,
          savedOperatorSelfTextShortcutName,
          savedOperatorTaskAlertsEnabled,
          savedOperatorDailyBriefingEnabled,
          savedOperatorDailyBriefingTime,
        ] = await Promise.all([
          nexus.settings.get('elevenlabs_api_key'),
          nexus.settings.get('elevenlabs_agent_id'),
          nexus.settings.get('elevenlabs_voice_id'),
          nexus.settings.get('heygen_api_key'),
          nexus.settings.get('xai_api_key'),
          nexus.settings.get('klaviyo_api_key'),
          nexus.settings.get('notion_api_key'),
          nexus.settings.get('lincutterz_notion_database_id'),
          nexus.settings.get('social_scheduler_webhook_url'),
          nexus.settings.get('figma_bridge_webhook_url'),
          nexus.settings.get('marketplace_bridge_webhook_url'),
          nexus.marketing.getVideoConfig(),
          nexus.settings.get('gemini_api_key'),
          nexus.settings.get('anthropic_api_key'),
          nexus.settings.get('openai_api_key'),
          nexus.settings.get('deepgram_api_key'),
          nexus.settings.get('offline_mode_enabled'),
          nexus.settings.get('operator_comm_channel'),
          nexus.settings.get('operator_self_text_shortcut_name'),
          nexus.settings.get('operator_task_alerts_enabled'),
          nexus.settings.get('operator_daily_briefing_enabled'),
          nexus.settings.get('operator_daily_briefing_time'),
        ]);

        setElevenLabsApiKey(String(savedElevenLabsApiKey || '').trim());
        setElevenLabsAgentId(resolveElevenLabsAgentId(savedElevenLabsAgentId));
        setElevenLabsVoiceId(resolveElevenLabsVoiceId(savedElevenLabsVoiceId));
        if (!savedElevenLabsVoiceId) {
          // Persist the default so backend (diary TTS, marketing video, etc.) sees it.
          void nexus.settings.set('elevenlabs_voice_id', DEFAULT_ELEVENLABS_VOICE_ID);
        }
        setHeyGenApiKey(savedHeyGenApiKey || '');
        setXaiApiKey(savedXaiApiKey || '');
        setKlaviyoApiKey(savedKlaviyoApiKey || '');
        setNotionApiKey(savedNotionApiKey || '');
        setLincutterzNotionDatabaseId(savedLincutterzNotionDatabaseId || '');
        setSocialSchedulerWebhookUrl(savedSocialSchedulerWebhookUrl || '');
        setFigmaBridgeWebhookUrl(savedFigmaBridgeWebhookUrl || '');
        setMarketplaceBridgeWebhookUrl(savedMarketplaceBridgeWebhookUrl || '');
        setMarketingVideoConfig(savedMarketingVideoConfig || null);
        setMarketingVoiceProfiles(Array.isArray(savedMarketingVideoConfig?.voiceProfiles) ? savedMarketingVideoConfig.voiceProfiles : []);
        setHeyGenAvatarProfiles(Array.isArray(savedMarketingVideoConfig?.avatarProfiles) ? savedMarketingVideoConfig.avatarProfiles : []);
        setSelectedMarketingVoiceProfileId(savedMarketingVideoConfig?.voiceProfiles?.[0]?.id || '');
        setSelectedHeyGenAvatarProfileId(savedMarketingVideoConfig?.avatarProfiles?.[0]?.id || '');
        setGeminiApiKey(savedGeminiApiKey || '');
        setAnthropicApiKey(savedAnthropicApiKey || '');
        setOpenAiApiKey(savedOpenAiApiKey || '');
        setDeepgramApiKey(savedDeepgramApiKey || '');
        setOfflineModeEnabled(
          savedOfflineModeEnabled === true
          || String(savedOfflineModeEnabled || '').trim().toLowerCase() === 'true'
        );
        setOperatorCommChannel(normalizeOperatorCommunicationChannel(savedOperatorCommChannel));
        setOperatorSelfTextShortcutName(
          String(savedOperatorSelfTextShortcutName || '').trim() || DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT
        );
        setOperatorTaskAlertsEnabled(normalizeBooleanSetting(savedOperatorTaskAlertsEnabled, false));
        setOperatorDailyBriefingEnabled(normalizeBooleanSetting(savedOperatorDailyBriefingEnabled, false));
        setOperatorDailyBriefingTime(
          String(savedOperatorDailyBriefingTime || '').trim() || DEFAULT_OPERATOR_DAILY_BRIEFING_TIME
        );

        const configured = await nexus.elevenlabs.isConfigured();
        setIsElevenLabsConfigured(configured);
        const agentConfig = await nexus.elevenlabs.getAgentConfig(initialSessionId || undefined);
        setAppliedVoiceAgentId(agentConfig.agentId || '');
        await refreshMasterDiary();
        await refreshProjects();
        await refreshWorkspaceFiles();
        await refreshKnowledgeDocuments(initialSessionId || undefined);
        await refreshKnowledgeStats(initialSessionId || undefined);
        await refreshCurrentProject(initialSessionId || undefined);
        await refreshYouTubeData();
        // Load entity CRM counts
        try {
          const entityCounts = await nexus.entityCrm.getCounts();
          setCrmCounts(entityCounts || { people: 0, businesses: 0, links: 0 });
        } catch { /* non-critical */ }
      } catch {
        setIsElevenLabsConfigured(false);
      }
    };
    init();
  }, [loadBrainstormSessions, loadSessionMessages, mapSessionRecord, refreshCurrentProject, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshMasterDiary, refreshProjects, refreshWorkspaceFiles, refreshYouTubeData]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void runGlobalSearch(globalSearchQuery);
    }, globalSearchQuery.trim() ? 220 : 120);

    return () => window.clearTimeout(timeoutId);
  }, [globalSearchQuery, runGlobalSearch]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const normalizedQuery = normalizeWhitespace(sessionSearchQuery);
    if (!normalizedQuery || sessions.length === 0) {
      return;
    }

    const missingSessions = sessions.filter((session) => (
      sessionSearchIndex[session.id] === undefined
      && !sessionSearchIndexLoadingRef.current.has(session.id)
    ));

    if (missingSessions.length === 0) {
      return;
    }

    let cancelled = false;
    missingSessions.forEach((session) => sessionSearchIndexLoadingRef.current.add(session.id));

    void Promise.all(missingSessions.map(async (session) => {
      try {
        const sessionData = await nexus.sessions.get(session.id);
        return [session.id, buildSessionMessageSearchText(sessionData?.messages || [])] as const;
      } catch (error) {
        console.warn('[Emergent] Failed to index session for search:', session.id, error);
        return [session.id, ''] as const;
      } finally {
        sessionSearchIndexLoadingRef.current.delete(session.id);
      }
    })).then((entries) => {
      if (cancelled) {
        return;
      }

      setSessionSearchIndex((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [sessionId, searchText] of entries) {
          if (next[sessionId] !== searchText) {
            next[sessionId] = searchText;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [sessionSearchQuery, sessions, sessionSearchIndex]);

  useEffect(() => {
    if (!currentSession?.id) {
      return;
    }

    const currentSearchText = buildSessionMessageSearchText(messages);
    setSessionSearchIndex((prev) => (
      prev[currentSession.id] === currentSearchText
        ? prev
        : { ...prev, [currentSession.id]: currentSearchText }
    ));
  }, [currentSession?.id, messages]);

  useEffect(() => {
    const unsubscribe = nexus.agents.onWorkflowOpen((workflow: any) => {
      if (!workflow) {
        return;
      }
      setAgentWorkflowViewer(mapAgentWorkflowRecord(workflow));
    });

    return unsubscribe;
  }, [mapAgentWorkflowRecord]);

  // ---- Meeting Mode update listener ----
  useEffect(() => {
    const unsubscribe = nexus.meetingMode.onUpdate((update: any) => {
      if (!update) return;
      switch (update.type) {
        case 'entity':
          setMeetingEntities((prev) => [...prev, update.payload]);
          break;
        case 'fact':
          setMeetingFacts((prev) => [...prev, update.payload]);
          break;
        case 'topic':
          setMeetingTopics((prev) => [...prev, update.payload]);
          break;
        case 'sentiment':
          setMeetingSentiment((prev) => [...prev, update.payload]);
          break;
        case 'infographic':
          setMeetingInfographics((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === update.payload?.id);
            const next = existingIndex >= 0
              ? prev.map((item, index) => (index === existingIndex ? { ...item, ...update.payload } : item))
              : [...prev, update.payload];
            if (existingIndex === -1) {
              setMeetingCarouselIndex(next.length - 1);
            }
            return next;
          });
          break;
        case 'research_suggestion':
          setMeetingResearchSuggestions((prev) => [...prev, update.payload]);
          break;
        case 'status':
          if (update.payload.status === 'ended') {
            setMeetingModeActive(false);
          }
          setMeetingModeStatus(update.payload.status);
          break;
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = nexus.browser.onScreenshotSaved((payload: any) => {
      if (!payload) {
        return;
      }

      addSystemMessage(
        payload.documentId
          ? `Browser screenshot saved and ingested${payload.pageTitle ? `: ${payload.pageTitle}` : ''}.`
          : `Browser screenshot saved${payload.pageTitle ? `: ${payload.pageTitle}` : ''}.`
      );

      void refreshWorkspaceFiles();

      if (payload.sessionId && currentSession?.id === payload.sessionId) {
        void refreshKnowledgeDocuments(payload.sessionId);
        void refreshKnowledgeStats(payload.sessionId);
      }
    });

    return () => unsubscribe();
  }, [addSystemMessage, currentSession?.id, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles]);

  // ---- Entity CRM functions ----
  const openEntityCrm = useCallback(async () => {
    setCrmLoading(true);
    setShowEntityCrm(true);
    try {
      const [people, businesses, counts] = await Promise.all([
        nexus.entityCrm.listPeople(100),
        nexus.entityCrm.listBusinesses(100),
        nexus.entityCrm.getCounts(),
      ]);
      setCrmPeople(people || []);
      setCrmBusinesses(businesses || []);
      setCrmCounts(counts || { people: 0, businesses: 0, links: 0 });
    } catch (err) {
      console.error('Failed to load entity CRM:', err);
    } finally {
      setCrmLoading(false);
    }
  }, []);

  const refreshCrmSessionContext = useCallback(async (sessionId?: string) => {
    if (!sessionId) {
      setCrmSessionContext(null);
      return;
    }

    try {
      const context = await nexus.entityCrm.getSessionContext(sessionId, 6);
      setCrmSessionContext(context || { people: [], businesses: [], relationships: [], summary: '' });
    } catch (error) {
      console.error('[Emergent] Failed to load session entity context:', error);
    }
  }, []);

  const loadCrmEntityKnowledge = useCallback(async (entityType: 'person' | 'business', entityId?: string) => {
    if (!entityId) {
      setCrmEntityKnowledge(null);
      return;
    }

    setCrmEntityKnowledge(null);
    setCrmEntityKnowledgeLoading(true);
    try {
      const knowledge = await nexus.entityCrm.getKnowledge(entityType, entityId, 8);
      setCrmEntityKnowledge(knowledge || null);
    } catch (error) {
      console.error('[Emergent] Failed to load entity knowledge:', error);
      setCrmEntityKnowledge(null);
    } finally {
      setCrmEntityKnowledgeLoading(false);
    }
  }, []);

  const searchEntitiesCrm = useCallback(async (query: string) => {
    if (!query.trim()) {
      setCrmSearchResults([]);
      return;
    }
    try {
      const results = await nexus.entityCrm.search(query);
      setCrmSearchResults(results || []);
    } catch (err) {
      console.error('Entity search error:', err);
    }
  }, []);

  const selectCrmPerson = useCallback(async (person: any) => {
    setCrmSelectedPerson(person);
    crmSelectedPersonRef.current = person;
    setCrmSelectedBusiness(null);
    crmSelectedBusinessRef.current = null;
    setCrmEditMode(false);
    setCrmMergeState(null);
    try {
      const [businesses] = await Promise.all([
        nexus.entityCrm.getPersonBusinesses(person.id),
        loadCrmEntityKnowledge('person', person.id),
      ]);
      setCrmPersonBusinesses(businesses || []);
    } catch {
      setCrmPersonBusinesses([]);
    }
  }, [loadCrmEntityKnowledge]);

  const selectCrmBusiness = useCallback(async (business: any) => {
    setCrmSelectedBusiness(business);
    crmSelectedBusinessRef.current = business;
    setCrmSelectedPerson(null);
    crmSelectedPersonRef.current = null;
    setCrmEditMode(false);
    setCrmMergeState(null);
    try {
      const [people] = await Promise.all([
        nexus.entityCrm.getBusinessPeople(business.id),
        loadCrmEntityKnowledge('business', business.id),
      ]);
      setCrmBusinessPeople(people || []);
    } catch {
      setCrmBusinessPeople([]);
    }
  }, [loadCrmEntityKnowledge]);

  const focusCrmEntity = useCallback(async (
    entity: SessionEntityMatchRecord | { id: string; name?: string; full_name?: string },
    entityType: 'person' | 'business'
  ) => {
    setShowEntityCrm(true);
    setCrmActiveTab('search');
    setCrmSearchQuery(entityType === 'person'
      ? String(entity.full_name || entity.name || '')
      : String(entity.name || entity.full_name || '')
    );

    try {
      if (entityType === 'person') {
        const person = await nexus.entityCrm.getPerson(entity.id);
        if (person) {
          await selectCrmPerson(person);
        }
      } else {
        const business = await nexus.entityCrm.getBusiness(entity.id);
        if (business) {
          await selectCrmBusiness(business);
        }
      }
    } catch (error) {
      console.error('[Emergent] Failed to focus CRM entity:', error);
    }
  }, [selectCrmBusiness, selectCrmPerson]);

  const runEntityBackfill = useCallback(async () => {
    setCrmBackfillRunning(true);
    setCrmBackfillProgress('Starting knowledge base scan...');
    const unsubscribe = nexus.entityCrm.onBackfillProgress((data: any) => {
      setCrmBackfillProgress(data.status || '');
    });
    try {
      const result = await nexus.entityCrm.backfillFromKnowledge();
      setCrmBackfillProgress(result.message || 'Backfill complete.');
      // Refresh CRM data
      const [people, businesses, counts] = await Promise.all([
        nexus.entityCrm.listPeople(100),
        nexus.entityCrm.listBusinesses(100),
        nexus.entityCrm.getCounts(),
      ]);
      setCrmPeople(people || []);
      setCrmBusinesses(businesses || []);
      setCrmCounts(counts || { people: 0, businesses: 0, links: 0 });
    } catch (err) {
      setCrmBackfillProgress(`Backfill failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCrmBackfillRunning(false);
      unsubscribe();
    }
  }, []);

  const crmActiveEntity = useMemo(() => {
    if (crmSelectedPerson?.id) {
      return {
        key: `person:${crmSelectedPerson.id}`,
        entityType: 'person' as const,
        entityId: String(crmSelectedPerson.id),
        name: String(crmSelectedPerson.full_name || 'Selected person'),
      };
    }

    if (crmSelectedBusiness?.id) {
      return {
        key: `business:${crmSelectedBusiness.id}`,
        entityType: 'business' as const,
        entityId: String(crmSelectedBusiness.id),
        name: String(crmSelectedBusiness.name || 'Selected business'),
      };
    }

    return null;
  }, [crmSelectedBusiness, crmSelectedPerson]);

  const crmActiveChatMessages = useMemo(() => {
    if (!crmActiveEntity) {
      return [];
    }
    return crmChatThreads[crmActiveEntity.key] || [];
  }, [crmActiveEntity, crmChatThreads]);

  useEffect(() => {
    if (!crmActiveEntity) {
      return;
    }

    setCrmChatThreads((prev) => {
      if (prev[crmActiveEntity.key]) {
        return prev;
      }

      return {
        ...prev,
        [crmActiveEntity.key]: [
          {
            id: `${crmActiveEntity.key}:intro`,
            role: 'assistant',
            content: `Ask about ${crmActiveEntity.name}. I’ll answer only from this CRM record and its linked knowledge base.`,
            timestamp: Date.now(),
          },
        ],
      };
    });
    setCrmChatInput('');
  }, [crmActiveEntity]);

  useEffect(() => {
    if (!crmChatMessagesRef.current) {
      return;
    }
    crmChatMessagesRef.current.scrollTop = crmChatMessagesRef.current.scrollHeight;
  }, [crmActiveChatMessages, crmChatLoadingKey]);

  const sendCrmChatMessage = useCallback(async () => {
    const activeEntity = crmActiveEntity;
    const trimmedQuestion = crmChatInput.trim();
    if (!activeEntity || !trimmedQuestion || crmChatLoadingKey === activeEntity.key) {
      return;
    }

    const userMessage: CrmChatMessageRecord = {
      id: `${activeEntity.key}:user:${Date.now()}`,
      role: 'user',
      content: trimmedQuestion,
      timestamp: Date.now(),
    };

    setCrmChatThreads((prev) => ({
      ...prev,
      [activeEntity.key]: [...(prev[activeEntity.key] || []), userMessage],
    }));
    setCrmChatInput('');
    setCrmChatLoadingKey(activeEntity.key);

    try {
      const history = [...crmActiveChatMessages, userMessage]
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-8)
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
        }));

      const response = await nexus.entityCrm.chat(
        activeEntity.entityType,
        activeEntity.entityId,
        trimmedQuestion,
        history
      );

      const assistantMessage: CrmChatMessageRecord = {
        id: `${activeEntity.key}:assistant:${Date.now()}`,
        role: 'assistant',
        content: String(response?.content || 'No CRM response available.').trim() || 'No CRM response available.',
        sources: Array.isArray(response?.sources) ? response.sources : [],
        timestamp: Date.now(),
      };

      setCrmChatThreads((prev) => ({
        ...prev,
        [activeEntity.key]: [...(prev[activeEntity.key] || []), assistantMessage],
      }));
    } catch (error: any) {
      const assistantMessage: CrmChatMessageRecord = {
        id: `${activeEntity.key}:assistant-error:${Date.now()}`,
        role: 'assistant',
        content: `CRM knowledge chat failed: ${error?.message || 'Unknown error'}`,
        timestamp: Date.now(),
      };

      setCrmChatThreads((prev) => ({
        ...prev,
        [activeEntity.key]: [...(prev[activeEntity.key] || []), assistantMessage],
      }));
    } finally {
      setCrmChatLoadingKey((current) => (current === activeEntity.key ? null : current));
    }
  }, [crmActiveChatMessages, crmActiveEntity, crmChatInput, crmChatLoadingKey]);

  const crmKnowledge = useMemo(() => {
    if (!crmActiveEntity || !crmEntityKnowledge) {
      return null;
    }

    if (crmEntityKnowledge.entityType !== crmActiveEntity.entityType) {
      return null;
    }

    if (String(crmEntityKnowledge.entityId || '') !== crmActiveEntity.entityId) {
      return null;
    }

    return crmEntityKnowledge;
  }, [crmActiveEntity, crmEntityKnowledge]);

  const crmKnowledgeFacts = useMemo(
    () => (Array.isArray(crmKnowledge?.facts) ? crmKnowledge.facts : []),
    [crmKnowledge],
  );

  const crmKnowledgeSourceMaterials = useMemo(
    () => (Array.isArray(crmKnowledge?.sourceMaterials) ? crmKnowledge.sourceMaterials : []),
    [crmKnowledge],
  );

  // ── CRM CRUD helpers ──

  const refreshCrmData = useCallback(async () => {
    const [people, businesses, counts] = await Promise.all([
      nexus.entityCrm.listPeople(200),
      nexus.entityCrm.listBusinesses(200),
      nexus.entityCrm.getCounts(),
    ]);
    setCrmPeople(people || []);
    setCrmBusinesses(businesses || []);
    setCrmCounts(counts || { people: 0, businesses: 0, links: 0 });
  }, []);

  const crmOpenMerge = useCallback((type: 'person' | 'business', entity: any) => {
    setCrmMergeState({
      type,
      primaryId: entity.id,
      primaryName: type === 'person' ? entity.full_name : entity.name,
      query: '',
      selectedCandidateId: '',
    });
    setCrmMergeResults([]);
  }, []);

  const crmSearchMergeCandidates = useCallback(async (query: string, type: 'person' | 'business') => {
    if (!query.trim()) {
      setCrmMergeResults([]);
      return;
    }
    try {
      const results = await nexus.entityCrm.search(query, type);
      setCrmMergeResults(results || []);
    } catch (error) {
      console.error('[CRM] Merge candidate search failed:', error);
      setCrmMergeResults([]);
    }
  }, []);

  const crmConfirmMergeEntities = useCallback(async () => {
    if (!crmMergeState?.selectedCandidateId) {
      return;
    }

    setCrmMerging(true);
    try {
      let merged: any = null;
      if (crmMergeState.type === 'person') {
        merged = await nexus.entityCrm.mergePerson(crmMergeState.primaryId, crmMergeState.selectedCandidateId);
      } else {
        merged = await nexus.entityCrm.mergeBusiness(crmMergeState.primaryId, crmMergeState.selectedCandidateId);
      }

      setCrmMergeState(null);
      setCrmMergeResults([]);
      await refreshCrmData();

      if (merged) {
        if (crmMergeState.type === 'person') {
          await selectCrmPerson(merged);
          setCrmActiveTab('people');
        } else {
          await selectCrmBusiness(merged);
          setCrmActiveTab('businesses');
        }
      }
    } catch (error) {
      console.error('[CRM] Merge failed:', error);
    } finally {
      setCrmMerging(false);
    }
  }, [crmMergeState, refreshCrmData, selectCrmBusiness, selectCrmPerson]);

  const crmSetEditData = useCallback((updater: any) => {
    setCrmEditData((prev: any) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      crmEditDataRef.current = next;
      return next;
    });
  }, []);

  const crmStartEdit = useCallback((entity: any, type: 'person' | 'business') => {
    setCrmEditMode(true);
    const data = type === 'person'
      ? { full_name: entity.full_name || '', title: entity.title || '', company: entity.company || '', location: entity.location || '', industry: entity.industry || '', education: entity.education || '', linkedin_url: entity.linkedin_url || '', career_narrative: entity.career_narrative || '' }
      : { name: entity.name || '', industry: entity.industry || '', location: entity.location || '', description: entity.description || '', website: entity.website || '', linkedin_url: entity.linkedin_url || '', size_range: entity.size_range || '', founded_year: entity.founded_year || '' };
    setCrmEditData(data);
    crmEditDataRef.current = data;
  }, []);

  const crmSaveEdit = useCallback(async () => {
    const data = { ...crmEditDataRef.current };
    const person = crmSelectedPersonRef.current;
    const business = crmSelectedBusinessRef.current;
    console.log('[CRM] Save edit — person:', person?.id, 'business:', business?.id, 'data:', data);
    try {
      if (person) {
        const updated = await nexus.entityCrm.updatePerson(person.id, data);
        console.log('[CRM] Update person result:', updated);
        setCrmSelectedPerson(updated);
        crmSelectedPersonRef.current = updated;
      } else if (business) {
        const updated = await nexus.entityCrm.updateBusiness(business.id, data);
        console.log('[CRM] Update business result:', updated);
        setCrmSelectedBusiness(updated);
        crmSelectedBusinessRef.current = updated;
      }
      setCrmEditMode(false);
      setCrmEditData({});
      crmEditDataRef.current = {};
      await refreshCrmData();
    } catch (err) {
      console.error('[CRM] Save entity error:', err);
    }
  }, [refreshCrmData]);

  const crmCancelEdit = useCallback(() => {
    setCrmEditMode(false);
    setCrmEditData({});
    crmEditDataRef.current = {};
  }, []);

  const crmConfirmDelete = useCallback(async () => {
    if (!crmDeleteConfirm) return;
    try {
      if (crmDeleteConfirm.type === 'person') {
        await nexus.entityCrm.deletePerson(crmDeleteConfirm.id);
        setCrmSelectedPerson(null);
      } else {
        await nexus.entityCrm.deleteBusiness(crmDeleteConfirm.id);
        setCrmSelectedBusiness(null);
      }
      setCrmDeleteConfirm(null);
      setCrmEditMode(false);
      await refreshCrmData();
    } catch (err) {
      console.error('Delete entity error:', err);
    }
  }, [crmDeleteConfirm, refreshCrmData]);

  const crmCreateEntity = useCallback(async () => {
    if (!crmShowCreateForm) return;
    try {
      if (crmShowCreateForm === 'person') {
        if (!crmCreateData.full_name?.trim()) return;
        const created = await nexus.entityCrm.createPerson(crmCreateData);
        setCrmShowCreateForm(null);
        setCrmCreateData({});
        await refreshCrmData();
        void selectCrmPerson(created);
        setCrmActiveTab('people');
      } else {
        if (!crmCreateData.name?.trim()) return;
        const created = await nexus.entityCrm.createBusiness(crmCreateData);
        setCrmShowCreateForm(null);
        setCrmCreateData({});
        await refreshCrmData();
        void selectCrmBusiness(created);
        setCrmActiveTab('businesses');
      }
    } catch (err) {
      console.error('Create entity error:', err);
    }
  }, [crmShowCreateForm, crmCreateData, refreshCrmData, selectCrmPerson, selectCrmBusiness]);

  // ── Chat thinking indicator wiring ─────────────────────────────────────
  useEffect(() => {
    const off = (nexus as any)?.chat?.onProgress?.((evt: any) => {
      if (!evt || !evt.stage) return;
      if (evt.stage === 'done' || evt.stage === 'error') {
        setChatThinking(null);
        return;
      }
      const toolName = evt.detail?.name;
      setChatThinking({ stage: evt.stage, tool: toolName });
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  // ── Diagram viewer wiring ──────────────────────────────────────────────
  useEffect(() => {
    const offOpen = (nexus as any)?.diagrams?.onOpen?.((rec: any) => {
      setDiagramViewer(rec);
    });
    const offClose = (nexus as any)?.diagrams?.onClose?.(() => {
      setDiagramViewer(null);
    });
    return () => {
      try { offOpen?.(); } catch {}
      try { offClose?.(); } catch {}
    };
  }, []);

  useEffect(() => {
    const unsubscribe = nexus.entityCrm.onOpenPanel((payload: any) => {
      void (async () => {
        await openEntityCrm();

        const query = String(payload?.query || '').trim();
        const entityType = String(payload?.entityType || 'all').toLowerCase();
        const focusId = String(payload?.focusId || '').trim();

        if (!query) {
          setCrmActiveTab(entityType === 'business' ? 'businesses' : 'people');
          return;
        }

        setCrmActiveTab('search');
        setCrmSearchQuery(query);
        const results = await nexus.entityCrm.search(query, entityType === 'person' || entityType === 'business' ? entityType : undefined).catch(() => []);
        setCrmSearchResults(results || []);

        const focusResult = (results || []).find((result: any) => String(result?.id || '') === focusId) || results?.[0];
        if (!focusResult) {
          return;
        }

        if (focusResult.type === 'person') {
          const person = await nexus.entityCrm.getPerson(focusResult.id).catch(() => null);
          if (person) {
            await selectCrmPerson(person);
          }
          return;
        }

        const business = await nexus.entityCrm.getBusiness(focusResult.id).catch(() => null);
        if (business) {
          await selectCrmBusiness(business);
        }
      })();
    });

    return () => unsubscribe();
  }, [openEntityCrm, selectCrmBusiness, selectCrmPerson]);

  const startMeetingMode = useCallback(async () => {
    let sessionId = currentSession?.id;

    try {
      if (!sessionId) {
        const created = await nexus.sessions.create(
          `Meeting ${new Date().toLocaleString()}`,
          'Created automatically for Meeting Mode'
        );
        const nextSession = mapSessionRecord(created);
        setSessions((prev) => [nextSession, ...prev.filter((session) => session.id !== nextSession.id)]);
        setCurrentSession(nextSession);
        setCurrentProject(null);
        setMessages([]);
        setAgents([]);
        setTasks([]);
        setPipelines([]);
        setBrainstormSessions([]);
        sessionId = nextSession.id;
      }

      const result = await nexus.meetingMode.start(sessionId);
      if (result.success) {
        setMeetingModeActive(true);
        setMeetingModeStatus('listening');
        setMeetingEntities([]);
        setMeetingFacts([]);
        setMeetingTopics([]);
        setMeetingInfographics([]);
        setMeetingSentiment([]);
        setMeetingResearchSuggestions([]);
        setMeetingBriefing(null);
        setShowMeetingBriefing(false);
        setMeetingCarouselIndex(0);
      }
    } catch (err) {
      console.error('Failed to start meeting mode:', err);
    }
  }, [currentSession?.id, mapSessionRecord]);

  const endMeetingMode = useCallback(async () => {
    try {
      const result = await nexus.meetingMode.end();
      setMeetingModeActive(false);
      setMeetingModeStatus('ended');
      if (result?.briefing) {
        setMeetingBriefing(result.briefing);
        setShowMeetingBriefing(true);
      }
      if (result?.persistence?.savedToKnowledge) {
        addSystemMessage(`Meeting artifacts saved to knowledge. Transcript: ${result.persistence.transcriptPath} | Briefing: ${result.persistence.briefingPath}`);
      }
      void nexus.entityCrm.getCounts().then((counts: { people: number; businesses: number; links: number }) => {
        setCrmCounts(counts || { people: 0, businesses: 0, links: 0 });
      }).catch(() => {});
      void refreshWorkspaceFiles();
      if (currentSession?.id) {
        void refreshKnowledgeDocuments(currentSession.id);
        void refreshKnowledgeStats(currentSession.id);
      }
    } catch (err) {
      console.error('Failed to end meeting mode:', err);
    }
  }, [addSystemMessage, currentSession?.id, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles]);

  const presentMeetingSummary = useCallback(async () => {
    try {
      const result = await nexus.meetingMode.compileBriefing();
      if (result.success) {
        setMeetingBriefing(result.briefing);
        setShowMeetingBriefing(true);
        void nexus.entityCrm.getCounts().then((counts: { people: number; businesses: number; links: number }) => {
          setCrmCounts(counts || { people: 0, businesses: 0, links: 0 });
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to compile meeting briefing:', err);
    }
  }, []);

  useEffect(() => {
    if (!currentSession?.id) {
      setAgents([]);
      setTasks([]);
      setPipelines([]);
      setRollingTodoBoard(null);
      hydrateRollingTodoDrafts(null);
      return;
    }

    void refreshSessionContext(currentSession.id);
    void refreshCurrentProject(currentSession.id);
    void refreshMasterDiary();
    void refreshWorkspaceFiles();
    void refreshKnowledgeDocuments(currentSession.id);
    void refreshKnowledgeStats(currentSession.id);
    void refreshCrmSessionContext(currentSession.id);
    void refreshRollingTodoBoard(currentSession.id, { reason: 'session_change', silent: true });
  }, [currentSession?.id, hydrateRollingTodoDrafts, refreshCrmSessionContext, refreshCurrentProject, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshMasterDiary, refreshRollingTodoBoard, refreshSessionContext, refreshWorkspaceFiles]);

  useEffect(() => {
    if (!currentSession?.id) {
      return;
    }

    void nexus.settings.set('last_active_session_id', currentSession.id);
  }, [currentSession?.id]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const recentConversationHint = messages
        .slice(-6)
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n');

      void refreshMasterDiary();
      void refreshWorkspaceFiles();
      if (currentSession?.id) {
        void refreshCurrentProject(currentSession.id, recentConversationHint);
        void refreshKnowledgeDocuments(currentSession.id);
        void refreshKnowledgeStats(currentSession.id);
        void refreshCrmSessionContext(currentSession.id);
        void refreshRollingTodoBoard(currentSession.id, { reason: 'activity_sync', silent: true });
      }
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [currentSession?.id, messages, refreshCrmSessionContext, refreshCurrentProject, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshMasterDiary, refreshRollingTodoBoard, refreshWorkspaceFiles]);

  useEffect(() => {
    if (!currentSession?.id) {
      return;
    }

    let disposed = false;

    const pollReminder = async () => {
      try {
        const reminder = await nexus.rollingTodo.claimReminder(currentSession.id);
        if (disposed || !reminder?.message) {
          return;
        }

        addSystemMessage(reminder.message);
        if (reminder.board) {
          setRollingTodoBoard(reminder.board);
          hydrateRollingTodoDrafts(reminder.board);
        } else {
          void refreshRollingTodoBoard(currentSession.id, { reason: 'reminder_poll', silent: true });
        }
      } catch (error) {
        console.error('[Emergent] Task Queue reminder poll failed:', error);
      }
    };

    void pollReminder();
    const intervalId = window.setInterval(() => {
      void pollReminder();
    }, 60_000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [addSystemMessage, currentSession?.id, hydrateRollingTodoDrafts, refreshRollingTodoBoard]);

  useEffect(() => {
    if (!rollingTodoBoard?.sessionName) {
      return;
    }

    setRollingTodoEmailSubject((previous) => (
      previous.trim() ? previous : `${rollingTodoBoard.sessionName} — Task Queue`
    ));
  }, [rollingTodoBoard?.sessionName]);

  useEffect(() => {
    if (artifactViewer?.kind === 'spreadsheet') {
      const sheetNames = artifactViewer.spreadsheetData?.sheets.map((sheet) => sheet.name) || [];
      const firstSheet = sheetNames[0] || '';
      setActiveSpreadsheetSheet((previous) => (sheetNames.includes(previous) ? previous : firstSheet));
      return;
    }

    setActiveSpreadsheetSheet('');
    setSpreadsheetEditor(null);
    setSpreadsheetOperationLabel(null);
  }, [artifactViewer]);

  useEffect(() => {
    if (artifactViewer?.kind !== 'spreadsheet') {
      return;
    }

    const sheets = artifactViewer.spreadsheetData?.sheets || [];
    const selectedSheet = sheets.find((sheet) => sheet.name === activeSpreadsheetSheet) || sheets[0];
    if (!selectedSheet) {
      return;
    }

    const numericColumn = selectedSheet.headers.find((header) => (
      selectedSheet.rows.some((row) => {
        const value = row[header];
        if (typeof value === 'number') {
          return true;
        }
        if (typeof value === 'string') {
          const normalized = value.replace(/,/g, '').trim();
          return normalized !== '' && !Number.isNaN(Number(normalized));
        }
        return false;
      })
    )) || '';

    setSpreadsheetSortColumn((previous) => (
      previous && selectedSheet.headers.includes(previous)
        ? previous
        : selectedSheet.headers[0] || ''
    ));
    setSpreadsheetChartLabelColumn((previous) => (
      previous && selectedSheet.headers.includes(previous)
        ? previous
        : selectedSheet.headers[0] || ''
    ));
    setSpreadsheetChartValueColumn((previous) => (
      previous && selectedSheet.headers.includes(previous)
        ? previous
        : numericColumn
    ));
  }, [activeSpreadsheetSheet, artifactViewer]);

  useEffect(() => {
    if (!brainstormSessions.length) {
      if (selectedBrainstormId !== null) {
        setSelectedBrainstormId(null);
      }
      return;
    }

    if (!selectedBrainstormId || !brainstormSessions.some((session) => session.id === selectedBrainstormId)) {
      setSelectedBrainstormId(brainstormSessions[0].id);
    }
  }, [brainstormSessions, selectedBrainstormId]);

  useEffect(() => () => {
    void cancelBrainstormCapture(false);
  }, [cancelBrainstormCapture]);

  useEffect(() => {
    if (!legalAnalyzableDocuments.length) {
      if (selectedLegalDocumentId) {
        setSelectedLegalDocumentId('');
      }
      return;
    }

    if (!selectedLegalDocumentId || !legalAnalyzableDocuments.some((document) => document.id === selectedLegalDocumentId)) {
      setSelectedLegalDocumentId(legalAnalyzableDocuments[0]?.id || '');
    }
  }, [legalAnalyzableDocuments, selectedLegalDocumentId]);

  useEffect(() => {
    setLegalUrlInput('');
    setLegalWebSearchQuery('');
    setLegalWebSearchResults([]);
    setLastLegalAnalysisReport(null);
  }, [currentSession?.id]);

  // ============================================================
  // Message helpers
  // ============================================================
  const openKnowledgeDocument = useCallback(async (documentId: string) => {
    try {
      const document = await nexus.knowledge.getDocument(documentId);
      if (document.artifactPath) {
        setArtifactLoadingPath(document.artifactPath);

        try {
          const loaded = await nexus.artifacts.load(document.artifactPath);
          stageArtifactInWorkspace({
            path: loaded.path,
            name: loaded.name,
            kind: loaded.kind,
            dataUrl: loaded.dataUrl,
            mimeType: loaded.mimeType,
            textContent: loaded.textContent,
            spreadsheetData: loaded.spreadsheetData,
          });
          return;
        } catch (artifactError: any) {
          addSystemMessage(`Saved file could not be reopened directly, falling back to knowledge text: ${artifactError.message || 'Unknown error'}`);
        } finally {
          setArtifactLoadingPath(null);
        }
      }

      stageArtifactInWorkspace({
        path: document.source || `knowledge:${document.id}`,
        name: document.title || 'Knowledge Document',
        kind: 'text',
        dataUrl: '',
        mimeType: 'text/plain; charset=utf-8',
        textContent: document.content || '',
      });
    } catch (error: any) {
      addSystemMessage(`Failed to open knowledge document: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, stageArtifactInWorkspace]);

  const persistSessionMessage = useCallback(async (
    role: 'user' | 'assistant' | 'system',
    content: string
  ) => {
    const sessionId = currentSession?.id;
    const trimmedContent = String(content || '').trim();

    if (!sessionId || !trimmedContent) {
      return;
    }

    try {
      await nexus.chat.append(sessionId, role, trimmedContent);
    } catch (error) {
      console.error('[Nexus] Failed to persist session message:', error);
    }
  }, [currentSession?.id]);

  const maybeAutoTitleSession = useCallback(async (content: string) => {
    const session = currentSession;
    const nextTitle = deriveSessionTitle(content);

    if (
      !session?.id
      || !nextTitle
      || !isAutoGeneratedSessionName(session.name)
      || autoRenamedSessionIdsRef.current.has(session.id)
    ) {
      return;
    }

    autoRenamedSessionIdsRef.current.add(session.id);

    try {
      const renamedSession = mapSessionRecord(await nexus.sessions.rename(session.id, nextTitle));
      setSessions((prev) => {
        const next = prev.map((candidate) => (
          candidate.id === renamedSession.id
            ? {
                ...candidate,
                name: renamedSession.name,
                updatedAt: Math.max(candidate.updatedAt || 0, renamedSession.updatedAt || Date.now()),
                messageCount: renamedSession.messageCount ?? candidate.messageCount,
              }
            : candidate
        ));

        next.sort((left, right) => {
          const leftTime = left.updatedAt || left.createdAt || 0;
          const rightTime = right.updatedAt || right.createdAt || 0;
          return rightTime - leftTime;
        });

        return next;
      });
      setCurrentSession((prev) => (
        prev?.id === renamedSession.id
          ? {
              ...prev,
              name: renamedSession.name,
              updatedAt: Math.max(prev.updatedAt || 0, renamedSession.updatedAt || Date.now()),
              messageCount: renamedSession.messageCount ?? prev.messageCount,
            }
          : prev
      ));
    } catch (error) {
      autoRenamedSessionIdsRef.current.delete(session.id);
      console.error('[Nexus] Failed to auto-title session:', error);
    }
  }, [currentSession, mapSessionRecord]);

  const serializeSessionMessages = useCallback(() => messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    tier: message.tier,
    type: message.type,
    toolStatus: message.toolStatus,
    toolName: message.toolName,
    toolArgs: message.type === 'tool-call' ? sanitizeToolPayload(message.toolArgs) : message.toolArgs,
    toolResult: message.type === 'tool-call' ? sanitizeToolPayload(message.toolResult) : message.toolResult,
    isFinal: message.isFinal,
    timestamp: message.timestamp,
  })), [messages]);

  const selectedBrainstorm = brainstormSessions.find((session) => session.id === selectedBrainstormId)
    || brainstormSessions[0]
    || null;
  const filteredSessions = sessions.filter((session) => matchesDataSearch(sessionSearchQuery, [
    session.name,
    session.id,
    formatSessionDateLabel(session),
    sessionSearchIndex[session.id],
  ]));
  const filteredAgents = agents.filter((agent) => matchesDataSearch(agentSearchQuery, [
    agent.name,
    agent.role,
    agent.status,
    agent.id,
  ]));
  const filteredTasks = tasks.filter((task) => matchesDataSearch(taskSearchQuery, [
    task.title,
    task.status,
    task.priority,
    task.result,
    task.id,
  ]));
  const filteredPipelines = pipelines.filter((pipeline) => matchesDataSearch(pipelineSearchQuery, [
    pipeline.name,
    pipeline.status,
    pipeline.currentStage,
    pipeline.sessionName,
    pipeline.id,
    ...(pipeline.stages || []).map((stage) => `${stage.name} ${stage.status}`),
  ]));
  const filteredProjectEvents = (currentProject?.recentEvents || []).filter((event) => matchesDataSearch(projectSearchQuery, [
    event.eventType,
    event.title,
    event.content,
    event.createdAt,
  ]));
  const filteredBrainstormSessions = brainstormSessions.filter((brainstorm) => matchesDataSearch(brainstormSearchQuery, [
    brainstorm.title,
    brainstorm.status,
    brainstorm.summaryExcerpt,
    brainstorm.transcript,
  ]));
  const filteredMasterDiaryEntries = masterDiaryEntries.filter((entry) => matchesDataSearch(diarySearchQuery, [
    entry.entryType,
    entry.activityKey,
    entry.content,
    entry.createdAt,
  ]));
  const filteredMasterNarratives = masterNarratives.filter((narrative) => matchesDataSearch(diarySearchQuery, [
    narrative.narrativeDay,
    narrative.narrative,
  ]));
  const filteredWorkspaceFiles = workspaceFiles.filter((file) => matchesDataSearch(workspaceFileSearchQuery, [
    file.name,
    file.path,
    file.modifiedAt,
  ]));
  const workspaceVideoFiles = useMemo(() => workspaceFiles.filter((file) => (
    (file.kind || inferArtifactKindFromPath(file.path || '')) === 'video'
  )), [workspaceFiles]);
  const workspaceImageFiles = useMemo(() => workspaceFiles.filter((file) => (
    (file.kind || inferArtifactKindFromPath(file.path || '')) === 'image'
  )), [workspaceFiles]);
  const filteredKnowledgeDocuments = knowledgeDocuments.filter((document) => matchesDataSearch(knowledgeSearchQuery, [
    document.title,
    document.source,
    document.preview,
    document.artifactPath,
    document.createdAt,
  ]));
  const globalSearchGroups = useMemo(() => Object.entries(globalSearchResults?.resultsBySource || {})
    .filter(([, items]) => Array.isArray(items) && items.length > 0) as Array<[string, GlobalSearchResultRecord[]]>, [globalSearchResults]);
  const brainstormTranscriptSegments = (selectedBrainstorm?.diarization || [])
    .filter((segment) => String(segment?.text || '').trim())
    .slice(0, 6);
  const brainstormTranscriptFallback = String(selectedBrainstorm?.transcript || '')
    .replace(/\s+/g, ' ')
    .trim();

  useEffect(() => {
    const videoPathSet = new Set(workspaceVideoFiles.map((file) => file.path));
    const imagePathSet = new Set(workspaceImageFiles.map((file) => file.path));

    setSelectedMediaVideoPaths((previous) => previous.filter((filePath) => videoPathSet.has(filePath)));
    setSelectedStitchVideoPaths((previous) => previous.filter((filePath) => videoPathSet.has(filePath)));
    setSelectedSlideshowImagePaths((previous) => previous.filter((filePath) => imagePathSet.has(filePath)));
  }, [workspaceImageFiles, workspaceVideoFiles]);

  useEffect(() => {
    if (!currentSession?.id) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void nexus.sessions.syncArchive(
        currentSession.id,
        currentSession.name,
        serializeSessionMessages()
      );
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [currentSession?.id, currentSession?.name, serializeSessionMessages]);

  const buildBrainstormFollowupPrompt = useCallback((record: BrainstormSessionRecord) => {
    const summary = (record.summaryExcerpt || record.briefingContent || record.transcript || '').trim();
    const compactSummary = summary.replace(/\s+/g, ' ').slice(0, 700);
    return [
      `A brainstorm session has just been completed for the current workspace.`,
      `Title: ${record.title}.`,
      compactSummary ? `Summary: ${compactSummary}` : '',
      `Action items identified: ${record.actionItemCount || 0}.`,
      `Transcript PDF: ${record.transcriptPdfPath || 'not available'}.`,
      `Briefing PDF: ${record.briefingPdfPath || 'not available'}.`,
      `Ask the user, in one short response, what they want to do with this brainstorm next. Offer concise options such as turning it into tasks, creating agents, building a document, opening the files, or starting outreach. Do not restate the full brainstorm.`,
    ].filter(Boolean).join(' ');
  }, []);

  const showYouTubeVideo = useCallback(async (url: string) => {
    const normalized = await nexus.brainstorm.showYouTube(url);
    const viewer = {
      title: normalized.title || 'YouTube Video',
      sourceUrl: normalized.sourceUrl,
      embedUrl: normalized.embedUrl,
      videoId: normalized.videoId,
    };
    stageYouTubeViewerInWorkspace(viewer);
    return normalized;
  }, [stageYouTubeViewerInWorkspace]);

  const openBrowserWindow = useCallback(async (url: string, title?: string) => {
    const opened = await nexus.browser.open(url, title);
    return opened;
  }, []);

  const finalizeVoiceSession = useCallback(async (
    targetConversationId?: string | null,
    targetSessionId?: string
  ) => {
    const conversationKey = String(targetConversationId || '').trim();
    const sessionKey = String(targetSessionId || currentSession?.id || '').trim();

    if (!conversationKey || finalizedVoiceSessionsRef.current.has(conversationKey)) {
      return null;
    }

    finalizedVoiceSessionsRef.current.add(conversationKey);

    try {
      const result = await nexus.elevenlabs.endSession(conversationKey, sessionKey || undefined);

      if (result?.transcriptStored) {
        void refreshWorkspaceFiles();
        if (sessionKey) {
          void refreshKnowledgeDocuments(sessionKey);
          void refreshKnowledgeStats(sessionKey);
        }
      }

      return result;
    } catch (error) {
      finalizedVoiceSessionsRef.current.delete(conversationKey);
      throw error;
    }
  }, [currentSession?.id, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles]);

  const loadMarketingBridgeState = useCallback(async () => {
    const state = await nexus.marketing.getBridgeState();
    setMarketingBridgeState(state);
    return state as MarketingBridgeState;
  }, []);

  const refreshMarketingVideoConfig = useCallback(async () => {
    try {
      const config = await nexus.marketing.getVideoConfig();
      const voiceProfiles = Array.isArray(config?.voiceProfiles) ? config.voiceProfiles : [];
      const avatarProfiles = Array.isArray(config?.avatarProfiles) ? config.avatarProfiles : [];
      setMarketingVideoConfig(config);
      setMarketingVoiceProfiles(voiceProfiles);
      setHeyGenAvatarProfiles(avatarProfiles);
      setSelectedMarketingVoiceProfileId((current) => current || voiceProfiles[0]?.id || '');
      setSelectedHeyGenAvatarProfileId((current) => current || avatarProfiles[0]?.id || '');
      return config as MarketingVideoConfig;
    } catch (error: any) {
      addSystemMessage(`Failed to load HeyGen video config: ${error.message || 'Unknown error'}`);
      return null;
    }
  }, [addSystemMessage]);

  const openMarketingDepartment = useCallback(async () => {
    try {
      await loadMarketingBridgeState();
      await refreshMarketingVideoConfig();
      setShowMarketingDepartment(true);
    } catch (error: any) {
      addSystemMessage(`Failed to open Marketing Department: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, loadMarketingBridgeState, refreshMarketingVideoConfig]);

  const loadAgentHubListings = useCallback(async () => {
    setAgentHubLoading(true);
    try {
      const listings = await nexus.agentHub.list({ status: 'all', limit: 100 });
      setAgentHubListings(Array.isArray(listings) ? listings : []);
    } catch (error: any) {
      addSystemMessage(`Failed to load Agent Hub: ${error.message || 'Unknown error'}`);
    } finally {
      setAgentHubLoading(false);
    }
  }, [addSystemMessage]);

  const openAgentHub = useCallback(async () => {
    setShowAgentHub(true);
    await loadAgentHubListings();
  }, [loadAgentHubListings]);

  const publishAgentHubListing = useCallback(async () => {
    const name = agentHubDraft.name.trim();
    if (!name) {
      addSystemMessage('Agent Hub listing name is required.');
      return;
    }

    setAgentHubPublishing(true);
    try {
      const priceCents = Math.max(0, Math.round(Number(agentHubDraft.priceDollars || 0) * 100));
      const listing = await nexus.agentHub.createListing({
        name,
        tagline: agentHubDraft.tagline.trim(),
        description: agentHubDraft.description.trim(),
        category: agentHubDraft.category.trim() || 'General',
        sellerName: agentHubDraft.sellerName.trim(),
        sellerContact: agentHubDraft.sellerContact.trim(),
        priceCents,
        currency: 'USD',
        template: agentHubDraft.template || 'custom',
        status: 'published',
      });

      setAgentHubListings((prev) => [listing, ...prev.filter((item) => item.id !== listing.id)]);
      setAgentHubDraft((prev) => ({
        ...prev,
        name: '',
        tagline: '',
        description: '',
        priceDollars: '0',
      }));
      addSystemMessage(`Published "${listing.name}" to Agent Hub.`);
    } catch (error: any) {
      addSystemMessage(`Failed to publish Agent Hub listing: ${error.message || 'Unknown error'}`);
    } finally {
      setAgentHubPublishing(false);
    }
  }, [addSystemMessage, agentHubDraft]);

  const installAgentHubListing = useCallback(async (listing: AgentHubListing) => {
    setAgentHubInstallingId(listing.id);
    try {
      const result = await nexus.agentHub.install(listing.id, {
        sessionId: currentSession?.id,
        name: listing.name,
      });

      if (result?.agent) {
        setAgents((prev) => {
          const mapped = mapAgentRecord(result.agent);
          return [mapped, ...prev.filter((agent) => agent.id !== mapped.id)];
        });
      }

      if (result?.listing) {
        setAgentHubListings((prev) => prev.map((item) => item.id === result.listing.id ? result.listing : item));
      }

      addSystemMessage(result?.message || `Installed "${listing.name}" from Agent Hub.`);
    } catch (error: any) {
      addSystemMessage(`Failed to install Agent Hub listing: ${error.message || 'Unknown error'}`);
    } finally {
      setAgentHubInstallingId(null);
    }
  }, [addSystemMessage, currentSession?.id, mapAgentRecord]);

  const openMarketingNotebookExternal = useCallback(async () => {
    try {
      await nexus.marketing.openExternal(marketingBridgeState?.notebookUrl);
    } catch (error: any) {
      addSystemMessage(`Failed to open NotebookLM externally: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, marketingBridgeState?.notebookUrl]);

  const revealMarketingFolder = useCallback(async (folder: 'root' | 'incoming' | 'outgoing') => {
    try {
      await nexus.marketing.revealFolder(folder);
    } catch (error: any) {
      addSystemMessage(`Failed to reveal Marketing Department folder: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage]);

  const addMarketingVoiceProfile = useCallback(() => {
    setMarketingVoiceProfiles((prev) => [
      ...prev,
      {
        id: `voice-${Date.now()}`,
        name: `Voice ${prev.length + 1}`,
        agentId: '',
        voiceId: '',
        modelId: 'eleven_multilingual_v2',
      },
    ]);
  }, []);

  const addHeyGenAvatarProfile = useCallback(() => {
    setHeyGenAvatarProfiles((prev) => [
      ...prev,
      {
        id: `avatar-${Date.now()}`,
        name: `Avatar ${prev.length + 1}`,
        avatarId: '',
        avatarStyle: 'normal',
        width: 1280,
        height: 720,
      },
    ]);
  }, []);

  const assistHeyGenScript = useCallback(async () => {
    const brief = heyGenVideoScript.trim() || heyGenVideoTitle.trim();
    if (!brief) {
      addSystemMessage('Add a short HeyGen video brief or title first.');
      return;
    }

    setIsAssistingHeyGenScript(true);
    try {
      const result = await nexus.marketing.generateAssistedPrompt({
        target: 'heygen_video',
        brief,
        audience: 'Lincutterz customer or sales prospect',
        brand: 'Lincutterz',
        tone: 'short, direct, conversational',
        existingPrompt: heyGenVideoScript.trim() || undefined,
      });
      if (result?.prompt) {
        setHeyGenVideoScript(result.prompt);
      }
      addSystemMessage('HeyGen script assisted draft generated.');
    } catch (error: any) {
      addSystemMessage(`HeyGen script assist failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsAssistingHeyGenScript(false);
    }
  }, [addSystemMessage, heyGenVideoScript, heyGenVideoTitle]);

  const createHeyGenMarketingVideo = useCallback(async () => {
    const script = heyGenVideoScript.trim();
    if (!script) {
      addSystemMessage('HeyGen video script is required.');
      return;
    }

    setIsCreatingHeyGenVideo(true);
    try {
      const result = await nexus.marketing.createHeyGenVideo({
        title: heyGenVideoTitle.trim() || 'Lincutterz video message',
        script,
        voiceProfileId: selectedMarketingVoiceProfileId,
        avatarProfileId: selectedHeyGenAvatarProfileId,
        caption: heyGenCaptionEnabled,
      });
      setHeyGenVideoResult(result);
      addSystemMessage(result?.message || `Submitted HeyGen video ${result?.videoId || ''}.`);
      await refreshMarketingVideoConfig();
    } catch (error: any) {
      addSystemMessage(`HeyGen video generation failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsCreatingHeyGenVideo(false);
    }
  }, [
    addSystemMessage,
    heyGenCaptionEnabled,
    heyGenVideoScript,
    heyGenVideoTitle,
    refreshMarketingVideoConfig,
    selectedHeyGenAvatarProfileId,
    selectedMarketingVoiceProfileId,
  ]);

  const assistGrokMediaPrompt = useCallback(async () => {
    const brief = grokMediaPrompt.trim() || grokMediaTitle.trim();
    if (!brief) {
      addSystemMessage('Add a Grok image/video brief first.');
      return;
    }

    setIsAssistingGrokPrompt(true);
    try {
      const result = await nexus.marketing.generateAssistedPrompt({
        target: grokMediaMode === 'video' ? 'grok_video' : 'grok_image',
        brief,
        audience: 'Lincutterz customer or sales prospect',
        brand: 'Lincutterz',
        tone: 'premium, sharp, retail-ready',
        existingPrompt: grokMediaPrompt.trim() || undefined,
      });
      if (result?.prompt) {
        setGrokMediaPrompt(result.prompt);
      }
      addSystemMessage('Grok media prompt assisted draft generated.');
    } catch (error: any) {
      addSystemMessage(`Grok prompt assist failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsAssistingGrokPrompt(false);
    }
  }, [addSystemMessage, grokMediaMode, grokMediaPrompt, grokMediaTitle]);

  const createGrokMarketingMedia = useCallback(async () => {
    const prompt = grokMediaPrompt.trim();
    if (!prompt) {
      addSystemMessage('Grok media prompt is required.');
      return;
    }

    setIsCreatingGrokMedia(true);
    try {
      const result = grokMediaMode === 'video'
        ? await nexus.marketing.createGrokVideo({
            title: grokMediaTitle.trim() || 'Lincutterz Grok video',
            prompt,
            imageUrl: grokMediaImageUrl.trim() || undefined,
            imagePath: grokMediaImagePath.trim() || undefined,
            duration: grokVideoDuration,
            aspectRatio: grokVideoAspectRatio,
            resolution: grokVideoResolution,
          })
        : await nexus.marketing.createGrokImage({
            title: grokMediaTitle.trim() || 'Lincutterz Grok image',
            prompt,
            aspectRatio: grokImageAspectRatio,
            resolution: grokImageResolution,
          });

      setGrokMediaResult(result);
      addSystemMessage(result?.message || `Grok ${grokMediaMode} request completed.`);
    } catch (error: any) {
      addSystemMessage(`Grok ${grokMediaMode} generation failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsCreatingGrokMedia(false);
    }
  }, [
    addSystemMessage,
    grokImageAspectRatio,
    grokImageResolution,
    grokMediaImagePath,
    grokMediaImageUrl,
    grokMediaMode,
    grokMediaPrompt,
    grokMediaTitle,
    grokVideoAspectRatio,
    grokVideoDuration,
    grokVideoResolution,
  ]);

  useEffect(() => {
    if (!showMarketingDepartment || marketingBridgeState) {
      return;
    }

    void loadMarketingBridgeState();
  }, [loadMarketingBridgeState, marketingBridgeState, showMarketingDepartment]);

  useEffect(() => {
    const unsubscribe = nexus.marketing.onDownloadEvent((payload: any) => {
      const eventType = String(payload?.type || '').trim();
      const fileName = String(payload?.fileName || '').trim();
      const targetPath = String(payload?.targetPath || '').trim();
      const detail = String(payload?.detail || payload?.error || '').trim();

      if (eventType === 'download-started') {
        const message = fileName
          ? `NotebookLM download started: ${fileName}`
          : 'NotebookLM download started.';
        setMarketingDownloadStatus(message);
        addSystemMessage(message);
        return;
      }

      if (eventType === 'download-saved') {
        const message = targetPath
          ? `NotebookLM download saved to ${targetPath}`
          : fileName
            ? `NotebookLM download saved: ${fileName}`
            : 'NotebookLM download saved.';
        setMarketingDownloadStatus(message);
        addSystemMessage(message);
        return;
      }

      if (eventType === 'download-error') {
        const message = detail
          ? `NotebookLM download failed: ${detail}`
          : 'NotebookLM download failed.';
        setMarketingDownloadStatus(message);
        addSystemMessage(message);
      }
    });

    return unsubscribe;
  }, [addSystemMessage]);

  useEffect(() => {
    if (!showMarketingDepartment) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadMarketingBridgeState();
      void refreshWorkspaceFiles();
      void refreshProjects();
      void refreshMasterDiary();

      if (currentSession?.id) {
        void refreshKnowledgeDocuments(currentSession.id);
        void refreshCurrentProject(currentSession.id);
        void refreshKnowledgeStats(currentSession.id);
      }
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [
    currentSession?.id,
    loadMarketingBridgeState,
    refreshCurrentProject,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshMasterDiary,
    refreshProjects,
    refreshWorkspaceFiles,
    showMarketingDepartment,
  ]);

  const resolveYouTubeTarget = useCallback((params: Record<string, any>) => (
    params.url
    || params.youtube_url
    || params.youtubeUrl
    || params.video_id
    || params.videoId
    || ''
  ), []);

  const processBrainstormRecording = useCallback(async (brainstormId: string, chunks: Blob[]) => {
    const audioBlob = new Blob(chunks, { type: 'audio/webm' });
    const audioBase64 = await blobToDataUrl(audioBlob);
    const record = await nexus.brainstorm.processAudio(brainstormId, audioBase64);
    upsertBrainstormSession(record);
    const sessionId = String(record?.sessionId || '').trim();
    if (sessionId) {
      void refreshKnowledgeDocuments(sessionId);
      void refreshKnowledgeStats(sessionId);
    }
    return record as BrainstormSessionRecord;
  }, [blobToDataUrl, refreshKnowledgeDocuments, refreshKnowledgeStats, upsertBrainstormSession]);

  const beginBrainstormCapture = useCallback(async (requestedTitle?: string, options?: { keepVoiceSession?: boolean }) => {
    if (!currentSession?.id) {
      throw new Error('Create or select a chat session before starting a brainstorm.');
    }

    if (isBrainstormRecording) {
      throw new Error('A brainstorm recording is already in progress.');
    }

    if (isBrainstormProcessing) {
      throw new Error('A brainstorm is already being processed.');
    }

    if (!options?.keepVoiceSession && (conversationStatus === 'connected' || conversationStatus === 'connecting')) {
      if (conversationRef.current) {
        try {
          await conversationRef.current.endSession();
        } catch {
          // Ignore voice shutdown errors before brainstorm capture.
        }
        conversationRef.current = null;
      }

      if (audioLevelInterval.current) {
        clearInterval(audioLevelInterval.current);
        audioLevelInterval.current = null;
      }

      if (conversationId) {
        void finalizeVoiceSession(conversationId, currentSession.id).catch((error: any) => {
          addSystemMessage(`Voice transcript finalization failed: ${error.message || 'Unknown error'}`);
        });
      }

      setConversationId(null);
      setConversationStatus('disconnected');
      setConversationMode('idle');
      setAudioLevel(0);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This environment does not support microphone capture.');
    }

    const title = requestedTitle?.trim() || brainstormTitle.trim() || `Brainstorm ${new Date().toLocaleString()}`;
    const record = await nexus.brainstorm.start(currentSession.id, title);
    upsertBrainstormSession(record);
    setBrainstormTitle(record.title || title);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    brainstormStreamRef.current = stream;

    const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    brainstormChunksRef.current = [];
    activeBrainstormIdRef.current = record.id;
    brainstormRecorderRef.current = recorder;
    setSelectedBrainstormId(record.id);

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        brainstormChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      releaseBrainstormResources();
      setIsBrainstormRecording(false);
      setIsBrainstormProcessing(false);
      activeBrainstormIdRef.current = null;
      addSystemMessage('Brainstorm recording failed. Check microphone access and try again.');
    };

    recorder.onstop = async () => {
      const brainstormId = activeBrainstormIdRef.current;
      const chunksSnapshot = [...brainstormChunksRef.current];

      releaseBrainstormResources();
      setIsBrainstormRecording(false);

      if (!brainstormId) {
        setIsBrainstormProcessing(false);
        return;
      }

      if (chunksSnapshot.length === 0) {
        setIsBrainstormProcessing(false);
        activeBrainstormIdRef.current = null;
        addSystemMessage('Brainstorm recording was empty.');
        return;
      }

      try {
        const processed = await processBrainstormRecording(brainstormId, chunksSnapshot);
        addSystemMessage(`Brainstorm "${processed.title}" processed. Transcript, briefing, and knowledge entries are ready.`);

        const followupPrompt = buildBrainstormFollowupPrompt(processed);
        if (isElevenLabsConfigured) {
          try {
            if (conversationRef.current && conversationStatus === 'connected') {
              conversationRef.current.sendUserMessage(followupPrompt);
            } else {
              await startConversationRef.current?.({
                suppressGreeting: true,
                initialUserMessage: followupPrompt,
              });
            }
          } catch (handoffError: any) {
            addSystemMessage(`Voice handoff after brainstorm failed: ${handoffError.message || 'Unknown error'}`);
          }
        }
      } catch (error: any) {
        addSystemMessage(`Brainstorm processing failed: ${error.message || 'Unknown error'}`);
        try {
          const latest = await nexus.brainstorm.get(brainstormId);
          if (latest) {
            upsertBrainstormSession(latest);
          }
        } catch {
          // Ignore follow-up load failures.
        }
      } finally {
        setIsBrainstormProcessing(false);
        activeBrainstormIdRef.current = null;
      }
    };

    recorder.start(1000);
    brainstormStartedAtRef.current = Date.now();
    setIsBrainstormRecording(true);
    setIsBrainstormProcessing(false);
    setBrainstormElapsedMs(0);
    brainstormTimerRef.current = window.setInterval(() => {
      const startedAt = brainstormStartedAtRef.current;
      if (startedAt) {
        setBrainstormElapsedMs(Date.now() - startedAt);
      }
    }, 250);

    return record as BrainstormSessionRecord;
  }, [
    addSystemMessage,
    brainstormTitle,
    conversationStatus,
    currentSession?.id,
    buildBrainstormFollowupPrompt,
    isElevenLabsConfigured,
    isBrainstormProcessing,
    isBrainstormRecording,
    processBrainstormRecording,
    releaseBrainstormResources,
    upsertBrainstormSession,
    conversationId,
    finalizeVoiceSession,
  ]);

  const stopBrainstormCapture = useCallback(async () => {
    const recorder = brainstormRecorderRef.current;

    if (!recorder || recorder.state === 'inactive') {
      throw new Error('No active brainstorm recording to stop.');
    }

    setIsBrainstormRecording(false);
    setIsBrainstormProcessing(true);
    recorder.stop();

    return {
      message: 'Brainstorm recording stopped. Processing transcript, PDFs, and briefing now.',
      brainstormId: activeBrainstormIdRef.current,
    };
  }, []);

  const deleteBrainstorm = useCallback(async (record: BrainstormSessionRecord) => {
    if (!record?.id) {
      return;
    }

    if (
      isBrainstormRecording
      || isBrainstormProcessing
      || record.status === 'recording'
      || record.status === 'processing'
    ) {
      addSystemMessage('Wait for the active Brain Storm recording or processing run to finish before deleting it.');
      return;
    }

    const confirmed = window.confirm(`Delete Brain Storm "${record.title}"?`);
    if (!confirmed) {
      return;
    }

    setIsDeletingBrainstormId(record.id);

    try {
      await nexus.brainstorm.delete(record.id);
      if (activeBrainstormIdRef.current === record.id) {
        activeBrainstormIdRef.current = null;
      }
      setBrainstormSessions((prev) => prev.filter((session) => session.id !== record.id));
      if (selectedBrainstormId === record.id) {
        setSelectedBrainstormId(null);
      }
      addSystemMessage(`Deleted Brain Storm "${record.title}".`);
    } catch (error: any) {
      addSystemMessage(`Failed to delete Brain Storm: ${error.message || 'Unknown error'}`);
    } finally {
      setIsDeletingBrainstormId((current) => (current === record.id ? null : current));
    }
  }, [addSystemMessage, isBrainstormProcessing, isBrainstormRecording, selectedBrainstormId]);

  const runNetworkHealthCheck = useCallback(async () => {
    setIsRunningNetworkHealth(true);

    try {
      const report = await nexus.diagnostics.runNetworkHealth();
      setNetworkHealthReport(report);
    } catch (error: any) {
      addSystemMessage(`Network diagnostics failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRunningNetworkHealth(false);
    }
  }, [addSystemMessage]);

  const refreshOllamaStatus = useCallback(async (options?: { quiet?: boolean }) => {
    const quiet = options?.quiet ?? false;

    if (!quiet) {
      setIsRefreshingOllamaStatus(true);
    }

    try {
      const state = await nexus.diagnostics.ollamaStatus();
      setOllamaState({
        ...state,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      setOllamaState({
        status: 'error',
        binaryPath: null,
        url: 'http://localhost:11434',
        models: [],
        missingModels: [],
        error: error.message || 'Unknown error',
        managedProcess: false,
        checkedAt: new Date().toISOString(),
      });
      if (!quiet) {
        addSystemMessage(`Ollama status check failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      if (!quiet) {
        setIsRefreshingOllamaStatus(false);
      }
    }
  }, [addSystemMessage]);

  const restartOllama = useCallback(async () => {
    setIsRestartingOllama(true);

    try {
      const state = await nexus.diagnostics.ollamaRestart();
      setOllamaState({
        ...state,
        checkedAt: new Date().toISOString(),
      });
      addSystemMessage(`Ollama restart requested. Current status: ${formatOllamaStatusLabel(state?.status)}.`);
    } catch (error: any) {
      addSystemMessage(`Ollama restart failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRestartingOllama(false);
    }
  }, [addSystemMessage]);

  useEffect(() => {
    void refreshOllamaStatus({ quiet: true });
  }, [refreshOllamaStatus]);

  useEffect(() => {
    if (!offlineModeEnabled && !showSettings) {
      return;
    }

    void refreshOllamaStatus({ quiet: true });
    const intervalId = window.setInterval(() => {
      void refreshOllamaStatus({ quiet: true });
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [offlineModeEnabled, refreshOllamaStatus, showSettings]);

  const updateMessage = useCallback((messageId: string, updater: (message: Message) => Message) => {
    setMessages((prev) => prev.map((message) => (
      message.id === messageId ? updater(message) : message
    )));
  }, []);

  const getArtifactKind = useCallback((filePath: string): ArtifactKind | null => inferArtifactKindFromPath(filePath), []);

  const collectArtifactReferences = useCallback((value: unknown, seen = new Set<string>()): ArtifactReference[] => {
    if (typeof value === 'string') {
      const matches = value.match(/\/(?:Users|Volumes|private|tmp)[^\n]+?\.(?:pdf|png|jpe?g|gif|webp|svg|xlsx|xls|txt|md|markdown|json|csv|tsv|html?|xml|ya?ml|log|js|ts|jsx|tsx|mp3|wav|m4a|ogg|webm|mp4|mov|m4v|mkv)\b/gi) || [];
      return matches
        .map((match) => match.trim().replace(/[)\].,]+$/, ''))
        .map((filePath) => {
          const kind = getArtifactKind(filePath);
          if (!kind || seen.has(filePath)) {
            return null;
          }

          seen.add(filePath);
          return {
            path: filePath,
            kind,
            name: filePath.split('/').pop() || filePath,
          } satisfies ArtifactReference;
        })
        .filter((artifact): artifact is ArtifactReference => Boolean(artifact));
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => collectArtifactReferences(item, seen));
    }

    if (value && typeof value === 'object') {
      return Object.values(value).flatMap((item) => collectArtifactReferences(item, seen));
    }

    return [];
  }, [getArtifactKind]);

  const normalizeSpreadsheetWorkbook = useCallback((value: unknown): SpreadsheetWorkbookData | null => {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = (value as any).workbook && typeof (value as any).workbook === 'object'
      ? (value as any).workbook
      : value as any;

    if (!candidate || typeof candidate.path !== 'string' || !Array.isArray(candidate.sheets)) {
      return null;
    }

    const sheets = candidate.sheets
      .filter((sheet: any) => sheet && typeof sheet === 'object' && typeof sheet.name === 'string')
      .map((sheet: any) => ({
        name: String(sheet.name),
        headers: Array.isArray(sheet.headers) ? sheet.headers.map((header: any) => String(header)) : [],
        rowCount: Number(sheet.rowCount || 0),
        columnCount: Number(sheet.columnCount || 0),
        rows: Array.isArray(sheet.rows) ? sheet.rows : [],
        truncated: Boolean(sheet.truncated),
      }));

    if (sheets.length === 0) {
      return null;
    }

    const format = ['xlsx', 'xls', 'csv', 'tsv'].includes(String(candidate.format || '').toLowerCase())
      ? String(candidate.format).toLowerCase() as SpreadsheetWorkbookData['format']
      : 'xlsx';

    return {
      path: String(candidate.path),
      name: String(candidate.name || candidate.path.split('/').pop() || 'spreadsheet'),
      format,
      sheetNames: Array.isArray(candidate.sheetNames) && candidate.sheetNames.length > 0
        ? candidate.sheetNames.map((sheetName: any) => String(sheetName))
        : sheets.map((sheet: SpreadsheetSheetData) => sheet.name),
      sheets,
      summary: String(candidate.summary || ''),
    };
  }, []);

  const findSpreadsheetWorkbook = useCallback((value: unknown, depth = 0): SpreadsheetWorkbookData | null => {
    if (depth > 4 || value === null || value === undefined) {
      return null;
    }

    const normalized = normalizeSpreadsheetWorkbook(value);
    if (normalized) {
      return normalized;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findSpreadsheetWorkbook(item, depth + 1);
        if (nested) {
          return nested;
        }
      }
      return null;
    }

    if (typeof value === 'object') {
      for (const nestedValue of Object.values(value as Record<string, unknown>)) {
        const nested = findSpreadsheetWorkbook(nestedValue, depth + 1);
        if (nested) {
          return nested;
        }
      }
    }

    return null;
  }, [normalizeSpreadsheetWorkbook]);

  const openTextArtifactViewer = useCallback((title: string, content: string, sourcePath?: string) => {
    stageArtifactInWorkspace({
      path: sourcePath || `viewer:${title}`,
      name: title,
      kind: 'text',
      dataUrl: '',
      mimeType: 'text/plain; charset=utf-8',
      textContent: content,
    });
  }, [stageArtifactInWorkspace]);

  const setSpreadsheetArtifactView = useCallback((workbook: SpreadsheetWorkbookData, preferredSheet?: string) => {
    const initialSheet = preferredSheet && workbook.sheets.some((sheet) => sheet.name === preferredSheet)
      ? preferredSheet
      : workbook.sheets[0]?.name || workbook.sheetNames[0] || '';

    setSpreadsheetEditor(null);
    setActiveSpreadsheetSheet(initialSheet);
    stageArtifactInWorkspace({
      path: workbook.path,
      name: workbook.name,
      kind: 'spreadsheet',
      dataUrl: '',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      spreadsheetData: workbook,
    });
  }, [stageArtifactInWorkspace]);

  const openArtifactViewer = useCallback(async (artifact: ArtifactReference) => {
    try {
      setArtifactLoadingPath(artifact.path);
      const loaded = await nexus.artifacts.load(artifact.path);
      stageArtifactInWorkspace({
        path: loaded.path,
        name: loaded.name,
        kind: loaded.kind,
        dataUrl: loaded.dataUrl,
        mimeType: loaded.mimeType,
        textContent: loaded.textContent,
        spreadsheetData: loaded.spreadsheetData,
      });
    } catch (error: any) {
      addSystemMessage(`Failed to preview artifact: ${error.message || 'Unknown error'}`);
    } finally {
      setArtifactLoadingPath(null);
    }
  }, [addSystemMessage, stageArtifactInWorkspace]);

  const handleLegalAnalysisComplete = useCallback(async (report: LegalAnalysisReportRecord) => {
    setLastLegalAnalysisReport(report);
    addSystemMessage(`Legal analysis report created at ${report.markdownPath}`);

    await Promise.all([
      refreshWorkspaceFiles(),
      currentSession?.id ? refreshKnowledgeDocuments(currentSession.id) : Promise.resolve(),
      currentSession?.id ? refreshKnowledgeStats(currentSession.id) : Promise.resolve(),
    ]);

    stageLegalReportInWorkspace(report);
  }, [
    addSystemMessage,
    currentSession?.id,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshWorkspaceFiles,
    stageLegalReportInWorkspace,
  ]);

  useEffect(() => {
    const unsubscribe = nexus.legal.onOpenReport((report: any) => {
      if (!report || typeof report !== 'object') {
        return;
      }
      const normalized = report as LegalAnalysisReportRecord;
      setLastLegalAnalysisReport(normalized);
      stageLegalReportInWorkspace(normalized);
      addSystemMessage(`Opened Agreeable Agreements report: ${normalized.reportTitle || normalized.sourceTitle || 'Saved report'}`);
    });

    return unsubscribe;
  }, [addSystemMessage, stageLegalReportInWorkspace]);

  const stopTutorialPlayback = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    tutorialUtteranceRef.current = null;
    setActiveTutorialPlaybackId(null);
  }, []);

  const playTutorial = useCallback((tutorialId: string) => {
    const tutorial = getBuiltinTutorialById(tutorialId);
    if (!tutorial) {
      return;
    }

    if (activeTutorialPlaybackId === tutorial.id) {
      stopTutorialPlayback();
      return;
    }

    stopTutorialPlayback();

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      addSystemMessage('Tutorial playback is not available in this environment.');
      return;
    }

    const playbackText = getBuiltinTutorialPlaybackText(tutorial.id);
    if (!playbackText) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(playbackText);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      tutorialUtteranceRef.current = null;
      setActiveTutorialPlaybackId((current) => (current === tutorial.id ? null : current));
    };
    utterance.onerror = () => {
      tutorialUtteranceRef.current = null;
      setActiveTutorialPlaybackId((current) => (current === tutorial.id ? null : current));
    };

    tutorialUtteranceRef.current = utterance;
    setActiveTutorialPlaybackId(tutorial.id);
    window.speechSynthesis.speak(utterance);
  }, [activeTutorialPlaybackId, addSystemMessage, stopTutorialPlayback]);

  useEffect(() => () => {
    stopTutorialPlayback();
  }, [stopTutorialPlayback]);

  useEffect(() => {
    if (!workspacePresenterOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspacePresenterOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [workspacePresenterOpen]);

  useEffect(() => {
    const disposePresentArtifact = nexus.workspace.onPresentArtifact((payload: any) => {
      const filePath = String(payload?.path || '').trim();
      if (!filePath) {
        return;
      }

      void openArtifactViewer({
        path: filePath,
        kind: ((payload?.kind || getArtifactKind(filePath) || 'text') as ArtifactKind),
        name: payload?.name || basenameFromUiPath(filePath) || 'Workspace File',
      });
    });

    const disposeOpenTutorial = nexus.workspace.onOpenTutorial((payload: any) => {
      const tutorialId = String(payload?.tutorialId || '').trim();
      stageTutorialsInWorkspace(tutorialId);
    });

    const disposeCloseActiveStage = nexus.workspace.onCloseActiveStage(() => {
      const activeTab = workspaceStageTabs.find((tab) => tab.id === activeWorkspaceStageTabId) || WORKSPACE_MISSION_STAGE_TAB;
      if (activeTab.type === 'mission') {
        setWorkspacePresenterOpen(false);
        return;
      }

      closeWorkspaceStageTab(activeTab.id);
    });

    return () => {
      disposePresentArtifact();
      disposeOpenTutorial();
      disposeCloseActiveStage();
    };
  }, [activeWorkspaceStageTabId, closeWorkspaceStageTab, openArtifactViewer, stageTutorialsInWorkspace, workspaceStageTabs]);

  const loadMediaStatus = useCallback(async (silent = false) => {
    try {
      setIsLoadingMediaStatus(true);
      const status = await nexus.media.getStatus();
      setMediaStatus(status as MediaStatusRecord);
    } catch (error: any) {
      if (!silent) {
        addSystemMessage(`Failed to load media status: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsLoadingMediaStatus(false);
    }
  }, [addSystemMessage]);

  useEffect(() => {
    void loadMediaStatus(true);
  }, [loadMediaStatus]);

  const indexSelectedMediaVideos = useCallback(async () => {
    if (selectedMediaVideoPaths.length === 0) {
      addSystemMessage('Select one or more workspace videos to index first.');
      return;
    }

    setIsMediaIndexing(true);
    try {
      const result = await nexus.media.indexVideos(selectedMediaVideoPaths, {
        backend: mediaBackend,
        model: mediaModel.trim() || undefined,
      });
      const normalized = result as {
        stats?: { totalChunks?: number; uniqueSourceFiles?: number };
        indexedPaths?: string[];
      };
      addSystemMessage(
        `Indexed ${normalized.indexedPaths?.length || selectedMediaVideoPaths.length} video file${(normalized.indexedPaths?.length || selectedMediaVideoPaths.length) === 1 ? '' : 's'} for semantic search.`
      );
      await loadMediaStatus(true);
    } catch (error: any) {
      addSystemMessage(`Video indexing failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsMediaIndexing(false);
    }
  }, [addSystemMessage, loadMediaStatus, mediaBackend, mediaModel, selectedMediaVideoPaths]);

  const runMediaVideoSearch = useCallback(async () => {
    const query = mediaSearchQuery.trim();
    if (!query) {
      return;
    }

    setIsMediaSearching(true);
    try {
      const response = await nexus.media.searchVideos(query, {
        backend: mediaBackend,
        model: mediaModel.trim() || undefined,
        results: 6,
      });
      const normalized = response as MediaSearchResponseRecord;
      setMediaSearchResults(Array.isArray(normalized.results) ? normalized.results : []);
      if (!normalized.results || normalized.results.length === 0) {
        addSystemMessage('No semantic video matches were found for that query.');
      }
      await loadMediaStatus(true);
    } catch (error: any) {
      addSystemMessage(`Video search failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsMediaSearching(false);
    }
  }, [addSystemMessage, loadMediaStatus, mediaBackend, mediaModel, mediaSearchQuery]);

  const clipMediaSearchResult = useCallback(async (result: MediaSearchResultRecord) => {
    if (!currentSession?.id) {
      addSystemMessage('Open a session before creating clips.');
      return;
    }

    try {
      const clip = await nexus.media.clipVideo({
        sessionId: currentSession.id,
        sourceFile: result.sourceFile,
        title: `${result.sourceName.replace(/\.[^.]+$/, '')} ${formatSecondsLabel(result.startTime)}-${formatSecondsLabel(result.endTime)}`,
        startTime: result.startTime,
        endTime: result.endTime,
      });
      await Promise.all([
        refreshWorkspaceFiles(),
        refreshKnowledgeDocuments(currentSession.id),
        refreshKnowledgeStats(currentSession.id),
      ]);
      const artifact = (clip as any)?.artifact;
      if (artifact?.path) {
        await openArtifactViewer(artifact);
      }
    } catch (error: any) {
      addSystemMessage(`Clip creation failed: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, currentSession?.id, openArtifactViewer, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles]);

  const stitchSelectedMediaVideos = useCallback(async () => {
    if (!currentSession?.id) {
      addSystemMessage('Open a session before stitching videos.');
      return;
    }
    if (selectedStitchVideoPaths.length < 2) {
      addSystemMessage('Select at least two videos or clips to stitch together.');
      return;
    }

    setIsMediaStitching(true);
    try {
      const stitched = await nexus.media.stitchVideos({
        sessionId: currentSession.id,
        title: mediaStitchTitle.trim() || 'Workspace Montage',
        videoPaths: selectedStitchVideoPaths,
      });
      await Promise.all([
        refreshWorkspaceFiles(),
        refreshKnowledgeDocuments(currentSession.id),
        refreshKnowledgeStats(currentSession.id),
      ]);
      const artifact = (stitched as any)?.artifact;
      if (artifact?.path) {
        await openArtifactViewer(artifact);
      }
    } catch (error: any) {
      addSystemMessage(`Video stitching failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsMediaStitching(false);
    }
  }, [addSystemMessage, currentSession?.id, mediaStitchTitle, openArtifactViewer, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles, selectedStitchVideoPaths]);

  const createNarratedMediaSlideshow = useCallback(async () => {
    if (!currentSession?.id) {
      addSystemMessage('Open a session before creating a narrated slideshow.');
      return;
    }
    if (selectedSlideshowImagePaths.length === 0) {
      addSystemMessage('Select one or more images first.');
      return;
    }

    setIsMediaRendering(true);
    try {
      const slideshow = await nexus.media.createNarratedSlideshow({
        sessionId: currentSession.id,
        title: mediaSlideshowTitle.trim() || 'Narrated Slideshow',
        imagePaths: selectedSlideshowImagePaths,
        narrationText: mediaNarrationText.trim() || undefined,
      });
      const normalized = slideshow as {
        artifact?: ArtifactReference;
        audioArtifact?: ArtifactReference;
        narrationText?: string;
      };
      if (!mediaNarrationText.trim() && normalized.narrationText) {
        setMediaNarrationText(normalized.narrationText);
      }
      await Promise.all([
        refreshWorkspaceFiles(),
        refreshKnowledgeDocuments(currentSession.id),
        refreshKnowledgeStats(currentSession.id),
      ]);
      if (normalized.artifact?.path) {
        await openArtifactViewer(normalized.artifact);
      }
    } catch (error: any) {
      addSystemMessage(`Narrated slideshow failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsMediaRendering(false);
    }
  }, [addSystemMessage, currentSession?.id, mediaNarrationText, mediaSlideshowTitle, openArtifactViewer, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles, selectedSlideshowImagePaths]);

  const analyzeSelectedLegalDocument = useCallback(async () => {
    if (!currentSession?.id || !selectedLegalDocumentId) {
      return;
    }

    setIsLegalAnalyzing(true);
    try {
      const report = await nexus.legal.analyzeDocument(currentSession.id, selectedLegalDocumentId);
      await handleLegalAnalysisComplete(report as LegalAnalysisReportRecord);
    } catch (error: any) {
      addSystemMessage(`Legal document analysis failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLegalAnalyzing(false);
    }
  }, [addSystemMessage, currentSession?.id, handleLegalAnalysisComplete, selectedLegalDocumentId]);

  const pickAndAnalyzeLegalUpload = useCallback(async () => {
    if (!currentSession?.id) {
      return;
    }

    setIsLegalAnalyzing(true);
    try {
      const report = await nexus.legal.pickAndAnalyzeUpload(currentSession.id);
      if (report) {
        await handleLegalAnalysisComplete(report as LegalAnalysisReportRecord);
      }
    } catch (error: any) {
      addSystemMessage(`Legal upload analysis failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLegalAnalyzing(false);
    }
  }, [addSystemMessage, currentSession?.id, handleLegalAnalysisComplete]);

  const analyzeLegalUrl = useCallback(async (url: string, titleHint?: string) => {
    if (!currentSession?.id || !String(url || '').trim()) {
      return;
    }

    setIsLegalAnalyzing(true);
    try {
      const report = await nexus.legal.analyzeUrl(currentSession.id, String(url || '').trim(), titleHint);
      setLegalUrlInput('');
      await handleLegalAnalysisComplete(report as LegalAnalysisReportRecord);
    } catch (error: any) {
      addSystemMessage(`Legal URL analysis failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLegalAnalyzing(false);
    }
  }, [addSystemMessage, currentSession?.id, handleLegalAnalysisComplete]);

  const runLegalWebSearch = useCallback(async () => {
    const query = legalWebSearchQuery.trim();
    if (!query) {
      return;
    }

    setIsLegalWebSearching(true);
    try {
      const results = await nexus.scrape.search(query);
      const normalizedResults = (results || []) as LegalWebSearchResultRecord[];
      setLegalWebSearchResults(normalizedResults);
      if (normalizedResults.length === 0) {
        addSystemMessage('No web results were found for that legal search query.');
      }
    } catch (error: any) {
      addSystemMessage(`Web search failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLegalWebSearching(false);
    }
  }, [addSystemMessage, legalWebSearchQuery]);

  const openGlobalSearchResult = useCallback(async (result: GlobalSearchResultRecord) => {
    const target = result.openTarget || {};

    if (result.openKind === 'knowledge_document' && target.documentId) {
      await openKnowledgeDocument(target.documentId);
      return;
    }

    if (result.openKind === 'youtube_transcript' && target.transcriptId) {
      await openYouTubeTranscript(target.transcriptId);
      return;
    }

    if (result.openKind === 'workspace_file' && target.path) {
      await openArtifactViewer({
        path: target.path,
        kind: ((target.kind || getArtifactKind(target.path) || 'text') as ArtifactKind),
        name: target.name || result.title || basenameFromUiPath(target.path),
      });
      return;
    }

    if (result.openKind === 'tutorial' && target.tutorialId) {
      stageTutorialsInWorkspace(target.tutorialId);
      return;
    }

    if (result.openKind === 'entity' && target.entityId) {
      const normalizedType = String(target.entityType || '').toLowerCase();
      await openEntityCrm();

      if (normalizedType === 'person') {
        await focusCrmEntity(
          {
            id: target.entityId,
            full_name: target.name || result.title,
            name: target.name || result.title,
          },
          'person'
        );
        return;
      }

      if (normalizedType === 'business') {
        await focusCrmEntity(
          {
            id: target.entityId,
            name: target.name || result.title,
          },
          'business'
        );
        return;
      }

      setCrmActiveTab('search');
      setCrmSearchQuery(target.name || result.title || '');
      const matches = await nexus.entityCrm.search(target.name || result.title || '').catch(() => []);
      setCrmSearchResults(matches || []);
      return;
    }

    if (result.openKind === 'text' && target.content) {
      openTextArtifactViewer(target.title || result.title || 'Search Result', target.content, `global-search:${result.sourceType}`);
      return;
    }

    if (target.path) {
      await openArtifactViewer({
        path: target.path,
        kind: ((target.kind || getArtifactKind(target.path) || 'text') as ArtifactKind),
        name: target.name || result.title || basenameFromUiPath(target.path),
      });
      return;
    }

    if (target.content || result.preview) {
      openTextArtifactViewer(
        target.title || result.title || 'Search Result',
        target.content || result.preview || '',
        `global-search:${result.sourceType}`
      );
    }
  }, [focusCrmEntity, openArtifactViewer, openEntityCrm, openKnowledgeDocument, openTextArtifactViewer, openYouTubeTranscript, stageTutorialsInWorkspace]);

  const exportBugReportPdf = useCallback(async () => {
    setIsExportingBugReport(true);
    try {
      const exported = await nexus.bugs.exportPdf({ limit: 120, sessionId: currentSession?.id });
      addSystemMessage(`Bug report PDF created at ${exported.path}`);
      if (exported.path) {
        await openArtifactViewer({
          path: exported.path,
          name: exported.name || 'bug-report.pdf',
          kind: 'pdf',
        });
      }
      await loadBugReports();
    } catch (error: any) {
      addSystemMessage(`Failed to export bug report PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setIsExportingBugReport(false);
    }
  }, [addSystemMessage, currentSession?.id, loadBugReports, openArtifactViewer]);

  const stopPresentationSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    presentationUtteranceRef.current = null;
  }, []);

  const speakPresentationSlide = useCallback((deck: PresentationModeDeck, slideIndex: number) => {
    stopPresentationSpeech();
    const slide = deck.slides[slideIndex];
    if (!slide || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const speech = new SpeechSynthesisUtterance(slide.speakerNotes || slide.keyMessage || slide.title);
    speech.rate = 0.94;
    speech.pitch = 0.98;
    speech.volume = 1;
    speech.onend = () => {
      presentationUtteranceRef.current = null;
      setPresentationSlideIndex((currentIndex) => {
        if (currentIndex !== slideIndex) {
          return currentIndex;
        }

        if (slideIndex + 1 < deck.slides.length) {
          return slideIndex + 1;
        }

        setPresentationAutoPlay(false);
        setPresentationStatus('paused');
        return currentIndex;
      });
    };
    speech.onerror = () => {
      presentationUtteranceRef.current = null;
      setPresentationStatus('paused');
    };
    presentationUtteranceRef.current = speech;
    window.speechSynthesis.speak(speech);
  }, [stopPresentationSpeech]);

  const applyPresentationControl = useCallback((command: { action?: string; slideNumber?: number }) => {
    const action = String(command.action || '').toLowerCase();
    if (action === 'pause') {
      stopPresentationSpeech();
      setPresentationAutoPlay(false);
      setPresentationStatus('paused');
      return;
    }

    if (action === 'resume') {
      setPresentationAutoPlay(true);
      setPresentationStatus('presenting');
      return;
    }

    if (action === 'next') {
      stopPresentationSpeech();
      setPresentationSlideIndex((index) => Math.min(index + 1, Math.max((presentationDeck?.slides.length || 1) - 1, 0)));
      setPresentationAutoPlay(true);
      setPresentationStatus('presenting');
      return;
    }

    if (action === 'previous') {
      stopPresentationSpeech();
      setPresentationSlideIndex((index) => Math.max(index - 1, 0));
      setPresentationAutoPlay(true);
      setPresentationStatus('presenting');
      return;
    }

    if (action === 'go_to') {
      stopPresentationSpeech();
      const targetIndex = Math.max(0, Math.min(Number(command.slideNumber || 1) - 1, Math.max((presentationDeck?.slides.length || 1) - 1, 0)));
      setPresentationSlideIndex(targetIndex);
      setPresentationAutoPlay(true);
      setPresentationStatus('presenting');
      return;
    }

    if (action === 'end') {
      stopPresentationSpeech();
      setPresentationDeck(null);
      setPresentationSlideIndex(0);
      setPresentationAutoPlay(false);
      setPresentationStatus('idle');
    }
  }, [presentationDeck?.slides.length, stopPresentationSpeech]);

  useEffect(() => {
    if (!presentationDeck || presentationStatus !== 'presenting' || !presentationAutoPlay) {
      return;
    }

    speakPresentationSlide(presentationDeck, presentationSlideIndex);
  }, [presentationAutoPlay, presentationDeck, presentationSlideIndex, presentationStatus, speakPresentationSlide]);

  useEffect(() => () => {
    stopPresentationSpeech();
  }, [stopPresentationSpeech]);

  useEffect(() => {
    const disposeOpen = nexus.presentation.onOpen((data: any) => {
      const deck = data?.deck as PresentationModeDeck | undefined;
      if (!deck) {
        return;
      }

      const requestedSlide = Math.max(1, Math.min(Number(data?.slideNumber || 1), Math.max(deck.slides.length, 1)));
      setPresentationDeck(deck);
      setPresentationSlideIndex(requestedSlide - 1);
      setPresentationAutoPlay(data?.autoPlay !== false);
      setPresentationStatus(data?.autoPlay === false ? 'paused' : 'presenting');
      setArtifactViewer(null);
      addSystemMessage(`Presentation Mode opened: ${deck.title} (${deck.slideCount} slides).`);
    });

    const disposeReady = nexus.presentation.onReady((data: any) => {
      const deck = data?.deck as PresentationModeDeck | undefined;
      if (deck) {
        addSystemMessage(`Presentation Mode ready: ${deck.title} (${deck.slideCount} slides). Say "start presentation" to begin.`);
      }
    });

    const disposeControl = nexus.presentation.onControl((data: any) => {
      applyPresentationControl(data || {});
    });

    const disposeError = nexus.presentation.onError((data: any) => {
      const error = data?.job?.error || 'Unknown presentation preparation error';
      addSystemMessage(`Presentation Mode failed: ${error}`);
    });

    return () => {
      disposeOpen();
      disposeReady();
      disposeControl();
      disposeError();
    };
  }, [addSystemMessage, applyPresentationControl]);

  const loadInlineImagePreview = useCallback(async (filePath: string) => {
    if (inlineImageCache[filePath]) return;
    try {
      const loaded = await nexus.artifacts.load(filePath);
      if (loaded?.dataUrl) {
        setInlineImageCache((prev: Record<string, string>) => ({ ...prev, [filePath]: loaded.dataUrl }));
      }
    } catch {
      // Silently skip — the "View IMAGE" button still works as fallback
    }
  }, [inlineImageCache]);

  // Listen for image:generated events from the main process (voice session tool calls)
  useEffect(() => {
    if (!nexus.images?.onGenerated) return undefined;
    const unsubscribe = nexus.images.onGenerated((data: { path?: string }) => {
      if (data.path) {
        void loadInlineImagePreview(data.path);
      }
    });
    return unsubscribe;
  }, [loadInlineImagePreview]);

  const materializeTextArtifactViewer = useCallback(async (
    title: string,
    content: string,
    source?: string,
    sessionIdOverride?: string
  ) => {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) {
      return;
    }

    try {
      const artifact = await nexus.artifacts.materializeText(
        sessionIdOverride || currentSession?.id,
        title,
        normalizedContent,
        source
      );

      await openArtifactViewer({
        path: artifact.path,
        kind: artifact.kind || 'text',
        name: artifact.name || title,
      });
    } catch (error: any) {
      addSystemMessage(`Failed to materialize viewer artifact: ${error.message || 'Unknown error'}`);
      openTextArtifactViewer(title, normalizedContent, source);
    }
  }, [addSystemMessage, currentSession?.id, openArtifactViewer, openTextArtifactViewer]);

  const openProjectViewer = useCallback(async (projectId?: string) => {
    const targetProjectId = projectId || currentProject?.id;
    if (!targetProjectId) {
      return;
    }

    try {
      const project = await nexus.projects.get(targetProjectId);
      const lines: string[] = [
        `# ${project.name}`,
        '',
        `Status: ${project.status || 'active'}`,
        typeof project.confidence === 'number' ? `Assignment confidence: ${project.confidence}` : '',
        project.assignedBy ? `Assigned by: ${project.assignedBy}` : '',
        project.description ? `Description: ${project.description}` : '',
        Array.isArray(project.topics) && project.topics.length > 0 ? `Topics: ${project.topics.join(', ')}` : '',
        '',
        '## Sessions',
      ];

      const projectSessions = Array.isArray(project.sessions) ? project.sessions : [];
      if (projectSessions.length === 0) {
        lines.push('No project sessions are currently linked.');
      } else {
        projectSessions.slice(0, 8).forEach((session: any) => {
          lines.push(`- ${session.name || session.id}${session.assignedBy ? ` (${session.assignedBy})` : ''}`);
        });
      }

      lines.push('', '## Recent Project Events');

      const events = Array.isArray(project.recentEvents) ? project.recentEvents : [];
      if (events.length === 0) {
        lines.push('No project events have been recorded yet.');
      } else {
        events.forEach((event: ProjectEventRecord) => {
          lines.push(
            `- [${event.eventType}] ${event.title} (${new Date(event.createdAt).toLocaleString()})`,
            event.content ? `  ${event.content}` : ''
          );
        });
      }

      lines.push('', '## Pipelines');

      const projectPipelines = Array.isArray(project.pipelines) ? project.pipelines : [];
      if (projectPipelines.length === 0) {
        lines.push('No pipelines are linked to this project yet.');
      } else {
        projectPipelines.slice(0, 12).forEach((pipeline: any) => {
          lines.push(`- ${pipeline.name} · ${pipeline.status || 'pending'} · stage ${pipeline.currentStage || 'pending'}`);
        });
      }

      lines.push('', '## Agent Runs');

      const agentRuns = Array.isArray(project.agentRuns) ? project.agentRuns : [];
      if (agentRuns.length === 0) {
        lines.push('No agent runs are linked to this project yet.');
      } else {
        agentRuns.slice(0, 12).forEach((run: any) => {
          lines.push(
            `- ${run.agentName || run.agentId} · ${run.status || 'completed'}${run.startedAt ? ` · ${new Date(run.startedAt).toLocaleString()}` : ''}`,
            run.input ? `  Input: ${String(run.input).slice(0, 300)}` : '',
            run.output ? `  Output: ${String(run.output).slice(0, 300)}` : ''
          );
        });
      }

      lines.push('', '## Artifacts');

      const recentArtifacts = Array.isArray(project.recentArtifacts) ? project.recentArtifacts : [];
      if (recentArtifacts.length === 0) {
        lines.push('No artifacts are linked to this project yet.');
      } else {
        recentArtifacts.slice(0, 12).forEach((artifact: any) => {
          lines.push(`- ${artifact.title} · ${artifact.kind} · ${artifact.path}`);
        });
      }

      await materializeTextArtifactViewer(
        `${project.name} Project Intelligence`,
        lines.filter(Boolean).join('\n'),
        `project:${project.id}`,
        currentSession?.id || projectSessions[0]?.id || sessions[0]?.id
      );
    } catch (error: any) {
      addSystemMessage(`Failed to open project view: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage, currentProject?.id, currentSession?.id, materializeTextArtifactViewer, sessions]);

  const openResultArtifactViewer = useCallback(async (value: unknown, fallbackName?: string) => {
    const workbook = findSpreadsheetWorkbook(value);
    if (workbook) {
      setSpreadsheetArtifactView(workbook);
      return true;
    }

    const artifacts = collectArtifactReferences(value);
    if (artifacts.length > 0) {
      await openArtifactViewer(artifacts[0]);
      return true;
    }

    return false;
  }, [collectArtifactReferences, findSpreadsheetWorkbook, openArtifactViewer, setSpreadsheetArtifactView]);

  const revealArtifact = useCallback(async (filePath: string) => {
    try {
      await nexus.artifacts.reveal(filePath);
    } catch (error: any) {
      addSystemMessage(`Failed to reveal artifact: ${error.message || 'Unknown error'}`);
    }
  }, [addSystemMessage]);

  const openCrmSourceMaterial = useCallback(async (source: EntityKnowledgeSourceRecord) => {
    if (source.documentId) {
      await openKnowledgeDocument(source.documentId);
      return;
    }

    if (source.projectId) {
      await openProjectViewer(source.projectId);
      return;
    }

    if (source.artifactPath) {
      await openArtifactViewer({
        path: source.artifactPath,
        kind: ((source.artifactKind || getArtifactKind(source.artifactPath) || 'text') as ArtifactKind),
        name: source.title || basenameFromUiPath(source.artifactPath) || 'CRM Source',
      });
      return;
    }

    const detailBlocks = [
      source.subtitle ? `Context\n${source.subtitle}` : '',
      source.preview ? `Preview\n${source.preview}` : '',
      source.linkedAt ? `Linked\n${new Date(source.linkedAt).toLocaleString()}` : '',
    ].filter(Boolean);

    if (detailBlocks.length > 0) {
      openTextArtifactViewer(
        source.title || 'CRM Source',
        detailBlocks.join('\n\n'),
        `crm-source:${source.id}`,
      );
      return;
    }

    addSystemMessage('This CRM source does not have openable material yet.');
  }, [addSystemMessage, getArtifactKind, openArtifactViewer, openKnowledgeDocument, openProjectViewer, openTextArtifactViewer]);

  const revealCrmSourceMaterial = useCallback(async (source: EntityKnowledgeSourceRecord) => {
    if (source.artifactPath) {
      await revealArtifact(source.artifactPath);
      return;
    }

    addSystemMessage('This CRM source does not map to a local file.');
  }, [addSystemMessage, revealArtifact]);

  const projectTasks = useMemo(() => {
    const sourceTasks = Array.isArray(currentProject?.tasks) && currentProject.tasks.length > 0
      ? currentProject.tasks.map((task) => mapTaskRecord(task))
      : tasks;

    const statusRank = (task: Task) => (
      task.status === 'running' ? 0
        : task.status === 'pending' ? 1
          : 2
    );

    return [...sourceTasks].sort((left, right) => {
      if (statusRank(left) !== statusRank(right)) {
        return statusRank(left) - statusRank(right);
      }
      if (left.priority !== right.priority) {
        return left.priority === 'high' ? -1 : right.priority === 'high' ? 1 : left.priority === 'medium' ? -1 : 1;
      }
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });
  }, [currentProject, mapTaskRecord, tasks]);

  const projectPipelines = useMemo(() => (
    Array.isArray(currentProject?.pipelines) && currentProject.pipelines.length > 0
      ? currentProject.pipelines.map((pipeline) => mapPipelineRecord(pipeline))
      : pipelines
  ), [currentProject, mapPipelineRecord, pipelines]);

  const projectArtifacts = useMemo(() => (
    Array.isArray(currentProject?.recentArtifacts) ? currentProject.recentArtifacts : []
  ), [currentProject]);

  const projectAgentRuns = useMemo(() => (
    Array.isArray(currentProject?.agentRuns) ? currentProject.agentRuns : []
  ), [currentProject]);

  const buildOperatorBriefingText = useCallback(() => {
    const sessionLabel = sanitizeOperatorFocusLabel(currentSession?.name || '') || 'No active session';
    const projectLabel = sanitizeOperatorFocusLabel(currentProject?.name || '') || 'No active project';
    const now = new Date();
    const runningTasks = projectTasks.filter((task) => task.status === 'running');
    const pendingTasks = projectTasks.filter((task) => task.status === 'pending');
    const completedTasks = projectTasks.filter((task) => task.status === 'completed');
    const activePipelines = countActivePipelines(projectPipelines);
    const topFocusTasks = [...runningTasks, ...pendingTasks]
      .slice(0, 3)
      .map((task) => normalizeWhitespace(task.title || 'Untitled task'))
      .filter(Boolean);
    const topArtifacts = projectArtifacts
      .map((artifact) => normalizeWhitespace(String(artifact?.title || basenameFromUiPath(String(artifact?.path || '')) || '')))
      .filter(Boolean)
      .slice(0, 2);

    const dateLabel = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(now);

    const lines = [
      `${dateLabel} operator briefing.`,
      `Session: ${sessionLabel}.`,
      `Project: ${projectLabel}.`,
      `Tasks: ${runningTasks.length} running, ${pendingTasks.length} pending, ${completedTasks.length} completed.`,
      `Pipelines: ${activePipelines} active of ${projectPipelines.length} total.`,
      `Knowledge: ${knowledgeDocuments.length} docs, ${workspaceFiles.length} workspace files, ${projectArtifacts.length} recent artifacts.`,
    ];

    if (topFocusTasks.length > 0) {
      lines.push(`Focus: ${topFocusTasks.join(' | ')}.`);
    }

    if (topArtifacts.length > 0) {
      lines.push(`Recent outputs: ${topArtifacts.join(' | ')}.`);
    }

    return lines.join('\n');
  }, [
    currentProject?.name,
    currentSession?.name,
    knowledgeDocuments.length,
    projectArtifacts,
    projectPipelines,
    projectTasks,
    workspaceFiles.length,
  ]);

  const deliverOperatorCommunication = useCallback(async (title: string, body = '') => {
    const channelsDelivered: string[] = [];
    const failures: string[] = [];
    const shortcutName = operatorSelfTextShortcutName.trim() || DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT;
    const textMessage = body ? `${title}\n\n${body}` : title;

    if (operatorCommChannel === 'notification' || operatorCommChannel === 'both') {
      try {
        await nexus.voiceTools.showNotification(title, body || undefined);
        channelsDelivered.push('notification');
      } catch (error: any) {
        failures.push(`notification: ${error?.message || 'Unknown error'}`);
      }
    }

    if (operatorCommChannel === 'text' || operatorCommChannel === 'both') {
      try {
        await nexus.voiceTools.execute('send_imessage', {
          message: textMessage,
          confirmSend: true,
          shortcutName,
        });
        channelsDelivered.push('text');
      } catch (error: any) {
        failures.push(`text: ${error?.message || 'Unknown error'}`);
      }
    }

    if (channelsDelivered.length === 0) {
      const detail = failures.join(' | ') || 'No delivery channels succeeded.';
      setOperatorCommsStatus(`Delivery failed: ${detail}`);
      throw new Error(detail);
    }

    const statusSegments = [`Delivered via ${channelsDelivered.join(' + ')}`];
    if (failures.length > 0) {
      statusSegments.push(`Issues: ${failures.join(' | ')}`);
    }
    setOperatorCommsStatus(statusSegments.join('. '));

    return { delivered: channelsDelivered, failures };
  }, [operatorCommChannel, operatorSelfTextShortcutName]);

  const sendOperatorTestUpdate = useCallback(async () => {
    setIsSendingOperatorTest(true);
    try {
      const projectLabel = sanitizeOperatorFocusLabel(currentProject?.name || '');
      const sessionLabel = sanitizeOperatorFocusLabel(currentSession?.name || '');
      const summary = projectLabel
        ? `Project focus: ${projectLabel}`
        : sessionLabel
          ? `Session focus: ${sessionLabel}`
          : 'Nexus operator channel is online.';
      await deliverOperatorCommunication('Nexus test update', summary);
    } catch (error: any) {
      addSystemMessage(`Failed to send operator test update: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsSendingOperatorTest(false);
    }
  }, [addSystemMessage, currentProject?.name, currentSession?.name, deliverOperatorCommunication]);

  const sendOperatorDailyBriefingNow = useCallback(async () => {
    setIsSendingOperatorBriefing(true);
    try {
      await deliverOperatorCommunication('Nexus daily briefing', buildOperatorBriefingText());
      const todayKey = getOperatorBriefingDateKey(new Date());
      lastDailyBriefingDateRef.current = todayKey;
      lastDailyBriefingAttemptRef.current = todayKey;
    } catch (error: any) {
      addSystemMessage(`Failed to send operator daily briefing: ${error?.message || 'Unknown error'}`);
      throw error;
    } finally {
      setIsSendingOperatorBriefing(false);
    }
  }, [addSystemMessage, buildOperatorBriefingText, deliverOperatorCommunication]);

  useEffect(() => {
    const contextKey = `${currentProject?.id || 'no-project'}:${currentSession?.id || 'no-session'}`;
    const nextStatuses = new Map(projectTasks.map((task) => [task.id, task.status] as const));

    if (taskAlertContextRef.current !== contextKey || seenTaskStatusRef.current.size === 0) {
      taskAlertContextRef.current = contextKey;
      seenTaskStatusRef.current = nextStatuses;
      return;
    }

    const completedNow = projectTasks.filter((task) => {
      const previousStatus = seenTaskStatusRef.current.get(task.id);
      return previousStatus && previousStatus !== 'completed' && task.status === 'completed';
    });

    seenTaskStatusRef.current = nextStatuses;

    if (!operatorTaskAlertsEnabled || completedNow.length === 0) {
      return;
    }

    const completedTitles = completedNow
      .slice(0, 3)
      .map((task) => normalizeWhitespace(task.title || 'Untitled task'))
      .filter(Boolean);
    const projectLabel = sanitizeOperatorFocusLabel(currentProject?.name || '');
    const subject = completedNow.length === 1 ? 'Nexus task completed' : 'Nexus tasks completed';
    const detail = [
      projectLabel ? `Project: ${projectLabel}.` : '',
      completedTitles.length > 0 ? `Completed: ${completedTitles.join(' | ')}.` : '',
      completedNow.length > completedTitles.length ? `Plus ${completedNow.length - completedTitles.length} more.` : '',
    ].filter(Boolean).join('\n');

    void deliverOperatorCommunication(subject, detail).catch((error: any) => {
      addSystemMessage(`Failed to send task completion alert: ${error?.message || 'Unknown error'}`);
    });
  }, [
    addSystemMessage,
    currentProject?.id,
    currentProject?.name,
    currentSession?.id,
    deliverOperatorCommunication,
    operatorTaskAlertsEnabled,
    projectTasks,
  ]);

  useEffect(() => {
    if (!operatorDailyBriefingEnabled) {
      return;
    }

    const runIfDue = () => {
      const [hoursText, minutesText] = String(operatorDailyBriefingTime || '').split(':');
      const scheduledHours = Number(hoursText);
      const scheduledMinutes = Number(minutesText);
      if (!Number.isFinite(scheduledHours) || !Number.isFinite(scheduledMinutes)) {
        return;
      }

      const now = new Date();
      const todayKey = getOperatorBriefingDateKey(now);
      if (
        lastDailyBriefingDateRef.current === todayKey
        || lastDailyBriefingAttemptRef.current === todayKey
      ) {
        return;
      }

      const scheduled = new Date(now);
      scheduled.setHours(scheduledHours, scheduledMinutes, 0, 0);
      if (now < scheduled) {
        return;
      }

      lastDailyBriefingAttemptRef.current = todayKey;
      void sendOperatorDailyBriefingNow().catch(() => {});
    };

    runIfDue();
    const intervalId = window.setInterval(runIfDue, 60_000);
    return () => window.clearInterval(intervalId);
  }, [operatorDailyBriefingEnabled, operatorDailyBriefingTime, sendOperatorDailyBriefingNow]);

  const recentToolMessages = useMemo(
    () => messages.filter((message) => message.type === 'tool-call').slice(-12).reverse(),
    [messages]
  );

  const recentToolNames = useMemo(
    () => uniqBy(
      recentToolMessages
        .map((message) => String(message.toolName || '').trim())
        .filter(Boolean),
      (toolName) => toolName,
    ),
    [recentToolMessages]
  );

  const workingSetArtifactReferences = useMemo(() => {
    const recentArtifacts = recentToolMessages.flatMap((message) => collectArtifactReferences(message.toolResult));
    const projectFallback = projectArtifacts
      .filter((artifact) => typeof artifact?.path === 'string' && Boolean(getArtifactKind(String(artifact.path))))
      .map((artifact) => ({
        path: String(artifact.path),
        kind: getArtifactKind(String(artifact.path))!,
        name: String(artifact.title || basenameFromUiPath(String(artifact.path)) || 'Artifact'),
      } satisfies ArtifactReference));

    return uniqBy([...recentArtifacts, ...projectFallback], (artifact) => artifact.path).slice(0, 8);
  }, [collectArtifactReferences, getArtifactKind, projectArtifacts, recentToolMessages]);

  const workingSetPaths = useMemo(() => {
    const fromTools = recentToolMessages.flatMap((message) => ([
      ...collectPathReferences(message.toolArgs),
      ...collectPathReferences(message.toolResult),
    ]));

    const fromArtifacts = workingSetArtifactReferences.map((artifact) => artifact.path);
    return uniqBy([...fromTools, ...fromArtifacts], (filePath) => filePath).slice(0, 20);
  }, [recentToolMessages, workingSetArtifactReferences]);

  const workingSetFolders = useMemo<WorkingSetFolderRecord[]>(() => uniqBy(
    workingSetPaths
      .map((filePath) => dirnameFromUiPath(filePath))
      .filter(Boolean)
      .map((folderPath) => ({
        path: folderPath,
        label: formatPathForPanel(folderPath, 4),
      })),
    (folder) => folder.path,
  ).slice(0, 8), [workingSetPaths]);

  const workingSetWorkspaceFiles = useMemo(() => {
    const pathSet = new Set(workingSetPaths);
    const directMatches = workspaceFiles.filter((file) => pathSet.has(file.path));
    const supplemental = directMatches.length > 0 ? [] : workspaceFiles.slice(0, 4);
    return uniqBy([...directMatches, ...supplemental], (file) => file.path).slice(0, 6);
  }, [workingSetPaths, workspaceFiles]);

  const workingSetKnowledgeDocuments = useMemo(() => {
    const pathSet = new Set(workingSetPaths);
    const directMatches = knowledgeDocuments.filter((document) => document.artifactPath && pathSet.has(document.artifactPath));
    const recentKnowledgeActivity = recentToolNames.some((toolName) => (
      [
        'search_knowledge',
        'search_transcripts',
        'open_transcript',
        'save_transcript',
        'generate_session_briefing',
        'ingest_document',
      ].includes(toolName)
    ));
    const supplemental = directMatches.length > 0
      ? []
      : recentKnowledgeActivity
        ? knowledgeDocuments.slice(0, 5)
        : [];

    return uniqBy([...directMatches, ...supplemental], (document) => document.id).slice(0, 6);
  }, [knowledgeDocuments, recentToolNames, workingSetPaths]);

  const contextWindowMetrics = useMemo(() => ({
    toolCalls: recentToolMessages.length,
    tools: recentToolNames.length,
    tasks: projectTasks.length,
    folders: workingSetFolders.length,
    files: uniqBy(
      [
        ...workingSetWorkspaceFiles.map((file) => file.path),
        ...workingSetArtifactReferences.map((artifact) => artifact.path),
      ],
      (filePath) => filePath,
    ).length,
    docs: workingSetKnowledgeDocuments.length,
  }), [
    projectTasks.length,
    recentToolMessages.length,
    recentToolNames.length,
    workingSetArtifactReferences,
    workingSetFolders.length,
    workingSetKnowledgeDocuments.length,
    workingSetWorkspaceFiles,
  ]);

  const runningAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'running'),
    [agents],
  );

  const erroredAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'error'),
    [agents],
  );

  const missionQueueSnapshot = useMemo(() => {
    const sourceItems = Array.isArray(rollingTodoBoard?.items) && rollingTodoBoard.items.length > 0
      ? rollingTodoBoard.items.map((item) => ({
        id: item.id,
        title: item.userTitle || item.agentTitle || item.title,
        supporting: item.userNextAction || item.agentNextAction || item.nextAction,
        status: item.status,
        owner: item.owner,
        needsUser: Boolean(item.needsUser),
        canAgentHelp: Boolean(item.canAgentHelp),
      }))
      : projectTasks.slice(0, 6).map((task) => ({
        id: task.id,
        title: task.title,
        supporting: task.result || '',
        status: (
          task.status === 'running'
            ? 'in_progress'
            : task.status === 'completed'
              ? 'done'
              : 'pending'
        ) as RollingTodoStatus,
        owner: (task.agentId ? 'agent' : 'shared') as RollingTodoOwner,
        needsUser: false,
        canAgentHelp: true,
      }));

    const counts = sourceItems.reduce((accumulator, item) => {
      accumulator[item.status] += 1;
      return accumulator;
    }, {
      pending: 0,
      ready: 0,
      blocked: 0,
      in_progress: 0,
      done: 0,
    });

    return {
      items: sourceItems,
      counts,
      primary: sourceItems[0] || null,
    };
  }, [projectTasks, rollingTodoBoard]);

  const missionPipelineSpotlight = useMemo(() => {
    if (projectPipelines.length === 0) {
      return null;
    }

    const scorePipeline = (pipeline: Pipeline) => {
      const hasError = pipeline.stages.some((stage) => stage.status === 'error') || pipeline.status === 'error';
      const hasActive = pipeline.stages.some((stage) => stage.status === 'active')
        || ['active', 'running'].includes(String(pipeline.status || '').toLowerCase());
      const completedStages = pipeline.stages.filter((stage) => stage.status === 'completed').length;

      return (
        (hasError ? 30 : 0)
        + (hasActive ? 20 : 0)
        + completedStages
        + (Number(pipeline.progress) || 0) / 100
      );
    };

    const rankedPipelines = [...projectPipelines].sort((left, right) => {
      const scoreDelta = scorePipeline(right) - scorePipeline(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });

    const pipeline = rankedPipelines[0];
    const hasError = pipeline.stages.some((stage) => stage.status === 'error') || pipeline.status === 'error';
    const hasActive = pipeline.stages.some((stage) => stage.status === 'active')
      || ['active', 'running'].includes(String(pipeline.status || '').toLowerCase());
    const completedStages = pipeline.stages.filter((stage) => stage.status === 'completed').length;

    return {
      pipeline,
      hasError,
      hasActive,
      completedStages,
    };
  }, [projectPipelines]);

  const missionArtifactSpotlight = useMemo<ArtifactReference | null>(() => {
    if (workingSetArtifactReferences.length > 0) {
      return workingSetArtifactReferences[0];
    }

    const previewableWorkspaceFile = workingSetWorkspaceFiles.find((file) => Boolean(getArtifactKind(file.path)));
    if (!previewableWorkspaceFile) {
      return null;
    }

    const kind = getArtifactKind(previewableWorkspaceFile.path);
    if (!kind) {
      return null;
    }

    return {
      path: previewableWorkspaceFile.path,
      name: previewableWorkspaceFile.name,
      kind,
    };
  }, [getArtifactKind, workingSetArtifactReferences, workingSetWorkspaceFiles]);

  const missionWorkspaceFallback = useMemo(
    () => workingSetWorkspaceFiles[0] || null,
    [workingSetWorkspaceFiles],
  );

  const missionKnowledgeSpotlight = useMemo(
    () => workingSetKnowledgeDocuments[0] || knowledgeDocuments[0] || null,
    [knowledgeDocuments, workingSetKnowledgeDocuments],
  );

  const missionEntitySpotlight = useMemo(() => {
    if (crmSessionContext?.people?.length) {
      return {
        type: 'person' as const,
        entity: crmSessionContext.people[0],
      };
    }

    if (crmSessionContext?.businesses?.length) {
      return {
        type: 'business' as const,
        entity: crmSessionContext.businesses[0],
      };
    }

    return null;
  }, [crmSessionContext]);

  const missionPrimaryAgent = useMemo(
    () => runningAgents[0] || agents[0] || null,
    [agents, runningAgents],
  );

  const missionSystemStatus = useMemo(() => {
    const pendingToolCallCount = messages.filter((message) => message.type === 'tool-call' && message.toolStatus === 'pending').length;

    if (pendingToolCallCount > 0) {
      return {
        tone: 'live',
        label: 'Execution Live',
        detail: `${pendingToolCallCount} live tool call${pendingToolCallCount === 1 ? '' : 's'} moving through the workspace right now.`,
      };
    }

    if (erroredAgents.length > 0 || conversationStatus === 'error') {
      return {
        tone: 'warning',
        label: 'Needs Attention',
        detail: erroredAgents.length > 0
          ? `${erroredAgents.length} agent${erroredAgents.length === 1 ? '' : 's'} need inspection before the next run.`
          : 'Voice operations hit an error and should be checked before the next live session.',
      };
    }

    if (conversationStatus === 'connected') {
      return {
        tone: 'connected',
        label: 'Voice Ready',
        detail: conversationMode === 'speaking'
          ? 'Nexus is speaking and can keep staging assets while you watch.'
          : 'Nexus is listening live and ready to manipulate the active environment.',
      };
    }

    if (currentProject || currentSession) {
      return {
        tone: 'ready',
        label: 'Workspace Staged',
        detail: 'Project state, context, and assets are available for direct inspection and execution.',
      };
    }

    return {
      tone: 'standby',
      label: 'Standby',
      detail: 'Create or select a session to stage assets, workflows, and live automations here.',
    };
  }, [conversationMode, conversationStatus, currentProject, currentSession, erroredAgents.length, messages]);

  const missionControlNarrative = useMemo(() => {
    const hasConversationActivity = messages.some((message) => {
      if (message.type === 'tool-call') return true;
      if (message.role === 'system') return true;
      if (message.role === 'user') return true;
      if (message.role === 'assistant' && message.content !== DEFAULT_VOICE_GREETING) return true;
      return false;
    });

    if (currentProject?.description) {
      return currentProject.description;
    }

    if (rollingTodoBoard?.summary) {
      return rollingTodoBoard.summary;
    }

    if (crmSessionContext?.summary) {
      return crmSessionContext.summary;
    }

    if (!hasConversationActivity) {
      return 'Stage the workspace so Nexus can keep websites, files, diagrams, workflows, and live outputs visible in one operating surface.';
    }

    return 'This surface tracks the live task queue, pipeline motion, asset outputs, and the CRM/knowledge context behind the current run.';
  }, [crmSessionContext?.summary, currentProject?.description, messages, rollingTodoBoard?.summary]);

  const missionControlMetrics = useMemo(() => ([
    {
      label: 'Running Agents',
      value: String(runningAgents.length),
      tone: runningAgents.length > 0 ? 'live' : 'neutral',
    },
    {
      label: 'Open Moves',
      value: String(
        missionQueueSnapshot.counts.pending
        + missionQueueSnapshot.counts.ready
        + missionQueueSnapshot.counts.blocked
        + missionQueueSnapshot.counts.in_progress
      ),
      tone: missionQueueSnapshot.counts.blocked > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Pipelines',
      value: String(projectPipelines.length),
      tone: missionPipelineSpotlight?.hasError ? 'warning' : missionPipelineSpotlight?.hasActive ? 'live' : 'neutral',
    },
    {
      label: 'Ready Assets',
      value: String(Math.max(workingSetArtifactReferences.length, workingSetWorkspaceFiles.length)),
      tone: missionArtifactSpotlight ? 'ready' : 'neutral',
    },
    {
      label: 'Knowledge Docs',
      value: String(knowledgeDocuments.length),
      tone: missionKnowledgeSpotlight ? 'ready' : 'neutral',
    },
    {
      label: 'CRM Entities',
      value: String((crmSessionContext?.people.length || 0) + (crmSessionContext?.businesses.length || 0)),
      tone: missionEntitySpotlight ? 'ready' : 'neutral',
    },
  ]), [
    crmSessionContext?.businesses.length,
    crmSessionContext?.people.length,
    knowledgeDocuments.length,
    missionArtifactSpotlight,
    missionEntitySpotlight,
    missionKnowledgeSpotlight,
    missionPipelineSpotlight?.hasActive,
    missionPipelineSpotlight?.hasError,
    missionQueueSnapshot.counts.blocked,
    missionQueueSnapshot.counts.in_progress,
    missionQueueSnapshot.counts.pending,
    missionQueueSnapshot.counts.ready,
    projectPipelines.length,
    runningAgents.length,
    workingSetArtifactReferences.length,
    workingSetWorkspaceFiles.length,
  ]);

  const openMissionWorkspaceFile = useCallback(async (file: WorkspaceFileRecord) => {
    const kind = getArtifactKind(file.path);
    if (!kind) {
      await revealArtifact(file.path);
      return;
    }

    await openArtifactViewer({
      path: file.path,
      kind,
      name: file.name,
    });
  }, [getArtifactKind, openArtifactViewer, revealArtifact]);

  const openRollingTodoModal = useCallback(async () => {
    setShowRollingTodoModal(true);
    if (currentSession?.id) {
      await refreshRollingTodoBoard(currentSession.id, {
        reason: 'open_modal',
        silent: false,
      });
    }
  }, [currentSession?.id, refreshRollingTodoBoard]);

  const exportRollingTodoPdf = useCallback(async () => {
    if (!currentSession?.id) {
      addSystemMessage('Select or create a session before exporting the task queue.');
      return;
    }

    setIsRollingTodoExporting(true);

    try {
      const exported = await nexus.rollingTodo.exportPdf(currentSession.id);
      if (exported?.board) {
        setRollingTodoBoard(exported.board);
        hydrateRollingTodoDrafts(exported.board);
      }
      addSystemMessage(`Task Queue PDF created at ${exported.path}`);
      await openArtifactViewer({
        path: exported.path,
        kind: 'pdf',
        name: exported.name || 'Task Queue PDF',
      });
      await refreshWorkspaceFiles();
      await refreshKnowledgeDocuments(currentSession.id);
      await refreshKnowledgeStats(currentSession.id);
    } catch (error: any) {
      addSystemMessage(`Failed to export Task Queue PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRollingTodoExporting(false);
    }
  }, [addSystemMessage, currentSession?.id, hydrateRollingTodoDrafts, openArtifactViewer, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles]);

  const emailRollingTodoPdf = useCallback(async () => {
    if (!currentSession?.id) {
      addSystemMessage('Select or create a session before emailing the task queue.');
      return;
    }

    const recipient = rollingTodoRecipient.trim();
    if (!recipient) {
      addSystemMessage('Enter an email recipient for the task queue PDF.');
      return;
    }

    setIsRollingTodoEmailing(true);

    try {
      const result = await nexus.rollingTodo.emailPdf(
        currentSession.id,
        recipient,
        rollingTodoEmailSubject.trim() || undefined
      );
      addSystemMessage(`Task Queue PDF emailed to ${recipient}${result?.path ? ` from ${result.path}` : ''}.`);
    } catch (error: any) {
      addSystemMessage(`Failed to email Task Queue PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRollingTodoEmailing(false);
    }
  }, [addSystemMessage, currentSession?.id, rollingTodoEmailSubject, rollingTodoRecipient]);

  const exportCurrentSessionPdf = useCallback(async () => {
    if (!currentSession?.id) {
      addSystemMessage('Select or create a session before exporting.');
      return;
    }

    setIsExportingSession(true);

    try {
      const exportableMessages = messages.map((message) => ({
        role: message.role,
        content: message.content,
        type: message.type,
        toolStatus: message.toolStatus,
        toolName: message.toolName,
        toolArgs: message.toolArgs,
        toolResult: message.toolResult,
        isFinal: message.isFinal,
        timestamp: message.timestamp,
      }));

      const exported = await nexus.sessions.exportPdf(
        currentSession.id,
        currentSession.name,
        exportableMessages
      );

      addSystemMessage(`Session PDF created at ${exported.path}`);
      await openArtifactViewer({
        path: exported.path,
        kind: 'pdf',
        name: exported.name || 'Session Export PDF',
      });
    } catch (error: any) {
      addSystemMessage(`Failed to export session PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setIsExportingSession(false);
    }
  }, [addSystemMessage, currentSession?.id, currentSession?.name, messages, openArtifactViewer]);

  const generateSessionBriefing = useCallback(async () => {
    if (!currentSession?.id) {
      addSystemMessage('Select or create a session before generating a briefing.');
      return;
    }

    setIsGeneratingBriefing(true);

    try {
      const exportableMessages = messages.map((message) => ({
        role: message.role,
        content: message.content,
        type: message.type,
        toolStatus: message.toolStatus,
        toolName: message.toolName,
        toolArgs: message.toolArgs,
        toolResult: message.toolResult,
        isFinal: message.isFinal,
        timestamp: message.timestamp,
      }));

      const briefing = await nexus.sessions.generateBriefing(
        currentSession.id,
        currentSession.name,
        exportableMessages
      );

      addSystemMessage(`Briefing created at ${briefing.markdownPath}`);
      await refreshWorkspaceFiles();
      await refreshKnowledgeDocuments(currentSession.id);
      await refreshKnowledgeStats(currentSession.id);
      await openArtifactViewer({
        path: briefing.markdownPath,
        kind: 'text',
        name: briefing.title || 'Session Briefing',
      });
    } catch (error: any) {
      addSystemMessage(`Failed to generate briefing: ${error.message || 'Unknown error'}`);
    } finally {
      setIsGeneratingBriefing(false);
    }
  }, [addSystemMessage, currentSession?.id, currentSession?.name, messages, openArtifactViewer, refreshKnowledgeDocuments, refreshKnowledgeStats, refreshWorkspaceFiles]);

  const handleFileSelection = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (!currentSession?.id || files.length === 0) {
      event.target.value = '';
      return;
    }

    setIsUploadingFiles(true);

    try {
      for (const file of files) {
        const fileDataUrl = await fileToDataUrl(file);
        const result = await nexus.knowledge.ingestFile(
          currentSession.id,
          file.name,
          file.type || 'application/octet-stream',
          fileDataUrl
        );

        addSystemMessage(
          result.workbook
            ? `Ingested "${file.name}" into knowledge. Parsed ${result.workbook.sheetNames?.length || 0} sheet(s) and saved the original to ${result.filePath}.`
            : `Ingested "${file.name}" into knowledge. Extracted ${result.extractedCharacters} characters and saved the original to ${result.filePath}.`
        );

        if (getArtifactKind(result.filePath) === 'spreadsheet') {
          await openArtifactViewer({
            path: result.filePath,
            kind: 'spreadsheet',
            name: result.title || file.name,
          });
        }
      }
    } catch (error: any) {
      addSystemMessage(`File upload failed: ${error.message || 'Unknown error'}`);
    } finally {
      await refreshWorkspaceFiles();
      await refreshKnowledgeDocuments(currentSession.id);
      await refreshKnowledgeStats(currentSession.id);
      setIsUploadingFiles(false);
      event.target.value = '';
    }
  }, [
    addSystemMessage,
    currentSession?.id,
    fileToDataUrl,
    getArtifactKind,
    openArtifactViewer,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshWorkspaceFiles,
  ]);

  const applySpreadsheetFilter = useCallback(async () => {
    if (artifactViewer?.kind !== 'spreadsheet' || !artifactViewer.spreadsheetData?.path) {
      return;
    }

    const query = spreadsheetFilterQuery.trim();
    setSpreadsheetOperationLabel(query ? 'Filtering table…' : 'Refreshing table…');

    try {
      const workbook = query
        ? await nexus.spreadsheets.filter(
            artifactViewer.spreadsheetData.path,
            query,
            activeSpreadsheetSheet || undefined,
            200
          )
        : await nexus.spreadsheets.open(artifactViewer.spreadsheetData.path);

      setSpreadsheetArtifactView(workbook, activeSpreadsheetSheet || undefined);
    } catch (error: any) {
      addSystemMessage(`Spreadsheet filter failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSpreadsheetOperationLabel(null);
    }
  }, [activeSpreadsheetSheet, addSystemMessage, artifactViewer, spreadsheetFilterQuery, setSpreadsheetArtifactView]);

  const applySpreadsheetSort = useCallback(async () => {
    if (artifactViewer?.kind !== 'spreadsheet' || !artifactViewer.spreadsheetData?.path || !spreadsheetSortColumn) {
      return;
    }

    setSpreadsheetOperationLabel(`Sorting by ${spreadsheetSortColumn}…`);

    try {
      const workbook = await nexus.spreadsheets.sort(
        artifactViewer.spreadsheetData.path,
        spreadsheetSortColumn,
        spreadsheetSortDirection,
        activeSpreadsheetSheet || undefined,
        200,
        spreadsheetFilterQuery.trim() || undefined
      );

      setSpreadsheetArtifactView(workbook, activeSpreadsheetSheet || undefined);
    } catch (error: any) {
      addSystemMessage(`Spreadsheet sort failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSpreadsheetOperationLabel(null);
    }
  }, [
    activeSpreadsheetSheet,
    addSystemMessage,
    artifactViewer,
    setSpreadsheetArtifactView,
    spreadsheetSortColumn,
    spreadsheetSortDirection,
  ]);

  const resetSpreadsheetView = useCallback(async () => {
    if (artifactViewer?.kind !== 'spreadsheet' || !artifactViewer.spreadsheetData?.path) {
      return;
    }

    setSpreadsheetOperationLabel('Reloading spreadsheet…');

    try {
      const workbook = await nexus.spreadsheets.open(artifactViewer.spreadsheetData.path);
      setSpreadsheetFilterQuery('');
      setSpreadsheetEditor(null);
      setSpreadsheetArtifactView(workbook, activeSpreadsheetSheet || undefined);
    } catch (error: any) {
      addSystemMessage(`Spreadsheet reload failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSpreadsheetOperationLabel(null);
    }
  }, [activeSpreadsheetSheet, addSystemMessage, artifactViewer, setSpreadsheetArtifactView]);

  const saveSpreadsheetCellEdit = useCallback(async () => {
    if (
      artifactViewer?.kind !== 'spreadsheet'
      || !artifactViewer.spreadsheetData?.path
      || !spreadsheetEditor
    ) {
      return;
    }

    setSpreadsheetOperationLabel(`Updating ${spreadsheetEditor.column}…`);

    try {
      const workbook = await nexus.spreadsheets.updateCells(
        artifactViewer.spreadsheetData.path,
        spreadsheetEditor.sheetName,
        [{
          rowIndex: spreadsheetEditor.rowIndex,
          column: spreadsheetEditor.column,
          value: spreadsheetEditor.value,
        }]
      );

      setSpreadsheetArtifactView(workbook, spreadsheetEditor.sheetName);
      setSpreadsheetEditor(null);
    } catch (error: any) {
      addSystemMessage(`Spreadsheet edit failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSpreadsheetOperationLabel(null);
    }
  }, [addSystemMessage, artifactViewer, setSpreadsheetArtifactView, spreadsheetEditor]);

  const exportSpreadsheetView = useCallback(async () => {
    if (artifactViewer?.kind !== 'spreadsheet' || !artifactViewer.spreadsheetData?.path) {
      return;
    }

    setSpreadsheetOperationLabel(`Exporting ${spreadsheetExportFormat.toUpperCase()}…`);

    try {
      const exported = await nexus.spreadsheets.exportTable(
        artifactViewer.spreadsheetData.path,
        '',
        {
          format: spreadsheetExportFormat,
          sheetName: activeSpreadsheetSheet || undefined,
          query: spreadsheetFilterQuery.trim() || undefined,
          sortColumn: spreadsheetSortColumn || undefined,
          direction: spreadsheetSortDirection,
          sessionId: currentSession?.id,
          title: `${artifactViewer.name} Export`,
        }
      );

      addSystemMessage(exported.summary || `Exported table to ${exported.path}.`);
      await refreshWorkspaceFiles();
      if (currentSession?.id) {
        await refreshKnowledgeDocuments(currentSession.id);
        await refreshKnowledgeStats(currentSession.id);
      }
      await openArtifactViewer({
        path: exported.path,
        kind: getArtifactKind(exported.path) || 'spreadsheet',
        name: exported.name || exported.path.split('/').pop() || 'Spreadsheet Export',
      });
    } catch (error: any) {
      addSystemMessage(`Spreadsheet export failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSpreadsheetOperationLabel(null);
    }
  }, [
    activeSpreadsheetSheet,
    addSystemMessage,
    artifactViewer,
    currentSession?.id,
    getArtifactKind,
    openArtifactViewer,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshWorkspaceFiles,
    spreadsheetExportFormat,
    spreadsheetFilterQuery,
    spreadsheetSortColumn,
    spreadsheetSortDirection,
  ]);

  const generateSpreadsheetChartView = useCallback(async () => {
    if (
      artifactViewer?.kind !== 'spreadsheet'
      || !artifactViewer.spreadsheetData?.path
      || !spreadsheetChartLabelColumn
      || !spreadsheetChartValueColumn
    ) {
      return;
    }

    setSpreadsheetOperationLabel(`Generating ${spreadsheetChartType} chart…`);

    try {
      const chart = await nexus.spreadsheets.generateChart(
        artifactViewer.spreadsheetData.path,
        '',
        {
          chartType: spreadsheetChartType,
          labelColumn: spreadsheetChartLabelColumn,
          valueColumn: spreadsheetChartValueColumn,
          sheetName: activeSpreadsheetSheet || undefined,
          query: spreadsheetFilterQuery.trim() || undefined,
          sortColumn: spreadsheetSortColumn || undefined,
          direction: spreadsheetSortDirection,
          sessionId: currentSession?.id,
          title: `${artifactViewer.name} ${spreadsheetChartType} chart`,
        }
      );

      addSystemMessage(chart.summary || `Generated chart at ${chart.path}.`);
      await refreshWorkspaceFiles();
      if (currentSession?.id) {
        await refreshKnowledgeDocuments(currentSession.id);
        await refreshKnowledgeStats(currentSession.id);
      }
      await openArtifactViewer({
        path: chart.path,
        kind: 'image',
        name: chart.name || chart.path.split('/').pop() || 'Spreadsheet Chart',
      });
    } catch (error: any) {
      addSystemMessage(`Chart generation failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSpreadsheetOperationLabel(null);
    }
  }, [
    activeSpreadsheetSheet,
    addSystemMessage,
    artifactViewer,
    currentSession?.id,
    openArtifactViewer,
    refreshKnowledgeDocuments,
    refreshKnowledgeStats,
    refreshWorkspaceFiles,
    spreadsheetChartLabelColumn,
    spreadsheetChartType,
    spreadsheetChartValueColumn,
    spreadsheetFilterQuery,
    spreadsheetSortColumn,
    spreadsheetSortDirection,
  ]);

  const upsertLiveTranscriptMessage = useCallback((
    role: 'user' | 'assistant',
    content: string,
    isFinal: boolean,
    model?: string | null
  ) => {
    const normalizedContent = normalizeWhitespace(String(content || ''));

    if (!normalizedContent) {
      return;
    }

    const timestamp = Date.now();

    setMessages((prev) => {
      if (isFinal) {
        const duplicate = [...prev].reverse().find((message) => (
          message.role === role
          && message.isFinal !== false
          && normalizeWhitespace(message.content) === normalizedContent
          && timestamp - message.timestamp < 8000
        ));

        if (duplicate) {
          return prev;
        }
      }

      const lastIdx = [...prev].reverse().findIndex((message) => (
        message.role === role && message.type === 'voice-transcript'
      ));
      if (lastIdx === -1) {
        return [...prev, {
          id: Math.random().toString(36).substring(7),
          role,
          content: normalizedContent,
          timestamp,
          type: 'voice-transcript' as const,
          isFinal,
          model: model || (role === 'assistant' ? 'ElevenLabs Voice' : 'ElevenLabs Transcript'),
        }];
      }
      const idx = prev.length - 1 - lastIdx;
      const updated = [...prev];
      if (!updated[idx].isFinal) {
        updated[idx] = {
          ...updated[idx],
          content: normalizedContent,
          timestamp,
          isFinal,
          model: model || updated[idx].model || (role === 'assistant' ? 'ElevenLabs Voice' : 'ElevenLabs Transcript'),
        };
      } else {
        return [...prev, {
          id: Math.random().toString(36).substring(7),
          role,
          content: normalizedContent,
          timestamp,
          type: 'voice-transcript' as const,
          isFinal,
          model: model || (role === 'assistant' ? 'ElevenLabs Voice' : 'ElevenLabs Transcript'),
        }];
      }
      return updated;
    });
    touchSessionActivity(currentSession?.id, timestamp);
  }, [currentSession?.id, touchSessionActivity]);

  // ============================================================
  // ElevenLabs Conversation Management
  // ============================================================
  const startConversation = useCallback(async (options: StartConversationOptions = {}) => {
    if (conversationStatus === 'connected' || conversationStatus === 'connecting') return;

    // Defensive teardown: if a previous session handle is still around (e.g. after a
    // timeout-triggered disconnect), end it before spinning up a new one so we don't
    // get two ElevenLabs voices playing over each other.
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch {
        // Ignore — handle may already be dead.
      }
      conversationRef.current = null;
    }

    setConversationStatus('connecting');

    try {
      // Dynamically import the ElevenLabs client
      const { Conversation } = await import('@elevenlabs/client');

      // Get agent config from main process
      const agentConfig = await nexus.elevenlabs.getAgentConfig(currentSession?.id);

      let sessionOptions: any = {};
      let activeConversationId = conversationId || '';
      let activeConversationHandle: any = null;
      let initialUserMessageSent = false;

      const sendInitialUserMessage = () => {
        if (!options.initialUserMessage || initialUserMessageSent) {
          return;
        }

        try {
          activeConversationHandle?.sendUserMessage(options.initialUserMessage);
          initialUserMessageSent = true;
        } catch {
          // Ignore and let the normal text fallback handle it if needed.
        }
      };

      if (!agentConfig.agentId) {
        throw new Error('ElevenLabs Agent ID is missing. Open Settings and save a valid agent.');
      }

      // Use signed URL if API key is available, otherwise use agentId directly
      if (agentConfig.hasApiKey) {
        try {
          const { signedUrl } = await nexus.elevenlabs.getSignedUrl();
          sessionOptions.signedUrl = signedUrl;
          sessionOptions.connectionType = 'websocket';
        } catch (err) {
          throw new Error(
            `ElevenLabs signed URL failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      } else {
        sessionOptions.agentId = agentConfig.agentId;
        sessionOptions.connectionType = 'websocket';
        activeConversationId = `conv_${Date.now()}`;
        setConversationId(activeConversationId);
      }

      // Define client tools that bridge to Nexus
      const clientTools: Record<string, (params: any) => Promise<string>> = {};

      // Build client tools from the tool definitions
      const toolDefs = agentConfig.toolDefinitions || [];
      for (const toolDef of toolDefs) {
        clientTools[toolDef.name] = async (params: any) => {
          // Show tool call in chat
          const pendingMessageId = addMessage({
            role: 'system',
            content: `Executing: ${toolDef.name}`,
            type: 'tool-call',
            toolStatus: 'pending',
            toolStartedAt: Date.now(),
            toolName: toolDef.name,
            toolArgs: params,
          });

          try {
            if (toolDef.name === 'start_brainstorm') {
              const record = await beginBrainstormCapture(params.title, { keepVoiceSession: true });

              window.setTimeout(() => {
                void endConversation();
              }, 200);

              updateMessage(pendingMessageId, (message) => ({
                ...message,
                content: `${toolDef.name} completed`,
                toolStatus: 'success',
                toolFinishedAt: Date.now(),
                toolResult: {
                  brainstormId: record.id,
                  title: record.title,
                  status: record.status,
                  message: `Brainstorm recording started for "${record.title}". Voice mode is ending so the user can speak freely.`,
                },
              }));

              return `Brainstorm recording started for "${record.title}". Voice mode is ending so the user can speak freely.`;
            }

            if (toolDef.name === 'stop_brainstorm') {
              const result = await stopBrainstormCapture();

              updateMessage(pendingMessageId, (message) => ({
                ...message,
                content: `${toolDef.name} completed`,
                toolStatus: 'success',
                toolFinishedAt: Date.now(),
                toolResult: result,
              }));

              return result.message;
            }

            if (toolDef.name === 'show_youtube') {
              try {
                activeConversationHandle?.sendContextualUpdate(
                  'A YouTube video or other media is now playing inside the app. Do not speak unless the user explicitly addresses you or asks you to respond. Stay silent while the media is playing.'
                );
              } catch {
                // Ignore contextual update failures.
              }
              const videoTarget = resolveYouTubeTarget(params);
              const video = await showYouTubeVideo(videoTarget);

              updateMessage(pendingMessageId, (message) => ({
                ...message,
                content: `${toolDef.name} completed`,
                toolStatus: 'success',
                toolFinishedAt: Date.now(),
                toolResult: video,
              }));

              return `Displaying YouTube video: ${video.title}`;
            }

            const result = await nexus.elevenlabs.executeToolCall(
              toolDef.name,
              params,
              activeConversationId,
              currentSession?.id || ''
            );

            // Update message with result
            if (result.success) {
              updateMessage(pendingMessageId, (message) => ({
                ...message,
                content: `${toolDef.name} completed`,
                toolStatus: 'success',
                toolFinishedAt: Date.now(),
                toolResult: result.result,
              }));

              void openResultArtifactViewer(result.result, `${toolDef.name} result`);

              if (toolDef.name === 'open_agent_workflow' && result.result?.workflow) {
                setAgentWorkflowViewer(mapAgentWorkflowRecord(result.result.workflow));
              }

              if (toolDef.name === 'backfill_session_titles') {
                void nexus.sessions.list().then((updatedSessions: any[]) => {
                  setSessions((updatedSessions || []).map(mapSessionRecord));
                }).catch((error: any) => {
                  console.warn('[Emergent] Failed to reload sessions after title backfill:', error);
                });
              }

              if (toolDef.name === 'list_bug_reports' || toolDef.name === 'export_bug_report_pdf') {
                void loadBugReports();
              }

              if (toolDef.name === 'prepare_presentation_mode') {
                setPresentationStatus('preparing');
              }

              if (toolDef.name === 'start_presentation_mode' && result.result?.deck) {
                const deck = result.result.deck as PresentationModeDeck;
                setPresentationDeck(deck);
                setPresentationSlideIndex(0);
                setPresentationAutoPlay(true);
                setPresentationStatus('presenting');
              }

              if (toolDef.name === 'control_presentation_mode') {
                applyPresentationControl(params || {});
              }

              if (
                currentSession?.id
                && [
                  'create_agent',
                  'run_agent',
                  'create_pipeline',
                  'create_task',
                  'create_document',
                  'replace_pdf_footer_brand',
                  'ingest_document',
                  'generate_image',
                  'create_spreadsheet',
                  'append_rows',
                  'save_transcript',
                  'generate_session_briefing',
                  'export_bug_report_pdf',
                  'prepare_presentation_mode',
                ].includes(toolDef.name)
              ) {
                void refreshSessionContext(currentSession.id);
                void refreshWorkspaceFiles();
                void refreshKnowledgeDocuments(currentSession.id);
                void refreshKnowledgeStats(currentSession.id);
              }
            } else {
              updateMessage(pendingMessageId, (message) => ({
                ...message,
                content: `${toolDef.name} failed`,
                toolStatus: 'error',
                toolFinishedAt: Date.now(),
                toolResult: result.error || 'Unknown tool execution failure',
              }));
            }

            if (typeof result.result === 'string') {
              return result.result;
            }

            const structuredResult = result.result && typeof result.result === 'object'
              ? result.result
              : null;
            const spokenResult = String(
              structuredResult?.message
              || structuredResult?.response
              || structuredResult?.summary
              || result.error
              || ''
            ).trim();

            return spokenResult || 'Done';
          } catch (err: any) {
            updateMessage(pendingMessageId, (message) => ({
              ...message,
              content: `${toolDef.name} failed`,
              toolStatus: 'error',
              toolFinishedAt: Date.now(),
              toolResult: err.message || 'Tool execution failed',
            }));
            return `Error: ${err.message || 'Tool execution failed'}`;
          }
        };
      }

      // Start the ElevenLabs conversation session
      const conversation = await Conversation.startSession({
        ...sessionOptions,
        workletPaths: {
          rawAudioProcessor: rawAudioProcessorWorkletUrl,
          audioConcatProcessor: audioConcatProcessorWorkletUrl,
        },
        libsampleratePath: libsamplerateWorkletUrl,

        // Override agent config
        overrides: agentConfig.overrides,

        // Register all client tools
        clientTools,

        // Event handlers
        onConnect: ({ conversationId: cId }: any) => {
          console.log('[Nexus] ElevenLabs connected:', cId);
          activeConversationId = cId || activeConversationId;
          if (activeConversationId) {
            finalizedVoiceSessionsRef.current.delete(activeConversationId);
            setConversationId(activeConversationId);
          }
          setConversationStatus('connected');
          setConversationMode('listening');
          try {
            activeConversationHandle?.setMicMuted(isVoiceMicMuted);
          } catch {
            // Ignore mic mute application errors on connect.
          }
          if (!options.suppressGreeting) {
            const greeting = agentConfig.firstMessage || DEFAULT_VOICE_GREETING;
            addMessage({
              role: 'assistant',
              content: greeting,
              type: 'voice-transcript',
              isFinal: true,
              model: 'ElevenLabs Voice',
            });
            void persistSessionMessage('assistant', greeting);
          }
          if (options.initialUserMessage) {
            window.setTimeout(() => {
              sendInitialUserMessage();
            }, 400);
          }
        },

        onDisconnect: (details: any) => {
          console.log('[Nexus] ElevenLabs disconnected:', details);
          // Fully tear down the handle so its mic stream + audio output stop.
          // Otherwise a timeout-driven disconnect leaves a zombie session that
          // keeps playing when the user re-opens the mic.
          try {
            activeConversationHandle?.endSession?.();
          } catch {
            // Ignore
          }
          if (conversationRef.current === activeConversationHandle) {
            conversationRef.current = null;
          }
          activeConversationHandle = null;
          void finalizeVoiceSession(activeConversationId || conversationId, currentSession?.id || undefined).catch((error: any) => {
            addSystemMessage(`Voice transcript finalization failed: ${error.message || 'Unknown error'}`);
          });
          setConversationStatus('disconnected');
          setConversationMode('idle');
          setAudioLevel(0);

          const reason = details?.message
            || details?.closeReason
            || details?.context?.message
            || (typeof details?.reason === 'string' ? details.reason : '');

          if (reason) {
            // Provide a user-friendly message for LLM timeout instead of raw provider error
            if (/llm response took too long|generating the llm response/i.test(reason)) {
              addSystemMessage(
                'Voice session paused — the AI response took too long. '
                + 'Switching to text mode to continue where we left off.'
              );

              // Auto-transfer to text chat: dispatch event so the main component
              // can pick up the last voice context and continue via text pipeline
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('nexus:voice-to-text-transfer', {
                  detail: { reason: 'llm_timeout' },
                }));
              }, 500);
            } else {
              addSystemMessage(`Voice session disconnected: ${reason}`);
            }
          }
        },

        onMessage: (message: any) => {
          const transcriptText = normalizeWhitespace(String(message?.message || ''));
          const source = String(message?.source || message?.role || '').toLowerCase();
          const isFinal = typeof message?.isFinal === 'boolean' ? message.isFinal : true;

          if (!transcriptText) {
            return;
          }

          if (source === 'user') {
            upsertLiveTranscriptMessage('user', transcriptText, isFinal, 'ElevenLabs Transcript');

            if (isFinal) {
              nexus.elevenlabs.addTranscript(activeConversationId, 'user', transcriptText);
              void persistSessionMessage('user', transcriptText);
              void maybeAutoTitleSession(transcriptText);
              void nexus.meetingMode.addTranscript(transcriptText, 'User');
            }
            return;
          }

          if (source === 'ai' || source === 'agent') {
            upsertLiveTranscriptMessage('assistant', transcriptText, isFinal, 'ElevenLabs Voice');

            if (isFinal) {
              nexus.elevenlabs.addTranscript(activeConversationId, 'agent', transcriptText);
              void persistSessionMessage('assistant', transcriptText);
              void nexus.meetingMode.addTranscript(transcriptText, 'Agent');
            }
          }
        },

        onError: (message: string, context?: any) => {
          console.error('[Nexus] ElevenLabs error:', message, context);
          setConversationStatus('error');
          const contextText = context
            ? ` (${typeof context === 'string' ? context : JSON.stringify(context)})`
            : '';
          addSystemMessage(`Voice connection error: ${message}${contextText}. You can still type messages below.`);
        },

        onModeChange: (mode: any) => {
          // mode.mode = 'speaking' | 'listening'
          setConversationMode(mode.mode === 'speaking' ? 'speaking' : 'listening');
        },

        onStatusChange: (status: any) => {
          // status = 'connected' | 'connecting' | 'disconnected'
          if (status.status) {
            setConversationStatus(status.status as ConversationStatus);
          }
        },
      });

      activeConversationHandle = conversation;
      conversationRef.current = conversation;

      if (agentConfig.contextualPrompt) {
        window.setTimeout(() => {
          try {
            activeConversationHandle?.sendContextualUpdate(agentConfig.contextualPrompt);
          } catch {
            // Ignore contextual update failures and keep the voice session alive.
          }
        }, 250);
      }

      if (options.initialUserMessage) {
        window.setTimeout(() => {
          sendInitialUserMessage();
        }, 900);
      }

      // Audio level visualization via polling
      audioLevelInterval.current = setInterval(() => {
        try {
          if (conversation.getInputByteFrequencyData) {
            const data = conversation.getInputByteFrequencyData();
            if (data && data.length > 0) {
              const avg = data.reduce((a: number, b: number) => a + b, 0) / data.length;
              setAudioLevel(avg / 255);
            }
          }
        } catch {
          // Ignore if not supported
        }
      }, 100);

    } catch (error: any) {
      console.error('[Nexus] Failed to start conversation:', error);
      setConversationStatus('error');
      const detail = error.message || 'Unknown error';
      const hint = /not configured|missing/i.test(detail)
        ? ' Open Settings and verify your ElevenLabs API key and Agent ID.'
        : '';
      addSystemMessage(`Failed to start voice conversation: ${detail}.${hint}`);
    }
  }, [
    conversationStatus,
    conversationId,
    currentSession,
    addMessage,
    addSystemMessage,
    updateMessage,
    upsertLiveTranscriptMessage,
    openResultArtifactViewer,
    mapAgentWorkflowRecord,
    mapSessionRecord,
    loadBugReports,
    applyPresentationControl,
    persistSessionMessage,
    maybeAutoTitleSession,
    finalizeVoiceSession,
    beginBrainstormCapture,
    resolveYouTubeTarget,
    showYouTubeVideo,
    stopBrainstormCapture,
    isVoiceMicMuted,
  ]);

  useEffect(() => {
    startConversationRef.current = startConversation;
  }, [startConversation]);

  const endConversation = useCallback(async () => {
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch {
        // Ignore
      }
      conversationRef.current = null;
    }
    if (audioLevelInterval.current) {
      clearInterval(audioLevelInterval.current);
      audioLevelInterval.current = null;
    }
    if (conversationId) {
      void finalizeVoiceSession(conversationId, currentSession?.id || undefined).catch((error: any) => {
        addSystemMessage(`Voice transcript finalization failed: ${error.message || 'Unknown error'}`);
      });
    }
    setConversationId(null);
    setConversationStatus('disconnected');
    setConversationMode('idle');
    setAudioLevel(0);
  }, [conversationId, currentSession?.id, finalizeVoiceSession]);

  const toggleVoiceMicMute = useCallback(async () => {
    const nextMuted = !isVoiceMicMuted;
    setIsVoiceMicMuted(nextMuted);

    try {
      await conversationRef.current?.setMicMuted?.(nextMuted);
    } catch (error) {
      console.error('[Emergent] Failed to toggle ElevenLabs microphone mute:', error);
    }
  }, [isVoiceMicMuted]);

  const handleStopCurrentTask = useCallback(async () => {
    if (!currentSession?.id) {
      return;
    }

    const activeRequest = activeChatRequestRef.current;
    if (!activeRequest) {
      return;
    }

    activeRequest.cancelled = true;
    setIsLoading(false);

    try {
      await nexus.chat.stopCurrentTask(currentSession.id);
    } catch (error) {
      console.error('[Emergent] Failed to stop current chat task:', error);
    }

    addSystemMessage('Stopped the current task.');
  }, [addSystemMessage, currentSession?.id]);

  // ============================================================
  // Text message fallback (when voice is off or as supplement)
  // ============================================================
  const handleSendMessage = useCallback(async (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText || isLoading) return;
    if (!currentSession?.id) {
      addSystemMessage('Create or select a session before sending a message.');
      return;
    }

    setInputText('');
    setIsLoading(true);

    addMessage({ role: 'user', content: trimmedText, type: 'text' });
    void maybeAutoTitleSession(trimmedText);
    if (!conversationRef.current || conversationStatus !== 'connected') {
      void nexus.meetingMode.addTranscript(trimmedText, 'User');
    }

    const requestId = Date.now();
    const requestState = { requestId, cancelled: false };
    const isRequestCancelled = () => {
      const active = activeChatRequestRef.current;
      return !active || active.requestId !== requestId || active.cancelled;
    };

    try {
      const sendTextThroughChat = async () => {
        activeChatRequestRef.current = requestState;
        const availableTools = await nexus.tools.list().catch(() => []);
        const toolNames = Array.isArray(availableTools) && availableTools.length > 0
          ? availableTools
              .filter((tool: any) => tool?.enabled !== 0 && tool?.name)
              .map((tool: any) => String(tool.name))
          : DEFAULT_TEXT_CHAT_TOOL_NAMES;
        const response = await nexus.chat.sendWithTools(currentSession.id, trimmedText, toolNames);
        if (isRequestCancelled()) {
          return;
        }

        const parsedToolCalls = Array.isArray(response.toolCalls)
          ? response.toolCalls
          : typeof response.toolCalls === 'string'
            ? JSON.parse(response.toolCalls)
            : [];
        const assistantContent = response.content || 'Understood.';
        addMessage({
          role: 'assistant',
          content: assistantContent,
          type: 'text',
          model: response.model || null,
          tier: typeof response.tier === 'number'
            ? response.tier
            : (response.tier ? Number(response.tier) : null),
          toolCalls: Array.isArray(parsedToolCalls) ? parsedToolCalls : [],
        });
        void nexus.meetingMode.addTranscript(assistantContent, 'Agent');

        try {
          const parsedToolResults = typeof response.toolResults === 'string'
            ? JSON.parse(response.toolResults)
            : response.toolResults;
          if (!isRequestCancelled()) {
            await openResultArtifactViewer(parsedToolResults, 'Chat Result');
          }
        } catch {
          // Ignore malformed tool result payloads.
        }
      };

      // If ElevenLabs conversation is active, send as text
      if (conversationRef.current && conversationStatus === 'connected') {
        try {
          conversationRef.current.sendUserMessage(trimmedText);
          activeChatRequestRef.current = null;
        } catch (error: any) {
          // Fallback to regular chat
          try {
            await sendTextThroughChat();
          } catch (chatError: any) {
            if (isRequestCancelled()) {
              return;
            }
            addMessage({
              role: 'assistant',
              content: `AI service unavailable: ${chatError.message || error.message || 'Unknown error'}`,
              type: 'text'
            });
          }
        }
      } else {
        // Regular chat without voice
        try {
          await sendTextThroughChat();
        } catch (error: any) {
          if (isRequestCancelled()) {
            return;
          }
          addMessage({
            role: 'assistant',
            content: `AI service unavailable: ${error.message || 'Unknown error'}`,
            type: 'text'
          });
        }
      }
    } finally {
      if (activeChatRequestRef.current?.requestId === requestId) {
        activeChatRequestRef.current = null;
      }
      setIsLoading(false);
    }
  }, [isLoading, currentSession?.id, conversationStatus, addMessage, addSystemMessage, maybeAutoTitleSession, openResultArtifactViewer]);

  // ============================================================
  // Voice → Text auto-transfer: when voice times out, continue via text
  // ============================================================

  useEffect(() => {
    const handler = () => {
      if (!currentSession?.id || isLoading) return;

      // Grab the last user message from the conversation to provide context
      const recentUserMessages = messages
        .filter((m: Message) => m.role === 'user' && m.content)
        .slice(-3);
      const lastUserMsg = recentUserMessages[recentUserMessages.length - 1]?.content || '';

      const continuationPrompt = lastUserMsg
        ? `[Voice session timed out — continuing via text] The user's last voice message was: "${lastUserMsg}". Please continue fulfilling that request.`
        : '[Voice session timed out — continuing via text] Please continue with whatever you were working on. Summarize where you left off and proceed.';

      void handleSendMessage(continuationPrompt);
    };

    window.addEventListener('nexus:voice-to-text-transfer', handler);
    return () => window.removeEventListener('nexus:voice-to-text-transfer', handler);
  }, [currentSession?.id, isLoading, messages, handleSendMessage]);

  // ============================================================
  // Session management
  // ============================================================
  const createNewSession = useCallback(async () => {
    await cancelBrainstormCapture(true);
    endConversation();
    const created = await nexus.sessions.create(
      `Session ${sessions.length + 1}`,
      `Created from ${PRODUCT_NAME} UI`
    );
    const newSession = mapSessionRecord(created);
    setSessions(prev => [newSession, ...prev]);
    setCurrentSession(newSession);
    setCurrentProject(null);
    setMessages([]);
    setAgents([]);
    setTasks([]);
    setPipelines([]);
    setBrainstormSessions([]);
    setRollingTodoBoard(null);
    setActiveSurfaceTabId('chat');
    resetWorkspaceStageTabs();
    setArtifactViewer(null);
    setYoutubeViewer(null);
    hydrateRollingTodoDrafts(null);
  }, [cancelBrainstormCapture, endConversation, hydrateRollingTodoDrafts, mapSessionRecord, resetWorkspaceStageTabs, sessions.length]);

  const switchSession = useCallback(async (session: Session) => {
    await cancelBrainstormCapture(true);
    endConversation();
    setCurrentSession(session);
    setCurrentProject(null);
    setAgents([]);
    setTasks([]);
    setPipelines([]);
    setRollingTodoBoard(null);
    setActiveSurfaceTabId('chat');
    resetWorkspaceStageTabs();
    setArtifactViewer(null);
    setYoutubeViewer(null);
    hydrateRollingTodoDrafts(null);
    await loadSessionMessages(session.id);
    await loadBrainstormSessions(session.id);
  }, [cancelBrainstormCapture, endConversation, hydrateRollingTodoDrafts, loadBrainstormSessions, loadSessionMessages, resetWorkspaceStageTabs]);

  const deleteSession = useCallback(async (session: Session) => {
    const confirmed = window.confirm(`Delete "${session.name}" and all of its session data?`);

    if (!confirmed) {
      return;
    }

    await cancelBrainstormCapture(currentSession?.id === session.id);
    endConversation();
    await nexus.sessions.delete(session.id);

    const remainingSessions = sessions.filter((candidate) => candidate.id !== session.id);
    setSessions(remainingSessions);
    setAgents([]);
    setTasks([]);
    setPipelines([]);

    if (currentSession?.id !== session.id) {
      return;
    }

    if (remainingSessions.length > 0) {
      const nextSession = remainingSessions[0];
      setCurrentSession(nextSession);
      setCurrentProject(null);
      setRollingTodoBoard(null);
      setActiveSurfaceTabId('chat');
      resetWorkspaceStageTabs();
      setArtifactViewer(null);
      setYoutubeViewer(null);
      hydrateRollingTodoDrafts(null);
      await loadSessionMessages(nextSession.id);
      await loadBrainstormSessions(nextSession.id);
      return;
    }

    const created = await nexus.sessions.create('New Session', 'Primary workspace session');
    const replacementSession = mapSessionRecord(created);
    setSessions([replacementSession]);
    setCurrentSession(replacementSession);
    setCurrentProject(null);
    setMessages([]);
    setBrainstormSessions([]);
    setRollingTodoBoard(null);
    setActiveSurfaceTabId('chat');
    resetWorkspaceStageTabs();
    setArtifactViewer(null);
    setYoutubeViewer(null);
    hydrateRollingTodoDrafts(null);
  }, [cancelBrainstormCapture, currentSession?.id, endConversation, hydrateRollingTodoDrafts, loadBrainstormSessions, loadSessionMessages, mapSessionRecord, resetWorkspaceStageTabs, sessions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputText);
    }
  };

  const renderLegalReportViewerContent = (report: LegalAnalysisReportRecord) => {
    const reportTone = report.summary.red > 0 ? 'red' : report.summary.yellow > 0 ? 'yellow' : 'green';
    const statusLabel = report.summary.red > 0
      ? 'Critical issues present'
      : report.summary.yellow > 0
        ? 'Negotiation issues present'
        : 'Balanced document';
    const readinessLabel = report.readinessScore >= 80
      ? 'Ready for signature with routine cleanup'
      : report.readinessScore >= 60
        ? 'Negotiation pass recommended before signature'
        : 'Substantial legal revision recommended';
    const flagCards: Array<{
      flag: 'red' | 'yellow' | 'green';
      title: string;
      value: number;
      description: string;
    }> = [
      {
        flag: 'red',
        title: 'Red Flags',
        value: report.summary.red,
        description: 'Critical clauses that need revision before signature.',
      },
      {
        flag: 'yellow',
        title: 'Yellow Flags',
        value: report.summary.yellow,
        description: 'Terms worth negotiating for leverage or clarity.',
      },
      {
        flag: 'green',
        title: 'Green Flags',
        value: report.summary.green,
        description: 'Balanced or acceptable clauses as written.',
      },
    ];

    return (
      <div className="legal-report-viewer">
        <section className={`legal-report-hero tone-${reportTone}`}>
          <div className="legal-report-hero-copy">
            <div className="legal-report-kicker">Agreeable Agreements</div>
            <h1>{report.reportTitle || 'Agreeable Agreements Report'}</h1>
            <p>{report.overallAnalysis || report.introduction}</p>
            <div className="legal-report-hero-tags">
              <span className={`legal-report-status tone-${reportTone}`}>
                <span className="legal-report-status-emoji" aria-hidden="true">{getLegalFlagEmoji(reportTone)}</span>
                {statusLabel}
              </span>
              {report.truncated && (
                <span className="legal-report-status neutral">Scope limited</span>
              )}
              {report.analysisWarnings.length > 0 && (
                <span className="legal-report-status neutral">
                  <span className="legal-report-status-emoji" aria-hidden="true">⚠️</span>
                  {report.analysisWarnings.length} warning{report.analysisWarnings.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>

          <div className="legal-report-scorecard">
            <div className="legal-report-score-tile tone-neutral">
              <span>Readiness</span>
              <strong>{report.readinessScore}%</strong>
              <small>{readinessLabel}</small>
            </div>
            {flagCards.map((item) => (
              <div key={`${report.id}-${item.flag}-summary`} className={`legal-report-score-tile tone-${item.flag}`}>
                <span>{getLegalFlagEmoji(item.flag)} {item.title}</span>
                <strong>{item.value}</strong>
                <small>{item.description}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="legal-report-meta-grid">
          <div className="legal-report-meta-card">
            <span>Source Type</span>
            <strong>{report.sourceType.replace(/_/g, ' ')}</strong>
          </div>
          <div className="legal-report-meta-card">
            <span>Source</span>
            <strong>{report.sourceTitle || report.sourceLabel}</strong>
          </div>
          <div className="legal-report-meta-card">
            <span>Analyzed</span>
            <strong>{new Date(report.analyzedAt).toLocaleString()}</strong>
          </div>
          <div className="legal-report-meta-card">
            <span>Clauses</span>
            <strong>{report.summary.total}</strong>
          </div>
        </section>

        <section className="legal-report-flag-overview">
          {flagCards.map((item) => (
            <article key={`${report.id}-${item.flag}-card`} className={`legal-report-flag-card tone-${item.flag}`}>
              <div className="legal-report-flag-card-header">
                <span className="legal-report-flag-card-emoji" aria-hidden="true">{getLegalFlagEmoji(item.flag)}</span>
                <div>
                  <h2>{item.title}</h2>
                  <p>{item.description}</p>
                </div>
              </div>
              <div className="legal-report-flag-card-count">{item.value}</div>
            </article>
          ))}
        </section>

        {report.analysisWarnings.length > 0 && (
          <section className="legal-report-warnings">
            <h2>Analysis Warnings</h2>
            <ul>
              {report.analysisWarnings.map((warning, index) => (
                <li key={`${report.id}-warning-${index}`}>{warning}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="legal-report-summary-grid">
          <div className="legal-report-summary-card">
            <h2>Key Findings</h2>
            <ul>
              {report.conclusion.keyFindings.map((finding, index) => (
                <li key={`${report.id}-finding-${index}`}>{finding}</li>
              ))}
            </ul>
          </div>
          <div className="legal-report-summary-card">
            <h2>Recommendations</h2>
            <ul>
              {report.conclusion.recommendations.map((recommendation, index) => (
                <li key={`${report.id}-recommendation-${index}`}>{recommendation}</li>
              ))}
            </ul>
          </div>
        </section>

        {report.consolidatedImprovements.length > 0 && (
          <section className="legal-report-improvements">
            <h2>Suggested Improvements</h2>
            <div className="legal-report-improvement-list">
              {report.consolidatedImprovements.map((item, index) => (
                <article key={`${report.id}-improvement-${index}`} className="legal-report-improvement-card">
                  <div className="legal-report-improvement-index">{index + 1}</div>
                  <div>
                    <h3>{item.clause}</h3>
                    <p>{item.improvement}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="legal-report-clauses">
          <h2>Clause-by-Clause Analysis</h2>
          <div className="legal-report-clause-list">
            {report.clauses.map((clause) => (
              <article key={`${report.id}-clause-${clause.clauseNumber}`} className={`legal-clause-card tone-${clause.flag}`}>
                <div className="legal-clause-header">
                  <div>
                    <div className="legal-clause-number">Clause {clause.clauseNumber}</div>
                    <h3>{clause.title || `Clause ${clause.clauseNumber}`}</h3>
                  </div>
                  <div className="legal-clause-badges">
                    <span className={`legal-clause-flag tone-${clause.flag}`}>
                      <span className="legal-clause-flag-emoji" aria-hidden="true">{getLegalFlagEmoji(clause.flag)}</span>
                      {getLegalFlagLabel(clause.flag)}
                    </span>
                    <span className={`legal-clause-severity tone-${clause.flag}`}>{clause.severity}</span>
                  </div>
                </div>

                <div className="legal-clause-section">
                  <span>Original Clause</span>
                  <pre>{clause.content}</pre>
                </div>

                <div className="legal-clause-grid">
                  <div className="legal-clause-section">
                    <span>Why It Matters</span>
                    <p>{clause.reason}</p>
                  </div>
                  <div className="legal-clause-section">
                    <span>AI Analysis</span>
                    <p>{clause.aiAnalysis}</p>
                  </div>
                </div>

                {clause.harmExamples.length > 0 && (
                  <div className="legal-clause-section">
                    <span>Example Risks</span>
                    <ul>
                      {clause.harmExamples.map((example, index) => (
                        <li key={`${report.id}-clause-${clause.clauseNumber}-risk-${index}`}>{example}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {clause.suggestedFixes.length > 0 && (
                  <div className="legal-clause-section">
                    <span>Suggested Fixes</span>
                    <div className="legal-clause-fix-list">
                      {clause.suggestedFixes.map((fix) => (
                        <article key={fix.id} className="legal-clause-fix-card">
                          <h4>{fix.label}</h4>
                          <p>{fix.explanation}</p>
                          <pre>{fix.fixedText}</pre>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderTutorialWorkspaceContent = (tutorialId: string) => {
    const selectedTutorial = getBuiltinTutorialById(tutorialId) || BUILTIN_TUTORIALS[0] || null;

    if (!selectedTutorial) {
      return (
        <div className="settings-inline-note">
          No built-in tutorials are available yet.
        </div>
      );
    }

    const selectedMarkdown = getBuiltinTutorialMarkdown(selectedTutorial.id) || selectedTutorial.summary;

    return (
      <div className="tutorials-viewer">
        <div className="tutorials-sidebar">
          <div className="tutorials-sidebar-header">
            <div className="tutorials-kicker">Built-In Nexus Knowledge</div>
            <h2>Tutorial Library</h2>
            <p>Dependencies, setup, and flagship workflow guides live here as first-party operating knowledge.</p>
          </div>

          <div className="tutorial-card-list">
            {BUILTIN_TUTORIALS.map((tutorial) => {
              const isSelected = tutorial.id === selectedTutorial.id;
              const isPlaying = activeTutorialPlaybackId === tutorial.id;

              return (
                <article key={tutorial.id} className={`tutorial-card ${isSelected ? 'active' : ''}`}>
                  <div className="tutorial-card-topline">
                    <span className="tutorial-card-category">{tutorial.category}</span>
                    <span className="tutorial-card-duration">{tutorial.estimatedMinutes} min</span>
                  </div>
                  <h3>{tutorial.title}</h3>
                  <p>{tutorial.summary}</p>
                  <div className="tutorial-card-dependencies">
                    {tutorial.dependencies.slice(0, 2).map((dependency) => (
                      <span key={`${tutorial.id}-${dependency}`}>{dependency}</span>
                    ))}
                  </div>
                  <div className="tutorial-card-actions">
                    <button
                      type="button"
                      className={`mission-card-action ${isSelected ? 'primary' : ''}`}
                      onClick={() => stageTutorialsInWorkspace(tutorial.id)}
                    >
                      {isSelected ? 'Focused' : 'Open'}
                    </button>
                    <button
                      type="button"
                      className="mission-card-action"
                      onClick={() => playTutorial(tutorial.id)}
                    >
                      {isPlaying ? 'Stop' : 'Play'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="tutorial-detail-panel">
          <div className="tutorial-detail-hero">
            <div>
              <div className="tutorials-kicker">{selectedTutorial.category}</div>
              <h1>{selectedTutorial.title}</h1>
              <p>{selectedTutorial.summary}</p>
            </div>
            <div className="tutorial-detail-actions">
              <button
                type="button"
                className="artifact-action-button"
                onClick={() => playTutorial(selectedTutorial.id)}
              >
                {activeTutorialPlaybackId === selectedTutorial.id ? 'Stop Audio' : 'Play Audio'}
              </button>
              <button
                type="button"
                className="artifact-action-button"
                onClick={() => setWorkspacePresenterOpen(true)}
              >
                Present
              </button>
            </div>
          </div>

          <div className="tutorial-detail-metrics">
            <div className="tutorial-detail-metric">
              <span>Dependencies</span>
              <strong>{selectedTutorial.dependencies.length}</strong>
            </div>
            <div className="tutorial-detail-metric">
              <span>Steps</span>
              <strong>{selectedTutorial.steps.length}</strong>
            </div>
            <div className="tutorial-detail-metric">
              <span>Estimated Time</span>
              <strong>{selectedTutorial.estimatedMinutes} min</strong>
            </div>
          </div>

          <div className="artifact-markdown-viewer tutorial-markdown-viewer">
            <ReactMarkdown>{selectedMarkdown}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  };

  const renderArtifactViewerContent = (artifact: LoadedArtifact) => {
    if (artifact.kind === 'image') {
      return (
        <img
          className="artifact-image"
          src={artifact.dataUrl}
          alt={artifact.name}
        />
      );
    }

    if (artifact.kind === 'video') {
      return (
        <div className="artifact-video-viewer">
          <video
            className="artifact-video-player"
            src={artifact.dataUrl}
            controls
            preload="metadata"
          />
        </div>
      );
    }

    if (artifact.kind === 'audio') {
      return (
        <div className="artifact-audio-viewer">
          <audio
            className="artifact-audio-player"
            src={artifact.dataUrl}
            controls
            preload="metadata"
          />
        </div>
      );
    }

    if (artifact.kind === 'spreadsheet') {
      return (
        <div className="spreadsheet-viewer">
          <div className="spreadsheet-summary">
            {artifact.spreadsheetData?.summary || 'Spreadsheet loaded.'}
          </div>
          <div className="spreadsheet-sheet-tabs">
            {(artifact.spreadsheetData?.sheets || []).map((sheet) => (
              <button
                key={sheet.name}
                className={`spreadsheet-sheet-tab ${activeSpreadsheetSheet === sheet.name ? 'active' : ''}`}
                onClick={() => setActiveSpreadsheetSheet(sheet.name)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          {(() => {
            const sheets = artifact.spreadsheetData?.sheets || [];
            const selectedSheet = sheets.find((sheet) => sheet.name === activeSpreadsheetSheet) || sheets[0];

            if (!selectedSheet) {
              return <div className="settings-inline-note">No spreadsheet rows available.</div>;
            }

            return (
              <>
                <div className="spreadsheet-toolbar">
                  <div className="spreadsheet-toolbar-group">
                    <input
                      className="spreadsheet-toolbar-input"
                      type="text"
                      value={spreadsheetFilterQuery}
                      placeholder="Filter rows, e.g. operator=CHEVRON county=REEVES"
                      onChange={(event) => setSpreadsheetFilterQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void applySpreadsheetFilter();
                        }
                      }}
                    />
                    <button className="spreadsheet-toolbar-button" onClick={() => void applySpreadsheetFilter()}>
                      Apply Filter
                    </button>
                    <button className="spreadsheet-toolbar-button secondary" onClick={() => void resetSpreadsheetView()}>
                      Reset View
                    </button>
                  </div>
                  <div className="spreadsheet-toolbar-group">
                    <select
                      className="spreadsheet-toolbar-select"
                      value={spreadsheetSortColumn}
                      onChange={(event) => setSpreadsheetSortColumn(event.target.value)}
                    >
                      <option value="">Sort column</option>
                      {selectedSheet.headers.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                    <select
                      className="spreadsheet-toolbar-select"
                      value={spreadsheetSortDirection}
                      onChange={(event) => setSpreadsheetSortDirection(event.target.value === 'desc' ? 'desc' : 'asc')}
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                    <button
                      className="spreadsheet-toolbar-button"
                      onClick={() => void applySpreadsheetSort()}
                      disabled={!spreadsheetSortColumn}
                    >
                      Apply Sort
                    </button>
                  </div>
                  <div className="spreadsheet-toolbar-group">
                    <select
                      className="spreadsheet-toolbar-select"
                      value={spreadsheetExportFormat}
                      onChange={(event) => setSpreadsheetExportFormat(event.target.value as typeof spreadsheetExportFormat)}
                    >
                      <option value="xlsx">XLSX</option>
                      <option value="xls">XLS</option>
                      <option value="csv">CSV</option>
                      <option value="tsv">TSV</option>
                      <option value="json">JSON</option>
                    </select>
                    <button className="spreadsheet-toolbar-button" onClick={() => void exportSpreadsheetView()}>
                      Export
                    </button>
                  </div>
                  <div className="spreadsheet-toolbar-group">
                    <select
                      className="spreadsheet-toolbar-select"
                      value={spreadsheetChartType}
                      onChange={(event) => setSpreadsheetChartType(event.target.value === 'line' ? 'line' : 'bar')}
                    >
                      <option value="bar">Bar chart</option>
                      <option value="line">Line chart</option>
                    </select>
                    <select
                      className="spreadsheet-toolbar-select"
                      value={spreadsheetChartLabelColumn}
                      onChange={(event) => setSpreadsheetChartLabelColumn(event.target.value)}
                    >
                      <option value="">Label column</option>
                      {selectedSheet.headers.map((header) => (
                        <option key={`label-${header}`} value={header}>{header}</option>
                      ))}
                    </select>
                    <select
                      className="spreadsheet-toolbar-select"
                      value={spreadsheetChartValueColumn}
                      onChange={(event) => setSpreadsheetChartValueColumn(event.target.value)}
                    >
                      <option value="">Value column</option>
                      {selectedSheet.headers.map((header) => (
                        <option key={`value-${header}`} value={header}>{header}</option>
                      ))}
                    </select>
                    <button
                      className="spreadsheet-toolbar-button"
                      onClick={() => void generateSpreadsheetChartView()}
                      disabled={!spreadsheetChartLabelColumn || !spreadsheetChartValueColumn}
                    >
                      Generate Chart
                    </button>
                  </div>
                </div>
                <div className="spreadsheet-meta">
                  <span>{selectedSheet.rowCount} rows</span>
                  <span>{selectedSheet.columnCount} columns</span>
                  {selectedSheet.truncated && <span>Preview limited</span>}
                  {spreadsheetOperationLabel && (
                    <span className="spreadsheet-toolbar-status">{spreadsheetOperationLabel}</span>
                  )}
                </div>
                <div className="spreadsheet-table-wrap">
                  <table className="spreadsheet-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        {selectedSheet.headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSheet.rows.length === 0 ? (
                        <tr>
                          <td colSpan={selectedSheet.headers.length + 1}>
                            <div className="settings-inline-note">No rows match the current view.</div>
                          </td>
                        </tr>
                      ) : selectedSheet.rows.map((row, rowIndex) => {
                        const resolvedRowIndex = Number.isFinite(Number(row.__rowIndex))
                          ? Number(row.__rowIndex)
                          : rowIndex;
                        const displayRowNumber = resolvedRowIndex + 2;

                        return (
                          <tr key={`${selectedSheet.name}-${resolvedRowIndex}`}>
                            <td className="spreadsheet-row-index">{displayRowNumber}</td>
                            {selectedSheet.headers.map((header) => {
                              const isEditing = spreadsheetEditor?.sheetName === selectedSheet.name
                                && spreadsheetEditor?.rowIndex === resolvedRowIndex
                                && spreadsheetEditor?.column === header;

                              return (
                                <td key={`${selectedSheet.name}-${resolvedRowIndex}-${header}`}>
                                  {isEditing ? (
                                    <div className="spreadsheet-cell-editor">
                                      <input
                                        className="spreadsheet-cell-input"
                                        type="text"
                                        value={spreadsheetEditor.value}
                                        autoFocus
                                        onChange={(event) => setSpreadsheetEditor((previous) => (
                                          previous
                                            ? { ...previous, value: event.target.value }
                                            : previous
                                        ))}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault();
                                            void saveSpreadsheetCellEdit();
                                          }
                                          if (event.key === 'Escape') {
                                            setSpreadsheetEditor(null);
                                          }
                                        }}
                                      />
                                      <div className="spreadsheet-cell-actions">
                                        <button className="spreadsheet-inline-button" onClick={() => void saveSpreadsheetCellEdit()}>
                                          Save
                                        </button>
                                        <button
                                          className="spreadsheet-inline-button secondary"
                                          onClick={() => setSpreadsheetEditor(null)}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      className="spreadsheet-cell-button"
                                      onClick={() => setSpreadsheetEditor({
                                        sheetName: selectedSheet.name,
                                        rowIndex: resolvedRowIndex,
                                        column: header,
                                        value: String(row[header] ?? ''),
                                      })}
                                    >
                                      {String(row[header] ?? '')}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      );
    }

    if (artifact.kind === 'text') {
      const textContent = artifact.textContent || '';
      const normalizedPath = String(artifact.path || '').toLowerCase();
      const looksLikeMarkdown = normalizedPath.endsWith('.md')
        || normalizedPath.endsWith('.markdown')
        || /^#{1,6}\s/m.test(textContent);

      if (looksLikeMarkdown) {
        return (
          <div className="artifact-markdown-viewer">
            <ReactMarkdown>{textContent}</ReactMarkdown>
          </div>
        );
      }

      return <pre className="artifact-text-viewer">{textContent}</pre>;
    }

    return (
      <iframe
        className="artifact-frame"
        src={artifact.dataUrl}
        title={artifact.name}
      />
    );
  };

  // ============================================================
  // Render helpers
  // ============================================================
  const renderMessage = (msg: Message) => {
    if (msg.type === 'tool-call') {
      const artifactReferences = collectArtifactReferences(msg.toolResult);
      const displayToolArgs = sanitizeToolPayload(msg.toolArgs);
      const displayToolResult = sanitizeToolPayload(msg.toolResult);
      const displayToolArgsText = typeof displayToolArgs === 'string'
        ? displayToolArgs
        : JSON.stringify(displayToolArgs, null, 2) ?? '';
      const displayToolResultText = typeof displayToolResult === 'string'
        ? displayToolResult
        : JSON.stringify(displayToolResult, null, 2) ?? '';
      const canOpenResultViewer = Boolean(displayToolResultText.trim());
      const statusIconName = msg.toolStatus === 'success'
        ? 'check'
        : msg.toolStatus === 'error'
          ? 'alertTriangle'
          : 'loader';
      const statusColor = msg.toolStatus === 'success'
        ? '#22c55e'
        : msg.toolStatus === 'error'
          ? '#ef4444'
          : '#a78bfa';
      const durationMs = msg.toolFinishedAt && msg.toolStartedAt
        ? Math.max(0, msg.toolFinishedAt - msg.toolStartedAt)
        : msg.toolStartedAt
          ? Math.max(0, Date.now() - msg.toolStartedAt)
          : null;
      const durationLabel = durationMs === null
        ? ''
        : durationMs >= 1000
          ? `${(durationMs / 1000).toFixed(1)}s`
          : `${durationMs}ms`;
      const statusLabel = msg.toolStatus === 'pending'
        ? `Running on backend${durationLabel ? ` · ${durationLabel}` : ''}`
        : msg.toolStatus === 'success'
          ? `Completed${durationLabel ? ` in ${durationLabel}` : ''}`
          : `Failed${durationLabel ? ` after ${durationLabel}` : ''}`;

      return (
        <div key={msg.id} className={`tool-call-message ${msg.toolStatus || 'pending'}`}>
          <div className="tool-call-header">
            <span className={`tool-badge ${msg.toolStatus || 'pending'}`}><Icon name={msg.toolName ? getToolIconName(msg.toolName) : statusIconName} size={14} color={statusColor} /> {msg.toolName}</span>
            <span className={`tool-status-text ${msg.toolStatus || 'pending'}`}>
              {msg.toolStatus === 'pending' && <span className="tool-spinner" aria-hidden="true"></span>}
              {statusLabel}
            </span>
          </div>
          {Boolean(displayToolArgsText) && (
            <div className="tool-call-body">
              <pre className="tool-json">{displayToolArgsText}</pre>
            </div>
          )}
          {Boolean(displayToolResultText) && (
            <div className="tool-result">
              <pre className="tool-json">{displayToolResultText}</pre>
            </div>
          )}
          {/* Inline image preview for generate_image results */}
          {msg.toolName === 'generate_image' && msg.toolStatus === 'success' && artifactReferences.filter((a) => a.kind === 'image').map((imgArtifact) => {
            const cachedUrl = inlineImageCache[imgArtifact.path];
            if (!cachedUrl) {
              void loadInlineImagePreview(imgArtifact.path);
            }
            return (
              <div key={imgArtifact.path} className="generated-image-preview">
                {cachedUrl ? (
                  <img
                    src={cachedUrl}
                    alt={imgArtifact.name}
                    className="generated-image-inline"
                    onClick={() => void openArtifactViewer(imgArtifact)}
                    title="Click to view full size"
                  />
                ) : (
                  <div className="generated-image-loading">Generating preview…</div>
                )}
              </div>
            );
          })}
          {artifactReferences.length > 0 && (
            <div className="artifact-actions">
              {artifactReferences.map((artifact) => (
                <div key={artifact.path} className="artifact-action-row">
                  <button
                    className="artifact-action-button primary"
                    onClick={() => void openArtifactViewer(artifact)}
                    disabled={artifactLoadingPath === artifact.path}
                  >
                    {artifactLoadingPath === artifact.path ? 'Loading…' : `View ${artifact.kind.toUpperCase()}`}
                  </button>
                  <button
                    className="artifact-action-button"
                    onClick={() => void revealArtifact(artifact.path)}
                  >
                    Reveal File
                  </button>
                  <button
                    className="artifact-action-button"
                    onClick={() => void nexus.images.openFolder()}
                    title="Open media library"
                  >
                    Media Library
                  </button>
                  <span className="artifact-path">{artifact.name}</span>
                </div>
              ))}
            </div>
          )}
          {artifactReferences.length === 0 && canOpenResultViewer && (
            <div className="artifact-actions">
              <div className="artifact-action-row">
                <button
                  className="artifact-action-button primary"
                  onClick={() => void materializeTextArtifactViewer(
                    `${msg.toolName || 'Tool'} Result`,
                    displayToolResultText,
                    `result:${msg.toolName || 'tool'}`
                  )}
                >
                  Open Result
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (msg.type === 'agent-notification') {
      return (
        <div key={msg.id} className="agent-notification">
          <span className="agent-notification-icon"><Icon name="sparkles" size={14} color="#a78bfa" /></span>
          {msg.content}
        </div>
      );
    }

    if (msg.type === 'pipeline-update') {
      return (
        <div key={msg.id} className="pipeline-update">
          <span className="tool-badge"><Icon name="gitBranch" size={14} color="#3b82f6" /> {msg.pipelineStage}</span>
          {msg.content}
        </div>
      );
    }

    const canCopyMessage = Boolean(String(msg.content || '').trim());

    return (
      <div key={msg.id} className={`message ${msg.role}`}>
        <div className="message-bubble">
          <div className="message-bubble-meta">
            <span className="message-role-label">
              {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Emergent' : 'System'}
            </span>
            {formatModelLabel(msg.model, msg.tier) && (
              <span className="message-model-label">{formatModelLabel(msg.model, msg.tier)}</span>
            )}
            <span className="message-time-label">{formatTimestampLabel(msg.timestamp)}</span>
          </div>
          {msg.role === 'assistant' ? (
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          ) : (
            msg.content
          )}
          {msg.type === 'voice-transcript' && !msg.isFinal && (
            <span className="transcript-pending">...</span>
          )}
          {canCopyMessage && (
            <div className="message-bubble-actions">
              <button
                type="button"
                className="message-copy-button"
                onClick={() => void copyTextValue(msg.content, `message:${msg.id}`)}
              >
                <Icon name={copiedTextKey === `message:${msg.id}` ? 'check' : 'clipboard'} size={12} />
                <span>{copiedTextKey === `message:${msg.id}` ? 'Copied' : 'Copy Text'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const formatElapsedTime = (durationMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const formatUsageNumber = (value: number) =>
    new Intl.NumberFormat('en-US').format(Math.round(Number(value || 0)));

  const formatUsageCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

  const formatUsageMinutes = (value: number) => {
    const minutes = Number(value || 0);
    if (minutes >= 60) {
      return `${(minutes / 60).toFixed(1)} h`;
    }
    return `${minutes.toFixed(1)} min`;
  };

  const formatUsageReset = (unixValue?: number | null) => {
    const normalized = Number(unixValue || 0);
    if (!normalized) {
      return 'Unknown';
    }

    const timestamp = normalized > 1_000_000_000_000 ? normalized : normalized * 1000;
    return new Date(timestamp).toLocaleString();
  };

  // ============================================================
  // Orb style based on state
  // ============================================================
  const getOrbClass = () => {
    const classes = ['nexus-orb'];
    if (conversationStatus === 'connected') classes.push('connected');
    if (conversationStatus === 'connecting') classes.push('connecting');
    if (conversationMode === 'speaking') classes.push('speaking');
    if (conversationMode === 'listening') classes.push('listening');
    return classes.join(' ');
  };

  const orbScale = 1 + audioLevel * 0.4;
  const voiceStatusTitle = conversationStatus === 'connected'
    ? (conversationMode === 'speaking' ? 'Voice channel active' : 'Voice channel live')
    : conversationStatus === 'connecting'
      ? 'Securing voice link'
      : conversationStatus === 'error'
        ? 'Connection requires attention'
        : 'Voice channel offline';
  const voiceStatusDetail = conversationStatus === 'connected'
    ? (conversationMode === 'speaking'
        ? 'The system is speaking. End the session at any time from the command seal.'
        : 'The system is listening for operator input and routing it through the live voice channel.')
    : conversationStatus === 'connecting'
      ? `Establishing the secure session with ${PRODUCT_NAME}.`
      : conversationStatus === 'error'
        ? 'The voice channel did not initialize cleanly. Review configuration and reconnect.'
        : 'Use voice for live operator sessions, or enter a directive below to work in text mode.';
  const activeToolMessages = messages.filter((message) => message.type === 'tool-call' && message.toolStatus === 'pending');
  const hasConversationActivity = messages.some((message) => {
    if (message.type === 'tool-call') return true;
    if (message.role === 'system') return true;
    if (message.role === 'user') return true;
    if (message.role === 'assistant' && message.content !== DEFAULT_VOICE_GREETING) return true;
    return false;
  });
  const showLandingExperience = !hasConversationActivity;
  const surfaceTabs = useMemo<SurfaceTab[]>(() => ([
    { id: 'chat', label: 'Chat', icon: 'messageSquare' },
    { id: 'workspace', label: 'Workspace', icon: 'compass' },
  ]), []);
  const activeWorkspaceStageTab = useMemo<WorkspaceStageTab>(
    () => workspaceStageTabs.find((tab) => tab.id === activeWorkspaceStageTabId) || workspaceStageTabs[0] || WORKSPACE_MISSION_STAGE_TAB,
    [activeWorkspaceStageTabId, workspaceStageTabs],
  );
  const meetingOverlayRight = showContextPanel ? 'calc(var(--context-panel-width) + 36px)' : '24px';

  const formatCrmSourceTypeLabel = (sourceType: EntityKnowledgeSourceRecord['sourceType']): string => {
    switch (sourceType) {
      case 'profile':
        return 'Profile';
      case 'relationship':
        return 'Relationship';
      case 'document':
        return 'Document';
      case 'artifact':
        return 'Artifact';
      case 'project':
        return 'Project';
      case 'briefing':
        return 'Briefing';
      case 'swot':
        return 'SWOT';
      default:
        return 'Source';
    }
  };

  const getCrmSourceTypeColors = (sourceType: EntityKnowledgeSourceRecord['sourceType']) => {
    switch (sourceType) {
      case 'profile':
        return { background: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.26)', color: '#fde68a' };
      case 'relationship':
        return { background: 'rgba(59, 130, 246, 0.14)', border: 'rgba(59, 130, 246, 0.26)', color: '#93c5fd' };
      case 'document':
        return { background: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.24)', color: '#cbd5e1' };
      case 'artifact':
        return { background: 'rgba(168, 85, 247, 0.14)', border: 'rgba(168, 85, 247, 0.24)', color: '#d8b4fe' };
      case 'project':
        return { background: 'rgba(20, 184, 166, 0.14)', border: 'rgba(20, 184, 166, 0.24)', color: '#99f6e4' };
      case 'briefing':
        return { background: 'rgba(99, 102, 241, 0.14)', border: 'rgba(99, 102, 241, 0.24)', color: '#c7d2fe' };
      case 'swot':
        return { background: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.24)', color: '#86efac' };
      default:
        return { background: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.24)', color: '#cbd5e1' };
    }
  };

  const renderCrmKnowledgeSurface = (entityName: string) => {
    const sectionStyle: React.CSSProperties = {
      padding: '16px 18px',
      borderRadius: 16,
      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(15, 23, 42, 0.74))',
      border: '1px solid rgba(245, 158, 11, 0.16)',
      boxShadow: '0 22px 48px rgba(2, 6, 23, 0.24), inset 0 1px 0 rgba(255,255,255,0.04)',
    };
    const activeKey = crmActiveEntity?.key || '';
    const chatLoading = activeKey !== '' && crmChatLoadingKey === activeKey;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 700 }}>Contextual Facts</div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Nexus synthesizes high-signal context first, then keeps the underlying evidence below.
              </div>
            </div>
            <div style={{ color: '#fcd34d', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {crmEntityKnowledgeLoading
                ? 'Refreshing'
                : `${crmKnowledgeFacts.length} fact${crmKnowledgeFacts.length === 1 ? '' : 's'}`}
            </div>
          </div>

          {crmKnowledgeFacts.length > 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {crmKnowledgeFacts.map((fact) => (
                <div
                  key={fact.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.035)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        background: 'rgba(245, 158, 11, 0.14)',
                        border: '1px solid rgba(245, 158, 11, 0.22)',
                        color: '#fde68a',
                      }}
                    >
                      {fact.category}
                    </span>
                    {typeof fact.confidence === 'number' && (
                      <span style={{ color: '#64748b', fontSize: 11 }}>
                        {Math.round(fact.confidence <= 1 ? fact.confidence * 100 : fact.confidence)}% confidence
                      </span>
                    )}
                  </div>
                  <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.6 }}>{fact.text}</div>
                  {Array.isArray(fact.sourceLabels) && fact.sourceLabels.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {fact.sourceLabels.map((label) => (
                        <span
                          key={`${fact.id}:${label}`}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            background: 'rgba(148, 163, 184, 0.12)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            color: '#cbd5e1',
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#64748b', fontSize: 12 }}>
              {crmEntityKnowledgeLoading
                ? 'Extracting contextual facts from the CRM knowledge base…'
                : 'No contextual facts have been synthesized for this CRM record yet.'}
            </div>
          )}
        </div>

        <div
          style={{
            ...sectionStyle,
            padding: '18px',
            background: 'linear-gradient(180deg, rgba(22, 30, 47, 0.92), rgba(15, 23, 42, 0.82))',
            border: '1px solid rgba(250, 204, 21, 0.22)',
            boxShadow: '0 28px 56px rgba(2, 6, 23, 0.28), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 700 }}>CRM Knowledge Chat</div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Ask about {entityName}. Responses stay scoped to this CRM record and its linked knowledge base.
              </div>
            </div>
            <div style={{ color: '#fcd34d', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Focused
            </div>
          </div>

          <div
            ref={crmChatMessagesRef}
            style={{
              maxHeight: 280,
              minHeight: 220,
              overflowY: 'auto',
              padding: '12px',
              borderRadius: 14,
              background: 'linear-gradient(180deg, rgba(2, 6, 23, 0.44), rgba(15, 23, 42, 0.58))',
              border: '1px solid rgba(255,255,255,0.08)',
              marginBottom: 12,
            }}
          >
            {crmActiveChatMessages.map((message) => (
              <div
                key={message.id}
                style={{
                  display: 'flex',
                  justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    maxWidth: '86%',
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: message.role === 'user'
                      ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(202, 138, 4, 0.12))'
                      : 'rgba(255,255,255,0.04)',
                    border: message.role === 'user'
                      ? '1px solid rgba(245, 158, 11, 0.22)'
                      : '1px solid rgba(255,255,255,0.08)',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ color: message.role === 'user' ? '#fde68a' : '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                    {message.role === 'user' ? 'You' : 'CRM Focus'}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {message.role === 'assistant' ? <ReactMarkdown>{message.content}</ReactMarkdown> : message.content}
                  </div>
                  {Array.isArray(message.sources) && message.sources.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {message.sources.map((source, index) => (
                        <span
                          key={`${message.id}:source:${index}`}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            background: 'rgba(148, 163, 184, 0.12)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            color: '#cbd5e1',
                          }}
                        >
                          {source}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Scanning CRM context and linked source material…
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={crmChatInput}
              onChange={(event) => setCrmChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendCrmChatMessage();
                }
              }}
              rows={3}
              placeholder={`Ask about ${entityName}'s priorities, relationships, projects, or supporting evidence…`}
              disabled={!crmActiveEntity || chatLoading}
              style={{
                flex: 1,
                minHeight: 78,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(2, 6, 23, 0.28)',
                color: '#e2e8f0',
                fontSize: 13,
                lineHeight: 1.5,
                outline: 'none',
                resize: 'vertical',
              }}
            />
            <button
              type="button"
              className="artifact-action-button primary"
              onClick={() => void sendCrmChatMessage()}
              disabled={!crmActiveEntity || chatLoading || !crmChatInput.trim()}
              style={{ minWidth: 92, height: 40 }}
            >
              {chatLoading ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 700 }}>Source Material</div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Raw CRM evidence stays attached underneath the synthesized facts and scoped chat.
              </div>
            </div>
            <div style={{ color: '#fcd34d', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {crmEntityKnowledgeLoading
                ? 'Refreshing'
                : `${crmKnowledgeSourceMaterials.length} source${crmKnowledgeSourceMaterials.length === 1 ? '' : 's'}`}
            </div>
          </div>

          {crmKnowledgeSourceMaterials.length > 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {crmKnowledgeSourceMaterials.map((source) => {
                const sourceTypeColors = getCrmSourceTypeColors(source.sourceType);
                const openLabel = source.documentId
                  ? 'Open Document'
                  : source.projectId
                    ? 'Open Project'
                    : source.artifactPath
                      ? 'Open File'
                      : 'Open Source';

                return (
                  <div
                    key={source.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              background: sourceTypeColors.background,
                              border: `1px solid ${sourceTypeColors.border}`,
                              color: sourceTypeColors.color,
                            }}
                          >
                            {formatCrmSourceTypeLabel(source.sourceType)}
                          </span>
                          {typeof source.confidence === 'number' && (
                            <span style={{ color: '#64748b', fontSize: 11 }}>
                              {Math.round(source.confidence <= 1 ? source.confidence * 100 : source.confidence)}% confidence
                            </span>
                          )}
                          {typeof source.mentionCount === 'number' && source.mentionCount > 0 && (
                            <span style={{ color: '#64748b', fontSize: 11 }}>
                              {source.mentionCount} mention{source.mentionCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 600 }}>{source.title}</div>
                        {source.subtitle && (
                          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{source.subtitle}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="artifact-action-button"
                          onClick={() => void openCrmSourceMaterial(source)}
                        >
                          {openLabel}
                        </button>
                        {source.artifactPath && (
                          <button
                            type="button"
                            className="artifact-action-button"
                            onClick={() => void revealCrmSourceMaterial(source)}
                          >
                            Reveal
                          </button>
                        )}
                      </div>
                    </div>

                    {source.preview && (
                      <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                        {source.preview}
                      </div>
                    )}

                    <div style={{ color: '#64748b', fontSize: 11 }}>
                      {[
                        source.artifactPath ? formatPathForPanel(source.artifactPath, 4) : '',
                        source.linkedAt ? `Linked ${new Date(source.linkedAt).toLocaleDateString()}` : '',
                      ].filter(Boolean).join(' · ') || 'CRM source record'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: '#64748b', fontSize: 12 }}>
              {crmEntityKnowledgeLoading
                ? 'Loading linked source material…'
                : 'No source material has been linked to this CRM record yet.'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="app-container">
      {/* Left Sidebar */}
        <div className={`sidebar-left ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">{PRODUCT_NAME}</div>
          <button
            type="button"
            className="panel-close-button panel-collapse-button"
            onClick={() => setSidebarCollapsed(true)}
            title="Collapse workspace sidebar"
            aria-label="Collapse workspace sidebar"
          >
            {'<'}
          </button>
        </div>

        <div className="sidebar-section quick-launch-section">
          <div className="sidebar-section-title">Quick Launch</div>
          <div className="quick-launch-grid">
            <button className="quick-launch-button featured" onClick={() => void openAgentHub()}>
              <span className="quick-launch-icon"><Icon name="layers" size={17} /></span>
              <span className="quick-launch-copy">
                <span className="quick-launch-label">Agent Hub</span>
                <span className="quick-launch-subtitle">Build, install, sell</span>
              </span>
            </button>
            <button className="quick-launch-button" onClick={() => void openMarketingDepartment()}>
              <span className="quick-launch-icon"><Icon name="notebook" size={16} /></span>
              <span className="quick-launch-copy">
                <span className="quick-launch-label">Marketing</span>
                <span className="quick-launch-subtitle">Campaign studio</span>
              </span>
            </button>
            <button
              className="quick-launch-button"
              onClick={() => {
                setActiveSurfaceTabId('workspace');
                activateWorkspaceStageTab(WORKSPACE_MISSION_STAGE_TAB);
              }}
            >
              <span className="quick-launch-icon"><Icon name="compass" size={16} /></span>
              <span className="quick-launch-copy">
                <span className="quick-launch-label">Workspace</span>
                <span className="quick-launch-subtitle">Mission control</span>
              </span>
            </button>
            <button
              className="quick-launch-button"
              onClick={() => {
                setActiveSurfaceTabId('workspace');
                activateWorkspaceStageTab(WORKSPACE_MISSION_STAGE_TAB);
              }}
            >
              <span className="quick-launch-icon"><Icon name="fileText" size={16} /></span>
              <span className="quick-launch-copy">
                <span className="quick-launch-label">Agreeable Agreements</span>
                <span className="quick-launch-subtitle">Contract review</span>
              </span>
            </button>
            <button
              className="quick-launch-button"
              onClick={() => {
                stageTutorialsInWorkspace(BUILTIN_TUTORIALS[0]?.id);
              }}
            >
              <span className="quick-launch-icon"><Icon name="bookOpen" size={16} /></span>
              <span className="quick-launch-copy">
                <span className="quick-launch-label">Tutorials</span>
                <span className="quick-launch-subtitle">Setup and guides</span>
              </span>
            </button>
          </div>
        </div>

        <div className="sidebar-section sessions-section">
          <button
            type="button"
            className="sidebar-section-toggle"
            onClick={() => setSessionsExpanded((expanded) => !expanded)}
            aria-expanded={sessionsExpanded}
          >
            <span>Sessions</span>
            <span className="sidebar-section-count">{sessions.length}</span>
            <span className="sidebar-section-chevron">{sessionsExpanded ? '−' : '+'}</span>
          </button>

          {!sessionsExpanded && currentSession && (
            <button
              type="button"
              className="sidebar-current-session"
              onClick={() => setSessionsExpanded(true)}
              title="Expand sessions"
            >
              <span className="sidebar-session-name">{currentSession.name}</span>
              <span className="sidebar-session-meta">{formatSessionDateLabel(currentSession)}</span>
            </button>
          )}

          {!sessionsExpanded && !currentSession && (
            <button
              type="button"
              className="sidebar-current-session empty"
              onClick={() => setSessionsExpanded(true)}
              title="Expand sessions"
            >
              <span className="sidebar-session-name">No session selected</span>
              <span className="sidebar-session-meta">Open sessions</span>
            </button>
          )}

          {sessionsExpanded && (
            <>
              <input
                className="sidebar-search-input"
                value={sessionSearchQuery}
                onChange={(event) => setSessionSearchQuery(event.target.value)}
                placeholder="Search session titles and content"
              />
              {renderFieldCopyRow(sessionSearchQuery, 'session-search-field')}
              <div className="sidebar-list sessions-list">
                {sessions.length === 0 && (
                  <div className="sidebar-session-empty">No saved sessions yet.</div>
                )}
                {sessions.length > 0 && filteredSessions.length === 0 && (
                  <div className="sidebar-session-empty">No sessions match that search.</div>
                )}
                {filteredSessions.map(session => (
                  <div
                    key={session.id}
                    className={`sidebar-item session-sidebar-item ${currentSession?.id === session.id ? 'active' : ''}`}
                    onClick={() => switchSession(session)}
                  >
                    <div className="sidebar-session-copy">
                      <span className="sidebar-session-name">{session.name}</span>
                      <span className="sidebar-session-meta">
                        {formatSessionDateLabel(session)} · {session.messageCount || 0} messages
                      </span>
                    </div>
                    <button
                      type="button"
                      className="sidebar-item-delete"
                      title={`Delete ${session.name}`}
                      aria-label={`Delete ${session.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteSession(session);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <button className="sidebar-button" onClick={createNewSession}>
            + New Session
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Agents</div>
          <input
            className="sidebar-search-input"
            value={agentSearchQuery}
            onChange={(event) => setAgentSearchQuery(event.target.value)}
            placeholder="Search agents"
          />
          {renderFieldCopyRow(agentSearchQuery, 'sidebar-agent-search-field')}
          <div className="sidebar-list">
            {filteredAgents.map(agent => (
              <button
                key={agent.id}
                type="button"
                className={`agent-card agent-card-button ${agentWorkflowLoadingId === agent.id ? 'agent-card-loading' : ''}`}
                onClick={() => void openAgentWorkflow(agent)}
                title={`Open ${agent.name} workflow`}
              >
                <div className={`agent-status ${agent.status}`}></div>
                <div className="agent-info">
                  <div className="agent-name">{agent.name}</div>
                  <div className="agent-role">{agent.role}</div>
                </div>
                <span className="agent-card-action">{agentWorkflowLoadingId === agent.id ? 'Loading' : 'Workflow'}</span>
              </button>
            ))}
            {agents.length > 0 && filteredAgents.length === 0 && (
              <div className="sidebar-session-empty">No agents match that search.</div>
            )}
          </div>
        </div>

        {/* Voice Status */}
        <div className="sidebar-section" style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
          <div className="sidebar-section-title">Voice Status</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '0 16px' }}>
            {conversationStatus === 'connected' && (
              <span style={{ color: 'var(--success)' }}>● Connected</span>
            )}
            {conversationStatus === 'connecting' && (
              <span style={{ color: 'var(--warning)' }}>● Connecting...</span>
            )}
            {conversationStatus === 'disconnected' && (
              <span style={{ color: 'var(--text-secondary)' }}>○ Disconnected</span>
            )}
            {conversationStatus === 'error' && (
              <span style={{ color: 'var(--danger)' }}>● Error</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`main-content ${!sidebarCollapsed ? 'with-left-sidebar' : ''} ${showContextPanel ? 'with-right-panel' : ''}`}>
        <div className="chat-header">
          <div className="chat-title-group">
            <div className="chat-title">{currentSession?.name || PRODUCT_NAME}</div>
            <div className="chat-title-meta">
              {sessions.length} session{sessions.length === 1 ? '' : 's'} · {activeSurfaceTabId === 'chat' ? 'chat surface' : 'workspace surface'}
            </div>
            {offlineModeEnabled && (
              <div className="chat-status-pills">
                <div className={`chat-status-pill ${ollamaStatusTone}`}>
                  <Icon name={ollamaStatusIcon} size={12} />
                  <span>Offline Text Chat</span>
                  <span className="chat-status-pill-separator">·</span>
                  <span>{ollamaStatusLabel}</span>
                </div>
              </div>
            )}
          </div>
          <div className="chat-tools">
            <button
              className="header-action-button session-toggle-button"
              onClick={() => void openDiaryViewer()}
              title="Open the Emergent Diary"
            >
              Diary
            </button>
            <button
              className={`header-action-button ${showUsageViewer ? 'active' : ''}`}
              onClick={() => void openUsageViewer()}
              title="Open usage statistics for tokens, credits, and provider activity"
            >
              Statistics
            </button>
            <button
              className="header-action-button"
              onClick={() => void openRollingTodoModal()}
              disabled={!currentSession}
              title="Open the agent-managed task queue board"
            >
              Task Queue
            </button>
            <button
              className="header-action-button"
              onClick={() => void openEntityCrm()}
              title="View all entities in the knowledge base"
            >
              Entity CRM
            </button>
            <button
              className="header-action-button"
              onClick={() => void generateSessionBriefing()}
              disabled={!currentSession || isGeneratingBriefing}
              title="Generate an organized briefing for this session"
            >
              {isGeneratingBriefing ? 'Briefing…' : 'Create Briefing'}
            </button>
            <button
              className="header-action-button"
              onClick={() => void openBugReportViewer()}
              title="View current Nexus bugs and export a bug report PDF"
            >
              Bugs
            </button>
            <button
              className="header-action-button"
              onClick={() => void exportCurrentSessionPdf()}
              disabled={!currentSession || isExportingSession}
              title="Export this session as PDF"
            >
              {isExportingSession ? 'Exporting…' : 'Export PDF'}
            </button>
            <button className="icon-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title="Toggle sidebar"><Icon name="menu" size={18} /></button>
            <button className={`icon-button ${showContextPanel ? 'active' : ''}`} onClick={() => setShowContextPanel(!showContextPanel)} title="Toggle context panel"><Icon name="info" size={18} /></button>
            <button className="icon-button" onClick={() => setShowSettings(true)} title="Settings"><Icon name="settings" size={18} /></button>
          </div>
        </div>

        <div className="surface-tab-strip">
          {surfaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`surface-tab ${activeSurfaceTabId === tab.id ? 'active' : ''}`}
              onClick={() => setActiveSurfaceTabId(tab.id)}
              title={tab.id === 'chat' ? 'Open the original Nexus conversation surface' : 'Open the staged Nexus workspace surface'}
            >
              <Icon name={tab.icon} size={14} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {activeSurfaceTabId === 'workspace' && (
          <div className="workspace-stage-container">
            <div className="workspace-voice-rail">
              <div className="workspace-voice-copy">
                <div className="workspace-voice-kicker">Workspace Voice</div>
                <div className="workspace-voice-title">
                  {conversationStatus === 'connected' ? 'Nexus is live in this workspace' : 'Talk to Nexus while you stage the workspace'}
                </div>
                <div className="workspace-voice-detail">
                  {conversationStatus === 'connected'
                    ? voiceStatusDetail
                    : 'Use voice or the composer below while you inspect assets, pipelines, sources, and CRM context.'}
                </div>
              </div>
              <div className="workspace-voice-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={conversationStatus === 'connected' ? () => void endConversation() : () => void startConversation()}
                >
                  {conversationStatus === 'connected' ? 'End Voice' : 'Start Voice'}
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => setActiveSurfaceTabId('chat')}
                >
                  Open Chat
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void openWorkflowBuilder()}
                >
                  Workflow Builder
                </button>
                {!isElevenLabsConfigured && (
                  <button
                    type="button"
                    className="mission-card-action"
                    onClick={() => setShowSettings(true)}
                  >
                    Configure Voice
                  </button>
                )}
              </div>
            </div>
            <div className="workspace-stage-tab-strip">
              {workspaceStageTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`workspace-stage-tab ${activeWorkspaceStageTabId === tab.id ? 'active' : ''}`}
                  onClick={() => activateWorkspaceStageTab(tab)}
                  title={tab.label}
                >
                  <span className="workspace-stage-tab-copy">
                    <Icon name={tab.icon} size={13} />
                    <span>{tab.label}</span>
                  </span>
                  {tab.closable && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="workspace-stage-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeWorkspaceStageTab(tab.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          closeWorkspaceStageTab(tab.id);
                        }
                      }}
                      aria-label={`Close ${tab.label}`}
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}
            </div>

            {activeWorkspaceStageTab.type === 'mission' ? (
            <div className="mission-control-shell">
            <div className="mission-control-grid">
            <section className="mission-card mission-card-overview">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="compass" size={14} />
                  <span>Mission Control</span>
                </div>
                <div className={`mission-status-pill ${missionSystemStatus.tone}`}>
                  {missionSystemStatus.label}
                </div>
              </div>

              <div className="mission-overview-copy">
                <div>
                  <div className="mission-card-title">
                    {currentProject?.name || currentSession?.name || PRODUCT_NAME}
                  </div>
                  <div className="mission-card-description">
                    {truncateDisplayText(missionControlNarrative, 220)}
                  </div>
                </div>
                <div className="mission-card-note">{missionSystemStatus.detail}</div>
              </div>

              <div className="mission-metric-grid">
                {missionControlMetrics.map((metric) => (
                  <div key={metric.label} className={`mission-metric-card ${metric.tone}`}>
                    <span className="mission-metric-label">{metric.label}</span>
                    <strong className="mission-metric-value">{metric.value}</strong>
                  </div>
                ))}
              </div>

              {Array.isArray(currentProject?.topics) && currentProject.topics.length > 0 && (
                <div className="mission-topic-row">
                  {currentProject.topics.slice(0, 6).map((topic) => (
                    <span key={topic} className="mission-topic-tag">{topic}</span>
                  ))}
                </div>
              )}

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => void openProjectViewer()}
                  disabled={!currentProject}
                >
                  Open Project
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void openRollingTodoModal()}
                  disabled={!currentSession}
                >
                  Task Queue
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void openEntityCrm()}
                >
                  Entity CRM
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void generateSessionBriefing()}
                  disabled={!currentSession || isGeneratingBriefing}
                >
                  {isGeneratingBriefing ? 'Briefing…' : 'Create Briefing'}
                </button>
              </div>
            </section>

            <section className="mission-card">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="cpu" size={14} />
                  <span>Execution Watch</span>
                </div>
                <div className="mission-card-mini-stat">
                  {activeToolMessages.length > 0 ? `${activeToolMessages.length} live` : `${recentToolNames.length} recent`}
                </div>
              </div>

              <div className="mission-card-body">
                <div className="mission-card-highlight">
                  {runningAgents.length > 0
                    ? `${runningAgents.length} running agent${runningAgents.length === 1 ? '' : 's'}`
                    : 'No agents actively running'}
                </div>
                <div className="mission-card-supporting">
                  {erroredAgents.length > 0
                    ? `${erroredAgents.length} agent${erroredAgents.length === 1 ? '' : 's'} need inspection before the next autonomous pass.`
                    : truncateDisplayText(missionSystemStatus.detail, 130)}
                </div>

                <div className="mission-tag-cluster">
                  {recentToolNames.slice(0, 5).map((toolName) => (
                    <span key={toolName} className="mission-inline-tag">
                      <Icon name={getToolIconName(toolName)} size={11} />
                      {toolName}
                    </span>
                  ))}
                  {recentToolNames.length === 0 && (
                    <span className="mission-inline-tag muted">Awaiting first live tool call</span>
                  )}
                </div>
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => missionPrimaryAgent && void openAgentWorkflow(missionPrimaryAgent)}
                  disabled={!missionPrimaryAgent}
                >
                  {missionPrimaryAgent ? `Inspect ${missionPrimaryAgent.name}` : 'Inspect Agents'}
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void openBugReportViewer()}
                >
                  Open Bugs
                </button>
              </div>
            </section>

            <section className="mission-card">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="clipboard" size={14} />
                  <span>Task Queue</span>
                </div>
                <div className="mission-card-mini-stat">
                  {rollingTodoBoard ? 'Agent-managed' : 'Session-derived'}
                </div>
              </div>

              <div className="mission-card-body">
                {missionQueueSnapshot.primary ? (
                  <>
                    <div className="mission-card-highlight">
                      {missionQueueSnapshot.primary.title}
                    </div>
                    <div className="mission-card-supporting">
                      {truncateDisplayText(
                        missionQueueSnapshot.primary.supporting || 'No next action has been written yet.',
                        150,
                      )}
                    </div>
                    <div className="mission-status-row">
                      <span className={`mission-inline-tag status-${missionQueueSnapshot.primary.status}`}>
                        {missionQueueSnapshot.primary.status.replace(/_/g, ' ')}
                      </span>
                      {missionQueueSnapshot.primary.needsUser && (
                        <span className="mission-inline-tag status-blocked">Needs user</span>
                      )}
                      <span className="mission-inline-tag muted">
                        {missionQueueSnapshot.primary.owner} owned
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mission-card-highlight">No queued moves yet</div>
                    <div className="mission-card-supporting">
                      Start a session or let Nexus derive the next top moves from current work.
                    </div>
                  </>
                )}

                <div className="mission-mini-metrics">
                  <div><span>Ready</span><strong>{missionQueueSnapshot.counts.ready}</strong></div>
                  <div><span>Blocked</span><strong>{missionQueueSnapshot.counts.blocked}</strong></div>
                  <div><span>In Progress</span><strong>{missionQueueSnapshot.counts.in_progress}</strong></div>
                  <div><span>Done</span><strong>{missionQueueSnapshot.counts.done}</strong></div>
                </div>
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => void openRollingTodoModal()}
                  disabled={!currentSession}
                >
                  Open Queue
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void exportRollingTodoPdf()}
                  disabled={!currentSession || isRollingTodoExporting}
                >
                  {isRollingTodoExporting ? 'Exporting…' : 'Export'}
                </button>
              </div>
            </section>

            <section className="mission-card">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="gitBranch" size={14} />
                  <span>Pipeline Watch</span>
                </div>
                <div className={`mission-card-mini-stat ${
                  missionPipelineSpotlight?.hasError
                    ? 'warning'
                    : missionPipelineSpotlight?.hasActive
                      ? 'live'
                      : ''
                }`}>
                  {missionPipelineSpotlight
                    ? missionPipelineSpotlight.hasError
                      ? 'Issue'
                      : missionPipelineSpotlight.hasActive
                        ? 'Running'
                        : 'Ready'
                    : 'Idle'}
                </div>
              </div>

              <div className="mission-card-body">
                {missionPipelineSpotlight ? (
                  <>
                    <div className="mission-card-highlight">{missionPipelineSpotlight.pipeline.name}</div>
                    <div className="mission-progress-shell">
                      <div
                        className={`mission-progress-bar ${
                          missionPipelineSpotlight.hasError ? 'warning' : missionPipelineSpotlight.hasActive ? 'live' : ''
                        }`}
                        style={{ width: `${missionPipelineSpotlight.pipeline.progress}%` }}
                      />
                    </div>
                    <div className="mission-progress-meta">
                      <span>{missionPipelineSpotlight.pipeline.progress}% complete</span>
                      <span>
                        {missionPipelineSpotlight.completedStages}/{missionPipelineSpotlight.pipeline.stages.length} stages
                      </span>
                    </div>
                    <div className="mission-stage-row">
                      {missionPipelineSpotlight.pipeline.stages.slice(0, 5).map((stage) => (
                        <span key={`${missionPipelineSpotlight.pipeline.id}-${stage.name}`} className={`mission-stage-chip ${stage.status}`}>
                          {stage.name}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mission-card-highlight">No active pipelines</div>
                    <div className="mission-card-supporting">
                      Pipelines will stage here once the current project begins branching work into inspectable runs.
                    </div>
                  </>
                )}
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => missionPipelineSpotlight && setPipelineViewer(missionPipelineSpotlight.pipeline)}
                  disabled={!missionPipelineSpotlight}
                >
                  Inspect Pipeline
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => void openProjectViewer()}
                  disabled={!currentProject}
                >
                  Project View
                </button>
              </div>
            </section>

            <section className="mission-card">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="folder" size={14} />
                  <span>Asset Dock</span>
                </div>
                <div className="mission-card-mini-stat">
                  {missionArtifactSpotlight ? missionArtifactSpotlight.kind : `${workspaceFiles.length} files`}
                </div>
              </div>

              <div className="mission-card-body">
                {missionArtifactSpotlight ? (
                  <>
                    <div className="mission-card-highlight">{missionArtifactSpotlight.name}</div>
                    <div className="mission-card-supporting">
                      {formatPathForPanel(missionArtifactSpotlight.path, 5)}
                    </div>
                    <div className="mission-status-row">
                      <span className="mission-inline-tag">{missionArtifactSpotlight.kind}</span>
                      <span className="mission-inline-tag muted">
                        Ready to stage in viewer
                      </span>
                    </div>
                  </>
                ) : missionWorkspaceFallback ? (
                  <>
                    <div className="mission-card-highlight">{missionWorkspaceFallback.name}</div>
                    <div className="mission-card-supporting">
                      {formatPathForPanel(missionWorkspaceFallback.path, 5)}
                    </div>
                    <div className="mission-status-row">
                      <span className="mission-inline-tag muted">Workspace file</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mission-card-highlight">No staged deliverables yet</div>
                    <div className="mission-card-supporting">
                      Generated assets, PDFs, images, spreadsheets, and source files will appear here as soon as they land.
                    </div>
                  </>
                )}

                <div className="mission-mini-metrics">
                  <div><span>Artifacts</span><strong>{workingSetArtifactReferences.length}</strong></div>
                  <div><span>Workspace Files</span><strong>{workspaceFiles.length}</strong></div>
                  <div><span>Knowledge Docs</span><strong>{knowledgeDocuments.length}</strong></div>
                </div>
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => missionArtifactSpotlight && void openArtifactViewer(missionArtifactSpotlight)}
                  disabled={!missionArtifactSpotlight}
                >
                  Open Asset
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => missionWorkspaceFallback && void openMissionWorkspaceFile(missionWorkspaceFallback)}
                  disabled={!missionWorkspaceFallback}
                >
                  Reveal / Preview
                </button>
              </div>
            </section>

            <section className="mission-card mission-card-knowledge">
              <div className="mission-card-header mission-card-header-stack">
                <div className="mission-card-kicker">
                  <Icon name="users" size={14} />
                  <span>Knowledge Scope</span>
                </div>
                <div className="mission-card-mini-stat mission-card-mini-stat-stack">
                  {(crmSessionContext?.relationships.length || 0)} links
                </div>
              </div>

              <div className="mission-card-body">
                {missionEntitySpotlight ? (
                  <>
                    <div className="mission-card-highlight">
                      {missionEntitySpotlight.entity.full_name || missionEntitySpotlight.entity.name || 'Entity in focus'}
                    </div>
                    <div className="mission-card-supporting">
                      {truncateDisplayText(
                        [
                          missionEntitySpotlight.entity.title,
                          missionEntitySpotlight.entity.company,
                          missionEntitySpotlight.entity.industry,
                          missionEntitySpotlight.entity.location,
                        ].filter(Boolean).join(' — ') || 'Entity context is available for focused chat and source review.',
                        150,
                      )}
                    </div>
                    <div className="mission-detail-list">
                      <div className="mission-detail-row">
                        <span className="mission-detail-label">Entity Type</span>
                        <strong className="mission-detail-value">{missionEntitySpotlight.type}</strong>
                      </div>
                      <div className="mission-detail-row">
                        <span className="mission-detail-label">Sources</span>
                        <strong className="mission-detail-value">
                          {missionEntitySpotlight.entity.documentCount || 0} docs · {missionEntitySpotlight.entity.artifactCount || 0} artifacts
                        </strong>
                      </div>
                    </div>
                  </>
                ) : missionKnowledgeSpotlight ? (
                  <>
                    <div className="mission-card-highlight">
                      {missionKnowledgeSpotlight.title || 'Knowledge document'}
                    </div>
                    <div className="mission-card-supporting">
                      {truncateDisplayText(
                        missionKnowledgeSpotlight.preview || missionKnowledgeSpotlight.artifactPath || 'Knowledge is available for focused retrieval.',
                        150,
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mission-card-highlight">Context is still thin</div>
                    <div className="mission-card-supporting">
                      Ingest files, open CRM entities, or work the session longer and Nexus will surface the relevant facts here.
                    </div>
                  </>
                )}

                <div className="mission-mini-metrics mission-mini-metrics-stack">
                  <div>
                    <span>People</span>
                    <strong>{crmSessionContext?.people.length || 0}</strong>
                  </div>
                  <div>
                    <span>Businesses</span>
                    <strong>{crmSessionContext?.businesses.length || 0}</strong>
                  </div>
                  <div>
                    <span>Docs</span>
                    <strong>{knowledgeDocuments.length}</strong>
                  </div>
                </div>
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => {
                    if (missionEntitySpotlight) {
                      void focusCrmEntity(missionEntitySpotlight.entity, missionEntitySpotlight.type);
                      return;
                    }
                    void openEntityCrm();
                  }}
                >
                  {missionEntitySpotlight ? 'Focus Entity' : 'Open CRM'}
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => missionKnowledgeSpotlight && void openKnowledgeDocument(missionKnowledgeSpotlight.id)}
                  disabled={!missionKnowledgeSpotlight}
                >
                  Open Source
                </button>
              </div>
            </section>

            <section className="mission-card">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="fileText" size={14} />
                  <span>Agreeable Agreements</span>
                </div>
                <div className={`mission-card-mini-stat ${lastLegalAnalysisReport ? 'live' : ''}`}>
                  {lastLegalAnalysisReport ? `${lastLegalAnalysisReport.readinessScore}% ready` : 'Agreeable Agreements'}
                </div>
              </div>

              <div className="mission-card-body">
                <div className="mission-card-highlight">
                  {lastLegalAnalysisReport
                    ? lastLegalAnalysisReport.sourceTitle
                    : 'Run Agreeable Agreements contract review inside Nexus'}
                </div>
                <div className="mission-card-supporting">
                  {lastLegalAnalysisReport
                    ? `${lastLegalAnalysisReport.summary.red} red, ${lastLegalAnalysisReport.summary.yellow} yellow, ${lastLegalAnalysisReport.summary.green} green across ${lastLegalAnalysisReport.summary.total} clause${lastLegalAnalysisReport.summary.total === 1 ? '' : 's'}.`
                    : 'Upload a document, analyze a URL, search the web for a source, or pick an existing knowledge document and Nexus will generate the legal report in the workstation.'}
                </div>
                {lastLegalAnalysisReport?.analysisWarnings?.length ? (
                  <div className="mission-card-supporting mission-legal-warning-copy">
                    {lastLegalAnalysisReport.analysisWarnings[0]}
                  </div>
                ) : null}

                {lastLegalAnalysisReport && (
                  <div className="mission-mini-metrics">
                    <div><span>Red</span><strong>{lastLegalAnalysisReport.summary.red}</strong></div>
                    <div><span>Yellow</span><strong>{lastLegalAnalysisReport.summary.yellow}</strong></div>
                    <div><span>Green</span><strong>{lastLegalAnalysisReport.summary.green}</strong></div>
                    <div><span>Ready</span><strong>{lastLegalAnalysisReport.readinessScore}%</strong></div>
                  </div>
                )}

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="legal-doc-select">Analyze existing knowledge document</label>
                  <div className="mission-tool-row">
                    <select
                      id="legal-doc-select"
                      className="mission-tool-select"
                      value={selectedLegalDocumentId}
                      onChange={(event) => setSelectedLegalDocumentId(event.target.value)}
                      disabled={!currentSession || isLegalAnalyzing || legalAnalyzableDocuments.length === 0}
                    >
                      {legalAnalyzableDocuments.length === 0 ? (
                        <option value="">No source documents in this session yet</option>
                      ) : legalAnalyzableDocuments.map((document) => (
                        <option key={document.id} value={document.id}>
                          {document.title || 'Untitled document'}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="mission-card-action primary"
                      onClick={() => void analyzeSelectedLegalDocument()}
                      disabled={!currentSession || !selectedLegalDocumentId || isLegalAnalyzing}
                    >
                      {isLegalAnalyzing ? 'Analyzing…' : 'Analyze Selected'}
                    </button>
                  </div>

                  <div className="mission-tool-row">
                    <button
                      type="button"
                      className="mission-card-action"
                      onClick={() => void pickAndAnalyzeLegalUpload()}
                      disabled={!currentSession || isLegalAnalyzing}
                    >
                      {isLegalAnalyzing ? 'Analyzing…' : 'Upload & Analyze'}
                    </button>
                    <button
                      type="button"
                      className="mission-card-action"
                      onClick={() => lastLegalAnalysisReport?.sourceDocumentId && void openKnowledgeDocument(lastLegalAnalysisReport.sourceDocumentId)}
                      disabled={!lastLegalAnalysisReport?.sourceDocumentId}
                    >
                      Open Source
                    </button>
                  </div>
                </div>

                <div className="mission-tool-divider" />

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="legal-url-input">Analyze document by URL</label>
                  <div className="mission-tool-row">
                    <input
                      id="legal-url-input"
                      className="mission-tool-input"
                      type="url"
                      value={legalUrlInput}
                      onChange={(event) => setLegalUrlInput(event.target.value)}
                      placeholder="https://example.com/agreement"
                      disabled={!currentSession || isLegalAnalyzing}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void analyzeLegalUrl(legalUrlInput);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="mission-card-action primary"
                      onClick={() => void analyzeLegalUrl(legalUrlInput)}
                      disabled={!currentSession || !legalUrlInput.trim() || isLegalAnalyzing}
                    >
                      {isLegalAnalyzing ? 'Analyzing…' : 'Analyze URL'}
                    </button>
                  </div>
                </div>

                <div className="mission-tool-divider" />

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="legal-web-search">Find one online in Nexus</label>
                  <div className="mission-tool-row">
                    <input
                      id="legal-web-search"
                      className="mission-tool-input"
                      type="text"
                      value={legalWebSearchQuery}
                      onChange={(event) => setLegalWebSearchQuery(event.target.value)}
                      placeholder="Search for a public contract, policy, or terms page"
                      disabled={isLegalWebSearching || isLegalAnalyzing}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void runLegalWebSearch();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="mission-card-action"
                      onClick={() => void runLegalWebSearch()}
                      disabled={!legalWebSearchQuery.trim() || isLegalWebSearching || isLegalAnalyzing}
                    >
                      {isLegalWebSearching ? 'Searching…' : 'Search Web'}
                    </button>
                  </div>
                  {legalWebSearchResults.length > 0 && (
                    <div className="mission-legal-results">
                      {legalWebSearchResults.slice(0, 4).map((result) => (
                        <div key={`${result.url}-${result.title}`} className="mission-legal-result">
                          <div className="mission-legal-result-copy">
                            <div className="mission-legal-result-title">{result.title || result.url}</div>
                            <div className="mission-legal-result-url">{result.url}</div>
                            <div className="mission-legal-result-snippet">{result.snippet || 'No description provided.'}</div>
                          </div>
                          <button
                            type="button"
                            className="mission-card-action primary"
                            onClick={() => void analyzeLegalUrl(result.url, result.title)}
                            disabled={!currentSession || isLegalAnalyzing}
                          >
                            {isLegalAnalyzing ? 'Analyzing…' : 'Analyze'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action primary"
                  onClick={() => lastLegalAnalysisReport && stageLegalReportInWorkspace(lastLegalAnalysisReport)}
                  disabled={!lastLegalAnalysisReport}
                >
                  Open Review
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => lastLegalAnalysisReport && void openArtifactViewer({
                    path: lastLegalAnalysisReport.pdfPath,
                    kind: 'pdf',
                    name: `${lastLegalAnalysisReport.reportTitle || 'Agreeable Agreements Report'} PDF`,
                  })}
                  disabled={!lastLegalAnalysisReport?.pdfPath}
                >
                  Open PDF
                </button>
              </div>
            </section>

            <section className="mission-card">
              <div className="mission-card-header">
                <div className="mission-card-kicker">
                  <Icon name="play" size={14} />
                  <span>Media Intelligence</span>
                </div>
                <div className={`mission-card-mini-stat ${mediaStatus?.stats?.totalChunks ? 'live' : ''}`}>
                  {mediaStatus?.stats?.totalChunks ? `${mediaStatus.stats.totalChunks} chunks` : 'Video search'}
                </div>
              </div>

              <div className="mission-card-body">
                <div className="mission-card-highlight">
                  {mediaStatus?.stats?.uniqueSourceFiles
                    ? `${mediaStatus.stats.uniqueSourceFiles} indexed source file${mediaStatus.stats.uniqueSourceFiles === 1 ? '' : 's'}`
                    : 'Index workspace videos, search them semantically, clip matches, stitch montages, and render narrated slideshows.'}
                </div>
                <div className="mission-card-supporting">
                  {mediaStatus?.geminiConfigured
                    ? `Semantic retrieval is ready with ${mediaStatus.backend || mediaBackend}${mediaStatus.model ? ` / ${mediaStatus.model}` : ''}.`
                    : mediaBackend === 'gemini'
                      ? 'Add a Gemini API key in Settings to use SentrySearch semantic video retrieval, or switch to the local backend.'
                      : 'Local backend selected. First-time indexing may download a large local model.'}
                </div>

                <div className="mission-mini-metrics">
                  <div><span>Indexed Files</span><strong>{mediaStatus?.stats?.uniqueSourceFiles || 0}</strong></div>
                  <div><span>Indexed Chunks</span><strong>{mediaStatus?.stats?.totalChunks || 0}</strong></div>
                  <div><span>Workspace Videos</span><strong>{workspaceVideoFiles.length}</strong></div>
                  <div><span>Workspace Images</span><strong>{workspaceImageFiles.length}</strong></div>
                </div>

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="media-backend-select">Semantic video indexing</label>
                  <div className="mission-tool-row">
                    <select
                      id="media-backend-select"
                      className="mission-tool-select"
                      value={mediaBackend}
                      onChange={(event) => setMediaBackend(event.target.value === 'local' ? 'local' : 'gemini')}
                      disabled={isMediaIndexing || isMediaSearching}
                    >
                      <option value="gemini">Gemini backend</option>
                      <option value="local">Local Qwen backend</option>
                    </select>
                    <input
                      className="mission-tool-input"
                      type="text"
                      value={mediaModel}
                      onChange={(event) => setMediaModel(event.target.value)}
                      placeholder={mediaBackend === 'local' ? 'Optional local model, e.g. qwen2b' : 'Optional model override'}
                      disabled={isMediaIndexing || isMediaSearching}
                    />
                  </div>
                  <select
                    className="mission-tool-select mission-tool-multiselect"
                    multiple
                    value={selectedMediaVideoPaths}
                    onChange={(event) => setSelectedMediaVideoPaths(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
                    disabled={workspaceVideoFiles.length === 0 || isMediaIndexing}
                  >
                    {workspaceVideoFiles.length === 0 ? (
                      <option value="">No video artifacts are in the workspace yet</option>
                    ) : workspaceVideoFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <div className="mission-tool-row">
                    <button
                      type="button"
                      className="mission-card-action primary"
                      onClick={() => void indexSelectedMediaVideos()}
                      disabled={selectedMediaVideoPaths.length === 0 || isMediaIndexing}
                    >
                      {isMediaIndexing ? 'Indexing…' : 'Index Selected Videos'}
                    </button>
                    <button
                      type="button"
                      className="mission-card-action"
                      onClick={() => void loadMediaStatus()}
                      disabled={isLoadingMediaStatus}
                    >
                      {isLoadingMediaStatus ? 'Refreshing…' : 'Refresh Status'}
                    </button>
                  </div>
                </div>

                <div className="mission-tool-divider" />

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="media-search-query">Find parts of videos</label>
                  <div className="mission-tool-row">
                    <input
                      id="media-search-query"
                      className="mission-tool-input"
                      type="text"
                      value={mediaSearchQuery}
                      onChange={(event) => setMediaSearchQuery(event.target.value)}
                      placeholder="red truck entering frame, product close-up, person walking into office"
                      disabled={isMediaSearching}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void runMediaVideoSearch();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="mission-card-action primary"
                      onClick={() => void runMediaVideoSearch()}
                      disabled={!mediaSearchQuery.trim() || isMediaSearching}
                    >
                      {isMediaSearching ? 'Searching…' : 'Search Video'}
                    </button>
                  </div>
                  {mediaSearchResults.length > 0 && (
                    <div className="mission-media-results">
                      {mediaSearchResults.map((result) => (
                        <div key={`${result.sourceFile}-${result.startTime}-${result.endTime}`} className="mission-media-result">
                          <div className="mission-media-result-copy">
                            <div className="mission-media-result-title">{result.sourceName}</div>
                            <div className="mission-media-result-meta">
                              {formatSecondsLabel(result.startTime)} - {formatSecondsLabel(result.endTime)} · {(result.similarityScore * 100).toFixed(1)}% match
                            </div>
                            <div className="mission-media-result-url">{result.sourceFile}</div>
                          </div>
                          <div className="mission-media-result-actions">
                            <button
                              type="button"
                              className="mission-card-action"
                              onClick={() => void openArtifactViewer({ path: result.sourceFile, kind: 'video', name: result.sourceName })}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="mission-card-action primary"
                              onClick={() => void clipMediaSearchResult(result)}
                              disabled={!currentSession}
                            >
                              Clip Match
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mission-tool-divider" />

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="media-stitch-title">Stitch clips into a new video</label>
                  <input
                    id="media-stitch-title"
                    className="mission-tool-input"
                    type="text"
                    value={mediaStitchTitle}
                    onChange={(event) => setMediaStitchTitle(event.target.value)}
                    placeholder="Workspace Montage"
                    disabled={isMediaStitching}
                  />
                  <select
                    className="mission-tool-select mission-tool-multiselect"
                    multiple
                    value={selectedStitchVideoPaths}
                    onChange={(event) => setSelectedStitchVideoPaths(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
                    disabled={workspaceVideoFiles.length === 0 || isMediaStitching}
                  >
                    {workspaceVideoFiles.length === 0 ? (
                      <option value="">No video clips are available yet</option>
                    ) : workspaceVideoFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="mission-card-action primary"
                    onClick={() => void stitchSelectedMediaVideos()}
                    disabled={selectedStitchVideoPaths.length < 2 || isMediaStitching}
                  >
                    {isMediaStitching ? 'Stitching…' : 'Create Montage'}
                  </button>
                </div>

                <div className="mission-tool-divider" />

                <div className="mission-tool-stack">
                  <label className="mission-tool-label" htmlFor="media-slideshow-title">Narration over images</label>
                  <input
                    id="media-slideshow-title"
                    className="mission-tool-input"
                    type="text"
                    value={mediaSlideshowTitle}
                    onChange={(event) => setMediaSlideshowTitle(event.target.value)}
                    placeholder="Narrated Slideshow"
                    disabled={isMediaRendering}
                  />
                  <select
                    className="mission-tool-select mission-tool-multiselect"
                    multiple
                    value={selectedSlideshowImagePaths}
                    onChange={(event) => setSelectedSlideshowImagePaths(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
                    disabled={workspaceImageFiles.length === 0 || isMediaRendering}
                  >
                    {workspaceImageFiles.length === 0 ? (
                      <option value="">No images are in the workspace yet</option>
                    ) : workspaceImageFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="mission-tool-input mission-tool-textarea"
                    value={mediaNarrationText}
                    onChange={(event) => setMediaNarrationText(event.target.value)}
                    placeholder="Optional narration script. Leave blank and Nexus will draft narration from the selected images."
                    disabled={isMediaRendering}
                  />
                  <button
                    type="button"
                    className="mission-card-action primary"
                    onClick={() => void createNarratedMediaSlideshow()}
                    disabled={selectedSlideshowImagePaths.length === 0 || isMediaRendering}
                  >
                    {isMediaRendering ? 'Rendering…' : 'Create Narrated Video'}
                  </button>
                </div>
              </div>

              <div className="mission-card-actions">
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => workspaceVideoFiles[0] && void openArtifactViewer({ path: workspaceVideoFiles[0].path, kind: 'video', name: workspaceVideoFiles[0].name })}
                  disabled={workspaceVideoFiles.length === 0}
                >
                  Open Latest Video
                </button>
                <button
                  type="button"
                  className="mission-card-action"
                  onClick={() => workspaceImageFiles[0] && void openArtifactViewer({ path: workspaceImageFiles[0].path, kind: 'image', name: workspaceImageFiles[0].name })}
                  disabled={workspaceImageFiles.length === 0}
                >
                  Open Latest Image
                </button>
              </div>
            </section>
            </div>
          </div>
            ) : activeWorkspaceStageTab.type === 'tutorials' ? (
              <div className="workspace-stage-viewer">
                <div className="artifact-viewer-header workspace-stage-header">
                  <div>
                    <div className="artifact-viewer-title">Tutorials</div>
                    <div className="artifact-viewer-subtitle">Built-in setup, dependency, workspace, legal, and media guidance</div>
                  </div>
                  <div className="artifact-viewer-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => playTutorial(activeWorkspaceStageTab.tutorialId)}
                    >
                      {activeTutorialPlaybackId === activeWorkspaceStageTab.tutorialId ? 'Stop Audio' : 'Play Audio'}
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => setWorkspacePresenterOpen(true)}
                    >
                      Present
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                    >
                      Close Tab
                    </button>
                  </div>
                </div>
                <div className="artifact-viewer-body workspace-stage-body">
                  {renderTutorialWorkspaceContent(activeWorkspaceStageTab.tutorialId)}
                </div>
              </div>
            ) : activeWorkspaceStageTab.type === 'artifact' ? (
              <div className="workspace-stage-viewer">
                <div className="artifact-viewer-header workspace-stage-header">
                  <div>
                    <div className="artifact-viewer-title">{activeWorkspaceStageTab.artifact.name}</div>
                    <div className="artifact-viewer-subtitle">{activeWorkspaceStageTab.artifact.path}</div>
                  </div>
                  <div className="artifact-viewer-actions">
                    {activeWorkspaceStageTab.artifact.kind === 'text' && (
                      <button
                        className="artifact-action-button"
                        onClick={() => void copyTextValue(
                          activeWorkspaceStageTab.artifact.textContent || '',
                          `workspace-artifact-text:${activeWorkspaceStageTab.artifact.path}`
                        )}
                        disabled={!String(activeWorkspaceStageTab.artifact.textContent || '').trim()}
                      >
                        {copiedTextKey === `workspace-artifact-text:${activeWorkspaceStageTab.artifact.path}` ? 'Copied' : 'Copy Text'}
                      </button>
                    )}
                    <button
                      className="artifact-action-button"
                      onClick={() => void revealArtifact(activeWorkspaceStageTab.artifact.path)}
                    >
                      Reveal File
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => setWorkspacePresenterOpen(true)}
                    >
                      Present
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                    >
                      Close Tab
                    </button>
                  </div>
                </div>
                <div className="artifact-viewer-body workspace-stage-body">
                  {renderArtifactViewerContent(activeWorkspaceStageTab.artifact)}
                </div>
              </div>
            ) : activeWorkspaceStageTab.type === 'legal-report' ? (
              <div className="workspace-stage-viewer">
                <div className="artifact-viewer-header workspace-stage-header">
                  <div>
                    <div className="artifact-viewer-title">{activeWorkspaceStageTab.report.reportTitle}</div>
                    <div className="artifact-viewer-subtitle">{activeWorkspaceStageTab.report.sourceLabel || activeWorkspaceStageTab.report.sourceTitle}</div>
                  </div>
                  <div className="artifact-viewer-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => activeWorkspaceStageTab.report.sourceDocumentId && void openKnowledgeDocument(activeWorkspaceStageTab.report.sourceDocumentId)}
                      disabled={!activeWorkspaceStageTab.report.sourceDocumentId}
                    >
                      Open Source
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => void openArtifactViewer({
                        path: activeWorkspaceStageTab.report.markdownPath,
                        kind: 'text',
                        name: activeWorkspaceStageTab.report.reportTitle || 'Agreeable Agreements Report',
                      })}
                      disabled={!activeWorkspaceStageTab.report.markdownPath}
                    >
                      Open Markdown
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => void openArtifactViewer({
                        path: activeWorkspaceStageTab.report.pdfPath,
                        kind: 'pdf',
                        name: `${activeWorkspaceStageTab.report.reportTitle || 'Agreeable Agreements Report'} PDF`,
                      })}
                      disabled={!activeWorkspaceStageTab.report.pdfPath}
                    >
                      Open PDF
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => setWorkspacePresenterOpen(true)}
                    >
                      Present
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                    >
                      Close Tab
                    </button>
                  </div>
                </div>
                <div className="artifact-viewer-body workspace-stage-body">
                  {renderLegalReportViewerContent(activeWorkspaceStageTab.report)}
                </div>
              </div>
            ) : (
              <div className="workspace-stage-viewer">
                <div className="artifact-viewer-header workspace-stage-header">
                  <div>
                    <div className="artifact-viewer-title">{activeWorkspaceStageTab.viewer.title}</div>
                    <div className="artifact-viewer-subtitle">{activeWorkspaceStageTab.viewer.sourceUrl}</div>
                  </div>
                  <div className="artifact-viewer-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => window.open(activeWorkspaceStageTab.viewer.sourceUrl, '_blank', 'noopener,noreferrer')}
                    >
                      Open In YouTube
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => setWorkspacePresenterOpen(true)}
                    >
                      Present
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                    >
                      Close Tab
                    </button>
                  </div>
                </div>
                <div className="artifact-viewer-body workspace-stage-body">
                  <iframe
                    className="artifact-frame youtube-frame"
                    src={activeWorkspaceStageTab.viewer.embedUrl}
                    title={activeWorkspaceStageTab.viewer.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeSurfaceTabId === 'workspace' && workspacePresenterOpen && activeWorkspaceStageTab.type !== 'mission' && (
          <>
            <div className="workspace-presenter-overlay" onClick={() => setWorkspacePresenterOpen(false)}></div>
            <div className="workspace-presenter-modal">
              {activeWorkspaceStageTab.type === 'artifact' ? (
                <>
                  <div className="artifact-viewer-header workspace-presenter-header">
                    <div>
                      <div className="artifact-viewer-title">{activeWorkspaceStageTab.artifact.name}</div>
                      <div className="artifact-viewer-subtitle">{activeWorkspaceStageTab.artifact.path}</div>
                    </div>
                    <div className="artifact-viewer-actions">
                      {activeWorkspaceStageTab.artifact.kind === 'text' && (
                        <button
                          className="artifact-action-button"
                          onClick={() => void copyTextValue(
                            activeWorkspaceStageTab.artifact.textContent || '',
                            `workspace-presenter-artifact:${activeWorkspaceStageTab.artifact.path}`
                          )}
                          disabled={!String(activeWorkspaceStageTab.artifact.textContent || '').trim()}
                        >
                          {copiedTextKey === `workspace-presenter-artifact:${activeWorkspaceStageTab.artifact.path}` ? 'Copied' : 'Copy Text'}
                        </button>
                      )}
                      <button
                        className="artifact-action-button"
                        onClick={() => void revealArtifact(activeWorkspaceStageTab.artifact.path)}
                      >
                        Reveal File
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                      >
                        Close Tab
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => setWorkspacePresenterOpen(false)}
                      >
                        Close Presenter
                      </button>
                    </div>
                  </div>
                  <div className="artifact-viewer-body workspace-presenter-body">
                    {renderArtifactViewerContent(activeWorkspaceStageTab.artifact)}
                  </div>
                </>
              ) : activeWorkspaceStageTab.type === 'legal-report' ? (
                <>
                  <div className="artifact-viewer-header workspace-presenter-header">
                    <div>
                      <div className="artifact-viewer-title">{activeWorkspaceStageTab.report.reportTitle}</div>
                      <div className="artifact-viewer-subtitle">{activeWorkspaceStageTab.report.sourceLabel || activeWorkspaceStageTab.report.sourceTitle}</div>
                    </div>
                    <div className="artifact-viewer-actions">
                      <button
                        className="artifact-action-button"
                        onClick={() => activeWorkspaceStageTab.report.sourceDocumentId && void openKnowledgeDocument(activeWorkspaceStageTab.report.sourceDocumentId)}
                        disabled={!activeWorkspaceStageTab.report.sourceDocumentId}
                      >
                        Open Source
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => void openArtifactViewer({
                          path: activeWorkspaceStageTab.report.pdfPath,
                          kind: 'pdf',
                          name: `${activeWorkspaceStageTab.report.reportTitle || 'Agreeable Agreements Report'} PDF`,
                        })}
                        disabled={!activeWorkspaceStageTab.report.pdfPath}
                      >
                        Open PDF
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                      >
                        Close Tab
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => setWorkspacePresenterOpen(false)}
                      >
                        Close Presenter
                      </button>
                    </div>
                  </div>
                  <div className="artifact-viewer-body workspace-presenter-body">
                    {renderLegalReportViewerContent(activeWorkspaceStageTab.report)}
                  </div>
                </>
              ) : activeWorkspaceStageTab.type === 'tutorials' ? (
                <>
                  <div className="artifact-viewer-header workspace-presenter-header">
                    <div>
                      <div className="artifact-viewer-title">{getBuiltinTutorialById(activeWorkspaceStageTab.tutorialId)?.title || 'Tutorials'}</div>
                      <div className="artifact-viewer-subtitle">Built-in Nexus setup and workflow guidance</div>
                    </div>
                    <div className="artifact-viewer-actions">
                      <button
                        className="artifact-action-button"
                        onClick={() => playTutorial(activeWorkspaceStageTab.tutorialId)}
                      >
                        {activeTutorialPlaybackId === activeWorkspaceStageTab.tutorialId ? 'Stop Audio' : 'Play Audio'}
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                      >
                        Close Tab
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => setWorkspacePresenterOpen(false)}
                      >
                        Close Presenter
                      </button>
                    </div>
                  </div>
                  <div className="artifact-viewer-body workspace-presenter-body">
                    {renderTutorialWorkspaceContent(activeWorkspaceStageTab.tutorialId)}
                  </div>
                </>
              ) : (
                <>
                  <div className="artifact-viewer-header workspace-presenter-header">
                    <div>
                      <div className="artifact-viewer-title">{activeWorkspaceStageTab.viewer.title}</div>
                      <div className="artifact-viewer-subtitle">{activeWorkspaceStageTab.viewer.sourceUrl}</div>
                    </div>
                    <div className="artifact-viewer-actions">
                      <button
                        className="artifact-action-button"
                        onClick={() => window.open(activeWorkspaceStageTab.viewer.sourceUrl, '_blank', 'noopener,noreferrer')}
                      >
                        Open In YouTube
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => closeWorkspaceStageTab(activeWorkspaceStageTab.id)}
                      >
                        Close Tab
                      </button>
                      <button
                        className="artifact-action-button"
                        onClick={() => setWorkspacePresenterOpen(false)}
                      >
                        Close Presenter
                      </button>
                    </div>
                  </div>
                  <div className="artifact-viewer-body workspace-presenter-body">
                    <iframe
                      className="artifact-frame youtube-frame"
                      src={activeWorkspaceStageTab.viewer.embedUrl}
                      title={activeWorkspaceStageTab.viewer.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {activeSurfaceTabId === 'chat' && (
        <>
        {/* Messages / Conversation Area */}
        <div className={`messages-container ${showLandingExperience ? 'empty' : ''}`}>
          {showLandingExperience ? (
            <div className="voice-landing">
              <div className="voice-landing-panel">
                <div className="voice-landing-header">
                  <div className="voice-landing-kicker">EIG Nexus Original</div>
                  <div className={`voice-status-badge ${conversationStatus}`}>{voiceStatusTitle}</div>
                </div>

                <div className="voice-landing-grid">
                  <div className="voice-landing-copy">
                    <div className="voice-landing-title">{PRODUCT_NAME}</div>
                    <div className="voice-landing-subtitle">
                      Voice, research, and execution in one workspace.
                    </div>
                    <div className="voice-landing-note">{voiceStatusDetail}</div>

                    {!isElevenLabsConfigured && conversationStatus === 'disconnected' && (
                      <button
                        type="button"
                        className="voice-config-hint"
                        onClick={() => setShowSettings(true)}
                      >
                        Configure ElevenLabs to enable voice operations
                      </button>
                    )}

                    <div className="voice-action-row">
                      {!meetingModeActive && (
                        <button
                          type="button"
                          className="meeting-mode-button"
                          onClick={startMeetingMode}
                        >
                          Start Meeting Mode
                        </button>
                      )}
                      {meetingModeActive && (
                        <div className="meeting-mode-live">
                          <span className={`meeting-mode-indicator ${meetingModeStatus === 'generating' ? 'generating' : 'live'}`} />
                          <span className="meeting-mode-copy">
                            Meeting Mode {meetingModeStatus === 'generating' ? 'generating briefing assets' : 'listening live'}
                          </span>
                          <button
                            type="button"
                            className="meeting-mode-action"
                            onClick={presentMeetingSummary}
                          >
                            Present Summary
                          </button>
                          <button
                            type="button"
                            className="meeting-mode-action danger"
                            onClick={endMeetingMode}
                          >
                            End Meeting
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="voice-landing-control">
                    <button
                      type="button"
                      className={getOrbClass()}
                      onClick={conversationStatus === 'connected' ? () => void endConversation() : () => void startConversation()}
                      style={{ transform: `scale(${orbScale})` }}
                      aria-label={conversationStatus === 'connected' ? 'End voice conversation' : 'Start voice conversation'}
                    >
                      <div className="orb-inner">
                        <div className="orb-ring ring-1"></div>
                        <div className="orb-ring ring-2"></div>
                        <div className="orb-ring ring-3"></div>
                        <div className="orb-core">
                          {conversationStatus === 'disconnected' && <Icon name="mic" size={42} color="var(--accent-glow)" />}
                          {conversationStatus === 'connecting' && <Icon name="loader" size={40} color="var(--accent-glow)" />}
                          {conversationStatus === 'connected' && conversationMode === 'listening' && <Icon name="mic" size={42} color="#f3d58e" />}
                          {conversationStatus === 'connected' && conversationMode === 'speaking' && <Icon name="volume" size={42} color="#f0c978" />}
                          {conversationStatus === 'error' && <Icon name="alertTriangle" size={40} color="#d88347" />}
                        </div>
                      </div>
                    </button>
                    <div className="voice-control-caption">
                      {conversationStatus === 'connected' ? 'End live voice session' : 'Start live voice session'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {activeToolMessages.length > 0 && (
                <div className="backend-activity-banner">
                  <span className="tool-spinner" aria-hidden="true"></span>
                  <span className="backend-activity-text">
                    Backend working on {activeToolMessages.map((message) => message.toolName).filter(Boolean).join(', ')}
                  </span>
                </div>
              )}

              {/* Floating orb when conversation active and messages exist */}
              {conversationStatus === 'connected' && (
                <div className="floating-orb-container">
                  <div
                    className={`nexus-orb mini ${conversationMode}`}
                    onClick={endConversation}
                    style={{ transform: `scale(${orbScale})` }}
                    title="Click to end conversation"
                  >
                    <div className="orb-core">
                      <Icon name={conversationMode === 'listening' ? 'mic' : 'volume'} size={20} color="var(--accent-glow)" />
                    </div>
                  </div>
                </div>
              )}

              {messages.map(msg => renderMessage(msg))}
              {chatThinking && (
                <div className="message assistant thinking-bubble">
                  <span className="thinking-dots">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </span>
                  <span>
                    {chatThinking.stage === 'thinking' && 'Thinking...'}
                    {chatThinking.stage === 'tool_calls_planned' && 'Planning tool calls...'}
                    {chatThinking.stage === 'tool_call_start' && `Running ${chatThinking.tool || 'tool'}...`}
                    {chatThinking.stage === 'tool_call_done' && `Finished ${chatThinking.tool || 'tool'}`}
                    {chatThinking.stage === 'synthesizing' && 'Writing response...'}
                  </span>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
        </>
        )}

        {/* Input Area */}
        <div className="input-area">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden-file-input"
            onChange={handleFileSelection}
            multiple
            accept=".pdf,.xlsx,.xls,.csv,.tsv,.txt,.md,.markdown,.json,.html,.htm,.xml,.yaml,.yml,.log,.js,.ts,.jsx,.tsx,.doc,.docx,.rtf,.odt,.pages,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.tiff,.ico"
          />
          <div className="input-compose-column">
            <div className="input-wrapper">
              <textarea
                className="text-input"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={conversationStatus === 'connected'
                  ? 'Type a message or speak naturally...'
                  : 'Type a message, or click the orb above to start voice...'}
                rows={1}
                disabled={isLoading}
              />
              <div className="input-actions">
                <button
                  className={`input-button ${isUploadingFiles ? 'active' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload and ingest documents"
                  disabled={!currentSession || isUploadingFiles}
                >
                  {isUploadingFiles ? <Icon name="loader" size={16} /> : <Icon name="paperclip" size={16} />}
                </button>
                {conversationStatus !== 'connected' && (
                  <button
                    className="input-button voice-button"
                    onClick={() => void startConversation()}
                    title="Start voice conversation"
                  >
                    <Icon name="mic" size={18} />
                  </button>
                )}
                {conversationStatus === 'connected' && (
                  <button
                    className={`input-button voice-button ${isVoiceMicMuted ? 'muted active' : ''}`}
                    onClick={() => void toggleVoiceMicMute()}
                    title={isVoiceMicMuted ? 'Unmute ElevenLabs microphone' : 'Mute ElevenLabs microphone'}
                  >
                    <Icon name={isVoiceMicMuted ? 'micOff' : 'mic'} size={18} />
                  </button>
                )}
                {conversationStatus === 'connected' && (
                  <button
                    className="input-button voice-button recording active"
                    onClick={endConversation}
                    title="End voice conversation"
                  >
                    <Icon name="square" size={18} />
                    <div className="voice-indicator"></div>
                  </button>
                )}
              </div>
            </div>
            {renderFieldCopyRow(inputText, 'composer-input-field')}
          </div>
          <button
            className={`send-button ${isLoading ? 'stop-mode' : ''}`}
            onClick={() => {
              if (isLoading) {
                void handleStopCurrentTask();
                return;
              }

              void handleSendMessage(inputText);
            }}
            disabled={isLoading ? false : !inputText.trim()}
            title={isLoading ? 'Stop current task' : 'Send message (Enter)'}
          >
            {isLoading ? <Icon name="square" size={16} /> : '→'}
          </button>
        </div>
      </div>

      {/* Right Context Panel */}
      <div className={`context-panel ${!showContextPanel ? 'hidden' : ''}`}>
        <div className="context-panel-topbar">
          <div className="context-panel-topbar-title">Workspace Data</div>
          <button
            type="button"
            className="panel-close-button panel-collapse-button"
            onClick={() => setShowContextPanel(false)}
            title="Collapse workspace data panel"
            aria-label="Collapse workspace data panel"
          >
            {'>'}
          </button>
        </div>
        <div className="context-panel-section context-panel-search-section">
          <div className="context-panel-title">
            <Icon name="search" size={14} /> Global Search
            {isGlobalSearchLoading && (
              <span className="global-search-status">Searching…</span>
            )}
          </div>
          <div className="context-panel-content">
            <input
              className="context-search-input"
              value={globalSearchQuery}
              onChange={(event) => setGlobalSearchQuery(event.target.value)}
              placeholder="Search all knowledge, tutorials, transcripts, diary, files, and entities"
            />
            {renderFieldCopyRow(globalSearchQuery, 'global-search-field')}
            {globalSearchResults?.summary && (
              <div className="global-search-summary">{globalSearchResults.summary}</div>
            )}
            {globalSearchGroups.length > 0 ? (
              <div className="global-search-groups">
                {globalSearchGroups.map(([groupKey, items]) => {
                  const firstItem = items[0];
                  const totalCount = Number(globalSearchResults?.counts?.[groupKey]) || items.length;
                  const groupLabel = getGlobalSourceLabel(firstItem?.sourceType || groupKey);

                  return (
                    <div key={groupKey} className="global-search-group">
                      <div className="global-search-group-header">
                        <span>{groupLabel}</span>
                        <span>{totalCount}</span>
                      </div>
                      <div className="workspace-file-list global-search-list">
                        {items.map((result) => (
                          <button
                            key={`${groupKey}-${result.id}`}
                            type="button"
                            className="workspace-file-card workspace-file-card-button global-search-result"
                            onClick={() => void openGlobalSearchResult(result)}
                          >
                            <div className="workspace-file-header">
                              <div className="workspace-file-title">{result.title || result.name || 'Untitled result'}</div>
                              <div className="workspace-file-meta">
                                {result.createdAt
                                  ? new Date(result.createdAt).toLocaleDateString()
                                  : groupLabel}
                              </div>
                            </div>
                            {result.source && (
                              <div className="context-mini-meta global-search-source">
                                {truncateDisplayText(String(result.source), 120)}
                              </div>
                            )}
                            {result.preview && (
                              <div className="workspace-file-preview">
                                {truncateDisplayText(String(result.preview), 220)}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              !isGlobalSearchLoading && (
                <div className="settings-inline-note">
                  {globalSearchQuery.trim()
                    ? 'No results matched that search across the workspace.'
                    : 'Recent items from every source will appear here automatically.'}
                </div>
              )
            )}
          </div>
        </div>
        <div className="context-panel-section">
          <div className="context-panel-title"><Icon name="layers" size={14} /> Current Project</div>
          <div className="context-panel-content">
            {currentProject ? (
              <>
                <div className="workspace-file-card">
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">{currentProject.name}</div>
                    <div className="workspace-file-meta">{currentProject.assignedBy || 'auto'}</div>
                  </div>
                  {currentProject.description && (
                    <div className="workspace-file-preview">{currentProject.description}</div>
                  )}
                  <div className="stat-row">
                    <span className="stat-label">Confidence</span>
                    <span className="stat-value">
                      {typeof currentProject.confidence === 'number'
                        ? `${Math.round(currentProject.confidence * 100)}%`
                        : '—'}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Tasks</span>
                    <span className="stat-value">{projectTasks.length}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Pipelines</span>
                    <span className="stat-value">{projectPipelines.length}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Artifacts</span>
                    <span className="stat-value">{projectArtifacts.length}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Agent Runs</span>
                    <span className="stat-value">{projectAgentRuns.length}</span>
                  </div>
                  {Array.isArray(currentProject.topics) && currentProject.topics.length > 0 && (
                    <div className="context-tag-list">
                      {currentProject.topics.slice(0, 8).map((topic) => (
                        <span key={topic} className="context-tag">{topic}</span>
                      ))}
                    </div>
                  )}
                  <div className="workspace-file-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => void openProjectViewer()}
                    >
                      Open Project
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => void openRollingTodoModal()}
                    >
                      Open Tasks
                    </button>
                  </div>
                </div>

                <input
                  className="context-search-input"
                  value={projectSearchQuery}
                  onChange={(event) => setProjectSearchQuery(event.target.value)}
                  placeholder="Filter project tasks and events"
                />
                {renderFieldCopyRow(projectSearchQuery, 'project-search-field')}

                <div className="context-panel-subtitle">Project Tasks</div>
                <div className="workspace-file-list context-compact-list">
                  {projectTasks
                    .filter((task) => matchesDataSearch(projectSearchQuery, [
                      task.title,
                      task.status,
                      task.priority,
                      task.result,
                    ]))
                    .slice(0, 4)
                    .map((task) => (
                      <div key={task.id} className="workspace-file-card context-mini-card">
                        <div className="workspace-file-header">
                          <div className="workspace-file-title">{task.title}</div>
                          <div className={`context-status-pill ${task.status}`}>{task.status}</div>
                        </div>
                        <div className="context-mini-meta">
                          {task.priority} priority{task.createdAt ? ` · ${new Date(task.createdAt).toLocaleDateString()}` : ''}
                        </div>
                        <div className="task-progress">
                          <div className="task-progress-bar" style={{ width: `${task.progress}%` }}></div>
                        </div>
                      </div>
                    ))}
                  {projectTasks.length === 0 && (
                    <div className="settings-inline-note">No session-linked tasks are attached to this project yet.</div>
                  )}
                </div>

                {filteredProjectEvents.length > 0 && (
                  <>
                    <div className="context-panel-subtitle">Recent Project Events</div>
                    <div className="workspace-file-list context-compact-list">
                      {filteredProjectEvents.slice(0, 2).map((event) => (
                        <div key={event.id} className="workspace-file-card context-mini-card">
                          <div className="workspace-file-header">
                            <div className="workspace-file-title">{event.title}</div>
                            <div className="workspace-file-meta">{new Date(event.createdAt).toLocaleDateString()}</div>
                          </div>
                          <div className="context-mini-meta">{event.eventType.replace(/_/g, ' ')}</div>
                          <div className="workspace-file-preview">{event.content}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="settings-inline-note">
                No project has been inferred for this session yet. Start working and Nexus will scope one automatically.
              </div>
            )}
          </div>
        </div>
        {agents.length > 0 && (
          <div className="context-panel-section">
            <div className="context-panel-title"><Icon name="cpu" size={14} /> Active Agents</div>
            <div className="context-panel-content">
              <input
                className="context-search-input"
                value={agentSearchQuery}
                onChange={(event) => setAgentSearchQuery(event.target.value)}
                placeholder="Search active agents"
              />
              {renderFieldCopyRow(agentSearchQuery, 'context-agent-search-field')}
              {filteredAgents.map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  className="agent-item agent-item-button"
                  onClick={() => void openAgentWorkflow(agent)}
                >
                  <div className={`agent-item-status ${agent.status}`}></div>
                  <div className="agent-item-name">{agent.name}</div>
                </button>
              ))}
              {filteredAgents.length === 0 && (
                <div className="settings-inline-note">No agents match that search.</div>
              )}
            </div>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="context-panel-section">
            <div className="context-panel-title"><Icon name="clipboard" size={14} /> Task Queue</div>
            <div className="context-panel-content">
              <input
                className="context-search-input"
                value={taskSearchQuery}
                onChange={(event) => setTaskSearchQuery(event.target.value)}
                placeholder="Search tasks"
              />
              {renderFieldCopyRow(taskSearchQuery, 'task-search-field')}
              {filteredTasks.map(task => (
                <div key={task.id}>
                  <div className="task-title">{task.title}</div>
                  <div className="task-progress">
                    <div className="task-progress-bar" style={{ width: `${task.progress}%` }}></div>
                  </div>
                </div>
              ))}
              {filteredTasks.length === 0 && (
                <div className="settings-inline-note">No tasks match that search.</div>
              )}
            </div>
          </div>
        )}

        {pipelines.length > 0 && (
          <div className="context-panel-section">
            <div className="context-panel-title"><Icon name="gitBranch" size={14} /> Pipeline Progress</div>
            <input
              className="context-search-input"
              value={pipelineSearchQuery}
              onChange={(event) => setPipelineSearchQuery(event.target.value)}
              placeholder="Search pipelines"
            />
            {renderFieldCopyRow(pipelineSearchQuery, 'pipeline-search-field')}
            {filteredPipelines.map(pipeline => (
              <button
                key={pipeline.id}
                className="pipeline-progress pipeline-progress-button"
                onClick={() => setPipelineViewer(pipeline)}
              >
                <div className="pipeline-title">{pipeline.name}</div>
                <div className="pipeline-stages">
                  {pipeline.stages.map((stage, idx) => (
                    <div key={idx} className={`pipeline-stage ${stage.status}`}></div>
                  ))}
                </div>
              </button>
            ))}
            {filteredPipelines.length === 0 && (
              <div className="settings-inline-note">No pipelines match that search.</div>
            )}
          </div>
        )}

        <div className="context-panel-section">
          <div className="context-panel-title"><Icon name="folder" size={14} /> Working Set</div>
          <div className="context-panel-content">
            <div className="context-panel-subtitle">Active Tools</div>
            <div className="context-tag-list">
              {recentToolNames.slice(0, 8).map((toolName) => (
                <span key={toolName} className="context-tag context-tag-tool">
                  <Icon name={getToolIconName(toolName)} size={12} />
                  {toolName}
                </span>
              ))}
              {recentToolNames.length === 0 && (
                <div className="settings-inline-note">No live tool activity yet in this session.</div>
              )}
            </div>

            <div className="context-panel-subtitle">Folders In Use</div>
            <div className="workspace-file-list context-compact-list">
              {workingSetFolders.map((folder) => (
                <div key={folder.path} className="workspace-file-card context-mini-card">
                  <div className="workspace-file-title">{folder.label}</div>
                  <div className="context-mini-meta">{folder.path}</div>
                </div>
              ))}
              {workingSetFolders.length === 0 && (
                <div className="settings-inline-note">Folders will appear here as tools open, create, or update files.</div>
              )}
            </div>

            <div className="context-panel-subtitle">Files & Artifacts</div>
            <div className="workspace-file-list context-compact-list">
              {workingSetArtifactReferences.slice(0, 4).map((artifact) => (
                <button
                  key={artifact.path}
                  type="button"
                  className="workspace-file-card workspace-file-card-button context-mini-card"
                  onClick={() => void openArtifactViewer(artifact)}
                >
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">{artifact.name}</div>
                    <div className="workspace-file-meta">{artifact.kind}</div>
                  </div>
                  <div className="context-mini-meta">{formatPathForPanel(artifact.path, 4)}</div>
                </button>
              ))}
              {workingSetArtifactReferences.length === 0 && workingSetWorkspaceFiles.slice(0, 4).map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="workspace-file-card workspace-file-card-button context-mini-card"
                  onClick={() => {
                    const kind = getArtifactKind(file.path);
                    if (!kind) {
                      addSystemMessage(`Preview is not supported yet for ${file.name}.`);
                      return;
                    }
                    void openArtifactViewer({
                      path: file.path,
                      kind,
                      name: file.name,
                    });
                  }}
                >
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">{file.name}</div>
                    <div className="workspace-file-meta">workspace</div>
                  </div>
                  <div className="context-mini-meta">{formatPathForPanel(file.path, 4)}</div>
                </button>
              ))}
              {workingSetArtifactReferences.length === 0 && workingSetWorkspaceFiles.length === 0 && (
                <div className="settings-inline-note">No active files yet. They will appear here as the workspace is used.</div>
              )}
            </div>

            <div className="context-panel-subtitle">Knowledge In Use</div>
            <div className="workspace-file-list context-compact-list">
              {workingSetKnowledgeDocuments.slice(0, 4).map((document) => (
                <div key={document.id} className="workspace-file-card context-mini-card">
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">{document.title || 'Untitled document'}</div>
                    <div className="workspace-file-meta">{document.source || 'knowledge'}</div>
                  </div>
                  <div className="workspace-file-preview">{document.preview || document.artifactPath || 'Knowledge document'}</div>
                </div>
              ))}
              {workingSetKnowledgeDocuments.length === 0 && (
                <div className="settings-inline-note">Knowledge documents will appear here after retrieval or ingestion.</div>
              )}
            </div>
          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title"><Icon name="compass" size={14} /> Context Window</div>
          <div className="context-panel-content">
            <div className="context-metric-grid">
              <div className="context-metric-card">
                <span className="context-metric-label">Tool Calls</span>
                <strong className="context-metric-value">{contextWindowMetrics.toolCalls}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">Active Tools</span>
                <strong className="context-metric-value">{contextWindowMetrics.tools}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">Project Tasks</span>
                <strong className="context-metric-value">{contextWindowMetrics.tasks}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">Folders</span>
                <strong className="context-metric-value">{contextWindowMetrics.folders}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">Files</span>
                <strong className="context-metric-value">{contextWindowMetrics.files}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">Knowledge Docs</span>
                <strong className="context-metric-value">{contextWindowMetrics.docs}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">People In Context</span>
                <strong className="context-metric-value">{crmSessionContext?.people.length || 0}</strong>
              </div>
              <div className="context-metric-card">
                <span className="context-metric-label">Active Relationships</span>
                <strong className="context-metric-value">{crmSessionContext?.relationships.length || 0}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title diary-panel-title-row">
            <span>👥 Entities & Relationships</span>
            <button className="diary-inline-button" onClick={() => void openEntityCrm()}>
              View All
            </button>
          </div>
          <div className="context-panel-content">
            {crmSessionContext?.summary && (
              <div className="workspace-file-card context-mini-card">
                <div className="workspace-file-title">
                  {crmSessionContext.mode === 'graph' ? 'Explicit Session Graph' : 'Session Graph'}
                </div>
                <div className="workspace-file-preview">{crmSessionContext.summary}</div>
                <div className="stat-row"><span className="stat-label">People in CRM</span><span className="stat-value">{crmCounts.people}</span></div>
                <div className="stat-row"><span className="stat-label">Businesses in CRM</span><span className="stat-value">{crmCounts.businesses}</span></div>
                <div className="stat-row"><span className="stat-label">Relationships</span><span className="stat-value">{crmCounts.links}</span></div>
              </div>
            )}

            <div className="context-panel-subtitle">People In Context</div>
            <div className="workspace-file-list context-compact-list">
              {(crmSessionContext?.people || []).slice(0, 3).map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="workspace-file-card workspace-file-card-button context-mini-card"
                  onClick={() => void focusCrmEntity(person, 'person')}
                >
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">{person.full_name || person.name || 'Unknown person'}</div>
                    <div className="workspace-file-meta">
                      {person.sourceCount
                        ? `${person.sourceCount} source${person.sourceCount === 1 ? '' : 's'}`
                        : `score ${Math.round(Number(person.score || 0))}`}
                    </div>
                  </div>
                  <div className="context-mini-meta">
                    {[person.title, person.company, person.location].filter(Boolean).join(' — ') || 'CRM person'}
                  </div>
                  {(person.mentionCount || person.documentCount || person.artifactCount || person.projectCount) ? (
                    <div className="context-mini-meta">
                      {[
                        person.mentionCount ? `${person.mentionCount} mention${person.mentionCount === 1 ? '' : 's'}` : '',
                        person.documentCount ? `${person.documentCount} doc${person.documentCount === 1 ? '' : 's'}` : '',
                        person.artifactCount ? `${person.artifactCount} artifact${person.artifactCount === 1 ? '' : 's'}` : '',
                        person.projectCount ? `${person.projectCount} project${person.projectCount === 1 ? '' : 's'}` : '',
                      ].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                  {Array.isArray(person.reasons) && person.reasons.length > 0 && (
                    <div className="context-tag-list">
                      {person.reasons.slice(0, 2).map((reason) => (
                        <span key={`${person.id}-${reason}`} className="context-tag">{reason}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
              {(!crmSessionContext || crmSessionContext.people.length === 0) && (
                <div className="settings-inline-note">No strong person matches have been resolved from the current session yet.</div>
              )}
            </div>

            <div className="context-panel-subtitle">Businesses In Context</div>
            <div className="workspace-file-list context-compact-list">
              {(crmSessionContext?.businesses || []).slice(0, 3).map((business) => (
                <button
                  key={business.id}
                  type="button"
                  className="workspace-file-card workspace-file-card-button context-mini-card"
                  onClick={() => void focusCrmEntity(business, 'business')}
                >
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">{business.name || business.full_name || 'Unknown business'}</div>
                    <div className="workspace-file-meta">
                      {business.sourceCount
                        ? `${business.sourceCount} source${business.sourceCount === 1 ? '' : 's'}`
                        : `score ${Math.round(Number(business.score || 0))}`}
                    </div>
                  </div>
                  <div className="context-mini-meta">
                    {[business.industry, business.location].filter(Boolean).join(' — ') || 'CRM business'}
                  </div>
                  {(business.mentionCount || business.documentCount || business.artifactCount || business.projectCount) ? (
                    <div className="context-mini-meta">
                      {[
                        business.mentionCount ? `${business.mentionCount} mention${business.mentionCount === 1 ? '' : 's'}` : '',
                        business.documentCount ? `${business.documentCount} doc${business.documentCount === 1 ? '' : 's'}` : '',
                        business.artifactCount ? `${business.artifactCount} artifact${business.artifactCount === 1 ? '' : 's'}` : '',
                        business.projectCount ? `${business.projectCount} project${business.projectCount === 1 ? '' : 's'}` : '',
                      ].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                  {Array.isArray(business.reasons) && business.reasons.length > 0 && (
                    <div className="context-tag-list">
                      {business.reasons.slice(0, 2).map((reason) => (
                        <span key={`${business.id}-${reason}`} className="context-tag">{reason}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
              {(!crmSessionContext || crmSessionContext.businesses.length === 0) && (
                <div className="settings-inline-note">No strong business matches have been resolved from the current session yet.</div>
              )}
            </div>

            <div className="context-panel-subtitle">Relationships</div>
            <div className="workspace-file-list context-compact-list">
              {(crmSessionContext?.relationships || []).slice(0, 4).map((relationship) => (
                <div key={relationship.id} className="workspace-file-card context-mini-card">
                  <div className="workspace-file-header">
                    <div className="workspace-file-title">
                      {relationship.personName} → {relationship.businessName}
                    </div>
                    <div className={`context-status-pill ${relationship.inWorkingSet ? 'running' : 'completed'}`}>
                      {relationship.inWorkingSet ? 'active' : 'linked'}
                    </div>
                  </div>
                  <div className="context-mini-meta">
                    {relationship.role || 'Relationship'}{relationship.isFounder ? ' · founder' : ''}
                  </div>
                  <div className="workspace-file-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => void focusCrmEntity({ id: relationship.personId, full_name: relationship.personName }, 'person')}
                    >
                      Person
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => void focusCrmEntity({ id: relationship.businessId, name: relationship.businessName }, 'business')}
                    >
                      Business
                    </button>
                  </div>
                </div>
              ))}
              {(!crmSessionContext || crmSessionContext.relationships.length === 0) && (
                <div className="settings-inline-note">No linked CRM relationships are active in this session context yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title diary-panel-title-row">
            <span>✓ Task Queue</span>
            <button className="diary-inline-button" onClick={() => void openRollingTodoModal()}>
              Open
            </button>
          </div>
          <div className="context-panel-content">
            {rollingTodoBoard ? (
              <>
                <div className="diary-entry-card rolling-todo-summary-card">
                  <div className="diary-entry-activity">
                    {rollingTodoBoard.projectName || rollingTodoBoard.sessionName}
                  </div>
                  <div className="diary-entry-content">{rollingTodoBoard.summary}</div>
                </div>
                <div className="diary-entry-list">
                  {rollingTodoBoard.items.slice(0, 2).map((item) => (
                    <div key={item.id} className="diary-entry-card rolling-todo-panel-item">
                      <div className="diary-entry-header">
                        <span className="diary-entry-type">Item {item.slotIndex + 1}</span>
                        <span className={`rolling-todo-status-pill ${item.status}`}>{item.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="diary-entry-activity">{item.title}</div>
                      <div className="diary-entry-content">{item.nextAction}</div>
                      <div className="workspace-file-actions">
                        <button
                          className="artifact-action-button"
                          onClick={() => void handleSendMessage(
                            `Push forward task queue item ${item.slotIndex + 1}: ${item.title}. Next action: ${item.nextAction}. If you need something from me, tell me exactly what is still needed.`
                          )}
                        >
                          Push Forward
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="settings-inline-note">
                No task queue yet. Open it and the agent will generate the top two moves for this session.
              </div>
            )}
          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title">📚 Knowledge Stats</div>
          <div className="context-panel-content">
            <div className="stat-row"><span className="stat-label">Tier 1</span><span className="stat-value">{knowledgeStats.tier1}</span></div>
            <div className="stat-row"><span className="stat-label">Tier 2</span><span className="stat-value">{knowledgeStats.tier2}</span></div>
            <div className="stat-row"><span className="stat-label">Tier 3</span><span className="stat-value">{knowledgeStats.tier3}</span></div>
            <div className="stat-row"><span className="stat-label">Documents</span><span className="stat-value">{knowledgeStats.documents}</span></div>
          </div>
        </div>

        <div className="context-panel-section youtube-knowledge-section">
          <div className="context-panel-title">
            <Icon name="play" size={14} /> YouTube Knowledge
            <span className="yt-stats-badge">{ytStats.transcripts} transcripts</span>
          </div>
          <div className="context-panel-content">
            {/* Single video fetch */}
            <div className="yt-input-row yt-input-row-submit">
              <input
                className="context-search-input"
                placeholder="Paste video URL or ID..."
                value={ytUrlInput}
                onChange={(e) => setYtUrlInput(e.target.value)}
                disabled={ytLoading}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && ytUrlInput.trim()) {
                    e.preventDefault();
                    await handleFetchYouTubeTranscript();
                  }
                }}
              />
              <button
                className="yt-submit-btn"
                onClick={() => void handleFetchYouTubeTranscript()}
                disabled={ytLoading || !ytUrlInput.trim()}
              >
                {ytLoading ? 'Working…' : 'Fetch'}
              </button>
            </div>
            {renderFieldCopyRow(ytUrlInput, 'youtube-url-field')}
            {/* Channel subscribe */}
            <div className="yt-input-row yt-input-row-submit">
              <input
                className="context-search-input"
                placeholder="Subscribe: @channel or URL..."
                value={ytChannelInput}
                onChange={(e) => setYtChannelInput(e.target.value)}
                disabled={ytLoading}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && ytChannelInput.trim()) {
                    e.preventDefault();
                    await handleSubscribeYouTubeChannel();
                  }
                }}
              />
              <button
                className="yt-submit-btn"
                onClick={() => void handleSubscribeYouTubeChannel()}
                disabled={ytLoading || !ytChannelInput.trim()}
              >
                {ytLoading ? 'Working…' : 'Subscribe'}
              </button>
            </div>
            {renderFieldCopyRow(ytChannelInput, 'youtube-channel-field')}
            {ytLoading && <div className="yt-loading">Fetching transcripts...</div>}
            {/* Channel list */}
            {ytChannels.length > 0 && (
              <div className="yt-channels-list">
                {ytChannels.map((ch: any) => (
                  <div key={ch.id} className={`yt-channel-card ${ch.status === 'paused' ? 'paused' : ''}`}>
                    <div className="yt-channel-header" onClick={() => setYtExpandedChannel(ytExpandedChannel === ch.id ? null : ch.id)}>
                      <span className="yt-channel-name">@{ch.channel_handle}</span>
                      <span className="yt-channel-count">{ch.transcript_count} transcripts</span>
                      <span className={`yt-channel-status ${ch.status}`}>{ch.status}</span>
                    </div>
                    {ytExpandedChannel === ch.id && (
                      <div className="yt-channel-actions">
                        {ch.status === 'active' ? (
                          <button className="yt-action-btn" onClick={async () => {
                            await nexus.youtube.pauseChannel(ch.id);
                            await refreshYouTubeData();
                          }}>Pause</button>
                        ) : (
                          <button className="yt-action-btn" onClick={async () => {
                            await nexus.youtube.resumeChannel(ch.id);
                            await refreshYouTubeData();
                          }}>Resume</button>
                        )}
                        <button className="yt-action-btn sync" onClick={async () => {
                          setYtLoading(true);
                          try {
                            await nexus.youtube.syncChannel(ch.id, currentSession?.id);
                            await refreshYouTubeData();
                          } catch (err: any) {
                            console.error('[YouTube] Sync failed:', err);
                          }
                          setYtLoading(false);
                        }}>Sync New</button>
                        <button className="yt-action-btn delete" onClick={async () => {
                          if (confirm(`Remove @${ch.channel_handle} and all its transcripts?`)) {
                            await nexus.youtube.deleteChannel(ch.id, true);
                            await refreshYouTubeData();
                          }
                        }}>Delete</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Recent transcripts */}
            {ytTranscripts.length > 0 && (
              <div className="yt-recent-transcripts">
                <div className="yt-recent-label">Recent Transcripts</div>
                {ytTranscripts.slice(0, 8).map((t) => (
                  <div
                    key={t.id}
                    className={`yt-transcript-item ${ytSelectedTranscript?.id === t.id ? 'active' : ''}`}
                    title={t.video_title}
                  >
                    <button
                      className="yt-transcript-card"
                      onClick={() => void openYouTubeTranscript(t.id)}
                      disabled={ytTranscriptLoadingId === t.id}
                    >
                      <span className="yt-transcript-title">
                        {t.video_title?.slice(0, 58) || t.video_id}
                        {(t.video_title?.length || 0) > 58 ? '...' : ''}
                      </span>
                      <span className="yt-transcript-meta">
                        {formatSecondsLabel(t.duration_seconds)} · {t.fetched_at ? new Date(t.fetched_at).toLocaleDateString() : 'recent'}
                        {ytTranscriptLoadingId === t.id ? ' · Opening…' : ''}
                      </span>
                      <span className="yt-transcript-summary">
                        {truncateDisplayText(t.summary_text || t.transcript_text || 'Transcript ready to view.', 140)}
                      </span>
                    </button>
                    <div className="yt-transcript-actions">
                      <button
                        className="yt-mini-btn"
                        onClick={() => void exportYouTubeTranscriptPdf(t)}
                        disabled={ytExportingTranscriptId === t.id}
                        title="Download transcript as PDF"
                      >
                        {ytExportingTranscriptId === t.id ? 'PDF…' : 'PDF'}
                      </button>
                      <button
                        className="yt-delete-btn"
                        onClick={async () => {
                          await nexus.youtube.deleteTranscript(t.id);
                          if (ytSelectedTranscript?.id === t.id) {
                            setYtSelectedTranscript(null);
                          }
                          await refreshYouTubeData();
                        }}
                        title="Remove transcript"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ytStats.channels === 0 && ytStats.transcripts === 0 && !ytLoading && (
              <div className="yt-empty-state">
                Paste a YouTube URL above or subscribe to a channel to start building your knowledge library.
              </div>
            )}
          </div>
        </div>

        <div className="context-panel-section brainstorm-context-panel-section">
          <div className="context-panel-title"><Icon name="zap" size={14} /> Brain Storm</div>
          <div className="context-panel-content">
            <input
              className="context-search-input"
              value={brainstormSearchQuery}
              onChange={(event) => setBrainstormSearchQuery(event.target.value)}
              placeholder="Search brainstorms"
            />
            {renderFieldCopyRow(brainstormSearchQuery, 'brainstorm-search-field')}
            <div className="brainstorm-control-row">
              <input
                className="settings-input brainstorm-input"
                placeholder="Brain Storm title"
                value={brainstormTitle}
                onChange={(event) => setBrainstormTitle(event.target.value)}
                disabled={isBrainstormRecording || isBrainstormProcessing}
              />
            </div>
            {renderFieldCopyRow(brainstormTitle, 'brainstorm-title-field')}

            {!isBrainstormRecording && (
              <button
                className="context-action-button"
                onClick={() => void beginBrainstormCapture()}
                disabled={isBrainstormProcessing}
              >
                {isBrainstormProcessing ? 'Processing…' : 'Start Brain Storm'}
              </button>
            )}

            {!isBrainstormRecording && !meetingModeActive && (
              <button
                type="button"
                className="context-action-button"
                onClick={startMeetingMode}
                style={{ marginTop: 6 }}
                title="Start Meeting Mode"
              >
                <><Icon name="radio" size={14} /> Start Meeting Mode</>
              </button>
            )}

            {!isBrainstormRecording && meetingModeActive && (
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  className="context-action-button"
                  onClick={presentMeetingSummary}
                  style={{ flex: 1 }}
                  title="Compile the current meeting briefing"
                >
                  <><Icon name="activity" size={14} color="#10b981" /> Present Summary</>
                </button>
                <button
                  type="button"
                  className="context-action-button secondary"
                  onClick={endMeetingMode}
                  style={{ flex: 1, borderColor: 'rgba(239, 68, 68, 0.35)', color: '#fecaca' }}
                  title="End Meeting Mode"
                >
                  <><Icon name="square" size={14} color="#ef4444" /> End Meeting</>
                </button>
              </div>
            )}

            {isBrainstormRecording && (
              <div className="brainstorm-live-card">
                <div className="brainstorm-live-header">
                  <span className="brainstorm-live-dot"></span>
                  <span>Recording live</span>
                  <span className="brainstorm-live-time">{formatElapsedTime(brainstormElapsedMs)}</span>
                </div>
                <div className="brainstorm-live-copy">
                  Speak for as long as needed. When you stop, the app will create a transcript PDF, a briefing, and save both to knowledge.
                </div>
                <button
                  className="context-action-button danger"
                  onClick={() => void stopBrainstormCapture()}
                >
                  Stop And Process
                </button>
              </div>
            )}

            {isBrainstormProcessing && (
              <div className="brainstorm-processing-card">
                <span className="tool-spinner" aria-hidden="true"></span>
                <span>Transcribing, separating speakers, generating PDFs, drafting briefing, and saving to knowledge…</span>
              </div>
            )}

            {selectedBrainstorm && (
              <div className={`brainstorm-summary-card ${selectedBrainstorm.status}`}>
                <div className="brainstorm-summary-header">
                  <div className="brainstorm-summary-title">{selectedBrainstorm.title}</div>
                  <div className={`brainstorm-status-pill ${selectedBrainstorm.status}`}>
                    {selectedBrainstorm.status}
                  </div>
                </div>
                <div className="brainstorm-summary-excerpt">
                  {selectedBrainstorm.status === 'error'
                    ? selectedBrainstorm.error || 'Brain Storm processing failed.'
                    : selectedBrainstorm.summaryExcerpt || 'Transcript and briefing will appear here after processing.'}
                </div>
                <div className="brainstorm-meta-grid">
                  <div className="brainstorm-meta-item">
                    <span className="brainstorm-meta-label">Action Items</span>
                    <span className="brainstorm-meta-value">{selectedBrainstorm.actionItemCount || 0}</span>
                  </div>
                  <div className="brainstorm-meta-item">
                    <span className="brainstorm-meta-label">Knowledge Docs</span>
                    <span className="brainstorm-meta-value">{selectedBrainstorm.knowledgeDocumentIds.length}</span>
                  </div>
                </div>
                {selectedBrainstorm.status !== 'error' && (
                  <div className="brainstorm-transcript-preview">
                    <div className="brainstorm-transcript-title">
                      {brainstormTranscriptSegments.length > 0 ? 'Speaker Transcript' : 'Transcript Preview'}
                    </div>
                    {brainstormTranscriptSegments.length > 0 ? (
                      <div className="brainstorm-transcript-list">
                        {brainstormTranscriptSegments.map((segment, index) => (
                          <div
                            key={`${selectedBrainstorm.id}-${segment.start_time}-${segment.end_time}-${index}`}
                            className="brainstorm-transcript-segment"
                          >
                            {editingSpeakerIndex === index ? (
                              <div className="brainstorm-transcript-speaker editing">
                                <input
                                  type="text"
                                  className="speaker-edit-input"
                                  value={editingSpeakerValue}
                                  onChange={(e) => setEditingSpeakerValue(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter' && editingSpeakerValue.trim()) {
                                      try {
                                        const oldName = segment.speaker || `Speaker ${index + 1}`;
                                        const result = await (window as any).electronAPI.invoke(
                                          'brainstorm:reassign-segment-speaker',
                                          selectedBrainstorm.id,
                                          index,
                                          editingSpeakerValue.trim()
                                        );
                                        setBrainstormSessions((prev) =>
                                          prev.map((s) => (s.id === result.id ? result : s))
                                        );
                                      } catch (err) {
                                        console.error('Failed to reassign speaker:', err);
                                      }
                                      setEditingSpeakerIndex(null);
                                      setEditingSpeakerValue('');
                                    } else if (e.key === 'Escape') {
                                      setEditingSpeakerIndex(null);
                                      setEditingSpeakerValue('');
                                    }
                                  }}
                                  onBlur={() => {
                                    setEditingSpeakerIndex(null);
                                    setEditingSpeakerValue('');
                                  }}
                                  autoFocus
                                />
                                <button
                                  className="speaker-rename-all-btn"
                                  title={`Rename all "${segment.speaker}" segments`}
                                  onMouseDown={async (e) => {
                                    e.preventDefault();
                                    if (!editingSpeakerValue.trim()) return;
                                    try {
                                      const oldName = segment.speaker || `Speaker ${index + 1}`;
                                      const result = await (window as any).electronAPI.invoke(
                                        'brainstorm:rename-speaker',
                                        selectedBrainstorm.id,
                                        oldName,
                                        editingSpeakerValue.trim()
                                      );
                                      setBrainstormSessions((prev) =>
                                        prev.map((s) => (s.id === result.id ? result : s))
                                      );
                                    } catch (err) {
                                      console.error('Failed to rename speaker:', err);
                                    }
                                    setEditingSpeakerIndex(null);
                                    setEditingSpeakerValue('');
                                  }}
                                >
                                  Rename All
                                </button>
                              </div>
                            ) : (
                              <div
                                className="brainstorm-transcript-speaker clickable"
                                title="Click to rename this speaker"
                                onClick={() => {
                                  setEditingSpeakerIndex(index);
                                  setEditingSpeakerValue(segment.speaker || `Speaker ${index + 1}`);
                                }}
                              >
                                {segment.speaker || `Speaker ${index + 1}`}
                              </div>
                            )}
                            <div className="brainstorm-transcript-text">{segment.text}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="brainstorm-transcript-fallback">
                        {brainstormTranscriptFallback
                          ? `${brainstormTranscriptFallback.slice(0, 480)}${brainstormTranscriptFallback.length > 480 ? '…' : ''}`
                          : 'Transcript preview will appear after processing completes.'}
                      </div>
                    )}
                  </div>
                )}
                <div className="brainstorm-artifact-actions">
                  <button
                    className="artifact-action-button primary"
                    disabled={!selectedBrainstorm.transcriptPdfPath}
                    onClick={() => {
                      if (!selectedBrainstorm.transcriptPdfPath) return;
                      void openArtifactViewer({
                        path: selectedBrainstorm.transcriptPdfPath,
                        kind: 'pdf',
                        name: selectedBrainstorm.transcriptPdfPath.split('/').pop() || 'Transcript PDF',
                      });
                    }}
                  >
                    View Transcript PDF
                  </button>
                  <button
                    className="artifact-action-button"
                    disabled={!selectedBrainstorm.briefingPdfPath}
                    onClick={() => {
                      if (!selectedBrainstorm.briefingPdfPath) return;
                      void openArtifactViewer({
                        path: selectedBrainstorm.briefingPdfPath,
                        kind: 'pdf',
                        name: selectedBrainstorm.briefingPdfPath.split('/').pop() || 'Briefing PDF',
                      });
                    }}
                  >
                    View Briefing PDF
                  </button>
                  <button
                    className="artifact-action-button danger"
                    disabled={
                      isDeletingBrainstormId === selectedBrainstorm.id
                      || isBrainstormRecording
                      || isBrainstormProcessing
                      || selectedBrainstorm.status === 'recording'
                      || selectedBrainstorm.status === 'processing'
                    }
                    onClick={() => void deleteBrainstorm(selectedBrainstorm)}
                  >
                    {isDeletingBrainstormId === selectedBrainstorm.id ? 'Deleting…' : 'Delete Brain Storm'}
                  </button>
                </div>
              </div>
            )}

            {brainstormSessions.length > 0 && (
              <div className="brainstorm-session-list">
                {filteredBrainstormSessions.slice(0, 4).map((brainstorm) => (
                  <button
                    key={brainstorm.id}
                    className={`brainstorm-session-chip ${selectedBrainstorm?.id === brainstorm.id ? 'active' : ''}`}
                    onClick={() => setSelectedBrainstormId(brainstorm.id)}
                  >
                    <span className={`brainstorm-session-chip-dot ${brainstorm.status}`}></span>
                    <span>{brainstorm.title}</span>
                  </button>
                ))}
                {filteredBrainstormSessions.length === 0 && (
                  <div className="settings-inline-note">No brainstorms match that search.</div>
                )}
              </div>
            )}

          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title diary-panel-title-row">
            <span>📔 Emergent Diary</span>
            <div className="diary-button-group">
              {diaryAudioPlaying && (
                <button
                  className="diary-inline-button diary-action-btn"
                  title="Stop diary playback"
                  onClick={stopDiaryAudio}
                  style={{ background: '#ef4444', color: 'white', borderColor: '#dc2626' }}
                >
                  ⏹ Stop
                </button>
              )}
              <button
                className="diary-inline-button diary-action-btn"
                title="Create diary entry from current session"
                onClick={async () => {
                  if (!currentSession?.id) return;
                  try {
                    setCreatingSessionDiary(true);
                    const result = await nexus.masterDiary.createSessionDiary(currentSession.id);
                    if (result?.entry) {
                      setMasterDiaryEntries((prev) => [result.entry, ...prev]);
                    }
                    if (result?.narrative) {
                      setMasterNarratives((prev) => {
                        const filtered = prev.filter((n) => n.narrativeDay !== result.narrative.narrative_day);
                        return [result.narrative, ...filtered];
                      });
                    }
                  } catch (err) {
                    console.error('[Diary] Failed to create session diary:', err);
                  } finally {
                    setCreatingSessionDiary(false);
                  }
                }}
              >
                {creatingSessionDiary ? '⏳ Writing...' : '✨ Create Diary'}
              </button>
              <button
                className="diary-inline-button"
                onClick={() => void openDiaryViewer()}
              >
                View All
              </button>
            </div>
          </div>
          <div className="context-panel-content">
            <input
              className="context-search-input"
              value={diarySearchQuery}
              onChange={(event) => setDiarySearchQuery(event.target.value)}
              placeholder="Search diary"
            />
            {renderFieldCopyRow(diarySearchQuery, 'diary-search-field')}
            {filteredMasterNarratives.length > 0 && (
              <div
                className="diary-narrative-card diary-clickable"
                role="button"
                tabIndex={0}
                title="Click to open full diary viewer"
                onClick={() => void openDiaryViewer()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDiaryViewer(); } }}
                style={{ cursor: 'pointer' }}
              >
                <div className="diary-narrative-day">{filteredMasterNarratives[0].narrativeDay}</div>
                <div className="diary-narrative-text">{filteredMasterNarratives[0].narrative}</div>
              </div>
            )}

            <div className="diary-entry-list">
              {filteredMasterDiaryEntries.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="diary-entry-card diary-clickable"
                  role="button"
                  tabIndex={0}
                  title="Click to open full diary viewer"
                  onClick={() => void openDiaryViewer()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDiaryViewer(); } }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="diary-entry-header">
                    <span className="diary-entry-type">{entry.entryType.replace(/_/g, ' ')}</span>
                    <div className="diary-entry-header-right">
                      <button
                        className="diary-play-btn"
                        title={diaryAudioPlaying === entry.id ? 'Stop' : 'Play aloud'}
                        onClick={(e) => { e.stopPropagation(); void playDiaryWithElevenLabs(entry.id, entry.content); }}
                      >
                        {diaryAudioPlaying === entry.id ? '⏹' : '▶'}
                      </button>
                      {diaryAudioPlaying === entry.id && (
                        <button
                          className="diary-play-btn"
                          title="Stop playback"
                          onClick={(e) => { e.stopPropagation(); stopDiaryAudio(); }}
                          style={{ color: '#ef4444' }}
                        >
                          ⏹
                        </button>
                      )}
                      <span className="diary-entry-time">{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  {entry.activityKey && (
                    <div className="diary-entry-activity">{entry.activityKey}</div>
                  )}
                  <div className="diary-entry-content">{entry.content}</div>
                </div>
              ))}
              {masterDiaryEntries.length === 0 && (
                <div className="settings-inline-note">No diary entries yet.</div>
              )}
              {masterDiaryEntries.length > 0 && filteredMasterDiaryEntries.length === 0 && (
                <div className="settings-inline-note">No diary entries match that search.</div>
              )}
            </div>
          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title"><Icon name="folder" size={14} /> Workspace Files</div>
          <div className="context-panel-content">
            <input
              className="context-search-input"
              value={workspaceFileSearchQuery}
              onChange={(event) => setWorkspaceFileSearchQuery(event.target.value)}
              placeholder="Search workspace files"
            />
            {renderFieldCopyRow(workspaceFileSearchQuery, 'workspace-file-search-field')}
            <div className="diary-entry-list workspace-file-list">
              {filteredWorkspaceFiles.slice(0, 8).map((file) => (
                <div key={file.path} className="diary-entry-card workspace-file-card">
                  <div className="diary-entry-header">
                    <span className="diary-entry-type">{file.name}</span>
                    <span className="diary-entry-time">
                      {file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div className="diary-entry-activity">{file.path}</div>
                  <div className="workspace-file-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => {
                        const kind = getArtifactKind(file.path);
                        if (!kind) {
                          addSystemMessage(`Preview is not supported yet for ${file.name}.`);
                          return;
                        }
                        void openArtifactViewer({
                          path: file.path,
                          kind,
                          name: file.name,
                        });
                      }}
                    >
                      Preview
                    </button>
                    <button
                      className="artifact-action-button"
                      onClick={() => void revealArtifact(file.path)}
                    >
                      Reveal
                    </button>
                  </div>
                </div>
              ))}
              {workspaceFiles.length === 0 && (
                <div className="settings-inline-note">No workspace files found yet in the repo-local workspace.</div>
              )}
              {workspaceFiles.length > 0 && filteredWorkspaceFiles.length === 0 && (
                <div className="settings-inline-note">No workspace files match that search.</div>
              )}
            </div>
          </div>
        </div>

        <div className="context-panel-section">
          <div className="context-panel-title"><Icon name="database" size={14} /> Knowledge Documents</div>
          <div className="context-panel-content">
            <input
              className="context-search-input"
              value={knowledgeSearchQuery}
              onChange={(event) => setKnowledgeSearchQuery(event.target.value)}
              placeholder="Search knowledge documents"
            />
            {renderFieldCopyRow(knowledgeSearchQuery, 'knowledge-search-field')}
            <div className="diary-entry-list workspace-file-list">
              {filteredKnowledgeDocuments.slice(0, 8).map((document) => (
                <div key={document.id} className="diary-entry-card workspace-file-card">
                  <div className="diary-entry-header">
                    <span className="diary-entry-type">{document.title || 'Untitled document'}</span>
                    <span className="diary-entry-time">
                      {document.createdAt ? new Date(document.createdAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div className="diary-entry-activity">{document.source || 'knowledge base'}</div>
                  <div className="diary-entry-content">{document.preview || ''}</div>
                  <div className="workspace-file-actions">
                    <button
                      className="artifact-action-button"
                      onClick={() => void openKnowledgeDocument(document.id)}
                    >
                      {document.artifactPath && getArtifactKind(document.artifactPath) ? 'Open File' : 'Open'}
                    </button>
                  </div>
                </div>
              ))}
              {knowledgeDocuments.length === 0 && (
                <div className="settings-inline-note">No knowledge documents found for this session yet.</div>
              )}
              {knowledgeDocuments.length > 0 && filteredKnowledgeDocuments.length === 0 && (
                <div className="settings-inline-note">No knowledge documents match that search.</div>
              )}
            </div>
          </div>
        </div>

        {/* Connection Info */}
        <div className="context-panel-section">
          <div className="context-panel-title"><Icon name="mic" size={14} /> Voice Engine</div>
          <div className="context-panel-content">
            <div className="stat-row">
              <span className="stat-label">Status</span>
              <span className="stat-value" style={{
                color: conversationStatus === 'connected' ? 'var(--success)' :
                       conversationStatus === 'error' ? 'var(--danger)' : 'var(--text-secondary)'
              }}>
                {conversationStatus}
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Mode</span>
              <span className="stat-value">{conversationMode}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Engine</span>
              <span className="stat-value">ElevenLabs</span>
            </div>
          </div>
        </div>
      </div>

      {showAgentHub && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowAgentHub(false)}></div>
          <div className="artifact-viewer-modal marketing-department-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">Agent Hub</div>
                <div className="artifact-viewer-subtitle">
                  Marketplace and studio for EIG agents across Land Grabbers, Marketing, Research, and custom platforms
                </div>
              </div>
              <div className="artifact-viewer-actions">
                <button className="artifact-action-button" onClick={() => void loadAgentHubListings()}>
                  Refresh
                </button>
                <button className="artifact-action-button" onClick={() => setShowAgentHub(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 18 }}>
              <div className="marketing-bridge-card" style={{ alignSelf: 'start' }}>
                <div className="marketing-bridge-title">Publish Agent</div>
                <label className="settings-label">Name</label>
                <input
                  className="settings-input"
                  value={agentHubDraft.name}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Land Grabber Scout"
                />
                <label className="settings-label">Tagline</label>
                <input
                  className="settings-input"
                  value={agentHubDraft.tagline}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, tagline: event.target.value }))}
                  placeholder="Finds Texas land and prepares acquisition intelligence"
                />
                <label className="settings-label">Description</label>
                <textarea
                  className="settings-input"
                  value={agentHubDraft.description}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="What this agent does, who it is for, and what it produces."
                  rows={5}
                />
                <label className="settings-label">Category</label>
                <input
                  className="settings-input"
                  value={agentHubDraft.category}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, category: event.target.value }))}
                  placeholder="Land Grabbers"
                />
                <label className="settings-label">Template</label>
                <select
                  className="settings-input"
                  value={agentHubDraft.template}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, template: event.target.value }))}
                >
                  {AGENT_HUB_TEMPLATES.map((template) => (
                    <option key={template} value={template}>{template}</option>
                  ))}
                </select>
                <label className="settings-label">Seller</label>
                <input
                  className="settings-input"
                  value={agentHubDraft.sellerName}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, sellerName: event.target.value }))}
                  placeholder="Creator or studio name"
                />
                <label className="settings-label">Seller Contact</label>
                <input
                  className="settings-input"
                  value={agentHubDraft.sellerContact}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, sellerContact: event.target.value }))}
                  placeholder="email, site, or marketplace handle"
                />
                <label className="settings-label">Price USD</label>
                <input
                  className="settings-input"
                  value={agentHubDraft.priceDollars}
                  onChange={(event) => setAgentHubDraft((prev) => ({ ...prev, priceDollars: event.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                />
                <button
                  className="artifact-action-button primary"
                  onClick={() => void publishAgentHubListing()}
                  disabled={agentHubPublishing}
                  style={{ marginTop: 12 }}
                >
                  {agentHubPublishing ? 'Publishing...' : 'Publish to Hub'}
                </button>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div className="marketing-bridge-title">Marketplace Listings</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {agentHubLoading ? 'Loading...' : `${agentHubListings.length} listing${agentHubListings.length === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {agentHubListings.length === 0 && !agentHubLoading && (
                    <div className="marketing-bridge-card">
                      <div className="marketing-bridge-title">No listings yet</div>
                      <div className="marketing-bridge-note">
                        Publish the first agent to create the local Hub catalog.
                      </div>
                    </div>
                  )}
                  {agentHubListings.map((listing) => {
                    const price = Number(listing.priceCents || 0) > 0
                      ? `$${(Number(listing.priceCents || 0) / 100).toFixed(2)} ${listing.currency || 'USD'}`
                      : 'Free';
                    return (
                      <div key={listing.id} className="marketing-bridge-card" style={{ minHeight: 220 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div className="marketing-bridge-title">{listing.name}</div>
                          <span style={{ color: 'var(--accent-primary)', fontSize: 12, fontWeight: 700 }}>{price}</span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 8 }}>
                          {listing.category || 'General'} · {listing.template || 'custom'} · v{listing.version || '1.0.0'}
                        </div>
                        <div style={{ color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
                          {listing.tagline || 'No tagline provided.'}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
                          {listing.description || 'No description provided.'}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 12 }}>
                          Seller: {listing.sellerName || 'Unknown'} · Installs: {listing.installCount || 0}
                        </div>
                        <button
                          className="artifact-action-button primary"
                          onClick={() => void installAgentHubListing(listing)}
                          disabled={agentHubInstallingId === listing.id}
                        >
                          {agentHubInstallingId === listing.id ? 'Installing...' : 'Install Agent'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {showMarketingDepartment && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowMarketingDepartment(false)}></div>
          <div className="artifact-viewer-modal marketing-department-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">Marketing Department</div>
                <div className="artifact-viewer-subtitle">
                  Embedded NotebookLM workspace with managed download bridge
                </div>
              </div>
              <div className="artifact-viewer-actions marketing-toolbar-actions">
                <button
                  className="artifact-action-button marketing-toolbar-button"
                  onClick={() => void revealMarketingFolder('incoming')}
                >
                  Reveal Incoming
                </button>
                <button
                  className="artifact-action-button marketing-toolbar-button"
                  onClick={() => void revealMarketingFolder('outgoing')}
                >
                  Reveal Outgoing
                </button>
                <button
                  className="artifact-action-button marketing-toolbar-button"
                  onClick={() => void openMarketingNotebookExternal()}
                >
                  Open External
                </button>
                <button
                  className="artifact-action-button marketing-toolbar-button"
                  onClick={() => setShowMarketingDepartment(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body marketing-department-body">
              <div className="marketing-side-panel">
                <div className="marketing-bridge-card">
                  <div className="marketing-bridge-title">NotebookLM Bridge</div>
                  <div className="marketing-bridge-row">
                    <span>Root</span>
                    <span>{marketingBridgeState?.rootDir || 'Loading…'}</span>
                  </div>
                  <div className="marketing-bridge-row">
                    <span>Incoming</span>
                    <span>{marketingBridgeState?.incomingDir || 'Loading…'}</span>
                  </div>
                  <div className="marketing-bridge-row">
                    <span>Outgoing</span>
                    <span>{marketingBridgeState?.outgoingDir || 'Loading…'}</span>
                  </div>
                  <div className="marketing-bridge-note">
                    Downloads from NotebookLM are saved into the incoming folder so Emergent can preview and reuse them from the workspace.
                  </div>
                  {marketingDownloadStatus && (
                    <div className="marketing-bridge-note" style={{ marginTop: 10 }}>
                      Status: {marketingDownloadStatus}
                    </div>
                  )}
                </div>

                <div className="marketing-bridge-card heygen-video-card">
                  <div>
                    <div className="marketing-bridge-title">HeyGen Video Lab</div>
                    <div className="marketing-bridge-note" style={{ marginTop: 4 }}>
                      Script in Nexus → ElevenLabs MP3 → HeyGen avatar video. Configure voices and avatars in Settings first.
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    value={heyGenVideoTitle}
                    onChange={(event) => setHeyGenVideoTitle(event.target.value)}
                    placeholder="Video title"
                  />
                  <select
                    className="settings-input"
                    value={selectedMarketingVoiceProfileId}
                    onChange={(event) => setSelectedMarketingVoiceProfileId(event.target.value)}
                  >
                    <option value="">Select ElevenLabs voice</option>
                    {marketingVoiceProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                  <select
                    className="settings-input"
                    value={selectedHeyGenAvatarProfileId}
                    onChange={(event) => setSelectedHeyGenAvatarProfileId(event.target.value)}
                  >
                    <option value="">Select HeyGen avatar</option>
                    {heyGenAvatarProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                  <textarea
                    className="settings-input"
                    value={heyGenVideoScript}
                    onChange={(event) => setHeyGenVideoScript(event.target.value)}
                    placeholder="Write the customer/prospect video message here. Example: Hey {{first_name}}, Vance from Lincutterz here..."
                    rows={7}
                  />
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={heyGenCaptionEnabled}
                      onChange={(event) => setHeyGenCaptionEnabled(event.target.checked)}
                    />
                    <span>Captions are ignored for ElevenLabs uploaded-audio videos</span>
                  </label>
                  <button
                    className="artifact-action-button"
                    onClick={() => void assistHeyGenScript()}
                    disabled={isAssistingHeyGenScript}
                  >
                    {isAssistingHeyGenScript ? 'Drafting...' : 'Assist Script'}
                  </button>
                  <button
                    className="artifact-action-button primary"
                    onClick={() => void createHeyGenMarketingVideo()}
                    disabled={isCreatingHeyGenVideo || !selectedMarketingVoiceProfileId || !selectedHeyGenAvatarProfileId}
                  >
                    {isCreatingHeyGenVideo ? 'Creating...' : 'Create HeyGen Video'}
                  </button>
                  {!marketingVideoConfig?.heygenApiKeyConfigured && (
                    <div className="settings-inline-note">
                      HeyGen API key is not saved yet. Add it in Settings before creating a video.
                    </div>
                  )}
                  {heyGenVideoResult && (
                    <div className="marketing-bridge-note" style={{ marginTop: 0 }}>
                      Last video: <strong>{String(heyGenVideoResult.videoId || 'submitted')}</strong>
                      {heyGenVideoResult.audioPath ? ` · Audio: ${heyGenVideoResult.audioPath}` : ''}
                    </div>
                  )}
                </div>

                <div className="marketing-bridge-card grok-media-card">
                  <div>
                    <div className="marketing-bridge-title">Grok Media Lab</div>
                    <div className="marketing-bridge-note" style={{ marginTop: 4 }}>
                      Manual or assisted prompts for Grok image generation and image-to-video jobs.
                    </div>
                  </div>
                  <select
                    className="settings-input"
                    value={grokMediaMode}
                    onChange={(event) => setGrokMediaMode(event.target.value === 'video' ? 'video' : 'image')}
                  >
                    <option value="image">Grok image</option>
                    <option value="video">Grok image-to-video / video</option>
                  </select>
                  <input
                    className="settings-input"
                    value={grokMediaTitle}
                    onChange={(event) => setGrokMediaTitle(event.target.value)}
                    placeholder="Media title"
                  />
                  <textarea
                    className="settings-input"
                    value={grokMediaPrompt}
                    onChange={(event) => setGrokMediaPrompt(event.target.value)}
                    placeholder="Write a manual prompt, or add a rough brief and click Assist Prompt."
                    rows={7}
                  />
                  {grokMediaMode === 'video' && (
                    <>
                      <input
                        className="settings-input"
                        value={grokMediaImageUrl}
                        onChange={(event) => setGrokMediaImageUrl(event.target.value)}
                        placeholder="Optional source image URL for image-to-video"
                      />
                      <input
                        className="settings-input"
                        value={grokMediaImagePath}
                        onChange={(event) => setGrokMediaImagePath(event.target.value)}
                        placeholder="Optional local source image path"
                      />
                      <div className="media-settings-grid">
                        <input
                          className="settings-input"
                          type="number"
                          min={1}
                          max={15}
                          value={grokVideoDuration}
                          onChange={(event) => setGrokVideoDuration(Math.max(1, Math.min(Number(event.target.value) || 8, 15)))}
                          placeholder="Seconds"
                        />
                        <select
                          className="settings-input"
                          value={grokVideoAspectRatio}
                          onChange={(event) => setGrokVideoAspectRatio(event.target.value)}
                        >
                          <option value="16:9">16:9</option>
                          <option value="9:16">9:16</option>
                          <option value="1:1">1:1</option>
                          <option value="4:3">4:3</option>
                          <option value="3:4">3:4</option>
                        </select>
                        <select
                          className="settings-input"
                          value={grokVideoResolution}
                          onChange={(event) => setGrokVideoResolution(event.target.value)}
                        >
                          <option value="720p">720p</option>
                          <option value="480p">480p</option>
                        </select>
                      </div>
                    </>
                  )}
                  {grokMediaMode === 'image' && (
                    <div className="media-settings-grid">
                      <select
                        className="settings-input"
                        value={grokImageAspectRatio}
                        onChange={(event) => setGrokImageAspectRatio(event.target.value)}
                      >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="auto">Auto</option>
                      </select>
                      <select
                        className="settings-input"
                        value={grokImageResolution}
                        onChange={(event) => setGrokImageResolution(event.target.value)}
                      >
                        <option value="1k">1k</option>
                        <option value="2k">2k</option>
                      </select>
                    </div>
                  )}
                  <button
                    className="artifact-action-button"
                    onClick={() => void assistGrokMediaPrompt()}
                    disabled={isAssistingGrokPrompt}
                  >
                    {isAssistingGrokPrompt ? 'Drafting...' : 'Assist Prompt'}
                  </button>
                  <button
                    className="artifact-action-button primary"
                    onClick={() => void createGrokMarketingMedia()}
                    disabled={isCreatingGrokMedia}
                  >
                    {isCreatingGrokMedia ? 'Creating...' : grokMediaMode === 'video' ? 'Create Grok Video' : 'Create Grok Image'}
                  </button>
                  {!marketingVideoConfig?.xaiApiKeyConfigured && (
                    <div className="settings-inline-note">
                      xAI API key is not saved yet. Add it in Settings before creating Grok media.
                    </div>
                  )}
                  {grokMediaResult && (
                    <div className="marketing-bridge-note" style={{ marginTop: 0 }}>
                      Last Grok result: <strong>{String(grokMediaResult.requestId || grokMediaResult.path || 'created')}</strong>
                    </div>
                  )}
                </div>
              </div>
              <div className="marketing-webview-shell">
                <webview
                  className="marketing-webview"
                  src={marketingBridgeState?.notebookUrl || 'https://notebooklm.google.com/'}
                  partition={marketingBridgeState?.partition || 'persist:marketing-notebooklm'}
                  allowpopups={true}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Settings Drawer */}
      {showSettings && (
        <>
          <div className="settings-overlay" onClick={() => setShowSettings(false)}></div>
          <div className="settings-drawer">
            <button className="settings-close" onClick={() => setShowSettings(false)}>✕</button>

            <h2 style={{ marginTop: '32px' }}>Settings</h2>

            <div className="settings-group">
              <div className="settings-group-title"><Icon name="send" size={14} /> Operator Communications</div>

              <div className="settings-field">
                <label className="settings-label">Preferred channel</label>
                <select
                  className="settings-select"
                  value={operatorCommChannel}
                  onChange={(event) => setOperatorCommChannel(normalizeOperatorCommunicationChannel(event.target.value))}
                >
                  <option value="notification">Desktop notification</option>
                  <option value="text">Text me</option>
                  <option value="both">Both</option>
                </select>
                <div className="settings-inline-note">
                  Choose how Nexus should reach you for briefings, updates, and alerts.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Self-text Shortcut</label>
                <input
                  type="text"
                  className="settings-input"
                  placeholder={DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT}
                  value={operatorSelfTextShortcutName}
                  onChange={(event) => setOperatorSelfTextShortcutName(event.target.value)}
                />
                <div className="settings-inline-note">
                  Used only for texting you. Defaults to <strong>{DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT}</strong>.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={operatorTaskAlertsEnabled}
                    onChange={(event) => setOperatorTaskAlertsEnabled(event.target.checked)}
                  />
                  <span>Notify me when tasks complete</span>
                </label>
              </div>

              <div className="settings-field">
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={operatorDailyBriefingEnabled}
                    onChange={(event) => setOperatorDailyBriefingEnabled(event.target.checked)}
                  />
                  <span>Send daily briefing while Nexus is open</span>
                </label>
                <div className="settings-inline-note">
                  Automatic daily briefings run on the configured time while the desktop app is open.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Daily briefing time</label>
                <input
                  type="time"
                  className="settings-input"
                  value={operatorDailyBriefingTime}
                  onChange={(event) => setOperatorDailyBriefingTime(event.target.value || DEFAULT_OPERATOR_DAILY_BRIEFING_TIME)}
                />
              </div>

              <div className="settings-field">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    className="modal-button secondary"
                    onClick={() => void sendOperatorTestUpdate()}
                    disabled={isSendingOperatorTest || isSendingOperatorBriefing}
                  >
                    {isSendingOperatorTest ? 'Sending...' : 'Send Test Update'}
                  </button>
                  <button
                    type="button"
                    className="modal-button secondary"
                    onClick={() => void sendOperatorDailyBriefingNow()}
                    disabled={isSendingOperatorBriefing || isSendingOperatorTest}
                  >
                    {isSendingOperatorBriefing ? 'Sending...' : 'Send Daily Briefing Now'}
                  </button>
                </div>
              </div>

              {operatorCommsStatus ? (
                <div className="settings-inline-note">{operatorCommsStatus}</div>
              ) : null}
            </div>

            {/* ElevenLabs Config - TOP PRIORITY */}
            <div className="settings-group">
              <div className="settings-group-title"><Icon name="mic" size={14} /> ElevenLabs Conversational AI</div>

              <div className="settings-field">
                <label className="settings-label">ElevenLabs API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="xi-..."
                  value={elevenLabsApiKey}
                  onChange={e => setElevenLabsApiKey(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Agent ID</label>
                <input
                  type="text"
                  className="settings-input"
                  placeholder={DEFAULT_ELEVENLABS_AGENT_ID}
                  value={elevenLabsAgentId}
                  onChange={e => setElevenLabsAgentId(e.target.value)}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Built-in default: {DEFAULT_ELEVENLABS_AGENT_NAME} ({DEFAULT_ELEVENLABS_AGENT_ID}). Replace it here if you want this app to use a different ElevenLabs conversational agent.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Voice ID (optional)</label>
                <input
                  type="text"
                  className="settings-input"
                  placeholder={DEFAULT_ELEVENLABS_VOICE_ID}
                  value={elevenLabsVoiceId}
                  onChange={e => setElevenLabsVoiceId(e.target.value)}
                />
              </div>

              <div className="settings-inline-note">
                Applied voice agent in app: <strong>{appliedVoiceAgentId || 'not configured'}</strong>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title"><Icon name="play" size={14} /> HeyGen Video + ElevenLabs Voices</div>

              <div className="settings-field">
                <label className="settings-label">HeyGen API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="HeyGen X-API-KEY"
                  value={heyGenApiKey}
                  onChange={e => setHeyGenApiKey(e.target.value)}
                />
                <div className="settings-inline-note">
                  Used by Marketing Department to upload ElevenLabs MP3 audio and create HeyGen avatar video jobs.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">xAI / Grok API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="xAI API key"
                  value={xaiApiKey}
                  onChange={e => setXaiApiKey(e.target.value)}
                />
                <div className="settings-inline-note">
                  Used by Marketing Department for Grok image generation and Grok image-to-video/video jobs.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Klaviyo API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Klaviyo private API key"
                  value={klaviyoApiKey}
                  onChange={e => setKlaviyoApiKey(e.target.value)}
                />
                <div className="settings-inline-note">
                  Used by the Lincutterz Growth Agent for approved Klaviyo account operations.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Notion API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Notion integration secret"
                  value={notionApiKey}
                  onChange={e => setNotionApiKey(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Lincutterz Notion Database ID</label>
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Optional default Notion database ID"
                  value={lincutterzNotionDatabaseId}
                  onChange={e => setLincutterzNotionDatabaseId(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Social Scheduler Bridge URL</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Webhook URL for approved social posts"
                  value={socialSchedulerWebhookUrl}
                  onChange={e => setSocialSchedulerWebhookUrl(e.target.value)}
                />
                <div className="settings-inline-note">
                  If blank, social posts are staged as local JSON request packages instead of submitted.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Figma Bridge URL</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Webhook URL for approved Figma requests"
                  value={figmaBridgeWebhookUrl}
                  onChange={e => setFigmaBridgeWebhookUrl(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Marketplace A+ Bridge URL</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Webhook URL for approved Amazon/Walmart A+ packages"
                  value={marketplaceBridgeWebhookUrl}
                  onChange={e => setMarketplaceBridgeWebhookUrl(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <label className="settings-label">Named ElevenLabs Voice Profiles</label>
                  <button type="button" className="modal-button secondary" onClick={addMarketingVoiceProfile}>
                    Add Voice
                  </button>
                </div>
                <div className="settings-inline-note">
                  Add either a Voice ID directly or an ElevenLabs Agent ID so Nexus can resolve that agent's configured voice.
                </div>
                <div className="profile-list">
                  {marketingVoiceProfiles.map((profile, index) => (
                    <div key={profile.id || index} className="settings-profile-card">
                      <input
                        className="settings-input"
                        placeholder="Friendly name, e.g. Vance"
                        value={profile.name || ''}
                        onChange={(event) => setMarketingVoiceProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                      />
                      <input
                        className="settings-input"
                        placeholder="ElevenLabs Agent ID or Voice ID"
                        value={profile.agentId || ''}
                        onChange={(event) => setMarketingVoiceProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, agentId: event.target.value } : item))}
                      />
                      <input
                        className="settings-input"
                        placeholder="Voice ID override, optional"
                        value={profile.voiceId || ''}
                        onChange={(event) => setMarketingVoiceProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, voiceId: event.target.value } : item))}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                        <input
                          className="settings-input"
                          placeholder="Model ID"
                          value={profile.modelId || 'eleven_multilingual_v2'}
                          onChange={(event) => setMarketingVoiceProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, modelId: event.target.value } : item))}
                        />
                        <button
                          type="button"
                          className="modal-button secondary"
                          onClick={() => setMarketingVoiceProfiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {marketingVoiceProfiles.length === 0 && (
                    <div className="settings-inline-note">No voice profiles yet. Add one for each voice/persona you want to use in HeyGen videos.</div>
                  )}
                </div>
              </div>

              <div className="settings-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <label className="settings-label">Named HeyGen Avatar Profiles</label>
                  <button type="button" className="modal-button secondary" onClick={addHeyGenAvatarProfile}>
                    Add Avatar
                  </button>
                </div>
                <div className="profile-list">
                  {heyGenAvatarProfiles.map((profile, index) => (
                    <div key={profile.id || index} className="settings-profile-card">
                      <input
                        className="settings-input"
                        placeholder="Friendly name, e.g. Vance Avatar"
                        value={profile.name || ''}
                        onChange={(event) => setHeyGenAvatarProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                      />
                      <input
                        className="settings-input"
                        placeholder="HeyGen avatar_id"
                        value={profile.avatarId || ''}
                        onChange={(event) => setHeyGenAvatarProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, avatarId: event.target.value } : item))}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px auto', gap: 8 }}>
                        <input
                          className="settings-input"
                          placeholder="Avatar style"
                          value={profile.avatarStyle || 'normal'}
                          onChange={(event) => setHeyGenAvatarProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, avatarStyle: event.target.value } : item))}
                        />
                        <input
                          className="settings-input"
                          placeholder="Width"
                          value={String(profile.width || 1280)}
                          onChange={(event) => setHeyGenAvatarProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, width: Number(event.target.value) || 1280 } : item))}
                        />
                        <input
                          className="settings-input"
                          placeholder="Height"
                          value={String(profile.height || 720)}
                          onChange={(event) => setHeyGenAvatarProfiles((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, height: Number(event.target.value) || 720 } : item))}
                        />
                        <button
                          type="button"
                          className="modal-button secondary"
                          onClick={() => setHeyGenAvatarProfiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {heyGenAvatarProfiles.length === 0 && (
                    <div className="settings-inline-note">No HeyGen avatars yet. Add each avatar_id and name it for easy selection in Marketing.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">LLM Configuration</div>

              <div className="settings-field">
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={offlineModeEnabled}
                    onChange={(event) => setOfflineModeEnabled(event.target.checked)}
                  />
                  <span>Offline Mode for text chat</span>
                </label>
                <div className="settings-inline-note">
                  Forces text chat onto local Ollama and removes internet-only tools from the text chat tool roster.
                </div>
              </div>

              <div className="settings-field">
                <div className={`network-health-card ${ollamaStatusTone}`}>
                  <div className="network-health-header">
                    <div className="network-health-title-row">
                      <span className={`network-health-dot ${ollamaStatusTone}`}></span>
                      <span className="network-health-title">Local Ollama</span>
                      <span className={`settings-status-badge ${ollamaStatusTone}`}>{ollamaStatusLabel}</span>
                    </div>
                    <div className="settings-status-actions">
                      <button
                        type="button"
                        className="modal-button secondary settings-status-action-button"
                        onClick={() => void refreshOllamaStatus()}
                        disabled={isRefreshingOllamaStatus || isRestartingOllama}
                      >
                        {isRefreshingOllamaStatus ? 'Refreshing...' : 'Refresh'}
                      </button>
                      <button
                        type="button"
                        className="modal-button secondary settings-status-action-button"
                        onClick={() => void restartOllama()}
                        disabled={isRestartingOllama || isRefreshingOllamaStatus}
                      >
                        {isRestartingOllama ? 'Restarting...' : 'Restart'}
                      </button>
                    </div>
                  </div>

                  <div className="network-health-message">{ollamaStatusSummary}</div>
                  <div className="network-health-meta">
                    URL: {ollamaState?.url || 'http://localhost:11434'} | Managed: {ollamaState?.managedProcess ? 'yes' : 'no'} | Models: {ollamaState?.models?.length ? ollamaState.models.join(', ') : 'none detected'}
                  </div>
                  {ollamaState?.missingModels?.length ? (
                    <div className="network-health-details">
                      Missing required models: {ollamaState.missingModels.join(', ')}
                    </div>
                  ) : null}
                  {ollamaState?.binaryPath ? (
                    <div className="network-health-details">
                      Binary: {ollamaState.binaryPath}
                    </div>
                  ) : null}
                  {ollamaState?.checkedAt ? (
                    <div className="settings-inline-note">
                      Last checked: {new Date(ollamaState.checkedAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Primary Provider</label>
                <select className="settings-select">
                  <option>Anthropic Claude 3.5 Sonnet</option>
                  <option>OpenAI GPT-4</option>
                  <option>Google Gemini 2.0</option>
                </select>
              </div>

              <div className="settings-field">
                <label className="settings-label">Fast Tier Model</label>
                <select className="settings-select">
                  <option>Claude 3 Haiku</option>
                  <option>GPT-4 Turbo</option>
                </select>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">API Keys</div>

              <div className="settings-field">
                <label className="settings-label">Gemini API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="AIza..."
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                />
                <div className="settings-inline-note">
                  Used by SentrySearch-backed semantic video indexing and retrieval in Media Intelligence.
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Anthropic API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="sk-ant-..."
                  value={anthropicApiKey}
                  onChange={e => setAnthropicApiKey(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">OpenAI API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="sk-..."
                  value={openAiApiKey}
                  onChange={e => setOpenAiApiKey(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Deepgram API Key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="..."
                  value={deepgramApiKey}
                  onChange={e => setDeepgramApiKey(e.target.value)}
                />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">Budget & Limits</div>

              <div className="settings-field">
                <label className="settings-label">Monthly Budget (USD)</label>
                <input type="number" className="settings-input" placeholder="100" defaultValue="100" />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">Network Health</div>

              <button
                className="modal-button secondary"
                style={{ width: '100%' }}
                onClick={() => void runNetworkHealthCheck()}
                disabled={isRunningNetworkHealth}
              >
                {isRunningNetworkHealth ? 'Running Diagnostics...' : 'Run Network Diagnostics'}
              </button>

              {networkHealthReport && (
                <div className="network-health-results">
                  <div className="settings-inline-note">
                    Last checked: {new Date(networkHealthReport.checkedAt).toLocaleString()}
                  </div>

                  {networkHealthReport.checks.map((check) => (
                    <div key={check.service} className={`network-health-card ${check.status}`}>
                      <div className="network-health-header">
                        <div className="network-health-title-row">
                          <span className={`network-health-dot ${check.status}`}></span>
                          <span className="network-health-title">{check.label}</span>
                        </div>
                        <span className="network-health-latency">
                          {check.latencyMs ? `${check.latencyMs}ms` : check.dns === 'failed' ? 'DNS failed' : ''}
                        </span>
                      </div>
                      <div className="network-health-message">{check.message}</div>
                      <div className="network-health-meta">
                        Host: {check.host} | DNS: {check.dns} | Configured: {check.configured ? 'yes' : 'no'}
                        {typeof check.httpStatus === 'number' ? ` | HTTP: ${check.httpStatus}` : ''}
                      </div>
                      {check.details && (
                        <div className="network-health-details">{check.details}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              className="modal-button primary"
              style={{ width: '100%', marginTop: '24px' }}
              onClick={async () => {
                try {
                  const nextElevenLabsAgentId = resolveElevenLabsAgentId(elevenLabsAgentId);
                  const nextElevenLabsVoiceId = resolveElevenLabsVoiceId(elevenLabsVoiceId);
                  const voiceSettingsChanged = (
                    nextElevenLabsAgentId !== appliedVoiceAgentId
                    || conversationStatus === 'connected'
                    || conversationStatus === 'connecting'
                  );

                  await nexus.settings.set('elevenlabs_api_key', elevenLabsApiKey.trim());
                  await nexus.settings.set('elevenlabs_agent_id', nextElevenLabsAgentId);
                  await nexus.settings.set('elevenlabs_voice_id', nextElevenLabsVoiceId);
                  if (heyGenApiKey) {
                    await nexus.settings.set('heygen_api_key', heyGenApiKey);
                  }
                  if (xaiApiKey) {
                    await nexus.settings.set('xai_api_key', xaiApiKey);
                  }
                  await nexus.settings.set('klaviyo_api_key', klaviyoApiKey);
                  await nexus.settings.set('notion_api_key', notionApiKey);
                  await nexus.settings.set('lincutterz_notion_database_id', lincutterzNotionDatabaseId);
                  await nexus.settings.set('social_scheduler_webhook_url', socialSchedulerWebhookUrl);
                  await nexus.settings.set('figma_bridge_webhook_url', figmaBridgeWebhookUrl);
                  await nexus.settings.set('marketplace_bridge_webhook_url', marketplaceBridgeWebhookUrl);
                  const savedVideoConfig = await nexus.marketing.saveVideoConfig({
                    voiceProfiles: marketingVoiceProfiles,
                    avatarProfiles: heyGenAvatarProfiles,
                  });
                  setMarketingVideoConfig(savedVideoConfig);
                  setMarketingVoiceProfiles(Array.isArray(savedVideoConfig?.voiceProfiles) ? savedVideoConfig.voiceProfiles : []);
                  setHeyGenAvatarProfiles(Array.isArray(savedVideoConfig?.avatarProfiles) ? savedVideoConfig.avatarProfiles : []);
                  setSelectedMarketingVoiceProfileId((current) => current || savedVideoConfig?.voiceProfiles?.[0]?.id || '');
                  setSelectedHeyGenAvatarProfileId((current) => current || savedVideoConfig?.avatarProfiles?.[0]?.id || '');
                  if (geminiApiKey) {
                    await nexus.settings.set('gemini_api_key', geminiApiKey);
                  }
                  if (anthropicApiKey) {
                    await nexus.settings.set('anthropic_api_key', anthropicApiKey);
                  }
                  if (openAiApiKey) {
                    await nexus.settings.set('openai_api_key', openAiApiKey);
                  }
                  if (deepgramApiKey) {
                    await nexus.settings.set('deepgram_api_key', deepgramApiKey);
                  }
                  await nexus.settings.set('offline_mode_enabled', offlineModeEnabled ? 'true' : 'false');
                  await nexus.settings.set('operator_comm_channel', operatorCommChannel);
                  await nexus.settings.set(
                    'operator_self_text_shortcut_name',
                    operatorSelfTextShortcutName.trim() || DEFAULT_OPERATOR_SELF_TEXT_SHORTCUT,
                  );
                  await nexus.settings.set('operator_task_alerts_enabled', operatorTaskAlertsEnabled ? 'true' : 'false');
                  await nexus.settings.set('operator_daily_briefing_enabled', operatorDailyBriefingEnabled ? 'true' : 'false');
                  await nexus.settings.set(
                    'operator_daily_briefing_time',
                    operatorDailyBriefingTime || DEFAULT_OPERATOR_DAILY_BRIEFING_TIME,
                  );

                  const configured = await nexus.elevenlabs.isConfigured();
                  const agentConfig = await nexus.elevenlabs.getAgentConfig(currentSession?.id);
                  setIsElevenLabsConfigured(configured);
                  setAppliedVoiceAgentId(agentConfig.agentId || '');

                  if (voiceSettingsChanged) {
                    await endConversation();
                  }

                  setShowSettings(false);
                  addSystemMessage(
                    `Settings saved. Applied voice agent: ${agentConfig.agentId || 'not configured'}. Offline text chat mode: ${offlineModeEnabled ? 'enabled' : 'disabled'}.${
                      voiceSettingsChanged ? ' Start a new voice session to use the updated agent.' : ''
                    } Operator communications: ${operatorCommChannel}.`
                  );
                } catch (error: any) {
                  addSystemMessage(`Failed to save settings: ${error.message || 'Unknown error'}`);
                }
              }}
            >
              Save Settings
            </button>
          </div>
        </>
      )}

      {showDiaryViewer && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowDiaryViewer(false)}></div>
          <div className="artifact-viewer-modal diary-viewer-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">Emergent Diary</div>
                <div className="artifact-viewer-subtitle">
                  Narrative memory, reflections, and recent internal entries for the master Emergent.
                </div>
              </div>
              <div className="artifact-viewer-actions">
                <button
                  className="artifact-action-button"
                  onClick={() => void openDiaryViewer()}
                >
                  Refresh
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setShowDiaryViewer(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body diary-viewer-body">
              <div className="diary-viewer-column">
                <div className="diary-viewer-section-title">Narrative Snapshots</div>
                <div className="diary-viewer-scroll">
                  {masterNarratives.map((snapshot) => (
                    <div key={snapshot.id} className="diary-narrative-card diary-narrative-expanded">
                      <div className="diary-entry-header">
                        <span className="diary-entry-type">daily narrative</span>
                        <div className="diary-entry-header-right">
                          <button
                            className="diary-play-btn"
                            title={diaryAudioPlaying === snapshot.id ? 'Stop' : 'Play aloud'}
                            onClick={() => void playDiaryWithElevenLabs(snapshot.id, snapshot.narrative)}
                          >
                            {diaryAudioPlaying === snapshot.id ? '⏹' : '▶'}
                          </button>
                          <span className="diary-entry-time">{new Date(snapshot.updatedAt || snapshot.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="diary-narrative-day">{snapshot.narrativeDay}</div>
                      <div className="diary-narrative-text">{snapshot.narrative}</div>
                    </div>
                  ))}
                  {masterNarratives.length === 0 && (
                    <div className="settings-inline-note">No narrative snapshots yet.</div>
                  )}
                </div>
              </div>
              <div className="diary-viewer-column">
                <div className="diary-viewer-section-title">Diary Entries</div>
                <div className="diary-viewer-scroll">
                  {masterDiaryEntries.map((entry) => (
                    <div key={entry.id} className="diary-entry-card diary-entry-expanded">
                      <div className="diary-entry-header">
                        <span className="diary-entry-type">{entry.entryType.replace(/_/g, ' ')}</span>
                        <div className="diary-entry-header-right">
                          <button
                            className="diary-play-btn"
                            title={diaryAudioPlaying === entry.id ? 'Stop' : 'Play aloud'}
                            onClick={() => void playDiaryWithElevenLabs(entry.id, entry.content)}
                          >
                            {diaryAudioPlaying === entry.id ? '⏹' : '▶'}
                          </button>
                          <span className="diary-entry-time">{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      {entry.activityKey && (
                        <div className="diary-entry-activity">{entry.activityKey}</div>
                      )}
                      <div className="diary-entry-content">{entry.content}</div>
                    </div>
                  ))}
                  {masterDiaryEntries.length === 0 && (
                    <div className="settings-inline-note">No diary entries yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {showBugReportViewer && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowBugReportViewer(false)}></div>
          <div className="artifact-viewer-modal bug-report-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">Current Bugs</div>
                <div className="artifact-viewer-subtitle">
                  Structured failures with intended behavior, actual behavior, and suggested solutions.
                </div>
              </div>
              <div className="artifact-viewer-actions">
                <button className="artifact-action-button" onClick={() => void loadBugReports()} disabled={isLoadingBugReports}>
                  {isLoadingBugReports ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="artifact-action-button" onClick={() => void exportBugReportPdf()} disabled={isExportingBugReport}>
                  {isExportingBugReport ? 'Exporting…' : 'Export PDF'}
                </button>
                <button className="artifact-action-button" onClick={() => setShowBugReportViewer(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body bug-report-body">
              {bugReports.length === 0 ? (
                <div className="settings-inline-note">
                  {isLoadingBugReports ? 'Loading bug reports…' : 'No current bugs recorded.'}
                </div>
              ) : (
                <div className="bug-report-list">
                  {bugReports.map((report) => (
                    <div key={report.id} className={`bug-report-card severity-${report.severity || 'low'}`}>
                      <div className="bug-report-card-header">
                        <span className="bug-report-severity">{report.severity || 'low'}</span>
                        <span className="bug-report-status">{report.status || 'open'}</span>
                        <span className="bug-report-time">{report.createdAt ? new Date(report.createdAt).toLocaleString() : 'unknown time'}</span>
                      </div>
                      <div className="bug-report-intent">{report.intent}</div>
                      <div className="bug-report-grid">
                        <div>
                          <div className="bug-report-label">What happened</div>
                          <div className="bug-report-text">{report.actual}</div>
                        </div>
                        <div>
                          <div className="bug-report-label">Suggested solution</div>
                          <div className="bug-report-text">{report.suggestedSolution || 'Review the failing path and add a guarded recovery action.'}</div>
                        </div>
                      </div>
                      <div className="bug-report-source">{report.source}{report.sessionId ? ` · ${report.sessionId}` : ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showUsageViewer && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowUsageViewer(false)}></div>
          <div className="artifact-viewer-modal usage-stats-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">Provider Statistics</div>
                <div className="artifact-viewer-subtitle">
                  Tokens, provider spend, and ElevenLabs credit-driving activity across the current Nexus app.
                  {usageOverview?.generatedAt ? ` Refreshed ${new Date(usageOverview.generatedAt).toLocaleString()}.` : ''}
                </div>
              </div>
              <div className="artifact-viewer-actions">
                <button className="artifact-action-button" onClick={() => void loadUsageOverview()} disabled={isLoadingUsageOverview}>
                  {isLoadingUsageOverview ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="artifact-action-button" onClick={() => setShowUsageViewer(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body usage-stats-body">
              {!usageOverview ? (
                <div className="settings-inline-note">
                  {isLoadingUsageOverview ? 'Loading provider statistics…' : 'No provider statistics available yet.'}
                </div>
              ) : (
                <div className="usage-stats-grid">
                  <div className="usage-stats-card">
                    <div className="usage-stats-card-title">LLM Router Usage</div>
                    <div className="usage-stats-card-subtitle">
                      Router-tracked token usage and provider cost from the local `api_usage` ledger.
                    </div>
                    <div className="usage-stats-metrics">
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Requests</span>
                        <strong>{formatUsageNumber(usageOverview.llm.requestCount)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Input Tokens</span>
                        <strong>{formatUsageNumber(usageOverview.llm.tokensIn)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Output Tokens</span>
                        <strong>{formatUsageNumber(usageOverview.llm.tokensOut)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Total Cost</span>
                        <strong>{formatUsageCurrency(usageOverview.llm.totalCost)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Today</span>
                        <strong>{formatUsageCurrency(usageOverview.llm.todayCost)}</strong>
                      </div>
                    </div>
                    <div className="usage-stats-row-list">
                      {usageOverview.llm.providers.map((provider) => (
                        <div key={provider.provider} className="usage-stats-row">
                          <div>
                            <div className="usage-stats-row-label">{provider.provider}</div>
                            <div className="usage-stats-row-meta">
                              {formatUsageNumber(provider.totalTokens)} tokens across {formatUsageNumber(provider.requestCount)} requests
                            </div>
                          </div>
                          <strong>{formatUsageCurrency(provider.totalCost)}</strong>
                        </div>
                      ))}
                      {usageOverview.llm.providers.length === 0 && (
                        <div className="settings-inline-note">No router-tracked LLM usage has been recorded yet.</div>
                      )}
                    </div>
                    {usageOverview.llm.note && (
                      <div className="usage-stats-footnote">{usageOverview.llm.note}</div>
                    )}
                  </div>

                  <div className="usage-stats-card">
                    <div className="usage-stats-card-title">ElevenLabs Account Usage</div>
                    <div className="usage-stats-card-subtitle">
                      Exact remote usage fetched from ElevenLabs using the saved API key.
                    </div>
                    {usageOverview.elevenlabs.account ? (
                      <>
                        <div className="usage-stats-metrics">
                          <div className="usage-stats-metric">
                            <span className="usage-stats-metric-label">Tier</span>
                            <strong>{usageOverview.elevenlabs.account.tier}</strong>
                          </div>
                          <div className="usage-stats-metric">
                            <span className="usage-stats-metric-label">Status</span>
                            <strong>{usageOverview.elevenlabs.account.status}</strong>
                          </div>
                          <div className="usage-stats-metric">
                            <span className="usage-stats-metric-label">Cycle Chars</span>
                            <strong>{formatUsageNumber(usageOverview.elevenlabs.account.characterCount)}</strong>
                          </div>
                          <div className="usage-stats-metric">
                            <span className="usage-stats-metric-label">Char Limit</span>
                            <strong>{formatUsageNumber(usageOverview.elevenlabs.account.characterLimit)}</strong>
                          </div>
                          <div className="usage-stats-metric">
                            <span className="usage-stats-metric-label">Chars Left</span>
                            <strong>{formatUsageNumber(usageOverview.elevenlabs.account.remainingCharacters)}</strong>
                          </div>
                          <div className="usage-stats-metric">
                            <span className="usage-stats-metric-label">Cycle %</span>
                            <strong>{Math.round(Number(usageOverview.elevenlabs.account.percentUsed || 0))}%</strong>
                          </div>
                        </div>
                        <div className="usage-stats-footnote">
                          Reset: {formatUsageReset(usageOverview.elevenlabs.account.nextResetUnix)}
                        </div>
                        {usageOverview.elevenlabs.recent && (
                          <>
                            <div className="usage-stats-section-title">Last 7 Days</div>
                            <div className="usage-stats-metrics">
                              <div className="usage-stats-metric">
                                <span className="usage-stats-metric-label">Credits</span>
                                <strong>{formatUsageNumber(usageOverview.elevenlabs.recent.credits)}</strong>
                              </div>
                              <div className="usage-stats-metric">
                                <span className="usage-stats-metric-label">Characters</span>
                                <strong>{formatUsageNumber(usageOverview.elevenlabs.recent.characters)}</strong>
                              </div>
                              <div className="usage-stats-metric">
                                <span className="usage-stats-metric-label">Requests</span>
                                <strong>{formatUsageNumber(usageOverview.elevenlabs.recent.requestCount)}</strong>
                              </div>
                              <div className="usage-stats-metric">
                                <span className="usage-stats-metric-label">Duration</span>
                                <strong>{formatUsageMinutes(usageOverview.elevenlabs.recent.minutesUsed)}</strong>
                              </div>
                              <div className="usage-stats-metric">
                                <span className="usage-stats-metric-label">Spend</span>
                                <strong>{formatUsageCurrency(usageOverview.elevenlabs.recent.fiatUnitsSpent)}</strong>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <div className="settings-inline-note">
                        {usageOverview.elevenlabs.remoteError || 'ElevenLabs account usage is not available.'}
                      </div>
                    )}

                    <div className="usage-stats-section-title">Daily Credit Series</div>
                    <div className="usage-stats-row-list">
                      {usageOverview.elevenlabs.dailyCredits.map((point, index) => (
                        <div key={point.timestamp} className="usage-stats-row">
                          <div>
                            <div className="usage-stats-row-label">
                              {new Date(point.timestamp).toLocaleDateString()}
                            </div>
                            <div className="usage-stats-row-meta">
                              {formatUsageNumber(usageOverview.elevenlabs.dailyCharacters[index]?.value || 0)} chars
                            </div>
                          </div>
                          <strong>{formatUsageNumber(point.value)} cr</strong>
                        </div>
                      ))}
                      {usageOverview.elevenlabs.dailyCredits.length === 0 && (
                        <div className="settings-inline-note">No daily ElevenLabs credit series is available yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="usage-stats-card">
                    <div className="usage-stats-card-title">ElevenLabs In-App Activity</div>
                    <div className="usage-stats-card-subtitle">
                      Local app-level counts for flows that call ElevenLabs directly. These are not the source of truth for billed credits.
                    </div>
                    <div className="usage-stats-metrics">
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Tracked Calls</span>
                        <strong>{formatUsageNumber(usageOverview.elevenlabs.local.requestCount)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Voice Sessions</span>
                        <strong>{formatUsageNumber(usageOverview.elevenlabs.local.conversationSessionCount)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">TTS Calls</span>
                        <strong>{formatUsageNumber(usageOverview.elevenlabs.local.ttsRequestCount)}</strong>
                      </div>
                      <div className="usage-stats-metric">
                        <span className="usage-stats-metric-label">Tracked TTS Chars</span>
                        <strong>{formatUsageNumber(usageOverview.elevenlabs.local.characterCount)}</strong>
                      </div>
                    </div>
                    <div className="usage-stats-row-list">
                      {usageOverview.elevenlabs.breakdown.map((entry) => (
                        <div key={`${entry.product}:${entry.operation}:${entry.unit}`} className="usage-stats-row">
                          <div>
                            <div className="usage-stats-row-label">{entry.label}</div>
                            <div className="usage-stats-row-meta">
                              {formatUsageNumber(entry.requestCount)} events
                              {entry.unit === 'characters' ? ` · ${formatUsageNumber(entry.quantity)} chars` : ''}
                              {entry.lastUsedAt ? ` · ${new Date(entry.lastUsedAt).toLocaleString()}` : ''}
                            </div>
                          </div>
                          <strong>
                            {entry.unit === 'characters'
                              ? `${formatUsageNumber(entry.quantity)} chars`
                              : formatUsageNumber(entry.quantity)}
                          </strong>
                        </div>
                      ))}
                      {usageOverview.elevenlabs.breakdown.length === 0 && (
                        <div className="settings-inline-note">No local ElevenLabs events have been recorded yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="usage-stats-card">
                    <div className="usage-stats-card-title">What Uses ElevenLabs</div>
                    <div className="usage-stats-card-subtitle">
                      The app paths currently capable of consuming ElevenLabs credits.
                    </div>
                    <div className="usage-stats-note-list">
                      {usageOverview.elevenlabs.notes.map((note) => (
                        <div key={note} className="usage-stats-note">{note}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {presentationDeck && (() => {
        const slide = presentationDeck.slides[presentationSlideIndex] || presentationDeck.slides[0];
        return (
          <>
            <div className="artifact-viewer-overlay" onClick={() => applyPresentationControl({ action: 'pause' })}></div>
            <div className="artifact-viewer-modal presentation-mode-modal">
              <div className="artifact-viewer-header">
                <div>
                  <div className="artifact-viewer-title">{presentationDeck.title}</div>
                  <div className="artifact-viewer-subtitle">
                    Slide {presentationSlideIndex + 1} of {presentationDeck.slideCount} · {presentationStatus}
                  </div>
                </div>
                <div className="artifact-viewer-actions">
                  <button className="artifact-action-button" onClick={() => applyPresentationControl({ action: 'previous' })}>
                    Previous
                  </button>
                  <button className="artifact-action-button" onClick={() => applyPresentationControl({ action: presentationStatus === 'presenting' ? 'pause' : 'resume' })}>
                    {presentationStatus === 'presenting' ? 'Pause' : 'Resume'}
                  </button>
                  <button className="artifact-action-button" onClick={() => applyPresentationControl({ action: 'next' })}>
                    Next
                  </button>
                  <button className="artifact-action-button" onClick={() => applyPresentationControl({ action: 'end' })}>
                    End
                  </button>
                </div>
              </div>
              <div className="artifact-viewer-body presentation-mode-body">
                <div className="presentation-slide-stage">
                  {slide?.imageDataUrl ? (
                    <img className="presentation-slide-image" src={slide.imageDataUrl} alt={`Slide ${slide.slideNumber}`} />
                  ) : (
                    <div className="presentation-slide-fallback">
                      <div>{slide?.title || 'Slide'}</div>
                      <small>No slide image preview is available.</small>
                    </div>
                  )}
                </div>
                <aside className="presentation-speaker-panel">
                  <div className="presentation-progress">
                    {presentationDeck.slides.map((candidate, index) => (
                      <button
                        key={candidate.slideNumber}
                        className={`presentation-dot ${index === presentationSlideIndex ? 'active' : ''}`}
                        onClick={() => applyPresentationControl({ action: 'go_to', slideNumber: candidate.slideNumber })}
                        aria-label={`Go to slide ${candidate.slideNumber}`}
                      />
                    ))}
                  </div>
                  <div className="presentation-panel-label">Talking Point</div>
                  <h3>{slide?.title}</h3>
                  {slide?.subtitle && <p className="presentation-subtitle">{slide.subtitle}</p>}
                  <div className="presentation-key-message">{slide?.keyMessage}</div>
                  <div className="presentation-script">{slide?.speakerNotes}</div>
                  {slide?.reviewFixes?.length > 0 && (
                    <div className="presentation-review">
                      <strong>QA fixes applied</strong>
                      {slide.reviewFixes.slice(0, 4).map((fix) => (
                        <span key={fix}>{fix}</span>
                      ))}
                    </div>
                  )}
                  <div className="presentation-footer-meta">
                    <span>{presentationDeck.footerText}</span>
                    <span>{slide?.imagePath || presentationDeck.manifestPath}</span>
                  </div>
                </aside>
              </div>
            </div>
          </>
        );
      })()}

      {artifactViewer && !(activeSurfaceTabId === 'workspace' && activeWorkspaceStageTab.type === 'artifact') && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setArtifactViewer(null)}></div>
          <div className="artifact-viewer-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">{artifactViewer.name}</div>
                <div className="artifact-viewer-subtitle">{artifactViewer.path}</div>
              </div>
              <div className="artifact-viewer-actions">
                {artifactViewer.kind === 'text' && (
                  <button
                    className="artifact-action-button"
                    onClick={() => void copyTextValue(
                      artifactViewer.textContent || '',
                      `artifact-text:${artifactViewer.path}`
                    )}
                    disabled={!String(artifactViewer.textContent || '').trim()}
                  >
                    {copiedTextKey === `artifact-text:${artifactViewer.path}` ? 'Copied' : 'Copy Text'}
                  </button>
                )}
                <button
                  className="artifact-action-button"
                  onClick={() => void revealArtifact(artifactViewer.path)}
                >
                  Reveal File
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setArtifactViewer(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body">
              {artifactViewer.kind === 'image' ? (
                <img
                  className="artifact-image"
                  src={artifactViewer.dataUrl}
                  alt={artifactViewer.name}
                />
              ) : artifactViewer.kind === 'video' ? (
                <div className="artifact-video-viewer">
                  <video
                    className="artifact-video-player"
                    src={artifactViewer.dataUrl}
                    controls
                    preload="metadata"
                  />
                </div>
              ) : artifactViewer.kind === 'audio' ? (
                <div className="artifact-audio-viewer">
                  <audio
                    className="artifact-audio-player"
                    src={artifactViewer.dataUrl}
                    controls
                    preload="metadata"
                  />
                </div>
              ) : artifactViewer.kind === 'spreadsheet' ? (
                <div className="spreadsheet-viewer">
                  <div className="spreadsheet-summary">
                    {artifactViewer.spreadsheetData?.summary || 'Spreadsheet loaded.'}
                  </div>
                  <div className="spreadsheet-sheet-tabs">
                    {(artifactViewer.spreadsheetData?.sheets || []).map((sheet) => (
                      <button
                        key={sheet.name}
                        className={`spreadsheet-sheet-tab ${activeSpreadsheetSheet === sheet.name ? 'active' : ''}`}
                        onClick={() => setActiveSpreadsheetSheet(sheet.name)}
                      >
                        {sheet.name}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const sheets = artifactViewer.spreadsheetData?.sheets || [];
                    const selectedSheet = sheets.find((sheet) => sheet.name === activeSpreadsheetSheet) || sheets[0];

                    if (!selectedSheet) {
                      return <div className="settings-inline-note">No spreadsheet rows available.</div>;
                    }

                    return (
                      <>
                        <div className="spreadsheet-toolbar">
                          <div className="spreadsheet-toolbar-group">
                            <input
                              className="spreadsheet-toolbar-input"
                              type="text"
                              value={spreadsheetFilterQuery}
                              placeholder="Filter rows, e.g. operator=CHEVRON county=REEVES"
                              onChange={(event) => setSpreadsheetFilterQuery(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void applySpreadsheetFilter();
                                }
                              }}
                            />
                            <button className="spreadsheet-toolbar-button" onClick={() => void applySpreadsheetFilter()}>
                              Apply Filter
                            </button>
                            <button className="spreadsheet-toolbar-button secondary" onClick={() => void resetSpreadsheetView()}>
                              Reset View
                            </button>
                          </div>
                          <div className="spreadsheet-toolbar-group">
                            <select
                              className="spreadsheet-toolbar-select"
                              value={spreadsheetSortColumn}
                              onChange={(event) => setSpreadsheetSortColumn(event.target.value)}
                            >
                              <option value="">Sort column</option>
                              {selectedSheet.headers.map((header) => (
                                <option key={header} value={header}>{header}</option>
                              ))}
                            </select>
                            <select
                              className="spreadsheet-toolbar-select"
                              value={spreadsheetSortDirection}
                              onChange={(event) => setSpreadsheetSortDirection(event.target.value === 'desc' ? 'desc' : 'asc')}
                            >
                              <option value="asc">Ascending</option>
                              <option value="desc">Descending</option>
                            </select>
                            <button
                              className="spreadsheet-toolbar-button"
                              onClick={() => void applySpreadsheetSort()}
                              disabled={!spreadsheetSortColumn}
                            >
                              Apply Sort
                            </button>
                          </div>
                          <div className="spreadsheet-toolbar-group">
                            <select
                              className="spreadsheet-toolbar-select"
                              value={spreadsheetExportFormat}
                              onChange={(event) => setSpreadsheetExportFormat(event.target.value as typeof spreadsheetExportFormat)}
                            >
                              <option value="xlsx">XLSX</option>
                              <option value="xls">XLS</option>
                              <option value="csv">CSV</option>
                              <option value="tsv">TSV</option>
                              <option value="json">JSON</option>
                            </select>
                            <button className="spreadsheet-toolbar-button" onClick={() => void exportSpreadsheetView()}>
                              Export
                            </button>
                          </div>
                          <div className="spreadsheet-toolbar-group">
                            <select
                              className="spreadsheet-toolbar-select"
                              value={spreadsheetChartType}
                              onChange={(event) => setSpreadsheetChartType(event.target.value === 'line' ? 'line' : 'bar')}
                            >
                              <option value="bar">Bar chart</option>
                              <option value="line">Line chart</option>
                            </select>
                            <select
                              className="spreadsheet-toolbar-select"
                              value={spreadsheetChartLabelColumn}
                              onChange={(event) => setSpreadsheetChartLabelColumn(event.target.value)}
                            >
                              <option value="">Label column</option>
                              {selectedSheet.headers.map((header) => (
                                <option key={`label-${header}`} value={header}>{header}</option>
                              ))}
                            </select>
                            <select
                              className="spreadsheet-toolbar-select"
                              value={spreadsheetChartValueColumn}
                              onChange={(event) => setSpreadsheetChartValueColumn(event.target.value)}
                            >
                              <option value="">Value column</option>
                              {selectedSheet.headers.map((header) => (
                                <option key={`value-${header}`} value={header}>{header}</option>
                              ))}
                            </select>
                            <button
                              className="spreadsheet-toolbar-button"
                              onClick={() => void generateSpreadsheetChartView()}
                              disabled={!spreadsheetChartLabelColumn || !spreadsheetChartValueColumn}
                            >
                              Generate Chart
                            </button>
                          </div>
                        </div>
                        <div className="spreadsheet-meta">
                          <span>{selectedSheet.rowCount} rows</span>
                          <span>{selectedSheet.columnCount} columns</span>
                          {selectedSheet.truncated && <span>Preview limited</span>}
                          {spreadsheetOperationLabel && (
                            <span className="spreadsheet-toolbar-status">{spreadsheetOperationLabel}</span>
                          )}
                        </div>
                        <div className="spreadsheet-table-wrap">
                          <table className="spreadsheet-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                {selectedSheet.headers.map((header) => (
                                  <th key={header}>{header}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedSheet.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={selectedSheet.headers.length + 1}>
                                    <div className="settings-inline-note">No rows match the current view.</div>
                                  </td>
                                </tr>
                              ) : selectedSheet.rows.map((row, rowIndex) => {
                                const resolvedRowIndex = Number.isFinite(Number(row.__rowIndex))
                                  ? Number(row.__rowIndex)
                                  : rowIndex;
                                const displayRowNumber = resolvedRowIndex + 2;

                                return (
                                  <tr key={`${selectedSheet.name}-${resolvedRowIndex}`}>
                                    <td className="spreadsheet-row-index">{displayRowNumber}</td>
                                    {selectedSheet.headers.map((header) => {
                                      const isEditing = spreadsheetEditor?.sheetName === selectedSheet.name
                                        && spreadsheetEditor?.rowIndex === resolvedRowIndex
                                        && spreadsheetEditor?.column === header;

                                      return (
                                        <td key={`${selectedSheet.name}-${resolvedRowIndex}-${header}`}>
                                          {isEditing ? (
                                            <div className="spreadsheet-cell-editor">
                                              <input
                                                className="spreadsheet-cell-input"
                                                type="text"
                                                value={spreadsheetEditor.value}
                                                autoFocus
                                                onChange={(event) => setSpreadsheetEditor((previous) => (
                                                  previous
                                                    ? { ...previous, value: event.target.value }
                                                    : previous
                                                ))}
                                                onKeyDown={(event) => {
                                                  if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    void saveSpreadsheetCellEdit();
                                                  }
                                                  if (event.key === 'Escape') {
                                                    setSpreadsheetEditor(null);
                                                  }
                                                }}
                                              />
                                              <div className="spreadsheet-cell-actions">
                                                <button className="spreadsheet-inline-button" onClick={() => void saveSpreadsheetCellEdit()}>
                                                  Save
                                                </button>
                                                <button
                                                  className="spreadsheet-inline-button secondary"
                                                  onClick={() => setSpreadsheetEditor(null)}
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <button
                                              className="spreadsheet-cell-button"
                                              onClick={() => setSpreadsheetEditor({
                                                sheetName: selectedSheet.name,
                                                rowIndex: resolvedRowIndex,
                                                column: header,
                                                value: String(row[header] ?? ''),
                                              })}
                                            >
                                              {String(row[header] ?? '')}
                                            </button>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : artifactViewer.kind === 'text' ? (
                <pre className="artifact-text-viewer">{artifactViewer.textContent || ''}</pre>
              ) : (
                <iframe
                  className="artifact-frame"
                  src={artifactViewer.dataUrl}
                  title={artifactViewer.name}
                />
              )}
            </div>
          </div>
        </>
      )}

      {showRollingTodoModal && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowRollingTodoModal(false)}></div>
          <div className="artifact-viewer-modal rolling-todo-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">Task Queue</div>
                <div className="artifact-viewer-subtitle">
                  Agent-managed top two moves for {rollingTodoBoard?.projectName || currentProject?.name || currentSession?.name || 'this workspace'}
                </div>
              </div>
              <div className="artifact-viewer-actions">
                <button
                  className="artifact-action-button"
                  onClick={() => void refreshRollingTodoBoard(currentSession?.id, { force: true, reason: 'manual_refresh', silent: false })}
                  disabled={!currentSession || isRollingTodoRefreshing}
                >
                  {isRollingTodoRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => void exportRollingTodoPdf()}
                  disabled={!currentSession || isRollingTodoExporting}
                >
                  {isRollingTodoExporting ? 'Exporting…' : 'Export PDF'}
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setShowRollingTodoModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body rolling-todo-body">
              {!currentSession ? (
                <div className="settings-inline-note">
                  Create or select a session before using the task queue.
                </div>
              ) : isRollingTodoLoading && !rollingTodoBoard ? (
                <div className="brainstorm-processing-card">
                  <span className="tool-spinner" aria-hidden="true"></span>
                  <span>Generating the top two moves for this session…</span>
                </div>
              ) : rollingTodoBoard ? (
                <>
                  <div className="rolling-todo-overview">
                    <div className="rolling-todo-summary">
                      <div className="rolling-todo-summary-label">Board Summary</div>
                      <div className="rolling-todo-summary-text">{rollingTodoBoard.summary}</div>
                    </div>
                    <div className="rolling-todo-summary-meta">
                      <div><span>Session</span><strong>{rollingTodoBoard.sessionName}</strong></div>
                      <div><span>Project</span><strong>{rollingTodoBoard.projectName || 'Not linked yet'}</strong></div>
                      <div><span>Reminder Window</span><strong>{rollingTodoBoard.remindIntervalMinutes} min</strong></div>
                    </div>
                  </div>

                  <div className="rolling-todo-grid">
                    {rollingTodoBoard.items.slice(0, 2).map((item) => {
                      const draft = rollingTodoDrafts[item.slotIndex] || {
                        userTitle: item.userTitle || '',
                        userNextAction: item.userNextAction || '',
                        userNotes: item.userNotes || '',
                        owner: item.owner || 'shared',
                        status: item.status || 'pending',
                        needsUser: Boolean(item.needsUser),
                        canAgentHelp: Boolean(item.canAgentHelp),
                        isPinned: Boolean(item.isPinned),
                        remindAfterMinutes: inferRollingTodoReminderMinutes(item.remindAfterAt),
                      };

                      return (
                        <div key={item.id} className="rolling-todo-card">
                          <div className="rolling-todo-card-header">
                            <div>
                              <div className="rolling-todo-card-slot">Item {item.slotIndex + 1}</div>
                              <div className="rolling-todo-card-title">{item.title}</div>
                            </div>
                            <span className={`rolling-todo-status-pill ${item.status}`}>{item.status.replace(/_/g, ' ')}</span>
                          </div>

                          {/* ── Agent Intel Zone (read-only) ── */}
                          <div className="tq-zone tq-zone-agent">
                            <div className="tq-zone-label">Agent Intel</div>
                            <div className="rolling-todo-agent-reason">{item.reason}</div>
                            <div className="rolling-todo-agent-suggestion">
                              <div className="rolling-todo-agent-copy">
                                <strong>{item.agentTitle || item.title}</strong>
                                <span>{item.agentNextAction || item.nextAction}</span>
                              </div>
                            </div>
                          </div>

                          {/* ── Your Controls (interactive) ── */}
                          <div className="tq-zone tq-zone-user">
                            <div className="tq-zone-label">Your Controls</div>

                            <div className="rolling-todo-field-grid">
                              <label className="rolling-todo-field">
                                <span>Title Override</span>
                                <input
                                  className="settings-input"
                                  type="text"
                                  value={draft.userTitle}
                                  placeholder={item.agentTitle || item.title}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'userTitle', event.target.value)}
                                />
                              </label>
                              <label className="rolling-todo-field">
                                <span>Next Action Override</span>
                                <textarea
                                  className="settings-input rolling-todo-textarea"
                                  value={draft.userNextAction}
                                  placeholder={item.agentNextAction || item.nextAction}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'userNextAction', event.target.value)}
                                />
                              </label>
                              <label className="rolling-todo-field">
                                <span>User Notes</span>
                                <textarea
                                  className="settings-input rolling-todo-textarea"
                                  value={draft.userNotes}
                                  placeholder="Constraints, approvals, extra context, or what you want the agent to preserve"
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'userNotes', event.target.value)}
                                />
                              </label>
                            </div>

                            <div className="rolling-todo-control-grid">
                              <label className="rolling-todo-field">
                                <span>Owner</span>
                                <select
                                  className="settings-input"
                                  value={draft.owner}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'owner', event.target.value as RollingTodoOwner)}
                                >
                                  <option value="agent">Agent</option>
                                  <option value="shared">Shared</option>
                                  <option value="user">User</option>
                                </select>
                              </label>
                              <label className="rolling-todo-field">
                                <span>Status</span>
                                <select
                                  className="settings-input"
                                  value={draft.status}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'status', event.target.value as RollingTodoStatus)}
                                >
                                  <option value="pending">Pending</option>
                                  <option value="ready">Ready</option>
                                  <option value="blocked">Blocked</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="done">Done</option>
                                </select>
                              </label>
                              <label className="rolling-todo-field">
                                <span>Reminder</span>
                                <input
                                  className="settings-input"
                                  type="number"
                                  min={15}
                                  max={240}
                                  step={5}
                                  value={draft.remindAfterMinutes}
                                  onChange={(event) => updateRollingTodoDraft(
                                    item.slotIndex,
                                    'remindAfterMinutes',
                                    Math.max(15, Math.min(240, Number(event.target.value) || 45))
                                  )}
                                />
                              </label>
                            </div>

                            <div className="rolling-todo-toggle-row">
                              <label className="rolling-todo-checkbox">
                                <input
                                  type="checkbox"
                                  checked={draft.isPinned}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'isPinned', event.target.checked)}
                                />
                                <span>Pin this item</span>
                              </label>
                              <label className="rolling-todo-checkbox">
                                <input
                                  type="checkbox"
                                  checked={draft.needsUser}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'needsUser', event.target.checked)}
                                />
                                <span>Needs your input</span>
                              </label>
                              <label className="rolling-todo-checkbox">
                                <input
                                  type="checkbox"
                                  checked={draft.canAgentHelp}
                                  onChange={(event) => updateRollingTodoDraft(item.slotIndex, 'canAgentHelp', event.target.checked)}
                                />
                                <span>Agent can help</span>
                              </label>
                            </div>

                            <div className="rolling-todo-card-actions">
                              <button
                                className="artifact-action-button primary"
                                onClick={() => void saveRollingTodoItem(item.slotIndex)}
                                disabled={rollingTodoSavingSlot === item.slotIndex}
                              >
                                {rollingTodoSavingSlot === item.slotIndex ? 'Saving…' : 'Save Item'}
                              </button>
                              <button
                                className="artifact-action-button"
                                onClick={() => void handleSendMessage(
                                  `Push forward task queue item ${item.slotIndex + 1}: ${draft.userTitle || item.title}. Next action: ${draft.userNextAction || item.nextAction}. Use the project context, do the next agent-owned step you can, and tell me exactly what I still need to do if this is blocked on me.`
                                )}
                              >
                                Push Forward
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rolling-todo-email-row">
                    <label className="rolling-todo-field">
                      <span>Email Recipient</span>
                      <input
                        className="settings-input"
                        type="email"
                        value={rollingTodoRecipient}
                        placeholder="you@example.com"
                        onChange={(event) => setRollingTodoRecipient(event.target.value)}
                      />
                    </label>
                    <label className="rolling-todo-field">
                      <span>Email Subject</span>
                      <input
                        className="settings-input"
                        type="text"
                        value={rollingTodoEmailSubject}
                        placeholder={`${rollingTodoBoard.sessionName} — Task Queue`}
                        onChange={(event) => setRollingTodoEmailSubject(event.target.value)}
                      />
                    </label>
                    <button
                      className="artifact-action-button"
                      onClick={() => void emailRollingTodoPdf()}
                      disabled={isRollingTodoEmailing}
                    >
                      {isRollingTodoEmailing ? 'Sending…' : 'Email PDF'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="settings-inline-note">
                  The task queue has not been generated yet.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {agentWorkflowViewer && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setAgentWorkflowViewer(null)}></div>
          <div className="artifact-viewer-modal agent-workflow-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">{agentWorkflowViewer.agent.name}</div>
                <div className="artifact-viewer-subtitle">
                  {agentWorkflowViewer.agent.role} workflow, runs, tasks, pipelines, and tool calls
                </div>
              </div>
              <div className="artifact-viewer-actions">
                <button
                  className="artifact-action-button"
                  onClick={() => void openAgentWorkflow(agentWorkflowViewer.agent)}
                >
                  Refresh
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setAgentWorkflowViewer(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body agent-workflow-body">
              <div className="agent-workflow-summary-grid">
                <div className="agent-workflow-metric"><span>{agentWorkflowViewer.runs.length}</span> Runs</div>
                <div className="agent-workflow-metric"><span>{agentWorkflowViewer.tasks.length}</span> Tasks</div>
                <div className="agent-workflow-metric"><span>{agentWorkflowViewer.pipelines.length}</span> Pipelines</div>
                <div className="agent-workflow-metric"><span>{agentWorkflowViewer.toolCalls.length}</span> Tool Calls</div>
              </div>

              {agentWorkflowViewer.agent.description && (
                <div className="agent-workflow-section">
                  <div className="agent-workflow-section-title">Agent Goal</div>
                  <div className="agent-workflow-note">{agentWorkflowViewer.agent.description}</div>
                </div>
              )}

              <div className="agent-workflow-grid">
                <div className="agent-workflow-section">
                  <div className="agent-workflow-section-title">Pipeline</div>
                  {agentWorkflowViewer.pipelines.length === 0 ? (
                    <div className="agent-workflow-empty">No related pipeline has been saved for this agent yet.</div>
                  ) : (
                    <div className="agent-workflow-list">
                      {agentWorkflowViewer.pipelines.map((pipeline) => (
                        <button
                          key={pipeline.id}
                          type="button"
                          className="agent-workflow-item agent-workflow-item-button"
                          onClick={() => {
                            setPipelineViewer(pipeline);
                            setAgentWorkflowViewer(null);
                          }}
                        >
                          <div className="agent-workflow-item-title">{pipeline.name}</div>
                          <div className="agent-workflow-meta">{pipeline.sessionName || pipeline.status || 'Pipeline'}</div>
                          <div className="agent-workflow-stages">
                            {pipeline.stages.map((stage, index) => (
                              <span key={`${pipeline.id}-stage-${index}`} className={`agent-workflow-stage ${stage.status}`}>{stage.name}</span>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="agent-workflow-section">
                  <div className="agent-workflow-section-title">Recent Runs</div>
                  {agentWorkflowViewer.runs.length === 0 ? (
                    <div className="agent-workflow-empty">No recent runs recorded.</div>
                  ) : (
                    <div className="agent-workflow-list">
                      {agentWorkflowViewer.runs.slice(0, 6).map((run) => (
                        <div key={run.id} className="agent-workflow-item">
                          <div className="agent-workflow-item-title">{run.status || 'run'} · {run.sessionName || 'session'}</div>
                          <div className="agent-workflow-preview">{truncateDisplayText(String(run.input || run.output || ''), 220)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="agent-workflow-section">
                  <div className="agent-workflow-section-title">Assigned Tasks</div>
                  {agentWorkflowViewer.tasks.length === 0 ? (
                    <div className="agent-workflow-empty">No assigned tasks found.</div>
                  ) : (
                    <div className="agent-workflow-list">
                      {agentWorkflowViewer.tasks.slice(0, 8).map((task) => (
                        <div key={task.id} className="agent-workflow-item">
                          <div className="agent-workflow-item-title">{task.title}</div>
                          <div className="agent-workflow-meta">{task.status} · {task.priority} priority</div>
                          {task.result && <div className="agent-workflow-preview">{truncateDisplayText(task.result, 180)}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="agent-workflow-section">
                  <div className="agent-workflow-section-title">Tool Calls</div>
                  {agentWorkflowViewer.toolCalls.length === 0 ? (
                    <div className="agent-workflow-empty">No tool calls recorded.</div>
                  ) : (
                    <div className="agent-workflow-list">
                      {agentWorkflowViewer.toolCalls.slice(0, 8).map((toolCall) => (
                        <div key={toolCall.id} className="agent-workflow-item">
                          <div className="agent-workflow-item-title">{toolCall.toolName || 'tool'} · {toolCall.status || 'unknown'}</div>
                          <div className="agent-workflow-preview">{truncateDisplayText(String(toolCall.output || toolCall.input || ''), 180)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {agentWorkflowViewer.childAgents.length > 0 && (
                <div className="agent-workflow-section">
                  <div className="agent-workflow-section-title">Child Agents</div>
                  <div className="agent-workflow-child-grid">
                    {agentWorkflowViewer.childAgents.map((child) => (
                      <button key={child.id} className="agent-workflow-child" onClick={() => void openAgentWorkflow(child)}>
                        <span>{child.name}</span>
                        <small>{child.role}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {pipelineViewer && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setPipelineViewer(null)}></div>
          <div className="artifact-viewer-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">{pipelineViewer.name}</div>
                <div className="artifact-viewer-subtitle">Pipeline progress and stage status</div>
              </div>
              <div className="artifact-viewer-actions">
                <button
                  className="artifact-action-button"
                  onClick={() => void materializeTextArtifactViewer(
                    `${pipelineViewer.name} Pipeline Status`,
                    [
                      `# ${pipelineViewer.name}`,
                      '',
                      `Progress: ${pipelineViewer.progress}%`,
                      '',
                      '## Stages',
                      ...pipelineViewer.stages.map((stage) => `- ${stage.name}: ${stage.status}`),
                    ].join('\n'),
                    `pipeline:${pipelineViewer.id}`
                  )}
                >
                  Open In Viewer
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setPipelineViewer(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body">
              <div className="pipeline-viewer-body">
                <div className="pipeline-viewer-progress">Progress: {pipelineViewer.progress}%</div>
                <div className="pipeline-viewer-stage-list">
                  {pipelineViewer.stages.map((stage, index) => (
                    <div key={`${pipelineViewer.id}-${index}`} className={`pipeline-viewer-stage-card ${stage.status}`}>
                      <div className="pipeline-viewer-stage-name">{stage.name}</div>
                      <div className="pipeline-viewer-stage-status">{stage.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {diagramViewer && (
        <DiagramViewer diagram={diagramViewer} onClose={() => setDiagramViewer(null)} />
      )}

      {ytSelectedTranscript && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setYtSelectedTranscript(null)}></div>
          <div className="artifact-viewer-modal yt-transcript-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">{ytSelectedTranscript.video_title || ytSelectedTranscript.video_id}</div>
                <div className="artifact-viewer-subtitle">{ytSelectedTranscript.video_url}</div>
              </div>
              <div className="artifact-viewer-actions">
                <button
                  className="artifact-action-button"
                  onClick={() => window.open(ytSelectedTranscript.video_url, '_blank', 'noopener,noreferrer')}
                >
                  Open In YouTube
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => void exportYouTubeTranscriptPdf(ytSelectedTranscript)}
                  disabled={ytExportingTranscriptId === ytSelectedTranscript.id}
                >
                  {ytExportingTranscriptId === ytSelectedTranscript.id ? 'Creating PDF…' : 'Download PDF'}
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setYtSelectedTranscript(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body yt-transcript-viewer-body">
              <div className="yt-transcript-summary-pane">
                <div className="yt-transcript-section">
                  <div className="yt-transcript-section-title-row">
                    <div className="yt-transcript-section-title">Summary</div>
                    <button
                      type="button"
                      className="inline-copy-button"
                      onClick={() => void copyTextValue(
                        ytSelectedTranscript.summary_text || 'No summary available yet.',
                        `yt-summary:${ytSelectedTranscript.id}`
                      )}
                    >
                      <Icon
                        name={copiedTextKey === `yt-summary:${ytSelectedTranscript.id}` ? 'check' : 'clipboard'}
                        size={12}
                      />
                      <span>{copiedTextKey === `yt-summary:${ytSelectedTranscript.id}` ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="yt-transcript-summary-block">
                    {ytSelectedTranscript.summary_text || 'No summary available yet.'}
                  </div>
                </div>
                <div className="yt-transcript-section">
                  <div className="yt-transcript-section-title">Details</div>
                  <div className="yt-transcript-detail-grid">
                    <div className="yt-transcript-detail-card">
                      <span className="yt-transcript-detail-label">Duration</span>
                      <strong>{formatSecondsLabel(ytSelectedTranscript.duration_seconds)}</strong>
                    </div>
                    <div className="yt-transcript-detail-card">
                      <span className="yt-transcript-detail-label">Fetched</span>
                      <strong>{ytSelectedTranscript.fetched_at ? new Date(ytSelectedTranscript.fetched_at).toLocaleString() : 'Unknown'}</strong>
                    </div>
                    <div className="yt-transcript-detail-card">
                      <span className="yt-transcript-detail-label">Video ID</span>
                      <strong>{ytSelectedTranscript.video_id}</strong>
                    </div>
                    <div className="yt-transcript-detail-card">
                      <span className="yt-transcript-detail-label">Length</span>
                      <strong>{(ytSelectedTranscript.transcript_text || '').length.toLocaleString()} chars</strong>
                    </div>
                  </div>
                </div>
              </div>
              <div className="yt-transcript-content-pane">
                <div className="yt-transcript-section-title-row">
                  <div className="yt-transcript-section-title">Transcript</div>
                  <button
                    type="button"
                    className="inline-copy-button"
                    onClick={() => void copyTextValue(
                      ytSelectedTranscript.transcript_text || 'No transcript text available.',
                      `yt-transcript:${ytSelectedTranscript.id}`
                    )}
                  >
                    <Icon
                      name={copiedTextKey === `yt-transcript:${ytSelectedTranscript.id}` ? 'check' : 'clipboard'}
                      size={12}
                    />
                    <span>{copiedTextKey === `yt-transcript:${ytSelectedTranscript.id}` ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="yt-transcript-fulltext">
                  {ytSelectedTranscript.transcript_text || 'No transcript text available.'}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {youtubeViewer && !(activeSurfaceTabId === 'workspace' && activeWorkspaceStageTab.type === 'youtube') && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setYoutubeViewer(null)}></div>
          <div className="artifact-viewer-modal youtube-viewer-modal">
            <div className="artifact-viewer-header">
              <div>
                <div className="artifact-viewer-title">{youtubeViewer.title}</div>
                <div className="artifact-viewer-subtitle">{youtubeViewer.sourceUrl}</div>
              </div>
              <div className="artifact-viewer-actions">
                <button
                  className="artifact-action-button"
                  onClick={() => window.open(youtubeViewer.sourceUrl, '_blank', 'noopener,noreferrer')}
                >
                  Open In YouTube
                </button>
                <button
                  className="artifact-action-button"
                  onClick={() => setYoutubeViewer(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="artifact-viewer-body">
              <iframe
                className="artifact-frame youtube-frame"
                src={youtubeViewer.embedUrl}
                title={youtubeViewer.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </>
      )}

      {/* ═══════ Entity CRM Overlay ═══════ */}
      {showEntityCrm && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => { setShowEntityCrm(false); setCrmSelectedPerson(null); setCrmSelectedBusiness(null); }} />
          <div className="artifact-viewer-modal" style={{ width: '90%', maxWidth: 1200, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', inset: 'auto', top: '5vh', left: '50%', transform: 'translateX(-50%)' }}>
            <div className="artifact-viewer-header">
              <span className="artifact-viewer-title">
                Entity CRM — {crmCounts.people} People, {crmCounts.businesses} Businesses, {crmCounts.links} Relationships
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => { setCrmShowCreateForm(crmActiveTab === 'businesses' ? 'business' : 'person'); setCrmCreateData({}); }}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                  }}
                >+ Add New</button>
                <button
                  onClick={runEntityBackfill}
                  disabled={crmBackfillRunning}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: crmBackfillRunning ? 'default' : 'pointer',
                    background: crmBackfillRunning ? 'rgba(124, 58, 237, 0.2)' : 'linear-gradient(135deg, #7c3aed, #2563eb)',
                    color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                  }}
                >
                  {crmBackfillRunning ? 'Scanning...' : 'Scan Knowledge Base'}
                </button>
                <button className="artifact-close-btn" onClick={() => {
                  setShowEntityCrm(false);
                  setCrmSelectedPerson(null);
                  setCrmSelectedBusiness(null);
                  setCrmEditMode(false);
                  setCrmShowCreateForm(null);
                  setCrmDeleteConfirm(null);
                  setCrmMergeState(null);
                  setCrmMergeResults([]);
                  setCrmEntityKnowledge(null);
                }}>✕</button>
              </div>
            </div>

            {/* Backfill Progress */}
            {crmBackfillProgress && (
              <div style={{
                padding: '8px 20px', fontSize: 12,
                color: crmBackfillRunning ? '#a78bfa' : '#22c55e',
                background: crmBackfillRunning ? 'rgba(124, 58, 237, 0.08)' : 'rgba(34, 197, 94, 0.08)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {crmBackfillRunning && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#a78bfa', animation: 'pulse 1.5s infinite' }} />}
                {crmBackfillProgress}
              </div>
            )}

            {/* Tab Bar + Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
              {(['people', 'businesses', 'search'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setCrmActiveTab(tab); setCrmSelectedPerson(null); setCrmSelectedBusiness(null); }}
                  style={{
                    padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: crmActiveTab === tab ? 'rgba(124, 58, 237, 0.3)' : 'rgba(255,255,255,0.05)',
                    color: crmActiveTab === tab ? '#a78bfa' : '#94a3b8',
                  }}
                >
                  {tab === 'people' ? `People (${crmCounts.people})` : tab === 'businesses' ? `Businesses (${crmCounts.businesses})` : 'Search'}
                </button>
              ))}
              {crmActiveTab === 'search' && (
                <input
                  type="text"
                  placeholder="Search entities..."
                  value={crmSearchQuery}
                  onChange={(e) => {
                    setCrmSearchQuery(e.target.value);
                    void searchEntitiesCrm(e.target.value);
                  }}
                  style={{
                    flex: 1, padding: '6px 12px', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                    color: '#e2e8f0', fontSize: 13, outline: 'none',
                  }}
                />
              )}
            </div>

            {/* Content Area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

              {/* Left: Entity List */}
              <div style={{ width: crmSelectedPerson || crmSelectedBusiness ? '40%' : '100%', overflow: 'auto', padding: '16px 20px', borderRight: (crmSelectedPerson || crmSelectedBusiness) ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                {crmLoading ? (
                  <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 40, fontSize: 14 }}>Loading entities...</div>
                ) : (
                  <>
                    {/* People Tab */}
                    {crmActiveTab === 'people' && (crmPeople || []).map((person: any) => (
                      <div
                        key={person.id}
                        onClick={() => void selectCrmPerson(person)}
                        style={{
                          padding: '12px 16px', marginBottom: 8, borderRadius: 10, cursor: 'pointer',
                          background: crmSelectedPerson?.id === person.id ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${crmSelectedPerson?.id === person.id ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.06)'}`,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0,
                          }}>
                            {(person.full_name || '?')[0]?.toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {person.full_name}
                            </div>
                            <div style={{ color: '#64748b', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {[person.title, person.company].filter(Boolean).join(' at ') || person.industry || 'No details'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Businesses Tab */}
                    {crmActiveTab === 'businesses' && (crmBusinesses || []).map((biz: any) => (
                      <div
                        key={biz.id}
                        onClick={() => void selectCrmBusiness(biz)}
                        style={{
                          padding: '12px 16px', marginBottom: 8, borderRadius: 10, cursor: 'pointer',
                          background: crmSelectedBusiness?.id === biz.id ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${crmSelectedBusiness?.id === biz.id ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255,255,255,0.06)'}`,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0,
                          }}>
                            {(biz.name || '?')[0]?.toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {biz.name}
                            </div>
                            <div style={{ color: '#64748b', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {[biz.industry, biz.location].filter(Boolean).join(' — ') || 'No details'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Search Tab */}
                    {crmActiveTab === 'search' && (
                      <>
                        {crmSearchQuery && (!crmSearchResults || crmSearchResults.length === 0) && (
                          <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 40, fontSize: 13 }}>No entities found for &ldquo;{crmSearchQuery}&rdquo;</div>
                        )}
                        {(crmSearchResults || []).map((result: any) => (
                          <div
                            key={result.id}
                            onClick={() => {
                              const handler = result.type === 'person'
                                ? nexus.entityCrm.getPerson(result.id).then((p: any) => p && selectCrmPerson(p))
                                : nexus.entityCrm.getBusiness(result.id).then((b: any) => b && selectCrmBusiness(b));
                              void handler.catch((err: any) => console.error('[CRM] Failed to load entity:', err));
                            }}
                            style={{
                              padding: '12px 16px', marginBottom: 8, borderRadius: 10, cursor: 'pointer',
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                                background: result.type === 'person' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                                color: result.type === 'person' ? '#60a5fa' : '#34d399',
                              }}>{result.type}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{result.name}</div>
                                <div style={{ color: '#64748b', fontSize: 12 }}>{result.description}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                        {!crmSearchQuery && (
                          <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 40, fontSize: 13 }}>Type to search across all entities</div>
                        )}
                      </>
                    )}

                    {/* Empty States */}
                    {crmActiveTab === 'people' && crmPeople.length === 0 && !crmLoading && (
                      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 40, fontSize: 13 }}>
                        No people in the knowledge base yet. Use voice or chat to identify entities during conversations.
                      </div>
                    )}
                    {crmActiveTab === 'businesses' && crmBusinesses.length === 0 && !crmLoading && (
                      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 40, fontSize: 13 }}>
                        No businesses in the knowledge base yet.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right: Detail Panel — Person */}
              {crmSelectedPerson && (
                <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                  {/* Header + Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 22, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(crmSelectedPerson.full_name || '?')[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{crmSelectedPerson.full_name}</div>
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>
                        {[crmSelectedPerson.title, crmSelectedPerson.company].filter(Boolean).join(' at ')}
                      </div>
                    </div>
                    {!crmEditMode && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => crmStartEdit(crmSelectedPerson, 'person')} style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)',
                          color: '#60a5fa', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Edit</button>
                        <button onClick={() => crmOpenMerge('person', crmSelectedPerson)} style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.1)',
                          color: '#c4b5fd', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Merge</button>
                        <button onClick={() => setCrmDeleteConfirm({ type: 'person', id: crmSelectedPerson.id, name: crmSelectedPerson.full_name })} style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)',
                          color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Delete</button>
                      </div>
                    )}
                  </div>

                  {/* Edit Mode */}
                  {crmEditMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { key: 'full_name', label: 'Full Name' },
                        { key: 'title', label: 'Title' },
                        { key: 'company', label: 'Company' },
                        { key: 'location', label: 'Location' },
                        { key: 'industry', label: 'Industry' },
                        { key: 'education', label: 'Education' },
                        { key: 'linkedin_url', label: 'LinkedIn URL' },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 3 }}>{label}</div>
                          <input value={crmEditData[key] || ''} onChange={(e) => crmSetEditData((d: any) => ({ ...d, [key]: e.target.value }))}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, outline: 'none' }} />
                        </div>
                      ))}
                      <div>
                        <div style={{ color: '#64748b', fontSize: 11, marginBottom: 3 }}>Career Narrative</div>
                        <textarea value={crmEditData.career_narrative || ''} onChange={(e) => crmSetEditData((d: any) => ({ ...d, career_narrative: e.target.value }))}
                          rows={3} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, outline: 'none', resize: 'vertical' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button onClick={() => void crmSaveEdit()} style={{
                          padding: '7px 18px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                          color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Save</button>
                        <button onClick={crmCancelEdit} style={{
                          padding: '7px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                          color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Read-only detail fields */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginBottom: 20 }}>
                        {crmSelectedPerson.location && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Location</div><div style={{ color: '#e2e8f0', fontSize: 13 }}>{crmSelectedPerson.location}</div></div>
                        )}
                        {crmSelectedPerson.industry && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Industry</div><div style={{ color: '#e2e8f0', fontSize: 13 }}>{crmSelectedPerson.industry}</div></div>
                        )}
                        {crmSelectedPerson.education && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Education</div><div style={{ color: '#e2e8f0', fontSize: 13 }}>{crmSelectedPerson.education}</div></div>
                        )}
                        {crmSelectedPerson.linkedin_url && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>LinkedIn</div><a href={crmSelectedPerson.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: 13 }}>View Profile</a></div>
                        )}
                      </div>

                      {crmSelectedPerson.career_narrative && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Career Narrative</div>
                          <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{crmSelectedPerson.career_narrative}</div>
                        </div>
                      )}

                      {crmSelectedPerson.interests && crmSelectedPerson.interests.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Interests</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {crmSelectedPerson.interests.map((interest: string, i: number) => (
                              <span key={i} style={{
                                padding: '3px 10px', borderRadius: 12, fontSize: 12,
                                background: 'rgba(124, 58, 237, 0.1)', color: '#c4b5fd',
                                border: '1px solid rgba(124, 58, 237, 0.2)',
                              }}>{interest}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {crmEntityKnowledge?.entityType === 'person' && crmEntityKnowledge.aliases.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#38bdf8', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Aliases</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {crmEntityKnowledge.aliases.map((alias) => (
                              <span key={alias} style={{
                                padding: '3px 10px', borderRadius: 12, fontSize: 12,
                                background: 'rgba(56, 189, 248, 0.1)', color: '#7dd3fc',
                                border: '1px solid rgba(56, 189, 248, 0.2)',
                              }}>{alias}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {crmPersonBusinesses.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#34d399', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Associated Businesses</div>
                          {crmPersonBusinesses.map((link: any, i: number) => (
                            <div key={i} style={{
                              padding: '8px 12px', marginBottom: 6, borderRadius: 8,
                              background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)',
                              cursor: 'pointer',
                            }} onClick={() => void selectCrmBusiness(link)}>
                              <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{link.name || link.business?.name}</div>
                              <div style={{ color: '#64748b', fontSize: 11 }}>
                                {link.role || 'Associated'} {link.is_current || link.isCurrent ? '(current)' : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {renderCrmKnowledgeSurface(crmSelectedPerson.full_name || 'this person')}

                      <div style={{ fontSize: 11, color: '#475569', marginTop: 16 }}>
                        Created: {crmSelectedPerson.created_at ? new Date(crmSelectedPerson.created_at).toLocaleDateString() : 'Unknown'}
                        {crmSelectedPerson.updated_at && ` | Updated: ${new Date(crmSelectedPerson.updated_at).toLocaleDateString()}`}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Right: Detail Panel — Business */}
              {crmSelectedBusiness && (
                <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 12,
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 22, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(crmSelectedBusiness.name || '?')[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{crmSelectedBusiness.name}</div>
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>
                        {[crmSelectedBusiness.industry, crmSelectedBusiness.location].filter(Boolean).join(' — ')}
                      </div>
                    </div>
                    {!crmEditMode && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => crmStartEdit(crmSelectedBusiness, 'business')} style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)',
                          color: '#34d399', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Edit</button>
                        <button onClick={() => crmOpenMerge('business', crmSelectedBusiness)} style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.1)',
                          color: '#c4b5fd', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Merge</button>
                        <button onClick={() => setCrmDeleteConfirm({ type: 'business', id: crmSelectedBusiness.id, name: crmSelectedBusiness.name })} style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)',
                          color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Delete</button>
                      </div>
                    )}
                  </div>

                  {crmEditMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { key: 'name', label: 'Name' },
                        { key: 'industry', label: 'Industry' },
                        { key: 'location', label: 'Location' },
                        { key: 'website', label: 'Website' },
                        { key: 'linkedin_url', label: 'LinkedIn URL' },
                        { key: 'size_range', label: 'Size Range' },
                        { key: 'founded_year', label: 'Founded Year' },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 3 }}>{label}</div>
                          <input value={crmEditData[key] || ''} onChange={(e) => crmSetEditData((d: any) => ({ ...d, [key]: e.target.value }))}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, outline: 'none' }} />
                        </div>
                      ))}
                      <div>
                        <div style={{ color: '#64748b', fontSize: 11, marginBottom: 3 }}>Description</div>
                        <textarea value={crmEditData.description || ''} onChange={(e) => crmSetEditData((d: any) => ({ ...d, description: e.target.value }))}
                          rows={3} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, outline: 'none', resize: 'vertical' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button onClick={() => void crmSaveEdit()} style={{
                          padding: '7px 18px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #10b981, #059669)',
                          color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Save</button>
                        <button onClick={crmCancelEdit} style={{
                          padding: '7px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                          color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginBottom: 20 }}>
                        {crmSelectedBusiness.description && (
                          <div style={{ gridColumn: 'span 2' }}><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Description</div><div style={{ color: '#e2e8f0', fontSize: 13 }}>{crmSelectedBusiness.description}</div></div>
                        )}
                        {crmSelectedBusiness.website && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Website</div><a href={crmSelectedBusiness.website} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: 13 }}>{crmSelectedBusiness.website}</a></div>
                        )}
                        {crmSelectedBusiness.size_range && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Size</div><div style={{ color: '#e2e8f0', fontSize: 13 }}>{crmSelectedBusiness.size_range}</div></div>
                        )}
                        {crmSelectedBusiness.founded_year && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Founded</div><div style={{ color: '#e2e8f0', fontSize: 13 }}>{crmSelectedBusiness.founded_year}</div></div>
                        )}
                        {crmSelectedBusiness.linkedin_url && (
                          <div><div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>LinkedIn</div><a href={crmSelectedBusiness.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: 13 }}>View Page</a></div>
                        )}
                      </div>

                      {crmSelectedBusiness.key_products && crmSelectedBusiness.key_products.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#34d399', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Key Products</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {crmSelectedBusiness.key_products.map((product: string, i: number) => (
                              <span key={i} style={{
                                padding: '3px 10px', borderRadius: 12, fontSize: 12,
                                background: 'rgba(16, 185, 129, 0.1)', color: '#6ee7b7',
                                border: '1px solid rgba(16, 185, 129, 0.2)',
                              }}>{product}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {crmEntityKnowledge?.entityType === 'business' && crmEntityKnowledge.aliases.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#38bdf8', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Aliases</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {crmEntityKnowledge.aliases.map((alias) => (
                              <span key={alias} style={{
                                padding: '3px 10px', borderRadius: 12, fontSize: 12,
                                background: 'rgba(56, 189, 248, 0.1)', color: '#7dd3fc',
                                border: '1px solid rgba(56, 189, 248, 0.2)',
                              }}>{alias}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {crmBusinessPeople.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Associated People</div>
                          {crmBusinessPeople.map((link: any, i: number) => (
                            <div key={i} style={{
                              padding: '8px 12px', marginBottom: 6, borderRadius: 8,
                              background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.15)',
                              cursor: 'pointer',
                            }} onClick={() => void selectCrmPerson(link)}>
                              <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{link.full_name || link.person?.full_name}</div>
                              <div style={{ color: '#64748b', fontSize: 11 }}>
                                {link.role || 'Associated'} {link.is_current || link.isCurrent ? '(current)' : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {renderCrmKnowledgeSurface(crmSelectedBusiness.name || 'this business')}

                      <div style={{ fontSize: 11, color: '#475569', marginTop: 16 }}>
                        Created: {crmSelectedBusiness.created_at ? new Date(crmSelectedBusiness.created_at).toLocaleDateString() : 'Unknown'}
                        {crmSelectedBusiness.updated_at && ` | Updated: ${new Date(crmSelectedBusiness.updated_at).toLocaleDateString()}`}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Create Entity Modal ── */}
            {crmShowCreateForm && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20,
              }} onClick={() => { setCrmShowCreateForm(null); setCrmCreateData({}); }}>
                <div style={{
                  background: '#1e293b', borderRadius: 14, padding: '24px 28px', width: 420, maxHeight: '80vh', overflow: 'auto',
                  border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                    {crmShowCreateForm === 'person' ? 'Add New Person' : 'Add New Business'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(crmShowCreateForm === 'person'
                      ? [{ key: 'full_name', label: 'Full Name *' }, { key: 'title', label: 'Title' }, { key: 'company', label: 'Company' }, { key: 'location', label: 'Location' }, { key: 'industry', label: 'Industry' }, { key: 'education', label: 'Education' }, { key: 'linkedin_url', label: 'LinkedIn URL' }]
                      : [{ key: 'name', label: 'Name *' }, { key: 'industry', label: 'Industry' }, { key: 'location', label: 'Location' }, { key: 'description', label: 'Description' }, { key: 'website', label: 'Website' }, { key: 'linkedin_url', label: 'LinkedIn URL' }, { key: 'size_range', label: 'Size Range' }, { key: 'founded_year', label: 'Founded Year' }]
                    ).map(({ key, label }) => (
                      <div key={key}>
                        <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>{label}</div>
                        <input value={crmCreateData[key] || ''} onChange={(e) => setCrmCreateData((d: any) => ({ ...d, [key]: e.target.value }))}
                          placeholder={label.replace(' *', '')}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, outline: 'none' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setCrmShowCreateForm(null); setCrmCreateData({}); }} style={{
                      padding: '8px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                      color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={() => void crmCreateEntity()} style={{
                      padding: '8px 18px', borderRadius: 6, border: 'none',
                      background: crmShowCreateForm === 'person' ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Create</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Merge Entity Modal ── */}
            {crmMergeState && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 21,
              }} onClick={() => { if (!crmMerging) { setCrmMergeState(null); setCrmMergeResults([]); } }}>
                <div style={{
                  background: '#1e293b', borderRadius: 14, padding: '24px 28px', width: 520, maxHeight: '82vh', overflow: 'auto',
                  border: '1px solid rgba(168,85,247,0.24)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                    Merge {crmMergeState.type === 'person' ? 'Person' : 'Business'}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
                    Keep <strong style={{ color: '#e2e8f0' }}>{crmMergeState.primaryName}</strong> as the canonical record and merge another {crmMergeState.type} into it.
                    Aliases, linked documents, artifacts, projects, and relationships will move onto the kept record.
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Search merge candidates</div>
                  <input
                    value={crmMergeState.query}
                    onChange={(event) => {
                      const query = event.target.value;
                      setCrmMergeState((prev) => prev ? { ...prev, query, selectedCandidateId: '' } : prev);
                      void crmSearchMergeCandidates(query, crmMergeState.type);
                    }}
                    placeholder={`Search ${crmMergeState.type} records`}
                    className="settings-input"
                  />
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {crmMergeResults
                      .filter((result) => result.type === crmMergeState.type && result.id !== crmMergeState.primaryId)
                      .slice(0, 8)
                      .map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => setCrmMergeState((prev) => prev ? { ...prev, selectedCandidateId: result.id } : prev)}
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: `1px solid ${crmMergeState.selectedCandidateId === result.id ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.08)'}`,
                            background: crmMergeState.selectedCandidateId === result.id ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.03)',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{result.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{result.description || 'CRM record'}</div>
                        </button>
                      ))}
                    {crmMergeState.query && crmMergeResults.filter((result) => result.type === crmMergeState.type && result.id !== crmMergeState.primaryId).length === 0 && (
                      <div style={{ color: '#64748b', fontSize: 12 }}>
                        No merge candidates found yet.
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
                    <button onClick={() => { if (!crmMerging) { setCrmMergeState(null); setCrmMergeResults([]); } }} style={{
                      padding: '8px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                      color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Cancel</button>
                    <button
                      onClick={() => void crmConfirmMergeEntities()}
                      disabled={!crmMergeState.selectedCandidateId || crmMerging}
                      style={{
                        padding: '8px 18px', borderRadius: 6, border: 'none',
                        background: !crmMergeState.selectedCandidateId || crmMerging ? 'rgba(168,85,247,0.25)' : 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                        color: '#fff', fontSize: 12, fontWeight: 600, cursor: !crmMergeState.selectedCandidateId || crmMerging ? 'default' : 'pointer',
                      }}
                    >
                      {crmMerging ? 'Merging…' : 'Merge Into This Record'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Delete Confirmation Modal ── */}
            {crmDeleteConfirm && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20,
              }} onClick={() => setCrmDeleteConfirm(null)}>
                <div style={{
                  background: '#1e293b', borderRadius: 14, padding: '24px 28px', width: 380,
                  border: '1px solid rgba(239,68,68,0.2)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ color: '#f87171', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete {crmDeleteConfirm.type === 'person' ? 'Person' : 'Business'}</div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
                    Are you sure you want to permanently delete <strong style={{ color: '#e2e8f0' }}>{crmDeleteConfirm.name}</strong>? This will also remove all associated links. This action cannot be undone.
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setCrmDeleteConfirm(null)} style={{
                      padding: '8px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                      color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={() => void crmConfirmDelete()} style={{
                      padding: '8px 18px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════ Meeting Mode Infographic Carousel ═══════ */}
      {meetingModeActive && meetingInfographics.length > 0 && !showMeetingBriefing && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: meetingOverlayRight,
          width: 420,
          background: 'rgba(15, 15, 25, 0.95)',
          borderRadius: 16,
          border: '1px solid rgba(124, 58, 237, 0.4)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 1000,
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>
              Meeting Intelligence ({meetingInfographics.length} slides)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setMeetingCarouselIndex((i) => Math.max(0, i - 1))}
                disabled={meetingCarouselIndex === 0}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none',
                  background: meetingCarouselIndex === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                  color: '#fff', cursor: meetingCarouselIndex === 0 ? 'default' : 'pointer', fontSize: 14,
                }}
              >{'<'}</button>
              <button
                onClick={() => setMeetingCarouselIndex((i) => Math.min(meetingInfographics.length - 1, i + 1))}
                disabled={meetingCarouselIndex >= meetingInfographics.length - 1}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none',
                  background: meetingCarouselIndex >= meetingInfographics.length - 1 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                  color: '#fff', cursor: meetingCarouselIndex >= meetingInfographics.length - 1 ? 'default' : 'pointer', fontSize: 14,
                }}
              >{'>'}</button>
            </div>
          </div>
          {meetingInfographics[meetingCarouselIndex] && (
            <div style={{ padding: 16 }}>
              <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                {meetingInfographics[meetingCarouselIndex].title}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>
                {meetingInfographics[meetingCarouselIndex].description}
              </div>
              {meetingInfographics[meetingCarouselIndex].imageDataUrl ? (
                <img
                  src={meetingInfographics[meetingCarouselIndex].imageDataUrl}
                  alt={meetingInfographics[meetingCarouselIndex].title}
                  style={{ width: '100%', borderRadius: 8, maxHeight: 280, objectFit: 'contain' }}
                />
              ) : (
                <div style={{
                  background: 'rgba(124, 58, 237, 0.1)',
                  borderRadius: 8,
                  padding: 16,
                  textAlign: 'center',
                  color: '#a78bfa',
                  fontSize: 12,
                }}>
                  {meetingInfographics[meetingCarouselIndex].type === 'entity_map' && `Entities: ${(meetingInfographics[meetingCarouselIndex].data?.items || []).map((e: any) => e.name).join(', ')}`}
                  {meetingInfographics[meetingCarouselIndex].type === 'fact_scorecard' && `${(meetingInfographics[meetingCarouselIndex].data?.items || []).length} facts collected`}
                  {meetingInfographics[meetingCarouselIndex].type === 'topic_overview' && `Topic: ${(meetingInfographics[meetingCarouselIndex].data?.items || []).map((t: any) => t.name).join(', ')}`}
                  {meetingInfographics[meetingCarouselIndex].type === 'sentiment_timeline' && 'Sentiment analysis over time'}
                </div>
              )}
            </div>
          )}
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '10px 16px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            fontSize: 11,
            color: '#64748b',
            alignItems: 'center',
          }}>
            <span>{meetingEntities.length} entities</span>
            <span>{meetingFacts.length} facts</span>
            <span>{meetingTopics.length} topics</span>
            <button
              type="button"
              onClick={presentMeetingSummary}
              style={{
                marginLeft: 'auto',
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid rgba(16, 185, 129, 0.28)',
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#a7f3d0',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Summary
            </button>
            <button
              type="button"
              onClick={endMeetingMode}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid rgba(239, 68, 68, 0.28)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#fecaca',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* ═══════ Meeting Mode Pre-Infographic Badge Panel ═══════ */}
      {meetingModeActive && meetingInfographics.length === 0 && (meetingEntities.length > 0 || meetingFacts.length > 0) && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: meetingOverlayRight,
          width: 320,
          background: 'rgba(15, 15, 25, 0.95)',
          borderRadius: 12,
          border: '1px solid rgba(124, 58, 237, 0.3)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          zIndex: 1000,
          padding: 16,
        }}>
          <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Meeting Intelligence — Collecting...
          </div>
          {meetingEntities.slice(-5).map((ent: any, i: number) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
              color: '#e2e8f0', fontSize: 12,
            }}>
              <span style={{
                display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10,
                background: ent.type === 'person' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                color: ent.type === 'person' ? '#60a5fa' : '#34d399',
              }}>{ent.type}</span>
              <span>{ent.name}</span>
            </div>
          ))}
          {meetingFacts.slice(-3).map((fact: any, i: number) => (
            <div key={i} style={{
              marginTop: 4, color: '#94a3b8', fontSize: 11,
              paddingLeft: 8, borderLeft: '2px solid rgba(251, 191, 36, 0.4)',
            }}>
              {String(fact.claim || '').slice(0, 100)}{String(fact.claim || '').length > 100 ? '...' : ''}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              onClick={presentMeetingSummary}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid rgba(16, 185, 129, 0.28)',
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#a7f3d0',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Present Summary
            </button>
            <button
              onClick={endMeetingMode}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid rgba(239, 68, 68, 0.28)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#fecaca',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Stop Meeting
            </button>
          </div>
        </div>
      )}

      {/* ═══════ Meeting Mode Full Briefing Overlay ═══════ */}
      {showMeetingBriefing && meetingBriefing && (
        <>
          <div className="artifact-viewer-overlay" onClick={() => setShowMeetingBriefing(false)} />
          <div className="artifact-viewer-modal" style={{ width: '85%', maxWidth: 1100, maxHeight: '90vh', overflow: 'auto', inset: 'auto', top: '5vh', left: '50%', transform: 'translateX(-50%)' }}>
            <div className="artifact-viewer-header">
              <span className="artifact-viewer-title">Meeting Briefing — Full Summary</span>
              <button className="artifact-close-btn" onClick={() => setShowMeetingBriefing(false)}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ color: '#a78bfa', fontSize: 16, marginBottom: 8 }}>Executive Summary</h3>
                <p style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {meetingBriefing.summary}
                </p>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#64748b' }}>
                  <span>Duration: {Math.round((meetingBriefing.duration || 0) / 60000)} min</span>
                  <span>Mood: {meetingBriefing.sentimentOverall}</span>
                </div>
              </div>

              {meetingBriefing.entities?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ color: '#60a5fa', fontSize: 16, marginBottom: 8 }}>Entities ({meetingBriefing.entities.length})</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {meetingBriefing.entities.map((ent: any, i: number) => (
                      <div key={i} style={{
                        background: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: 8,
                        padding: '8px 12px',
                      }}>
                        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{ent.name}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{ent.type} — {ent.mentions} mention{ent.mentions !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {meetingBriefing.facts?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ color: '#fbbf24', fontSize: 16, marginBottom: 8 }}>Facts & Claims ({meetingBriefing.facts.length})</h3>
                  {meetingBriefing.facts.map((fact: any, i: number) => (
                    <div key={i} style={{
                      padding: '8px 12px',
                      marginBottom: 6,
                      background: 'rgba(251, 191, 36, 0.05)',
                      borderLeft: `3px solid ${fact.verified === 'verified' ? '#22c55e' : fact.verified === 'disputed' ? '#ef4444' : '#fbbf24'}`,
                      borderRadius: '0 6px 6px 0',
                    }}>
                      <div style={{ color: '#e2e8f0', fontSize: 13 }}>{fact.claim}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{fact.verified} — {fact.source}</div>
                    </div>
                  ))}
                </div>
              )}

              {meetingBriefing.topics?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ color: '#34d399', fontSize: 16, marginBottom: 8 }}>Topics Discussed</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {meetingBriefing.topics.map((topic: any, i: number) => (
                      <span key={i} style={{
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: 20,
                        padding: '4px 12px',
                        color: '#34d399',
                        fontSize: 12,
                      }}>{topic.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {meetingBriefing.infographics?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ color: '#a78bfa', fontSize: 16, marginBottom: 8 }}>Generated Infographics ({meetingBriefing.infographics.length})</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                    {meetingBriefing.infographics.map((info: any, i: number) => (
                      <div key={i} style={{
                        background: 'rgba(124, 58, 237, 0.08)',
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid rgba(124, 58, 237, 0.2)',
                      }}>
                        {info.imageDataUrl && (
                          <img src={info.imageDataUrl} alt={info.title} style={{ width: '100%', maxHeight: 200, objectFit: 'contain' }} />
                        )}
                        <div style={{ padding: 10 }}>
                          <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{info.title}</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>{info.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {meetingBriefing.researchSuggestions?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ color: '#f97316', fontSize: 16, marginBottom: 8 }}>Research Suggestions</h3>
                  {meetingBriefing.researchSuggestions.map((sug: any, i: number) => (
                    <div key={i} style={{
                      padding: '8px 12px',
                      marginBottom: 6,
                      background: 'rgba(249, 115, 22, 0.05)',
                      borderRadius: 6,
                      border: '1px solid rgba(249, 115, 22, 0.2)',
                    }}>
                      <div style={{ color: '#e2e8f0', fontSize: 13 }}>{sug.query}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{sug.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
