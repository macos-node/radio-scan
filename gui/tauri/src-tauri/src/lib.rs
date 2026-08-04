// ntune — radio-scan's L4 desktop UI (the tuner / player / subscription surface).
// See ../../docs/radio-scan-ui-2026-08-04.md for the build map.
//
// U0 scope: the frontend plays remote streams directly in the webview <audio>
// element (WebKit2GTK plays *remote* media fine), so there is no Rust audio
// backend yet. This module exposes a single command that seeds a starter
// station list; from U1 the list comes from `station.v1` (31241) events read
// off the relays, and this seed becomes a first-run fallback.
//
// Later phases add here: the loopback ICY proxy (U3, port of radioscan.py's
// parser), the `station.v1` publisher (U2, keyring nsec), and the feed adapters
// (U4, feed-rs + the 1063 reader).

use serde::Serialize;

/// A tunable stream. Field-for-field the subset of `station.v1` the UI needs
/// (schema/station.v1.json): `slug` = the `d` suffix, `url` = the `r` tag.
#[derive(Serialize, Clone)]
pub struct Station {
    pub slug: String,
    pub name: String,
    pub url: String,
    pub fmt: Option<String>,
    pub bitrate: Option<u32>,
    pub tags: Vec<String>,
}

fn station(
    slug: &str,
    name: &str,
    url: &str,
    fmt: &str,
    bitrate: u32,
    tags: &[&str],
) -> Station {
    Station {
        slug: slug.to_string(),
        name: name.to_string(),
        url: url.to_string(),
        fmt: Some(fmt.to_string()),
        bitrate: Some(bitrate),
        tags: tags.iter().map(|t| t.to_string()).collect(),
    }
}

/// Starter stations. SomaFM's public ICY streams are used as reliable, well-
/// behaved seeds for proving remote-HTTP playback and (from U3) ICY metadata
/// parsing. Replaced in U1 by the user's followed `station.v1` events.
#[tauri::command]
fn seed_stations() -> Vec<Station> {
    vec![
        station(
            "groovesalad",
            "SomaFM — Groove Salad",
            "https://ice1.somafm.com/groovesalad-128-mp3",
            "audio/mpeg",
            128,
            &["ambient", "downtempo"],
        ),
        station(
            "dronezone",
            "SomaFM — Drone Zone",
            "https://ice1.somafm.com/dronezone-128-mp3",
            "audio/mpeg",
            128,
            &["ambient", "space"],
        ),
        station(
            "defcon",
            "SomaFM — DEF CON Radio",
            "https://ice1.somafm.com/defcon-128-mp3",
            "audio/mpeg",
            128,
            &["electronica"],
        ),
        station(
            "indiepop",
            "SomaFM — Indie Pop Rocks",
            "https://ice1.somafm.com/indiepop-128-mp3",
            "audio/mpeg",
            128,
            &["indie", "pop"],
        ),
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![seed_stations])
        .run(tauri::generate_context!())
        .expect("error while running ntune");
}
