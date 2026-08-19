// ntune — radio-scan's L4 desktop UI (the tuner / player / subscription surface).
// See ../../docs/radio-scan-ui-2026-08-04.md for the build map.
//
// Radio plays webview-side in the <audio> element, but through a Rust loopback
// proxy (proxy.rs) — a packaged app's secure origin (tauri://localhost) blocks a
// plain http:// stream as mixed content, so we play http://127.0.0.1:<port>
// instead. This module owns:
//   • proxy_port — the loopback stream proxy's port (playback fix + U3 tap point)
//   • seed_stations — the first-run fallback station list (U0)
//   • the local station store (stations.json) — the always-available, no-key
//     station list; adds persist to disk, seeded from seed_stations on first run
//   • nostr identity in the OS keychain + station.v1 publish/unfollow (U2)
//
// station.v1 (kind 31241) is signed with the owner nsec from the keyring — the
// same key as ndisc/ntree/nsmpl (one person = one npub). The signer/keyring
// plumbing mirrors ntree verbatim so the suite stays consistent.

use keyring::Entry;
use nostr::nips::nip19::{FromBech32, ToBech32};
use nostr::{EventBuilder, Keys, Kind, SecretKey, Tag};
use nostr_sdk::prelude::Output;
use nostr_sdk::Client;
use serde::{Deserialize, Serialize};
use tauri::Manager;

mod proxy;
mod tray;

// --- loopback stream proxy ---------------------------------------------------

/// The port the loopback stream proxy (proxy.rs) bound to this run. The webview
/// plays `http://127.0.0.1:<port>/?url=<upstream>` so a packaged (secure-origin)
/// build isn't blocked by mixed content on plain http:// streams.
struct ProxyPort(u16);

#[tauri::command]
fn proxy_port(state: tauri::State<'_, ProxyPort>) -> u16 {
    state.0
}

// --- seed stations (U0 fallback) --------------------------------------------

/// A tunable stream. Field-for-field the subset of `station.v1` the UI needs
/// (schema/station.v1.json): `slug` = the `d` suffix, `url` = the `r` tag.
/// Also the on-disk shape of the local station store (stations.json), so it
/// round-trips — hence `Deserialize`.
#[derive(Serialize, Deserialize, Clone)]
pub struct Station {
    pub slug: String,
    pub name: String,
    pub url: String,
    // Optional/descriptive fields default when absent, so an imported JSON with
    // only the required slug/name/url still deserializes (see import_local_stations).
    #[serde(default)]
    pub fmt: Option<String>,
    #[serde(default)]
    pub bitrate: Option<u32>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Optional human description — the station.v1 event *content*. Kept in the
    /// local store and surfaced like the podcast harvest.
    #[serde(default)]
    pub description: Option<String>,
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
        description: None,
    }
}

/// Starter stations. SomaFM's public ICY streams are reliable, well-behaved
/// seeds for proving remote-HTTP playback and (from U3) ICY metadata parsing.
/// Seeded into the local store on a fresh install (see `list_local_stations`)
/// so a new user has something to test the tuner with; every seed is a normal,
/// user-removable row afterwards.
fn seed_station_list() -> Vec<Station> {
    // A small, varied starter set — reliable SomaFM channels (https + one http and
    // one AAC, so both the direct and loopback-proxy paths get exercised in normal
    // use). All verified playing 2026-08-04.
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
            "secretagent",
            "SomaFM — Secret Agent",
            "https://ice1.somafm.com/secretagent-128-mp3",
            "audio/mpeg",
            128,
            &["downtempo", "lounge"],
        ),
        station(
            "groovesalad-aac",
            "SomaFM — Groove Salad (AAC)",
            "https://ice1.somafm.com/groovesalad-128-aac",
            "audio/aac",
            128,
            &["ambient", "aac"],
        ),
        station(
            "dronezone",
            "SomaFM — Drone Zone",
            "http://ice1.somafm.com/dronezone-128-mp3",
            "audio/mpeg",
            128,
            &["ambient", "space"],
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

/// The seed set, exposed to the renderer. Kept for callers/tests that want the
/// pristine list; the live station list now comes from `list_local_stations`,
/// which seeds itself from this on first run.
#[tauri::command]
fn seed_stations() -> Vec<Station> {
    seed_station_list()
}

// --- local station store (stations.json) ------------------------------------
// The always-available, no-key-required station list. Persisted as a JSON array
// in the app-data dir — the same dir the favorites log lives in, which Tauri
// resolves to the platform-standard location (Linux: $XDG_DATA_HOME/<id> a.k.a.
// ~/.local/share/<id>; macOS: ~/Library/Application Support/<id>). Adds land
// here immediately, survive restarts, and don't need a Nostr key. On a fresh
// install (file absent) it seeds from `seed_station_list`; every entry — seed or
// user-added — is then removable. Independent of the Nostr station.v1 layer,
// which stays an optional overlay for signed-in users.

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn stations_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("stations.json"))
}

/// Read the store. `Ok(None)` means the file is absent (a first run that has not
/// been seeded yet) — distinct from `Ok(Some(vec![]))`, an intentionally emptied
/// list, which must NOT be re-seeded.
fn read_local_stations(app: &tauri::AppHandle) -> Result<Option<Vec<Station>>, String> {
    match std::fs::read_to_string(stations_path(app)?) {
        Ok(t) => serde_json::from_str::<Vec<Station>>(&t)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_local_stations(app: &tauri::AppHandle, stations: &[Station]) -> Result<(), String> {
    let body = serde_json::to_string_pretty(stations).map_err(|e| e.to_string())?;
    std::fs::write(stations_path(app)?, body).map_err(|e| e.to_string())
}

/// The persisted station list. Seeds itself from `seed_station_list` on first
/// run (file absent) so a fresh install is testable out of the box.
#[tauri::command]
fn list_local_stations(app: tauri::AppHandle) -> Result<Vec<Station>, String> {
    match read_local_stations(&app)? {
        Some(v) => Ok(v),
        None => {
            let seeds = seed_station_list();
            write_local_stations(&app, &seeds)?;
            Ok(seeds)
        }
    }
}

/// Save a stream to the local store. Deduped by slug AND url (re-adding either
/// replaces in place); the newest add sorts to the top. No Nostr key required.
#[tauri::command]
fn add_local_station(
    app: tauri::AppHandle,
    slug: String,
    name: String,
    url: String,
    fmt: Option<String>,
    bitrate: Option<u32>,
    tags: Vec<String>,
    description: Option<String>,
) -> Result<Station, String> {
    let station = Station {
        slug,
        name,
        url,
        fmt,
        bitrate,
        tags,
        description,
    };
    // Ensure the store is materialised (seeds on first run) before mutating.
    let mut stations = list_local_stations(app.clone())?;
    stations.retain(|s| s.slug != station.slug && s.url != station.url);
    stations.insert(0, station.clone());
    write_local_stations(&app, &stations)?;
    Ok(station)
}

/// Remove a station from the local store by slug. Idempotent.
#[tauri::command]
fn remove_local_station(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    let stations = list_local_stations(app.clone())?;
    let kept: Vec<Station> = stations.into_iter().filter(|s| s.slug != slug).collect();
    write_local_stations(&app, &kept)
}

/// Merge imported stations into the local store and return the full list. Each
/// incoming station replaces any existing one with the same slug or url (deduped
/// exactly like add_local_station); imported entries sort to the top, newest
/// first. The renderer parses the JSON file (see importJson) so this takes the
/// already-typed Vec — a malformed file fails deserialization at the IPC layer.
#[tauri::command]
fn import_local_stations(
    app: tauri::AppHandle,
    stations: Vec<Station>,
) -> Result<Vec<Station>, String> {
    let mut current = list_local_stations(app.clone())?;
    // Newest-first: apply incoming in reverse so the first file entry ends up on top.
    for station in stations.into_iter().rev() {
        current.retain(|s| s.slug != station.slug && s.url != station.url);
        current.insert(0, station);
    }
    write_local_stations(&app, &current)?;
    Ok(current)
}

// --- local podcast store (podcasts.json) ------------------------------------
// Podcast subscriptions, persisted as a JSON array next to stations.json in the
// app-data dir. Mirrors the station store: a synchronous `std::fs::write`, so a
// sub lands on disk the instant it's added and survives ANY exit. This replaces
// the old webview `localStorage` path, whose writes WebView2 only flushed on a
// graceful shutdown — a crash, force-kill, OS sign-out, or the tray's "Quit"
// (which calls app.exit) dropped every unflushed change, so imported podcasts
// vanished on reopen while file-backed stations survived. Diagnosis + evidence:
// docs/podcast-persistence-2026-08-11.md. No first-run seed — an empty list is
// the honest fresh state; the renderer migrates any pre-existing localStorage
// subs into this store on the first launch after the change.

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PodcastSub {
    url: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    npub: Option<String>,
    /// Harvested: the feed's `<podcast:guid>`, when it carries one. The show's
    /// URL-independent identity — show.v1's NIP-73 `i` tag and U4.5's podcast key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    guid: Option<String>,
    /// Harvested: unix seconds of the newest episode seen in this feed, so the
    /// Podcasts tab's "Recent" order is right on the first paint instead of
    /// settling as the background prefetch trickles in. Every field the renderer
    /// sends must exist here — serde drops unknown keys on the way in, which is
    /// how this stamp silently never reached disk the first time round.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    latest_at: Option<i64>,
}

fn podcasts_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("podcasts.json"))
}

