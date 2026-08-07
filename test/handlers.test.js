// -----------------------------------------------------------------------------
// Orchestration tests: connection lifecycle, discovery, state publishing and
// command routing, driven entirely through fake collaborators.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createHandlers } from '../src/handlers.js';
import { makeFakeGladys, makeFakeOverkiz, makeOverkizDevice, makeWaterHeater } from './helpers.js';

const logger = createLogger({ level: 'silent' });

const VALID_CONFIG = { server: 'somfy_europe', username: 'a@b.c', password: 'secret' };

function makeLight(states = { 'core:OnOffState': 'off', 'core:LightIntensityState': 40 }) {
  return makeOverkizDevice({
    uiClass: 'Light',
    commands: ['on', 'off', 'setIntensity'],
    states,
  });
}

/**
 * Collects the timers the handlers schedule so tests can fire them on demand
 * instead of waiting a real minute.
 */
function makeFakeTimer() {
  const pending = [];
  const scheduleTimer = (fn) => {
    const entry = { fn, cancelled: false };
    pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  scheduleTimer.pending = pending;
  scheduleTimer.runAll = async () => {
    for (const entry of pending.splice(0)) {
      if (!entry.cancelled) {
        await entry.fn();
      }
    }
  };
  return scheduleTimer;
}

/**
 * Controllable clock. `sleep` advances it, so rate-limit pauses are observable
 * without the test actually waiting.
 */
function makeFakeClock() {
  let current = 1_000_000;
  const sleeps = [];
  return {
    sleeps,
    now: () => current,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      current += delayMs;
    },
  };
}

function setup({ config = VALID_CONFIG, devices = [makeLight()], startError = null } = {}) {
  const gladys = makeFakeGladys({ config });
  const overkiz = makeFakeOverkiz({ devices, startError });
  const scheduleTimer = makeFakeTimer();
  const clock = makeFakeClock();
  const handlers = createHandlers({
    gladys,
    overkiz,
    logger,
    scheduleTimer,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { gladys, overkiz, handlers, timer: scheduleTimer, clock };
}

test('an incomplete configuration reports a status instead of connecting', async () => {
  const { gladys, overkiz, handlers } = setup({ config: { server: 'somfy_europe' } });

  await handlers.gladysConnected();

  assert.equal(overkiz.calls.start.length, 0);
  const [status] = gladys.calls.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Configuration/);
});

test('a complete configuration connects, publishes the devices and their states', async () => {
  const { gladys, overkiz, handlers } = setup();

  await handlers.gladysConnected();

  assert.equal(overkiz.calls.start.length, 1);
  assert.equal(overkiz.calls.start[0].username, 'a@b.c');

  const [discovered] = gladys.calls.discovered;
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].features.length, 2);

  const published = gladys.calls.states.flat();
  assert.deepEqual(
    published.map((s) => s.state).sort(),
    [0, 40], // OnOffState 'off' -> 0, LightIntensityState 40
  );

  assert.equal(gladys.calls.connectionStatus.at(-1).connected, true);
});

test('unchanged states are not republished', async () => {
  const { gladys, overkiz, handlers } = setup();
  await handlers.gladysConnected();
  const publishedBefore = gladys.calls.states.length;

  overkiz.connected = true;
  await handlers.scan();

  assert.equal(
    gladys.calls.states.length,
    publishedBefore,
    'no extra publish for identical states',
  );
});

test('an Overkiz state event publishes only the values that changed', async () => {
  const { gladys, overkiz, handlers } = setup();
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  await overkiz.onStates(overkiz.devices[0], [
    { name: 'core:OnOffState', value: 'on' }, // changed: 0 -> 1
    { name: 'core:LightIntensityState', value: 40 }, // unchanged
  ]);

  assert.equal(gladys.calls.states.length, 1);
  assert.equal(gladys.calls.states[0].length, 1);
  assert.equal(gladys.calls.states[0][0].state, 1);
});

test('a state event for an unknown device is ignored', async () => {
  const { gladys, overkiz, handlers } = setup();
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  await overkiz.onStates(makeOverkizDevice({ deviceURL: 'io://other/1', uiClass: 'Light' }), [
    { name: 'core:OnOffState', value: 'on' },
  ]);

  assert.equal(gladys.calls.states.length, 0);
});

