// -----------------------------------------------------------------------------
// Integration orchestration.
//
// Everything that happens between Gladys and the Overkiz cloud lives here:
// connection lifecycle, discovery, state publishing and command routing.
//
// The collaborators (`gladys`, `overkiz`, `logger`) and the timer are injected
// rather than imported, so the whole orchestration can be exercised in tests
// with plain fake objects — no network, no SDK, no Overkiz account, no waiting.
// -----------------------------------------------------------------------------

import { normalizeConfig, isConfigComplete, connectionConfigEquals } from './config.js';
import { buildDiscoveredDevice, stateToGladysValue, buildCommand } from './mapping.js';
import { describeOverkizError } from './errors.js';

// The host API accepts at most 100 states per request, and 300 states per
// minute per integration.
const STATES_PER_REQUEST = 100;
const STATES_PER_WINDOW = 300;
const RATE_WINDOW_MS = 60_000;
// How long to wait before replaying the states a failed publish left behind.
const RESYNC_DELAY_MS = 60_000;
// Reconnection backoff, only used for failures that can resolve on their own.
const RETRY_INITIAL_MS = 60_000;
const RETRY_MAX_MS = 15 * 60_000;

function defaultScheduleTimer(fn, delayMs) {
  const timer = setTimeout(fn, delayMs);
  timer.unref?.(); // never hold the process open just for a pending retry
  return () => clearTimeout(timer);
}

const defaultSleep = (delayMs) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
  });

