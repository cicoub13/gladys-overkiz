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

State updates are pushed to Gladys in near real time through the Overkiz event polling API. Gladys commands are translated into Overkiz executions (`setClosure`, `open`, `close`, `stop`, `on`, `off`, `setIntensity`...), picking the commands the device actually supports.

## Project layout

- `index.js` — SDK wiring: discovery, commands, state publishing, config lifecycle.
- `src/overkiz.js` — thin wrapper around `overkiz-client` (auth, devices, executions, event polling).
- `src/mapping.js` — Overkiz uiClass/state/command ↔ Gladys category/feature/command mapping.
- `src/config.js` — configuration defaults and normalization.
- `gladys-assistant-integration.json` — the integration manifest (config schema, actions).
- `docs/en.md`, `docs/fr.md` — the user documentation displayed in the Gladys store.

## Development

```bash
npm install
npm test          # unit tests (node --test)
npm run lint      # eslint
npm run format    # prettier
```

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
