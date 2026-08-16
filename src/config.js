// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// A Gladys `config_schema` is a FLAT list of scalar fields — it has no array nor
// repeatable group — so several Overkiz accounts are declared as a fixed number
// of numbered slots. That shape is an artifact of the form, not of the domain:
// everything downstream consumes the canonical `accounts` list produced here,
// and `readLegacySlots` is the single place that knows about slots at all.
// -----------------------------------------------------------------------------

// How many accounts the form offers. Slot 1 keeps the unsuffixed keys of the
// single-account versions, so an existing configuration stays valid untouched.
export const ACCOUNT_SLOTS = [1, 2, 3];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (asserted by test/manifest.test.js), which is
// why they keep the flat shape of the form rather than the canonical one.
export const DEFAULT_CONFIG = {
  server: 'somfy_europe',
  username: '',
  password: '',
  server_2: 'somfy_europe',
  username_2: '',
  password_2: '',
  server_3: 'somfy_europe',
  username_3: '',
  password_3: '',
  polling_period: 30, // seconds, how often events are fetched from the cloud
};

// Short display names of the Overkiz servers, used to tell accounts apart in
// the connection status and in the action results. Kept in sync with the
// `server` options of the manifest by test/manifest.test.js.
export const SERVER_LABELS = {
  somfy_europe: 'Somfy Europe',
  somfy_australia: 'Somfy Australia',
  somfy_north_america: 'Somfy North America',
  cozytouch: 'Atlantic Cozytouch',
  flexom: 'Bouygues Flexom',
  rexel: 'Rexel Energeasy',
  hi_kumo: 'Hitachi Hi Kumo',
};

// Bounds of `polling_period`, kept in sync with the manifest `min` / `max`
// (asserted by test/manifest.test.js). Below 10 s the Overkiz cloud throttles;
// a value of 0 would silently DISABLE polling in overkiz-client.
export const POLLING_PERIOD_BOUNDS = { min: 10, max: 300 };

// The fields a connection actually depends on: changing anything else must not
// trigger a re-authentication against Overkiz.
const CONNECTION_FIELDS = ['server', 'username', 'password', 'polling_period'];

/**
 * @typedef {object} AccountConfig
 * @property {string} id Stable identity, `server:username`. Deliberately NOT
 *   derived from the slot: moving an account from one slot to another must not
 *   look like a different account, or it would re-authenticate for nothing.
 * @property {number} slot Which form slot it came from — display only.
 * @property {string} server
 * @property {string} username
 * @property {string} password
 * @property {number} polling_period Copy of the global setting, so the object
 *   can be handed to `Overkiz.start()` as-is.
 * @property {boolean} complete Whether it holds enough to attempt a connection.
 */

/**
 * Coerce a form value to a number inside `bounds`, falling back to `fallback`
 * for anything unusable — an emptied number field arrives as `''`, which
 * `Number()` turns into 0.
 */
function clampNumber(value, { min, max }, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || value === '' || value === null) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

// --- legacy: the flat numbered slots of the generated form -------------------
// The ONLY code that knows accounts are spelled out as `server`, `server_2`,
// `server_3`... in the config. Should the form ever become a real list of
// accounts, this is the single function to replace — every other module already
// consumes the canonical `AccountConfig[]` it returns.

/** `server` for slot 1, `server_2` for slot 2... */
export function accountFieldKey(slot, field) {
  return slot === 1 ? field : `${field}_${slot}`;
}

function trimmed(value, fallback) {
  return typeof value === 'string' ? value.trim() : fallback;
}

/**
 * Read the numbered slots of the raw config into the canonical account list.
 *
 * A slot the user left alone is dropped; one they half filled in is kept as
 * incomplete, so it can be reported rather than silently ignored.
 *
 * @returns {AccountConfig[]} in slot order, empty slots removed
 */
function readLegacySlots(raw, pollingPeriod) {
  const accounts = [];
  for (const slot of ACCOUNT_SLOTS) {
    const server = trimmed(raw[accountFieldKey(slot, 'server')], DEFAULT_CONFIG.server);
    const username = trimmed(raw[accountFieldKey(slot, 'username')], '');
    // Left as-is: a password may legitimately start or end with a space.
    const password = raw[accountFieldKey(slot, 'password')] ?? '';
    // A `select` always carries a value, so it can never mark a slot as unused:
    // only the credentials can.
    if (username === '' && password === '') {
      continue;
    }
    accounts.push({
      id: `${server}:${username.toLowerCase()}`,
      slot,
      server,
      username,
      password,
      polling_period: pollingPeriod,
      complete: Boolean(server && username && password),
    });
  }
  return accounts;
}

// --- end legacy --------------------------------------------------------------

/**
 * Merge the user config with the defaults and turn it into the canonical shape.
 *
 * @param {Record<string, unknown>} raw config returned by the SDK
 * @returns {{
 *   polling_period: number,
 *   accounts: AccountConfig[],
 *   duplicates: { slot: number, duplicateOf: number }[],
 * }}
 */
export function normalizeConfig(raw = {}) {
  const merged = { ...DEFAULT_CONFIG, ...raw };
  const pollingPeriod = clampNumber(
    merged.polling_period,
    POLLING_PERIOD_BOUNDS,
    DEFAULT_CONFIG.polling_period,
  );

  const accounts = [];
  const duplicates = [];
  const seen = new Map(); // account id -> slot that claimed it first
  for (const account of readLegacySlots(merged, pollingPeriod)) {
    // Two sessions on the same credentials would double the Overkiz listeners
    // for nothing, and logging in twice from the same address is exactly what
    // gets an account temporarily locked.
    const claimedBy = seen.get(account.id);
    if (claimedBy !== undefined) {
      duplicates.push({ slot: account.slot, duplicateOf: claimedBy });
      continue;
    }
    seen.set(account.id, account.slot);
    accounts.push(account);
  }

  return { polling_period: pollingPeriod, accounts, duplicates };
}

/**
 * True when the user filled in enough configuration to attempt a connection.
 */
export function isConfigComplete(config) {
  return config.accounts.length > 0 && config.accounts.every((account) => account.complete);
}

/**
 * True when two account configurations would produce the same Overkiz session.
 *
 * Guards against re-authenticating on every Gladys WebSocket reconnection:
 * Overkiz temporarily locks accounts that log in too often.
 */
export function connectionConfigEquals(a, b) {
  return Boolean(a) && Boolean(b) && CONNECTION_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * Human readable name of an account, for the connection status and the action
 * results: `Account 2 (Atlantic Cozytouch)`.
 */
export function describeAccount(account, lang = 'en') {
  const server = SERVER_LABELS[account.server] ?? account.server;
  const label = lang === 'fr' ? 'Compte' : 'Account';
  return `${label} ${account.slot} (${server})`;
}
