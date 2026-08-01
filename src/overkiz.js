// -----------------------------------------------------------------------------
// Overkiz cloud client wrapper.
//
// Wraps the `overkiz-client` library (also used by homebridge-tahoma): it
// handles authentication against the Overkiz servers (Somfy TaHoma, Cozytouch,
// Rexel...), device fetching, command execution, and near real-time state
// updates through event polling.
// -----------------------------------------------------------------------------

import { Client as OverkizClient, Action, Command, Execution } from 'overkiz-client';
import { createLogger } from '@gladysassistant/integration-sdk';

const log = createLogger({ name: 'overkiz' });

function defaultCreateClient(config) {
  // `refreshPeriod` is expressed in MINUTES by overkiz-client (it multiplies by
  // 60 internally); 30 minutes is its own recommended floor.
  return new OverkizClient(log, {
    service: config.server,
    user: config.username,
    password: config.password,
    pollingPeriod: config.polling_period,
    refreshPeriod: 30,
  });
}

export class Overkiz {
  /**
   * @param {{ createClient?: (config: object) => object }} [options] `createClient`
   *   is injectable so the lifecycle can be tested without an Overkiz account.
   */
  constructor({ createClient = defaultCreateClient } = {}) {
    this.createClient = createClient;
    this.client = null;
    // Only true once the first API call succeeded: a client that failed to
    // authenticate must never be reported as connected.
    this.ready = false;
    this.devicesByUrl = new Map();
    this.onStates = null;
    this.onConnectionChange = null;
  }

  get connected() {
    return this.client !== null && this.ready;
  }

  /**
   * (Re)start the client with the given configuration.
   * Fetches the device list and subscribes to state updates.
   */
  async start(config) {
    this.stop();
    const client = this.createClient(config);
    client.on('connect', () => {
      log.info('Connected to the Overkiz API');
      this.onConnectionChange?.(true);
    });
    client.on('disconnect', () => {
      log.warn('Disconnected from the Overkiz API');
      this.onConnectionChange?.(false);
    });
    // Own the client right away so `stop()` can always tear it down, but stay
    // "not connected" until the first call actually goes through.
    this.client = client;

    try {
      await client.getDevices();
    } catch (err) {
      // Leave nothing running behind: authentication may have succeeded and
      // started the polling timers before a later call failed.
      this.stop();
      throw err;
    }

    this.ready = true;
    const devices = this.syncDevices();
    log.info(`Fetched ${devices.length} Overkiz devices`);
    return devices;
  }

  /**
   * Sync the local device map with the client's internal one (which is the
   * one updated by the event poller), registering state listeners on new
   * devices. The client stores every device there, including sub-sensors.
   */
  syncDevices() {
    for (const device of Object.values(this.client.devices)) {
      if (!this.devicesByUrl.has(device.deviceURL)) {
        this.devicesByUrl.set(device.deviceURL, device);
        device.on('states', (states) => {
          this.onStates?.(device, states);
        });
      }
    }
    return Array.from(this.devicesByUrl.values());
  }

  /**
   * Stop polling and drop the current client.
   */
  stop() {
    if (!this.client) {
      return;
    }
    try {
      // Not part of the public typings, but available at runtime: stops the
      // internal refresh & event polling timers of the previous client.
      this.client.setRefreshTaskPeriod(0);
      this.client.setPollingTaskPeriod(0);
    } catch (err) {
      log.debug('Failed to stop polling tasks', err);
    }
    this.client.removeAllListeners();
    for (const device of this.devicesByUrl.values()) {
      device.removeAllListeners('states');
    }
    this.client = null;
    this.ready = false;
    this.devicesByUrl = new Map();
  }

  getDevice(deviceUrl) {
    return this.devicesByUrl.get(deviceUrl) ?? null;
  }

  /**
   * Refresh the devices list from the API.
   */
  async refreshDevices() {
    if (!this.client) {
      throw new Error('Overkiz client is not connected');
    }
    await this.client.getDevices();
    return this.syncDevices();
  }

  /**
   * Send a command to a device. Resolves as soon as the Overkiz cloud ACCEPTS
   * the execution (it returns an execId) — not when the device has finished
   * moving. Completion is observed later through the event poller.
   */
  async execute(deviceUrl, command, label = 'Gladys command') {
    if (!this.client) {
      throw new Error('Overkiz client is not connected');
    }
    const action = new Action(deviceUrl, [new Command(command.name, command.parameters)]);
    const execution = new Execution(label, action);
    await this.client.execute('apply', execution);
  }
}
