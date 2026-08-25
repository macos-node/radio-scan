// RadioBar — a tiny macOS menubar viewer for the radio-scan loggers.
//
// It does NOT read any stream itself. It reads the files the loggers write into
// ~/RadioTuner and can pause/resume (and, for episodic shows, trigger) their
// launchd jobs. Local dev only — no bundle, no signing.
//
//   swift run          # from gui/macos/
//
// Two kinds of show, because the data model genuinely differs:
//   .stream   — a 24/7 Icecast stream scraped continuously (acidjazz). Every
//               line is a timed track change; there is a real "now playing".
//   .episodic — a weekly archived show whose full tracklist is published per
//               episode (On The Wire). There is no live stream: we hold the
//               LATEST episode until a newer one is captured. "Now playing"
//               becomes "latest episode".
//
import SwiftUI
import AppKit

// MARK: - Show registry

enum ShowKind { case stream, episodic }

/// A logged show: where its log lives and which launchd job feeds it.
struct Show: Identifiable, Hashable {
    let id: String            // stable key, also the UserDefaults value
    let name: String          // menu display name
    let serviceLabel: String  // launchd label (…/LaunchAgents/<label>.plist)
    // Path under ~/RadioTuner. Includes the per-show directory: radio-scan writes
    // to <data-dir>/<name>/, and the Mac's three loggers moved onto the repo
    // scripts (2026-08-25), so the logs live one level down from where they used
    // to. `appendingPathComponent` handles the separator.
    let logFile: String
    let kind: ShowKind

    static let all: [Show] = [
        Show(id: "acidjazz", name: "Acid Jazz",
             serviceLabel: "com.tigger.acidjazz",
             logFile: "acidjazz/acidjazz_log.jsonl", kind: .stream),
        Show(id: "otw", name: "On The Wire",
             serviceLabel: "com.tigger.otwradio",
             logFile: "otw/otw_log.jsonl", kind: .episodic),
        Show(id: "duck", name: "A Duck in a Tree",
             serviceLabel: "com.tigger.duckradio",
             logFile: "duck/duck_log.jsonl", kind: .episodic),
    ]

    static func find(_ id: String?) -> Show {
        all.first { $0.id == id } ?? all[0]
    }
}

// MARK: - Data

/// Track position that decodes from either an Int (otw: `1,2,3`) or a String
/// (duck: `"00","01","++"`). `num` is the numeric part for sorting; `text` is the
/// original label for display.
struct FlexPos: Decodable {
    let text: String
    let num: Int?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) {
            num = i; text = String(i)
        } else {
            let s = (try? c.decode(String.self)) ?? ""
            text = s
            num = Int(s.prefix { $0.isNumber })
        }
    }
}

/// One logged row. Fields are optional because the schemas overlap only on
/// artist/title: `.stream` rows carry local/epoch, `.episodic` rows carry
/// episode/episode_date/pos/label/album. Extra JSON keys are ignored.
struct Track: Decodable {
    let artist: String
    let title: String
    // stream shape
    let local: String?
    let epoch: Double?
    // episodic shape
    let episode: String?
    let episode_date: String?
    let pos: FlexPos?
    let label: String?
    let album: String?
    let raw: String?
    let audio_url: String?   // episodic podcast enclosure (duck) — the bridge join key

    /// "HH:mm" from the local ISO string (stream rows only).
    var timeHM: String {
        guard let local, let t = local.split(separator: "T").dropFirst().first else { return "" }
        return String(t.prefix(5))
    }

    var display: String { "\(artist) – \(title)" }

    /// A real track vs a parsed artifact (episodic feeds carry a few): On The
    /// Wire link lines, Duck `[anonymous]` intro/outro markers, prose blocks.
    var isRealTrack: Bool {
        if artist.isEmpty || title.isEmpty { return false }
        if artist == "On the Wire" || artist == "On The Wire" || artist == "Audio" { return false }
        let a = artist.trimmingCharacters(in: .whitespaces).lowercased()
        if a == "[anonymous]" || a == "anonymous" { return false }
        if let raw, raw.contains("\n") { return false }   // prose block
        return true
    }
}

