// ntune — radio-scan's L4 desktop UI (the tuner / player / subscription surface).
// See ../../docs/radio-scan-ui-2026-08-04.md for the build map.
//
// Radio streams play webview-side in the <audio> element (WebKit2GTK plays
// *remote* media fine), so there is no Rust audio backend. This module owns:
//   • seed_stations — the first-run fallback station list (U0)
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
use serde::Serialize;

// --- seed stations (U0 fallback) --------------------------------------------

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

/// Starter stations. SomaFM's public ICY streams are reliable, well-behaved
/// seeds for proving remote-HTTP playback and (from U3) ICY metadata parsing.
/// Shown until the user's followed `station.v1` events are read off the relays.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            seed_stations,
            get_identity,
            generate_identity,
            import_identity,
            clear_identity,
            publish_station,
            unfollow_station,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ntune");
}
