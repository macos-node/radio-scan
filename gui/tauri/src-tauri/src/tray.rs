// ntune — menubar / tray now-playing companion (U6 scaffold).
// See ../../docs/radio-scan-ui-2026-08-04.md § "U6" and
// ../docs/menubar-companion-2026-08-04.md for the direction.
//
// OPT-IN: this is only wired up when the app is launched with `--tray`
// (see run() in lib.rs). It reuses two things ntune already owns — U3's
// `now-playing` event (proxy.rs) and the local favorites store — so the tray is
// a thin surface over existing state, not a second source of truth.
//
// Cross-platform via Tauri's tray API. Linux reality (U6 build-map notes): the
// icon appears through StatusNotifierItem (libayatana-appindicator3); on GNOME
// it needs the AppIndicator extension, and Wayland has no tray-anchored popover
// geometry — so THE MENU IS THE CONTRACT, not a click-to-popover. Left-click
// behaviour is desktop-dependent; everything actionable lives in the menu.

use serde::Deserialize;
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Listener, Manager,
};

const TRAY_ID: &str = "ntune-tray";
const IDLE: &str = "Not playing";

/// Tray now-playing state, pushed from the frontend (App.tsx) — the single source
/// of truth. The UI already derives now-playing (ICY metadata, filtered to the
/// tuned station and CLEARED on stop), so mirroring it here gives a correct label
/// on stop and lets the tray ♥ gate on exactly what the in-window heart does:
/// `can_favorite` == the PlayerBar heart's `!disabled` (nowPlaying present).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayState {
    /// "Artist — Title", the source title, or the idle label — already composed.
    label: String,
    /// Whether there's a favoritable track right now (a live ICY now-playing).
    can_favorite: bool,
}

/// Build the tray icon + menu and start reflecting now-playing into it.
/// Called from run() only when `--tray` is passed.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    // Disabled label at the top — a live readout, not a button.
    let now_playing = MenuItem::with_id(app, "now_playing", IDLE, false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show ntune", true, None::<&str>)?;
    // Starts DISABLED — nothing is playing until the UI pushes a state saying so
    // (mirrors the in-window heart, which is disabled with no now-playing track).
    let favorite =
        MenuItem::with_id(app, "favorite", "\u{2665} Favorite current track", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ntune", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&now_playing)
        .separator()
        .item(&show)
        .item(&favorite)
        .separator()
        .item(&quit)
        .build()?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("ntune has a bundled window icon"),
        )
        .tooltip("ntune — not playing")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal_main_window(app),
            // The tray knows only artist/title; the station's DISPLAY name lives in
            // the frontend — so hand the click off and let the UI run the same
            // favorite toggle as the in-window heart (see onTrayFavorite in App.tsx).
            "favorite" => {
                let _ = app.emit("tray-favorite", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    // Mirror the UI's derived now-playing into the tray: label + tooltip + whether
    // the ♥ item is enabled. Frontend `emit` reaches Rust listeners in Tauri 2, so
    // App.tsx pushing state here keeps the tray and the in-window heart identical.
    let np_item = now_playing.clone();
    let fav_item = favorite.clone();
    let handle = app.clone();
    app.listen("tray-now-playing", move |event| {
        let Ok(state) = serde_json::from_str::<TrayState>(event.payload()) else {
            return;
        };
        let _ = np_item.set_text(&state.label);
        let _ = fav_item.set_enabled(state.can_favorite);
        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(format!("ntune — {}", state.label)));
        }
    });

    Ok(())
}

/// Show + unminimize + focus the main window (the tray's "Show ntune").
fn reveal_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
