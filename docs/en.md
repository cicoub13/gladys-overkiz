# Overkiz integration for Gladys Assistant

Control your Overkiz-based devices from Gladys Assistant: Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo and Bouygues Flexom hubs are supported through the Overkiz cloud API.

## What it does

- **Covers**: roller shutters, awnings, screens, venetian blinds, curtains, pergolas, garage doors, gates and windows — open, close, stop and set the position.
- **Lights**: on/off and brightness.
- **Switches and plugs**: on/off.
- **Sensors**: temperature, humidity, luminance, contact (opening), occupancy (motion), smoke, water leak, CO2 and electric power/energy.
- **Battery**: every device that reports one, covers and lights included. Devices with a gauge get a battery level in percent; those that only report a status — most IO and RTS sensors — get a "low battery" indicator instead.
- **Water heaters**: operating mode (eco, manual, auto, away), boost, hot water setpoint, hot water left (in litres drawable at 40 °C), whether the appliance is heating, and the water temperature. Requires **Gladys 4.85 or later**, which is where the water heater category was added.

Device states are refreshed in near real time through the Overkiz event API, so a shutter moved from a physical remote is reflected in Gladys within seconds.

## Not supported yet

- **Heating**: radiators, underfloor heating and heat pumps (`HeatingSystem`) are not mapped to Gladys devices yet. **Atlantic Cozytouch**, **Thermor**, **Sauter** and **Hitachi Hi Kumo** hubs do connect and their water heaters are supported, but their heating devices will not show up in discovery yet.
- **Water heaters other than Atlantic / Thermor / Sauter** are mapped for what they report, but their vendor-specific commands (Hitachi Hi Kumo in particular) are not wired yet: expect the sensors to work and some controls to be missing.
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
- **A device is missing**: only device types listed above are supported. Run a new scan from the Discovery tab after adding a device to your hub. If your device should be supported but is not, use the **List the raw devices** action: it writes what Overkiz says about each of your devices to the integration logs, which is what a mapping needs. The dump carries your hub serial number — anonymize it before sharing.
- **States seem stale**: the event polling period can be lowered in the Configuration tab (10 s minimum). Keep in mind the Overkiz cloud rate-limits aggressive polling.
- **My water heater offers fewer modes than the appliance does**: only the modes your appliance actually exposes are offered. A boost is a control of its own rather than a mode, because that is how these appliances report it.
