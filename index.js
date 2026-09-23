// -----------------------------------------------------------------------------
// Entry point of the Gladys Overkiz external integration.
//
// Bridges the Overkiz cloud API (Somfy TaHoma, Connexoon, Cozytouch, Rexel,
// Hi Kumo, Flexom...) and Gladys Assistant:
//   - devices fetched from the Overkiz setup are published to Gladys discovery;
//   - state changes (event polling) are pushed to Gladys as feature states;
//   - Gladys commands (onSetValue) are translated to Overkiz executions.
//
// This file is wiring only: the orchestration lives in `src/handlers.js`.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createHandlers } from './src/handlers.js';
import { Overkiz } from './src/overkiz.js';

const gladys = new GladysIntegration();
// A factory rather than an instance: the user can configure several Overkiz
// accounts, each of which owns its own session — and its own logger, so the
// lines of three sessions stay tellable apart.
const handlers = createHandlers({
  gladys,
  createOverkiz: (account, accountLogger) => new Overkiz({ logger: accountLogger }),
  logger,
});

// No `onPoll`: the devices are published with `should_poll: false` because the
// Overkiz event poller already pushes every change.
gladys.onScanRequest(handlers.scan);
gladys.onSetValue(handlers.setValue);
gladys.onConfigUpdated(handlers.configUpdated);
// States published before the user creates a device are silently dropped by the
// host API, so a freshly created device needs them published again.
gladys.onDeviceCreated(handlers.deviceCreated);
gladys.onDeviceUpdated(handlers.deviceUpdated);
gladys.onDeviceDeleted(handlers.deviceDeleted);
gladys.on('connected', handlers.gladysConnected);
gladys.handleShutdown(handlers.shutdown);

for (const [key, handler] of Object.entries(handlers.actions)) {
  gladys.onAction(key, handler);
}

// A promise nobody handles means state nobody owns any more: say so in the
// integration logs, then let the Gladys supervisor restart a clean process.
// The known source — the device refresh `overkiz-client` fires and forgets —
// is contained in `src/overkiz.js`.
process.on('unhandledRejection', (reason) => {
  logger.error(
    'Unhandled promise rejection, exiting so that Gladys restarts the integration:',
    reason,
  );
  process.exit(1);
});

logger.info('Starting the Overkiz integration...');
// Only a refused token rejects here, and Gladys refuses it while it boots too:
// the SDK keeps reconnecting on its own. Exiting would spend the supervisor's
// restart budget and leave the integration in ERROR after five of them.
gladys.connect().catch((err) => {
  logger.error('Initial connection to Gladys failed, the SDK keeps retrying:', err.message);
});