export function createHandlers({
  gladys,
  overkiz,
  logger,
  scheduleTimer = defaultScheduleTimer,
  now = Date.now,
  sleep = defaultSleep,
}) {
  let config = normalizeConfig();

  // deviceURL -> { device external_id, entries: [{ key, stateName, invert, gladysFeature }] }
  let mappedDevices = new Map();
  // Gladys device external_id -> deviceURL, so commands resolve without a scan.
  let deviceUrlByExternalId = new Map();
  // feature external_id -> last value KNOWN TO BE PUBLISHED (only publish real
  // changes: the host API rate-limits state updates to 300 per minute).
  const lastValues = new Map();

  let cancelResync = null;
  let cancelRetry = null;
  let retryDelayMs = RETRY_INITIAL_MS;
  // Sliding window of accepted publishes: { at, count }.
  let recentPublishes = [];

  function mapAllDevices(devices) {
    mappedDevices = new Map();
    deviceUrlByExternalId = new Map();
    const discovered = [];
    for (const device of devices) {
      const mapped = buildDiscoveredDevice(gladys, device);
      if (mapped) {
        mappedDevices.set(device.deviceURL, mapped);
        deviceUrlByExternalId.set(mapped.device.external_id, device.deviceURL);
        discovered.push(mapped.device);
      }
    }
    return discovered;
  }

  /**
   * Publish a batch of changes, then — and only then — remember them.
   *
   * Recording a value before it is actually accepted would lose it for good:
   * the deduplication would consider it already published and skip it until the
   * device happens to change again, which for a smoke or leak sensor can be
   * months.
   */
  /**
   * Hold back until `count` more states fit in the 300-per-minute window.
   * A first scan on a large setup easily exceeds it, and a 429 would cost more
   * than the wait.
   */
  async function waitForPublishBudget(count) {
    for (;;) {
      const cutoff = now() - RATE_WINDOW_MS;
      recentPublishes = recentPublishes.filter((entry) => entry.at > cutoff);
      const used = recentPublishes.reduce((total, entry) => total + entry.count, 0);
      if (used + count <= STATES_PER_WINDOW || recentPublishes.length === 0) {
        return;
      }
      const waitMs = Math.max(0, recentPublishes[0].at + RATE_WINDOW_MS - now());
      logger.warn(`State rate limit reached, pausing ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }

  async function publishChanges(states) {
    for (let i = 0; i < states.length; i += STATES_PER_REQUEST) {
      const chunk = states.slice(i, i + STATES_PER_REQUEST);
      await waitForPublishBudget(chunk.length);
      try {
        await gladys.publishStates(chunk);
      } catch (err) {
        // Back off rather than hammer a rate-limited or restarting host.
        logger.error(`Failed to publish ${chunk.length} state(s), will resynchronize`, err);
        scheduleResync();
        return;
      }
      recentPublishes.push({ at: now(), count: chunk.length });
      for (const state of chunk) {
        lastValues.set(state.device_feature_external_id, state.state);
      }
    }
  }

  function scheduleResync() {
    if (cancelResync) {
      return; // one pending resynchronization is enough
    }
    cancelResync = scheduleTimer(() => {
      cancelResync = null;
      // `lastValues` was left untouched for whatever failed, so this republishes
      // exactly the values that were lost. The promise is returned so tests can
      // await the replay; the real timer ignores it.
      return publishAllStates().catch((err) => logger.error('State resynchronization failed', err));
    }, RESYNC_DELAY_MS);
  }

  /**
   * Diff every mapped feature against the last published value and publish
   * what changed.
   */
  async function publishAllStates() {
    const states = [];
    for (const [deviceUrl, mapped] of mappedDevices) {
      const device = overkiz.getDevice(deviceUrl);
      if (!device) {
        continue;
      }
      for (const entry of mapped.entries) {
        if (!entry.stateName) {
          continue;
        }
        const value = stateToGladysValue(entry, device.get(entry.stateName));
        if (value !== null && lastValues.get(entry.gladysFeature.external_id) !== value) {
          states.push({
            device_feature_external_id: entry.gladysFeature.external_id,
            state: value,
          });
        }
      }
    }
    await publishChanges(states);
  }

  /**
   * Connect to Overkiz and publish what was found.
   * Never throws: the outcome is returned so callers can report it accurately.
   *
   * @returns {Promise<{ status: 'ok', deviceCount: number }
   *   | { status: 'incomplete_config' }
   *   | { status: 'failed', error: ReturnType<typeof describeOverkizError> }>}
   */
  async function connect() {
    if (!isConfigComplete(config)) {
      logger.info('Overkiz configuration is incomplete, waiting for the user to fill it in');
      await gladys.setConnectionStatus(false, {
        en: 'Please fill in your Overkiz server and credentials in the Configuration tab.',
        fr: "Veuillez renseigner votre serveur et vos identifiants Overkiz dans l'onglet Configuration.",
      });
      return { status: 'incomplete_config' };
    }
    try {
      const devices = await overkiz.start(config);
      await gladys.publishDiscoveredDevices(mapAllDevices(devices));
      await publishAllStates();
      await gladys.setConnectionStatus(true);
      return { status: 'ok', deviceCount: mappedDevices.size };
    } catch (err) {
      const error = describeOverkizError(err);
      logger.error(`Failed to connect to the Overkiz API (${error.kind}): ${error.text}`);
      await gladys.setConnectionStatus(false, error.message);
      return { status: 'failed', error };
    }
  }

  /**
   * Connect, and arm an automatic retry when — and only when — the failure can
   * resolve on its own. Insisting on refused credentials or on an already
   * locked account would only make Overkiz lock it harder.
   */
  async function attemptConnect() {
    const result = await connect();
    if (result.status === 'failed' && result.error.transient) {
      scheduleRetry();
    } else {
      retryDelayMs = RETRY_INITIAL_MS;
    }
    return result;
  }

  function scheduleRetry() {
    const delayMs = retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
    logger.info(`Overkiz cloud unreachable, retrying in ${Math.round(delayMs / 1000)}s`);
    cancelRetry = scheduleTimer(() => {
      cancelRetry = null;
      return attemptConnect().catch((err) =>
        logger.error('Overkiz reconnection attempt failed', err),
      );
    }, delayMs);
  }

  /** A user-driven attempt supersedes any pending automatic one. */
  function connectNow() {
    cancelRetry?.();
    cancelRetry = null;
    retryDelayMs = RETRY_INITIAL_MS;
    return attemptConnect();
  }

  // Push state changes coming from the Overkiz event poller to Gladys.
  overkiz.onStates = async (device, states) => {
    const mapped = mappedDevices.get(device.deviceURL);
    if (!mapped) {
      return;
    }
    const updates = [];
    for (const state of states) {
      const entry = mapped.entries.find((e) => e.stateName === state.name);
      if (!entry) {
        continue;
      }
      const value = stateToGladysValue(entry, state.value);
      if (value !== null && lastValues.get(entry.gladysFeature.external_id) !== value) {
        updates.push({ device_feature_external_id: entry.gladysFeature.external_id, state: value });
      }
    }
    if (updates.length > 0) {
      await publishChanges(updates);
    }
  };

  overkiz.onConnectionChange = (connected) => {
    gladys
      .setConnectionStatus(
        connected,
        connected
          ? undefined
          : {
              en: 'Disconnected from the Overkiz API, reconnecting...',
              fr: "Déconnecté de l'API Overkiz, reconnexion...",
            },
      )
      .catch(() => {});
  };

  // --- Discovery: Gladys asks for the list of devices ------------------------
  async function scan() {
    logger.info('onScanRequest -> refreshing Overkiz devices');
    if (!overkiz.connected) {
      await connectNow();
      return;
    }
    const devices = await overkiz.refreshDevices();
    await gladys.publishDiscoveredDevices(mapAllDevices(devices));
    await publishAllStates();
  }

  // --- Command: the user acts on a controllable feature ----------------------
  async function setValue(device, feature, value) {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    const deviceUrl = deviceUrlByExternalId.get(device.external_id);
    if (!deviceUrl) {
      throw new Error(`Unknown Overkiz device ${device.external_id}`);
    }
    const entry = mappedDevices
      .get(deviceUrl)
      .entries.find((e) => e.gladysFeature.external_id === feature.external_id);
    if (!entry) {
      throw new Error(`Unknown feature ${feature.external_id}`);
    }
    const overkizDevice = overkiz.getDevice(deviceUrl);
    const command = overkizDevice && buildCommand(overkizDevice, entry, value);
    if (!command) {
      throw new Error(`No Overkiz command for ${feature.external_id} = ${value}`);
    }
    await overkiz.execute(deviceUrl, command, `Gladys - ${device.name ?? deviceUrl}`);

    // Optimistic echo: the event poller only confirms the move up to a polling
    // period later, and the UI would sit on the stale value until then. The
    // real state overwrites this one as soon as it arrives.
    if (entry.stateName) {
      await publishChanges([
        { device_feature_external_id: feature.external_id, state: Number(value) },
      ]);
    }
  }

  // --- Manifest action: test the connection ----------------------------------
  // The SDK only shows a result in red when the handler throws (a resolved
  // value is always shown in green, whatever it says) — so failures must
  // throw here, not return a message describing the failure.
  async function testConnection() {
    const result = await connectNow();
    if (result.status === 'incomplete_config') {
      throw new Error(
        "Configuration incomplete: fill in the server, email and password first. / Configuration incomplète : renseignez d'abord le serveur, l'email et le mot de passe.",
      );
    }
    if (result.status === 'failed') {
      throw new Error(`${result.error.message.en} / ${result.error.message.fr}`);
    }
    return {
      en: `Connection OK, ${result.deviceCount} supported device(s) found.`,
      fr: `Connexion OK, ${result.deviceCount} appareil(s) supporté(s) trouvé(s).`,
    };
  }

  // --- Configuration updated by the user -------------------------------------
  async function configUpdated(newConfig) {
    const normalized = normalizeConfig(newConfig);
    if (overkiz.connected && connectionConfigEquals(config, normalized)) {
      logger.info('onConfigUpdated -> no connection setting changed, keeping the session');
      config = normalized;
      return;
    }
    logger.info('onConfigUpdated -> reconnecting with the new configuration');
    config = normalized;
    lastValues.clear();
    await connectNow();
  }

  // --- Connection lifecycle ---------------------------------------------------
  async function gladysConnected() {
    try {
      const previous = config;
      config = normalizeConfig(await gladys.getConfig());
      // The Gladys WebSocket reconnects on its own with a backoff; each of those
      // reconnections used to trigger a full Overkiz login, and Overkiz locks
      // accounts that authenticate too often. The session is still valid here.
      if (overkiz.connected && connectionConfigEquals(previous, config)) {
        logger.info('Gladys reconnected, keeping the existing Overkiz session');
        await gladys.setConnectionStatus(true);
        return;
      }
      await connectNow();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        })
        .catch(() => {});
    }
  }

  // --- Graceful shutdown -------------------------------------------------------
  function shutdown(signal) {
    logger.info(`Received ${signal} -> graceful shutdown`);
    cancelResync?.();
    cancelResync = null;
    cancelRetry?.();
    cancelRetry = null;
    overkiz.stop();
  }

  return {
    scan,
    setValue,
    configUpdated,
    gladysConnected,
    shutdown,
    // Keyed by the action `key` declared in the manifest, so `index.js` wires
    // them generically and the manifest test can check the two never drift.
    actions: { test_connection: testConnection },
  };
}