/// The shared now-playing state ntune writes to
/// `~/Library/Application Support/radio-scan/nowplaying.json` (frozen bridge
/// contract, docs/nowplaying-bridge-2026-08-11.md). We read it to reflect what
/// ntune is playing and, for episodes, join `r` → an episodic log's `audio_url`.
struct Bridge: Decodable {
    let kind: String        // "station" | "episode"
    let key: String
    let r: String           // stream/enclosure URL = the join key
    let title: String
    let subtitle: String?
    let artist: String?     // live ICY, station only
    let track: String?      // live ICY, station only
    let playing: Bool
    let ts: Double?
}

/// A playing episode located in one of the episodic logs by `audio_url == r`.
struct LocatedEpisode {
    let show: String
    let episode: String
    let date: String
    let tracks: [Track]
}

// MARK: - Model

@MainActor
final class RadioModel: ObservableObject {
    @Published private(set) var tracks: [Track] = []       // file order
    @Published private(set) var jobLoaded = false          // launchd job registered?
    @Published private(set) var show: Show
    @Published private(set) var bridge: Bridge?            // what ntune is playing
    @Published private(set) var located: LocatedEpisode?  // its tracklist, if episodic

    private let home = (NSHomeDirectory() as NSString).appendingPathComponent("RadioTuner")
    private let defaultsKey = "currentShowID"
    private var timer: Timer?
    private var bridgeTimer: Timer?
    private var locatedFor: String?   // cache: last `r` we scanned for

    /// The shared live file ntune writes — resolved off the SAME base dir ntune's
    /// `local_data_dir()` uses (`~/Library/Application Support`) + the product
    /// constant, with NO ntune bundle id (the frozen cross-app rendezvous).
    private var bridgePath: String {
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return base?.appendingPathComponent("radio-scan/nowplaying.json").path ?? ""
    }

