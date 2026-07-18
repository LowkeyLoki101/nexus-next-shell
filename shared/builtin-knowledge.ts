export interface BuiltinTutorialRecord {
  id: string;
  title: string;
  category: 'Setup' | 'Workspace' | 'Legal' | 'Media';
  icon: string;
  summary: string;
  estimatedMinutes: number;
  dependencies: string[];
  steps: string[];
  notes: string[];
  keywords: string[];
}

export interface BuiltinKnowledgeSearchResult {
  tutorial: BuiltinTutorialRecord;
  score: number;
  preview: string;
}

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function buildTutorialMarkdown(tutorial: BuiltinTutorialRecord): string {
  return [
    `# ${tutorial.title}`,
    '',
    tutorial.summary,
    '',
    `Category: ${tutorial.category}`,
    `Estimated time: ${tutorial.estimatedMinutes} minutes`,
    '',
    '## Dependencies',
    ...tutorial.dependencies.map((item) => `- ${item}`),
    '',
    '## Step By Step',
    ...tutorial.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Notes',
    ...tutorial.notes.map((item) => `- ${item}`),
  ].join('\n');
}

function buildPlaybackText(tutorial: BuiltinTutorialRecord): string {
  return [
    tutorial.title,
    tutorial.summary,
    `Dependencies: ${tutorial.dependencies.join('. ')}.`,
    'Steps.',
    ...tutorial.steps.map((step, index) => `Step ${index + 1}. ${step}.`),
    'Notes.',
    ...tutorial.notes.map((note) => `${note}.`),
  ].join(' ');
}

function buildSearchPreview(tutorial: BuiltinTutorialRecord): string {
  const dependencyLead = tutorial.dependencies.slice(0, 2).join(', ');
  const firstStep = tutorial.steps[0] || '';
  return normalizeWhitespace(`${tutorial.summary} Dependencies: ${dependencyLead}. First step: ${firstStep}`);
}

function buildTutorialHaystack(tutorial: BuiltinTutorialRecord): string {
  return [
    tutorial.title,
    tutorial.category,
    tutorial.summary,
    tutorial.dependencies.join(' '),
    tutorial.steps.join(' '),
    tutorial.notes.join(' '),
    tutorial.keywords.join(' '),
  ].join('\n').toLowerCase();
}

