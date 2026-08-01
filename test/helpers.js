// -----------------------------------------------------------------------------
// Shared test fixtures: fake Overkiz devices and a fake Gladys SDK client.
//
// Deliberately plain objects rather than a mocking library — the surfaces the
// integration uses are small, and a hand-written fake documents the contract.
// -----------------------------------------------------------------------------

/**
 * Build an object shaped like an `overkiz-client` Device.
 */
export function makeOverkizDevice({
  deviceURL = 'io://1234-5678-9012/12345678',
  label = 'Test device',
  uiClass,
  widgetName = 'Widget',
  controllableName = 'io:RollerShutterGenericIOComponent',
  commands = [],
  states = {},
} = {}) {
  return {
    deviceURL,
    label,
    controllableName,
    definition: {
      uiClass,
      widgetName,
      commands: commands.map((commandName) => ({ commandName })),
    },
    states: Object.entries(states).map(([name, value]) => ({ name, value })),
    get(stateName) {
      return this.states.find((s) => s.name === stateName)?.value ?? null;
    },
  };
}

/**
 * Minimal stand-in for `gladys.externalIds()`, matching the SDK format.
 */
export function makeExternalIds(type, platformId) {
  return {
    device: `overkiz:${type}:${platformId}`,
    feature: (key) => `overkiz:${type}:${platformId}:${key}`,
  };
}

/**
 * Fake GladysIntegration recording every call made by the handlers.
 */
export function makeFakeGladys({ config = {} } = {}) {
  const calls = {
    discovered: [],
    states: [],
    connectionStatus: [],
  };
  return {
    calls,
    config,
    /** Set to an Error to make the next `publishStates` calls reject. */
    publishError: null,
    externalIds: makeExternalIds,
    async getConfig() {
      return this.config;
    },
    async publishDiscoveredDevices(devices) {
      calls.discovered.push(devices);
      return { success: true };
    },
    async publishStates(states) {
      if (this.publishError) {
        throw this.publishError;
      }
      calls.states.push(states);
      return { success: true };
    },
    async setConnectionStatus(connected, message) {
      calls.connectionStatus.push({ connected, message });
      return { success: true };
    },
  };
}

/**
 * Fake `Overkiz` wrapper. `devices` is the list returned by `start()`; the
 * handlers reach back into it through `getDevice()`.
 */
export function makeFakeOverkiz({ devices = [], startError = null } = {}) {
  const calls = { start: [], execute: [], stopped: 0 };
  return {
    calls,
    devices,
    connected: false,
    /** Set to falsy mid-test to simulate the cloud coming back. */
    startError,
    onStates: null,
    onConnectionChange: null,
    async start(config) {
      calls.start.push(config);
      if (this.startError) {
        throw this.startError;
      }
      this.connected = true;
      return this.devices;
    },
    async refreshDevices() {
      return this.devices;
    },
    async execute(deviceUrl, command, label) {
      calls.execute.push({ deviceUrl, command, label });
    },
    getDevice(deviceUrl) {
      return this.devices.find((d) => d.deviceURL === deviceUrl) ?? null;
    },
    stop() {
      calls.stopped += 1;
      this.connected = false;
    },
  };
}
