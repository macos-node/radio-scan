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
    AppHandle, Emitter, Manager, Wry,
};

const TRAY_ID: &str = "ntune-tray";
const IDLE: &str = "Not playing";

/// The shared now-playing payload the tray READS from the bridge file (frozen
/// contract: ../../docs/nowplaying-bridge-2026-08-11.md). The tray is a file-poll
/// consumer — the very `nowplaying.json` ntune's `write_nowplaying` producer emits
/// and RadioBar reads on macOS — so every OS reflects playback through one
/// mechanism, not a second in-process source of truth. Only the tier-1 fields
/// matter here; the episode tracklist join (`r`→`*_log.audio_url`) is macOS-only
/// (no `*_log.jsonl` logger on Linux/Windows), so the tray shows banner-level info.
#[derive(Deserialize, Default)]
struct Bridge {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    subtitle: Option<String>,
    #[serde(default)]
    artist: Option<String>,
    #[serde(default)]
    track: Option<String>,
    #[serde(default)]
    playing: bool,
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

    // Reflect now-playing into the tray by POLLING the shared bridge file — the
    // same `nowplaying.json` the producer writes and RadioBar reads. Cross-app by
    // construction, and the one now-playing source on every OS.
    spawn_bridge_poller(app.clone(), now_playing.clone(), favorite.clone());

    Ok(())
}

/// Compose the tray label + ♥-enabled + tooltip from a bridge payload, matching
/// RadioBar's tier-1 banner: station → the live ICY `artist — track`; episode →
/// its title, with the podcast name in the tooltip. A ▶ prefix marks a live
/// readout. The ♥ is enabled only for a live ICY track (station), exactly as the
/// in-window heart gates on `nowPlaying` — episodes carry no ICY, so no favorite.
fn compose(b: &Bridge) -> (String, bool, String) {
    if !b.playing {
        return (IDLE.to_string(), false, "ntune — not playing".to_string());
    }
    let icy = [b.artist.as_deref(), b.track.as_deref()]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" \u{2014} ");
    let primary = if icy.is_empty() { b.title.clone() } else { icy };
    let can_favorite = b.artist.as_deref().is_some_and(|s| !s.is_empty())
        || b.track.as_deref().is_some_and(|s| !s.is_empty());
    let tooltip = match b.subtitle.as_deref().filter(|s| !s.is_empty()) {
        Some(sub) if b.kind == "episode" => format!("ntune — {primary} \u{00B7} {sub}"),
        _ => format!("ntune — {primary}"),
    };
    (format!("\u{25B6} {primary}"), can_favorite, tooltip)
}

/// Poll the bridge file every 3 s (RadioBar's cadence) on a worker thread; on a
/// content change, push the composed label / ♥-enabled / tooltip to the tray.
/// GTK requires menu + tray mutations on the main thread, so the file IO happens
/// on the worker and the writes are marshalled back via `run_on_main_thread`.
fn spawn_bridge_poller(app: AppHandle, np_item: MenuItem<Wry>, fav_item: MenuItem<Wry>) {
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            // The producer's own resolver, shared rather than restated — it now
            // carries the debug `-dev` split, and a second copy of the path would
            // have quietly kept reading the release file from a dev build.
            let content = crate::nowplaying_dir(&app)
                .ok()
                .map(|d| d.join("nowplaying.json"))
                .and_then(|p| std::fs::read_to_string(p).ok())
                .unwrap_or_default();
            if content != last {
                last = content.clone();
                let b: Bridge = serde_json::from_str(&content).unwrap_or_default();
                let (label, can_favorite, tooltip) = compose(&b);
                let np = np_item.clone();
                let fav = fav_item.clone();
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = np.set_text(&label);
                    let _ = fav.set_enabled(can_favorite);
                    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                        let _ = tray.set_tooltip(Some(tooltip));
                    }
                });
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

/// Show + unminimize + focus the main window (the tray's "Show ntune", and what a
/// second launch does instead of starting a rival process — see lib.rs).
pub fn reveal_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bridge(kind: &str, title: &str, artist: Option<&str>, track: Option<&str>) -> Bridge {
        Bridge {
            kind: kind.into(),
            title: title.into(),
            artist: artist.map(Into::into),
            track: track.map(Into::into),
            playing: true,
            ..Default::default()
        }
    }

    #[test]
    fn stopped_reads_idle_and_disables_favorite() {
        let (label, can_fav, tip) = compose(&Bridge::default());
        assert_eq!(label, "Not playing");
        assert!(!can_fav);
        assert_eq!(tip, "ntune — not playing");
    }

    #[test]
    fn station_with_icy_shows_artist_track_and_enables_favorite() {
        let b = bridge("station", "Acid Jazz", Some("Dana Bryant"), Some("Heat"));
        let (label, can_fav, tip) = compose(&b);
        assert_eq!(label, "\u{25B6} Dana Bryant \u{2014} Heat");
        assert!(can_fav);
        assert_eq!(tip, "ntune — Dana Bryant \u{2014} Heat");
    }

    #[test]
    fn station_without_icy_falls_back_to_title_and_disables_favorite() {
        // Playing but ICY hasn't arrived — mirror the in-window heart: no favorite
        // until a live track exists.
        let b = bridge("station", "Acid Jazz", None, None);
        let (label, can_fav, _tip) = compose(&b);
        assert_eq!(label, "\u{25B6} Acid Jazz");
        assert!(!can_fav);
    }

    #[test]
    fn episode_shows_title_with_podcast_in_tooltip_and_no_favorite() {
        let mut b = bridge("episode", "Episode 12", None, None);
        b.subtitle = Some("My Podcast".into());
        let (label, can_fav, tip) = compose(&b);
        assert_eq!(label, "\u{25B6} Episode 12");
        assert!(!can_fav, "episodes carry no ICY, so no favoritable track");
        assert_eq!(tip, "ntune — Episode 12 \u{00B7} My Podcast");
    }
}
