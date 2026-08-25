// ntune — logger control (LINUX ONLY).
//
// The half RadioBar has and Linux never did: pause/resume the radio-scan logging
// jobs, and fetch an episodic show now. Decision + the confirmed systemd mapping:
// ../../docs/logger-control-surface-2026-08-25.md (option A, 2026-08-25).
//
// macOS drives the same jobs from RadioBar's menubar via launchctl, so this is
// deliberately not cross-platform — a sanctioned divergence in the §8.1 sense,
// recorded in that document.
//
// Two rules the doc pins down, and both are load-bearing:
//
//  1. TWO FACTS PER JOB. `is-active` and `is-enabled` answer different questions
//     and inactive-but-ENABLED is reachable in normal use (it is what pausing the
//     stream logger produces). launchd's `jobLoaded` collapses the pair into one
//     boolean; systemd doesn't, so neither does this menu. A checkbox would lie.
//  2. DURABILITY FOLLOWS THE JOB KIND. A 24/7 stream logger paused once should
//     come back by itself; a weekly show you deliberately silenced should not.
//     That is launchd's `-w` distinction, and `stop` vs `disable --now` is its
//     exact systemd equivalent. Mapping both to one verb would look identical in
//     a menu and be a regression.

use std::collections::HashMap;
use std::process::Command;

/// Which durability a pause gets. See rule 2 above.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// A 24/7 logger. Pause is session-only; it returns by itself.
    Stream,
    /// A weekly timer. Pause is persistent; it stays down until resumed.
    Episodic,
}

pub struct Job {
    /// The systemd user unit. Timers for episodic shows, the service for the stream.
    pub unit: &'static str,
    /// What the menu calls it.
    pub label: &'static str,
    pub kind: Kind,
    /// The log directory under the data dir — also the log's filename stem, and
    /// the id the frontend uses. Episodic shows only; a stream has a log too but
    /// nothing here reads it (the tray's now-playing comes from the bridge file).
    pub log: &'static str,
}

/// The jobs `service/install-linux.sh` + `install-linux-episodic.sh` create. A job
/// whose unit isn't installed is dropped at startup rather than shown dead.
pub const JOBS: &[Job] = &[
    Job { unit: "radio-scan.service", label: "Acid Jazz", kind: Kind::Stream, log: "acidjazz" },
    Job { unit: "otw-playlist.timer", label: "On The Wire", kind: Kind::Episodic, log: "otw" },
    Job { unit: "duck-playlist.timer", label: "A Duck in a Tree", kind: Kind::Episodic, log: "duck" },
];

/// Both facts, plus whether the unit exists at all.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct State {
    pub present: bool,
    pub active: bool,
    pub enabled: bool,
}

/// Parse `systemctl show --property=Id,LoadState,ActiveState,UnitFileState`, which
/// answers for every unit in ONE process rather than two spawns per unit per poll.
/// Blocks are separated by a blank line and keyed by `Id`.
///
/// `UnitFileState` is empty for a transient or unlinked unit, and a unit that isn't
/// installed comes back `LoadState=not-found` — so absence is detected from the
/// output, never from a non-zero exit.
pub fn parse_show(out: &str) -> HashMap<String, State> {
    let mut map = HashMap::new();
    for block in out.split("\n\n") {
        let mut id = None;
        let mut load = "";
        let mut active = "";
        let mut file = "";
        for line in block.lines() {
            match line.split_once('=') {
                Some(("Id", v)) => id = Some(v.to_string()),
                Some(("LoadState", v)) => load = v,
                Some(("ActiveState", v)) => active = v,
                Some(("UnitFileState", v)) => file = v,
                _ => {}
            }
        }
        if let Some(id) = id {
            map.insert(
                id,
                State {
                    present: load != "not-found" && !load.is_empty(),
                    // `activating`/`deactivating` are transitional; treat only a
                    // settled `active` as running so the label can't flicker on.
                    active: active == "active",
                    enabled: file == "enabled" || file == "enabled-runtime",
                },
            );
        }
    }
    map
}