test('a command is translated into an Overkiz execution', async () => {
  const shutter = makeOverkizDevice({
    uiClass: 'RollerShutter',
    commands: ['open', 'close', 'stop', 'setClosure'],
    states: { 'core:ClosureState': 100 },
  });
  const { overkiz, handlers } = setup({ devices: [shutter] });
  await handlers.gladysConnected();

  const gladysDevice = {
    external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678',
    name: 'Shutter',
  };
  const feature = { external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678:position' };
  await handlers.setValue(gladysDevice, feature, 70);

  assert.equal(overkiz.calls.execute.length, 1);
  assert.deepEqual(overkiz.calls.execute[0].command, { name: 'setClosure', parameters: [30] });
  assert.equal(overkiz.calls.execute[0].deviceUrl, shutter.deviceURL);
});

test('a command echoes the new value back immediately', async () => {
  const shutter = makeOverkizDevice({
    uiClass: 'RollerShutter',
    commands: ['open', 'close', 'stop', 'setClosure'],
    states: { 'core:ClosureState': 100 },
  });
  const { gladys, handlers } = setup({ devices: [shutter] });
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  const featureId = 'overkiz:overkiz:io-1234-5678-9012-12345678:position';
  await handlers.setValue(
    { external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678', name: 'Shutter' },
    { external_id: featureId },
    70,
  );

  // Without this the UI would sit on the stale position for a whole polling
  // period.
  assert.deepEqual(gladys.calls.states.flat(), [
    { device_feature_external_id: featureId, state: 70 },
  ]);
});

test('a write-only command publishes no optimistic state', async () => {
  const shutter = makeOverkizDevice({
    uiClass: 'RollerShutter',
    commands: ['open', 'close', 'stop'],
    states: { 'core:ClosureState': 100 },
  });
  const { gladys, handlers } = setup({ devices: [shutter] });
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  await handlers.setValue(
    { external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678', name: 'Shutter' },
    { external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678:state' },
    1,
  );

  assert.equal(gladys.calls.states.length, 0, 'the state feature has no Overkiz counterpart');
});

test('a command on an unknown device or feature is rejected', async () => {
  const { handlers } = setup();
  await handlers.gladysConnected();

  await assert.rejects(
    () => handlers.setValue({ external_id: 'overkiz:overkiz:nope' }, { external_id: 'x' }, 1),
    /Unknown Overkiz device/,
  );
  await assert.rejects(
    () =>
      handlers.setValue(
        { external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678' },
        { external_id: 'overkiz:overkiz:io-1234-5678-9012-12345678:nope' },
        1,
      ),
    /Unknown feature/,
  );
});

test('discovered devices opt out of Gladys polling', () => {
  // The Overkiz event poller pushes every change, so there is no onPoll handler
  // and the devices must not ask the Gladys scheduler to poll them.
  const { gladys, handlers } = setup();
  return handlers.gladysConnected().then(() => {
    assert.equal(handlers.poll, undefined);
    for (const device of gladys.calls.discovered.flat()) {
      assert.equal(device.should_poll, false);
    }
  });
});

test('a scan reconnects when the Overkiz client is down', async () => {
  const { overkiz, handlers } = setup();
  await handlers.gladysConnected();
  assert.equal(overkiz.calls.start.length, 1);

  overkiz.stop(); // the Overkiz session dropped in the meantime
  await handlers.scan();

  assert.equal(overkiz.calls.start.length, 2, 'the scan re-established the connection');
});

test('losing the Overkiz connection is reported to Gladys', async () => {
  const { gladys, overkiz } = setup();

  overkiz.onConnectionChange(false);

  const status = gladys.calls.connectionStatus.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Déconnecté/);
});

test('shutdown stops the Overkiz client', async () => {
  const { overkiz, handlers } = setup();
  await handlers.gladysConnected();

  handlers.shutdown('SIGTERM');

  assert.equal(overkiz.calls.stopped, 1);
});

test('the manifest actions are all exposed as handlers', () => {
  const { handlers } = setup();
  for (const handler of Object.values(handlers.actions)) {
    assert.equal(typeof handler, 'function');
  }
});

// --- "Test the connection" reports the truth ---------------------------------

test('testing the connection reports the real cause of a failure', async () => {
  // The regression this guards: a refused password used to answer
  // "Connection OK, 0 supported device(s) found."
  const { handlers } = setup({ startError: 'Error 401 Bad credentials (AUTHENTICATION_ERROR)' });
  await handlers.configUpdated(VALID_CONFIG);

  const message = await handlers.actions.test_connection();

  assert.match(message.fr, /identifiants/);
  assert.doesNotMatch(message.fr, /OK/);
});

test('testing the connection distinguishes an unreachable cloud', async () => {
  const { handlers } = setup({ startError: 'getaddrinfo ENOTFOUND ha101-1.overkiz.com' });
  await handlers.configUpdated(VALID_CONFIG);

  const message = await handlers.actions.test_connection();

  assert.match(message.fr, /injoignable/);
});

test('testing the connection counts the supported devices on success', async () => {
  const { handlers } = setup();
  await handlers.configUpdated(VALID_CONFIG);

  const message = await handlers.actions.test_connection();

  assert.match(message.fr, /Connexion OK, 1 appareil/);
});

test('testing the connection asks for the missing configuration first', async () => {
  const { handlers } = setup({ config: {} });
  await handlers.gladysConnected();

  const message = await handlers.actions.test_connection();

  assert.match(message.fr, /Configuration incomplète/);
});

// --- A failed publish must not lose the state --------------------------------

test('states are only remembered once Gladys accepted them', async () => {
  // The regression this guards: the values were recorded before publishing, so
  // a rejected batch was skipped forever by the deduplication.
  const { gladys, handlers, timer } = setup();
  gladys.publishError = new Error('Error 429 Too Many Requests');

  await handlers.gladysConnected();
  assert.equal(gladys.calls.states.length, 0, 'nothing got through');
  assert.equal(timer.pending.length, 1, 'a resynchronization was scheduled');

  gladys.publishError = null;
  await timer.runAll();

  const published = gladys.calls.states.flat();
  assert.deepEqual(
    published.map((s) => s.state).sort(),
    [0, 40],
    'the lost values were replayed, not swallowed',
  );
});

test('a failed publish schedules a single resynchronization', async () => {
  const { gladys, overkiz, handlers, timer } = setup();
  gladys.publishError = new Error('Error 429 Too Many Requests');
  await handlers.gladysConnected();

  await overkiz.onStates(overkiz.devices[0], [{ name: 'core:OnOffState', value: 'on' }]);

  assert.equal(timer.pending.length, 1, 'failures coalesce into one pending replay');
});

test('shutdown cancels a pending resynchronization', async () => {
  const { gladys, handlers, timer } = setup();
  gladys.publishError = new Error('Error 429 Too Many Requests');
  await handlers.gladysConnected();
  assert.equal(timer.pending.length, 1);

  handlers.shutdown('SIGTERM');
  gladys.publishError = null;
  await timer.runAll();

  assert.equal(gladys.calls.states.length, 0, 'the cancelled replay did not run');
});

// --- Reconnection: never re-authenticate for nothing --------------------------

test('a Gladys reconnection reuses the existing Overkiz session', async () => {
  // The regression this guards: every WebSocket reconnection triggered a full
  // Overkiz login, and Overkiz locks accounts that authenticate too often.
  const { gladys, overkiz, handlers } = setup();
  await handlers.gladysConnected();
  assert.equal(overkiz.calls.start.length, 1);

  await handlers.gladysConnected();

  assert.equal(overkiz.calls.start.length, 1, 'no second login');
  assert.equal(gladys.calls.connectionStatus.at(-1).connected, true);
});

test('a Gladys reconnection after a credentials change does reconnect', async () => {
  const { gladys, overkiz, handlers } = setup();
  await handlers.gladysConnected();

  gladys.config = { ...VALID_CONFIG, password: 'rotated' };
  await handlers.gladysConnected();

  assert.equal(overkiz.calls.start.length, 2);
});

test('saving an unchanged configuration keeps the session', async () => {
  const { overkiz, handlers } = setup();
  await handlers.gladysConnected();

  await handlers.configUpdated(VALID_CONFIG);

  assert.equal(overkiz.calls.start.length, 1);
});

test('saving a changed polling period reconnects', async () => {
  const { overkiz, handlers } = setup();
  await handlers.gladysConnected();

  await handlers.configUpdated({ ...VALID_CONFIG, polling_period: 60 });

  assert.equal(overkiz.calls.start.length, 2);
  assert.equal(overkiz.calls.start[1].polling_period, 60);
});

// --- Retry: only what can heal on its own -------------------------------------

test('an unreachable cloud is retried automatically', async () => {
  const { overkiz, handlers, timer } = setup({
    startError: 'getaddrinfo ENOTFOUND ha101-1.overkiz.com',
  });
  await handlers.configUpdated(VALID_CONFIG);
  assert.equal(overkiz.calls.start.length, 1);
  assert.equal(timer.pending.length, 1, 'a retry was armed');

  overkiz.startError = null; // the cloud came back
  await timer.runAll();

  assert.equal(overkiz.calls.start.length, 2);
  assert.equal(overkiz.connected, true);
});

test('refused credentials are never retried', async () => {
  const { handlers, timer } = setup({
    startError: 'Error 401 Bad credentials (AUTHENTICATION_ERROR)',
  });

  await handlers.configUpdated(VALID_CONFIG);

  assert.equal(timer.pending.length, 0, 'retrying a wrong password would lock the account');
});

test('a locked account is never retried either', async () => {
  const { handlers, timer } = setup({ startError: 'Error 400 too many attempts, try again later' });

  await handlers.configUpdated(VALID_CONFIG);

  assert.equal(timer.pending.length, 0);
});

test('shutdown cancels a pending retry', async () => {
  const { overkiz, handlers, timer } = setup({ startError: 'Error 503' });
  await handlers.configUpdated(VALID_CONFIG);
  assert.equal(timer.pending.length, 1);

  handlers.shutdown('SIGTERM');
  await timer.runAll();

  assert.equal(overkiz.calls.start.length, 1, 'the cancelled retry did not run');
});

// --- Rate limit ---------------------------------------------------------------

test('publishing more than 300 states a minute pauses instead of being rejected', async () => {
  // 200 lights x 2 features = 400 states, over the 300/minute host limit.
  const devices = Array.from({ length: 200 }, (_, i) =>
    makeOverkizDevice({
      deviceURL: `io://1234-5678-9012/${i}`,
      uiClass: 'Light',
      commands: ['on', 'off', 'setIntensity'],
      states: { 'core:OnOffState': 'on', 'core:LightIntensityState': 40 },
    }),
  );
  const { gladys, handlers, clock } = setup({ devices });

  await handlers.gladysConnected();

  assert.equal(gladys.calls.states.length, 4, '400 states sent as 4 batches');
  assert.ok(
    gladys.calls.states.every((batch) => batch.length <= 100),
    'no batch exceeds the 100-per-request limit',
  );
  assert.equal(clock.sleeps.length, 1, 'the 4th batch waited for the window to slide');
});

test('a small setup never waits', async () => {
  const { clock, handlers } = setup();

  await handlers.gladysConnected();

  assert.deepEqual(clock.sleeps, []);
});

// --- Water heaters -----------------------------------------------------------

const WATER_HEATER_ID = 'overkiz:overkiz:io-1111-2222-3333-44444444-1';

test('a derived feature is recomputed when any of its states changes', async () => {
  const heater = makeWaterHeater();
  const { gladys, overkiz, handlers } = setup({ devices: [heater] });
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  // `overkiz-client` writes the new values into the device before it emits, so
  // the fake reproduces that ordering.
  const emit = async (name, value) => {
    heater.states.find((s) => s.name === name).value = value;
    await overkiz.onStates(heater, [{ name, value }]);
  };

  // The mode reads `io:DHWModeState`, but the appliance's absence flag alone
  // flips it to the Gladys AWAY mode.
  await emit('io:AwayModeDurationState', 'always');
  assert.deepEqual(gladys.calls.states.flat(), [
    { device_feature_external_id: `${WATER_HEATER_ID}:mode`, state: 5 },
  ]);

  gladys.calls.states.length = 0;
  await emit('io:AwayModeDurationState', '0');
  assert.deepEqual(gladys.calls.states.flat(), [
    { device_feature_external_id: `${WATER_HEATER_ID}:mode`, state: 2 },
  ]);

  gladys.calls.states.length = 0;
  await emit('io:DHWModeState', 'autoMode');
  assert.deepEqual(gladys.calls.states.flat(), [
    { device_feature_external_id: `${WATER_HEATER_ID}:mode`, state: 1 },
  ]);
});

test('a batch touching both states of a derived feature publishes it once', async () => {
  const heater = makeWaterHeater();
  const { gladys, overkiz, handlers } = setup({ devices: [heater] });
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  heater.states.find((s) => s.name === 'io:DHWModeState').value = 'autoMode';
  heater.states.find((s) => s.name === 'io:AwayModeDurationState').value = '0';
  await overkiz.onStates(heater, [
    { name: 'io:DHWModeState', value: 'autoMode' },
    { name: 'io:AwayModeDurationState', value: '0' },
  ]);

  assert.deepEqual(gladys.calls.states.flat(), [
    { device_feature_external_id: `${WATER_HEATER_ID}:mode`, state: 1 },
  ]);
});

test('a water heater publishes its initial states on connection', async () => {
  const { gladys, handlers } = setup({ devices: [makeWaterHeater()] });

  await handlers.gladysConnected();

  const published = Object.fromEntries(
    gladys.calls.states.flat().map((s) => [s.device_feature_external_id, s.state]),
  );
  assert.deepEqual(published, {
    [`${WATER_HEATER_ID}:mode`]: 2,
    [`${WATER_HEATER_ID}:target_temperature`]: 54,
    [`${WATER_HEATER_ID}:remaining_hot_water`]: 70,
    [`${WATER_HEATER_ID}:water_temperature`]: 48.5,
    // boost 0 and heating 'off' both map to 0 and are published as such.
    [`${WATER_HEATER_ID}:boost`]: 0,
    [`${WATER_HEATER_ID}:heating`]: 0,
  });
});

test('a mode command sends the whole ordered sequence and echoes the mode', async () => {
  const heater = makeWaterHeater();
  const { gladys, overkiz, handlers } = setup({ devices: [heater] });
  await handlers.gladysConnected();
  gladys.calls.states.length = 0;

  const featureId = `${WATER_HEATER_ID}:mode`;
  await handlers.setValue(
    { external_id: WATER_HEATER_ID, name: 'Water heater' },
    { external_id: featureId },
    1,
  );

  assert.equal(overkiz.calls.execute.length, 1, 'one action carries the whole sequence');
  assert.deepEqual(overkiz.calls.execute[0].command, [
    { name: 'setCurrentOperatingMode', parameters: [{ relaunch: 'off', absence: 'off' }] },
    { name: 'setDHWMode', parameters: ['autoMode'] },
  ]);
  // A derived feature echoes too: it has feedback, just not a single state.
  assert.deepEqual(gladys.calls.states.flat(), [
    { device_feature_external_id: featureId, state: 1 },
  ]);
});

test('a boost command is refused when the appliance cannot boost', async () => {
  const heater = makeWaterHeater({ commands: ['setTargetTemperature'] });
  const { handlers } = setup({ devices: [heater] });
  await handlers.gladysConnected();

  await assert.rejects(
    () =>
      handlers.setValue(
        { external_id: WATER_HEATER_ID },
        { external_id: `${WATER_HEATER_ID}:boost` },
        1,
      ),
    /No Overkiz command/,
  );
});

// --- The dump action ---------------------------------------------------------

test('the dump action asks for a connection first', async () => {
  const { handlers } = setup();

  const message = await handlers.actions.dump_devices();

  assert.match(message.fr, /connexion/);
});

test('the dump action writes every device to the logs', async () => {
  const lines = [];
  const gladys = makeFakeGladys({ config: VALID_CONFIG });
  const overkiz = makeFakeOverkiz({ devices: [makeWaterHeater()] });
  const handlers = createHandlers({
    gladys,
    overkiz,
    logger: { ...logger, info: (line) => lines.push(line) },
    scheduleTimer: makeFakeTimer(),
  });
  await handlers.gladysConnected();

  const message = await handlers.actions.dump_devices();

  const dump = lines.find((line) => line.startsWith('Device dump:'));
  assert.ok(dump, 'the raw device is logged');
  const payload = JSON.parse(dump.slice('Device dump: '.length));
  assert.equal(payload.uiClass, 'WaterHeatingSystem');
  assert.equal(
    payload.controllableName,
    'io:AtlanticDomesticHotWaterProductionV2_CV4E_IOComponent',
  );
  assert.ok(payload.commands.includes('setDHWMode'));
  assert.ok(payload.states.some((s) => s.name === 'io:DHWModeState'));
  // The dump carries the hub serial number, so the message says so.
  assert.match(message.fr, /1 appareil/);
  assert.match(message.fr, /numéro de série/);
});
