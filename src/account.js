// -----------------------------------------------------------------------------
// One Overkiz account.
//
// Owns a single Overkiz session and the mapping of its devices, and nothing
// else: an account never calls `gladys` — it hands its devices and its states to
// the hub, which is the only place allowed to publish. That is what keeps two
// accounts from overwriting each other's discovery list or connection status.
//
// The reconnection backoff lives here too, so an unreachable account cannot
// delay the others.
// -----------------------------------------------------------------------------

import { buildDiscoveredDevice, stateToGladysValue, buildCommand } from './mapping.js';
import { describeOverkizError } from './errors.js';

// Reconnection backoff, only used for failures that can resolve on their own.
const RETRY_INITIAL_MS = 60_000;
const RETRY_MAX_MS = 15 * 60_000;

/**
 * Prefix every message of a logger, so lines coming from three sessions stay
 * tellable apart.
 *
 * The prefix is concatenated into the first argument when it is a string rather
 * than passed alongside it: callers format their own message, and a reader
 * grepping the logs expects one line, not a tuple.
 */
export function prefixLogger(logger, prefix) {
  const wrap =
    (fn) =>
    (first, ...rest) =>
      typeof first === 'string' ? fn(`${prefix} ${first}`, ...rest) : fn(prefix, first, ...rest);
  return {
    debug: wrap(logger.debug.bind(logger)),
    info: wrap(logger.info.bind(logger)),
    warn: wrap(logger.warn.bind(logger)),
    error: wrap(logger.error.bind(logger)),
  };
}

/**
 * @param {object} deps
 * @param {import('./config.js').AccountConfig} deps.config
 * @param {(type: string, platformId: string) => object} deps.externalIds The SDK
 *   helper — the only thing an account is given from `gladys`.
 * @param {object} deps.overkiz The `Overkiz` wrapper this account owns.
 * @param {object} deps.publisher Shared across the integration.
 * @param {() => Promise<void>} deps.onRetry Asks the hub for a full cycle:
 *   an account never republishes on its own.
 * @param {() => void} deps.onLinkChange The Overkiz link went up or down.
 */
