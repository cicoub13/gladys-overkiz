import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG, isConfigComplete } from '../src/config.js';

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

test('isConfigComplete requires server, username and password', () => {
  assert.equal(isConfigComplete(normalizeConfig()), false);
  assert.equal(isConfigComplete(normalizeConfig({ username: 'a@b.c' })), false);
  assert.equal(isConfigComplete(normalizeConfig({ username: 'a@b.c', password: 'x' })), true);
});
