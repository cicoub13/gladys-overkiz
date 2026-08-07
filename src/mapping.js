// -----------------------------------------------------------------------------
// Overkiz -> Gladys mapping.
//
// Inspired by the Home Assistant `overkiz` component: devices are mapped from
// their Overkiz uiClass / widgetName to Gladys device feature categories, and
// commands are resolved from the commands the device actually supports.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// The Gladys `water-heater` device feature category (GladysAssistant/Gladys#2771,
// merged) is not mirrored by `@gladysassistant/integration-sdk` yet — it is
// absent from 0.10.0, the latest published version — so its strings are declared
// here and locked by a test. Swap them for `DEVICE_FEATURE_CATEGORIES.WATER_HEATER`
// and `DEVICE_FEATURE_TYPES.WATER_HEATER` as soon as an SDK release carries them.
export const WATER_HEATER_CATEGORY = 'water-heater';

export const WATER_HEATER_TYPES = {
  BINARY: 'binary',
  MODE: 'mode',
  TARGET_TEMPERATURE: 'target-temperature',
  REMAINING_HOT_WATER: 'remaining-hot-water',
  HEATING: 'heating',
  BOOST: 'boost',
};

// Gladys WATER_HEATER_MODE. The enumeration is the full generic set; which of
// its values a given appliance offers is declared per feature through
// `supported_options`, never by narrowing the enum.
export const WATER_HEATER_MODE = {
  OFF: 0,
  AUTO: 1,
  ECO: 2,
  BOOST: 3,
  MANUAL: 4,
  AWAY: 5,
  PROGRAM: 6,
};

// Overkiz state names (subset of pyoverkiz OverkizState)
export const STATES = {
  CLOSURE: 'core:ClosureState',
  DEPLOYMENT: 'core:DeploymentState',
  PEDESTRIAN_POSITION: 'core:PedestrianPositionState',
  ON_OFF: 'core:OnOffState',
  LIGHT_INTENSITY: 'core:LightIntensityState',
  TEMPERATURE: 'core:TemperatureState',
  RELATIVE_HUMIDITY: 'core:RelativeHumidityState',
  LUMINANCE: 'core:LuminanceState',
  CONTACT: 'core:ContactState',
  OCCUPANCY: 'core:OccupancyState',
  SMOKE: 'core:SmokeState',
  WATER_DETECTION: 'core:WaterDetectionState',
  CO2_CONCENTRATION: 'core:CO2ConcentrationState',
  ELECTRIC_POWER_CONSUMPTION: 'core:ElectricPowerConsumptionState',
  ELECTRIC_ENERGY_CONSUMPTION: 'core:ElectricEnergyConsumptionState',
  BATTERY_LEVEL: 'core:BatteryLevelState',
  // Domestic hot water
  DHW_MODE: 'io:DHWModeState',
  DHW_MODE_MODBUSLINK: 'modbuslink:DHWModeState',
  AWAY_MODE_DURATION: 'io:AwayModeDurationState',
  DHW_ABSENCE_MODE: 'io:DHWAbsenceModeState',
  DHW_ABSENCE_MODE_MODBUSLINK: 'modbuslink:DHWAbsenceModeState',
  BOOST_MODE_DURATION: 'core:BoostModeDurationState',
  DHW_BOOST_MODE: 'io:DHWBoostModeState',
  DHW_BOOST_MODE_MODBUSLINK: 'modbuslink:DHWBoostModeState',
  TARGET_TEMPERATURE: 'core:TargetTemperatureState',
  TARGET_DHW_TEMPERATURE: 'core:TargetDHWTemperatureState',
  WATER_TARGET_TEMPERATURE: 'core:WaterTargetTemperatureState',
  MINIMAL_TEMPERATURE_MANUAL_MODE: 'core:MinimalTemperatureManualModeState',
  MINIMAL_TEMPERATURE_MANUAL_MODE_MODBUSLINK: 'modbuslink:MinimalTemperatureManualModeState',
  MAXIMAL_TEMPERATURE_MANUAL_MODE: 'core:MaximalTemperatureManualModeState',
  MAXIMAL_TEMPERATURE_MANUAL_MODE_MODBUSLINK: 'modbuslink:MaximalTemperatureManualModeState',
  MIDDLE_WATER_TEMPERATURE: 'io:MiddleWaterTemperatureState',
  MIDDLE_WATER_TEMPERATURE_MODBUSLINK: 'modbuslink:MiddleWaterTemperatureState',
  DHW_TEMPERATURE: 'core:DHWTemperatureState',
  WATER_TEMPERATURE: 'core:WaterTemperatureState',
  REMAINING_HOT_WATER: 'core:RemainingHotWaterState',
  REMAINING_HOT_WATER_MODBUSLINK: 'modbuslink:RemainingHotWaterState',
  V40_WATER_VOLUME: 'core:V40WaterVolumeEstimationState',
  V40_WATER_VOLUME_MODBUSLINK: 'modbuslink:V40WaterVolumeEstimationState',
  DHW_CAPACITY: 'io:DHWCapacityState',
  DHW_CAPACITY_MODBUSLINK: 'modbuslink:DHWCapacityState',
  HEATING_STATUS: 'core:HeatingStatusState',
  HEATING_STATUS_MODBUSLINK: 'modbuslink:HeatingStatusState',
};

