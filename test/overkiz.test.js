// -----------------------------------------------------------------------------
// Overkiz client wrapper: connection lifecycle and cleanup, driven through an
// injected fake `overkiz-client`.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Overkiz } from '../src/overkiz.js';

function makeFakeClient({ getDevicesError = null, devices = {} } = {}) {
  const calls = { getDevices: 0, removeAllListeners: 0, refreshPeriods: [], pollingPeriods: [] };
  return {
    calls,
    devices,
    listeners: {},
    on(event, cb) {
      this.listeners[event] = cb;
    },
    removeAllListeners() {
      calls.removeAllListeners += 1;
    },
    async getDevices() {
      calls.getDevices += 1;
      if (getDevicesError) {
        throw getDevicesError;
      }
      return Object.values(devices);
    },
    setRefreshTaskPeriod(p) {
      calls.refreshPeriods.push(p);
    },
    setPollingTaskPeriod(p) {
      calls.pollingPeriods.push(p);
    },
  };
}

function makeFakeDevice(deviceURL) {
  return {
    deviceURL,
    listeners: {},
    on(event, cb) {
      this.listeners[event] = cb;
    },
    removeAllListeners(event) {
      delete this.listeners[event];
    },
  };
}

const CONFIG = { server: 'somfy_europe', username: 'a@b.c', password: 'x', polling_period: 30 };

test('a successful start reports connected and returns the devices', async () => {
  const device = makeFakeDevice('io://1/1');
  const client = makeFakeClient({ devices: { 'io://1/1': device } });
  const overkiz = new Overkiz({ createClient: () => client });

  const devices = await overkiz.start(CONFIG);

  assert.equal(overkiz.connected, true);
  assert.deepEqual(devices, [device]);
  assert.equal(typeof device.listeners.states, 'function', 'state updates are subscribed to');
});

test('a failed start leaves the wrapper disconnected', async () => {
  // The regression this guards: `connected` used to be true after a failure,
  // which made "Test the connection" answer "Connection OK".
  const client = makeFakeClient({ getDevicesError: 'Error 401 Bad credentials' });
  const overkiz = new Overkiz({ createClient: () => client });

  await assert.rejects(() => overkiz.start(CONFIG), /401/);

  assert.equal(overkiz.connected, false);
  assert.equal(client.calls.removeAllListeners, 1, 'the half-started client was torn down');
  assert.deepEqual(client.calls.pollingPeriods, [0], 'its polling timers were stopped');
});

test('restarting drops the previous client and its listeners', async () => {
  const device = makeFakeDevice('io://1/1');
  const first = makeFakeClient({ devices: { 'io://1/1': device } });
  const second = makeFakeClient({ devices: { 'io://1/1': makeFakeDevice('io://1/1') } });
  const clients = [first, second];
  const overkiz = new Overkiz({ createClient: () => clients.shift() });

  await overkiz.start(CONFIG);
  await overkiz.start(CONFIG);

  assert.equal(first.calls.removeAllListeners, 1);
  assert.equal(device.listeners.states, undefined, 'old device listeners are removed');
  assert.equal(overkiz.connected, true);
});

test('state updates are forwarded to onStates', async () => {
  const device = makeFakeDevice('io://1/1');
  const client = makeFakeClient({ devices: { 'io://1/1': device } });
  const overkiz = new Overkiz({ createClient: () => client });
  const received = [];
  overkiz.onStates = (dev, states) => received.push({ dev, states });

  await overkiz.start(CONFIG);
  device.listeners.states([{ name: 'core:OnOffState', value: 'on' }]);

  assert.equal(received.length, 1);
  assert.equal(received[0].dev, device);
});

test('connection changes are forwarded to onConnectionChange', async () => {
  const client = makeFakeClient();
  const overkiz = new Overkiz({ createClient: () => client });
  const changes = [];
  overkiz.onConnectionChange = (connected) => changes.push(connected);

  await overkiz.start(CONFIG);
  client.listeners.connect();
  client.listeners.disconnect();

  assert.deepEqual(changes, [true, false]);
});

