import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  DEFAULT_CONFIG,
  POLLING_PERIOD_BOUNDS,
  isConfigComplete,
  connectionConfigEquals,
  describeAccount,
  accountFieldKey,
} from '../src/config.js';

const ACCOUNT_1 = { server: 'somfy_europe', username: 'a@b.c', password: 'x' };

test('normalizeConfig returns no account when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), {
    polling_period: DEFAULT_CONFIG.polling_period,
    accounts: [],
    duplicates: [],
  });
});

test('normalizeConfig keeps user values over the defaults', () => {
  const [account] = normalizeConfig({
    server: 'cozytouch',
    username: 'a@b.c',
    password: 'x',
  }).accounts;
  assert.equal(account.server, 'cozytouch');
  assert.equal(account.username, 'a@b.c');
  assert.equal(account.password, 'x');
  assert.equal(account.slot, 1);
  assert.equal(account.complete, true);
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

test('the polling period is global and copied into every account', () => {
  const { accounts } = normalizeConfig({
    ...ACCOUNT_1,
    username_2: 'c@d.e',
    password_2: 'y',
    polling_period: 45,
  });
  assert.deepEqual(
    accounts.map((account) => account.polling_period),
    [45, 45],
  );
});

test('isConfigComplete requires every configured account to be usable', () => {
  assert.equal(isConfigComplete(normalizeConfig()), false);
  assert.equal(isConfigComplete(normalizeConfig({ username: 'a@b.c' })), false);
  assert.equal(isConfigComplete(normalizeConfig(ACCOUNT_1)), true);
  assert.equal(
    isConfigComplete(normalizeConfig({ ...ACCOUNT_1, username_2: 'c@d.e' })),
    false,
    'a half filled second slot makes the whole configuration incomplete',
  );
});

test('connectionConfigEquals only looks at the fields a session depends on', () => {
  const [base] = normalizeConfig(ACCOUNT_1).accounts;

  assert.equal(connectionConfigEquals(base, { ...base }), true);
  assert.equal(
    connectionConfigEquals(base, { ...base, slot: 3, some_unrelated_field: 'new' }),
    true,
    'an unrelated setting — the slot included — must not trigger a re-authentication',
  );

  for (const field of ['server', 'username', 'password']) {
    assert.equal(
      connectionConfigEquals(base, { ...base, [field]: 'changed' }),
      false,
      `${field} must trigger a reconnection`,
    );
  }
  assert.equal(connectionConfigEquals(base, { ...base, polling_period: 60 }), false);
});

// --- slots -------------------------------------------------------------------

test('accountFieldKey leaves slot 1 unsuffixed', () => {
  assert.equal(accountFieldKey(1, 'server'), 'server');
  assert.equal(accountFieldKey(2, 'username'), 'username_2');
  assert.equal(accountFieldKey(3, 'password'), 'password_3');
});

test('normalizeConfig reads the three slots in order', () => {
  const { accounts } = normalizeConfig({
    ...ACCOUNT_1,
    server_2: 'cozytouch',
    username_2: 'c@d.e',
    password_2: 'y',
    server_3: 'rexel',
    username_3: 'f@g.h',
    password_3: 'z',
  });
  assert.deepEqual(
    accounts.map((account) => [account.slot, account.server]),
    [
      [1, 'somfy_europe'],
      [2, 'cozytouch'],
      [3, 'rexel'],
    ],
  );
});

test('an untouched slot is dropped, whatever its server says', () => {
  // A `select` always carries a value, so `server_2` alone can never mean
  // "there is a second account".
  const { accounts } = normalizeConfig({ ...ACCOUNT_1, server_2: 'cozytouch' });
  assert.equal(accounts.length, 1);
});

test('a half filled slot is kept as incomplete rather than ignored', () => {
  const { accounts } = normalizeConfig({ ...ACCOUNT_1, username_2: 'c@d.e' });
  assert.equal(accounts.length, 2);
  assert.equal(accounts[1].complete, false);
  assert.equal(accounts[0].complete, true);
});

test('server and username are trimmed, the password is not', () => {
  const [account] = normalizeConfig({
    server: ' somfy_europe ',
    username: ' a@b.c ',
    password: ' x ',
  }).accounts;
  assert.equal(account.server, 'somfy_europe');
  assert.equal(account.username, 'a@b.c');
  assert.equal(account.password, ' x ', 'a password may legitimately hold spaces');
});

test('the same credentials in two slots are deduplicated', () => {
  const config = normalizeConfig({
    ...ACCOUNT_1,
    server_3: 'somfy_europe',
    username_3: 'A@B.C', // same account, different casing
    password_3: 'x',
  });
  assert.equal(config.accounts.length, 1);
  assert.deepEqual(config.duplicates, [{ slot: 3, duplicateOf: 1 }]);
});

test('the same email on two different servers is two accounts', () => {
  const config = normalizeConfig({
    ...ACCOUNT_1,
    server_2: 'cozytouch',
    username_2: 'a@b.c',
    password_2: 'x',
  });
  assert.equal(config.accounts.length, 2);
  assert.deepEqual(config.duplicates, []);
});

test('describeAccount names the slot and its server', () => {
  const [account] = normalizeConfig({ ...ACCOUNT_1, server: 'cozytouch' }).accounts;
  assert.equal(describeAccount(account, 'en'), 'Account 1 (Atlantic Cozytouch)');
  assert.equal(describeAccount(account, 'fr'), 'Compte 1 (Atlantic Cozytouch)');
});
