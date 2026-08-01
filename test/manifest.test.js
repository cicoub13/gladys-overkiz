// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// Actions registered in index.js.
const REGISTERED_ACTIONS = ['test_connection'];

test('every manifest action has a registered handler', () => {
  const handled = new Set(REGISTERED_ACTIONS);
  for (const action of manifest.actions ?? []) {
    assert.ok(handled.has(action.key), `manifest action "${action.key}" has no handler`);
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