/// The persisted subscriptions — `[]` on first run (file absent). No seed; the
/// renderer owns migration from the legacy localStorage list.
#[tauri::command]
fn list_local_podcasts(app: tauri::AppHandle) -> Result<Vec<PodcastSub>, String> {
    match std::fs::read_to_string(podcasts_path(&app)?) {
        Ok(t) => serde_json::from_str::<Vec<PodcastSub>>(&t).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Replace the whole subscription list. The renderer owns merge/dedupe (exactly
/// as it did against localStorage); this command just makes the write durable.
#[tauri::command]
fn save_local_podcasts(app: tauri::AppHandle, subs: Vec<PodcastSub>) -> Result<(), String> {
    let body = serde_json::to_string_pretty(&subs).map_err(|e| e.to_string())?;
    std::fs::write(podcasts_path(&app)?, body).map_err(|e| e.to_string())?;
    prune_feed_cache(&app, &subs); // unsubscribing is the only way to orphan a body
    Ok(())
}

// --- local settings store (settings.json) -----------------------------------
// Small key->string UI prefs (theme, volume, list/card views), persisted next to
// stations.json so they survive ANY exit like the station/podcast stores do. They
// used to live in webview localStorage, which WebView2 only flushes on a graceful
// close — the same durability gap that lost podcasts (docs/podcast-persistence-
// 2026-08-11.md). localStorage stays a mirror (the index.html pre-paint theme read
// needs a synchronous source); this file is authoritative on load.

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("settings.json"))
}

/// All persisted UI settings — `{}` on first run (file absent).
#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<std::collections::BTreeMap<String, String>, String> {
    match std::fs::read_to_string(settings_path(&app)?) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(std::collections::BTreeMap::new())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Set one setting (read-modify-write, so concurrent single-key writes from
/// different components don't clobber each other). Synchronous — on disk before
/// it returns.
#[tauri::command]
fn set_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mut map = get_settings(app.clone())?;
    map.insert(key, value);
    let body = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&app)?, body).map_err(|e| e.to_string())
}

/// Write `contents` to `path` — the write half of the JSON export. `path` comes
/// from the plugin Save dialog (a user-chosen location), so this just commits
/// the bytes; the renderer builds the JSON.
#[tauri::command]
fn export_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read a text file — the read half of JSON import. `path` comes from the plugin
/// Open dialog (a user-chosen file); the renderer parses the returned string.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write the shared now-playing state file — the local, cross-app rendezvous for
/// the menubar/tray bridge (frozen contract: docs/nowplaying-bridge-2026-08-11.md).
/// Path = `<local_data_dir()>/radio-scan/nowplaying.json`: the OS BASE data dir
/// (NOT `app_local_data_dir()`, which appends the bundle id) + a product-scoped
/// constant, so a native consumer (RadioBar) derives the same path without knowing
/// ntune's Tauri identifier. One resolver on every OS — no per-OS `cfg` branch.
#[tauri::command]
fn write_nowplaying(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let dir = app
        .path()
        .local_data_dir()
        .map_err(|e| e.to_string())?
        .join("radio-scan");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("nowplaying.json"), text).map_err(|e| e.to_string())
}

// --- nostr identity (OS keychain) -------------------------------------------
// Its own keychain service (like ntree's), holding the owner nsec. Debug builds
// use a separate `-dev` service so `tauri dev` never touches installed state.

const KEYRING_SERVICE_RELEASE: &str = "ntune";
const KEYRING_SERVICE_DEV: &str = "ntune-dev";
const KEYRING_USER: &str = "default";

