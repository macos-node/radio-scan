PREFIX  ?= $(HOME)/.local
BINDIR  ?= $(PREFIX)/bin
APPDIR  ?= $(PREFIX)/share/applications
ICONDIR ?= $(PREFIX)/share/icons/hicolor/scalable/apps

# Linux icons crop the grid margin. The masters carry the art in an 824 square
# on a 1024 canvas (Apple's grid, ndisc/SUITE.md), which fills 80.5% of the tile --
# visibly smaller in the dock than Yaru's own icons, which fill 89%. Cropping to
# this viewBox gets the same 89% out of the master with no re-export. The Windows
# .ico takes the same crop (native Windows icons fill ~100%, so the margin reads
# small on the taskbar too); only the .icns keeps the full canvas.
LINUX_VIEWBOX ?= 49 49 926 926

DESKTOP_OUT := $(APPDIR)/ntune.desktop
TAURI_BIN   := src-tauri/target/release/ntune

.PHONY: help deps dev build install uninstall check clean icons

help:
	@echo "ntune — radio-scan L4 UI. Targets:"
	@echo "  make deps       npm install + cargo fetch (one-time setup)"
	@echo "  make dev        run 'tauri dev' (hot-reload)"
	@echo "  make build      release build of frontend + Rust binary"
	@echo "  make install    copy binary + desktop entry under PREFIX"
	@echo "                  (default PREFIX=\$$HOME/.local; sudo PREFIX=/usr/local for system-wide)"
	@echo "  make uninstall  remove what 'install' put down"
	@echo "  make check      typecheck + vite build + cargo check (no bundle)"
	@echo "  make icons      regenerate the Tauri raster icon set from icon.svg"
	@echo "  make clean      remove dist/ and src-tauri/target/"

deps:
	npm install
	cd src-tauri && cargo fetch

dev:
	npm run tauri dev

# Regenerate the Tauri bundle icon set from icon.svg (run once per icon change).
icons:
	@if command -v rsvg-convert >/dev/null 2>&1; then \
		rsvg-convert -w 2048 -h 2048 icon.svg -o app-icon.png; \
	elif command -v convert >/dev/null 2>&1; then \
		convert -background none -resize 2048x2048 icon.svg app-icon.png; \
	else \
		echo "need rsvg-convert (librsvg2-bin) or imagemagick"; exit 1; \
	fi
	npm run tauri icon ./app-icon.png
	rm -f app-icon.png
	@# Linux raster set: these are what the .deb and the AppImage install into
	@# hicolor, and what Linux uses as the window icon, so re-render them from
	@# the margin-cropped canvas (ndisc/SUITE.md, 2026-09-18). The .icns and the
	@# mobile sets keep Apple's grid and stay as `tauri icon` wrote them.
	@# Needs rsvg-convert and ImageMagick. PNG32: because ImageMagick writes
	@# palette PNGs at the small sizes, which tauri::generate_context! rejects
	@# as "not RGBA".
	sed '1s|viewBox="[^"]*"|viewBox="$(LINUX_VIEWBOX)"|' icon.svg > app-icon-linux.svg
	rsvg-convert -w 2048 -h 2048 app-icon-linux.svg -o app-icon-linux.png
	@for n in 32x32 64x64 128x128 128x128@2x 256x256 icon; do \
		p=src-tauri/icons/$$n.png; \
		[ -f $$p ] || continue; \
		s=$$(identify -format '%w' $$p); \
		convert app-icon-linux.png -resize $${s}x$${s} PNG32:$$p; \
		echo "  linux icon -> $$p ($$s)"; \
	done
	@# Windows .ico from the same crop, at the sizes `tauri icon` writes.
	convert app-icon-linux.png -define icon:auto-resize=256,64,48,32,24,16 src-tauri/icons/icon.ico
	@echo "  windows icon -> src-tauri/icons/icon.ico"
	rm -f app-icon-linux.svg app-icon-linux.png

# ALWAYS delegate to `tauri build` — never treat the binary as an up-to-date file
# target. It used to be one, and a stray `cargo build --release` (which does NOT run
# Vite, so the frontend is never embedded) left a newer binary sitting there; make
# then skipped this rule and `install` shipped an app that tried to load the dev
# server and failed with "Could not connect to localhost" (2026-08-19). cargo and
# Vite do their own incremental work, so re-running costs seconds when nothing
# changed — cheaper than shipping a binary built the wrong way.
build:
	npm run tauri build -- --no-bundle

check:
	npm run build
	cd src-tauri && cargo check

install: build
	install -d $(BINDIR) $(APPDIR) $(ICONDIR)
	install -m 0755 $(TAURI_BIN) $(BINDIR)/ntune
	@# Linux fill: crop the grid margin on the way in (see LINUX_VIEWBOX).
	sed '1s|viewBox="[^"]*"|viewBox="$(LINUX_VIEWBOX)"|' icon.svg > $(ICONDIR)/ntune.svg
	chmod 0644 $(ICONDIR)/ntune.svg
	sed -e 's|@BINDIR@|$(BINDIR)|g' \
	    -e 's|@ICONDIR@|$(ICONDIR)|g' \
	    ntune.desktop.in > $(DESKTOP_OUT)
	chmod 0644 $(DESKTOP_OUT)
	@if command -v update-desktop-database >/dev/null 2>&1; then \
		update-desktop-database $(APPDIR) >/dev/null 2>&1 || true; \
	fi
	@if command -v gtk-update-icon-cache >/dev/null 2>&1; then \
		gtk-update-icon-cache -f -t $(PREFIX)/share/icons/hicolor >/dev/null 2>&1 || true; \
	fi
	@echo "installed to $(PREFIX)"
	@echo "  binary  -> $(BINDIR)/ntune"
	@echo "  desktop -> $(DESKTOP_OUT)"

uninstall:
	rm -f $(BINDIR)/ntune
	rm -f $(ICONDIR)/ntune.svg
	rm -f $(DESKTOP_OUT)
	@if command -v update-desktop-database >/dev/null 2>&1; then \
		update-desktop-database $(APPDIR) >/dev/null 2>&1 || true; \
	fi
	@echo "uninstalled from $(PREFIX)"

clean:
	rm -rf dist src-tauri/target