    private var jsonlPath: String {
        (home as NSString).appendingPathComponent(show.logFile)
    }
    private var plistPath: String {
        (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/LaunchAgents/\(show.serviceLabel).plist")
    }

    // MARK: derived — stream

    var nowPlaying: Track? { tracks.last }
    var recentStream: [Track] { Array(tracks.dropLast().suffix(8).reversed()) }

    // MARK: derived — episodic

    /// Tracks of the most-recent episode (by date), in running order.
    var latestEpisode: (name: String, date: String, tracks: [Track])? {
        let dated = tracks.filter { $0.episode_date != nil }
        guard let newest = dated.map({ $0.episode_date! }).max() else { return nil }
        let inEp = dated
            .filter { $0.episode_date == newest && $0.isRealTrack }
            .sorted { ($0.pos?.num ?? 0) < ($1.pos?.num ?? 0) }
        guard let name = inEp.first?.episode ?? dated.first(where: { $0.episode_date == newest })?.episode
        else { return nil }
        return (name: name, date: newest, tracks: inEp)
    }

    // MARK: derived — shared

    var totalCount: Int { tracks.count }

    var topArtists: [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for t in tracks where t.isRealTrack { counts[t.artist, default: 0] += 1 }
        return counts
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(5)
            .map { (name: $0.key, count: $0.value) }
    }

    init() {
        show = Show.find(UserDefaults.standard.string(forKey: defaultsKey))
        refresh()
        loadBridge()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        // The live now-playing file is tiny — poll it faster than the log refresh.
        bridgeTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.loadBridge() }
        }
    }

    // MARK: bridge (what ntune is playing)

    private func loadBridge() {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: bridgePath)),
              let b = try? JSONDecoder().decode(Bridge.self, from: data) else {
            if bridge != nil || located != nil { bridge = nil; located = nil; locatedFor = nil }
            return
        }
        bridge = b
        // Locate an episode's tracklist only when the source (r) changes — scanning
        // a log is heavy, so cache by r; clear for stations / when stopped.
        if b.playing, b.kind == "episode", !b.r.isEmpty {
            if b.r != locatedFor {
                locatedFor = b.r
                located = locateEpisode(r: b.r)
            }
        } else if located != nil || locatedFor != nil {
            located = nil
            locatedFor = nil
        }
    }

    /// Scan the episodic logs for a row whose `audio_url` matches `r`, and return
    /// that episode's real tracks in running order. (Duck carries `audio_url`; On
    /// The Wire has none, so it never matches — as designed.)
    private func locateEpisode(r: String) -> LocatedEpisode? {
        let dec = JSONDecoder()
        for s in Show.all where s.kind == .episodic {
            let path = (home as NSString).appendingPathComponent(s.logFile)
            guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
            var rows: [Track] = []
            var name = "", date = ""
            for line in text.split(separator: "\n") {
                guard let d = line.data(using: .utf8),
                      let t = try? dec.decode(Track.self, from: d) else { continue }
                if t.audio_url == r {
                    rows.append(t)
                    name = t.episode ?? name
                    date = t.episode_date ?? date
                }
            }
            if !rows.isEmpty {
                let real = rows.filter { $0.isRealTrack }
                    .sorted { ($0.pos?.num ?? 0) < ($1.pos?.num ?? 0) }
                return LocatedEpisode(show: s.name, episode: name, date: date, tracks: real)
            }
        }
        return nil
    }

    func select(_ newShow: Show) {
        guard newShow.id != show.id else { return }
        show = newShow
        UserDefaults.standard.set(newShow.id, forKey: defaultsKey)
        tracks = []
        refresh()
    }

    func refresh() {
        loadTracks()
        jobLoaded = runLaunchctl(["list"]).contains(show.serviceLabel)
    }

    private func loadTracks() {
        guard let text = try? String(contentsOfFile: jsonlPath, encoding: .utf8) else {
            tracks = []
            return
        }
        let dec = JSONDecoder()
        var out: [Track] = []
        out.reserveCapacity(4096)
        for line in text.split(separator: "\n") {
            if let d = line.data(using: .utf8), let t = try? dec.decode(Track.self, from: d) {
                out.append(t)
            }
        }
        tracks = out
    }

    // MARK: launchd control

    /// Enable/disable the current show's logging job.
    ///
    /// Durability is per-kind. `.episodic` toggles with `-w` so a pause sets a
    /// persistent Disabled override and STICKS across reboots ("pause this show
    /// indefinitely"). `.stream` toggles without `-w`, so a pause is only for the
    /// current login session and a 24/7 logger auto-resumes on next boot.
    func toggleLogging() {
        var args = [jobLoaded ? "unload" : "load", plistPath]
        if show.kind == .episodic { args.insert("-w", at: 1) }
        _ = runLaunchctl(args)
        refresh()
    }

    /// Episodic only: pull the latest episode right now (don't wait for the
    /// weekly fire). Loads the job first if needed, then kicks it.
    func fetchNow() {
        if !jobLoaded { _ = runLaunchctl(["load", "-w", plistPath]) }
        _ = runLaunchctl(["start", show.serviceLabel])
        refresh()
        // the logger writes within a second or two; re-read shortly after.
        Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func openDataFolder() {
        NSWorkspace.shared.open(URL(fileURLWithPath: home))
    }

    @discardableResult
    private func runLaunchctl(_ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        guard (try? p.run()) != nil else { return "" }
        p.waitUntilExit()
        let d = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: d, encoding: .utf8) ?? ""
    }
}

// MARK: - View

struct ContentView: View {
    @ObservedObject var model: RadioModel

    private var isEpisodic: Bool { model.show.kind == .episodic }