// Overkiz uiClass values considered as covers (see HA OVERKIZ_DEVICE_TO_PLATFORM)
const COVER_UI_CLASSES = new Set([
  'AdjustableSlatsRollerShutter',
  'Awning',
  'Curtain',
  'ExteriorScreen',
  'ExteriorVenetianBlind',
  'GarageDoor',
  'Gate',
  'Pergola',
  'RollerShutter',
  'Screen',
  'Shutter',
  'SwingingShutter',
  'VenetianBlind',
  'Window',
]);

const IGNORED_UI_CLASSES = new Set(['ProtocolGateway', 'Pod']);

// Gladys always expects an OPEN percentage (100 = fully open). Overkiz reports
// either a closure (100 = fully closed, must be inverted) or a deployment
// (100 = fully deployed, i.e. already an open percentage). Awnings and pergolas
// are deployment-driven, everything else is closure-driven — this mirrors the
// `invert_position` flag of the Home Assistant overkiz component.
const DEPLOYMENT_UI_CLASSES = new Set(['Awning', 'Pergola']);

const CLOSURE_POSITION_SOURCES = [
  { stateName: STATES.CLOSURE, invert: true },
  { stateName: STATES.DEPLOYMENT, invert: false },
  { stateName: STATES.PEDESTRIAN_POSITION, invert: true },
];
const DEPLOYMENT_POSITION_SOURCES = [
  { stateName: STATES.DEPLOYMENT, invert: false },
  { stateName: STATES.CLOSURE, invert: true },
];

// Preset values some devices report instead of a real position. Publishing them
// as a percentage would record a wildly wrong state (108 would clamp to
// "fully closed"), so they are dropped.
const POSITION_MY = 108;
const POSITION_UNKNOWN = 124;

// --- Water heaters -----------------------------------------------------------
// Overkiz exposes domestic hot water through several incompatible dialects; the
// lists below are ordered candidates and the first one the device actually
// reports (or supports, for commands) wins. This mirrors how the cover branch
// picks its position source.
const WATER_HEATER_UI_CLASS = 'WaterHeatingSystem';

const DHW_MODE_STATES = [STATES.DHW_MODE, STATES.DHW_MODE_MODBUSLINK];
const DHW_ABSENCE_STATES = [
  STATES.AWAY_MODE_DURATION,
  STATES.DHW_ABSENCE_MODE,
  STATES.DHW_ABSENCE_MODE_MODBUSLINK,
];
const DHW_BOOST_STATES = [
  STATES.BOOST_MODE_DURATION,
  STATES.DHW_BOOST_MODE,
  STATES.DHW_BOOST_MODE_MODBUSLINK,
];
// `core:WaterTargetTemperatureState` comes before `core:TargetDHWTemperatureState`
// on purpose: an appliance reporting both only knows how to refresh the former
// (`refreshWaterTargetTemperature`), so reading the latter would leave the
// setpoint stale after a write. Home Assistant reads the same two states in
// this order for these two families.
const DHW_TARGET_TEMPERATURE_STATES = [
  STATES.TARGET_TEMPERATURE,
  STATES.WATER_TARGET_TEMPERATURE,
  STATES.TARGET_DHW_TEMPERATURE,
];
const DHW_WATER_TEMPERATURE_STATES = [
  STATES.MIDDLE_WATER_TEMPERATURE,
  STATES.MIDDLE_WATER_TEMPERATURE_MODBUSLINK,
  STATES.DHW_TEMPERATURE,
  STATES.WATER_TEMPERATURE,
];
const DHW_HEATING_STATES = [STATES.HEATING_STATUS, STATES.HEATING_STATUS_MODBUSLINK];
const DHW_PERCENT_STATES = [STATES.REMAINING_HOT_WATER, STATES.REMAINING_HOT_WATER_MODBUSLINK];
const DHW_VOLUME_STATES = [STATES.V40_WATER_VOLUME, STATES.V40_WATER_VOLUME_MODBUSLINK];
const DHW_CAPACITY_STATES = [STATES.DHW_CAPACITY, STATES.DHW_CAPACITY_MODBUSLINK];
const DHW_MIN_TEMPERATURE_STATES = [
  STATES.MINIMAL_TEMPERATURE_MANUAL_MODE,
  STATES.MINIMAL_TEMPERATURE_MANUAL_MODE_MODBUSLINK,
];
const DHW_MAX_TEMPERATURE_STATES = [
  STATES.MAXIMAL_TEMPERATURE_MANUAL_MODE,
  STATES.MAXIMAL_TEMPERATURE_MANUAL_MODE_MODBUSLINK,
];

const DHW_SET_TEMPERATURE_COMMANDS = [
  'setTargetTemperature',
  'setTargetDHWTemperature',
  'setWaterTargetTemperature',
];

