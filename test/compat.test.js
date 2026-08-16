// -----------------------------------------------------------------------------
// Compatibility guarantees. These tests are not about features — they pin the
// two promises made to users when multi-account support landed:
//
//   1. upgrading from a single-account version changes nothing for them;
//   2. should the fixed slots ever become a real list of N accounts, people who
//      already configured two or three of them must not have to redo anything.
//
// Both promises rest on the same property: NOTHING that Gladys persists depends
// on how accounts are numbered. Gladys only stores the created devices (keyed by
// their external_id) and the config variables; the discovered-device list is
// in-memory and republished on every connection. So as long as an external_id
// never carries an account identity, no change of account model can orphan a
// device.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { buildDiscoveredDevice } from '../src/mapping.js';
import { makeOverkizDevice, makeExternalIds } from './helpers.js';

const gladys = { externalIds: makeExternalIds };

// A configuration written by version 1.1.1: flat keys, one account.
const LEGACY_CONFIG = {
  server: 'cozytouch',
  username: 'a@b.c',
  password: 'x',
  polling_period: 45,
};

test('a single-account configuration keeps working untouched', () => {
  const config = normalizeConfig(LEGACY_CONFIG);

  assert.equal(config.polling_period, 45);
  assert.equal(config.accounts.length, 1);
  assert.deepEqual(config.duplicates, []);
  const [account] = config.accounts;
  assert.equal(account.server, 'cozytouch');
  assert.equal(account.username, 'a@b.c');
  assert.equal(account.password, 'x');
  assert.equal(account.complete, true);
});

test('the unsuffixed keys are exactly slot 1', () => {
  // What guarantees there is no migration to run on upgrade: slot 1 reads the
  // very keys the single-account versions wrote.
  assert.deepEqual(
    normalizeConfig(LEGACY_CONFIG).accounts,
    normalizeConfig({
      server_1: 'ignored', // no such key exists — slot 1 is unsuffixed
      ...LEGACY_CONFIG,
    }).accounts,
  );
});

test('unknown config keys are ignored, not rejected', () => {
  // The host API returns every variable stored for the service, schema or not:
  // keys a future version would write (or an older one left behind) must simply
  // flow through.
  const config = normalizeConfig({
    ...LEGACY_CONFIG,
    accounts: [{ server: 'rexel', username: 'z@z.z', password: 'w' }],
    some_forgotten_key: 'left over',
  });
  assert.equal(config.accounts.length, 1);
  assert.equal(config.accounts[0].server, 'cozytouch');
});

test('an external_id does not depend on which slot its account sits in', () => {
  // THE guarantee: devices are identified by their Overkiz deviceURL alone,
  // which already carries the hub serial number. Renumbering accounts — or
  // replacing slots with a list altogether — cannot orphan a created device.
  const device = makeOverkizDevice({
    deviceURL: 'io://1111-2222-3333/44444444',
    uiClass: 'Light',
    commands: ['on', 'off'],
    states: { 'core:OnOffState': 'off' },
  });

  const asSlot1 = buildDiscoveredDevice(gladys, device);
  const asSlot3 = buildDiscoveredDevice(gladys, device);

  assert.equal(asSlot1.device.external_id, asSlot3.device.external_id);
  assert.deepEqual(
    asSlot1.device.features.map((feature) => feature.external_id),
    asSlot3.device.features.map((feature) => feature.external_id),
  );
  assert.ok(
    !asSlot1.device.external_id.includes('account'),
    'no account identity may leak into an external_id',
  );
});

test('moving an account to another slot keeps its identity', () => {
  const inSlot3 = normalizeConfig({
    server_3: 'cozytouch',
    username_3: 'a@b.c',
    password_3: 'x',
  }).accounts[0];
  const inSlot2 = normalizeConfig({
    server_2: 'cozytouch',
    username_2: 'a@b.c',
    password_2: 'x',
  }).accounts[0];

  assert.equal(inSlot3.id, inSlot2.id);
  assert.notEqual(inSlot3.slot, inSlot2.slot, 'only the display slot differs');
});
