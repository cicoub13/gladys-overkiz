import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  platformIdFromDeviceUrl,
  mapDeviceFeatures,
  stateToGladysValue,
  buildCommand,
  buildDiscoveredDevice,
  WATER_HEATER_CATEGORY,
  WATER_HEATER_TYPES,
  WATER_HEATER_MODE,
} from '../src/mapping.js';
import { makeExternalIds, makeOverkizDevice as makeDevice, makeWaterHeater } from './helpers.js';

const fakeGladys = { externalIds: makeExternalIds };

test('platformIdFromDeviceUrl builds a stable safe id', () => {
  assert.equal(
    platformIdFromDeviceUrl('io://1234-5678-9012/12345678'),
    'io-1234-5678-9012-12345678',
  );
});

test('a roller shutter maps to position and state features', () => {
  const device = makeDevice({
    uiClass: 'RollerShutter',
    commands: ['open', 'close', 'stop', 'setClosure'],
    states: { 'core:ClosureState': 30 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const entries = mapDeviceFeatures(device, ids);
  const keys = entries.map((e) => e.key).sort();
  assert.deepEqual(keys, ['position', 'state']);
  const position = entries.find((e) => e.key === 'position');
  assert.equal(position.gladysFeature.read_only, false);
});

test('a temperature sensor maps to a temperature feature', () => {
  const device = makeDevice({
    uiClass: 'TemperatureSensor',
    states: { 'core:TemperatureState': 21.5 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const entries = mapDeviceFeatures(device, ids);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, 'temperature');
  assert.equal(entries[0].gladysFeature.read_only, true);
});

test('a pod is ignored', () => {
  const device = makeDevice({ uiClass: 'Pod', states: { 'core:BatteryLevelState': 50 } });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  assert.deepEqual(mapDeviceFeatures(device, ids), []);
});

const CLOSURE_POSITION = { key: 'position', stateName: 'core:ClosureState', invert: true };
const DEPLOYMENT_POSITION = { key: 'position', stateName: 'core:DeploymentState', invert: false };

test('stateToGladysValue inverts the closure into a Gladys position', () => {
  assert.equal(stateToGladysValue(CLOSURE_POSITION, 100), 0);
  assert.equal(stateToGladysValue(CLOSURE_POSITION, 0), 100);
  assert.equal(stateToGladysValue(CLOSURE_POSITION, 30), 70);
});

test('stateToGladysValue does NOT invert a deployment: 100 = fully deployed = open', () => {
  assert.equal(stateToGladysValue(DEPLOYMENT_POSITION, 100), 100);
  assert.equal(stateToGladysValue(DEPLOYMENT_POSITION, 0), 0);
  assert.equal(stateToGladysValue(DEPLOYMENT_POSITION, 70), 70);
});

test('stateToGladysValue drops the "my" and "unknown" position presets', () => {
  // 108 would otherwise clamp to 0 and be recorded as "fully closed".
  assert.equal(stateToGladysValue(CLOSURE_POSITION, 108), null);
  assert.equal(stateToGladysValue(CLOSURE_POSITION, 124), null);
  assert.equal(stateToGladysValue(DEPLOYMENT_POSITION, 108), null);
});

test('stateToGladysValue maps string states to binary values', () => {
  assert.equal(stateToGladysValue({ key: 'binary' }, 'on'), 1);
  assert.equal(stateToGladysValue({ key: 'binary' }, 'off'), 0);
  assert.equal(stateToGladysValue({ key: 'contact' }, 'open'), 1);
  assert.equal(stateToGladysValue({ key: 'contact' }, 'closed'), 0);
  assert.equal(stateToGladysValue({ key: 'occupancy' }, 'personInside'), 1);
  assert.equal(stateToGladysValue({ key: 'occupancy' }, 'noPersonInside'), 0);
});

test('stateToGladysValue returns null for values it cannot map', () => {
  assert.equal(stateToGladysValue({ key: 'temperature' }, null), null);
  assert.equal(stateToGladysValue({ key: 'temperature' }, undefined), null);
  assert.equal(stateToGladysValue({ key: 'temperature' }, 'unavailable'), null);
  assert.equal(stateToGladysValue({ key: 'temperature' }, { some: 'object' }), null);
  assert.equal(stateToGladysValue({ key: 'temperature' }, '21.5'), 21.5);
});

test('buildCommand translates the Gladys position to an Overkiz closure', () => {
  const device = makeDevice({ uiClass: 'RollerShutter', commands: ['setClosure'] });
  assert.deepEqual(buildCommand(device, CLOSURE_POSITION, 70), {
    name: 'setClosure',
    parameters: [30],
  });
});

test('buildCommand writes a deployment without inverting it', () => {
  const device = makeDevice({ uiClass: 'Awning', commands: ['setDeployment'] });
  assert.deepEqual(buildCommand(device, DEPLOYMENT_POSITION, 70), {
    name: 'setDeployment',
    parameters: [70],
  });
});

test('an awning reads back exactly the position it was commanded', () => {
  // The regression this guards: commanding 70 % used to report 30 % back.
  const device = makeDevice({
    uiClass: 'Awning',
    commands: ['setDeployment', 'deploy', 'undeploy', 'stop'],
    states: { 'core:DeploymentState': 0 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const entry = mapDeviceFeatures(device, ids).find((e) => e.key === 'position');

  const command = buildCommand(device, entry, 70);
  assert.deepEqual(command, { name: 'setDeployment', parameters: [70] });
  // The hub echoes back the deployment it just applied.
  assert.equal(stateToGladysValue(entry, command.parameters[0]), 70);
});

test('buildCommand prefers the command matching the state it reads', () => {
  const device = makeDevice({
    uiClass: 'Awning',
    commands: ['setClosure', 'setDeployment'],
  });
  assert.deepEqual(buildCommand(device, DEPLOYMENT_POSITION, 70), {
    name: 'setDeployment',
    parameters: [70],
  });
  assert.deepEqual(buildCommand(device, CLOSURE_POSITION, 70), {
    name: 'setClosure',
    parameters: [30],
  });
});

test('buildCommand maps the shutter state to open/close/stop', () => {
  const device = makeDevice({ uiClass: 'RollerShutter', commands: ['open', 'close', 'stop'] });
  assert.deepEqual(buildCommand(device, { key: 'state' }, 1), { name: 'open', parameters: [] });
  assert.deepEqual(buildCommand(device, { key: 'state' }, -1), { name: 'close', parameters: [] });
  assert.deepEqual(buildCommand(device, { key: 'state' }, 0), { name: 'stop', parameters: [] });
});

test('buildCommand maps binary values to on/off', () => {
  const device = makeDevice({ uiClass: 'OnOff', commands: ['on', 'off'] });
  assert.deepEqual(buildCommand(device, { key: 'binary' }, 1), { name: 'on', parameters: [] });
  assert.deepEqual(buildCommand(device, { key: 'binary' }, 0), { name: 'off', parameters: [] });
});

test('buildCommand returns null when the device supports no matching command', () => {
  const readOnly = makeDevice({ uiClass: 'RollerShutter', commands: [] });
  assert.equal(buildCommand(readOnly, CLOSURE_POSITION, 70), null);
  assert.equal(buildCommand(readOnly, { key: 'state' }, 1), null);
  assert.equal(buildCommand(readOnly, { key: 'binary' }, 1), null);
  assert.equal(buildCommand(readOnly, { key: 'brightness' }, 50), null);
  assert.equal(buildCommand(readOnly, { key: 'temperature' }, 20), null);
});

test('an awning maps its position to the deployment state', () => {
  const device = makeDevice({
    uiClass: 'Awning',
    commands: ['deploy', 'undeploy', 'setDeployment'],
    states: { 'core:DeploymentState': 40 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const position = mapDeviceFeatures(device, ids).find((e) => e.key === 'position');
  assert.equal(position.stateName, 'core:DeploymentState');
  assert.equal(position.invert, false);
});

test('a roller shutter keeps the inverted closure convention', () => {
  const device = makeDevice({
    uiClass: 'RollerShutter',
    commands: ['setClosure'],
    states: { 'core:ClosureState': 40 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const position = mapDeviceFeatures(device, ids).find((e) => e.key === 'position');
  assert.equal(position.stateName, 'core:ClosureState');
  assert.equal(position.invert, true);
});

test('feature names are readable and do not repeat the device label', () => {
  // Gladys shows features under their device: prefixing produced names like
  // "Test device co2" — untranslated, technical and unbounded in length.
  const device = makeDevice({
    uiClass: 'OnOff',
    label: 'A very long device label that would blow past any name limit',
    commands: ['on', 'off'],
    states: { 'core:OnOffState': 'on', 'core:ElectricPowerConsumptionState': 120 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const names = mapDeviceFeatures(device, ids).map((e) => e.gladysFeature.name);

  assert.deepEqual(names, ['On/Off', 'Power']);
  for (const name of names) {
    assert.ok(!name.includes(device.label), 'the device label is not repeated');
    assert.ok(name.length <= 60);
  }
});

test('the write-only shutter state declares no feedback', () => {
  const device = makeDevice({ uiClass: 'RollerShutter', commands: ['open', 'close', 'stop'] });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const state = mapDeviceFeatures(device, ids).find((e) => e.key === 'state');

  assert.equal(state.stateName, null);
  assert.equal(state.gladysFeature.has_feedback, false, 'nothing will ever echo back');
});

test('buildDiscoveredDevice returns null for unsupported devices', () => {
  const device = makeDevice({ uiClass: 'ProtocolGateway' });
  assert.equal(buildDiscoveredDevice(fakeGladys, device), null);
});

test('buildDiscoveredDevice builds a full discovery payload', () => {
  const device = makeDevice({
    uiClass: 'Light',
    commands: ['on', 'off', 'setIntensity'],
    states: { 'core:OnOffState': 'on', 'core:LightIntensityState': 80 },
  });
  const mapped = buildDiscoveredDevice(fakeGladys, device);
  assert.ok(mapped);
  assert.equal(mapped.device.name, 'Test device');
  assert.equal(mapped.device.features.length, 2);
  assert.deepEqual(mapped.device.params, [
    { name: 'DEVICE_URL', value: 'io://1234-5678-9012/12345678' },
  ]);
});

// --- Water heaters -----------------------------------------------------------

test('the water-heater constants match the Gladys taxonomy', () => {
  // Not exported by the SDK yet (absent from 0.10.0), so nothing else would
  // catch a typo before Gladys rejects the whole discovery with a 400.
  assert.equal(WATER_HEATER_CATEGORY, 'water-heater');
  assert.deepEqual(WATER_HEATER_TYPES, {
    BINARY: 'binary',
    MODE: 'mode',
    TARGET_TEMPERATURE: 'target-temperature',
    REMAINING_HOT_WATER: 'remaining-hot-water',
    HEATING: 'heating',
    BOOST: 'boost',
  });
  assert.deepEqual(WATER_HEATER_MODE, {
    OFF: 0,
    AUTO: 1,
    ECO: 2,
    BOOST: 3,
    MANUAL: 4,
    AWAY: 5,
    PROGRAM: 6,
  });
});

test('an Atlantic water heater maps to the water-heater category', () => {
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const entries = mapDeviceFeatures(makeWaterHeater(), ids);

  assert.deepEqual(
    entries.map((e) => e.key),
    ['mode', 'boost', 'target_temperature', 'remaining_hot_water', 'heating', 'water_temperature'],
  );

  const byKey = Object.fromEntries(entries.map((e) => [e.key, e.gladysFeature]));
  assert.equal(byKey.mode.category, 'water-heater');
  assert.equal(byKey.mode.type, 'mode');
  assert.equal(byKey.boost.type, 'boost');
  assert.equal(byKey.heating.type, 'heating');
  assert.equal(byKey.remaining_hot_water.type, 'remaining-hot-water');
  assert.equal(byKey.target_temperature.type, 'target-temperature');

  // The water temperature is a temperature measurement like any other, so it
  // stays out of the water-heater category (Gladys taxonomy rule).
  assert.equal(byKey.water_temperature.category, 'temperature-sensor');
  assert.equal(byKey.water_temperature.type, 'decimal');

  // Commands answer slowly: the appliance's own report is what Gladys trusts.
  for (const key of ['mode', 'boost', 'target_temperature']) {
    assert.equal(byKey[key].read_only, false);
    assert.equal(byKey[key].has_feedback, true);
  }
  assert.equal(byKey.heating.read_only, true);
  assert.equal(byKey.remaining_hot_water.read_only, true);
});

test('the mode declares only the modes the appliance can actually reach', () => {
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const mode = mapDeviceFeatures(makeWaterHeater(), ids).find((e) => e.key === 'mode');

  assert.deepEqual(mode.gladysFeature.supported_options, [
    { value: 2, label: 'Eco', sort_order: 0 },
    { value: 4, label: 'Manual', sort_order: 1 },
    { value: 1, label: 'Auto', sort_order: 2 },
    { value: 5, label: 'Away', sort_order: 3 },
  ]);
  // BOOST is deliberately absent: this appliance reports its boost as a
  // duration of its own, and one function must never get two controls.
  assert.ok(!mode.gladysFeature.supported_options.some((o) => o.value === 3));
  assert.equal(mode.gladysFeature.min, 0);
  assert.equal(mode.gladysFeature.max, 6, 'the enum is published whole');
});

test('a water heater with no mode command publishes a read-only mode', () => {
  const device = makeWaterHeater({ commands: [] });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const mode = mapDeviceFeatures(device, ids).find((e) => e.key === 'mode');

  assert.equal(mode.gladysFeature.read_only, true);
  assert.equal(mode.gladysFeature.supported_options, undefined);
});

test('the setpoint takes its range from the appliance, then from the defaults', () => {
  const ids = fakeGladys.externalIds('overkiz', 'x');

  const reported = mapDeviceFeatures(makeWaterHeater(), ids).find(
    (e) => e.key === 'target_temperature',
  );
  assert.equal(reported.gladysFeature.min, 50);
  assert.equal(reported.gladysFeature.max, 62);
  assert.equal(reported.gladysFeature.unit, 'celsius');

  const silent = makeWaterHeater({
    states: { 'core:TargetDHWTemperatureState': 55 },
    commands: ['setTargetDHWTemperature'],
  });
  const fallback = mapDeviceFeatures(silent, ids).find((e) => e.key === 'target_temperature');
  assert.equal(fallback.stateName, 'core:TargetDHWTemperatureState');
  assert.equal(fallback.gladysFeature.min, 50);
  assert.equal(fallback.gladysFeature.max, 62);
});

test('remaining hot water falls back to the V40 volume in litres', () => {
  const ids = fakeGladys.externalIds('overkiz', 'x');

  const percent = mapDeviceFeatures(makeWaterHeater(), ids).find(
    (e) => e.key === 'remaining_hot_water',
  );
  assert.equal(percent.gladysFeature.unit, 'percent');
  assert.equal(percent.gladysFeature.max, 100);

  const litres = makeWaterHeater({
    commands: [],
    states: {
      'core:V40WaterVolumeEstimationState': 180,
      'io:DHWCapacityState': 270,
    },
  });
  const volume = mapDeviceFeatures(litres, ids).find((e) => e.key === 'remaining_hot_water');
  assert.equal(volume.stateName, 'core:V40WaterVolumeEstimationState');
  assert.equal(volume.gladysFeature.unit, 'liter');
  assert.equal(volume.gladysFeature.max, 270, 'max carries the tank V40 capacity');

  const noCapacity = makeWaterHeater({
    commands: [],
    states: { 'core:V40WaterVolumeEstimationState': 180 },
  });
  const defaulted = mapDeviceFeatures(noCapacity, ids).find((e) => e.key === 'remaining_hot_water');
  assert.equal(defaulted.gladysFeature.max, 300);
});

test('the mode is derived from the DHW mode and the absence flag together', () => {
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const mode = mapDeviceFeatures(makeWaterHeater(), ids).find((e) => e.key === 'mode');

  assert.equal(mode.stateName, null, 'no single state feeds it');
  assert.deepEqual(mode.watchedStates, ['io:DHWModeState', 'io:AwayModeDurationState']);

  const derive = (states) => mode.derive(makeWaterHeater({ states }));
  assert.equal(derive({ 'io:DHWModeState': 'manualEcoActive' }), 2, 'eco');
  assert.equal(derive({ 'io:DHWModeState': 'manualEcoInactive' }), 4, 'manual');
  assert.equal(derive({ 'io:DHWModeState': 'autoMode' }), 1, 'auto');

  // Absence is a flag of its own and wins over the DHW mode, exactly as the
  // appliance presents it. It is reported as a duration in days, or `always`.
  assert.equal(derive({ 'io:DHWModeState': 'autoMode', 'io:AwayModeDurationState': '3' }), 5);
  assert.equal(derive({ 'io:DHWModeState': 'autoMode', 'io:AwayModeDurationState': 'always' }), 5);
  assert.equal(derive({ 'io:DHWModeState': 'autoMode', 'io:AwayModeDurationState': '0' }), 1);

  // Rather than publish a mode the appliance is not in.
  assert.equal(derive({ 'io:DHWModeState': 'someVendorMode' }), null);
  assert.equal(derive({}), null);
});

test('stateToGladysValue reads a boost from its remaining duration', () => {
  const boost = { key: 'boost' };
  assert.equal(stateToGladysValue(boost, 7), 1);
  assert.equal(stateToGladysValue(boost, 0), 0);
  assert.equal(stateToGladysValue(boost, 'on'), 1);
  assert.equal(stateToGladysValue(boost, 'off'), 0);
  // `prog` means scheduled, not running right now.
  assert.equal(stateToGladysValue(boost, 'prog'), 0);
  assert.equal(stateToGladysValue(boost, null), null, 'an absent state publishes nothing');
});

test('buildCommand selects a mode after clearing boost and absence', () => {
  const device = makeWaterHeater();
  const mode = { key: 'mode' };
  const reset = {
    name: 'setCurrentOperatingMode',
    parameters: [{ relaunch: 'off', absence: 'off' }],
  };

  assert.deepEqual(buildCommand(device, mode, 2), [
    reset,
    { name: 'setDHWMode', parameters: ['manualEcoActive'] },
    // Eco carries its own setpoint, so the one Gladys shows must be re-read.
    { name: 'refreshTargetTemperature', parameters: [] },
  ]);
  assert.deepEqual(buildCommand(device, mode, 4), [
    reset,
    { name: 'setDHWMode', parameters: ['manualEcoInactive'] },
    { name: 'refreshTargetTemperature', parameters: [] },
  ]);
  assert.deepEqual(buildCommand(device, mode, 1), [
    reset,
    { name: 'setDHWMode', parameters: ['autoMode'] },
  ]);
  assert.deepEqual(buildCommand(device, mode, 5), [
    { name: 'setCurrentOperatingMode', parameters: [{ relaunch: 'off', absence: 'on' }] },
    { name: 'refreshAwayModeDuration', parameters: [] },
  ]);
});

test('buildCommand starts and cancels a boost', () => {
  const device = makeWaterHeater();
  const boost = { key: 'boost' };

  assert.deepEqual(buildCommand(device, boost, 1), [
    { name: 'setBoostModeDuration', parameters: [7] },
    { name: 'setCurrentOperatingMode', parameters: [{ relaunch: 'on', absence: 'off' }] },
    { name: 'refreshBoostModeDuration', parameters: [] },
  ]);
  // Cancelling does not re-arm the duration.
  assert.deepEqual(buildCommand(device, boost, 0), [
    { name: 'setCurrentOperatingMode', parameters: [{ relaunch: 'off', absence: 'off' }] },
    { name: 'refreshBoostModeDuration', parameters: [] },
  ]);

  const withBoostMode = makeWaterHeater({ commands: ['setBoostMode', 'refreshBoostMode'] });
  assert.deepEqual(buildCommand(withBoostMode, boost, 1), [
    { name: 'setBoostMode', parameters: ['on'] },
    { name: 'refreshBoostMode', parameters: [] },
  ]);
});

test('buildCommand writes the setpoint and asks for it back', () => {
  const device = makeWaterHeater();
  assert.deepEqual(buildCommand(device, { key: 'target_temperature' }, 58), [
    { name: 'setTargetTemperature', parameters: [58] },
    { name: 'refreshTargetTemperature', parameters: [] },
  ]);
});

test('a refresh is only sent when the appliance declares it', () => {
  // Overkiz rejects the WHOLE action when one of its commands is unknown to
  // the device, so an undeclared refresh would break the write it follows.
  const device = makeWaterHeater({
    commands: ['setDHWMode', 'setTargetTemperature', 'setCurrentOperatingMode'],
  });
  assert.deepEqual(buildCommand(device, { key: 'target_temperature' }, 58), [
    { name: 'setTargetTemperature', parameters: [58] },
  ]);
  assert.deepEqual(buildCommand(device, { key: 'mode' }, 5), [
    { name: 'setCurrentOperatingMode', parameters: [{ relaunch: 'off', absence: 'on' }] },
  ]);
});

test('buildCommand falls back to the standalone absence command', () => {
  const device = makeWaterHeater({ commands: ['setAbsenceMode'] });
  assert.deepEqual(buildCommand(device, { key: 'mode' }, 5), [
    { name: 'setAbsenceMode', parameters: ['on'] },
  ]);
});

test('buildCommand returns null for a water heater command the appliance lacks', () => {
  const readOnly = makeWaterHeater({ commands: [] });
  assert.equal(buildCommand(readOnly, { key: 'mode' }, 2), null);
  assert.equal(buildCommand(readOnly, { key: 'mode' }, 5), null);
  assert.equal(buildCommand(readOnly, { key: 'boost' }, 1), null);
  assert.equal(buildCommand(readOnly, { key: 'target_temperature' }, 58), null);
  // A mode the appliance has no `setDHWMode` value for.
  const full = makeWaterHeater();
  assert.equal(buildCommand(full, { key: 'mode' }, 6), null, 'program is not reachable');
  assert.equal(buildCommand(full, { key: 'target_temperature' }, 'hot'), null);
});

test('a sensor-only water heater exposes only what it reports', () => {
  const device = makeWaterHeater({
    commands: [],
    states: { 'io:MiddleWaterTemperatureState': 51 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const entries = mapDeviceFeatures(device, ids);

  assert.deepEqual(
    entries.map((e) => e.key),
    ['water_temperature'],
  );
  assert.equal(entries[0].gladysFeature.read_only, true);
});

test('a water heater still maps the energy it reports', () => {
  // The branch deliberately falls through to the sensor table.
  const device = makeWaterHeater({
    commands: [],
    states: {
      'io:MiddleWaterTemperatureState': 51,
      'core:ElectricEnergyConsumptionState': 12345,
    },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const keys = mapDeviceFeatures(device, ids).map((e) => e.key);

  assert.deepEqual(keys, ['water_temperature', 'energy']);
});

test('buildDiscoveredDevice publishes a water heater with its supported options', () => {
  const mapped = buildDiscoveredDevice(fakeGladys, makeWaterHeater());
  assert.ok(mapped);
  assert.equal(mapped.device.name, 'Water heater');
  const mode = mapped.device.features.find((f) => f.type === 'mode');
  assert.equal(mode.category, 'water-heater');
  assert.equal(mode.supported_options.length, 4);
});

test('the setpoint bounds ignore a state reported as null', () => {
  // `Number(null)` is 0, which would otherwise become a bound of its own and
  // let the user ask for 0 °C.
  const device = makeWaterHeater({
    commands: ['setTargetTemperature'],
    states: {
      'core:TargetTemperatureState': 54,
      'core:MinimalTemperatureManualModeState': null,
      'modbuslink:MaximalTemperatureManualModeState': 65,
    },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const setpoint = mapDeviceFeatures(device, ids).find((e) => e.key === 'target_temperature');

  assert.equal(setpoint.gladysFeature.min, 50, 'falls back rather than to 0');
  assert.equal(setpoint.gladysFeature.max, 65, 'the modbuslink variant is read too');
});
