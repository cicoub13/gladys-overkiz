import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createPublisher } from '../src/publisher.js';
import { makeFakeGladys, makeFakeTimer, makeFakeClock } from './helpers.js';

const logger = createLogger({ level: 'silent' });

function setup({ resync = async () => {} } = {}) {
  const gladys = makeFakeGladys();
  const timer = makeFakeTimer();
  const clock = makeFakeClock();
  const publisher = createPublisher({
    gladys,
    logger,
    scheduleTimer: timer,
    now: clock.now,
    sleep: clock.sleep,
    resync,
  });
  return { gladys, timer, clock, publisher };
}

function states(count, prefix = 'f') {
  return Array.from({ length: count }, (_, i) => ({
    device_feature_external_id: `${prefix}${i}`,
    state: i,
  }));
}

test('a batch larger than a request is split into chunks of 100', async () => {
  const { gladys, publisher } = setup();

  await publisher.publish(states(250));

  assert.deepEqual(
    gladys.calls.states.map((chunk) => chunk.length),
    [100, 100, 50],
  );
});

test('values are remembered only once accepted', async () => {
  const { gladys, publisher } = setup();
  gladys.publishError = new Error('host down');

  await publisher.publish([{ device_feature_external_id: 'f0', state: 1 }]);

  assert.equal(
    publisher.lastValue('f0'),
    undefined,
    'a rejected value must be republished, not considered published',
  );
});

test('going past 300 states a minute pauses instead of earning a 429', async () => {
  const { gladys, clock, publisher } = setup();

  await publisher.publish(states(300));
  await publisher.publish(states(50, 'g'));

  assert.equal(clock.sleeps.length, 1);
  assert.equal(gladys.calls.states.length, 4);
});

test('two concurrent batches do not overshoot the window', async () => {
  // The reason publishes are serialized: unserialized, both batches clear the
  // budget check before either records what it consumed.
  const { gladys, clock, publisher } = setup();

  await Promise.all([publisher.publish(states(200, 'a')), publisher.publish(states(200, 'b'))]);

  assert.equal(clock.sleeps.length, 1, 'the second batch waited for the window to reopen');
  assert.deepEqual(
    gladys.calls.states.map((chunk) => chunk.length),
    [100, 100, 100, 100],
  );
});

test('a failing batch does not poison the batches queued behind it', async () => {
  const { gladys, publisher } = setup();
  gladys.publishError = new Error('host down');

  const failing = publisher.publish([{ device_feature_external_id: 'f0', state: 1 }]);
  gladys.publishError = null;
  const following = publisher.publish([{ device_feature_external_id: 'f1', state: 2 }]);

  await Promise.all([failing, following]);
  assert.equal(publisher.lastValue('f1'), 2);
});

test('duplicate features inside one batch keep the freshest value', async () => {
  const { gladys, publisher } = setup();

  await publisher.publish([
    { device_feature_external_id: 'f0', state: 1 },
    { device_feature_external_id: 'f0', state: 2 },
  ]);

  assert.deepEqual(gladys.calls.states, [[{ device_feature_external_id: 'f0', state: 2 }]]);
  assert.equal(publisher.lastValue('f0'), 2);
});

test('a failed publish schedules exactly one resynchronization', async () => {
  let resyncs = 0;
  const { gladys, timer, publisher } = setup({
    resync: async () => {
      resyncs += 1;
    },
  });
  gladys.publishError = new Error('host down');

  await publisher.publish(states(2));
  await publisher.publish(states(2, 'g'));

  assert.equal(timer.pending.filter((entry) => !entry.cancelled).length, 1);
  await timer.runAll();
  assert.equal(resyncs, 1);
});

test('a failing resynchronization is caught rather than thrown at the timer', async () => {
  const { gladys, timer, publisher } = setup({
    resync: async () => {
      throw new Error('still down');
    },
  });
  gladys.publishError = new Error('host down');

  await publisher.publish(states(1));
  await timer.runAll();
});

test('forget only drops the features it is given', async () => {
  const { publisher } = setup();

  await publisher.publish(states(3));
  publisher.forget(['f0', 'f2']);

  assert.equal(publisher.lastValue('f0'), undefined);
  assert.equal(publisher.lastValue('f1'), 1);
  assert.equal(publisher.lastValue('f2'), undefined);
});

test('cancelResync drops a pending replay', async () => {
  let resyncs = 0;
  const { gladys, timer, publisher } = setup({
    resync: async () => {
      resyncs += 1;
    },
  });
  gladys.publishError = new Error('host down');

  await publisher.publish(states(1));
  publisher.cancelResync();
  await timer.runAll();

  assert.equal(resyncs, 0);
});
