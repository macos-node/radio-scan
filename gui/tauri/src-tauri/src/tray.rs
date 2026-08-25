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

// Logger control is Linux-only by design — macOS drives the same jobs from
// RadioBar. See logger.rs and ../../docs/logger-control-surface-2026-08-25.md.
#[cfg(target_os = "linux")]
use crate::logger;


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

    let mut builder = MenuBuilder::new(app)
        .item(&now_playing)
        .separator()
        .item(&show)
        .item(&favorite);

    // The logger section is kept behind its own separator and its own header, and
    // its verbs always name the logger ("Pause logging", never a bare "Pause").
    // ntune's playback and radio-scan's jobs are unrelated state that happen to
    // share a menu; the decision doc makes that separation a requirement, because
    // one merged Pause three items from another is how a reader gets it wrong.
    #[cfg(target_os = "linux")]
    let logger_ui = build_logger_jobs(app)?;
    #[cfg(target_os = "linux")]
    {
        if !logger_ui.is_empty() {
            let header = MenuItem::with_id(app, "logger_header", "LOGGER", false, None::<&str>)?;
            builder = builder.separator().item(&header);
            for job in &logger_ui {
                builder = builder.item(&job.status).item(&job.toggle);
                if let Some(fetch) = &job.fetch {
                    builder = builder.item(fetch);
                }
            }
        }
    }

    let menu = builder.separator().item(&quit).build()?;

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
            #[cfg(target_os = "linux")]
            id if id.starts_with(LOGGER_PREFIX) => on_logger_click(id),
            _ => {}
        })
        .build(app)?;

    // Reflect now-playing into the tray by POLLING the shared bridge file — the
    // same `nowplaying.json` the producer writes and RadioBar reads. Cross-app by
    // construction, and the one now-playing source on every OS.
    spawn_bridge_poller(app.clone(), now_playing.clone(), favorite.clone());
    #[cfg(target_os = "linux")]
    if !logger_ui.is_empty() {
        spawn_logger_poller(app.clone(), logger_ui);
    }

    Ok(())
}

// --- logger control (Linux) --------------------------------------------------

#[cfg(target_os = "linux")]
const LOGGER_PREFIX: &str = "logger:";

/// One job's menu entries: a disabled status line (the live readout, exactly like
/// `now_playing` at the top of the menu) and the item that pauses or resumes it.
///
/// FLAT, not a submenu, and that is not a style choice. A submenu whose label
/// carried the status read better and does not work: on Linux the tray is a
/// StatusNotifierItem and the menu goes over DBusMenu, where `MenuItem::set_text`
/// propagates and `Submenu::set_text` does NOT. Measured here — the item inside a
/// submenu flipped to "Resume logging" while the submenu label above it still
/// said "logging", i.e. the poller was right and the label was a dead end. A
/// status that silently stops updating is worse than one that takes a row.
#[cfg(target_os = "linux")]
struct LoggerJob {
    job: &'static logger::Job,
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    fetch: Option<MenuItem<Wry>>,
}

/// Build a submenu per INSTALLED job. A box without radio-scan gets no section at
/// all rather than a menu full of dead entries — and since this runs once, a job
/// installed later needs an ntune restart to appear, which is the right trade for
/// not re-querying systemd to draw a menu that never changes shape.
#[cfg(target_os = "linux")]
fn build_logger_jobs(app: &AppHandle) -> tauri::Result<Vec<LoggerJob>> {
    let state = logger::query();
    let mut out = Vec::new();
    for job in logger::JOBS {
        let s = state.get(job.unit).copied().unwrap_or_default();
        if !s.present {
            continue;
        }
        let status = MenuItem::with_id(
            app,
            format!("{LOGGER_PREFIX}{}:status", job.unit),
            status_label(job, s),
            false,
            None::<&str>,
        )?;
        let toggle = MenuItem::with_id(
            app,
            format!("{LOGGER_PREFIX}{}:toggle", job.unit),
            toggle_label(job, s),
            true,
            None::<&str>,
        )?;
        let fetch = if job.kind == logger::Kind::Episodic {
            Some(MenuItem::with_id(
                app,
                format!("{LOGGER_PREFIX}{}:fetch", job.unit),
                format!("Fetch {} now", job.label),
                true,
                None::<&str>,
            )?)
        } else {
            None
        };
        out.push(LoggerJob { job, status, toggle, fetch });
    }
    Ok(out)
}

/// `Acid Jazz \u{2014} stopped \u{00B7} returns at login`. Both facts on one line, the
/// second clause being the one `is-enabled` adds.
#[cfg(target_os = "linux")]
fn status_label(job: &logger::Job, s: logger::State) -> String {
    format!("{} \u{2014} {}", job.label, logger::describe(job.kind, s))
}

/// Every verb names its job AND says "logging". ntune's own playback lives four
/// rows up in the same menu, so a bare "Pause" here would be ambiguous at exactly
/// the moment someone is reaching for it in a hurry.
#[cfg(target_os = "linux")]
fn toggle_label(job: &logger::Job, s: logger::State) -> String {
    let verb = if logger::is_on(job.kind, s) { "Pause" } else { "Resume" };
    format!("{verb} {} logging", job.label)
}

/// Act on a click. State is re-read here rather than trusted from the last poll:
/// the units are also driven from the shell and from the other box's habits, so
/// the menu is a view of systemd, never the record of it.
#[cfg(target_os = "linux")]
fn on_logger_click(id: &str) {
    let rest = &id[LOGGER_PREFIX.len()..];
    let Some((unit, action)) = rest.rsplit_once(':') else {
        return;
    };
    let Some(job) = logger::JOBS.iter().find(|j| j.unit == unit) else {
        return;
    };
    let (kind, unit) = (job.kind, job.unit.to_string());
    let action = action.to_string();
    // Off the main thread: `enable --now` can take a beat, and blocking here would
    // freeze the menu that is showing the result.
    std::thread::spawn(move || {
        let args = match action.as_str() {
            "fetch" => logger::fetch_args(&unit),
            "toggle" => {
                let s = logger::query().get(&unit).copied().unwrap_or_default();
                logger::toggle_args(kind, &unit, logger::is_on(kind, s))
            }
            _ => return,
        };
        logger::run(&args);
    });
}

/// Re-read systemd every 4 s and push any change into the labels. Polling rather
/// than subscribing on purpose: these units are also driven by `systemctl` in a
/// terminal, by the timers firing on their own, and by a reboot — so the menu has
/// to reflect systemd's state, not just the actions taken through it.
#[cfg(target_os = "linux")]
fn spawn_logger_poller(app: AppHandle, jobs: Vec<LoggerJob>) {
    std::thread::spawn(move || {
        let mut last = std::collections::HashMap::new();
        loop {
            let state = logger::query();
            if state != last {
                last = state.clone();
                for j in &jobs {
                    let s = state.get(j.job.unit).copied().unwrap_or_default();
                    let (status, toggle) = (j.status.clone(), j.toggle.clone());
                    let (label, verb) = (status_label(j.job, s), toggle_label(j.job, s));
                    let _ = app.run_on_main_thread(move || {
                        let _ = status.set_text(&label);
                        let _ = toggle.set_text(&verb);
                    });
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(4));
        }
    });
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
