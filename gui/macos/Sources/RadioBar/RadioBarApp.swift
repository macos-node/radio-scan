// RadioBar — a tiny macOS menubar viewer for the acidjazz radio logger.
//
// It does NOT read the stream itself. It reads the files the Python logger
// (~/RadioTuner/acidjazz_radio.py, launchd `com.tigger.acidjazz`) writes, and
// can pause/resume that logger. Local dev only — no bundle, no signing.
//
//   swift run          # from ~/code/RadioBar
//
import SwiftUI
import AppKit

// MARK: - Data

/// One track change, decoded from a line of acidjazz_log.jsonl.
/// Extra JSON fields (epoch, raw, meta_raw, …) are ignored.
struct Track: Decodable, Identifiable {
    let artist: String
    let title: String
    let local: String   // e.g. "2026-08-01T18:18:16+07:00"
    let epoch: Double

    var id: Double { epoch }

    /// "HH:mm" pulled straight from the local ISO string (no formatter fuss).
    var timeHM: String {
        guard let t = local.split(separator: "T").dropFirst().first else { return "" }
        return String(t.prefix(5))
    }

    var display: String { "\(artist) – \(title)" }
}

// MARK: - Model

@MainActor
final class RadioModel: ObservableObject {
    @Published private(set) var tracks: [Track] = []   // oldest → newest
    @Published private(set) var loggingRunning = false

    private let stationLabel = "acidjazz"
    private let serviceLabel = "com.tigger.acidjazz"
    private let home = (NSHomeDirectory() as NSString).appendingPathComponent("RadioTuner")
    private var timer: Timer?

    private var jsonlPath: String {
        (home as NSString).appendingPathComponent("acidjazz_log.jsonl")
    }
    private var plistPath: String {
        (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/LaunchAgents/\(serviceLabel).plist")
    }

    // Derived views of the data
    var nowPlaying: Track? { tracks.last }
    var recent: [Track] { Array(tracks.dropLast().suffix(8).reversed()) } // newest first, excl. now-playing
    var totalCount: Int { tracks.count }

    var topArtists: [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for t in tracks { counts[t.artist, default: 0] += 1 }
        return counts
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(5)
            .map { (name: $0.key, count: $0.value) }
    }

    init() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        loadTracks()
        loggingRunning = runLaunchctl(["list"]).contains(serviceLabel)
    }

    private func loadTracks() {
        guard let text = try? String(contentsOfFile: jsonlPath, encoding: .utf8) else { return }
        let dec = JSONDecoder()
        var out: [Track] = []
        out.reserveCapacity(2048)
        for line in text.split(separator: "\n") {
            if let d = line.data(using: .utf8), let t = try? dec.decode(Track.self, from: d) {
                out.append(t)
            }
        }
        tracks = out
    }

    // MARK: launchd control

    func toggleLogging() {
        _ = runLaunchctl([loggingRunning ? "unload" : "load", plistPath])
        refresh()
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Status row
            HStack(spacing: 6) {
                Circle()
                    .fill(model.loggingRunning ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(model.loggingRunning ? "Logging" : "Paused")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(model.totalCount) tracks")
                    .font(.caption).foregroundStyle(.secondary)
            }

            // Now playing
            if let np = model.nowPlaying {
                VStack(alignment: .leading, spacing: 2) {
                    Text(np.title).font(.headline).lineLimit(1)
                    Text(np.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    Text(model.loggingRunning ? "since \(np.timeHM)" : "last logged \(np.timeHM)")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            } else {
                Text("No data yet").foregroundStyle(.secondary)
            }

            Divider()

            section("RECENT")
            ForEach(model.recent) { t in
                HStack(spacing: 8) {
                    Text(t.timeHM)
                        .font(.caption2.monospaced()).foregroundStyle(.secondary)
                        .frame(width: 38, alignment: .leading)
                    Text(t.display).font(.caption).lineLimit(1)
                    Spacer(minLength: 0)
                }
            }

            Divider()

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
                Button(model.loggingRunning ? "Pause" : "Resume") { model.toggleLogging() }
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
            // Broadcasting antenna when logging; slashed when paused.
            Image(systemName: model.loggingRunning
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