/// Ask systemd about every job at once.
pub fn query() -> HashMap<String, State> {
    let out = Command::new("systemctl")
        .arg("--user")
        .arg("show")
        .arg("--property=Id,LoadState,ActiveState,UnitFileState")
        .args(JOBS.iter().map(|j| j.unit))
        .output();
    match out {
        Ok(o) => parse_show(&String::from_utf8_lossy(&o.stdout)),
        Err(_) => HashMap::new(),
    }
}

/// The status phrase for a job — ALWAYS both facts, never a single word that
/// collapses them. The second clause is what `is-enabled` adds: whether this
/// survives a logout, which is the whole difference between the two pause verbs.
pub fn describe(kind: Kind, s: State) -> &'static str {
    match (kind, s.active, s.enabled) {
        (Kind::Stream, true, true) => "logging",
        (Kind::Stream, true, false) => "logging · won't return after logout",
        (Kind::Stream, false, true) => "stopped · returns at login",
        (Kind::Stream, false, false) => "stopped · stays off",
        (Kind::Episodic, true, true) => "armed",
        (Kind::Episodic, true, false) => "armed · won't return after logout",
        (Kind::Episodic, false, true) => "stopped · returns at login",
        (Kind::Episodic, false, false) => "paused · stays off",
    }
}

/// Is this job on, for the purpose of choosing pause vs resume? The question is
/// per kind, because the two kinds are turned off by different verbs: a stream is
/// off when it isn't running, a timer is off when it won't run again.
pub fn is_on(kind: Kind, s: State) -> bool {
    match kind {
        Kind::Stream => s.active,
        Kind::Episodic => s.enabled || s.active,
    }
}

/// The `systemctl --user …` arguments for the pause/resume toggle. Rule 2 lives
/// here: `stop`/`start` for a stream (session-only), `disable`/`enable --now` for
/// an episodic timer (persistent).
pub fn toggle_args(kind: Kind, unit: &str, currently_on: bool) -> Vec<String> {
    let verb = match (kind, currently_on) {
        (Kind::Stream, true) => vec!["stop"],
        (Kind::Stream, false) => vec!["start"],
        (Kind::Episodic, true) => vec!["disable", "--now"],
        (Kind::Episodic, false) => vec!["enable", "--now"],
    };
    verb.into_iter().chain([unit]).map(String::from).collect()
}

/// Fetch-now runs the SERVICE, not the timer — starting a timer only re-arms it.
/// Episodic only; a stream logger has nothing to fetch.
pub fn fetch_args(unit: &str) -> Vec<String> {
    let service = unit.strip_suffix(".timer").map(|s| format!("{s}.service"));
    vec!["start".to_string(), service.unwrap_or_else(|| unit.to_string())]
}