// Overkiz only reports the result of a write once the matching `refreshXxx` has
// run, and the refresh is NOT always the set command with its verb swapped: an
// Atlantic modbuslink tank takes `setTargetDHWTemperature` but only offers
// `refreshWaterTargetTemperature`. Each list is tried in order and the first
// command the device declares wins.
const DHW_REFRESH_MODE_COMMANDS = ['refreshDHWMode'];
const DHW_REFRESH_ABSENCE_COMMANDS = ['refreshAwayModeDuration', 'refreshAbsenceMode'];
const DHW_REFRESH_BOOST_COMMANDS = ['refreshBoostModeDuration', 'refreshBoostMode'];
const DHW_REFRESH_TEMPERATURE_COMMANDS = [
  'refreshTargetTemperature',
  'refreshTargetDHWTemperature',
  'refreshWaterTargetTemperature',
];

// Setpoint bounds when the appliance does not report its own range. Home
// Assistant uses the same defaults for this family.
const DHW_DEFAULT_MIN_TEMPERATURE = 50;
const DHW_DEFAULT_MAX_TEMPERATURE = 62;
// V40 capacity fallback, in litres, when the tank does not report its own.
const DHW_DEFAULT_CAPACITY = 300;
// `setBoostModeDuration` counts days, and 7 is the longest these appliances take.
const DHW_BOOST_DURATION_DAYS = 7;

const OVERKIZ_DHW_MODE_TO_GLADYS = {
  manualecoactive: WATER_HEATER_MODE.ECO,
  manualecoinactive: WATER_HEATER_MODE.MANUAL,
  automode: WATER_HEATER_MODE.AUTO,
  off: WATER_HEATER_MODE.OFF,
  stop: WATER_HEATER_MODE.OFF,
};

const GLADYS_MODE_TO_OVERKIZ_DHW_MODE = {
  [WATER_HEATER_MODE.ECO]: 'manualEcoActive',
  [WATER_HEATER_MODE.MANUAL]: 'manualEcoInactive',
  [WATER_HEATER_MODE.AUTO]: 'autoMode',
};

// The modes reachable through `setDHWMode`, in the order they are offered.
const DHW_WRITABLE_MODES = [
  { value: WATER_HEATER_MODE.ECO, label: 'Eco' },
  { value: WATER_HEATER_MODE.MANUAL, label: 'Manual' },
  { value: WATER_HEATER_MODE.AUTO, label: 'Auto' },
];

/**
 * Build a stable, [a-z0-9-] safe platform id from an Overkiz deviceURL
 * (e.g. `io://1234-5678-9012/12345678` -> `io-1234-5678-9012-12345678`).
 */
export function platformIdFromDeviceUrl(deviceUrl) {
  return deviceUrl
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Human-readable feature names. Gladys already displays a feature under its
// device, so the device label must NOT be repeated here (it produced names like
// "Living room co2", untranslated and unbounded in length).
const FEATURE_NAMES = {
  position: 'Position',
  state: 'State',
  binary: 'On/Off',
  brightness: 'Brightness',
  temperature: 'Temperature',
  humidity: 'Humidity',
  luminance: 'Luminance',
  contact: 'Opening',
  occupancy: 'Motion',
  smoke: 'Smoke',
  water: 'Water leak',
  co2: 'CO2',
  power: 'Power',
  energy: 'Energy',
  battery: 'Battery',
  mode: 'Mode',
  boost: 'Boost',
  target_temperature: 'Target temperature',
  remaining_hot_water: 'Available hot water',
  heating: 'Heating',
  water_temperature: 'Water temperature',
};

function feature(ids, key, overrides) {
  return {
    external_id: ids.feature(key),
    name: FEATURE_NAMES[key] ?? key,
    read_only: true,
    has_feedback: true,
    keep_history: true,
    ...overrides,
  };
}

/**
 * Is an Overkiz "is this mode running" state active?
 *
 * The same question is answered in three shapes depending on the state: a plain
 * `on`/`off`, the literal `always`, or a remaining duration in days — which is
 * a STRING for `io:AwayModeDurationState` and a number for
 * `core:BoostModeDurationState`.
 */
function isDhwFlagActive(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return false;
  }
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }
  if (typeof rawValue === 'number') {
    return rawValue > 0;
  }
  const lowered = String(rawValue).trim().toLowerCase();
  // `prog` counts as RUNNING, not as "merely scheduled": it is the value the
  // appliance reports once absence has been set through its start/end dates,
  // and the Home Assistant overkiz component reads `on` and `prog` alike on
  // both `modbuslink:DHWAbsenceModeState` and `modbuslink:DHWBoostModeState`.
  if (lowered === 'always' || lowered === 'on' || lowered === 'prog') {
    return true;
  }
  if (lowered === 'off') {
    return false;
  }
  const asNumber = Number(lowered);
  return Number.isFinite(asNumber) && asNumber > 0;
}

/**
 * Read the water heater mode from the appliance, which spreads it over two
 * states: absence is a flag of its own and wins over the DHW mode, exactly as
 * the appliance's own interface presents it.
 *
 * Returns null when the reported mode is unknown: staying silent beats
 * publishing a mode the appliance is not in.
 */
