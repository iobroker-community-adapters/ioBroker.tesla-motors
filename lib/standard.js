'use strict';

/**
 * The standard commands of the shared catalog (family "vehicle", HELP.md of ioBroker.assistant): thin wrappers over
 * the remote commands of main.js (runRemoteCommand = the path of the remote.* states, wakeUpVehicle, updateDevices)
 * and the states of vehicle_data. Answers: success without `error`, failure {error, reason}.
 */

const MILES_TO_KM = 1.609344;
/** Rule 9 of the catalog: a command that takes longer (waking the car) answers {ok: true, pending: true} */
const PENDING_MS = 14000;

/** command -> standard name */
const STANDARD_COMMANDS = {
  getVehicles: 'vehicle.getVehicles',
  getStatus: 'vehicle.getStatus',
  lock: 'vehicle.lock',
  climate: 'vehicle.climate',
  charge: 'vehicle.charge',
  setChargeLimit: 'vehicle.setChargeLimit',
  setChargeCurrent: 'vehicle.setChargeCurrent',
  signal: 'vehicle.signal',
  refresh: 'vehicle.refresh',
};

const SIGNALS = { horn: ['honk_horn'], lights: ['flash_lights'], both: ['honk_horn', 'flash_lights'] };

function fail(error, reason, extra) {
  return { error, reason, ...extra };
}

/** true/false, also 'true'/'false' and 1/0; else undefined */
function bool(value) {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return undefined;
}

