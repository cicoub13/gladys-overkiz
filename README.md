# gladys-overkiz

Overkiz external integration for [Gladys Assistant](https://gladysassistant.com): control Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo and Bouygues Flexom devices from Gladys.

Built on the [Gladys external integration platform](https://gladysassistant.com/docs/dev/external-integrations/) and the [`overkiz-client`](https://github.com/dubocr/overkiz-client) library, with device mappings inspired by the [Home Assistant Overkiz component](https://github.com/home-assistant/core/tree/dev/homeassistant/components/overkiz).

## Supported devices

| Overkiz device                                                                                       | Gladys features                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Covers (RollerShutter, Awning, Screen, VenetianBlind, Curtain, Pergola, GarageDoor, Gate, Window...) | position (0-100), open / close / stop |
| Light                                                                                                | on/off, brightness                    |
| OnOff switches & plugs, sirens, swimming pools                                                       | on/off                                |
| Temperature / humidity / luminance / CO2 sensors                                                     | decimal sensor values                 |
| Contact, occupancy, smoke, water-detection sensors                                                   | binary sensor values                  |
| Electricity sensors                                                                                  | power (W), energy index (Wh)          |
| Battery-powered devices                                                                              | battery level (%)                     |

Not mapped yet: `HeatingSystem`, `WaterHeatingSystem`, `DoorLock`, `Alarm`, `AirFlow`. Cozytouch / Thermor / Sauter / Hi Kumo hubs connect fine, but most of their devices are heating ones and will not appear in discovery.

Covers follow the Home Assistant convention: `core:ClosureState` is inverted into a Gladys open percentage, while `core:DeploymentState` (awnings, pergolas) already is one and is used as-is. The `108` ("my position") and `124` ("unknown position") presets are dropped rather than published as a bogus percentage.

State updates are pushed to Gladys in near real time through the Overkiz event polling API. Gladys commands are translated into Overkiz executions (`setClosure`, `setDeployment`, `open`, `close`, `stop`, `on`, `off`, `setIntensity`...), picking the commands the device actually supports.

## Project layout

- `index.js` — SDK wiring only.
- `src/handlers.js` — orchestration: connection lifecycle, discovery, state publishing, command routing. Collaborators and timers are injected, so it is tested without network or SDK.
- `src/overkiz.js` — thin wrapper around `overkiz-client` (auth, devices, executions, event polling).
- `src/mapping.js` — Overkiz uiClass/state/command ↔ Gladys category/feature/command mapping.
- `src/config.js` — configuration defaults, normalization and bounds.
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
