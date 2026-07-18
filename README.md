# Nexus Next — Shell (public)

The user-facing Nexus Next client. Renders the UI and captures local devices;
all agent/LLM/tool work runs on the remote **engine**. **No engine source here.**

## Targets
- **Electron** desktop app (`scripts/build-electron.mjs`)
- **Web** app (`vite`)
- **Tauri** native wrapper over the web build (`src-tauri/`, optional)

## How it stays faithful to the original UI
The original renderer talked to the engine via a preload that exposed
`window.nexus` over Electron IPC. This repo reuses that **exact preload and
renderer**. A build-time alias swaps the preload's `electron` import for a
WS-backed shim, so `ipcRenderer.invoke/on` now reach the remote engine. The UI
code is unchanged.

```
renderer/            ← real ported UI (next / gaze-voice / vision-gestures / nate-kb / classic)
preload/             ← real ported preload (exposes window.nexus)
electron/            main.ts (capsule verify + window), preload-shim.ts (WS ipcRenderer)
src/transport/       ws-client.ts (nexus-hybrid/1)
src/web/             browser electron-shim + bootstrap (web target)
protocol/            shared wire contract + capsule verify
capsule/             signed capsule.json + public-key.pem (from the engine)
src-tauri/           optional Tauri wrapper
```

## Run (local)
```sh
npm install
# Web:
npm run dev:web        # http://localhost:5173/next.html  (engine must be running)
# Electron:
npm run build && npm run start:electron
```
The shell verifies its capsule (Ed25519) before launching and refuses to start
if it's tampered or expired. The engine independently re-verifies on connect.

## Smoke test
Run this before shipping a capsule shell:
```sh
npm run smoke:web
```
It builds the web shell, boots the sibling engine on the local signed capsule
endpoint, opens `next.html` in headless Chrome, and fails if the UI stays blank,
if the bootstrap error card appears, or if `window.nexus` is not connected.
The report is written to `smoke-results/latest-web.json`.

## Desktop package
Build a local unsigned macOS `.app` for package-layout verification:
```sh
npm run package:mac:dir
open "release/mac-arm64/NEXUS Next Capsule.app"
```

That command proves the app assembles, the capsule is bundled under
`dist/capsule`, and the packaged Electron runtime can open the Nexus UI. It is
not a public download artifact because it intentionally disables code signing.

Create distributable macOS artifacts after a production capsule has been
re-signed for your `wss://` engine endpoint:
```sh
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
npm run package:mac
```

`npm run package:mac` writes `.dmg` and `.zip` artifacts under `release/`.
Those still need a Developer ID certificate available in Keychain; notarization
runs automatically only when the Apple environment variables above are set.

## Capsule
`capsule/capsule.json` + `capsule/public-key.pem` are issued by the engine's
`sign-capsule` tool. Replace the samples with your signed capsule. No private
keys ever live in this repo.