    /// True when the "▶ Playing in ntune" banner is already showing the SELECTED
    /// show's latest episode — so the "LATEST EPISODE" section below would just
    /// repeat it. Suppress that section and let the banner own the tracklist.
    private var bannerCoversSelected: Bool {
        guard let b = model.bridge, b.playing, let loc = model.located else { return false }
        return loc.show == model.show.name && loc.episode == (model.latestEpisode?.name ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Show switcher + status
            HStack(spacing: 6) {
                Picker("", selection: Binding(
                    get: { model.show },
                    set: { model.select($0) })) {
                    ForEach(Show.all) { Text($0.name).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
                Spacer()
                Circle()
                    .fill(model.jobLoaded ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(statusWord).font(.caption).foregroundStyle(.secondary)
            }

            bridgeBanner

            if !bannerCoversSelected {
                if isEpisodic { episodicHeader } else { streamHeader }

                Divider()

                if isEpisodic {
                    section(episodeTrackHeader)
                    ForEach(Array(episodeRows.enumerated()), id: \.offset) { _, t in
                        HStack(spacing: 8) {
                            Text(t.pos.map { "\($0.text)." } ?? "•")
                                .font(.caption2.monospaced()).foregroundStyle(.secondary)
                                .frame(width: 26, alignment: .trailing)
                            Text(t.display).font(.caption).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                } else {
                    section("RECENT")
                    ForEach(Array(model.recentStream.enumerated()), id: \.offset) { _, t in
                        HStack(spacing: 8) {
                            Text(t.timeHM)
                                .font(.caption2.monospaced()).foregroundStyle(.secondary)
                                .frame(width: 38, alignment: .leading)
                            Text(t.display).font(.caption).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                }

                Divider()
            }

            section("TOP ARTISTS")
            ForEach(model.topArtists, id: \.name) { row in
                HStack {
                    Text(row.name).font(.caption).lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(row.count)").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
            }

            Divider()

            HStack {
                Button(model.jobLoaded ? (isEpisodic ? "Disable" : "Pause")
                                       : (isEpisodic ? "Enable"  : "Resume")) {
                    model.toggleLogging()
                }
                if isEpisodic {
                    Button("Fetch now") { model.fetchNow() }
                }
                Button("Folder") { model.openDataFolder() }
                Button("Refresh") { model.refresh() }
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
            .font(.caption)
        }
        .padding(12)
        .frame(width: 300)
    }

    // Bridge: "▶ Playing in ntune" — reflects the shared now-playing file, and for
    // a located episode shows its tracklist (the cross-app "locate show + tracks").
    @ViewBuilder private var bridgeBanner: some View {
        if let b = model.bridge, b.playing {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Image(systemName: "play.circle.fill")
                        .foregroundStyle(.green).font(.caption)
                    Text("Playing in ntune")
                        .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Text(b.kind).font(.caption2).foregroundStyle(.tertiary)
                }
                Text(b.title).font(.subheadline).lineLimit(1)
                if b.kind == "station" {
                    let live = [b.artist ?? "", b.track ?? ""].filter { !$0.isEmpty }
                    if !live.isEmpty {
                        Text(live.joined(separator: " – "))
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else if let sub = b.subtitle, !sub.isEmpty {
                    Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                if let loc = model.located {
                    Text("\(loc.show) · \(loc.episode)  (\(loc.tracks.count) tracks)")
                        .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                        .padding(.top, 1)
                    ForEach(Array(loc.tracks.enumerated()), id: \.offset) { _, t in
                        HStack(spacing: 8) {
                            Text(t.pos.map { "\($0.text)." } ?? "•")
                                .font(.caption2.monospaced()).foregroundStyle(.secondary)
                                .frame(width: 26, alignment: .trailing)
                            Text(t.display).font(.caption).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
            .padding(8)
            .background(Color.green.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            Divider()
        }
    }

    // Stream: live now-playing card.
    private var streamHeader: some View {
        Group {
            if let np = model.nowPlaying {
                VStack(alignment: .leading, spacing: 2) {
                    Text(np.title).font(.headline).lineLimit(1)
                    Text(np.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    Text(model.jobLoaded ? "since \(np.timeHM)" : "last logged \(np.timeHM)")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            } else {
                Text("No data yet").foregroundStyle(.secondary)
            }
        }
    }

    // Episodic: latest-episode card.
    private var episodicHeader: some View {
        Group {
            if let ep = model.latestEpisode {
                VStack(alignment: .leading, spacing: 2) {
                    Text(ep.name).font(.headline).lineLimit(2)
                    Text("\(ep.date) · \(ep.tracks.count) tracks")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            } else {
                Text("No episode captured yet").foregroundStyle(.secondary)
            }
        }
    }

    private var episodeRows: [Track] { model.latestEpisode?.tracks ?? [] }
    private var episodeTrackHeader: String { "LATEST EPISODE" }

    private var statusWord: String {
        if model.show.kind == .episodic { return model.jobLoaded ? "Scheduled" : "Off" }
        return model.jobLoaded ? "Logging" : "Paused"
    }

    private func section(_ label: String) -> some View {
        Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
    }
}

// MARK: - App

@main
struct RadioBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = RadioModel()

    var body: some Scene {
        MenuBarExtra {
            ContentView(model: model)
        } label: {
            Image(systemName: model.jobLoaded
                ? "antenna.radiowaves.left.and.right"
                : "antenna.radiowaves.left.and.right.slash")
        }
        .menuBarExtraStyle(.window)
    }
}

/// Keeps the app out of the Dock / app switcher (menubar-only) without an Info.plist.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
