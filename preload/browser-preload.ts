/**
 * Browser Viewer Preload — Exposes screenshot save + ingestion API
 * to the browser-viewer.html renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveBrowserScreenshot: (dataUrl: string, pageTitle: string, pageUrl: string) =>
    ipcRenderer.invoke('browser:save-screenshot', dataUrl, pageTitle, pageUrl),
});
