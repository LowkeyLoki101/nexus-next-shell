// The shell's preload entry. Importing the ported preload triggers its
// contextBridge.exposeInMainWorld('nexus', ...) — but with `electron` rewritten
// to the WS-backed shim, so window.nexus now drives the remote engine.
import '../preload/index';
