// Canonical URL + derived address, mirroring src-tauri/src/lib.rs (decision #11).
//
// A SECOND implementation of a contract is a liability unless it is held to the
// same vectors — that is the whole reason schema/station-address.vectors.json
// exists, and address.test.ts runs this against every one of them. Rust owns
// publishing; this exists because the renderer must decide whether a local row and
// a published event are the same thing, and matching raw URL strings gets that
// wrong: https://…/dronezone and http://…/dronezone are one stream and one event,
// so a raw-string merge marks one row published and leaves its twin offering to
// publish forever, flipping which is which on every press.

/** Canonical form: `host[:port] + path + ?query`. See the vectors for each rule. */
export function canonicalUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return trimmed; // unparseable: stable for this exact string, at least
  }

  const host = u.hostname.toLowerCase();
  // URL leaves `port` empty for a scheme's default (80/443) — the rule we want.
  const authority = u.port ? `${host}:${u.port}` : host;

  // Path keeps its case (Icecast mounts are case-sensitive) and its `;` parameter;
  // percent-encoding is normalised by decoding then re-encoding.
  let path: string;
  try {
    path = encodeURI(decodeURIComponent(u.pathname));
  } catch {
    path = u.pathname; // malformed escapes: leave as served
  }
  path = path.replace(/\/+$/, "");

  const query = u.search.replace(/^\?/, "");
  return query ? `${authority}${path}?${query}` : `${authority}${path}`;
}

/** True when two URLs name the same stream or feed — the merge's real question. */
export function sameTarget(a: string, b: string): boolean {
  return canonicalUrl(a) === canonicalUrl(b);
}