fn keyring_service() -> &'static str {
    if cfg!(debug_assertions) {
        KEYRING_SERVICE_DEV
    } else {
        KEYRING_SERVICE_RELEASE
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    npub: String,
    pk: String, // hex pubkey, for relay author filters
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedIdentity {
    npub: String,
    pk: String,
    /// Returned ONCE on generate so the user can back the key up. After
    /// `get_identity`, only npub + pk come back; nsec stays in the keychain.
    nsec: String,
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(keyring_service(), KEYRING_USER).map_err(|e| e.to_string())
}

fn load_nsec() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn store_nsec(nsec: &str) -> Result<(), String> {
    keyring_entry()?.set_password(nsec).map_err(|e| e.to_string())
}

fn keys_from_nsec(nsec: &str) -> Result<Keys, String> {
    let sk = SecretKey::from_bech32(nsec).map_err(|e| format!("invalid nsec: {e}"))?;
    Ok(Keys::new(sk))
}

fn identity_from_keys(keys: &Keys) -> Result<Identity, String> {
    let npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    let pk = keys.public_key().to_hex();
    Ok(Identity { npub, pk })
}

/// Load the signing keys from the keychain, or a clear error if none is set.
fn owner_keys() -> Result<Keys, String> {
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity in keychain".to_string())?;
    keys_from_nsec(&nsec)
}

#[tauri::command]
fn get_identity() -> Result<Option<Identity>, String> {
    let Some(nsec) = load_nsec()? else {
        return Ok(None);
    };
    Ok(Some(identity_from_keys(&keys_from_nsec(&nsec)?)?))
}

#[tauri::command]
fn generate_identity() -> Result<GeneratedIdentity, String> {
    let keys = Keys::generate();
    let nsec = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
    let id = identity_from_keys(&keys)?;
    store_nsec(&nsec)?;
    Ok(GeneratedIdentity {
        npub: id.npub,
        pk: id.pk,
        nsec,
    })
}

#[tauri::command]
fn import_identity(nsec: String) -> Result<Identity, String> {
    let nsec = nsec.trim().to_owned();
    let id = identity_from_keys(&keys_from_nsec(&nsec)?)?;
    store_nsec(&nsec)?;
    Ok(id)
}

#[tauri::command]
fn clear_identity() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- station.v1 publish / unfollow (U2) -------------------------------------

const STATION_KIND: u16 = 31241;
const D_STATION_PREFIX: &str = "airplay:station:";
/// show.v1 — a podcast/scheduled show a user follows. The feed-shaped sibling of
/// station.v1: same addressable, per-publisher shape, but `r` is an RSS/Atom FEED
/// URL rather than a stream mount. Contract: schema/show.v1.json.
const SHOW_KIND: u16 = 31242;
const D_SHOW_PREFIX: &str = "airplay:show:";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RelayError {
    relay: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResult {
    event_id: String,
    /// The addressable coordinate `31241:<pk>:<d>` — the station's identity.
    address: String,
    accepted_by: Vec<String>,
    rejected: Vec<RelayError>,
}

async fn build_client(keys: Keys, relays: &[String]) -> Client {
    let client = Client::builder().signer(keys).build();
    for url in relays {
        let _ = client.add_relay(url.as_str()).await;
    }
    client.connect().await;
    client
}

fn split_send_output(output: &Output<nostr::EventId>) -> (Vec<String>, Vec<RelayError>) {
    let accepted = output.success.iter().map(|u| u.to_string()).collect();
    let rejected = output
        .failed
        .iter()
        .map(|(url, err)| RelayError {
            relay: url.to_string(),
            error: err.clone(),
        })
        .collect();
    (accepted, rejected)
}

/// Send a signed event to `relays` and shape the per-relay result. Errors only
/// when NO relay accepted it (a partial accept still succeeds).
async fn publish_event(
    keys: Keys,
    event: nostr::Event,
    address: String,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    let event_id = event.id.to_string();
    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);
    if accepted_by.is_empty() {
        let first = rejected
            .first()
            .map(|r| format!("{}: {}", r.relay, r.error))
            .unwrap_or_else(|| "no relays accepted the event".to_string());
        return Err(format!("publish failed — {first}"));
    }
    Ok(PublishResult {
        event_id,
        address,
        accepted_by,
        rejected,
    })
}

/// Is this content-type conclusively NOT audio? `Some(hint)` names what it looks
/// like instead; `None` means audio, or inconclusive.
///
/// Mirrors `audioVerdict` in AddStationDialog.tsx deliberately: the dialog guards
/// what lands in the LOCAL store (soft — "Add anyway" always wins, it's your
/// device), this guards what goes on the RELAYS (hard — see publish_station).
fn non_audio_hint(content_type: &str) -> Option<&'static str> {
    let ct = content_type.trim().to_ascii_lowercase();
    if ct.is_empty() {
        return None; // no content-type: inconclusive, never block
    }
    let is_audio = ct.starts_with("audio/")
        || ct.contains("ogg")
        || ct.contains("mpegurl") // HLS / m3u
        || ct.contains("aacp");
    if is_audio {
        return None;
    }
    Some(if ct.contains("xml") || ct.contains("rss") {
        "an RSS/Atom feed"
    } else if ct.contains("html") {
        "a web page"
    } else if ct.contains("json") {
        "a data feed"
    } else {
        "a non-audio resource"
    })
}

/// Is this content-type conclusively audio? `Some(hint)` when a URL offered as a
/// FEED turns out to be a stream — the mirror of non_audio_hint, and the other half
/// of keeping `#r` honest per kind. `None` means feed-shaped, or inconclusive.
fn audio_stream_hint(content_type: &str) -> Option<&'static str> {
    let ct = content_type.trim().to_ascii_lowercase();
    if ct.is_empty() {
        return None; // no content-type: inconclusive, never block
    }
    let is_audio = ct.starts_with("audio/")
        || ct.contains("ogg")
        || ct.contains("mpegurl") // HLS / m3u
        || ct.contains("aacp");
    is_audio.then_some("an audio stream")
}

/// Header-only probe of what a URL actually serves. Returns the content-type, or
/// an empty string when the server sends none / the request fails — both of which
/// the caller must treat as inconclusive rather than as a verdict.
async fn probe_content_type(url: &str) -> String {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    // send() resolves at the response head; the (possibly endless) body is dropped.
    match client
        .get(url)
        .header("User-Agent", "ntune (radio-scan)")
        .send()
        .await
    {
        Ok(resp) => resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string(),
        Err(_) => String::new(),
    }
}

/// Publish (or replace) a `station.v1` (kind 31241) — "follow this stream".
/// Parameterised-replaceable: re-publishing the same slug edits in place.
/// Signed with the owner nsec; `relays` come from the renderer so the read
/// subscription and the publish target stay in sync.
#[tauri::command]
async fn publish_station(
    slug: String,
    name: String,
    url: String,
    fmt: Option<String>,
    bitrate: Option<u32>,
    tags: Vec<String>,
    description: String,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    // Refuse to put a non-stream on the relays. station.v1 defines `r` as "the
    // direct stream URL (the mount)", and `#r` is the RELAY-FILTERABLE cross-user
    // station identity — so a feed URL here isn't just a dead row in one list, it
    // publishes a non-tunable thing into everyone's discovery space. Two podcast
    // feeds reached the relays this way in 2026-08 and had to be deleted by hand.
    //
    // Hard refusal, unlike the add-dialog's soft warning, because this crosses the
    // wire: the local store still takes anything you insist on. Only a CONCLUSIVE
    // non-audio content-type blocks; no content-type or a failed probe passes, so a
    // genuine stream that simply doesn't advertise its type is never blocked.
    if let Some(hint) = non_audio_hint(&probe_content_type(&url).await) {
        return Err(format!(
            "{url} serves {hint}, not an audio stream — station.v1 publishes the \
             stream mount. Keep it locally, or subscribe to it in the Podcasts tab."
        ));
    }

    let keys = owner_keys()?;
    let d = format!("{D_STATION_PREFIX}{slug}");

    let mut ev_tags = vec![
        Tag::parse(["d", &d]).map_err(|e| e.to_string())?,
        Tag::parse(["name", &name]).map_err(|e| e.to_string())?,
        Tag::parse(["r", &url]).map_err(|e| e.to_string())?,
    ];
    if let Some(fmt) = fmt.filter(|s| !s.trim().is_empty()) {
        ev_tags.push(Tag::parse(["fmt", &fmt]).map_err(|e| e.to_string())?);
    }
    if let Some(br) = bitrate {
        ev_tags.push(Tag::parse(["br", &br.to_string()]).map_err(|e| e.to_string())?);
    }
    for t in tags.iter().filter(|s| !s.trim().is_empty()) {
        ev_tags.push(Tag::parse(["t", t]).map_err(|e| e.to_string())?);
    }
    ev_tags.push(
        Tag::parse(["alt", "A radio stream followed in radio-scan"])
            .map_err(|e| e.to_string())?,
    );

    let event = EventBuilder::new(Kind::Custom(STATION_KIND), description)
        .tags(ev_tags)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;

    let address = format!("{STATION_KIND}:{}:{d}", keys.public_key().to_hex());
    publish_event(keys, event, address, relays).await
}