/** a finite number or undefined */
function num(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** @returns {Promise<{id: string, name: string}[]>} the vehicles (id = VIN, name = device name) */
async function listVehicles(adapter) {
  const vehicles = [];
  for (const product of adapter.idArray.filter((p) => p.type === 'vehicle')) {
    const obj = await adapter.getObjectAsync(product.vin);
    let name = obj && obj.common && obj.common.name;
    if (name && typeof name === 'object') name = name.en || Object.values(name)[0];
    vehicles.push({ id: product.vin, name: typeof name === 'string' && name ? name : product.vin });
  }
  return vehicles;
}

/** `vehicle` = VIN or name (exact before partial), default the only car */
async function findVehicle(adapter, wanted) {
  const vehicles = await listVehicles(adapter);
  if (!vehicles.length) return { error: fail('No vehicle in the Tesla account', 'NOT_FOUND') };
  const text = wanted === undefined || wanted === null ? '' : String(wanted).trim().toLowerCase();
  if (!text) {
    if (vehicles.length === 1) return { vehicle: vehicles[0] };
    return { error: fail('Several vehicles: which one?', 'AMBIGUOUS', { candidates: vehicles.map((v) => v.name) }) };
  }
  const exact = vehicles.filter((v) => v.id.toLowerCase() === text || v.name.toLowerCase() === text);
  const hits = exact.length ? exact : vehicles.filter((v) => v.name.toLowerCase().includes(text));
  if (hits.length === 1) return { vehicle: hits[0] };
  if (hits.length) {
    return { error: fail(`"${wanted}" fits several vehicles`, 'AMBIGUOUS', { candidates: hits.map((v) => v.name) }) };
  }
  return { error: fail(`Unknown vehicle "${wanted}"`, 'NOT_FOUND', { candidates: vehicles.map((v) => v.name) }) };
}

/** The values of vehicle_data (or Fleet Telemetry) in the form of vehicle.getStatus; ranges come in miles */
async function getStatus(adapter, vin) {
  const ids = {
    battery: 'charge_state.battery_level',
    range: 'charge_state.battery_range',
    chargingState: 'charge_state.charging_state',
    locked: 'vehicle_state.locked',
    climate: 'climate_state.is_climate_on',
    insideTemp: 'climate_state.inside_temp',
    odometer: 'vehicle_state.odometer',
    lat: 'drive_state.latitude',
    lon: 'drive_state.longitude',
  };
  const v = {};
  let ts = 0;
  for (const [key, id] of Object.entries(ids)) {
    const state = await adapter.getStateAsync(`${vin}.${id}`);
    if (state && state.val !== null && state.val !== undefined) {
      v[key] = state.val;
      ts = Math.max(ts, state.ts || 0);
    }
  }
  if (!ts) return fail('No values of this vehicle read yet', 'NOT_CONNECTED');
  const status = {};
  if (num(v.battery) !== undefined) status.batteryPercent = num(v.battery);
  if (num(v.range) !== undefined) status.rangeKm = Math.round(num(v.range) * MILES_TO_KM);
  if (typeof v.chargingState === 'string') {
    status.charging = v.chargingState === 'Charging' || v.chargingState === 'Starting';
    status.plugged = v.chargingState !== 'Disconnected';
  }
  if (bool(v.locked) !== undefined) status.locked = bool(v.locked);
  if (bool(v.climate) !== undefined) status.climate = bool(v.climate);
  if (num(v.insideTemp) !== undefined) status.insideTemp = num(v.insideTemp);
  if (num(v.odometer) !== undefined) status.odometerKm = Math.round(num(v.odometer) * MILES_TO_KM);
  if (num(v.lat) !== undefined && num(v.lon) !== undefined) {
    status.lat = num(v.lat);
    status.lon = num(v.lon);
  }
  status.ts = ts;
  return status;
}

/** Sends the remote commands [command, action?, value?] one after the other, as the remote.* states do */
async function remote(adapter, vin, steps) {
  for (const [command, action, value] of steps) {
    const result = await adapter.runRemoteCommand(vin, command, action, value === undefined ? true : value);
    if (result === null || result === undefined || (typeof result === 'object' && result.result === false)) {
      const why = result && result.reason ? `: ${result.reason}` : ' (see the log of the instance)';
      return fail(`The car did not take ${command}${why}`, 'COMMAND_FAILED');
    }
  }
  return { ok: true };
}

async function refresh(adapter, vin, wake) {
  if (wake) {
    const state = await adapter.wakeUpVehicle(vin, adapter.getFleetHeaders(), adapter.getFleetApiBaseUrl());
    if (state !== 'online') return fail(`The car does not wake up (${state})`, 'NOT_CONNECTED');
  }
  // as the state remote.force_update; a sleeping car is not woken by it
  await Promise.all([adapter.updateDevices(true), adapter.updateDevices(true, true)]);
  return { ok: true };
}

/** Rule 9: the answer of `job`, or {ok: true, pending: true} after `ms` while it goes on in the background */
function inTime(adapter, label, job, ms) {
  let timer;
  let late = false;
  const pending = new Promise((resolve) => {
    timer = setTimeout(() => {
      late = true;
      resolve({ ok: true, pending: true });
    }, ms);
  });
  const done = job
    .catch((e) => fail(e.message || String(e), e.code || 'COMMAND_FAILED'))
    .then((answer) => {
      clearTimeout(timer);
      if (late && answer.error) adapter.log.warn(`${label}: ${answer.error}`);
      return answer;
    });
  return Promise.race([done, pending]);
}

/**
 * @param {any} adapter the instance (idArray, getObjectAsync, getStateAsync, runRemoteCommand, wakeUpVehicle, …)
 * @param {string} command a key of STANDARD_COMMANDS
 * @param {any} message the parameters of the catalog
 * @param {{pendingMs?: number}} [options]
 */
async function handleStandardCommand(adapter, command, message, options = {}) {
  const msg = message && typeof message === 'object' ? message : {};
  const ms = options.pendingMs || PENDING_MS;
  try {
    if (command === 'getVehicles') return { vehicles: await listVehicles(adapter) };
    const found = await findVehicle(adapter, msg.vehicle);
    if (found.error) return found.error;
    const vin = found.vehicle.id;
    const run = (steps) => inTime(adapter, `${command} ${found.vehicle.name}`, remote(adapter, vin, steps), ms);
    const on = bool(msg.on);
    switch (command) {
      case 'getStatus':
        return await getStatus(adapter, vin);
      case 'lock': {
        const locked = bool(msg.locked);
        if (locked === undefined) return fail('locked (true or false) is required', 'BAD_REQUEST');
        return await run([[locked ? 'door_lock' : 'door_unlock']]);
      }
      case 'climate': {
        if (on === undefined) return fail('on (true or false) is required', 'BAD_REQUEST');
        const temp = num(msg.temp);
        if (msg.temp !== undefined && (temp === undefined || temp <= 0)) return fail('temp: °C', 'BAD_REQUEST');
        if (!on) return await run([['auto_conditioning_stop']]);
        const steps = temp === undefined ? [] : [['set_temps', 'driver_temp', temp]];
        return await run([...steps, ['auto_conditioning_start']]);
      }
      case 'charge':
        if (on === undefined) return fail('on (true or false) is required', 'BAD_REQUEST');
        return await run([[on ? 'charge_start' : 'charge_stop']]);
      case 'setChargeLimit': {
        const percent = num(msg.percent);
        if (percent === undefined || percent < 1 || percent > 100) return fail('percent: 1-100', 'BAD_REQUEST');
        return await run([['set_charge_limit', undefined, Math.round(percent)]]);
      }
      case 'setChargeCurrent': {
        const amps = num(msg.amps);
        if (amps === undefined || amps < 1) return fail('amps: a number of A', 'BAD_REQUEST');
        return await run([['set_charging_amps', 'charging_amps', Math.round(amps)]]);
      }
      case 'signal': {
        const kind = msg.kind === undefined ? 'lights' : msg.kind;
        if (!SIGNALS[kind]) return fail('kind: horn, lights or both', 'BAD_REQUEST');
        return await run(SIGNALS[kind].map((c) => [c]));
      }
      case 'refresh':
        return await inTime(adapter, `refresh ${found.vehicle.name}`, refresh(adapter, vin, bool(msg.wake)), ms);
      default:
        return fail(`Unknown command ${command}`, 'NOT_SUPPORTED');
    }
  } catch (/** @type {any} */ e) {
    return fail(e.message || String(e), e.code || 'COMMAND_FAILED');
  }
}

module.exports = { STANDARD_COMMANDS, handleStandardCommand, MILES_TO_KM };
