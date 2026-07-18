interface BrowserPreloadApi {
  saveBrowserScreenshot?: (dataUrl: string, pageTitle: string, pageUrl: string) => Promise<unknown>;
}

interface BrowserViewerWindow extends Window {
  __EMERGENT_BROWSER_NAVIGATE__?: (url?: string, title?: string) => void;
  electronAPI?: BrowserPreloadApi;
}

interface BrowserViewerWebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  capturePage(): Promise<{ toDataURL(): string }>;
  getTitle(): string;
  getURL(): string;
}

type BrowserNavigateEvent = Event & { url: string };
type BrowserPageTitleEvent = Event & { title: string };
type BrowserFailLoadEvent = Event & {
  isMainFrame: boolean;
  errorCode: number;
  errorDescription?: string;
  validatedURL?: string;
};

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Browser viewer is missing required element "${id}".`);
  }
  return element as unknown as T;
}

const viewerWindow = window as BrowserViewerWindow;
const webview = requireElement<BrowserViewerWebviewElement>('browser-content');
const urlBar = requireElement<HTMLInputElement>('url-bar');
const btnBack = requireElement<HTMLButtonElement>('btn-back');
const btnForward = requireElement<HTMLButtonElement>('btn-forward');
const btnReload = requireElement<HTMLButtonElement>('btn-reload');
const btnGo = requireElement<HTMLButtonElement>('btn-go');
const btnScreenshot = requireElement<HTMLButtonElement>('btn-screenshot');
const loadingBar = requireElement<HTMLDivElement>('loading-bar');
const statusText = requireElement<HTMLSpanElement>('status-text');
const statusUrl = requireElement<HTMLSpanElement>('status-url');
const flashOverlay = requireElement<HTMLDivElement>('flash-overlay');
const toast = requireElement<HTMLDivElement>('toast');

const params = new URLSearchParams(window.location.search);
const initialUrl = params.get('url') || 'about:blank';
const initialTitle = params.get('title') || 'Emergent Browser';
document.title = initialTitle;

function normalizeTarget(rawTarget: string): string {
  const trimmed = String(rawTarget || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === 'about:blank') {
    return trimmed;
  }

  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed.includes(' ') || !trimmed.includes('.')
      ? `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
      : `https://${trimmed}`;
  }

  return trimmed;
}

function updateNavigationButtons(): void {
  btnBack.disabled = !webview.canGoBack();
  btnForward.disabled = !webview.canGoForward();
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2500);
}

function navigateTo(target: string): void {
  const normalized = normalizeTarget(target);
  if (!normalized) {
    return;
  }

  statusText.textContent = 'Opening...';
  statusUrl.textContent = normalized;
  webview.src = normalized;
  urlBar.value = normalized;
}

viewerWindow.__EMERGENT_BROWSER_NAVIGATE__ = (target?: string, title?: string) => {
  if (title) {
    document.title = title;
  }
  navigateTo(target || 'about:blank');
};

if (initialUrl !== 'about:blank') {
  navigateTo(initialUrl);
}

btnBack.addEventListener('click', () => {
  if (webview.canGoBack()) {
    webview.goBack();
  }
});

btnForward.addEventListener('click', () => {
  if (webview.canGoForward()) {
    webview.goForward();
  }
});

btnReload.addEventListener('click', () => webview.reload());
btnGo.addEventListener('click', () => navigateTo(urlBar.value));

urlBar.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    navigateTo(urlBar.value);
  }
});

webview.addEventListener('did-start-loading', () => {
  loadingBar.className = 'active';
  statusText.textContent = 'Loading...';
});

webview.addEventListener('did-stop-loading', () => {
  loadingBar.className = 'done';
  window.setTimeout(() => {
    loadingBar.className = 'hidden';
  }, 300);
  window.setTimeout(() => {
    loadingBar.className = '';
    loadingBar.style.width = '0%';
  }, 600);
  statusText.textContent = 'Ready';
  updateNavigationButtons();
});

webview.addEventListener('did-navigate', (event) => {
  const navigationEvent = event as BrowserNavigateEvent;
  urlBar.value = navigationEvent.url;
  statusUrl.textContent = navigationEvent.url;
  document.title = webview.getTitle() || initialTitle;
  updateNavigationButtons();
});

webview.addEventListener('did-navigate-in-page', (event) => {
  const navigationEvent = event as BrowserNavigateEvent;
  urlBar.value = navigationEvent.url;
  updateNavigationButtons();
});

webview.addEventListener('page-title-updated', (event) => {
  const pageTitleEvent = event as BrowserPageTitleEvent;
  document.title = pageTitleEvent.title || initialTitle;
});

webview.addEventListener('did-fail-load', (event) => {
  const failEvent = event as BrowserFailLoadEvent;
  const activeUrl = webview.getURL() || '';
  if (!failEvent.isMainFrame || failEvent.errorCode === -3) {
    return;
  }
  if (activeUrl && activeUrl !== 'about:blank' && activeUrl !== failEvent.validatedURL) {
    return;
  }
  statusText.textContent = `Load failed: ${failEvent.errorDescription || 'Unknown error'}`;
});

btnScreenshot.addEventListener('click', async () => {
  flashOverlay.classList.add('flash');
  window.setTimeout(() => flashOverlay.classList.remove('flash'), 150);

  try {
    const nativeImage = await webview.capturePage();
    const dataUrl = nativeImage.toDataURL();
    const pageTitle = webview.getTitle() || 'Browser Screenshot';
    const pageUrl = webview.getURL() || '';

    if (viewerWindow.electronAPI?.saveBrowserScreenshot) {
      await viewerWindow.electronAPI.saveBrowserScreenshot(dataUrl, pageTitle, pageUrl);
      showToast('Screenshot saved and ingested.');
      return;
    }

    showToast('Screenshot captured, but no save handler is available.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Screenshot failed:', error);
    showToast(`Screenshot failed: ${message}`);
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'l') {
    event.preventDefault();
    urlBar.focus();
    urlBar.select();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'r') {
    event.preventDefault();
    webview.reload();
  }
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    if (webview.canGoBack()) {
      webview.goBack();
    }
  }
  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    if (webview.canGoForward()) {
      webview.goForward();
    }
  }
});