/// The NIP-09 target tags for a station deletion: always the addressable `a`
/// coordinate, plus the concrete `e` id when the caller knows it. A blank or
/// whitespace-only id is treated as absent rather than published as an empty tag.
fn deletion_tags(address: &str, event_id: Option<&str>) -> Result<Vec<Tag>, String> {
    let mut tags = vec![Tag::parse(["a", address]).map_err(|e| e.to_string())?];
    if let Some(id) = event_id.map(str::trim).filter(|s| !s.is_empty()) {
        tags.push(Tag::parse(["e", id]).map_err(|e| e.to_string())?);
    }
    Ok(tags)
}

/// Unfollow a station: publish a NIP-09 kind:5 deletion of its `station.v1`.
///
/// Tags the addressable `a` coordinate AND, when the caller knows it, the
/// concrete event `e` id. Both are legal NIP-09 targets and they cover different
/// relay implementations: several honour deletion only **by event id**, so an
/// `a`-only deletion is accepted and then quietly ignored. Measured 2026-08-18 on
/// the suite's own hub — `relay.fizx.uk` still served every station it had been
/// told to delete (7 of 7), while nos.lol dropped them. ntune filters deletions
/// client-side (`resolveStations`) so it was unaffected either way; any other
/// client reading that relay was not.
///
/// `event_id` is absent for a row that only ever lived in the local store — there
/// is no published event to name, and the `a` tag alone is the whole truth.
#[tauri::command]
async fn unfollow_station(
    slug: String,
    event_id: Option<String>,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    let keys = owner_keys()?;
    let address = format!(
        "{STATION_KIND}:{}:{D_STATION_PREFIX}{slug}",
        keys.public_key().to_hex()
    );

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags(deletion_tags(&address, event_id.as_deref())?)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;

    publish_event(keys, event, address, relays).await
}

// --- show.v1 (kind 31242) ---------------------------------------------------
// Publishing a podcast follow. The feed-shaped sibling of station.v1 above: same
// addressable per-publisher shape, `r` carrying the FEED url, and — when the feed
// states one — the Podcasting-2.0 channel GUID as a NIP-73 `i` tag.
//
// Why a separate kind rather than reusing station.v1: `r` there is defined as the
// stream mount and `#r` is the relay-filterable identity of a TUNABLE thing, so a
// feed published as a station hands every consumer something it cannot play. Two
// went out that way in 2026-08 and had to be deleted by hand. Contract + the whole
// argument: schema/show.v1.json; decision #10 in the v0.2.0 direction doc.

/// The tags for a `show.v1` event. Pure, so the shape is unit-testable without a key.
///
/// `guid` becomes a NIP-73 external content id (`podcast:guid:<guid>`) — the show's
/// identity independent of the URL serving it, and the preferred cross-user key
/// because a feed URL is not stable (podbean serves one document from two
/// hostnames). Absent on plenty of feeds — 3 of 11 in the reference profile — so it
/// is optional and never published blank.
fn show_tags(
    d: &str,
    name: &str,
    url: &str,
    guid: Option<&str>,
    topics: &[String],
) -> Result<Vec<Tag>, String> {
    let mut tags = vec![
        Tag::parse(["d", d]).map_err(|e| e.to_string())?,
        Tag::parse(["name", name]).map_err(|e| e.to_string())?,
        Tag::parse(["r", url]).map_err(|e| e.to_string())?,
    ];
    if let Some(g) = guid.map(str::trim).filter(|g| !g.is_empty()) {
        tags.push(Tag::parse(["i", &format!("podcast:guid:{g}")]).map_err(|e| e.to_string())?);
    }
    for t in topics.iter().filter(|s| !s.trim().is_empty()) {
        tags.push(Tag::parse(["t", t]).map_err(|e| e.to_string())?);
    }
    tags.push(
        Tag::parse(["alt", "A podcast followed in radio-scan"]).map_err(|e| e.to_string())?,
    );
    Ok(tags)
}

/// Publish (or replace) a `show.v1` (kind 31242) — "follow this feed".
/// Parameterised-replaceable: re-publishing the same slug edits in place.
#[tauri::command]
async fn publish_show(
    slug: String,
    name: String,
    url: String,
    guid: Option<String>,
    tags: Vec<String>,
    description: String,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    // The mirror of publish_station's guard: a show's `r` is a feed, so a stream
    // URL here is the same mistake in the other direction. Hard refusal, because
    // this crosses the wire; only a CONCLUSIVE audio content-type blocks, so a feed
    // served without a content-type is never held back.
    if let Some(hint) = audio_stream_hint(&probe_content_type(&url).await) {
        return Err(format!(
            "{url} serves {hint}, not a podcast feed — show.v1 publishes the feed \
             URL. It belongs in the Stations tab."
        ));
    }

    let keys = owner_keys()?;
    let d = format!("{D_SHOW_PREFIX}{slug}");
    let event = EventBuilder::new(Kind::Custom(SHOW_KIND), description)
        .tags(show_tags(&d, &name, &url, guid.as_deref(), &tags)?)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;

    let address = format!("{SHOW_KIND}:{}:{d}", keys.public_key().to_hex());
    publish_event(keys, event, address, relays).await
}

/// Unfollow a show: publish a NIP-09 kind:5 deletion of its `show.v1`. Tags both
/// the `a` coordinate and, when known, the `e` id — see deletion_tags for why the
/// second one is not optional in practice.
#[tauri::command]
async fn unfollow_show(
    slug: String,
    event_id: Option<String>,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    let keys = owner_keys()?;
    let address = format!(
        "{SHOW_KIND}:{}:{D_SHOW_PREFIX}{slug}",
        keys.public_key().to_hex()
    );

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags(deletion_tags(&address, event_id.as_deref())?)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;

    publish_event(keys, event, address, relays).await
}

// --- podcast RSS (U4) -------------------------------------------------------
// Subscribe to a podcast by feed URL; fetch + parse RSS 2.0 / Atom (feed-rs)
// into an episode list the UI plays through the same <audio>/proxy path as radio.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Episode {
    /// Stable id — the entry guid, else the enclosure URL.
    id: String,
    title: String,
    /// The audio enclosure URL (what the player loads).
    enclosure_url: String,
    mime: Option<String>,
    /// Episode length in seconds, when the feed declares it.
    duration_secs: Option<u64>,
    /// Publish time (unix seconds), when present.
    published_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Podcast {
    title: String,
    description: Option<String>,
    /// Cover-art URL. Kept and surfaced to the frontend, but display is deferred
    /// (U4 decision 2026-08-06) — store the link, decide rendering/caching later.
    image: Option<String>,
    // --- Tier-A harvest (feed-rs already parses these; we simply stopped
    //     discarding them, per the 2026-08-06 11-feed measurement). All are
    //     channel-level show identity, feed-authoritative; the user-authored
    //     enrichment overlay only fills whichever of these the feed left empty.
    /// `itunes:author` / `<managingEditor>` names, de-duped, joined.
    author: Option<String>,
    /// `itunes:owner` email (first author carrying one) → `mailto:` link-out.
    owner_email: Option<String>,
    /// Channel `<link>` — the show website.
    website: Option<String>,
    /// `itunes:category` / `<category>` terms, de-duped, in feed order.
    categories: Vec<String>,
    /// `<language>` (e.g. "en", "it").
    language: Option<String>,
    /// `<copyright>` / `rights`.
    copyright: Option<String>,
    /// `<podcast:guid>` — the Podcasting-2.0 channel GUID (see extract_podcast_guid).
    /// `serde(default)` so feed-cache entries written before this field still load
    /// instead of being discarded as unreadable.
    #[serde(default)]
    guid: Option<String>,
    episodes: Vec<Episode>,
}

