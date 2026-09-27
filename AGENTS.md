# AGENTS.md — gladys-overkiz

Project-specific notes. Generic rules (SDK contract, commands, kit-owned files, runtime) are in
`CLAUDE.md`; the module list is in `README.md` § Project layout. Per-version behaviour changes
are in `CHANGELOG.md`.

## Data flow

- `index.js` → `createHandlers()` (`src/handlers.js`, the hub) → one `createAccount()`
  (`src/account.js`) per complete account → one `Overkiz` wrapper (`src/overkiz.js`) each.
- Accounts never call `gladys`: they hand devices/states to the hub. Only the hub calls
  `publishDiscoveredDevices` (`publishDiscovered`), `setConnectionStatus`
  (`refreshConnectionStatus`) and, through `src/publisher.js`, `publishStates`.
- `publishDiscoveredDevices` REPLACES the whole list, so it always carries the union of all
  accounts (dedup by `external_id`, first account wins). Order in `connectAccount`: discovery,
  then states, then status (states for a device not in discovery are dropped).
- Push, not poll: devices have `should_poll: false`, no `onPoll`. `overkiz-client` event polling
  fires `device.on('states')` → `account.onStates` → publisher. `collectStates()` diffs every
  mapped entry against `publisher.lastValue()` for full resyncs.
- States published before the user creates the device are silently dropped by Gladys, so
  `deviceCreated`/`deviceUpdated`/`deviceDeleted` call `forgetDeviceValues` → `publisher.forget`.
- `setValue` does an optimistic echo publish after `overkiz.execute` (which resolves on execId,
  not completion).

## Overkiz / `overkiz-client` quirks (all handled in code, keep them)

- Rejects with a plain STRING, not an Error → always go through `describeOverkizError`
  (`src/errors.js`): kinds `credentials` / `locked` / `unreachable` / `unknown`; only
  `unreachable` is `transient` and retried.
- Account lockout is the main risk: never log in needlessly. Hence sessions memoized by account
  id (`server:username-lowercased`, not slot) in `overkizById`, `connectionConfigEquals` to skip
  re-auth on Gladys reconnects, sequential logins in slot order, duplicates dropped in
  `normalizeConfig`, no retry on `credentials`/`locked`.
- On `disconnect` the client stops its own timers and keeps a rejected `connectPromise` forever:
  only a new client recovers → `account.js` calls `scheduleRetry()` (60 s, ×2, cap 15 min).
  `connect` fires right after login, before `getDevices` succeeds: backoff resets only in
  `account.connect()`/when `overkiz.connected` is true.
- `createOverkizClient` patches private internals: `client.api.client.defaults.timeout = 30s`
  (axios had none), `client.refreshDevices` wrapped with `.catch` (fire-and-forget upstream →
  unhandled rejection). `stop()` uses untyped `setRefreshTaskPeriod(0)`/`setPollingTaskPeriod(0)`.
- `refreshPeriod` is in MINUTES (30); `pollingPeriod` in seconds, clamped 10–300 (0 would
  disable polling). `index.js` exits on `unhandledRejection` so the supervisor restarts it, but
  does NOT exit when the initial `gladys.connect()` fails.
- A command may be an ordered array sent as ONE Overkiz Action (water heaters need
  `setXxx` then `refreshXxx`; mode change needs its reset first).
- `package.json` `overrides.uuid ^11.1.1`: see README before touching.

## IDs and config (must stay stable)

- `external_id` = SDK `externalIds('overkiz', platformId)` → device `ext:<selector>:overkiz:<pid>`,
  feature `<device>:<key>`. `pid = platformIdFromDeviceUrl(deviceURL)` (lowercase, non
  `[a-z0-9]` runs → `-`). No account/slot in ids (`test/compat.test.js` enforces it).
- Feature keys (`src/mapping.js`): position, state, binary, brightness, temperature, humidity,
  luminance, contact, occupancy, smoke, water, co2, power, energy, battery, battery_low, mode,
  boost, target_temperature, remaining_hot_water, heating, water_temperature.
- Device param `DEVICE_URL` holds the raw deviceURL.
- Config keys: slot 1 unsuffixed (`server`, `username`, `password`), slots 2–3 suffixed `_2`/`_3`,
  plus global `polling_period`; `*_intro`/`advanced` are sections. Only `readLegacySlots` in
  `src/config.js` knows about slots. Password is deliberately not trimmed. Nothing is written
  to `/data`.
- Adding a server: update all three `server*` option lists in the manifest + `SERVER_LABELS`
  (and it must be an `overkiz-client` service; `test/manifest.test.js` checks all of this).

## Mapping gotchas (`src/mapping.js`)

- Mapping keyed on `definition.uiClass`; candidate lists (states/commands) pick the first the
  device actually has. Mapping entries: `{ key, stateName, invert, watchedStates?, derive? }`;
  `derive` computes a feature from several states (water-heater `mode`).
- Covers: `ClosureState` inverted, `DeploymentState` (Awning, Pergola) as-is; 108/124 presets →
  null. `state` feature is write-only (`has_feedback: false`); RTS garage doors use `cycle`.
- Water heaters: `io` vs `modbuslink` dialect (`dhwDialect`) give `setDHWMode` values different
  meanings; `modbuslink` away mode needs start/end dates. `stateToGladysValue` returning null
  means "publish nothing" (unknown battery words, presets...).
- Unmapped appliances: use the `dump_devices` action output (`Device dump: {json}` log lines);
  `makeAtlanticModbuslinkWaterHeater` in `test/helpers.js` is a real captured device.

## Tests

- Everything is injected (`gladys`, `createOverkiz`, `scheduleTimer`, `now`, `sleep`); fakes in
  `test/helpers.js`: `makeFakeGladys` (records `calls`, `publishError`), `makeFakeOverkiz(Pool)`,
  `makeFakeTimer` (`runAll()` fires retries), `makeFakeClock`, `makeMultiConfig`,
  `makeOverkizDevice`, `makeWaterHeater`. `externalIdHelpers` keeps `externalIds` method-shaped
  so a detached `gladys.externalIds` fails in tests as in prod (hub binds it for that reason).
- `test/overkiz.test.js` fakes the raw `overkiz-client`; `test/index.test.js` spawns the real
  `index.js` against a fake HTTP Gladys; `test/multi-account.test.js` covers the union/budget.
- `npm run coverage` floors: lines 85 %, branches 75 %.
- Status: green only when every configured account is connected; single-account messages keep
  the pre-multi-account wording (`src/status.js`, `testConnection`) — tests pin it. The
  `test_connection` action must THROW to show red.
