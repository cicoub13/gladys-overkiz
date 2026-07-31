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

export class Overkiz {
  constructor() {
    this.client = null;
    this.devicesByUrl = new Map();
    this.onStates = null;
    this.onConnectionChange = null;
  }

  get connected() {
    return this.client !== null;
  }

  /**
   * (Re)start the client with the given configuration.
   * Fetches the device list and subscribes to state updates.
   */
  async start(config) {
    this.stop();
    const client = new OverkizClient(log, {
      service: config.server,
      user: config.username,
      password: config.password,
      pollingPeriod: config.polling_period,
      refreshPeriod: 30,
    });
    client.on('connect', () => {
      log.info('Connected to the Overkiz API');
      this.onConnectionChange?.(true);
    });
    client.on('disconnect', () => {
      log.warn('Disconnected from the Overkiz API');
      this.onConnectionChange?.(false);
    });
    this.client = client;

    await client.getDevices();
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
   * Ask the hub to refresh the states of one device.
   */
  async refreshDeviceStates(deviceUrl) {
    if (!this.client) {
      throw new Error('Overkiz client is not connected');
    }
    await this.client.refreshDeviceStates(deviceUrl);
  }

  /**
   * Execute a command on a device and wait for the execution to complete.
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
