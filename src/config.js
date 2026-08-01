// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  server: 'somfy_europe',
  username: '',
  password: '',
  polling_period: 30, // seconds, how often events are fetched from the cloud
};

// Bounds of `polling_period`, kept in sync with the manifest `min` / `max`
// (asserted by test/manifest.test.js). Below 10 s the Overkiz cloud throttles;
// a value of 0 would silently DISABLE polling in overkiz-client.
export const POLLING_PERIOD_BOUNDS = { min: 10, max: 300 };

// The fields a connection actually depends on: changing anything else must not
// trigger a re-authentication against Overkiz.
const CONNECTION_FIELDS = ['server', 'username', 'password', 'polling_period'];

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

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    polling_period: clampNumber(
      raw.polling_period ?? DEFAULT_CONFIG.polling_period,
      POLLING_PERIOD_BOUNDS,
      DEFAULT_CONFIG.polling_period,
    ),
  };
}

/**
 * True when the user filled in enough configuration to attempt a connection.
 */
export function isConfigComplete(config) {
  return Boolean(config.server && config.username && config.password);
}

/**
 * True when two configurations would produce the same Overkiz session.
 *
 * Guards against re-authenticating on every Gladys WebSocket reconnection:
 * Overkiz temporarily locks accounts that log in too often.
 */
export function connectionConfigEquals(a, b) {
  return Boolean(a) && Boolean(b) && CONNECTION_FIELDS.every((field) => a[field] === b[field]);
}