export const BUILTIN_TUTORIALS: BuiltinTutorialRecord[] = [
  {
    id: 'fresh-install-and-first-launch',
    title: 'Fresh Install And First Launch',
    category: 'Setup',
    icon: 'inbox',
    summary: 'Download Nexus, launch it on a clean Mac, let it create its folder tree, and complete the first-run settings pass.',
    estimatedMinutes: 8,
    dependencies: [
      'macOS desktop environment with permission to launch downloaded apps',
      'Internet on first launch so API-backed features can connect',
      'OpenAI API key for core chat, analysis, and most agent work',
    ],
    steps: [
      'Download the latest signed Nexus build from the release page or GitHub release asset and move the app into Applications.',
      'Open Nexus. If macOS warns that the app was downloaded from the internet, allow it through Gatekeeper in System Settings and reopen it.',
      'Create or open a session. Nexus now bootstraps its storage folders automatically on first launch.',
      'Open Settings and save the OpenAI API key first. Without it, flagship chat and analysis flows will not run.',
      'Verify the app created its working directories under Documents. Packaged builds use ~/Documents/Emergent Intelligence for generated working files and ~/Documents/Emergent Intelligence Reference for reusable reference libraries.',
      'Run one quick smoke test: send a message, open Workspace, and confirm a staging tab can be opened and closed.',
    ],
    notes: [
      'Core generated folders include uploads, briefings, transcripts, tutorials, presentations, brainstorms, meetings, browser-action-logs, data, youtube-transcripts, and generated assets.',
      'Asset folders are split by function, including legal-analysis, media-intelligence, and elevenlabs audio outputs.',
      'The app is closest to production on macOS today. Distribution for other platforms still needs its own packaging path.',
    ],
    keywords: ['download', 'install', 'first launch', 'folders', 'bootstrap', 'github release', 'applications'],
  },
  {
    id: 'dependency-and-api-key-checklist',
    title: 'Dependency And API Key Checklist',
    category: 'Setup',
    icon: 'settings',
    summary: 'Know exactly which services are required, which ones are optional, and which advanced flows still rely on host machine binaries today.',
    estimatedMinutes: 10,
    dependencies: [
      'Required for core Nexus: OpenAI API key',
      'Optional but common: ElevenLabs API key for live voice and text-to-speech',
      'Optional: Gemini API key for semantic media retrieval',
      'Optional: xAI API key for Grok image and video generation',
      'Optional: HeyGen API key for avatar video creation',
      'Current advanced machine dependencies: ffmpeg, ffprobe, yt-dlp, uv, and a Playwright Chromium runtime',
    ],
    steps: [
      'Open Settings and save the OpenAI key first. That unlocks chat, legal review, report generation, and most agent reasoning.',
      'Add the ElevenLabs key if you want live voice sessions, spoken narration, or ElevenLabs-backed audio generation.',
      'Add Gemini if you want SentrySearch-style semantic video indexing and retrieval.',
      'Add xAI if you want Grok image generation or Grok video jobs from inside Marketing Department.',
      'Add HeyGen if you want avatar videos from Marketing Department.',
      'If you need advanced local media processing today, install ffmpeg, ffprobe, yt-dlp, and uv on the machine. Those are still external dependencies for some production features in the current build.',
      'If you are running the repo build and need Playwright browser automation, ensure the Playwright Chromium runtime is installed for that environment as well.',
    ],
    notes: [
      'Core workspace flows can run without every optional service key. The app should still expose missing integrations as product messages rather than silent failures.',
      'Media montage, browser automation, and some transcript fallback paths are the main flows still gated by host-level dependencies today.',
      'If you are preparing a public download page, be explicit about which features are turnkey and which still need machine setup.',
    ],
    keywords: ['dependencies', 'api keys', 'ffmpeg', 'playwright', 'gemini', 'heygen', 'xai', 'yt-dlp', 'uv'],
  },
  {
    id: 'workspace-and-presenter-flow',
    title: 'Workspace And Presenter Flow',
    category: 'Workspace',
    icon: 'compass',
    summary: 'Use the workstation as a live presentation surface where Nexus stages files, reports, videos, and guides while it explains them.',
    estimatedMinutes: 6,
    dependencies: [
      'An active session',
      'Workspace surface enabled inside the main app window',
      'At least one file, report, guide, or staged asset to present',
    ],
    steps: [
      'Open a session and switch from Chat to Workspace.',
      'Use Mission Control, global search, or quick launch actions to stage an artifact, report, video, or tutorial.',
      'When a staged item opens, use the presenter overlay to keep the preview large enough to inspect without leaving the workspace.',
      'Switch between staged tabs to move the presentation focus while keeping the underlying workspace context intact.',
      'Close the presenter when you want to return to Mission Control, or close the active tab to retire that item from the workspace.',
    ],
    notes: [
      'The goal is not a tiny preview pane. The workspace should behave like a presentation dock where the active deliverable stays visually dominant.',
      'Agent-opened files should focus themselves in the presenter so the user sees what Nexus is talking about immediately.',
      'Legal reviews, PDFs, markdown reports, images, video clips, and YouTube viewers are all intended to stage into the same presenter workflow.',
    ],
    keywords: ['workspace', 'presenter', 'preview', 'mission control', 'stage tabs', 'focus item'],
  },
  {
    id: 'agreeable-agreements-contract-review',
    title: 'Agreeable Agreements Contract Review',
    category: 'Legal',
    icon: 'fileText',
    summary: 'Run the full Agreeable Agreements flow inside Nexus by uploading a contract, analyzing a URL, or selecting an existing knowledge document.',
    estimatedMinutes: 7,
    dependencies: [
      'OpenAI API key configured',
      'A live session',
      'A source contract from upload, URL, web search, or the current knowledge base',
    ],
    steps: [
      'Open Workspace and stay on Mission Control.',
      'Find the Agreeable Agreements card.',
      'Choose one of the source paths: upload a file, analyze a URL, search the web for a public contract, or select an existing knowledge document.',
      'Run the review. Nexus will generate the structured legal analysis, markdown report, and PDF output.',
      'Open the staged review in the workspace presenter to inspect the risk score, colored flags, clause findings, and recommendations.',
      'Open the PDF only when you need the exported deliverable. The workstation review should be the primary reading surface.',
    ],
    notes: [
      'New reports are persisted so they can be reopened later without re-uploading the original contract.',
      'The native review surface is designed to be the primary UI. The raw markdown is still available as a supporting artifact.',
      'Generated legal outputs are stored under the dedicated legal-analysis asset folders.',
    ],
    keywords: ['agreeable agreements', 'contract review', 'legal analysis', 'upload contract', 'url analysis', 'pdf report'],
  },
  {
    id: 'media-intelligence-montage',
    title: 'Media Intelligence Montage',
    category: 'Media',
    icon: 'play',
    summary: 'Index video footage, search for moments semantically, clip the right spans, stitch a montage, and generate narrated image videos from the workspace.',
    estimatedMinutes: 12,
    dependencies: [
      'Workspace video or image assets',
      'Gemini API key for semantic retrieval, or a configured local media backend',
      'ffmpeg and ffprobe for clip, stitch, and render operations',
      'ElevenLabs API key if you want narrated image videos with generated voice audio',
    ],
    steps: [
      'Open Workspace and go to the Media Intelligence card in Mission Control.',
      'Select one or more video files and run indexing so the semantic search backend has chunks to search.',
      'Describe the shot or moment you want, then run video search.',
      'Clip the best matching segments into standalone video assets.',
      'Select two or more clips and stitch them into a montage when you want a finished sequence.',
      'For image-based storytelling, select images, provide or auto-generate narration, and render a narrated slideshow video.',
      'Use the workspace presenter to review clips and final outputs before revealing or exporting the files.',
    ],
    notes: [
      'Media outputs are organized under dedicated media-intelligence asset folders for clips, stitches, slideshows, audio, and temp renders.',
      'The SentrySearch-style semantic flow is only as good as the indexed source footage and the installed backend dependencies.',
      'Narrated slideshows should feel like finished deliverables, not placeholders. Treat the workspace presenter as the review surface for them.',
    ],
    keywords: ['media montage', 'video clip', 'stitch video', 'narrated slideshow', 'sentrysearch', 'semantic search'],
  },
];