test('commands and refreshes are refused while disconnected', async () => {
  const overkiz = new Overkiz({ createClient: () => makeFakeClient() });

  await assert.rejects(() => overkiz.refreshDevices(), /not connected/);
  await assert.rejects(
    () => overkiz.execute('io://1/1', { name: 'on', parameters: [] }),
    /not connected/,
  );
});

test('stop is idempotent and clears the device map', async () => {
  const client = makeFakeClient({ devices: { 'io://1/1': makeFakeDevice('io://1/1') } });
  const overkiz = new Overkiz({ createClient: () => client });
  await overkiz.start(CONFIG);

  overkiz.stop();
  overkiz.stop();

  assert.equal(overkiz.connected, false);
  assert.equal(overkiz.getDevice('io://1/1'), null);
  assert.equal(client.calls.removeAllListeners, 1, 'the second stop is a no-op');
});

test('execute accepts a single command or an ordered list', async () => {
  const executions = [];
  const client = makeFakeClient();
  client.execute = async (label, execution) => executions.push({ label, execution });
  const overkiz = new Overkiz({ createClient: () => client });
  await overkiz.start(CONFIG);

  await overkiz.execute('io://1/1', { name: 'on', parameters: [] });
  assert.deepEqual(
    executions[0].execution.actions[0].commands.map((c) => [c.name, c.parameters]),
    [['on', []]],
  );

  // Water heaters need `setXxx` then `refreshXxx`, and a single action is what
  // guarantees Overkiz runs them in that order.
  await overkiz.execute('io://1/1', [
    { name: 'setTargetTemperature', parameters: [58] },
    { name: 'refreshTargetTemperature', parameters: [] },
  ]);
  const { actions } = executions[1].execution;
  assert.equal(actions.length, 1, 'one action, not one per command');
  assert.deepEqual(
    actions[0].commands.map((c) => [c.name, c.parameters]),
    [
      ['setTargetTemperature', [58]],
      ['refreshTargetTemperature', []],
    ],
  );
});

test('the account logger is used, and handed to overkiz-client itself', async () => {
  // Three sessions write to one log: a line that does not say which account it
  // belongs to is unusable when a user pastes it in a bug report — and
  // `overkiz-client` writes its own warnings and errors through this logger.
  const lines = [];
  const logger = {
    debug: (line) => lines.push(`debug ${line}`),
    info: (line) => lines.push(`info ${line}`),
    warn: (line) => lines.push(`warn ${line}`),
    error: (line) => lines.push(`error ${line}`),
  };
  const client = makeFakeClient({ devices: { 'io://1/1': makeFakeDevice('io://1/1') } });
  let clientLogger = null;
  const overkiz = new Overkiz({
    logger,
    createClient: (config, injected) => {
      clientLogger = injected;
      return client;
    },
  });

  await overkiz.start(CONFIG);

  assert.equal(clientLogger, logger, 'overkiz-client logs through the account logger');
  assert.deepEqual(lines, ['info Fetched 1 Overkiz devices']);
});

test('the link going up or down is reported once, by the account', async () => {
  const client = makeFakeClient();
  const lines = [];
  const overkiz = new Overkiz({
    createClient: () => client,
    logger: {
      debug: (line) => lines.push(line),
      info: (line) => lines.push(line),
      warn: (line) => lines.push(line),
      error: (line) => lines.push(line),
    },
  });
  const changes = [];
  overkiz.onConnectionChange = (connected) => changes.push(connected);

  await overkiz.start(CONFIG);
  client.listeners.connect();
  client.listeners.disconnect();

  assert.deepEqual(changes, [true, false]);
  assert.deepEqual(
    lines.filter((line) => /connected/i.test(line)),
    [],
    'the wrapper does not log the transition its owner already logs',
  );
});
