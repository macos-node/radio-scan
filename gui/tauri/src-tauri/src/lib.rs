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
struct PodcastSub {
    url: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    npub: Option<String>,
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
    std::fs::write(podcasts_path(&app)?, body).map_err(|e| e.to_string())
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
const D_PREFIX: &str = "airplay:station:";

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
    let keys = owner_keys()?;
    let d = format!("{D_PREFIX}{slug}");

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

/// Unfollow a station: publish a NIP-09 kind:5 deletion referencing the
/// station's addressable `a` coordinate. Consumers drop it on read.
#[tauri::command]
async fn unfollow_station(
    slug: String,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    let keys = owner_keys()?;
    let address = format!(
        "{STATION_KIND}:{}:{D_PREFIX}{slug}",
        keys.public_key().to_hex()
    );

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags(vec![Tag::parse(["a", &address]).map_err(|e| e.to_string())?])
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;

    publish_event(keys, event, address, relays).await
}

// --- podcast RSS (U4) -------------------------------------------------------
// Subscribe to a podcast by feed URL; fetch + parse RSS 2.0 / Atom (feed-rs)
// into an episode list the UI plays through the same <audio>/proxy path as radio.

#[derive(Serialize, Clone)]
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

#[derive(Serialize, Clone)]
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
    episodes: Vec<Episode>,
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

/// Fetch and parse a podcast feed into an episode list (newest first).
#[tauri::command]
async fn fetch_podcast(url: String) -> Result<Podcast, String> {
    let bytes = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "ntune (radio-scan)")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

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

    Ok(Podcast {
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
    })
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
            fetch_podcast,
            station_icy,
            add_favorite,
            list_favorites,
            remove_favorite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ntune");
}