// --- <podcast:guid> --------------------------------------------------------
// The Podcasting-2.0 channel GUID: a show's identity independent of the URL it is
// served from. show.v1 publishes it as a NIP-73 `i` tag (podcast:guid:<guid>) and
// U4.5 keys the harvest slice on it, because a feed URL is demonstrably NOT stable
// — podbean served the byte-identical 4,053,739-byte document from two hostnames
// (2026-08-18), and a URL-keyed dedupe read that as two shows.
//
// feed-rs 2.x has no extension map, so this is unreachable through the parsed
// model; we scan the raw bytes we already hold.

/// Namespace URIs seen binding the `podcast:` prefix in the wild. The canonical
/// one is podcastindex.org/namespace/1.0, but feeds bind whatever they like —
/// No Agenda's binds the prefix to the namespace's GitHub docs page.
const PODCAST_NS: [&str; 4] = [
    "https://podcastindex.org/namespace/1.0",
    "http://podcastindex.org/namespace/1.0",
    "https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md",
    "http://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md",
];

/// The channel-level `<podcast:guid>`, if the feed carries one.
///
/// Accepts an element whose local name is `guid` when EITHER its prefix resolves
/// to a known podcast-namespace URI OR the prefix is literally `podcast`. The
/// prefix check is not laziness: measured across live feeds 2026-08-18, three
/// bound `podcast:` to the canonical URI and No Agenda bound it to the GitHub docs
/// page — a URI-only match would silently drop a guid the feed clearly states. A
/// prefix-only match would be wrong the other way, so we take either.
///
/// Only the CHANNEL's guid counts: `<guid>` inside an `<item>` is the episode id,
/// an entirely different thing, and every RSS feed is full of them.
fn extract_podcast_guid(bytes: &[u8]) -> Option<String> {
    use quick_xml::events::Event;
    use quick_xml::name::ResolveResult;

    let mut reader = quick_xml::NsReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut item_depth = 0usize;

    loop {
        buf.clear();
        let (ns, ev) = match reader.read_resolved_event_into(&mut buf) {
            Ok(v) => v,
            Err(_) => return None, // malformed XML: feed-rs will report it
        };
        match ev {
            Event::Eof => return None,
            Event::Start(ref e) => {
                let local = e.local_name();
                let local = local.as_ref();
                let prefix = e.name().prefix().map(|p| p.as_ref().to_vec());
                if prefix.is_none() && (local == b"item" || local == b"entry") {
                    item_depth += 1;
                    continue;
                }
                if item_depth > 0 || local != b"guid" {
                    continue;
                }
                let in_podcast_ns = match ns {
                    ResolveResult::Bound(n) => std::str::from_utf8(n.as_ref())
                        .map(|u| PODCAST_NS.contains(&u))
                        .unwrap_or(false),
                    _ => false,
                };
                let prefixed_podcast = prefix.as_deref() == Some(b"podcast".as_slice());
                if !in_podcast_ns && !prefixed_podcast {
                    continue;
                }
                let end = e.to_end().into_owned();
                if let Ok(text) = reader.read_text(end.name()) {
                    let guid = String::from_utf8_lossy(text.as_ref()).trim().to_string();
                    if !guid.is_empty() {
                        return Some(guid);
                    }
                }
            }
            Event::End(ref e) => {
                let local = e.local_name();
                if e.name().prefix().is_none()
                    && (local.as_ref() == b"item" || local.as_ref() == b"entry")
                {
                    item_depth = item_depth.saturating_sub(1);
                }
            }
            _ => {}
        }
    }
}

/// The audio enclosure for a feed entry: prefer a media object, fall back to an
/// `enclosure`/audio link. Returns (url, mime, duration_secs).
fn entry_enclosure(entry: &feed_rs::model::Entry) -> Option<(String, Option<String>, Option<u64>)> {
    for m in &entry.media {
        for c in &m.content {
            if let Some(url) = &c.url {
                let mime = c.content_type.as_ref().map(|m| m.to_string());
                let is_audio = mime.as_deref().is_none_or(|s| s.starts_with("audio"));
                if is_audio {
                    return Some((url.to_string(), mime, c.duration.map(|d| d.as_secs())));
                }
            }
        }
    }
    for l in &entry.links {
        let is_enclosure = l.rel.as_deref() == Some("enclosure")
            || l.media_type.as_deref().is_some_and(|m| m.starts_with("audio"));
        if is_enclosure {
            return Some((l.href.clone(), l.media_type.clone(), None));
        }
    }
    None
}

// --- feed body cache --------------------------------------------------------
// Parsed feeds persist under `<app_data_dir>/feed-cache/`, one file per feed, so
// opening the Podcasts tab paints from disk instead of from a blank slate while
// eleven feeds refetch. The session cache in PodcastTab.tsx died with the process,
// so every launch re-downloaded every feed before showing anything.
//
// Freshness is the server's call, not a TTL: each entry keeps the ETag /
// Last-Modified it was served with and the next fetch sends them back as a
// conditional GET, so an unchanged feed costs one 304 with no body and no reparse.
// Cache files are named by a hash of the feed URL; the URL itself lives in the
// envelope, so nothing depends on the name being readable.

