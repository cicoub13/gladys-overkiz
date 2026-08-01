# Overkiz integration for Gladys Assistant

Control your Overkiz-based devices from Gladys Assistant: Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo and Bouygues Flexom hubs are supported through the Overkiz cloud API.

## What it does

- **Covers**: roller shutters, awnings, screens, venetian blinds, curtains, pergolas, garage doors, gates and windows — open, close, stop and set the position.
- **Lights**: on/off and brightness.
- **Switches and plugs**: on/off.
- **Sensors**: temperature, humidity, luminance, contact (opening), occupancy (motion), smoke, water leak, CO2, electric power/energy and battery level.

Device states are refreshed in near real time through the Overkiz event API, so a shutter moved from a physical remote is reflected in Gladys within seconds.

## Not supported yet

- **Heating and domestic hot water**: radiators, underfloor heating, water heaters and heat pumps (`HeatingSystem`, `WaterHeatingSystem`) are not mapped to Gladys devices yet. **Atlantic Cozytouch**, **Thermor**, **Sauter** and **Hitachi Hi Kumo** hubs do connect, but most of their devices will not show up in discovery yet.
- **Locks, alarms and ventilation** (`DoorLock`, `Alarm`, `AirFlow`).
- On metering plugs and modules, Overkiz often publishes the power reading on a separate **sub-device**: it then appears as its own device in discovery, carrying the same name as its parent.

## Prerequisites

- An Overkiz-based hub (Somfy TaHoma, TaHoma Switch, Connexoon, Cozytouch...) already set up with the vendor's app.
- The email and password of your vendor account (the same credentials you use in the TaHoma / Cozytouch app).

## Configuration

1. Install the integration from the Gladys store.
2. Open the **Configuration** tab.
3. Pick the **Server** matching your hub (Somfy Europe for TaHoma / TaHoma Switch / Connexoon in Europe).
4. Enter your account **email** and **password**, then save.
5. Use the **Test the connection** button to verify the credentials.
6. Open the **Discovery** tab, run a scan, and create the devices you want in Gladys.

## Troubleshooting

- **Connection failed**: double-check the server selection and your credentials by logging into the vendor's app. Somfy may temporarily lock the account after too many failed attempts.
- **A device is missing**: only device types listed above are supported. Run a new scan from the Discovery tab after adding a device to your hub.
- **States seem stale**: the event polling period can be lowered in the Configuration tab (10 s minimum). Keep in mind the Overkiz cloud rate-limits aggressive polling.
