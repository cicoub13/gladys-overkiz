// -----------------------------------------------------------------------------
// Error classification: `overkiz-client` rejects with plain strings, so every
// shape has to be handled and turned into an actionable cause.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOverkizError, errorToText } from '../src/errors.js';

test('errorToText flattens every shape a rejection can take', () => {
  assert.equal(errorToText('Error 401 Bad credentials'), 'Error 401 Bad credentials');
  assert.equal(errorToText(new Error('boom')), 'boom');
  assert.equal(errorToText({ message: 'from an axios-like object' }), 'from an axios-like object');
  assert.equal(errorToText(undefined), 'undefined');
});

test('refused credentials are reported as such', () => {
  // The exact string overkiz-client throws on a bad password.
  const described = describeOverkizError('Error 401 Bad credentials (AUTHENTICATION_ERROR)');
  assert.equal(described.kind, 'credentials');
  assert.equal(described.transient, false, 'retrying a wrong password only locks the account');
  assert.match(described.message.fr, /identifiants/);
});

test('a locked account is distinguished from wrong credentials', () => {
  const described = describeOverkizError('Error 400 too many attempts, try again later');
  assert.equal(described.kind, 'locked');
  assert.equal(described.transient, false);
  assert.match(described.message.fr, /verrouillé/);
});

test('network failures are transient and worth retrying', () => {
  for (const raw of ['getaddrinfo ENOTFOUND ha101-1.overkiz.com', 'Error 503', 'socket hang up']) {
    const described = describeOverkizError(raw);
    assert.equal(described.kind, 'unreachable', `"${raw}" should be transient`);
    assert.equal(described.transient, true);
  }
});

test('an unrecognized failure keeps the raw text so it can be reported', () => {
  const described = describeOverkizError('Error 418 I am a teapot');
  assert.equal(described.kind, 'unknown');
  // A 4xx means the server understood the request and refused it: retrying
  // cannot help, whether or not the classifier can name the cause.
  assert.equal(described.transient, false);
  assert.match(described.message.en, /I am a teapot/);
});

test('a refusal the classifier cannot name is still never retried', () => {
  // `overkiz-client`'s OAuth token exchange (Cozytouch) throws this shape on a
  // bad password: a 4xx the regex classifier does not recognize as
  // "credentials". The HTTP status alone must be enough to stop the retry --
  // recreating the client on every attempt (see overkiz.js#start) would
  // otherwise reset overkiz-client's own anti-lockout backoff each time.
  for (const raw of ['Error 400 invalid_grant', 'Request failed with status code 400']) {
    const described = describeOverkizError(raw);
    assert.equal(described.transient, false, `"${raw}" should not be retried`);
  }
});

test('a failure with no HTTP status at all is still retried', () => {
  // No status means the request never reached the server (DNS, TCP, TLS...):
  // unlike a 4xx, retrying can genuinely help, and a whitelist by regex can
  // never name every such failure in advance.
  const described = describeOverkizError('write EPROTO 140:error:wrong version number');
  assert.equal(described.kind, 'unknown');
  assert.equal(described.transient, true);
});
