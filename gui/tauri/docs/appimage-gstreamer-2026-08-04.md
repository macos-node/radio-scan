# ntune — AppImage GStreamer gap (Linux release blocker)

> **Status: RESOLVED for `ntune-v0.1.0` — ship `.deb`-only.** Reproduced on Linux
> (`adjmx` session) 2026-08-04. The `.AppImage` that `ntune-release.yml` built
> **freezes on playback** — its bundled GStreamer is missing audio-sink plugins.
> The **`.deb` is unaffected** and is the sound Linux artifact.
> **Decision (2026-08-04):** the AppImage job is **dropped from `ntune-release.yml`**
> (`--bundles deb` only); `ntune-v0.1.0` ships `.deb` (Linux) + `.dmg` (macOS). The
> AppImage returns in a later release once the bundle ships `appsink`/
> `autoaudiosink` (options in "Fixing the AppImage" below).
> Cross-session contract: [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md).

Date: 2026-08-04 · surface: packaging (Linux) · gates: `ntune-v*` release

---

## Symptom
Launch the packaged `.AppImage` (`scripts/build-install.sh` → `~/Applications/ntune.AppImage`),
tune any station, attempt play → **the UI freezes**: no crash, no window repaint,
process alive but wedged. Every stream, `http` and `https` alike.

## Root cause (evidence)
The AppImage bundles its own webkit2gtk + GStreamer, but linuxdeploy's bundle is
**incomplete** — the audio *sink* plugins are absent. From the AppImage's stderr:

```
GStreamer element appsink not found. Please install it.
GStreamer element autoaudiosink not found. Please install it.
(WebKitWebProcess): GLib-GObject-CRITICAL: invalid (NULL) pointer instance
(WebKitWebProcess): GLib-GObject-CRITICAL: g_signal_connect_data: assertion 'G_TYPE_CHECK_INSTANCE (instance)' failed
```

When the webview builds the `<audio>` pipeline, the sink resolves to NULL → the
GObject crash → the web process wedges → frozen UI. `appsink` ships in
`gstreamer1.0-plugins-base`, `autoaudiosink` in `gstreamer1.0-plugins-good`;
neither is inside the AppImage.

**Confirmation it is bundling, not the machine:** the host's system GStreamer has
all of them (`gst-inspect-1.0 appsink|autoaudiosink|pulsesink` all present), and
the **release binary** (`target/release/ntune`, system-linked) plays every stream
fine on the same box. Only the self-contained AppImage is broken.

> This is exactly the `.AppImage` risk called out in the contract (§6: "the
> `.AppImage` can't bundle these reliably, so document them") — now reproduced.

## Why the `.deb` is fine
The `.deb` is dynamically linked against the **host** webkit2gtk + GStreamer and
already **`Depends`** on `gstreamer1.0-plugins-bad` + `gstreamer1.0-libav`
(tauri.conf.json, commit `5aecc91`). apt pulls the codec chain; audio works. The
`.deb` is the shippable Linux artifact today.

## Options (pick one before tagging)
1. **Drop the AppImage from the release** *(fastest, recommended for v0.1.0)* —
   ship `.deb` (Linux) + `.dmg` (macOS). Remove/skip the AppImage job in
   `ntune-release.yml`, or mark it experimental and don't attach it. No user ever
   gets the silent-freezing bundle.
2. **Bundle the GStreamer plugins into the AppImage** — add
   `linuxdeploy-plugin-gstreamer` to the AppImage build (it copies the plugin set
   + sets `GST_PLUGIN_SYSTEM_PATH`/`GST_PLUGIN_PATH` in the AppRun). This is the
   proper fix if a portable single-file Linux build is wanted; needs the plugin
   available in CI and a verify pass on a clean box.
3. **Document a runtime requirement** *(weakest)* — tell AppImage users to install
   system GStreamer plugins. Fragile (the point of an AppImage is self-containment)
   and the failure mode is a silent freeze, not a clear error — avoid.

## Recommendation
For **`ntune-v0.1.0`**: **Option 1** — ship `.deb` + `.dmg`, drop the AppImage.
Track Option 2 as a follow-up so a portable Linux build exists later. Do not tag a
release whose Linux artifact freezes on first play.

## Also fixed in this pass (context, already on `l4-ui-u0`)
Two runtime bugs surfaced while chasing this, both pushed:
- `e9863f6` — `resolveStations` now honors NIP-09 delete timestamps
  (unfollow→refollow no longer stays hidden).
- `6f62386` — the loopback proxy normalizes `audio/aacp → audio/aac` (webkit2gtk
  refuses the legacy SHOUTcast MIME). Both carry `Needs-verify: macos`.

## Refs
- Playback path: [`../src-tauri/src/proxy.rs`](../src-tauri/src/proxy.rs), the U0 line in [`../../STATUS.md`](../../STATUS.md) §6.
- Build script: [`../scripts/build-install.sh`](../scripts/build-install.sh) · CI: [`../../.github/workflows/ntune-release.yml`](../../.github/workflows/ntune-release.yml).
