//! Podcast cover art — fetched once, shrunk, cached on disk.
//!
//! The image URL comes from the feed itself (`harvest.image`, the channel's
//! `<itunes:image>`): every show states one. Publishers serve originals of up to
//! 3000 px and several MB from a dozen different CDNs, so the webview never loads
//! them directly. Instead the first request downloads the original here, scales
//! it to fit ART_EDGE, re-encodes it as JPEG and keeps it under
//! `<app_data_dir>/art-cache/`. Every later request is a local file read, and no
//! outside host sees the app render a tile.
//!
//! Low-res art is refused. Some feeds state a logo or favicon rather than cover
//! art (a blog feed's RSS `<image>` is capped at 144 px by the RSS 2.0 spec; No
//! Bullshit Bitcoin's is a 256×229 favicon), and stretched over a large tile it
//! looks broken. Anything whose short edge is under MIN_SOURCE_EDGE comes back as
//! an error, so the tile keeps its category glyph. The verdict is cached as an
//! empty `<name>.lowres` marker, so the image isn't re-downloaded every launch
//! just to be refused again. A user-chosen replacement is a later step.
//!
//! The cache is a cache: it's keyed by a hash of the image URL (a publisher that
//! changes its art changes the URL, so the new one is fetched), it is not part of
//! any backup, and deleting the folder only costs a re-download. Results go to the
//! webview as a `data:` URI, which needs no asset-protocol scope or CSP change.

use base64::Engine;
use image::imageops::FilterType;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Longest edge of a cached thumbnail, in px. Large tiles draw at ~240–300 CSS px,
/// so this stays sharp at 2× without carrying the publisher's 3000 px original.
const ART_EDGE: u32 = 512;
/// Refuse anything bigger than this — no cover art is legitimately 20 MB.
const MAX_BYTES: usize = 20 * 1024 * 1024;
const JPEG_QUALITY: u8 = 85;
/// Sources whose SHORT edge is below this are logos/favicons, not cover art.
/// Apple asks for 1400 px minimum; every real cover among the suite's feeds is
/// ≥ 512, while the one favicon is 256×229.
const MIN_SOURCE_EDGE: u32 = 300;

pub fn art_cache_dir(app_data: &Path) -> Result<PathBuf, String> {
    let dir = app_data.join("art-cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// FNV-1a over the image URL — a filename, not a security boundary (same scheme
/// as the feed cache, so names are stable across builds).
fn cache_name(url: &str) -> String {
    format!("{}.jpg", cache_stem(url))
}

fn cache_stem(url: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in url.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    format!("{h:016x}")
}

fn lowres_name(url: &str) -> String {
    format!("{}.lowres", cache_stem(url))
}

/// What a source image turned into.
#[derive(Debug)]
enum Shrunk {
    Jpeg(Vec<u8>),
    /// Too small to be cover art (see MIN_SOURCE_EDGE); its original size.
    LowRes(u32, u32),
}

fn data_uri(jpeg: &[u8]) -> String {
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    )
}

/// Decode any common format, refuse it if it's low-res, else fit it inside
/// ART_EDGE × ART_EDGE (aspect kept, never upscaled) and re-encode as JPEG.
/// Alpha is dropped; cover art is opaque in practice.
fn shrink(bytes: &[u8]) -> Result<Shrunk, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("decode: {e}"))?;
    if img.width().min(img.height()) < MIN_SOURCE_EDGE {
        return Ok(Shrunk::LowRes(img.width(), img.height()));
    }
    let img = if img.width() > ART_EDGE || img.height() > ART_EDGE {
        img.resize(ART_EDGE, ART_EDGE, FilterType::CatmullRom)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| format!("encode: {e}"))?;
    Ok(Shrunk::Jpeg(out))
}

/// The cached thumbnail for `url` as a `data:` URI, fetching and shrinking it on
/// first use. Errors (bad URL, network, undecodable image) are returned as text;
/// the UI treats any error as "no art" and keeps the category glyph.
pub async fn podcast_art(cache_dir: PathBuf, url: String) -> Result<String, String> {
    let path = cache_dir.join(cache_name(&url));
    if let Ok(bytes) = std::fs::read(&path) {
        return Ok(data_uri(&bytes));
    }
    let lowres = cache_dir.join(lowres_name(&url));
    if lowres.exists() {
        return Err("low-res source".to_string());
    }

    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(format!("unsupported scheme: {}", parsed.scheme()));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(parsed)
        .header("User-Agent", "ntune (radio-scan)")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("image too large".to_string());
    }
    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_BYTES {
        return Err("image too large".to_string());
    }

    // Decode + resize is CPU work (a 3000 px original takes ~100 ms) — keep it off
    // the async runtime's worker threads.
    let jpeg = match tauri::async_runtime::spawn_blocking(move || shrink(&body))
        .await
        .map_err(|e| e.to_string())??
    {
        Shrunk::Jpeg(j) => j,
        Shrunk::LowRes(w, h) => {
            let _ = std::fs::write(&lowres, b"");
            return Err(format!("low-res source ({w}×{h})"));
        }
    };

    // Write-then-rename, so a crash mid-write never leaves a truncated JPEG that
    // the read-path above would serve forever.
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, &jpeg).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
    Ok(data_uri(&jpeg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([200, 100, 50, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn jpeg(s: Shrunk) -> Vec<u8> {
        match s {
            Shrunk::Jpeg(j) => j,
            other => panic!("expected a JPEG, got {other:?}"),
        }
    }

    #[test]
    fn shrinks_large_art_to_fit_the_edge_keeping_aspect() {
        let jpeg = jpeg(shrink(&png(1500, 900)).unwrap());
        let back = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((back.width(), back.height()), (512, 307));
    }

    #[test]
    fn never_upscales_small_art() {
        let jpeg = jpeg(shrink(&png(400, 400)).unwrap());
        let back = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((back.width(), back.height()), (400, 400));
    }

    #[test]
    fn refuses_a_favicon_sized_source() {
        // No Bullshit Bitcoin's feed image: the site favicon.
        assert!(matches!(shrink(&png(256, 229)).unwrap(), Shrunk::LowRes(256, 229)));
    }

    #[test]
    fn judges_low_res_by_the_short_edge() {
        // A wide logo strip is still not cover art.
        assert!(matches!(shrink(&png(1200, 144)).unwrap(), Shrunk::LowRes(..)));
        assert!(matches!(shrink(&png(300, 300)).unwrap(), Shrunk::Jpeg(_)));
    }

    #[test]
    fn rejects_bytes_that_are_not_an_image() {
        assert!(shrink(b"<html>not found</html>").is_err());
    }

    #[test]
    fn names_are_stable_and_distinct() {
        assert_eq!(cache_name("https://a/x.jpg"), cache_name("https://a/x.jpg"));
        assert_ne!(cache_name("https://a/x.jpg"), cache_name("https://a/y.jpg"));
        assert!(cache_name("https://a/x.jpg").ends_with(".jpg"));
        assert_eq!(
            lowres_name("https://a/x.jpg").trim_end_matches(".lowres"),
            cache_name("https://a/x.jpg").trim_end_matches(".jpg"),
        );
    }

    #[test]
    fn data_uri_is_jpeg_base64() {
        assert!(data_uri(&[0xff, 0xd8]).starts_with("data:image/jpeg;base64,"));
    }
}
