# legacy/ — superseded programs, kept so drift is a diff

Programs that ran in production before `radioscan.py` generalized them. Vendored
**verbatim**, warts included: the point is a baseline that matches what actually
ran, so the next divergence shows up as a diff rather than as a discovery.

Nothing here is maintained. Fixes belong in the generalization.

## `acidjazz_radio.py`

The single-station Acid Jazz logger `radioscan.py` was generalized from — same ICY
technique, same backoff constants, same decode chain, same summary layout. It ran
on the macOS box as launchd `com.tigger.acidjazz` from 2026-07-28.

Vendored 2026-08-25 at the state it was running, which includes two fixes ported
by hand from `radioscan.py` after the same bug was found there:

- the stop flag threaded into `icy_title_generator` and checked every metaint
  block, so SIGTERM is not made to wait for the next track change (upstream
  `87d7c74`)
- `shutdown(SHUT_RDWR)` before `close()` in the signal handler, so a read blocked
  on a **stalled** socket is interrupted rather than riding out the 20s timeout
  (upstream `2f9551c` — `close()` alone looks like it works and does not)

Both were hand-ported precisely because this file lives outside the repo, which is
the drift this directory exists to end.

**Slated for retirement.** `radioscan.py` with a one-station config reproduces it
and receives fixes by pull. Retiring rather than maintaining a frozen copy is the
agreed direction; this file is the rollback if that migration goes wrong.
