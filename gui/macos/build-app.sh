#!/bin/bash
# Build RadioBar.app — a double-clickable macOS app bundle from the SwiftPM
# executable. No Xcode, no signing (local dev only).
#
#   ./build-app.sh                 # build ./RadioBar.app
#   ./build-app.sh /Applications   # build, then install a plain copy there
#   ./build-app.sh --install       # build, then quit → install to /Applications → relaunch
#
set -euo pipefail
cd "$(dirname "$0")"

APP="RadioBar.app"
BIN="RadioBar"
ID="com.tigger.radiobar"
VERSION="0.1.0"

# Arg parsing: --install is the ergonomic "swap the running app" path;
# a bare positional dir keeps the old plain-copy behaviour.
INSTALL_RELAUNCH=0
DEST=""
case "${1:-}" in
    --install) INSTALL_RELAUNCH=1; DEST="/Applications" ;;
    "")        ;;
    *)         DEST="$1" ;;
esac

echo "--- Building release binary ---"
swift build -c release
BINPATH="$(swift build -c release --show-bin-path)/$BIN"

echo "--- Assembling $APP ---"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINPATH" "$APP/Contents/MacOS/$BIN"

# The bundle icon. RadioBar is an LSUIElement agent so this never appears in
# the Dock — it is what Finder, Spotlight and the Login Items list show, and
# without it they show the blank default. icon.icns is committed so a box
# without librsvg can still build; it is regenerated here when rsvg-convert is
# present, which keeps it honest against icon.svg.
if command -v rsvg-convert >/dev/null 2>&1; then
    ICONSET="$(mktemp -d)/icon.iconset"; mkdir -p "$ICONSET"
    for pair in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
                "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
                "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
        set -- $pair
        rsvg-convert -w "$1" -h "$1" icon.svg -o "$ICONSET/$2.png"
    done
    iconutil -c icns "$ICONSET" -o icon.icns
    rm -rf "$(dirname "$ICONSET")"
fi
cp icon.icns "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>              <string>RadioBar</string>
    <key>CFBundleDisplayName</key>       <string>RadioBar</string>
    <key>CFBundleIdentifier</key>        <string>$ID</string>
    <key>CFBundleExecutable</key>        <string>$BIN</string>
    <key>CFBundleIconFile</key>          <string>icon</string>
    <key>CFBundlePackageType</key>       <string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key>           <string>1</string>
    <key>LSMinimumSystemVersion</key>    <string>14.0</string>
    <!-- Agent app: menubar-only, no Dock icon (applies before app code runs). -->
    <key>LSUIElement</key>               <true/>
</dict>
</plist>
PLIST

echo "Built: $(pwd)/$APP"

if [ -n "$DEST" ]; then
    if [ "$INSTALL_RELAUNCH" -eq 1 ]; then
        echo "--- Quitting running RadioBar (if any) ---"
        osascript -e 'quit app "RadioBar"' 2>/dev/null || pkill -x "$BIN" 2>/dev/null || true
        sleep 1
    fi
    echo "--- Installing to $DEST ---"
    rm -rf "$DEST/$APP"
    cp -R "$APP" "$DEST/"
    echo "Installed: $DEST/$APP"
    if [ "$INSTALL_RELAUNCH" -eq 1 ]; then
        echo "--- Relaunching ---"
        open "$DEST/$APP"
        echo "Relaunched: $DEST/$APP"
        exit 0
    fi
fi

echo
echo "Launch:  open '$(pwd)/$APP'   (or double-click it in Finder / find it in Spotlight)"
echo "To auto-start at login: System Settings > General > Login Items > +"
