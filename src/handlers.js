// -----------------------------------------------------------------------------
// Integration orchestration.
//
// Everything that happens between Gladys and the Overkiz cloud lives here:
// connection lifecycle, discovery, state publishing and command routing.
//
// Up to three Overkiz accounts run side by side, but three things stay strictly
// integration-wide and are held here rather than per account:
//   - the discovery list, which the host API REPLACES on every publish, so it
//     has to carry the union of every account's devices;
//   - the 300-states-per-minute budget, which the host API counts per
//     integration (see publisher.js);
//   - the connection status, a single boolean the host API shows once.
//
// The collaborators (`gladys`, `logger`, `createOverkiz`) and the timer are
// injected rather than imported, so the whole orchestration can be exercised in
// tests with plain fake objects — no network, no SDK, no Overkiz account, no
// waiting.
// -----------------------------------------------------------------------------

import { normalizeConfig, connectionConfigEquals, describeAccount } from './config.js';
import { createAccount, prefixLogger } from './account.js';
import { createPublisher } from './publisher.js';
import { buildConnectionStatus } from './status.js';

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
  createOverkiz,
  logger,
  scheduleTimer = defaultScheduleTimer,
  now = Date.now,
  sleep = defaultSleep,
}) {
  let config = normalizeConfig();
  /** Live sessions, in slot order. Only accounts complete enough to connect. */
  let accounts = [];
  // Overkiz wrappers memoized by account IDENTITY, not by slot: moving an
  // account from one slot to another must not look like a new account and
  // re-authenticate — Overkiz locks accounts that log in too often.
  const overkizById = new Map();

  const publisher = createPublisher({
    gladys,
    logger,
    scheduleTimer,
    now,
    sleep,
    resync: () => publishAllStates(),
  });

  // --- integration-wide publishing -------------------------------------------

  /**
   * Publish the union of every account's devices.
   *
   * The host API replaces the whole discovery list on each call, so a single
   * account publishing on its own would erase the others. A disconnected
   * account contributes nothing and its devices leave the Discovery screen —
   * the ones the user already created are untouched — and come back on its
   * next connection.
   */
  async function publishDiscovered() {
    const byExternalId = new Map();
    for (const account of accounts) {
      for (const device of account.discoveredDevices()) {
        if (byExternalId.has(device.external_id)) {
          logger.warn(
            `Two accounts expose the same device ${device.external_id}, keeping the first`,
          );
          continue;
        }
        byExternalId.set(device.external_id, device);
      }
    }
    await gladys.publishDiscoveredDevices([...byExternalId.values()]);
  }

  /** Diff every account's features and publish what changed, in one batch. */
  async function publishAllStates() {
    await publisher.publish(accounts.flatMap((account) => account.collectStates()));
  }

  // --- connection status ------------------------------------------------------

  function accountStatuses() {
    return config.accounts.map((accountConfig) => {
      const session = accounts.find((account) => account.id === accountConfig.id);
      return {
        account: accountConfig,
        connected: session?.connected ?? false,
        complete: accountConfig.complete,
        kind: session?.lastError?.kind ?? null,
        message: session?.lastError?.message ?? null,
      };
    });
  }

  /** The only caller of `setConnectionStatus`. */
  async function refreshConnectionStatus() {
    const { connected, message } = buildConnectionStatus(accountStatuses());
    await gladys.setConnectionStatus(connected, message);
  }

  // --- account lifecycle ------------------------------------------------------

  function makeAccount(accountConfig) {
    let overkiz = overkizById.get(accountConfig.id);
    if (!overkiz) {
      overkiz = createOverkiz(accountConfig);
      overkizById.set(accountConfig.id, overkiz);
    }
    return createAccount({
      config: accountConfig,
      externalIds: gladys.externalIds,
      overkiz,
      publisher,
      logger: prefixLogger(logger, `[account ${accountConfig.slot}]`),
      scheduleTimer,
      onRetry: () => connectAccount(findAccount(accountConfig.id)),
      onLinkChange: () => {
        refreshConnectionStatus().catch(() => {});
      },
    });
  }

  function findAccount(id) {
    return accounts.find((account) => account.id === id);
  }

  /**
   * Connect one account and republish everything that depends on it.
   *
   * The order matters: the discovery list has to hold a device before its
   * states are accepted, so the union always goes out first.
   */
  async function connectAccount(account) {
    if (!account) {
      return { status: 'failed', error: null };
    }
    const result = await account.connect();
    await publishDiscovered();
    await publishAllStates();
    await refreshConnectionStatus();
    return result;
  }

  /**
   * Bring the live sessions in line with a new configuration.
   *
   * An account whose connection settings did not move keeps its session: the
   * Gladys WebSocket reconnects on its own with a backoff, and each of those
   * reconnections used to trigger a full Overkiz login.
   */
  async function applyConfig(nextConfig) {
    const previous = accounts;
    const kept = [];
    const toConnect = [];

    for (const accountConfig of nextConfig.accounts.filter((a) => a.complete)) {
      const existing = previous.find((account) => account.id === accountConfig.id);
      if (
        existing &&
        existing.connected &&
        connectionConfigEquals(existing.config, accountConfig)
      ) {
        kept.push(existing);
        continue;
      }
      if (existing) {
        existing.stop();
        publisher.forget(existing.featureIds());
      }
      const account = makeAccount(accountConfig);
      kept.push(account);
      toConnect.push(account);
    }

    // Slots the user emptied, half filled, or turned into a duplicate: their
    // values must be forgotten too, or putting the account back would find them
    // already "published" and show empty devices.
    const removed = previous.filter((account) => !kept.includes(account));
    for (const account of removed) {
      account.stop();
      publisher.forget(account.featureIds());
    }

    accounts = kept.sort((a, b) => a.slot - b.slot);
    config = nextConfig;

    // Every credential the user ever typed would otherwise keep a stopped
    // wrapper alive in a 192 MB heap.
    const live = new Set(accounts.map((account) => account.id));
    for (const id of overkizById.keys()) {
      if (!live.has(id)) {
        overkizById.delete(id);
      }
    }

    for (const duplicate of nextConfig.duplicates) {
      logger.warn(
        `Account ${duplicate.slot} holds the same credentials as account ${duplicate.duplicateOf}, ignoring it`,
      );
    }
    if (accounts.length === 0) {
      logger.info('Overkiz configuration is incomplete, waiting for the user to fill it in');
    }

    // Sequentially, in slot order: three logins fired at once from one public
    // address is how you get throttled, and it keeps the publishing order
    // deterministic. Each one republishes the union as it lands, so a healthy
    // account shows up without waiting on a slow one behind it.
    for (const account of toConnect) {
      await connectAccount(account);
    }
    // Removing an account changes the union too, and nothing above would have
    // republished it when there was nothing left to connect.
    if (removed.length > 0 && toConnect.length === 0) {
      await publishDiscovered();
    }
  }

  /** A user-driven attempt supersedes any pending automatic one. */
  async function connectAll() {
    for (const account of accounts) {
      account.cancelRetry();
    }
    const results = [];
    for (const account of accounts) {
      results.push({ account, result: await connectAccount(account) });
    }
    return results;
  }

  // --- Discovery: Gladys asks for the list of devices ------------------------
  async function scan() {
    logger.info('onScanRequest -> refreshing Overkiz devices');
    for (const account of accounts) {
      if (!account.connected) {
        await connectAccount(account);
      } else {
        await account.refresh();
      }
    }
    await publishDiscovered();
    await publishAllStates();
    await refreshConnectionStatus();
  }

  // --- Command: the user acts on a controllable feature ----------------------
  async function setValue(device, feature, value) {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    const account = accounts.find((candidate) => candidate.ownsDevice(device.external_id));
    if (!account) {
      throw new Error(`Unknown Overkiz device ${device.external_id}`);
    }
    await account.setValue(device, feature, value);
  }

  // --- Device lifecycle -------------------------------------------------------

  /**
   * The user created (or updated) one of the discovered devices: its features
   * exist in Gladys now, so publish everything we know about it.
   */
  async function deviceCreated(device) {
    logger.info(`onDeviceCreated <- ${device.external_id}`);
    if (accounts.some((account) => account.forgetDeviceValues(device.external_id))) {
      await publishAllStates();
    }
  }

  /** Deleting a device must not leave its values behind: recreating it later
   * would find them already "published" and show an empty device again. */
  async function deviceDeleted(device) {
    logger.info(`onDeviceDeleted <- ${device.external_id}`);
    accounts.some((account) => account.forgetDeviceValues(device.external_id));
  }

  // --- Manifest action: test the connection ----------------------------------
  // The SDK only shows a result in red when the handler throws (a resolved
  // value is always shown in green, whatever it says) — so failures must
  // throw here, not return a message describing the failure.
  async function testConnection() {
    if (config.accounts.length === 0) {
      throw new Error(
        "Configuration incomplete: fill in the server, email and password first. / Configuration incomplète : renseignez d'abord le serveur, l'email et le mot de passe.",
      );
    }
    const results = await connectAll();

    const failures = results
      .filter(({ result }) => result.status === 'failed')
      .map(({ account, result }) => ({ account: account.config, message: result.error.message }));
    // A slot with only an email or only a password never got a session at all.
    for (const accountConfig of config.accounts.filter((a) => !a.complete)) {
      failures.push({
        account: accountConfig,
        message: {
          en: 'email or password missing',
          fr: 'email ou mot de passe manquant',
        },
      });
    }

    if (failures.length > 0) {
      // One account carries no ambiguity about which one failed: it keeps the
      // wording the single-account versions used.
      if (config.accounts.length === 1) {
        throw new Error(`${failures[0].message.en} / ${failures[0].message.fr}`);
      }
      const describe = (lang) =>
        failures
          .map(
            ({ account, message }) =>
              `${describeAccount(account, lang)}${lang === 'fr' ? ' : ' : ': '}${message[lang]}`,
          )
          .join(' · ');
      throw new Error(`${describe('en')} / ${describe('fr')}`);
    }

    if (results.length === 1) {
      const { deviceCount } = results[0].result;
      return {
        en: `Connection OK, ${deviceCount} supported device(s) found.`,
        fr: `Connexion OK, ${deviceCount} appareil(s) supporté(s) trouvé(s).`,
      };
    }

    const summary = (lang) =>
      results
        .map(
          ({ account, result }) =>
            `${describeAccount(account.config, lang)}${lang === 'fr' ? ' : ' : ': '}${result.deviceCount}`,
        )
        .join(' · ');
    return {
      en: `Connection OK — supported devices per account: ${summary('en')}.`,
      fr: `Connexion OK — appareils supportés par compte : ${summary('fr')}.`,
    };
  }

  // --- Manifest action: dump the raw devices ---------------------------------
  /**
   * Log every Overkiz device exactly as the cloud describes it.
   *
   * Overkiz exposes heating and hot water appliances through vendor-specific
   * dialects, and mapping one needs its real uiClass, states and commands —
   * which nothing else in a Gladys installation shows. The dump is far too
   * large for the message displayed under the button, so it goes to the logs
   * and only a summary comes back.
   */
  async function dumpDevices() {
    const connected = accounts.filter((account) => account.connected);
    if (connected.length === 0) {
      return {
        en: 'Not connected to Overkiz: test the connection first.',
        fr: "Non connecté à Overkiz : testez d'abord la connexion.",
      };
    }

    const counts = [];
    for (const account of connected) {
      const devices = await account.rawDevices();
      for (const device of devices) {
        // The `Device dump: ` prefix and the JSON payload behind it are what
        // make a pasted log parsable — the account is added inside the payload
        // rather than in front of it.
        logger.info(
          `Device dump: ${JSON.stringify({
            account: account.slot,
            server: account.config.server,
            deviceURL: device.deviceURL,
            label: device.label,
            controllableName: device.controllableName,
            uiClass: device.definition?.uiClass,
            widgetName: device.definition?.widgetName,
            commands: (device.definition?.commands ?? []).map((c) => c.commandName),
            states: (device.states ?? []).map((s) => ({ name: s.name, value: s.value })),
          })}`,
        );
      }
      counts.push({ account, count: devices.length });
    }

    const total = counts.reduce((sum, entry) => sum + entry.count, 0);
    logger.info(`Dumped ${total} Overkiz device(s)`);
    if (counts.length === 1) {
      return {
        en: `${total} device(s) written to the integration logs. They carry your hub serial number — anonymize them before sharing.`,
        fr: `${total} appareil(s) écrits dans les logs de l'intégration. Ils contiennent le numéro de série de votre box : anonymisez-les avant de les partager.`,
      };
    }
    const perAccount = (lang) =>
      counts
        .map(({ account, count }) => `${describeAccount(account.config, lang)} : ${count}`)
        .join(' · ');
    return {
      en: `${total} device(s) written to the integration logs (${perAccount('en')}). They carry your hub serial number — anonymize them before sharing.`,
      fr: `${total} appareil(s) écrits dans les logs de l'intégration (${perAccount('fr')}). Ils contiennent le numéro de série de votre box : anonymisez-les avant de les partager.`,
    };
  }

  // --- Configuration updated by the user -------------------------------------
  async function configUpdated(newConfig) {
    logger.info('onConfigUpdated -> reconciling the configured accounts');
    await applyConfig(normalizeConfig(newConfig));
    await refreshConnectionStatus();
  }

  // --- Connection lifecycle ---------------------------------------------------
  async function gladysConnected() {
    try {
      await applyConfig(normalizeConfig(await gladys.getConfig()));
      await refreshConnectionStatus();
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
    publisher.cancelResync();
    for (const account of accounts) {
      account.stop();
    }
  }

  return {
    scan,
    setValue,
    configUpdated,
    gladysConnected,
    // An update can change which features a device carries, so it republishes
    // exactly like a creation.
    deviceCreated,
    deviceUpdated: deviceCreated,
    deviceDeleted,
    shutdown,
    // Keyed by the action `key` declared in the manifest, so `index.js` wires
    // them generically and the manifest test can check the two never drift.
    actions: { test_connection: testConnection, dump_devices: dumpDevices },
  };
}