export function getBuiltinTutorialById(id: string): BuiltinTutorialRecord | null {
  const normalizedId = normalizeWhitespace(id);
  if (!normalizedId) {
    return null;
  }
  return BUILTIN_TUTORIALS.find((tutorial) => tutorial.id === normalizedId) || null;
}

export function getBuiltinTutorialMarkdown(id: string): string | null {
  const tutorial = getBuiltinTutorialById(id);
  return tutorial ? buildTutorialMarkdown(tutorial) : null;
}

export function getBuiltinTutorialPlaybackText(id: string): string | null {
  const tutorial = getBuiltinTutorialById(id);
  return tutorial ? buildPlaybackText(tutorial) : null;
}

export function searchBuiltinKnowledge(query: string, limit = 5): BuiltinKnowledgeSearchResult[] {
  const normalizedQuery = normalizeWhitespace(query);
  const queryTokens = uniqueStrings(tokenize(normalizedQuery));

  const scored = BUILTIN_TUTORIALS.map((tutorial, index) => {
    const haystack = buildTutorialHaystack(tutorial);
    let score = Math.max(0, BUILTIN_TUTORIALS.length - index);

    if (!normalizedQuery) {
      return {
        tutorial,
        score,
        preview: buildSearchPreview(tutorial),
      };
    }

    const lowerQuery = normalizedQuery.toLowerCase();
    if (tutorial.title.toLowerCase().includes(lowerQuery)) {
      score += 20;
    }
    if (tutorial.summary.toLowerCase().includes(lowerQuery)) {
      score += 12;
    }

    for (const token of queryTokens) {
      if (!token) {
        continue;
      }
      if (tutorial.title.toLowerCase().includes(token)) {
        score += 8;
      }
      if (tutorial.category.toLowerCase().includes(token)) {
        score += 4;
      }
      if (tutorial.keywords.some((keyword) => keyword.toLowerCase().includes(token))) {
        score += 5;
      }
      if (haystack.includes(token)) {
        score += 2;
      }
    }

    return {
      tutorial,
      score,
      preview: buildSearchPreview(tutorial),
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.tutorial.title.localeCompare(right.tutorial.title))
    .slice(0, Math.max(1, limit));
}

export function buildBuiltinKnowledgePromptContext(query: string, limit = 3): string | null {
  const matches = searchBuiltinKnowledge(query, limit);
  if (matches.length === 0) {
    return null;
  }

  return [
    '## Built-In Nexus Knowledge',
    'The following product guides are first-party Nexus operating knowledge. Use them directly when the user asks about setup, dependencies, tutorials, workspace behavior, legal review flow, or media montage flow.',
    ...matches.map(({ tutorial, preview }) => (
      `- ${tutorial.title}: ${preview}`
    )),
  ].join('\n');
}
