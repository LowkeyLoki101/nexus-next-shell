// NEXUS Next — Tauri shell wrapper (optional native target over the web build).
// The engine is remote; this wrapper only hosts the renderer. Capsule
// verification is performed by the web bootstrap and enforced by the engine.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running NEXUS Next shell");
}
