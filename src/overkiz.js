// -----------------------------------------------------------------------------
// Overkiz cloud client wrapper.
//
// Wraps the `overkiz-client` library (also used by homebridge-tahoma): it
// handles authentication against the Overkiz servers (Somfy TaHoma, Cozytouch,
// Rexel...), device fetching, command execution, and near real-time state
// updates through event polling.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { Client as OverkizClient, Action, Command, Execution } from 'overkiz-client';
import { createLogger } from '@gladysassistant/integration-sdk';

const defaultLogger = createLogger({ name: 'overkiz' });
// Per HTTP request; a Cozytouch login chains three of them.
const REQUEST_TIMEOUT_MS = 30_000;
// Longest pause of the event poller after a failed fetch.
const MAX_POLLING_ERROR_LOCK_S = 60;

export function createOverkizClient(config, logger) {
  // `refreshPeriod` is expressed in MINUTES by overkiz-client (it multiplies by
  // 60 internally); 30 minutes is its own recommended floor.
  const client = new OverkizClient(logger, {
    service: config.server,
    user: config.username,
    password: config.password,
    pollingPeriod: config.polling_period,
    refreshPeriod: 30,
  });
  // axios waits forever by default, and overkiz-client sets no timeout: a
  // stalled login held up every account behind it, and a stalled event fetch
  // froze the poller for good. Not part of the public typings, like the
  // polling setters `stop()` uses. The error it raises is classified as an
  // unreachable cloud, so it is retried.
  client.api.client.defaults.timeout = REQUEST_TIMEOUT_MS;
  // Node ≥ 19 keeps HTTPS sockets alive for 5 s, and after a command the poller
  // fetches every 5 s: it kept reusing a socket the cloud had just closed, and
  // the fetch failed with "socket hang up". A handshake every poll is cheap.
  client.api.client.defaults.httpsAgent = new https.Agent({ keepAlive: false });
  // After each failed fetch the poller pauses twice as long as the previous
  // time, and only a successful fetch resets it — but that fetch only comes
  // after the pause: a cloud outage left an account deaf for hours.
  let pollingErrorLockS = client.pollingErrorLockDuration;
  Object.defineProperty(client, 'pollingErrorLockDuration', {
    get: () => pollingErrorLockS,
    set: (seconds) => {
      pollingErrorLockS = Math.min(seconds, MAX_POLLING_ERROR_LOCK_S);
    },
  });

  // When the cloud reports a completed state refresh, the event poller calls
  // `refreshDevices()` without awaiting nor catching it: one failed GET there
  // is an unhandled rejection, and that ends the process. Its only other
  // caller already catches, so resolving instead changes nothing for it.
  //
  // overkiz-client's own version also skips the sub-devices it files as
  // sensors of another (consumption meters, zone thermometers…): their states
  // never caught up. Every device of the setup is updated here.
  client.refreshDevices = async () => {
    try {
      const devices = await client.api.get('/setup/devices');
      for (const fresh of devices) {
        client.devices[fresh.deviceURL]?.updateStates(fresh.states ?? []);
      }
    } catch (err) {
      logger.error('Failed to refresh the Overkiz devices', err);
    }
  };

  // A failed fetch may have lost events — the cloud can drop the listener, or
  // answer a request whose response never arrives — and a change made from a
  // remote or a wall switch meanwhile would only show up at the next 30-minute
  // refresh. Read the current states back as soon as fetching works again.
  const post = client.api.post.bind(client.api);
  let eventsMayBeLost = false;
  client.api.post = async (url, ...rest) => {
    const isEventFetch = /^\/events\/[^/]+\/fetch$/.test(url);
    try {
      const data = await post(url, ...rest);
      if (isEventFetch && eventsMayBeLost) {
        eventsMayBeLost = false;
        logger.info('Event polling is back, refreshing the device states');
        client.refreshDevices();
      }
      return data;
    } catch (err) {
      if (isEventFetch) {
        eventsMayBeLost = true;
      }
      throw err;
    }
  };
  return client;
}

export class Overkiz {
  /**
   * @param {object} [options]
   * @param {(config: object, logger: object) => object} [options.createClient]
   *   Injectable so the lifecycle can be tested without an Overkiz account.
   * @param {object} [options.logger] Given by the account that owns this
   *   session, so its lines — and those `overkiz-client` writes itself — say
   *   which of the configured accounts they come from.
   */
  constructor({ createClient = createOverkizClient, logger = defaultLogger } = {}) {
    this.createClient = createClient;
    this.logger = logger;
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
    const client = this.createClient(config, this.logger);
    // The link going up or down is reported by whoever owns the account, not
    // here: logging it on both levels printed every transition twice.
    client.on('connect', () => this.onConnectionChange?.(true));
    client.on('disconnect', () => this.onConnectionChange?.(false));
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
    this.logger.info(`Fetched ${devices.length} Overkiz devices`);
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
          // The handler is asynchronous and nothing awaits it here: an
          // unhandled rejection would take the whole integration down. One
          // device publishing something the mapping chokes on must cost that
          // update, not the process.
          Promise.resolve(this.onStates?.(device, states)).catch((err) =>
            this.logger.error(`Failed to handle a state update of ${device.deviceURL}`, err),
          );
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
      this.logger.debug('Failed to stop polling tasks', err);
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
   * Send a command — or an ordered list of them — to a device. Resolves as soon
   * as the Overkiz cloud ACCEPTS the execution (it returns an execId) — not when
   * the device has finished moving. Completion is observed later through the
   * event poller.
   *
   * A list travels as a SINGLE action, which is what preserves its order: water
   * heaters need `setXxx` then `refreshXxx` to report the result of a write, and
   * a mode change needs its reset command to land first.
   */
  async execute(deviceUrl, command, label = 'Gladys command') {
    if (!this.client) {
      throw new Error('Overkiz client is not connected');
    }
    const commands = Array.isArray(command) ? command : [command];
    const action = new Action(
      deviceUrl,
      commands.map((c) => new Command(c.name, c.parameters)),
    );
    const execution = new Execution(label, action);
    await this.client.execute('apply', execution);
  }
}
