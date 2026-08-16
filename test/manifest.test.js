// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  POLLING_PERIOD_BOUNDS,
  ACCOUNT_SLOTS,
  SERVER_LABELS,
  accountFieldKey,
} from '../src/config.js';
import { createHandlers } from '../src/handlers.js';
import { makeFakeGladys, makeFakeOverkizPool } from './helpers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const field = (key) => manifest.config_schema.find((f) => f.key === key);

function makeHandlers() {
  return createHandlers({
    gladys: makeFakeGladys(),
    createOverkiz: makeFakeOverkizPool().createOverkiz,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
}

test('every manifest action has a registered handler', () => {
  // Ask the real factory what it exposes, so the manifest and the code cannot
  // drift apart behind a hard-coded list.
  const { actions } = makeHandlers();
  for (const action of manifest.actions ?? []) {
    assert.equal(
      typeof actions[action.key],
      'function',
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('every registered action handler is declared in the manifest', () => {
  const { actions } = makeHandlers();
  const declared = new Set((manifest.actions ?? []).map((a) => a.key));
  for (const key of Object.keys(actions)) {
    assert.ok(declared.has(key), `handler "${key}" is not declared in the manifest`);
  }
});

test('no action declares a form that would freeze the number of accounts', () => {
  // The account slots are an artifact of the flat config_schema, not a contract:
  // an action offering "pick account 1, 2 or 3" would have to change shape the
  // day accounts become a real list.
  for (const action of manifest.actions ?? []) {
    assert.equal(action.fields, undefined, `action "${action.key}" must not declare fields`);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const schemaField of manifest.config_schema) {
    if (schemaField.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[schemaField.key],
        schemaField.default,
        `DEFAULT_CONFIG.${schemaField.key} must match the manifest default`,
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
  const pollingPeriod = field('polling_period');
  assert.ok(pollingPeriod, 'the manifest declares a polling_period field');
  assert.equal(pollingPeriod.min, POLLING_PERIOD_BOUNDS.min);
  assert.equal(pollingPeriod.max, POLLING_PERIOD_BOUNDS.max);
  assert.equal(
    manifest.config_schema.filter((f) => f.key === 'polling_period').length,
    1,
    'the polling period is a single global setting, not one per account',
  );
});

test('every account slot declares the same three fields', () => {
  for (const slot of ACCOUNT_SLOTS) {
    for (const name of ['server', 'username', 'password']) {
      assert.ok(field(accountFieldKey(slot, name)), `slot ${slot} is missing ${name}`);
    }
  }
});

test('every password field is stored as a secret', () => {
  for (const slot of ACCOUNT_SLOTS) {
    assert.equal(field(accountFieldKey(slot, 'password')).type, 'secret');
  }
});

test('the optional slots are optional, and carry a valid server by default', () => {
  for (const slot of ACCOUNT_SLOTS.filter((s) => s !== 1)) {
    for (const name of ['server', 'username', 'password']) {
      assert.notEqual(
        field(accountFieldKey(slot, name)).required,
        true,
        `slot ${slot} ${name} must not be required, or the form is unsubmittable while empty`,
      );
    }
    // The form always renders an empty first option, and the host API rejects
    // '' on a select — a default is what keeps an untouched slot submittable.
    assert.ok(
      field(accountFieldKey(slot, 'server')).default,
      `slot ${slot} server needs a default`,
    );
  }
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
  for (const slot of ACCOUNT_SLOTS) {
    for (const option of field(accountFieldKey(slot, 'server')).options) {
      assert.ok(knownServices.has(option.value), `unknown Overkiz service "${option.value}"`);
    }
  }
});

test('the three server lists cannot drift apart', () => {
  // They have to be duplicated — the manifest format has no way to share a list
  // — so this is what keeps a server added to one slot from missing in another.
  const reference = field('server').options;
  for (const slot of ACCOUNT_SLOTS.filter((s) => s !== 1)) {
    assert.deepEqual(field(accountFieldKey(slot, 'server')).options, reference);
  }
});

test('every server has a short label for the connection status', () => {
  assert.deepEqual(
    Object.keys(SERVER_LABELS).sort(),
    field('server')
      .options.map((option) => option.value)
      .sort(),
  );
});