function deriveWaterHeaterMode(device, { modeStateName, absenceStateName }) {
  if (absenceStateName && isDhwFlagActive(device.get(absenceStateName))) {
    return WATER_HEATER_MODE.AWAY;
  }
  if (!modeStateName) {
    return null;
  }
  const rawValue = device.get(modeStateName);
  if (typeof rawValue !== 'string') {
    return null;
  }
  const mode = OVERKIZ_DHW_MODE_TO_GLADYS[rawValue.trim().toLowerCase()];
  return mode === undefined ? null : mode;
}

function firstNumber(stateValues, stateNames, fallback) {
  for (const stateName of stateNames) {
    const rawValue = stateValues.get(stateName);
    // `Number(null)` is 0, which would silently become a bound of its own.
    if (rawValue === null || rawValue === undefined) {
      continue;
    }
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return fallback;
}

/**
 * Append the first refresh command the device actually declares.
 *
 * Only a declared command may be sent: Overkiz rejects the WHOLE action when
 * one of its commands is unknown to the device, which would take the write
 * down with the refresh. Appending none is the safe outcome — the state then
 * lands on the next event poll instead of immediately.
 */
function pushRefresh(commandList, commands, candidates) {
  const name = candidates.find((candidate) => commands.has(candidate));
  if (name) {
    commandList.push({ name, parameters: [] });
  }
}

/**
 * Build the water heater features of a `WaterHeatingSystem` device.
 *
 * The appliances of this family present absence and eco as independent
 * switches rather than as a selector; they are folded into the single Gladys
 * `mode` feature, which declares the values it can actually reach through
 * `supported_options`. Boost stays a feature of its own because the appliance
 * reports it natively as a separate duration — mapping it BOTH as a mode value
 * and as the `boost` type would give two controls over one state.
 */
function mapWaterHeaterFeatures(ids, commands, states, stateValues) {
  const entries = [];
  const find = (candidates) => candidates.find((stateName) => states.has(stateName)) ?? null;

  const modeStateName = find(DHW_MODE_STATES);
  const absenceStateName = find(DHW_ABSENCE_STATES);
  const canSetOperatingMode = commands.has('setCurrentOperatingMode');
  const canSetAbsence = canSetOperatingMode || commands.has('setAbsenceMode');

  const supportedOptions = [];
  if (commands.has('setDHWMode')) {
    supportedOptions.push(...DHW_WRITABLE_MODES);
  }
  if (canSetAbsence) {
    // Gladys calls this mode "away"; the appliance calls the same thing
    // "absence", which is why the Overkiz side below keeps that word.
    supportedOptions.push({ value: WATER_HEATER_MODE.AWAY, label: 'Away' });
  }

  if (modeStateName || supportedOptions.length > 0) {
    entries.push({
      key: 'mode',
      stateName: null,
      watchedStates: [modeStateName, absenceStateName].filter(Boolean),
      derive: (device) => deriveWaterHeaterMode(device, { modeStateName, absenceStateName }),
      gladysFeature: feature(ids, 'mode', {
        category: WATER_HEATER_CATEGORY,
        type: WATER_HEATER_TYPES.MODE,
        min: WATER_HEATER_MODE.OFF,
        max: WATER_HEATER_MODE.PROGRAM,
        read_only: supportedOptions.length === 0,
        ...(supportedOptions.length > 0
          ? {
              supported_options: supportedOptions.map((option, index) => ({
                ...option,
                sort_order: index,
              })),
            }
          : {}),
      }),
    });
  }

  const boostStateName = find(DHW_BOOST_STATES);
  const canSetBoost =
    commands.has('setBoostMode') || commands.has('setBoostModeDuration') || canSetOperatingMode;
  if (boostStateName || canSetBoost) {
    entries.push({
      key: 'boost',
      stateName: boostStateName,
      gladysFeature: feature(ids, 'boost', {
        category: WATER_HEATER_CATEGORY,
        type: WATER_HEATER_TYPES.BOOST,
        min: 0,
        max: 1,
        read_only: !canSetBoost,
      }),
    });
  }

  const targetStateName = find(DHW_TARGET_TEMPERATURE_STATES);
  const canSetTemperature = DHW_SET_TEMPERATURE_COMMANDS.some((name) => commands.has(name));
  if (targetStateName || canSetTemperature) {
    entries.push({
      key: 'target_temperature',
      stateName: targetStateName,
      gladysFeature: feature(ids, 'target_temperature', {
        category: WATER_HEATER_CATEGORY,
        type: WATER_HEATER_TYPES.TARGET_TEMPERATURE,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: firstNumber(stateValues, DHW_MIN_TEMPERATURE_STATES, DHW_DEFAULT_MIN_TEMPERATURE),
        max: firstNumber(stateValues, DHW_MAX_TEMPERATURE_STATES, DHW_DEFAULT_MAX_TEMPERATURE),
        read_only: !canSetTemperature,
      }),
    });
  }

  // Hot water left, as a percentage of the tank when the appliance reports one,
  // otherwise as the V40 volume it can still draw (litres usable at 40 °C).
  const percentStateName = find(DHW_PERCENT_STATES);
  const volumeStateName = percentStateName ? null : find(DHW_VOLUME_STATES);
  if (percentStateName || volumeStateName) {
    entries.push({
      key: 'remaining_hot_water',
      stateName: percentStateName ?? volumeStateName,
      gladysFeature: feature(ids, 'remaining_hot_water', {
        category: WATER_HEATER_CATEGORY,
        type: WATER_HEATER_TYPES.REMAINING_HOT_WATER,
        unit: percentStateName ? DEVICE_FEATURE_UNITS.PERCENT : DEVICE_FEATURE_UNITS.LITER,
        min: 0,
        max: percentStateName
          ? 100
          : firstNumber(stateValues, DHW_CAPACITY_STATES, DHW_DEFAULT_CAPACITY),
      }),
    });
  }

  const heatingStateName = find(DHW_HEATING_STATES);
  if (heatingStateName) {
    entries.push({
      key: 'heating',
      stateName: heatingStateName,
      gladysFeature: feature(ids, 'heating', {
        category: WATER_HEATER_CATEGORY,
        type: WATER_HEATER_TYPES.HEATING,
        min: 0,
        max: 1,
      }),
    });
  }

  // The water temperature is a temperature measurement like any other, so it
  // stays a `temperature-sensor` feature rather than becoming a water-heater
  // type — which is also what plugs it into the rest of Gladys.
  const waterTemperatureStateName = find(DHW_WATER_TEMPERATURE_STATES);
  if (waterTemperatureStateName) {
    entries.push({
      key: 'water_temperature',
      stateName: waterTemperatureStateName,
      gladysFeature: feature(ids, 'water_temperature', {
        category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: 0,
        max: 100,
      }),
    });
  }

  return entries;
}

/**
 * Build the Gladys features of an Overkiz device.
 *
 * Returns a list of `{ gladysFeature, stateName, key }` entries: `stateName`
 * is the Overkiz state that feeds the feature (null for write-only features),
 * and `key` identifies the feature for command routing in `buildCommand`.
 *
 * A feature whose value comes from SEVERAL Overkiz states instead carries
 * `watchedStates` (the states that must trigger a recomputation) and `derive`
 * (which reads them back from the device), leaving `stateName` null.
 */
export function mapDeviceFeatures(device, ids) {
  const entries = [];
  const uiClass = device.definition?.uiClass;
  const commands = new Set((device.definition?.commands ?? []).map((c) => c.commandName));
  const stateValues = new Map((device.states ?? []).map((s) => [s.name, s.value]));
  const states = new Set(stateValues.keys());

  if (IGNORED_UI_CLASSES.has(uiClass)) {
    return entries;
  }

  // --- Covers -----------------------------------------------------------------
  if (COVER_UI_CLASSES.has(uiClass)) {
    const sources = DEPLOYMENT_UI_CLASSES.has(uiClass)
      ? DEPLOYMENT_POSITION_SOURCES
      : CLOSURE_POSITION_SOURCES;
    const source = sources.find((s) => states.has(s.stateName));
    const canSetPosition =
      commands.has('setClosure') || commands.has('setDeployment') || commands.has('setPosition');
    if (source || canSetPosition) {
      entries.push({
        key: 'position',
        stateName: source?.stateName ?? null,
        invert: source?.invert ?? true,
        gladysFeature: feature(ids, 'position', {
          category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
          type: DEVICE_FEATURE_TYPES.SHUTTER.POSITION,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
          read_only: !canSetPosition,
        }),
      });
    }
    const canOpenClose =
      (commands.has('open') && commands.has('close')) ||
      (commands.has('up') && commands.has('down')) ||
      (commands.has('deploy') && commands.has('undeploy'));
    if (canOpenClose) {
      entries.push({
        key: 'state',
        stateName: null,
        gladysFeature: feature(ids, 'state', {
          category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
          type: DEVICE_FEATURE_TYPES.SHUTTER.STATE,
          min: -1,
          max: 1,
          read_only: false,
          keep_history: false,
          // Write-only: Overkiz reports a position, never an open/close/stop
          // state, so nothing will ever echo back here.
          has_feedback: false,
        }),
      });
    }
    return entries;
  }

  // --- Lights -----------------------------------------------------------------
  if (uiClass === 'Light') {
    if (states.has(STATES.ON_OFF) || (commands.has('on') && commands.has('off'))) {
      entries.push({
        key: 'binary',
        stateName: states.has(STATES.ON_OFF) ? STATES.ON_OFF : null,
        gladysFeature: feature(ids, 'binary', {
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
          min: 0,
          max: 1,
          read_only: !(commands.has('on') && commands.has('off')),
        }),
      });
    }
    if (states.has(STATES.LIGHT_INTENSITY) || commands.has('setIntensity')) {
      entries.push({
        key: 'brightness',
        stateName: states.has(STATES.LIGHT_INTENSITY) ? STATES.LIGHT_INTENSITY : null,
        gladysFeature: feature(ids, 'brightness', {
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
          read_only: !commands.has('setIntensity'),
        }),
      });
    }
    return entries;
  }

  // --- Water heaters --------------------------------------------------------------
  if (uiClass === WATER_HEATER_UI_CLASS) {
    entries.push(...mapWaterHeaterFeatures(ids, commands, states, stateValues));
    // fall through: these appliances also report energy and battery below
  }

  // --- Switches / plugs / sirens ------------------------------------------------
  if (
    (uiClass === 'OnOff' || uiClass === 'SwimmingPool' || uiClass === 'Siren') &&
    (states.has(STATES.ON_OFF) || (commands.has('on') && commands.has('off')))
  ) {
    entries.push({
      key: 'binary',
      stateName: states.has(STATES.ON_OFF) ? STATES.ON_OFF : null,
      gladysFeature: feature(ids, 'binary', {
        category:
          uiClass === 'Siren' ? DEVICE_FEATURE_CATEGORIES.SIREN : DEVICE_FEATURE_CATEGORIES.SWITCH,
        type:
          uiClass === 'Siren'
            ? DEVICE_FEATURE_TYPES.SIREN.BINARY
            : DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: !(commands.has('on') && commands.has('off')),
      }),
    });
    // fall through: plugs often also expose power/energy sensors below
  }

  // --- Sensors ------------------------------------------------------------------
  const sensorMap = [
    {
      stateName: STATES.TEMPERATURE,
      key: 'temperature',
      category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      min: -100,
      max: 200,
    },
    {
      stateName: STATES.RELATIVE_HUMIDITY,
      key: 'humidity',
      category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
    },
    {
      stateName: STATES.LUMINANCE,
      key: 'luminance',
      category: DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.LUX,
      min: 0,
      max: 150000,
    },
    {
      stateName: STATES.CONTACT,
      key: 'contact',
      category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
    },
    {
      stateName: STATES.OCCUPANCY,
      key: 'occupancy',
      category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
    },
    {
      stateName: STATES.SMOKE,
      key: 'smoke',
      category: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
    },
    {
      stateName: STATES.WATER_DETECTION,
      key: 'water',
      category: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
    },
    {
      stateName: STATES.CO2_CONCENTRATION,
      key: 'co2',
      category: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.PPM,
      min: 0,
      max: 10000,
    },
    {
      stateName: STATES.ELECTRIC_POWER_CONSUMPTION,
      key: 'power',
      category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
      type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
      unit: DEVICE_FEATURE_UNITS.WATT,
      min: 0,
      max: 100000,
    },
    {
      stateName: STATES.ELECTRIC_ENERGY_CONSUMPTION,
      key: 'energy',
      category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
      type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.INDEX,
      unit: DEVICE_FEATURE_UNITS.WATT_HOUR,
      min: 0,
      max: 10000000000,
    },
    {
      stateName: STATES.BATTERY_LEVEL,
      key: 'battery',
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
    },
  ];

  for (const sensor of sensorMap) {
    if (states.has(sensor.stateName) && !entries.some((e) => e.key === sensor.key)) {
      entries.push({
        key: sensor.key,
        stateName: sensor.stateName,
        gladysFeature: feature(ids, sensor.key, {
          category: sensor.category,
          type: sensor.type,
          unit: sensor.unit,
          min: sensor.min,
          max: sensor.max,
        }),
      });
    }
  }

  return entries;
}

/**
 * Convert a raw Overkiz state value to the numeric value expected by Gladys.
 * Returns null when the value cannot be mapped (and must not be published).
 *
 * @param {{ key: string, invert?: boolean }} entry feature entry from `mapDeviceFeatures`
 * @param {unknown} rawValue
 */
export function stateToGladysValue(entry, rawValue) {
  const { key, invert = true } = entry;
  if (rawValue === null || rawValue === undefined) {
    return null;
  }
  // A boost is reported either as an on/off flag or as a remaining duration in
  // days, so it cannot go through the generic numeric path below.
  if (key === 'boost') {
    return isDhwFlagActive(rawValue) ? 1 : 0;
  }
  // `core:HeatingStatusState` says `heating` on some appliances, not `on`, and
  // an unmapped string publishes nothing at all — which left "Heating" empty
  // for good. Home Assistant reads the same two words and treats anything else
  // as idle; there is no meaningful third state for "is it heating".
  if (key === 'heating') {
    if (typeof rawValue !== 'string') {
      return null;
    }
    const lowered = rawValue.trim().toLowerCase();
    return lowered === 'on' || lowered === 'heating' ? 1 : 0;
  }
  if (typeof rawValue === 'string') {
    const lowered = rawValue.toLowerCase();
    // Values of the mapped binary states only (OnOff, Contact, Occupancy,
    // Smoke, WaterDetection).
    const binaryMap = {
      on: 1,
      off: 0,
      open: 1,
      opened: 1,
      closed: 0,
      close: 0,
      detected: 1,
      notdetected: 0,
      personinside: 1,
      nopersoninside: 0,
    };
    if (lowered in binaryMap) {
      return binaryMap[lowered];
    }
    const asNumber = Number(rawValue);
    if (!Number.isNaN(asNumber)) {
      rawValue = asNumber;
    } else {
      return null;
    }
  }
  if (typeof rawValue === 'boolean') {
    return rawValue ? 1 : 0;
  }
  if (typeof rawValue !== 'number') {
    return null;
  }
  if (key === 'position') {
    if (rawValue === POSITION_MY || rawValue === POSITION_UNKNOWN) {
      return null; // a preset, not a position: stay silent rather than lie
    }
    return Math.max(0, Math.min(100, invert ? 100 - rawValue : rawValue));
  }
  return rawValue;
}

/**
 * The Overkiz date shape used by the absence commands, taken from the
 * appliance's own `core:AbsenceStartDateState`.
 *
 * `weekday` follows the Python convention Home Assistant writes (Monday = 0),
 * not JavaScript's (Sunday = 0) — the appliance appears to ignore the field,
 * but there is no reason to send a different number than the reference does.
 */
function overkizDate(date, yearOffset = 0) {
  return {
    month: date.getMonth() + 1,
    hour: date.getHours(),
    year: date.getFullYear() + yearOffset,
    weekday: (date.getDay() + 6) % 7,
    day: date.getDate(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/**
 * Commands that put the appliance into — or take it out of — its away mode.
 *
 * Two dialects. The `io` appliances carry absence as a flag of the
 * `setCurrentOperatingMode` dictionary. The `modbuslink` ones instead expect a
 * start date, an end date and the value `prog`: `setAbsenceMode('on')` alone
 * does nothing at all, which is why selecting "Away" appeared to be ignored.
 * The date sequence mirrors the Home Assistant overkiz component, except that
 * everything travels in ONE Overkiz action here — the reference has to spread
 * it over several executions and works around the resulting rate limiting.
 */
function buildWaterHeaterAwayCommands(commands, on, now) {
  if (commands.has('setCurrentOperatingMode')) {
    return [
      {
        name: 'setCurrentOperatingMode',
        parameters: [{ relaunch: 'off', absence: on ? 'on' : 'off' }],
      },
    ];
  }
  if (!commands.has('setAbsenceMode')) {
    return [];
  }
  if (!on) {
    return [{ name: 'setAbsenceMode', parameters: ['off'] }];
  }
  const commandList = [];
  const date = now();
  // The start and end dates have to agree with the appliance's own clock, so
  // the reference sets that clock first.
  if (commands.has('setDateTime')) {
    commandList.push({ name: 'setDateTime', parameters: [overkizDate(date)] });
  }
  if (commands.has('setAbsenceStartDate') && commands.has('setAbsenceEndDate')) {
    commandList.push({ name: 'setAbsenceStartDate', parameters: [overkizDate(date)] });
    // Away until further notice: a year out, cancelled by leaving the mode.
    commandList.push({ name: 'setAbsenceEndDate', parameters: [overkizDate(date, 1)] });
    commandList.push({ name: 'setAbsenceMode', parameters: ['prog'] });
    return commandList;
  }
  // No date commands: the appliance takes a plain flag.
  commandList.push({ name: 'setAbsenceMode', parameters: ['on'] });
  return commandList;
}

/**
 * Commands to reach a Gladys water heater mode.
 *
 * Away is a mode value here, not a control of its own, so selecting any OTHER
 * mode has to leave it — otherwise the appliance stays away and the mode the
 * user picked never takes effect.
 */
function buildWaterHeaterModeCommands(commands, mode, now) {
  const commandList = [];

  if (mode === WATER_HEATER_MODE.AWAY) {
    const away = buildWaterHeaterAwayCommands(commands, true, now);
    if (away.length === 0) {
      return null;
    }
    commandList.push(...away);
    pushRefresh(commandList, commands, DHW_REFRESH_ABSENCE_COMMANDS);
    return commandList;
  }

  const overkizMode = GLADYS_MODE_TO_OVERKIZ_DHW_MODE[mode];
  if (!overkizMode || !commands.has('setDHWMode')) {
    return null;
  }
  if (!commands.has('setCurrentOperatingMode')) {
    // Leave away behind; the `setCurrentOperatingMode` dialect below does it
    // as part of its own reset.
    commandList.push(...buildWaterHeaterAwayCommands(commands, false, now));
  }
  if (commands.has('setCurrentOperatingMode')) {
    commandList.push({
      name: 'setCurrentOperatingMode',
      parameters: [{ relaunch: 'off', absence: 'off' }],
    });
  }
  commandList.push({ name: 'setDHWMode', parameters: [overkizMode] });
  pushRefresh(commandList, commands, DHW_REFRESH_MODE_COMMANDS);
  // Eco and manual each carry their own setpoint, so the one Gladys displays
  // has to be asked for again; auto leaves it alone.
  if (mode !== WATER_HEATER_MODE.AUTO) {
    pushRefresh(commandList, commands, DHW_REFRESH_TEMPERATURE_COMMANDS);
  }
  return commandList;
}

/**
 * Commands to start or cancel a boost. Gladys never expires it: the appliance
 * ends the cycle on its own and reports it back.
 */
function buildWaterHeaterBoostCommands(commands, on) {
  if (commands.has('setBoostMode')) {
    const commandList = [{ name: 'setBoostMode', parameters: [on ? 'on' : 'off'] }];
    pushRefresh(commandList, commands, DHW_REFRESH_BOOST_COMMANDS);
    return commandList;
  }

  const commandList = [];
  if (on && commands.has('setBoostModeDuration')) {
    commandList.push({ name: 'setBoostModeDuration', parameters: [DHW_BOOST_DURATION_DAYS] });
  }
  if (commands.has('setCurrentOperatingMode')) {
    commandList.push({
      name: 'setCurrentOperatingMode',
      parameters: [{ relaunch: on ? 'on' : 'off', absence: 'off' }],
    });
  }
  if (commandList.length === 0) {
    return null;
  }
  pushRefresh(commandList, commands, DHW_REFRESH_BOOST_COMMANDS);
  return commandList;
}

/**
 * Build the Overkiz command(s) to run for a Gladys command on a feature.
 * Returns `{ name, parameters }`, an ORDERED list of them, or null when no
 * command applies.
 *
 * Water heaters need the list: Overkiz only reports the result of a write once
 * the matching `refreshXxx` command has been sent, and switching mode on these
 * appliances means leaving boost and absence behind first.
 *
 * @param {object} device the Overkiz device
 * @param {{ key: string, stateName: string | null }} entry feature entry from `mapDeviceFeatures`
 * @param {number} value the value Gladys asks for
 * @param {() => Date} [now] injectable clock: the away mode is written as a
 *   start and an end date, which tests must be able to pin down
 */
export function buildCommand(device, entry, value, now = () => new Date()) {
  const commands = new Set((device.definition?.commands ?? []).map((c) => c.commandName));
  const { key } = entry;

  if (key === 'mode') {
    return buildWaterHeaterModeCommands(commands, Number(value), now);
  }

  if (key === 'boost') {
    return buildWaterHeaterBoostCommands(commands, Number(value) === 1);
  }

  if (key === 'target_temperature') {
    const temperature = Number(value);
    if (!Number.isFinite(temperature)) {
      return null;
    }
    const name = DHW_SET_TEMPERATURE_COMMANDS.find((candidate) => commands.has(candidate));
    if (!name) {
      return null;
    }
    const commandList = [{ name, parameters: [temperature] }];
    // Prefer the refresh matching the command just sent, then any the device
    // does offer — they track the same setpoint on these appliances.
    pushRefresh(commandList, commands, [
      `refresh${name.slice('set'.length)}`,
      ...DHW_REFRESH_TEMPERATURE_COMMANDS,
    ]);
    return commandList;
  }

  if (key === 'position') {
    const open = Math.max(0, Math.min(100, Number(value)));
    if (!Number.isFinite(open)) {
      return null;
    }
    const closure = 100 - open;
    // Prefer the command that speaks the same language as the state we read the
    // position from, so what we write and what we read back agree.
    const preferDeployment = entry.stateName === STATES.DEPLOYMENT;
    if (preferDeployment && commands.has('setDeployment')) {
      return { name: 'setDeployment', parameters: [open] };
    }
    if (commands.has('setClosure')) {
      return { name: 'setClosure', parameters: [closure] };
    }
    if (commands.has('setDeployment')) {
      return { name: 'setDeployment', parameters: [open] };
    }
    if (commands.has('setPosition')) {
      return { name: 'setPosition', parameters: [closure] };
    }
    return null;
  }

  if (key === 'state') {
    const numeric = Number(value);
    if (numeric === 0) {
      if (commands.has('stop')) {
        return { name: 'stop', parameters: [] };
      }
      if (commands.has('my')) {
        return { name: 'my', parameters: [] };
      }
      return null;
    }
    if (numeric === 1) {
      for (const name of ['open', 'up', 'deploy']) {
        if (commands.has(name)) {
          return { name, parameters: [] };
        }
      }
      return null;
    }
    for (const name of ['close', 'down', 'undeploy']) {
      if (commands.has(name)) {
        return { name, parameters: [] };
      }
    }
    return null;
  }

  if (key === 'binary') {
    const name = Number(value) === 1 ? 'on' : 'off';
    return commands.has(name) ? { name, parameters: [] } : null;
  }

  if (key === 'brightness') {
    return commands.has('setIntensity')
      ? { name: 'setIntensity', parameters: [Number(value)] }
      : null;
  }

  return null;
}

/**
 * Build the Gladys discovery payload for an Overkiz device.
 * Returns null when the device maps to no feature.
 */
export function buildDiscoveredDevice(gladys, device) {
  const platformId = platformIdFromDeviceUrl(device.deviceURL);
  const ids = gladys.externalIds('overkiz', platformId);
  const entries = mapDeviceFeatures(device, ids);
  if (entries.length === 0) {
    return null;
  }
  return {
    device: {
      name: device.label?.slice(0, 60) || 'Overkiz device',
      external_id: ids.device,
      model: [device.definition?.widgetName, device.controllableName]
        .filter(Boolean)
        .join(' - ')
        .slice(0, 255),
      should_poll: false,
      features: entries.map((e) => e.gladysFeature),
      params: [{ name: 'DEVICE_URL', value: device.deviceURL }],
    },
    entries,
  };
}
