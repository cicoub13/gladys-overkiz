import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  platformIdFromDeviceUrl,
  mapDeviceFeatures,
  stateToGladysValue,
  buildCommand,
  buildDiscoveredDevice,
} from '../src/mapping.js';

const fakeGladys = {
  externalIds(type, platformId) {
    return {
      device: `overkiz:${type}:${platformId}`,
      feature: (key) => `overkiz:${type}:${platformId}:${key}`,
    };
  },
};

function makeDevice({ uiClass, widgetName = 'Widget', commands = [], states = {} }) {
  return {
    deviceURL: 'io://1234-5678-9012/12345678',
    label: 'Test device',
    controllableName: 'io:RollerShutterGenericIOComponent',
    definition: {
      uiClass,
      widgetName,
      commands: commands.map((commandName) => ({ commandName })),
    },
    states: Object.entries(states).map(([name, value]) => ({ name, value })),
    get(stateName) {
      return this.states.find((s) => s.name === stateName)?.value ?? null;
    },
  };
}

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

test('stateToGladysValue inverts the closure into a Gladys position', () => {
  assert.equal(stateToGladysValue('core:ClosureState', 'position', 100), 0);
  assert.equal(stateToGladysValue('core:ClosureState', 'position', 0), 100);
  assert.equal(stateToGladysValue('core:ClosureState', 'position', 30), 70);
});

test('stateToGladysValue maps string states to binary values', () => {
  assert.equal(stateToGladysValue('core:OnOffState', 'binary', 'on'), 1);
  assert.equal(stateToGladysValue('core:OnOffState', 'binary', 'off'), 0);
  assert.equal(stateToGladysValue('core:ContactState', 'contact', 'open'), 1);
  assert.equal(stateToGladysValue('core:ContactState', 'contact', 'closed'), 0);
  assert.equal(stateToGladysValue('core:OccupancyState', 'occupancy', 'personInside'), 1);
  assert.equal(stateToGladysValue('core:OccupancyState', 'occupancy', 'noPersonInside'), 0);
});

test('buildCommand translates the Gladys position to an Overkiz closure', () => {
  const device = makeDevice({ uiClass: 'RollerShutter', commands: ['setClosure'] });
  assert.deepEqual(buildCommand(device, 'position', 70), {
    name: 'setClosure',
    parameters: [30],
  });
});

test('buildCommand maps the shutter state to open/close/stop', () => {
  const device = makeDevice({ uiClass: 'RollerShutter', commands: ['open', 'close', 'stop'] });
  assert.deepEqual(buildCommand(device, 'state', 1), { name: 'open', parameters: [] });
  assert.deepEqual(buildCommand(device, 'state', -1), { name: 'close', parameters: [] });
  assert.deepEqual(buildCommand(device, 'state', 0), { name: 'stop', parameters: [] });
});

test('buildCommand maps binary values to on/off', () => {
  const device = makeDevice({ uiClass: 'OnOff', commands: ['on', 'off'] });
  assert.deepEqual(buildCommand(device, 'binary', 1), { name: 'on', parameters: [] });
  assert.deepEqual(buildCommand(device, 'binary', 0), { name: 'off', parameters: [] });
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
