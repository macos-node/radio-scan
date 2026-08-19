# The live logger — a check-up, not yet done

**Picked up next session.** Everything else moved or settled on 2026-08-19/20:
the episodic pair (On The Wire, A Duck in a Tree) now runs on Linux systemd
timers, and decision #11 has stations and podcasts converging across both
machines. The **live Acid Jazz logger** is the one piece nobody has looked at
through all of it.

## What it is, and why it is the odd one out

`com.tigger.acidjazz`, a launchd job in `~/RadioTuner` on **macOS**, reading ICY
`StreamTitle` from `http://79.111.14.76:8000/acidjazz` and writing a row per track
change. It deliberately stayed on macOS during the episodic handoff: the episodic
parsers need a *schedule*, this needs *uptime*, and those are different problems.

That difference is the whole reason to look. A weekly timer that misses a week
catches up (`Persistent=true`); a continuous logger that misses an afternoon has
simply lost it — there is no backfill for "what was playing", because the station
broadcasts only the current track. **Any gap is permanent.**

## What to check

1. **Is it running at all?**
   ```bash
   launchctl list | grep acidjazz          # macOS
   ls -la ~/RadioTuner/acidjazz_log.jsonl  # mtime = last track change seen
   ```
2. **How much has it actually captured?** STATUS records **~1,161 plays over
   2026-07-28 → 2026-08-01** — four days, and that note is now three weeks old. Row
   count and date range will say whether it has been logging since, or stopped.
3. **Where are the gaps?** Bucket the rows by hour and look for holes; each one is
   a sleep, a reboot, or a dropped connection. The shape matters more than the
   count: scattered short gaps mean reconnect behaviour, one long gap means the
   machine was off.
4. **Does it survive a reboot in practice?** It is configured to
   (`RunAtLoad`+`KeepAlive`), which is not the same as verified.

## The decision waiting behind it

The episodic handoff already recorded the answer in passing: *"a VPS is the
eventual answer there, not either desktop."* Neither machine is on continuously,
and the logger's value is exactly proportional to its uptime. Options, in the order
they cost:

- **Leave it on macOS.** Free, and the gaps are whatever they are.
- **Move it to Linux** — `service/install-linux.sh` already installs the always-on
  variant. Trades one desktop's uptime for another's; only better if this machine
  is up more.
- **A VPS.** The honest answer for a 24/7 sensor, and it also removes the
  "which desktop owns it" question the episodic handoff had to settle.

Worth deciding with the gap data from step 3 in hand, not before — if the real
uptime turns out to be 95%, this is not urgent; if it is 40%, the log is much
thinner than the row count suggests.

## Related, not blocking

- **ntune already publishes Acid Jazz** as a `station.v1` (address
  `762296657895e81f`), and the station appears in the feed on both machines. The
  logger is unrelated plumbing — it writes files, and nothing in ntune reads them
  yet.
- **`airplay.v1` (kind 31240) is still unbuilt.** This logger is the L1 sensor that
  would feed it, so its gap profile is also an input to that design: a sensor that
  is up half the time publishes a misleading picture of what a station played.
