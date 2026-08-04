/** Header version chip shows only `major.minor.patch`; any `-beta.2` / `+build`
 *  suffix is dropped here and belongs in the chip's tooltip instead. Suite rule
 *  — every app carries its own `shortVersion()` (SUITE.md § Top-bar grammar). */
export function shortVersion(v: string): string {
  const m = v.match(/^\d+\.\d+\.\d+/);
  return m ? m[0] : v;
}