fn feed_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_data_dir(app)?.join("feed-cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// FNV-1a over the feed URL — a filename, not a security boundary. Stable across
/// builds (unlike DefaultHasher), so yesterday's cache is still found today.
fn cache_key(url: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in url.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    format!("{h:016x}.json")
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// How much of a feed we know how to read. Bump this whenever the PARSE output
/// changes — a new harvested field, a fixed extractor — so bodies stored by an
/// older build are re-fetched in full instead of being revalidated forever.
///
/// Without it a conditional GET quietly starves every parser change: an unchanged
/// feed answers 304, we hand back the stored body, and the new field stays empty
/// until the publisher happens to touch the feed. Found while adding
/// `<podcast:guid>` (v2) on top of eleven already-cached bodies (v1).
const FEED_CACHE_VERSION: u32 = 2;

fn feed_cache_v1() -> u32 {
    1 // entries written before the version field existed
}

/// One cached feed: the parsed podcast plus what the next conditional GET needs.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CachedFeed {
    url: String,
    /// Parser generation that produced `podcast` (see FEED_CACHE_VERSION).
    #[serde(default = "feed_cache_v1")]
    v: u32,
    /// When this body was last confirmed current (a 304 refreshes it too).
    fetched_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_modified: Option<String>,
    podcast: Podcast,
}

fn read_cached_feed(app: &tauri::AppHandle, url: &str) -> Option<CachedFeed> {
    let path = feed_cache_dir(app).ok()?.join(cache_key(url));
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<CachedFeed>(&text).ok()
}

/// Best-effort — a cache write that fails must never fail the fetch that produced
/// a perfectly good feed.
fn write_cached_feed(app: &tauri::AppHandle, entry: &CachedFeed) {
    let Ok(dir) = feed_cache_dir(app) else { return };
    if let Ok(body) = serde_json::to_string(entry) {
        let _ = std::fs::write(dir.join(cache_key(&entry.url)), body);
    }
}

/// Cached feeds for the given subscriptions, in whatever order they are found.
/// Missing or unreadable entries are simply absent — the caller refetches.
#[tauri::command]
fn cached_podcasts(app: tauri::AppHandle, urls: Vec<String>) -> Vec<CachedFeed> {
    urls.iter()
        .filter_map(|u| read_cached_feed(&app, u))
        .collect()
}

/// Drop cache files for feeds that are no longer subscribed. Called on every
/// subscription write, so the directory tracks the sub list instead of growing
/// forever; unsubscribing is the only thing that can orphan an entry.
fn prune_feed_cache(app: &tauri::AppHandle, subs: &[PodcastSub]) {
    let Ok(dir) = feed_cache_dir(app) else { return };
    let keep: std::collections::HashSet<String> =
        subs.iter().map(|s| cache_key(&s.url)).collect();
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") && !keep.contains(&name) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Fetch and parse a podcast feed into an episode list (newest first).
#[tauri::command]
async fn fetch_podcast(app: tauri::AppHandle, url: String) -> Result<Podcast, String> {
    // Ask only for what changed: if we hold a body, replay its validators and let
    // the server answer 304 (no body, no reparse) when the feed is untouched.
    let cached = read_cached_feed(&app, &url);
    let mut req = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "ntune (radio-scan)");
    // Only revalidate a body this build knows how to read. A stale-version entry
    // still paints (cached_podcasts returns it), but it must be re-fetched in full
    // so the current parser sees the document.
    if let Some(c) = cached.as_ref().filter(|c| c.v == FEED_CACHE_VERSION) {
        if let Some(tag) = &c.etag {
            req = req.header("If-None-Match", tag.clone());
        }
        if let Some(lm) = &c.last_modified {
            req = req.header("If-Modified-Since", lm.clone());
        }
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;

    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        // Unchanged. Restamp so `fetchedAt` means "last confirmed current".
        if let Some(mut c) = cached {
            c.fetched_at = now_secs();
            c.v = FEED_CACHE_VERSION; // only sent validators for a current-version body
            write_cached_feed(&app, &c);
            return Ok(c.podcast);
        }
        return Err("server sent 304 with nothing cached".to_string());
    }

    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    let header = |name: &str| {
        resp.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let etag = header("etag");
    let last_modified = header("last-modified");
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let feed = feed_rs::parser::parse(&bytes[..]).map_err(|e| format!("parse failed: {e}"))?;

    let episodes = feed
        .entries
        .iter()
        .filter_map(|e| {
            let (enclosure_url, mime, duration_secs) = entry_enclosure(e)?;
            Some(Episode {
                id: if e.id.is_empty() { enclosure_url.clone() } else { e.id.clone() },
                title: e.title.as_ref().map(|t| t.content.clone()).unwrap_or_default(),
                enclosure_url,
                mime,
                duration_secs,
                published_at: e.published.map(|d| d.timestamp()),
            })
        })
        .collect();

    // --- Tier-A harvest: pull the channel-level identity feed-rs already parsed.
    // Borrows below all end before the struct literal moves title/description/logo.
    let author = {
        let mut seen = std::collections::HashSet::new();
        let names: Vec<String> = feed
            .authors
            .iter()
            .map(|p| p.name.trim().to_string())
            .filter(|n| !n.is_empty() && seen.insert(n.clone()))
            .collect();
        (!names.is_empty()).then(|| names.join(", "))
    };
    let owner_email = feed
        .authors
        .iter()
        .find_map(|p| p.email.as_ref().map(|e| e.trim().to_string()))
        .filter(|e| !e.is_empty());
    let website = feed
        .links
        .iter()
        .find(|l| {
            let rel = l.rel.as_deref();
            rel != Some("self") && rel != Some("enclosure") && rel != Some("hub")
                && l.href.starts_with("http")
        })
        .map(|l| l.href.clone());
    let categories = {
        let mut seen = std::collections::HashSet::new();
        feed.categories
            .iter()
            .map(|c| c.label.clone().unwrap_or_else(|| c.term.clone()).trim().to_string())
            .filter(|s| !s.is_empty() && seen.insert(s.clone()))
            .collect()
    };
    let language = feed.language.clone();
    let copyright = feed.rights.as_ref().map(|t| t.content.trim().to_string());

    let podcast = Podcast {
        guid: extract_podcast_guid(&bytes),
        title: feed.title.map(|t| t.content).unwrap_or_else(|| "Untitled".to_string()),
        description: feed.description.map(|t| t.content),
        image: feed.logo.or(feed.icon).map(|i| i.uri),
        author,
        owner_email,
        website,
        categories,
        language,
        copyright,
        episodes,
    };

    write_cached_feed(
        &app,
        &CachedFeed {
            url: url.clone(),
            v: FEED_CACHE_VERSION,
            fetched_at: now_secs(),
            etag,
            last_modified,
            podcast: podcast.clone(),
        },
    );
    Ok(podcast)
}

// --- station ICY probe (win #2) ---------------------------------------------
// Read a stream's static ICY headers (icy-name/genre/br/url) WITHOUT playing it,
// so a tuned station can be enriched with the metadata the stream advertises —
// notably icy-url (a homepage stations otherwise lack). Header-only: send()
// resolves at the response head; we read the headers and drop the (endless) body.
// Works for http AND https (reqwest/rustls), unlike the http-only audio proxy.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IcyInfo {
    /// icy-name — station name, often with a descriptive tagline.
    name: Option<String>,
    /// icy-genre — the stream's self-declared genre(s).
    genre: Option<String>,
    /// icy-br — advertised bitrate in kbps.
    bitrate: Option<u32>,
    /// icy-url — the station homepage.
    homepage: Option<String>,
    /// Content-Type — the codec (audio/mpeg, audio/aac, …).
    fmt: Option<String>,
}

#[tauri::command]
async fn station_icy(url: String) -> Result<IcyInfo, String> {
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Icy-MetaData", "1")
        .header("User-Agent", "ntune (radio-scan)")
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let h = resp.headers();
    let get = |k: &str| {
        h.get(k)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let info = IcyInfo {
        name: get("icy-name"),
        genre: get("icy-genre"),
        bitrate: get("icy-br").and_then(|v| v.parse().ok()),
        homepage: get("icy-url"),
        fmt: get("content-type"),
    };
    // `resp` (with its unread streaming body) drops here, closing the connection.
    Ok(info)
}

// --- favorites (local curated log) ------------------------------------------
// A favorite is a track you liked while listening (from U3's now-playing).
// v1 is local-first: appended to favorites.jsonl in the app-data dir. The later
// layer (kind:7 reaction on airplay.v1, keyed to the master-release-key) is a
// follow-up — see gui/tauri/docs/menubar-companion-2026-08-04.md.

#[derive(Serialize, Deserialize, Clone)]
struct Favorite {
    id: String,      // epoch millis — a stable per-record handle for removal
    artist: String,
    title: String,
    station: String, // the station name it was heard on
    url: String,     // the station's stream url
    ts: i64,         // epoch seconds
}

fn favorites_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("favorites.jsonl"))
}

