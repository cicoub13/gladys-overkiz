# Changelog

## Unreleased

### Fixed

- **"Test the connection" no longer reports success after a failure.** The wrapper
  marked itself connected before the first API call, so a refused password
  answered `Connection OK, 0 supported device(s) found.` while the status badge
  said the opposite.
- **Awnings and pergolas report the position they were commanded.** `core:DeploymentState`
  (100 = fully deployed = open) was inverted like a closure on read but not on
  write, so commanding 70 % reported 30 % back. Position sources now follow the
  Home Assistant convention per `uiClass`.
- **The `108` ("my position") and `124` ("unknown position") presets are no longer
  published as a position.** They used to clamp to 0 and be recorded as "fully
  closed".
- **States are no longer lost when a publish fails.** Values were remembered
  before being accepted by Gladys, so a rate-limited or failed batch was skipped
  forever by the deduplication. They are now recorded only after the host API
  accepts them, and a failed batch is replayed a minute later.
- Connection failures report their actual cause (refused credentials, locked
  account, unreachable cloud) instead of always blaming the credentials —
  `overkiz-client` rejects with plain strings, which hid the real error.
- `polling_period` is clamped to its declared 10–300 s bounds. An emptied field
  arrived as `''`, which became `0` and silently disabled event polling.
- The `uuid` override moved from `^9.0.1` to `^11.1.1`: the previous pin held a
  version affected by GHSA-w5hq-g745-h8pq. Production dependencies now audit
  clean, and the generated UUIDs are unchanged.

### Added

- Automatic reconnection with exponential backoff (60 s → 15 min) — for transient
  failures only. Refused credentials and locked accounts are never retried, as
  insisting is what locks an Overkiz account harder.
- The 300 states/minute host limit is respected: publishing pauses instead of
  being rejected on a large first scan.
- Commands echo their new value immediately, instead of leaving the UI stale
  until the next polling cycle.

### Changed

- A Gladys WebSocket reconnection reuses the existing Overkiz session instead of
  re-authenticating every time.
- Feature names are readable and no longer prefixed with the device label
  (`Power` instead of `Living room power`).
- The orchestration moved from `index.js` to `src/handlers.js` with injected
  collaborators; `index.js` is now wiring only. Test coverage went from one
  module to the whole `src/` tree.
- The docs and manifest now state what is _not_ supported (heating, hot water,
  locks, alarms), so Cozytouch and Hi Kumo owners know what to expect.

## 1.0.1

- Add cover image.

## 1.0.0

- Initial release.
