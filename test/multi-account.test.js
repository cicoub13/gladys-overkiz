// -----------------------------------------------------------------------------
// Several Overkiz accounts running side by side.
//
// The scenario throughout is the one that motivated the feature: a Somfy hub
// for the covers, and a Cozytouch account for an Atlantic/Thermor water heater.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createHandlers } from '../src/handlers.js';
import {
  makeFakeGladys,
  makeFakeOverkizPool,
  makeFakeTimer,
  makeFakeClock,
  makeMultiConfig,
  makeOverkizDevice,
} from './helpers.js';

const logger = createLogger({ level: 'silent' });

const SOMFY = { server: 'somfy_europe', username: 'somfy@example.com', password: 'x' };
const COZYTOUCH = { server: 'cozytouch', username: 'thermor@example.com', password: 'y' };

function makeCover(deviceURL) {
  return makeOverkizDevice({
    deviceURL,
    label: 'Cover',
    uiClass: 'RollerShutter',
    commands: ['open', 'close', 'stop', 'setClosure'],
    states: { 'core:ClosureState': 30 },
  });
}

function makeSwitch(deviceURL) {
  return makeOverkizDevice({
    deviceURL,
    label: 'Switch',
    uiClass: 'OnOff',
    commands: ['on', 'off'],
    states: { 'core:OnOffState': 'off' },
  });
}

