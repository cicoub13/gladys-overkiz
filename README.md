# gladys-overkiz

Overkiz external integration for [Gladys Assistant](https://gladysassistant.com): control Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo and Bouygues Flexom devices from Gladys.

Built on the [Gladys external integration platform](https://gladysassistant.com/docs/dev/external-integrations/) and the [`overkiz-client`](https://github.com/dubocr/overkiz-client) library, with device mappings inspired by the [Home Assistant Overkiz component](https://github.com/home-assistant/core/tree/dev/homeassistant/components/overkiz).

Up to **3 Overkiz accounts** can run side by side — brands keep separate accounts on separate servers, so a Somfy hub for the covers and an Atlantic Cozytouch account for a Thermor water heater is a common setup. Gladys installs an integration once (its selector is derived from the repository, so a second install is refused), which is why the accounts live inside it rather than in several instances.

## Supported devices

| Overkiz device                                                                                       | Gladys features                                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Covers (RollerShutter, Awning, Screen, VenetianBlind, Curtain, Pergola, GarageDoor, Gate, Window...) | position (0-100), open / close / stop                             |
| Light                                                                                                | on/off, brightness                                                |
| OnOff switches & plugs, sirens, swimming pools                                                       | on/off                                                            |
| Temperature / humidity / luminance / CO2 sensors                                                     | decimal sensor values                                             |
| Contact, occupancy, smoke, water-detection sensors                                                   | binary sensor values                                              |
| Electricity sensors                                                                                  | power (W), energy index (Wh)                                      |
| Battery-powered devices (any uiClass, covers and lights included)                                    | battery level (%), low-battery warning                            |
| Water heaters (`WaterHeatingSystem`)                                                                 | mode, boost, setpoint, hot water left, heating, water temperature |

Not mapped yet: `HeatingSystem`, `DoorLock`, `Alarm`, `AirFlow`. Cozytouch / Thermor / Sauter / Hi Kumo hubs connect fine, but their radiators and heat pumps will not appear in discovery.

Water heaters map onto the Gladys `water-heater` category, which requires **Gladys 4.85 or later**.
Atlantic / Thermor tanks present eco and absence as two independent switches rather than as a
selector; they are folded into the single Gladys `mode` feature, which declares the values it can
actually reach through `supported_options`. Boost stays a feature of its own because the appliance
reports it natively as a separate duration. The water temperature and the electrical consumption are
published as `temperature-sensor` and `energy-sensor` features, as the Gladys taxonomy requires, so
the appliance also lands in the energy pipeline.

Covers follow the Home Assistant convention: `core:ClosureState` is inverted into a Gladys open percentage, while `core:DeploymentState` (awnings, pergolas) already is one and is used as-is. The `108` ("my position") and `124` ("unknown position") presets are dropped rather than published as a bogus percentage.

Battery reporting is read from whatever the device publishes, whatever its uiClass. A device with a gauge (`core:BatteryLevelState`) gets a percentage; one that only reports a status — `core:SensorDefectState`, `core:BatteryState` or `internal:BatteryStatusState`, which is what most IO and RTS sensors publish — gets a `battery-low` binary feature instead. A device reporting both gets both: the warning threshold is the manufacturer's, and no percentage says where they put it. A status word outside the known vocabulary publishes nothing rather than wrongly reporting a healthy battery.

State updates are pushed to Gladys in near real time through the Overkiz event polling API. Gladys commands are translated into Overkiz executions (`setClosure`, `setDeployment`, `open`, `close`, `stop`, `on`, `off`, `setIntensity`, `setDHWMode`...), picking the commands the device actually supports. Some writes need several commands in a fixed order — Overkiz only reports the result of a water heater write once the matching `refreshXxx` has been sent — so a command may travel as an ordered list inside a single Overkiz action.

The **List the raw devices** action writes the raw description of every Overkiz device (uiClass, widget, states, commands) to the integration logs. It is the way to map an appliance Overkiz exposes through a vendor-specific dialect. The dump carries your hub serial number: anonymize it before sharing.

## Project layout

- `index.js` — SDK wiring only.
- `src/handlers.js` — the hub: reconciles the configured accounts with the live sessions, publishes the union of their devices, routes commands. Collaborators and timers are injected, so it is tested without network or SDK.
- `src/account.js` — one Overkiz account: its session, its device mapping, its reconnection backoff. It never calls `gladys` — that is what keeps two accounts from overwriting each other's discovery list or status.
- `src/publisher.js` — the integration-wide state budget: 100 states per request, 300 per minute, serialized so concurrent pollers cannot overshoot it.
- `src/status.js` — folds the per-account states into the single connection status the host API exposes.
- `src/overkiz.js` — thin wrapper around `overkiz-client` (auth, devices, executions, event polling). One instance per account.
- `src/mapping.js` — Overkiz uiClass/state/command ↔ Gladys category/feature/command mapping.
- `src/config.js` — configuration defaults, normalization and bounds. The flat numbered slots of the form (`server`, `server_2`, `server_3`...) are read into a canonical account list here, and nowhere else.
- `src/errors.js` — classifies Overkiz failures (credentials / locked / unreachable) and decides what is worth retrying.
- `gladys-assistant-integration.json` — the integration manifest (config schema, actions).
- `docs/en.md`, `docs/fr.md` — the user documentation displayed in the Gladys store.

## Development

```bash
npm install
npm test          # unit tests (node --test)
npm run coverage  # same tests, with the coverage floor the CI enforces
npm run lint      # eslint
npm run format    # prettier
```

The whole integration is tested without a network or an Overkiz account: `gladys`,
the Overkiz client, the clock and the timers are all injected (see `test/helpers.js`).

### The `uuid` override

`package.json` pins `uuid` for `overkiz-client`. `overkiz-client` asks for `uuid@^14`,
which is **ESM-only** while `overkiz-client` itself is CommonJS and `require()`s it.
`uuid@11` still ships a `require` export **and** carries the fix for
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); `uuid@9`,
the previous pin, does not. Keep the override at `^11.1.1` until `overkiz-client`
ships an ESM build.

Run against a local Gladys instance (install the integration in developer mode to get a token and selector):

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="overkiz" \
LOG_LEVEL=debug \
npm start
```

Validate the manifest with the same checks as the store indexer:

```bash
npx github:GladysAssistant/integration-store .
```

## Release

Run the **Release** GitHub Actions workflow (patch / minor / major): it bumps the version in `package.json` and the manifest, builds the multi-arch Docker image (linux/amd64 + linux/arm64), pushes it to ghcr.io and tags the release. Add the `gladys-assistant-integration` GitHub topic to the repository so the store indexer discovers it.