/// Run one `systemctl --user …` and report whether it succeeded. Errors are
/// swallowed into `false` — the poller re-reads the real state a moment later, so
/// the menu corrects itself rather than trusting this return value.
pub fn run(args: &[String]) -> bool {
    Command::new("systemctl")
        .arg("--user")
        .args(args)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// --- the episodic viewer ------------------------------------------------------
// RadioBar has read these logs on macOS from the start; Linux had no way to see
// them at all, which is the mirror of the control gap option A closed. This is
// the read half: latest episode per show, its tracklist, and the Mixcloud link
// when the parser captured one.
//
// READ-ONLY, and deliberately a separate concern from the job control above: this
// touches the logs, that touches the units, and nothing here can change either.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct EpisodicTrack {
    /// As printed — `1` for On The Wire, `"00"`/`"++"` for A Duck in a Tree.
    pub pos: String,
    pub artist: String,
    pub title: String,
    /// Label / album, where the feed carries them. Empty rather than absent, so
    /// the row renders the same shape for both shows.
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct EpisodicShow {
    pub id: String,
    pub label: String,
    pub episode: String,
    pub date: String,
    /// The Mixcloud page for this episode, or empty. NEVER a stream URL — On The
    /// Wire publishes no audio, which is the whole reason this field exists.
    pub listen_url: String,
    pub tracks: Vec<EpisodicTrack>,
    /// How many episodes the log holds, so the view can say what it is a slice of.
    pub episodes: usize,
}

/// `~/radio-scan-data`, or wherever `RADIOSCAN_DATA` points — the same resolution
/// order the Python loggers use, so the viewer cannot end up reading a different
/// directory from the one being written.
fn data_dir() -> Option<std::path::PathBuf> {
    if let Ok(d) = std::env::var("RADIOSCAN_DATA") {
        if !d.is_empty() {
            return Some(std::path::PathBuf::from(d));
        }
    }
    std::env::var("HOME").ok().map(|h| std::path::Path::new(&h).join("radio-scan-data"))
}

/// Sort key for a position that is an int in one log and a string in the other.
/// A non-numeric marker (Duck's `"++"`) sorts last rather than being dropped.
///
/// No zero-stripping: `"00".parse()` is already 0, and stripping first made an
/// empty string that failed to parse — which sorted Duck's OPENING track last.
/// Caught by the test, which is why it names the case rather than the function.
fn pos_key(pos: &str) -> u32 {
    let t = pos.trim();
    if t.is_empty() {
        return 0;
    }
    t.parse().unwrap_or(u32::MAX)
}

fn as_str(v: Option<&serde_json::Value>) -> String {
    match v {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// The newest episode in one log, by `episode_date`.
///
/// Reads the CLEAN log by preference and falls back to the raw one: `--clean`
/// drops the prose, embeds and intro/outro markers that both feeds carry, and it
/// runs as ExecStartPost on every scheduled fetch, so it is the current one. A
/// log that has never been cleaned still shows, with its noise.
pub fn latest_episode(job: &Job) -> Option<EpisodicShow> {
    let dir = data_dir()?.join(job.log);
    let text = [
        dir.join(format!("{}_log.clean.jsonl", job.log)),
        dir.join(format!("{}_log.jsonl", job.log)),
    ]
    .iter()
    .find_map(|p| std::fs::read_to_string(p).ok())?;

    let rows: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();

    let dates: std::collections::BTreeSet<String> = rows
        .iter()
        .map(|r| as_str(r.get("episode_date")))
        .filter(|d| !d.is_empty())
        .collect();
    let newest = dates.iter().next_back()?.clone();

    let mut tracks: Vec<(u32, EpisodicTrack)> = rows
        .iter()
        .filter(|r| as_str(r.get("episode_date")) == newest)
        .map(|r| {
            let pos = as_str(r.get("pos"));
            let label = as_str(r.get("label"));
            let album = as_str(r.get("album"));
            let detail = match (label.is_empty(), album.is_empty()) {
                (true, true) => String::new(),
                (false, true) => label,
                (true, false) => album,
                (false, false) => format!("{label} \u{00B7} {album}"),
            };
            (
                pos_key(&pos),
                EpisodicTrack { pos, artist: as_str(r.get("artist")), title: as_str(r.get("title")), detail },
            )
        })
        .collect();
    tracks.sort_by_key(|(k, _)| *k);

    let of_episode = |key: &str| {
        rows.iter()
            .find(|r| as_str(r.get("episode_date")) == newest && !as_str(r.get(key)).is_empty())
            .map(|r| as_str(r.get(key)))
            .unwrap_or_default()
    };

    let (episode, listen) = (of_episode("episode"), of_episode("listen_url"));
    Some(EpisodicShow {
        id: job.log.to_string(),
        label: job.label.to_string(),
        episode,
        date: newest,
        listen_url: listen,
        tracks: tracks.into_iter().map(|(_, t)| t).collect(),
        episodes: dates.len(),
    })
}

/// Every episodic show that has a log to read. A show with no log is absent, not
/// empty — same rule as the tray's job section.
pub fn latest_episodes() -> Vec<EpisodicShow> {
    JOBS.iter()
        .filter(|j| j.kind == Kind::Episodic)
        .filter_map(latest_episode)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHOW: &str = "Id=radio-scan.service\nLoadState=loaded\nActiveState=active\nUnitFileState=enabled\n\nId=otw-playlist.timer\nLoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\n\nId=ghost.timer\nLoadState=not-found\nActiveState=inactive\nUnitFileState=\n";

    #[test]
    fn parses_every_unit_from_one_show_call() {
        let m = parse_show(SHOW);
        assert_eq!(
            m["radio-scan.service"],
            State { present: true, active: true, enabled: true }
        );
        assert_eq!(
            m["otw-playlist.timer"],
            State { present: true, active: false, enabled: false }
        );
    }

    #[test]
    fn an_uninstalled_unit_is_absent_not_off() {
        // The distinction matters: "off" belongs in the menu, "not installed"
        // means the job is dropped from it entirely.
        let m = parse_show(SHOW);
        assert!(!m["ghost.timer"].present);
    }

    #[test]
    fn transitional_states_do_not_read_as_running() {
        let m = parse_show("Id=x.service\nLoadState=loaded\nActiveState=activating\nUnitFileState=enabled\n");
        assert!(!m["x.service"].active, "activating is not yet active");
    }

    #[test]
    fn every_label_carries_both_facts() {
        // The pair that a checkbox would collapse, and the reason this is a menu of
        // sentences: same `active`, different `enabled`, different meaning.
        let stopped_armed = State { present: true, active: false, enabled: true };
        let stopped_off = State { present: true, active: false, enabled: false };
        assert_eq!(describe(Kind::Stream, stopped_armed), "stopped · returns at login");
        assert_eq!(describe(Kind::Stream, stopped_off), "stopped · stays off");
        assert_ne!(
            describe(Kind::Episodic, stopped_armed),
            describe(Kind::Episodic, stopped_off)
        );
    }

    #[test]
    fn pause_durability_follows_the_kind_not_the_menu_item() {
        let on = true;
        assert_eq!(toggle_args(Kind::Stream, "radio-scan.service", on), ["stop", "radio-scan.service"]);
        assert_eq!(
            toggle_args(Kind::Episodic, "otw-playlist.timer", on),
            ["disable", "--now", "otw-playlist.timer"]
        );
        // …and back, symmetrically.
        assert_eq!(toggle_args(Kind::Stream, "radio-scan.service", !on), ["start", "radio-scan.service"]);
        assert_eq!(
            toggle_args(Kind::Episodic, "otw-playlist.timer", !on),
            ["enable", "--now", "otw-playlist.timer"]
        );
    }

    #[test]
    fn a_paused_stream_is_off_even_though_it_is_still_enabled() {
        // The state pausing a stream actually produces. If `is_on` read `enabled`
        // here, the menu would offer "Pause" on an already-stopped logger.
        let paused = State { present: true, active: false, enabled: true };
        assert!(!is_on(Kind::Stream, paused));
        // For a timer the same reading is the opposite way round: still armed.
        assert!(is_on(Kind::Episodic, paused));
    }

    #[test]
    fn a_marker_position_sorts_last_rather_than_vanishing() {
        // Duck's tracklists carry "++" rows among "00".."12". Dropping them would
        // silently shorten a tracklist; sorting them last keeps the count honest.
        assert_eq!(pos_key("00"), 0);
        assert_eq!(pos_key("07"), 7);
        assert_eq!(pos_key("12"), 12);
        assert_eq!(pos_key("++"), u32::MAX);
        assert!(pos_key("++") > pos_key("99"));
    }

    #[test]
    fn a_position_reads_the_same_from_either_log_shape() {
        // On The Wire logs `pos` as a JSON number, Duck as a zero-padded string.
        assert_eq!(as_str(Some(&serde_json::json!(3))), "3");
        assert_eq!(as_str(Some(&serde_json::json!("03"))), "03");
        assert_eq!(as_str(Some(&serde_json::json!(null))), "");
        assert_eq!(as_str(None), "");
    }

    #[test]
    fn fetch_now_starts_the_service_behind_the_timer() {
        // Starting the TIMER would only re-arm it; the fetch would never run.
        assert_eq!(fetch_args("otw-playlist.timer"), ["start", "otw-playlist.service"]);
    }
}