function setup({ config, accounts = {}, logger: loggerOverride = logger } = {}) {
  const gladys = makeFakeGladys({ config });
  const pool = makeFakeOverkizPool(accounts);
  const timer = makeFakeTimer();
  const clock = makeFakeClock();
  const handlers = createHandlers({
    gladys,
    createOverkiz: pool.createOverkiz,
    logger: loggerOverride,
    scheduleTimer: timer,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { gladys, pool, handlers, timer, clock };
}

/** Two accounts, each with one device, both connecting fine. */
function setupTwoAccounts(overrides = {}) {
  return setup({
    config: makeMultiConfig({ 1: SOMFY, 2: COZYTOUCH }),
    accounts: {
      1: { devices: [makeCover('io://1111-1111-1111/1')] },
      2: { devices: [makeSwitch('io://2222-2222-2222/2')] },
      ...overrides,
    },
  });
}

test('the discovery list holds the union of every account, in slot order', async () => {
  const { gladys, handlers } = setupTwoAccounts();

  await handlers.gladysConnected();

  const published = gladys.calls.discovered.at(-1);
  assert.deepEqual(
    published.map((device) => device.name),
    ['Cover', 'Switch'],
  );
});

test('both accounts open their own session', async () => {
  const { pool, handlers } = setupTwoAccounts();

  await handlers.gladysConnected();

  assert.deepEqual(pool.get(1).calls.start.at(-1).server, 'somfy_europe');
  assert.deepEqual(pool.get(2).calls.start.at(-1).server, 'cozytouch');
  assert.equal(pool.get(3).calls.start.length, 0);
});

test('a failing account does not take the working one down with it', async () => {
  const { gladys, handlers } = setupTwoAccounts({
    2: { devices: [makeSwitch('io://2222-2222-2222/2')], startError: '401 Unauthorized' },
  });

  await handlers.gladysConnected();

  const published = gladys.calls.discovered.at(-1);
  assert.deepEqual(
    published.map((device) => device.name),
    ['Cover'],
    "the working account's devices stay discoverable",
  );
  const status = gladys.calls.connectionStatus.at(-1);
  assert.equal(status.connected, false);
  assert.equal(status.message.fr, 'Compte 2 (Atlantic Cozytouch) : identifiants refusés');
});

test('a command executes on the account that owns the device, and only there', async () => {
  const { gladys, pool, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();
  const [, switchDevice] = gladys.calls.discovered.at(-1);

  await handlers.setValue(switchDevice, switchDevice.features[0], 1);

  assert.equal(pool.get(1).calls.execute.length, 0, 'the first account was not touched');
  assert.equal(pool.get(2).calls.execute.length, 1);
  assert.equal(pool.get(2).calls.execute[0].deviceUrl, 'io://2222-2222-2222/2');
});

test('refused credentials on one account arm no retry anywhere', async () => {
  const { timer, handlers } = setupTwoAccounts({
    2: { devices: [], startError: '401 Unauthorized' },
  });

  await handlers.gladysConnected();

  assert.equal(timer.pending.filter((entry) => !entry.cancelled).length, 0);
});

test('an unreachable account retries alone', async () => {
  const { pool, timer, handlers } = setupTwoAccounts({
    2: { devices: [makeSwitch('io://2222-2222-2222/2')], startError: 'ETIMEDOUT' },
  });
  await handlers.gladysConnected();
  assert.equal(timer.pending.filter((entry) => !entry.cancelled).length, 1);

  pool.get(2).startError = null;
  await timer.runAll();

  assert.equal(pool.get(1).calls.start.length, 1, 'the healthy account did not reconnect');
  assert.equal(pool.get(2).calls.start.length, 2);
});

test('a Gladys reconnection re-authenticates neither account', async () => {
  const { pool, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();

  await handlers.gladysConnected();

  assert.equal(pool.get(1).calls.start.length, 1);
  assert.equal(pool.get(2).calls.start.length, 1);
});

test('changing one password reconnects that account only', async () => {
  const { pool, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();

  await handlers.configUpdated(
    makeMultiConfig({ 1: SOMFY, 2: { ...COZYTOUCH, password: 'new-one' } }),
  );

  assert.equal(pool.get(1).calls.start.length, 1, 'the untouched account kept its session');
  assert.equal(pool.get(2).calls.start.length, 2);
});

test('moving an account to another slot does not re-authenticate it', async () => {
  // Its identity is its credentials, not the slot it happens to sit in.
  const { pool, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();

  await handlers.configUpdated(makeMultiConfig({ 1: SOMFY, 3: COZYTOUCH }));

  assert.equal(pool.get(1).calls.start.length, 1);
  assert.equal(pool.get(2).calls.start.length, 1);
  assert.equal(pool.get(3).calls.start.length, 0, 'no third session was ever opened');
});

test('emptying a slot stops it and removes its devices', async () => {
  const { gladys, pool, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();

  await handlers.configUpdated(makeMultiConfig({ 1: SOMFY }));

  assert.equal(pool.get(2).calls.stopped, 1);
  assert.deepEqual(
    gladys.calls.discovered.at(-1).map((device) => device.name),
    ['Cover'],
  );
  assert.equal(gladys.calls.connectionStatus.at(-1).connected, true);
});

test('putting a removed account back republishes its states', async () => {
  const { gladys, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();
  await handlers.configUpdated(makeMultiConfig({ 1: SOMFY }));
  const before = gladys.calls.states.flat().length;

  await handlers.configUpdated(makeMultiConfig({ 1: SOMFY, 2: COZYTOUCH }));

  const republished = gladys.calls.states
    .flat()
    .slice(before)
    .filter((state) => state.device_feature_external_id.includes('2222-2222-2222'));
  assert.ok(republished.length > 0, 'its values were forgotten when it left, so they come back');
});

test('the 300-states-per-minute budget is shared, not per account', async () => {
  const many = (prefix, count) =>
    Array.from({ length: count }, (_, i) => makeSwitch(`io://${prefix}/${i}`));
  const { clock, handlers } = setup({
    config: makeMultiConfig({ 1: SOMFY, 2: COZYTOUCH }),
    accounts: {
      1: { devices: many('1111-1111-1111', 200) },
      2: { devices: many('2222-2222-2222', 200) },
    },
  });

  await handlers.gladysConnected();

  assert.ok(clock.sleeps.length > 0, '400 states cannot go out inside one 300-per-minute window');
});

test('the same account in two slots opens a single session', async () => {
  const warnings = [];
  const { pool, gladys, handlers } = setup({
    config: makeMultiConfig({ 1: SOMFY, 3: SOMFY }),
    accounts: { 1: { devices: [makeCover('io://1111-1111-1111/1')] } },
    logger: { ...logger, warn: (line) => warnings.push(line) },
  });

  await handlers.gladysConnected();

  assert.equal(pool.get(1).calls.start.length, 1);
  assert.equal(pool.get(3).calls.start.length, 0);
  assert.equal(gladys.calls.connectionStatus.at(-1).connected, true);
  assert.ok(warnings.some((line) => /same credentials as account 1/.test(line)));
});

test('two accounts exposing the same hub publish the device once', async () => {
  const shared = () => makeCover('io://1111-1111-1111/1');
  const { gladys, handlers } = setup({
    config: makeMultiConfig({ 1: SOMFY, 2: COZYTOUCH }),
    accounts: { 1: { devices: [shared()] }, 2: { devices: [shared()] } },
  });

  await handlers.gladysConnected();

  assert.equal(gladys.calls.discovered.at(-1).length, 1);
});

test('a half filled slot blocks nothing but is reported', async () => {
  const { gladys, pool, handlers } = setup({
    config: makeMultiConfig({ 1: SOMFY, 2: { username: COZYTOUCH.username } }),
    accounts: { 1: { devices: [makeCover('io://1111-1111-1111/1')] } },
  });

  await handlers.gladysConnected();

  assert.equal(pool.get(2).calls.start.length, 0);
  assert.equal(gladys.calls.discovered.at(-1).length, 1, 'the complete account still works');
  const status = gladys.calls.connectionStatus.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Compte 2 .*email ou mot de passe manquant/);
});

test('shutdown stops every account', async () => {
  const { pool, handlers } = setupTwoAccounts();
  await handlers.gladysConnected();

  handlers.shutdown('SIGTERM');

  assert.equal(pool.get(1).calls.stopped, 1);
  assert.equal(pool.get(2).calls.stopped, 1);
});

// --- actions -----------------------------------------------------------------

test('testing the connection sums up every account', async () => {
  const { handlers } = setupTwoAccounts();
  await handlers.gladysConnected();

  const message = await handlers.actions.test_connection();

  assert.match(message.fr, /Compte 1 \(Somfy Europe\) : 1/);
  assert.match(message.fr, /Compte 2 \(Atlantic Cozytouch\) : 1/);
});

test('testing the connection names only the accounts that failed', async () => {
  const { handlers } = setupTwoAccounts({
    2: { devices: [], startError: '401 Unauthorized' },
  });
  await handlers.gladysConnected();

  await assert.rejects(handlers.actions.test_connection(), (err) => {
    assert.match(err.message, /Compte 2 \(Atlantic Cozytouch\)/);
    assert.ok(!err.message.includes('Compte 1'), 'the working account is not listed');
    return true;
  });
});

test('the dump labels every device with the account it came from', async () => {
  const lines = [];
  const { handlers } = setup({
    config: makeMultiConfig({ 1: SOMFY, 2: COZYTOUCH }),
    accounts: {
      1: { devices: [makeCover('io://1111-1111-1111/1')] },
      2: { devices: [makeSwitch('io://2222-2222-2222/2')] },
    },
    logger: { ...logger, info: (line) => lines.push(line) },
  });
  await handlers.gladysConnected();

  const message = await handlers.actions.dump_devices();

  const dumps = lines
    .filter((line) => line.startsWith('Device dump:'))
    .map((line) => JSON.parse(line.slice('Device dump: '.length)));
  assert.deepEqual(
    dumps.map((payload) => [payload.account, payload.server]),
    [
      [1, 'somfy_europe'],
      [2, 'cozytouch'],
    ],
  );
  assert.match(message.fr, /2 appareil\(s\)/);
  assert.match(message.fr, /Compte 1 \(Somfy Europe\) : 1/);
});
