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
 * An Atlantic / Thermor domestic hot water tank as the Cozytouch cloud
 * describes it: eco and absence are two independent switches, the boost is a
 * remaining duration in days, and the setpoint carries its own range.
 *
 * `commands` and `states` REPLACE the defaults rather than merging into them,
 * like `makeOverkizDevice` — a variant that must lack a state says so.
 */
export function makeWaterHeater(overrides = {}) {
  return makeOverkizDevice({
    deviceURL: 'io://1111-2222-3333/44444444#1',
    label: 'Water heater',
    uiClass: 'WaterHeatingSystem',
    widgetName: 'DomesticHotWaterProduction',
    controllableName: 'io:AtlanticDomesticHotWaterProductionV2_CV4E_IOComponent',
    commands: [
      'setDHWMode',
      'setCurrentOperatingMode',
      'setBoostModeDuration',
      'setTargetTemperature',
      'refreshTargetTemperature',
      'refreshBoostModeDuration',
      'refreshAwayModeDuration',
    ],
    states: {
      'io:DHWModeState': 'manualEcoActive',
      'io:AwayModeDurationState': '0',
      'core:BoostModeDurationState': 0,
      'core:TargetTemperatureState': 54,
      'core:MinimalTemperatureManualModeState': 50,
      'core:MaximalTemperatureManualModeState': 62,
      'io:MiddleWaterTemperatureState': 48.5,
      'core:RemainingHotWaterState': 70,
      'core:HeatingStatusState': 'off',
    },
    ...overrides,
  });
}

/**
 * A REAL Atlantic LINEO, captured from a user's Cozytouch account with the
 * "List the raw devices" action. Kept faithful — including the states that must
 * be ignored — because it is the appliance the mapping is meant to serve:
 *
 * - it speaks the `modbuslink` dialect, not `io`, so every candidate list has
 *   to reach past its first entry;
 * - it reports BOTH `core:WaterTargetTemperatureState` and
 *   `core:TargetDHWTemperatureState`, and no `core:TargetTemperatureState`;
 * - it has no `setCurrentOperatingMode`: absence and boost are their own
 *   commands here;
 * - its refresh commands are NOT the set commands with the verb swapped — it
 *   takes `setTargetDHWTemperature` but only offers
 *   `refreshWaterTargetTemperature`.
 */
export function makeAtlanticModbuslinkWaterHeater(overrides = {}) {
  return makeOverkizDevice({
    deviceURL: 'modbuslink://1537-7989-4054/1#1',
    label: 'LINEO',
    uiClass: 'WaterHeatingSystem',
    widgetName: 'DomesticHotWaterProduction',
    controllableName: 'modbuslink:AtlanticDomesticHotWaterProductionMBLComponent',
    commands: [
      'refreshAbsenceMode',
      'refreshBoostMode',
      'refreshDHWMode',
      'refreshHeatingStatus',
      'refreshMiddleWaterTemperature',
      'refreshRemainingHotWater',
      'refreshWaterTargetTemperature',
      'setAbsenceEndDate',
      'setAbsenceMode',
      'setAbsenceStartDate',
      'setBoostMode',
      'setDateTime',
      'setDHWMode',
      'setTargetDHWTemperature',
      'setWaterTargetTemperature',
    ],
    states: {
      'modbuslink:DHWModeState': 'autoMode',
      'modbuslink:DHWAbsenceModeState': 'off',
      'modbuslink:DHWBoostModeState': 'off',
      'core:WaterTargetTemperatureState': 55,
      'core:TargetDHWTemperatureState': 55,
      'core:MinimalTemperatureManualModeState': 50,
      'core:MaximalTemperatureManualModeState': 70,
      'core:RemainingHotWaterState': 42,
      // A cumulative counter on this appliance, not a usable V40 volume for an
      // 80 L tank — the percentage above must win.
      'core:V40WaterVolumeEstimationState': 10317,
      'modbuslink:DHWCapacityState': 80,
      'core:HeatingStatusState': 'off',
      'modbuslink:MiddleWaterTemperatureState': 41.6,
      'core:MiddleWaterTemperatureInState': 36.8,
      'core:ControlWaterTargetTemperatureState': 46,
      'core:NumberOfShowerRemainingState': 1,
    },
    ...overrides,
  });
}

/**
 * Stand-in for the external id helpers of the SDK client.
 *
 * Kept METHOD-shaped, and `externalIds` deliberately reaches `this.externalId`
 * exactly like `GladysIntegration` does: a caller that passes `gladys.externalIds`
 * around detached from its object gets `this.externalId is not a function` here
 * too, instead of the fake quietly working where production crashes.
 */
export const externalIdHelpers = {
  externalId(suffix) {
    return `overkiz:${suffix}`;
  },
  externalIds(type, platformId) {
    const device = this.externalId(`${type}:${platformId}`);
    return {
      device,
      feature: (key) => `${device}:${key}`,
    };
  },
};

/**
 * Standalone `externalIds`, for the tests that only need to build ids and have
 * no SDK client at hand.
 */
export function makeExternalIds(type, platformId) {
  return externalIdHelpers.externalIds(type, platformId);
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
    ...externalIdHelpers,
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
 * Collects the timers the code under test schedules so tests can fire them on
 * demand instead of waiting a real minute.
 */
export function makeFakeTimer() {
  const pending = [];
  const scheduleTimer = (fn) => {
    const entry = { fn, cancelled: false };
    pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  scheduleTimer.pending = pending;
  scheduleTimer.runAll = async () => {
    for (const entry of pending.splice(0)) {
      if (!entry.cancelled) {
        await entry.fn();
      }
    }
  };
  return scheduleTimer;
}

/**
 * Controllable clock. `sleep` advances it, so rate-limit pauses are observable
 * without the test actually waiting.
 */
export function makeFakeClock() {
  let current = 1_000_000;
  const sleeps = [];
  return {
    sleeps,
    now: () => current,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      current += delayMs;
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

/**
 * A fake `Overkiz` per account slot, handed out by the factory the handlers
 * take. The fakes are built up front so a test can hold a reference to the
 * slot 3 wrapper before the account it belongs to even exists.
 *
 * @param {Record<number, object>} specsBySlot options for `makeFakeOverkiz`
 */
export function makeFakeOverkizPool(specsBySlot = {}) {
  const bySlot = new Map();
  for (const slot of [1, 2, 3]) {
    bySlot.set(slot, makeFakeOverkiz(specsBySlot[slot] ?? {}));
  }
  return {
    bySlot,
    get: (slot) => bySlot.get(slot),
    createOverkiz: ({ slot }) => bySlot.get(slot),
  };
}

/**
 * Build the FLAT config the form produces, from one description per slot:
 * `makeMultiConfig({ 1: {...}, 2: { server: 'cozytouch', ... } })`.
 */
export function makeMultiConfig(slots = {}) {
  const config = {};
  for (const [slot, account] of Object.entries(slots)) {
    if (slot === 'polling_period') {
      config.polling_period = account;
      continue;
    }
    const suffix = slot === '1' ? '' : `_${slot}`;
    for (const [field, value] of Object.entries(account)) {
      config[`${field}${suffix}`] = value;
    }
  }
  return config;
}
