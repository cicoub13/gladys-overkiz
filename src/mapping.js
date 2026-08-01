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
 * Build the Gladys features of an Overkiz device.
 *
 * Returns a list of `{ gladysFeature, stateName, key }` entries: `stateName`
 * is the Overkiz state that feeds the feature (null for write-only features),
 * and `key` identifies the feature for command routing in `buildCommand`.
 */
export function mapDeviceFeatures(device, ids) {
  const entries = [];
  const uiClass = device.definition?.uiClass;
  const commands = new Set((device.definition?.commands ?? []).map((c) => c.commandName));
  const states = new Set((device.states ?? []).map((s) => s.name));

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
 * Build the Overkiz command to run for a Gladys command on a feature.
 * Returns `{ name, parameters }` or null when no command applies.
 *
 * @param {object} device the Overkiz device
 * @param {{ key: string, stateName: string | null }} entry feature entry from `mapDeviceFeatures`
 * @param {number} value the value Gladys asks for
 */
export function buildCommand(device, entry, value) {
  const commands = new Set((device.definition?.commands ?? []).map((c) => c.commandName));
  const { key } = entry;

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
