// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, POLLING_PERIOD_BOUNDS } from '../src/config.js';
import { createHandlers } from '../src/handlers.js';
import { makeFakeGladys, makeFakeOverkiz } from './helpers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('every manifest action has a registered handler', () => {
  // Ask the real factory what it exposes, so the manifest and the code cannot
  // drift apart behind a hard-coded list.
  const { actions } = createHandlers({
    gladys: makeFakeGladys(),
    overkiz: makeFakeOverkiz(),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  for (const action of manifest.actions ?? []) {
    assert.equal(
      typeof actions[action.key],
      'function',
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('every registered action handler is declared in the manifest', () => {
  const { actions } = createHandlers({
    gladys: makeFakeGladys(),
    overkiz: makeFakeOverkiz(),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const declared = new Set((manifest.actions ?? []).map((a) => a.key));
  for (const key of Object.keys(actions)) {
    assert.ok(declared.has(key), `handler "${key}" is not declared in the manifest`);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('the polling period bounds match the ones the code enforces', () => {
  // The manifest bounds are only advisory (a form can still submit anything);
  // normalizeConfig is what actually enforces them, so the two must agree.
  const field = manifest.config_schema.find((f) => f.key === 'polling_period');
  assert.ok(field, 'the manifest declares a polling_period field');
  assert.equal(field.min, POLLING_PERIOD_BOUNDS.min);
  assert.equal(field.max, POLLING_PERIOD_BOUNDS.max);
});

test('the password field is stored as a secret', () => {
  const password = manifest.config_schema.find((f) => f.key === 'password');
  assert.ok(password, 'the manifest declares a password field');
  assert.equal(password.type, 'secret');
});

test('every server option is a service known to overkiz-client', () => {
  const knownServices = new Set([
    'local',
    'tahoma',
    'tahoma_switch',
    'connexoon',
    'somfy_europe',
    'connexoon_rts',
    'somfy_australia',
    'somfy_north_america',
    'flexom',
    'cozytouch',
    'rexel',
    'hi_kumo',
  ]);
  const server = manifest.config_schema.find((f) => f.key === 'server');
  assert.ok(server, 'the manifest declares a server field');
  for (const option of server.options) {
    assert.ok(knownServices.has(option.value), `unknown Overkiz service "${option.value}"`);
  }
});
