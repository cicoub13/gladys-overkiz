# Changelog

## 1.3.0

Released as 1.3.0, not 1.2.1: the low-battery feature is an addition, and
covers and lights gain features they never had. The 1.2.1 tag was withdrawn.

### Fixed

- **Covers and lights report their battery.** `core:BatteryLevelState` had been
  mapped since the first release, but `mapDeviceFeatures` returned from the
  cover and light branches before ever reaching the sensor table — so the
  battery was read for every device family EXCEPT the two that actually run on
  one. Solar shutters, WireFree blinds and battery-powered lights now expose it
  like any sensor does. Both branches now fall through, as the water heater and
  plug branches already did, so those devices also pick up any other sensor
  state they publish.

  Gladys does not add features to a device that already exists: update the
  affected devices from the discovery screen to see the battery appear.

### Added

- **A low-battery warning for the devices that have no gauge.** Most IO and RTS
  sensors never publish a percentage — they answer the same question with a
  word, under three different state names: `core:SensorDefectState`
  (`lowBattery`), `core:BatteryState` (`low`, `verylow`) and
  `internal:BatteryStatusState`. The first one the device reports feeds a Gladys
  `battery-low` binary feature, which is what the Home Assistant overkiz
  component does with the same states.

  It stands alongside the percentage rather than replacing it: a device
  reporting both gets both, because the warning threshold is the manufacturer's
  and no percentage tells you where they put it. A status word outside the known
  vocabulary publishes nothing at all — wrongly reporting a healthy battery is
  the worse of the two silences.

## 1.2.0

### Added

- **Water heaters (`WaterHeatingSystem`) are mapped to Gladys.** Operating mode
  (eco, manual, auto, away), boost, hot water setpoint, hot water left, heating
  status and water temperature. Atlantic / Thermor / Sauter tanks are the family
  this was built and tested against; other families get whatever they report,
  without their vendor-specific commands.
  - **Requires Gladys 4.85 or later**, which introduces the `water-heater`
    device feature category (GladysAssistant/Gladys#2771). That PR is merged,
    but no Gladys release carries it yet — master is still 4.84.4 — so
    `gladys_version` is a forecast of the next minor. Confirm it against the
    release that actually ships the category before publishing.
  - The Gladys mode for a holiday period is `AWAY` (value 5). The appliance
    calls the same thing "absence", which is why the Overkiz side of the
    mapping keeps that word — `io:DHWAbsenceModeState`, `setAbsenceMode` and
    the `absence` key of `setCurrentOperatingMode`.
  - These appliances present eco and absence as two independent switches rather
    than as a selector. They are folded into the single Gladys `mode` feature,
    which declares the values it can actually reach through `supported_options`.
    Boost stays a feature of its own, because the appliance reports it natively
    as a separate duration and one function must never get two controls.
  - The water temperature and the electrical consumption are published as
    `temperature-sensor` and `energy-sensor` features rather than as
    water-heater types, which is what the Gladys taxonomy asks for and what
    plugs the appliance into the energy pipeline.
- **A "List the raw devices" action.** It writes the raw Overkiz description of
  every device (uiClass, widget, states, commands) to the integration logs — the
  only way to map an appliance exposed through a vendor-specific dialect. The
  dump carries the hub serial number, and the action says so.
- A Gladys command can now travel as an ordered list of Overkiz commands inside
  a single action. Water heaters need it: Overkiz only reports the result of a
  write once the matching `refreshXxx` has been sent, and switching mode means
  leaving boost and absence behind first.
- A Gladys feature can now be computed from SEVERAL Overkiz states at once
  (`watchedStates` + `derive`), which is how the water heater mode reads the DHW
  mode and the absence flag together.

### Fixed

- **"Heating" is asked for after a boost or a mode change.** Its value was
  correct, but nothing ever requested it: the appliance declares
  `refreshHeatingStatus` and it was never sent, so whether the tank is heating
  only moved when the appliance volunteered it or on the client's 30-minute
  sweep — long enough, right after starting a boost, to look stuck at idle.

- **Hot water left is published in litres, not as a percentage.** A tester saw
  "176 %". `core:RemainingHotWaterState` and `core:V40WaterVolumeEstimationState`
  are both volumes — the litres drawable at 40 °C — whatever the first state
  name suggests, and Home Assistant declares both as such. The feature now
  carries `liter` with the tank capacity as its maximum, so 176 reads as the
  176 litres it always was.

- **The mode vocabulary now follows the appliance family.** `setDHWMode` takes
  the same three words on `io` and `modbuslink` tanks with different meanings,
  and the `io` reading was being applied to both. On a `modbuslink` tank
  `autoMode` IS the energy-saving mode — the one the Atlantic app shows as
  "Eco+" — and `manualEcoActive` is only ever reported, never accepted as a
  write. Picking "Auto" therefore landed on Eco+, and picking "Eco" did nothing
  at all. Those tanks now offer Eco, Manual and Away only: they have no third
  DHW mode, and offering one sent a value the appliance silently ignored.

- **Selecting the "Away" mode no longer does nothing on Atlantic modbuslink
  tanks.** These appliances ignore a plain `setAbsenceMode('on')`: they want a
  start date, an end date and the value `prog`. The write now sends the same
  sequence as the Home Assistant overkiz component — `setDateTime`,
  `setAbsenceStartDate`, `setAbsenceEndDate` a year out, then
  `setAbsenceMode('prog')` — in a single Overkiz action.
- **`prog` is read as running, not as off.** It is what these appliances report
  once absence (or a scheduled boost) is active, and it was being read as
  inactive, so away could never appear on even once it had been set.
- **Picking any other mode now leaves the away mode.** Away is a mode value in
  Gladys rather than a control of its own, so selecting Eco, Manual or Auto has
  to clear it — otherwise the appliance stayed away and the chosen mode never
  took effect.
- **"Heating" no longer stays empty.** `core:HeatingStatusState` says `heating`
  on these appliances, not `on`; an unmapped value publishes nothing, so the
  feature never received a single state.
- **The setpoint is read from the state the appliance can refresh.** A tank
  reporting both `core:WaterTargetTemperatureState` and
  `core:TargetDHWTemperatureState` only offers `refreshWaterTargetTemperature`,
  so the former is now preferred — reading the latter left the setpoint stale
  after a write.

- **A device created from the Discovery screen no longer stays empty.** States
  published before the user creates the device are accepted by the host API and
  silently dropped — it has no feature to attach them to yet — but they were
  still recorded as published, so the deduplication skipped them afterwards. The
  device then filled in only as each of its states happened to change, which for
  a water heater mode, setpoint or boost can be days. `onDeviceCreated`,
  `onDeviceUpdated` and `onDeviceDeleted` are now wired: creating or updating a
  device forgets what it believed published and republishes that device.
  This affected every device type, not just water heaters.
- **Water heater writes are acknowledged again on appliances whose refresh
  command is not named after the set command.** The refresh used to be derived
  mechanically (`setXxx` → `refreshXxx`), so an Atlantic modbuslink tank — which
  takes `setTargetDHWTemperature` but only offers `refreshWaterTargetTemperature`
  — got no refresh at all, and `setDHWMode` / `setAbsenceMode` got none either.
  The written value then only came back on the next 30-minute poll. Refreshes
  are now picked from an ordered candidate list, still restricted to the
  commands the device declares.
- **RTS garage door openers now get open/close commands.** These only expose a
  single `cycle` command (like the lone button on their physical remote), which
  wasn't recognized, so only a read-only position was created.
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
