// -----------------------------------------------------------------------------
// Entry point of the Gladys Overkiz external integration.
//
// Bridges the Overkiz cloud API (Somfy TaHoma, Connexoon, Cozytouch, Rexel,
// Hi Kumo, Flexom...) and Gladys Assistant:
//   - devices fetched from the Overkiz setup are published to Gladys discovery;
//   - state changes (event polling) are pushed to Gladys as feature states;
//   - Gladys commands (onSetValue) are translated to Overkiz executions.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigComplete } from './src/config.js';
import { buildDiscoveredDevice, stateToGladysValue, buildCommand } from './src/mapping.js';
import { Overkiz } from './src/overkiz.js';

const gladys = new GladysIntegration();
const overkiz = new Overkiz();

let config = normalizeConfig();

// deviceURL -> { device external_id, entries: [{ key, stateName, gladysFeature }] }
let mappedDevices = new Map();
// feature external_id -> last published value (only publish real changes:
// the host API rate-limits state updates to 300 per minute).
const lastValues = new Map();

function mapAllDevices(devices) {
  mappedDevices = new Map();
  const discovered = [];
  for (const device of devices) {
    const mapped = buildDiscoveredDevice(gladys, device);
    if (mapped) {
      mappedDevices.set(device.deviceURL, mapped);
      discovered.push(mapped.device);
    }
  }
  return discovered;
}

async function publishInitialStates() {
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
      const value = stateToGladysValue(entry.stateName, entry.key, device.get(entry.stateName));
      if (value !== null && lastValues.get(entry.gladysFeature.external_id) !== value) {
        lastValues.set(entry.gladysFeature.external_id, value);
        states.push({ device_feature_external_id: entry.gladysFeature.external_id, state: value });
      }
    }
  }
  for (let i = 0; i < states.length; i += 100) {
    await gladys.publishStates(states.slice(i, i + 100));
  }
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
    const value = stateToGladysValue(state.name, entry.key, state.value);
    if (value !== null && lastValues.get(entry.gladysFeature.external_id) !== value) {
      lastValues.set(entry.gladysFeature.external_id, value);
      updates.push({ device_feature_external_id: entry.gladysFeature.external_id, state: value });
    }
  }
  if (updates.length > 0) {
    await gladys
      .publishStates(updates)
      .catch((err) => logger.error('Failed to publish states', err));
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

async function connectOverkiz() {
  if (!isConfigComplete(config)) {
    logger.info('Overkiz configuration is incomplete, waiting for the user to fill it in');
    await gladys.setConnectionStatus(false, {
      en: 'Please fill in your Overkiz server and credentials in the Configuration tab.',
      fr: "Veuillez renseigner votre serveur et vos identifiants Overkiz dans l'onglet Configuration.",
    });
    return;
  }
  try {
    const devices = await overkiz.start(config);
    await gladys.publishDiscoveredDevices(mapAllDevices(devices));
    await publishInitialStates();
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Failed to connect to the Overkiz API', err);
    await gladys.setConnectionStatus(false, {
      en: 'Connection to the Overkiz API failed, check your credentials.',
      fr: "La connexion à l'API Overkiz a échoué, vérifiez vos identifiants.",
    });
  }
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> refreshing Overkiz devices');
  if (!overkiz.connected) {
    await connectOverkiz();
    return;
  }
  const devices = await overkiz.refreshDevices();
  await gladys.publishDiscoveredDevices(mapAllDevices(devices));
  await publishInitialStates();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  const found = Array.from(mappedDevices.entries()).find(
    ([, mapped]) => mapped.device.external_id === device.external_id,
  );
  if (!found) {
    throw new Error(`Unknown Overkiz device ${device.external_id}`);
  }
  const [deviceUrl, mapped] = found;
  const entry = mapped.entries.find((e) => e.gladysFeature.external_id === feature.external_id);
  if (!entry) {
    throw new Error(`Unknown feature ${feature.external_id}`);
  }
  const overkizDevice = overkiz.getDevice(deviceUrl);
  const command = overkizDevice && buildCommand(overkizDevice, entry.key, value);
  if (!command) {
    throw new Error(`No Overkiz command for ${feature.external_id} = ${value}`);
  }
  await overkiz.execute(deviceUrl, command, `Gladys - ${device.name ?? deviceUrl}`);
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  const found = Array.from(mappedDevices.entries()).find(
    ([, mapped]) => mapped.device.external_id === device.external_id,
  );
  if (!found || !overkiz.connected) {
    return;
  }
  await overkiz.refreshDeviceStates(found[0]);
});

// --- Manifest action: test the connection -------------------------------------
gladys.onAction('test_connection', async () => {
  try {
    await connectOverkiz();
    if (!overkiz.connected) {
      return {
        en: 'Configuration incomplete: fill in the server, email and password first.',
        fr: "Configuration incomplète : renseignez d'abord le serveur, l'email et le mot de passe.",
      };
    }
    const count = mappedDevices.size;
    return {
      en: `Connection OK, ${count} supported device(s) found.`,
      fr: `Connexion OK, ${count} appareil(s) supporté(s) trouvé(s).`,
    };
  } catch (err) {
    logger.error('test_connection failed', err);
    return {
      en: 'Connection failed, check your credentials and server.',
      fr: 'La connexion a échoué, vérifiez vos identifiants et le serveur.',
    };
  }
});

// --- Configuration updated by the user ----------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> reconnecting with the new configuration');
  config = normalizeConfig(newConfig);
  lastValues.clear();
  await connectOverkiz();
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await connectOverkiz();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown ----------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  overkiz.stop();
});

// --- Startup ---------------------------------------------------------------------
logger.info('Starting the Overkiz integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
