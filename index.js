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
const overkiz = new Overkiz();
const handlers = createHandlers({ gladys, overkiz, logger });

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

logger.info('Starting the Overkiz integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