fn read_favorites(app: &tauri::AppHandle) -> Result<Vec<Favorite>, String> {
    match std::fs::read_to_string(favorites_path(app)?) {
        Ok(t) => Ok(t
            .lines()
            .filter_map(|l| serde_json::from_str::<Favorite>(l).ok())
            .collect()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn add_favorite(
    app: tauri::AppHandle,
    artist: String,
    title: String,
    station: String,
    url: String,
) -> Result<Favorite, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let fav = Favorite {
        id: now.as_millis().to_string(),
        artist,
        title,
        station,
        url,
        ts: now.as_secs() as i64,
    };
    let line = serde_json::to_string(&fav).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(favorites_path(&app)?)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())?;
    Ok(fav)
}

#[tauri::command]
fn list_favorites(app: tauri::AppHandle) -> Result<Vec<Favorite>, String> {
    let mut favs = read_favorites(&app)?;
    favs.reverse(); // newest first
    Ok(favs)
}

#[tauri::command]
fn remove_favorite(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let kept: Vec<String> = read_favorites(&app)?
        .into_iter()
        .filter(|f| f.id != id)
        .filter_map(|f| serde_json::to_string(&f).ok())
        .collect();
    let body = if kept.is_empty() {
        String::new()
    } else {
        kept.join("\n") + "\n"
    };
    std::fs::write(favorites_path(&app)?, body).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // MUST be registered first (plugin docs): a second launch hands its argv to
        // this callback and exits, rather than becoming a second writer.
        //
        // Not a nicety. stations.json / podcasts.json / settings.json are each
        // rewritten whole from an in-memory cache, so two processes silently clobber
        // one another — and a process running an OLDER build is worse than a race:
        // serde drops every field its structs predate, so a stale instance writing
        // subscriptions would erase the harvested `guid` and `latestAt` values. That
        // very pair of processes was found running on 2026-08-19 (a pre-guid `--tray`
        // instance alongside a newer one) with 8 guids a single write away from gone.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Reveal the window the user already has instead of doing nothing —
            // clicking the launcher twice should look like "bring it to the front".
            tray::reveal_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The proxy runs on its own thread + runtime; grab its port for the UI.
            // The app handle lets it emit now-playing events parsed from ICY (U3).
            let port = proxy::start(app.handle().clone())?;
            app.manage(ProxyPort(port));
            // U6 menubar/tray now-playing companion — ON BY DEFAULT (Windows local
            // default; the tray is additive over the normal window). Pass `--no-tray`
            // to disable it — the escape hatch for a desktop that can't host a tray
            // (mirrors Linux dropping the flag on a DE with no SNI). `--tray` is still
            // accepted as an explicit no-op for back-compat with existing shortcuts.
            if !std::env::args().any(|a| a == "--no-tray") {
                tray::init(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            proxy_port,
            seed_stations,
            list_local_stations,
            add_local_station,
            remove_local_station,
            import_local_stations,
            list_local_podcasts,
            save_local_podcasts,
            get_settings,
            set_setting,
            export_file,
            read_text_file,
            write_nowplaying,
            get_identity,
            generate_identity,
            import_identity,
            clear_identity,
            publish_station,
            unfollow_station,
            publish_show,
            unfollow_show,
            fetch_podcast,
            cached_podcasts,
            station_icy,
            add_favorite,
            list_favorites,
            remove_favorite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ntune");
}

#[cfg(test)]
mod tests {
    use super::*;

    // The content-types measured on the live subscriptions 2026-08-18: the two
    // feeds that reached the relays as stations, and the streams that must not be
    // caught by the same net.
    #[test]
    fn feeds_are_conclusively_not_audio() {
        assert_eq!(
            non_audio_hint("application/rss+xml; charset=UTF-8"),
            Some("an RSS/Atom feed"), // On The Wire (blogspot)
        );
        assert_eq!(
            non_audio_hint("text/xml; charset=UTF-8"),
            Some("an RSS/Atom feed"), // A Duck in a Tree (podbean)
        );
        assert_eq!(non_audio_hint("text/html"), Some("a web page"));
        assert_eq!(non_audio_hint("application/json"), Some("a data feed"));
    }

    #[test]
    fn streams_pass() {
        for ct in [
            "audio/aacp",                  // Acid Jazz, pre-normalisation
            "audio/mpeg",                  // SomaFM mp3 mounts
            "audio/aac",                   // proxy-normalised
            "application/ogg",             // ogg/vorbis mounts
            "application/vnd.apple.mpegurl", // HLS
        ] {
            assert_eq!(non_audio_hint(ct), None, "{ct} should publish");
        }
    }

    // --- <podcast:guid> extraction, against the shapes measured on live feeds ---

    /// A channel with the given root attrs + channel body, wrapped in one item so
    /// every case also proves the episode `<guid>` is not mistaken for the show's.
    fn feed(root_attrs: &str, channel_head: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<rss {root_attrs} version="2.0">
  <channel>
    <title>Example</title>
    {channel_head}
    <item>
      <title>Episode 1</title>
      <guid isPermaLink="false">episode-guid-must-not-win</guid>
    </item>
  </channel>
</rss>"#
        )
    }

    const CANON: &str = r#"xmlns:podcast="https://podcastindex.org/namespace/1.0""#;

    #[test]
    fn reads_the_channel_guid_from_the_canonical_namespace() {
        // fountain.fm / podhome / yellowball all bind the canonical URI.
        let xml = feed(
            CANON,
            "<podcast:guid>e22a2294-d951-51dd-9498-cd04b4467ce1</podcast:guid>",
        );
        assert_eq!(
            extract_podcast_guid(xml.as_bytes()).as_deref(),
            Some("e22a2294-d951-51dd-9498-cd04b4467ce1")
        );
    }

    #[test]
    fn reads_it_when_the_prefix_is_bound_to_something_else() {
        // No Agenda binds `podcast:` to the namespace's GitHub docs page, not the
        // canonical URI. A URI-only match would silently drop a stated guid.
        let xml = feed(
            r#"xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md""#,
            "<podcast:guid>856cd618-7f34-57ea-9b84-3600f1f65e7f</podcast:guid>",
        );
        assert_eq!(
            extract_podcast_guid(xml.as_bytes()).as_deref(),
            Some("856cd618-7f34-57ea-9b84-3600f1f65e7f")
        );
    }

    #[test]
    fn reads_it_under_a_different_prefix_bound_to_the_real_namespace() {
        let xml = feed(
            r#"xmlns:pc="https://podcastindex.org/namespace/1.0""#,
            "<pc:guid>28e3b6e8-5003-5b3d-8d45-f9e2ea75d9c9</pc:guid>",
        );
        assert_eq!(
            extract_podcast_guid(xml.as_bytes()).as_deref(),
            Some("28e3b6e8-5003-5b3d-8d45-f9e2ea75d9c9")
        );
    }

    #[test]
    fn never_mistakes_an_episode_guid_for_the_shows() {
        // The motivating absence: podbean's and the BBC's feeds carry no
        // <podcast:guid> at all, but every item has a plain <guid>.
        let xml = feed(CANON, "<description>no channel guid here</description>");
        assert_eq!(extract_podcast_guid(xml.as_bytes()), None);
    }

    #[test]
    fn an_empty_guid_is_absent_not_blank() {
        let xml = feed(CANON, "<podcast:guid>   </podcast:guid>");
        assert_eq!(extract_podcast_guid(xml.as_bytes()), None);
    }

    #[test]
    fn malformed_xml_yields_none_rather_than_panicking() {
        assert_eq!(extract_podcast_guid(b"<rss><channel><title>oops"), None);
        assert_eq!(extract_podcast_guid(b""), None);
        assert_eq!(extract_podcast_guid(&[0xff, 0xfe, 0x00]), None);
    }

    #[test]
    fn a_cache_entry_without_a_version_reads_as_v1() {
        // The eleven bodies already on disk when the version field was added must
        // load and be treated as stale, not be discarded or mistaken for current.
        let stored = r#"{"url":"https://example.com/f.xml","fetchedAt":1,"podcast":
            {"title":"T","description":null,"image":null,"author":null,"ownerEmail":null,
             "website":null,"categories":[],"language":null,"copyright":null,"episodes":[]}}"#;
        let entry: CachedFeed = serde_json::from_str(stored).expect("legacy entry must load");
        assert_eq!(entry.v, 1);
        assert!(entry.v < FEED_CACHE_VERSION, "must be treated as stale");
        assert_eq!(entry.podcast.guid, None);
    }

    // --- show.v1 tags ------------------------------------------------------

    fn show_tag_pairs(guid: Option<&str>, topics: &[String]) -> Vec<Vec<String>> {
        show_tags(
            "airplay:show:no-agenda-show",
            "No Agenda Show",
            "http://feed.nashownotes.com/rss.xml",
            guid,
            topics,
        )
        .unwrap()
        .iter()
        .map(|t| t.clone().to_vec())
        .collect()
    }

    #[test]
    fn a_show_publishes_its_guid_as_a_nip73_id() {
        // The real guid off No Agenda's feed. `i` is single-letter, so #i is the
        // relay-filterable cross-user key the contract prefers over the URL.
        let tags = show_tag_pairs(Some("856cd618-7f34-57ea-9b84-3600f1f65e7f"), &[]);
        assert!(tags.contains(&vec![
            "i".to_string(),
            "podcast:guid:856cd618-7f34-57ea-9b84-3600f1f65e7f".to_string()
        ]));
        // The feed URL is still published — it is what the user subscribed with.
        assert!(tags.contains(&vec![
            "r".to_string(),
            "http://feed.nashownotes.com/rss.xml".to_string()
        ]));
    }

    #[test]
    fn a_show_without_a_guid_publishes_no_i_tag() {
        // 3 of 11 feeds in the reference profile state no guid — podbean (the show
        // that motivated the contract), the BBC's, and acast's. A blank must not
        // become `i: podcast:guid:`.
        for guid in [None, Some(""), Some("  ")] {
            let tags = show_tag_pairs(guid, &[]);
            assert!(
                !tags.iter().any(|t| t[0] == "i"),
                "unexpected i tag for {guid:?}"
            );
            // …and the required trio is still there, so it stays a valid record.
            for k in ["d", "name", "r"] {
                assert!(tags.iter().any(|t| t[0] == k), "missing {k}");
            }
        }
    }

    #[test]
    fn topics_ride_as_t_tags_and_blanks_are_dropped() {
        let topics = vec!["talk".to_string(), "  ".to_string(), "news".to_string()];
        let tags = show_tag_pairs(None, &topics);
        let t: Vec<&Vec<String>> = tags.iter().filter(|t| t[0] == "t").collect();
        assert_eq!(t.len(), 2);
        assert_eq!(t[0][1], "talk");
        assert_eq!(t[1][1], "news");
    }

    #[test]
    fn a_stream_url_is_refused_for_a_show() {
        // The mirror of feeds_are_conclusively_not_audio: the same mistake in the
        // other direction. Between the two guards, #r stays honest per kind.
        assert_eq!(audio_stream_hint("audio/aacp"), Some("an audio stream"));
        assert_eq!(audio_stream_hint("audio/mpeg"), Some("an audio stream"));
        assert_eq!(audio_stream_hint("application/vnd.apple.mpegurl"), Some("an audio stream"));
        // Feeds and inconclusive probes pass.
        for ct in ["application/rss+xml; charset=UTF-8", "text/xml", "", "   "] {
            assert_eq!(audio_stream_hint(ct), None, "{ct} should publish as a show");
        }
    }

    #[test]
    fn the_two_guards_disagree_on_everything_they_are_sure_about() {
        // Nothing may be refused by BOTH (that would be unpublishable anywhere) and
        // nothing conclusive may be accepted by both.
        for ct in ["audio/mpeg", "application/rss+xml", "text/html", "audio/aac"] {
            let station_ok = non_audio_hint(ct).is_none();
            let show_ok = audio_stream_hint(ct).is_none();
            assert!(station_ok != show_ok, "{ct}: station_ok={station_ok} show_ok={show_ok}");
        }
        // Inconclusive is the one case both accept — by design.
        assert!(non_audio_hint("").is_none() && audio_stream_hint("").is_none());
    }

    #[test]
    fn the_built_tag_set_matches_the_published_contract_fixture() {
        // Contract drift is the failure this catches: schema/fixtures/*.json is what
        // show.v1 SAYS a follow looks like, and show_tags is what ntune actually
        // emits. Compare them directly rather than trusting that both were updated.
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../schema/fixtures/show-31242.guid.json");
        let raw = std::fs::read_to_string(&fixture)
            .unwrap_or_else(|e| panic!("fixture {}: {e}", fixture.display()));
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(doc["kind"].as_u64().unwrap(), SHOW_KIND as u64);

        let expected: Vec<Vec<String>> = doc["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                t.as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect()
            })
            .collect();

        // Rebuild the fixture's own record from its own values.
        let d = expected.iter().find(|t| t[0] == "d").unwrap()[1].clone();
        let name = expected.iter().find(|t| t[0] == "name").unwrap()[1].clone();
        let url = expected.iter().find(|t| t[0] == "r").unwrap()[1].clone();
        let guid = expected
            .iter()
            .find(|t| t[0] == "i")
            .map(|t| t[1].trim_start_matches("podcast:guid:").to_string());
        let topics: Vec<String> = expected
            .iter()
            .filter(|t| t[0] == "t")
            .map(|t| t[1].clone())
            .collect();

        let built: Vec<Vec<String>> = show_tags(&d, &name, &url, guid.as_deref(), &topics)
            .unwrap()
            .iter()
            .map(|t| t.clone().to_vec())
            .collect();

        assert_eq!(built, expected, "emitted tags diverge from show.v1's fixture");
    }

    const ADDR: &str = "31241:916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d:airplay:station:acid-jazz";
    const EV: &str = "b6835db6fa5300000000000000000000000000000000000000000000000000aa";

    #[test]
    fn deletion_names_the_address_and_the_event() {
        // Both targets: `a` for addressable-aware relays, `e` for the ones that
        // only delete by id (relay.fizx.uk kept serving a-only tombstones).
        let tags = deletion_tags(ADDR, Some(EV)).unwrap();
        let flat: Vec<Vec<String>> = tags.iter().map(|t| t.clone().to_vec()).collect();
        assert_eq!(flat[0], vec!["a".to_string(), ADDR.to_string()]);
        assert_eq!(flat[1], vec!["e".to_string(), EV.to_string()]);
    }

    #[test]
    fn deletion_without_an_event_id_is_address_only() {
        // A row that only ever lived in the local store has no published event to
        // name — and a blank id must not become an empty `e` tag.
        for id in [None, Some(""), Some("   ")] {
            let tags = deletion_tags(ADDR, id).unwrap();
            assert_eq!(tags.len(), 1, "unexpected e tag for {id:?}");
            assert_eq!(
                tags[0].clone().to_vec(),
                vec!["a".to_string(), ADDR.to_string()]
            );
        }
    }

    #[test]
    fn inconclusive_never_blocks() {
        // No content-type at all, or a failed probe (which returns ""), must pass —
        // plenty of genuine mounts advertise nothing.
        assert_eq!(non_audio_hint(""), None);
        assert_eq!(non_audio_hint("   "), None);
    }
}

