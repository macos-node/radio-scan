#!/bin/bash
# Build RadioBar.app — a double-clickable macOS app bundle from the SwiftPM
# executable. No Xcode, no signing (local dev only).
#
#   ./build-app.sh                 # build ./RadioBar.app
#   ./build-app.sh /Applications   # build, then install a copy there
#
set -euo pipefail
cd "$(dirname "$0")"

APP="RadioBar.app"
BIN="RadioBar"
ID="com.tigger.radiobar"
VERSION="0.1.0"

echo "--- Building release binary ---"
swift build -c release
BINPATH="$(swift build -c release --show-bin-path)/$BIN"

echo "--- Assembling $APP ---"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINPATH" "$APP/Contents/MacOS/$BIN"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>              <string>RadioBar</string>
    <key>CFBundleDisplayName</key>       <string>RadioBar</string>
    <key>CFBundleIdentifier</key>        <string>$ID</string>
    <key>CFBundleExecutable</key>        <string>$BIN</string>
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

if [ "${1:-}" != "" ]; then
    DEST="$1"
    echo "--- Installing to $DEST ---"
    rm -rf "$DEST/$APP"
    cp -R "$APP" "$DEST/"
    echo "Installed: $DEST/$APP"
fi

echo
echo "Launch:  open '$(pwd)/$APP'   (or double-click it in Finder / find it in Spotlight)"
echo "To auto-start at login: System Settings > General > Login Items > +"
