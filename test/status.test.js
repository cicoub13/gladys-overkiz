import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConnectionStatus } from '../src/status.js';
import { describeOverkizError } from '../src/errors.js';

function makeStatus({
  slot = 1,
  server = 'somfy_europe',
  connected = true,
  complete = true,
  error,
}) {
  const described = error ? describeOverkizError(error) : null;
  return {
    account: { slot, server, username: 'a@b.c' },
    connected,
    complete,
    kind: described?.kind ?? null,
    message: described?.message ?? null,
  };
}

test('no configured account asks the user to fill the form in', () => {
  const status = buildConnectionStatus([]);
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Configuration/);
  assert.match(status.message.en, /Configuration/);
});

test('every account connected reports green without a message', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1 }),
    makeStatus({ slot: 2, server: 'cozytouch' }),
  ]);
  assert.deepEqual(status, { connected: true });
});

test('a lone failing account keeps the full message of errors.js', () => {
  // Non-regression for single-account users: the wording must not change.
  const status = buildConnectionStatus([
    makeStatus({ connected: false, error: '401 Unauthorized' }),
  ]);
  assert.equal(status.connected, false);
  assert.deepEqual(status.message, describeOverkizError('401 Unauthorized').message);
});

test('one failure among several names the account and its server', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1 }),
    makeStatus({ slot: 2, server: 'cozytouch', connected: false, error: '401 Unauthorized' }),
  ]);
  assert.equal(status.connected, false);
  assert.equal(status.message.fr, 'Compte 2 (Atlantic Cozytouch) : identifiants refusés');
  assert.equal(status.message.en, 'Account 2 (Atlantic Cozytouch): credentials refused');
});

test('only the failing accounts are listed', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1, connected: false, error: 'ETIMEDOUT' }),
    makeStatus({ slot: 2, server: 'cozytouch' }),
    makeStatus({ slot: 3, server: 'rexel', connected: false, error: '429 Too many requests' }),
  ]);
  assert.equal(
    status.message.fr,
    'Compte 1 (Somfy Europe) : cloud Overkiz injoignable · Compte 3 (Rexel Energeasy) : compte temporairement verrouillé',
  );
  assert.ok(!status.message.en.includes('Account 2'));
});

test('an unknown failure falls back on a generic reason', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1 }),
    makeStatus({ slot: 2, connected: false, error: 'something odd happened' }),
  ]);
  assert.match(status.message.en, /connection failed$/);
  assert.match(status.message.fr, /connexion échouée$/);
});

test('a half filled slot is reported as missing credentials, not as a failure', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1 }),
    makeStatus({ slot: 2, server: 'cozytouch', connected: false, complete: false }),
  ]);
  assert.equal(status.connected, false);
  assert.equal(status.message.fr, 'Compte 2 (Atlantic Cozytouch) : email ou mot de passe manquant');
  assert.equal(status.message.en, 'Account 2 (Atlantic Cozytouch): email or password missing');
});

test('an account that dropped its link without an error says so', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1 }),
    makeStatus({ slot: 2, server: 'cozytouch', connected: false }),
  ]);
  assert.match(status.message.fr, /déconnecté, reconnexion$/);
  assert.match(status.message.en, /disconnected, reconnecting$/);
});

test('a lone account whose link dropped keeps the wording of earlier versions', () => {
  // `message` is null when the link dropped rather than failed to open, so the
  // single-account shortcut needs its own sentence — the one 1.1.1 showed.
  const status = buildConnectionStatus([makeStatus({ connected: false })]);
  assert.equal(status.connected, false);
  assert.equal(status.message.fr, "Déconnecté de l'API Overkiz, reconnexion...");
  assert.equal(status.message.en, 'Disconnected from the Overkiz API, reconnecting...');
});

test('a lone half filled slot is told what is missing, not that it disconnected', () => {
  const status = buildConnectionStatus([makeStatus({ connected: false, complete: false })]);
  assert.match(status.message.fr, /email ou mot de passe manquant/);
});

test('an unknown server value falls back on its raw name', () => {
  const status = buildConnectionStatus([
    makeStatus({ slot: 1 }),
    makeStatus({ slot: 2, server: 'brand_new_server', connected: false, error: '401' }),
  ]);
  assert.match(status.message.en, /Account 2 \(brand_new_server\)/);
});
