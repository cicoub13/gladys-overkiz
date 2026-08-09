import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  platformIdFromDeviceUrl,
  mapDeviceFeatures,
  stateToGladysValue,
  buildCommand,
  buildDiscoveredDevice,
} from '../src/mapping.js';
import { makeExternalIds, makeOverkizDevice as makeDevice } from './helpers.js';

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

test('an RTS garage door (single cycle command) still maps to a state feature', () => {
  // RTS garage door openers expose one toggle command, like the lone button
  // of their physical remote — no separate open/close commands.
  const device = makeDevice({
    uiClass: 'GarageDoor',
    commands: ['cycle'],
    states: { 'core:ClosureState': 100 },
  });
  const ids = fakeGladys.externalIds('overkiz', 'x');
  const entries = mapDeviceFeatures(device, ids);
  const keys = entries.map((e) => e.key).sort();
  assert.deepEqual(keys, ['position', 'state']);
});

test('buildCommand maps open and close to the same cycle command for RTS garage doors', () => {
  const device = makeDevice({ uiClass: 'GarageDoor', commands: ['cycle'] });
  assert.deepEqual(buildCommand(device, { key: 'state' }, 1), { name: 'cycle', parameters: [] });
  assert.deepEqual(buildCommand(device, { key: 'state' }, -1), { name: 'cycle', parameters: [] });
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