export function createAccount({
  config,
  externalIds,
  overkiz,
  publisher,
  logger,
  scheduleTimer,
  onRetry,
  onLinkChange,
}) {
  // deviceURL -> { device external_id, entries: [{ key, stateName, invert,
  // watchedStates?, derive?, gladysFeature }] }
  let mappedDevices = new Map();
  // Gladys device external_id -> deviceURL, so commands resolve without a scan.
  let deviceUrlByExternalId = new Map();
  let lastError = null;
  let cancelRetry = null;
  let retryDelayMs = RETRY_INITIAL_MS;
  // The wrapper still owns a client after the cloud dropped the link — it is
  // the `disconnect` event, not the client, that tells the session is down.
  let linkUp = false;

  function mapAllDevices(devices) {
    mappedDevices = new Map();
    deviceUrlByExternalId = new Map();
    for (const device of devices) {
      // A single device the mapping chokes on must not cost the user every
      // other device of the account: without this, one throw here surfaces as
      // "connection failed" and the account discovers nothing at all.
      let mapped;
      try {
        mapped = buildDiscoveredDevice({ externalIds }, device);
      } catch (err) {
        // Only plain fields here: whatever made the mapping throw may well be
        // the device description itself, and a throwing error handler would
        // take down the very account this is meant to keep alive. Use the dump
        // action to see the rest of what the cloud says about it.
        logger.error(`Failed to map ${device.label} (${device.deviceURL}), skipping it`, err);
        continue;
      }
      if (mapped) {
        mappedDevices.set(device.deviceURL, mapped);
        deviceUrlByExternalId.set(mapped.device.external_id, device.deviceURL);
        // A cover reporting a position but no open/close/stop command means its
        // Overkiz commands didn't match any known pair — log them so unsupported
        // command sets (new protocols, unusual widgets) can be diagnosed and added.
        const hasPosition = mapped.entries.some((e) => e.key === 'position');
        const hasState = mapped.entries.some((e) => e.key === 'state');
        if (hasPosition && !hasState) {
          const commands = (device.definition?.commands ?? []).map((c) => c.commandName);
          logger.warn(
            `${device.label} (${device.definition?.uiClass}) has no open/close command. ` +
              `Available Overkiz commands: ${commands.join(', ') || '(none)'}`,
          );
        }
      }
    }
  }

  /**
   * Read the Gladys value of one mapped feature from the Overkiz device.
   *
   * Most features read a single Overkiz state; a few (the water heater mode)
   * are computed from several at once and carry a `derive` instead. Returns
   * null for a write-only feature or a value that must not be published.
   */
  function readEntryValue(entry, device) {
    if (entry.derive) {
      return entry.derive(device);
    }
    if (!entry.stateName) {
      return null;
    }
    return stateToGladysValue(entry, device.get(entry.stateName));
  }

  function scheduleRetry() {
    // A scheduled attempt REPLACES the pending one: a scan that reconnects a
    // failing account goes straight to `connect()` without cancelling anything,
    // and losing the previous cancel function here left both timers running —
    // the attempts then double at every round, which is exactly how an Overkiz
    // account gets temporarily locked.
    cancelRetry?.();
    const delayMs = retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
    logger.info(`Reconnecting to Overkiz in ${Math.round(delayMs / 1000)}s`);
    cancelRetry = scheduleTimer(() => {
      cancelRetry = null;
      return onRetry().catch((err) => logger.error('Overkiz reconnection attempt failed', err));
    }, delayMs);
  }

  // Push state changes coming from the Overkiz event poller to the hub's
  // publisher.
  overkiz.onStates = async (device, states) => {
    const mapped = mappedDevices.get(device.deviceURL);
    if (!mapped) {
      return;
    }
    const updates = [];
    const seen = new Set();
    for (const state of states) {
      // A derived feature is fed by several states, and any of them changing
      // means recomputing it — once per batch, not once per state.
      const matches = mapped.entries.filter(
        (e) => e.stateName === state.name || e.watchedStates?.includes(state.name),
      );
      for (const entry of matches) {
        if (seen.has(entry)) {
          continue;
        }
        seen.add(entry);
        // `overkiz-client` writes the new values into the device before it
        // emits, so a derived entry reads fresh values back from it here.
        const value = entry.derive ? entry.derive(device) : stateToGladysValue(entry, state.value);
        if (value !== null && publisher.lastValue(entry.gladysFeature.external_id) !== value) {
          updates.push({
            device_feature_external_id: entry.gladysFeature.external_id,
            state: value,
          });
        }
      }
    }
    if (updates.length > 0) {
      await publisher.publish(updates);
    }
  };

  overkiz.onConnectionChange = (connected) => {
    linkUp = connected;
    if (connected) {
      logger.info('Connected to the Overkiz API');
      lastError = null;
      // The session came back on its own — an expired token followed by a
      // successful re-authentication. The attempt scheduled below is moot now,
      // and logging in for nothing is what gets an account locked.
      cancelRetry?.();
      cancelRetry = null;
      retryDelayMs = RETRY_INITIAL_MS;
    } else {
      logger.warn('Disconnected from the Overkiz API');
      // `overkiz-client` STOPS its own refresh and polling timers when it loses
      // the session, and never logs in again by itself — so nothing would ever
      // bring the account back. Worse, its `connectPromise` keeps the rejection
      // of a failed re-authentication for good, so only a brand new client
      // recovers: that is what `overkiz.start()` does, and what this retry
      // eventually calls. The 60s initial delay leaves a plain token expiry —
      // one HTTP round trip — the time to heal on its own first.
      scheduleRetry();
    }
    onLinkChange();
  };

  return {
    id: config.id,
    slot: config.slot,
    config,

    get connected() {
      return overkiz.connected && linkUp;
    },
    get lastError() {
      return lastError;
    },
    get deviceCount() {
      return mappedDevices.size;
    },

    /**
     * Open the session and map what it exposes. Publishes nothing: the hub does
     * that, once it has gathered every account's contribution.
     *
     * Never throws: the outcome is returned so callers can report it accurately.
     *
     * @returns {Promise<{ status: 'ok', deviceCount: number }
     *   | { status: 'failed', error: ReturnType<typeof describeOverkizError> }>}
     */
    async connect() {
      try {
        mapAllDevices(await overkiz.start(config));
        lastError = null;
        linkUp = true;
        return { status: 'ok', deviceCount: mappedDevices.size };
      } catch (err) {
        lastError = describeOverkizError(err);
        logger.error(`Failed to connect to the Overkiz API (${lastError.kind}): ${lastError.text}`);
        // Insisting on refused credentials or on an already locked account would
        // only make Overkiz lock it harder.
        if (lastError.transient) {
          scheduleRetry();
        } else {
          retryDelayMs = RETRY_INITIAL_MS;
        }
        return { status: 'failed', error: lastError };
      }
    },

    /** Drop a pending automatic attempt: a user-driven one supersedes it. */
    cancelRetry() {
      cancelRetry?.();
      cancelRetry = null;
      retryDelayMs = RETRY_INITIAL_MS;
    },

    async refresh() {
      mapAllDevices(await overkiz.refreshDevices());
    },

    rawDevices() {
      return overkiz.refreshDevices();
    },

    /** This account's contribution to the integration-wide discovery list. */
    discoveredDevices() {
      return Array.from(mappedDevices.values(), (mapped) => mapped.device);
    },

    /** Every feature id this account owns, to be forgotten when it goes away. */
    *featureIds() {
      for (const mapped of mappedDevices.values()) {
        for (const entry of mapped.entries) {
          yield entry.gladysFeature.external_id;
        }
      }
    },

    /** Diff every mapped feature against the last published value. */
    collectStates() {
      const states = [];
      for (const [deviceUrl, mapped] of mappedDevices) {
        const device = overkiz.getDevice(deviceUrl);
        if (!device) {
          continue;
        }
        for (const entry of mapped.entries) {
          const value = readEntryValue(entry, device);
          if (value !== null && publisher.lastValue(entry.gladysFeature.external_id) !== value) {
            states.push({
              device_feature_external_id: entry.gladysFeature.external_id,
              state: value,
            });
          }
        }
      }
      return states;
    },

    ownsDevice(deviceExternalId) {
      return deviceUrlByExternalId.has(deviceExternalId);
    },

    /**
     * Forget what is known to have been published for one device.
     *
     * States published for a device the user has NOT created yet are accepted by
     * the host API and silently dropped — it has no feature to attach them to —
     * but they were still recorded as published. The device then stayed empty in
     * Gladys until each of its states happened to change on its own, which for a
     * water heater mode, a setpoint or a boost can be days.
     *
     * @returns {boolean} whether the device is one of ours and was forgotten.
     */
    forgetDeviceValues(deviceExternalId) {
      const deviceUrl = deviceUrlByExternalId.get(deviceExternalId);
      const mapped = deviceUrl ? mappedDevices.get(deviceUrl) : null;
      if (!mapped) {
        return false;
      }
      publisher.forget(mapped.entries.map((entry) => entry.gladysFeature.external_id));
      return true;
    },

    async setValue(device, feature, value) {
      const deviceUrl = deviceUrlByExternalId.get(device.external_id);
      const entry = mappedDevices
        .get(deviceUrl)
        .entries.find((e) => e.gladysFeature.external_id === feature.external_id);
      if (!entry) {
        throw new Error(`Unknown feature ${feature.external_id}`);
      }
      const overkizDevice = overkiz.getDevice(deviceUrl);
      const command = overkizDevice && buildCommand(overkizDevice, entry, value);
      if (!command || (Array.isArray(command) && command.length === 0)) {
        throw new Error(`No Overkiz command for ${feature.external_id} = ${value}`);
      }
      await overkiz.execute(deviceUrl, command, `Gladys - ${device.name ?? deviceUrl}`);

      // Optimistic echo: the event poller only confirms the move up to a polling
      // period later, and the UI would sit on the stale value until then. The
      // real state overwrites this one as soon as it arrives.
      if (entry.stateName || entry.derive) {
        await publisher.publish([
          { device_feature_external_id: feature.external_id, state: Number(value) },
        ]);
      }
    },

    stop() {
      cancelRetry?.();
      cancelRetry = null;
      overkiz.stop();
    },
  };
}
