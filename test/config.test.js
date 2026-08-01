import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  DEFAULT_CONFIG,
  POLLING_PERIOD_BOUNDS,
  isConfigComplete,
  connectionConfigEquals,
} from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({ server: 'cozytouch', username: 'a@b.c', password: 'x' });
  assert.equal(config.server, 'cozytouch');
  assert.equal(config.username, 'a@b.c');
  assert.equal(config.password, 'x');
});

test('normalizeConfig coerces numeric strings coming from a form', () => {
  const config = normalizeConfig({ polling_period: '60' });
  assert.equal(config.polling_period, 60);
  assert.equal(typeof config.polling_period, 'number');
});

test('normalizeConfig falls back to the default for a missing numeric field', () => {
  const config = normalizeConfig({ server: 'somfy_europe' });
  assert.equal(config.polling_period, DEFAULT_CONFIG.polling_period);
});

test('normalizeConfig falls back to the default for an unusable numeric field', () => {
  // An emptied number field arrives as '', which Number() turns into 0 — and 0
  // silently DISABLES event polling in overkiz-client.
  assert.equal(
    normalizeConfig({ polling_period: '' }).polling_period,
    DEFAULT_CONFIG.polling_period,
  );
  assert.equal(
    normalizeConfig({ polling_period: null }).polling_period,
    DEFAULT_CONFIG.polling_period,
  );
  assert.equal(
    normalizeConfig({ polling_period: 'abc' }).polling_period,
    DEFAULT_CONFIG.polling_period,
  );
});

test('normalizeConfig clamps the polling period to its declared bounds', () => {
  assert.equal(normalizeConfig({ polling_period: 1 }).polling_period, POLLING_PERIOD_BOUNDS.min);
  assert.equal(normalizeConfig({ polling_period: 9999 }).polling_period, POLLING_PERIOD_BOUNDS.max);
  assert.equal(normalizeConfig({ polling_period: 45 }).polling_period, 45);
});

test('isConfigComplete requires server, username and password', () => {
  assert.equal(isConfigComplete(normalizeConfig()), false);
  assert.equal(isConfigComplete(normalizeConfig({ username: 'a@b.c' })), false);
  assert.equal(isConfigComplete(normalizeConfig({ username: 'a@b.c', password: 'x' })), true);
});

test('connectionConfigEquals only looks at the fields a session depends on', () => {
  const base = normalizeConfig({ username: 'a@b.c', password: 'x' });

  assert.equal(connectionConfigEquals(base, normalizeConfig({ ...base })), true);
  assert.equal(
    connectionConfigEquals(base, normalizeConfig({ ...base, some_unrelated_field: 'new' })),
    true,
    'an unrelated setting must not trigger a re-authentication',
  );

  for (const field of ['server', 'username', 'password']) {
    assert.equal(
      connectionConfigEquals(base, normalizeConfig({ ...base, [field]: 'changed' })),
      false,
      `${field} must trigger a reconnection`,
    );
  }
  assert.equal(
    connectionConfigEquals(base, normalizeConfig({ ...base, polling_period: 60 })),
    false,
  );
});
