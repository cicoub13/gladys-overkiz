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

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    polling_period: Number(raw.polling_period ?? DEFAULT_CONFIG.polling_period),
  };
}

/**
 * True when the user filled in enough configuration to attempt a connection.
 */
export function isConfigComplete(config) {
  return Boolean(config.server && config.username && config.password);
}
