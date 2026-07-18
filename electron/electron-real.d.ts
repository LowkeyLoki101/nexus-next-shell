declare module 'electron-real' {
  export const contextBridge: typeof import('electron').contextBridge;
  export const clipboard: typeof import('electron').clipboard;
}
