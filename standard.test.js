'use strict';

const { expect } = require('chai');
const { handleStandardCommand } = require('./lib/standard');

/** A fake instance with two cars (or one) and the states of vehicle_data */
function fakeAdapter(options = {}) {
  const cars = options.cars || [
    { vin: '5YJ3E1EA1KF000001', name: 'Red Model 3' },
    { vin: '7SAYGDEE1PF000002', name: 'Model Y' },
  ];
  const calls = [];
  const adapter = {
    calls,
    log: { warn: (text) => calls.push(['warn', text]) },
    idArray: [...cars.map((c) => ({ id: c.vin, vin: c.vin, type: 'vehicle' })), { id: 'site', type: 'battery' }],
    getObjectAsync: async (id) => {
      const car = cars.find((c) => c.vin === id);
      return car ? { common: { name: car.name } } : null;
    },
    getStateAsync: async (id) => (options.states || {})[id] || null,
    getFleetHeaders: () => ({}),
    getFleetApiBaseUrl: () => 'https://fleet',
    runRemoteCommand: async (vin, command, action, value) => {
      calls.push([vin, command, action, value]);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.throwError) throw Object.assign(new Error('The car does not wake up (asleep)'), { code: 'NOT_CONNECTED' });
      return options.result === undefined ? { result: true, reason: '' } : options.result;
    },
    wakeUpVehicle: async (vin) => {
      calls.push([vin, 'wakeUpVehicle']);
      return options.wakeState || 'online';
    },
    updateDevices: async (force, location) => {
      calls.push(['updateDevices', force, !!location]);
    },
  };
  return adapter;
}

const VIN = '5YJ3E1EA1KF000001';

describe('standard commands (vehicle.*)', () => {
  it('getVehicles lists the cars with their names, not the energy products', async () => {
    const answer = await handleStandardCommand(fakeAdapter(), 'getVehicles', {});
    expect(answer).to.deep.equal({
      vehicles: [
        { id: VIN, name: 'Red Model 3' },
        { id: '7SAYGDEE1PF000002', name: 'Model Y' },
      ],
    });
  });

  it('finds the car by VIN or name, exact before partial; several or none are errors', async () => {
    const adapter = fakeAdapter();
    await handleStandardCommand(adapter, 'charge', { vehicle: 'model y', on: true });
    await handleStandardCommand(adapter, 'charge', { vehicle: VIN.toLowerCase(), on: false });
    await handleStandardCommand(adapter, 'charge', { vehicle: 'red', on: true });
    expect(adapter.calls).to.deep.equal([
      ['7SAYGDEE1PF000002', 'charge_start', undefined, true],
      [VIN, 'charge_stop', undefined, true],
      [VIN, 'charge_start', undefined, true],
    ]);
    const several = await handleStandardCommand(adapter, 'charge', { on: true });
    expect(several.reason).to.equal('AMBIGUOUS');
    expect(several.candidates).to.deep.equal(['Red Model 3', 'Model Y']);
    expect((await handleStandardCommand(adapter, 'charge', { vehicle: 'model', on: true })).reason).to.equal('AMBIGUOUS');
    const unknown = await handleStandardCommand(adapter, 'charge', { vehicle: 'Golf', on: true });
    expect(unknown.reason).to.equal('NOT_FOUND');
    expect(unknown.candidates).to.have.length(2);
  });

  it('maps the parameters to the remote commands', async () => {
    const adapter = fakeAdapter({ cars: [{ vin: VIN, name: 'Tessi' }] });
    expect(await handleStandardCommand(adapter, 'lock', { locked: true })).to.deep.equal({ ok: true });
    await handleStandardCommand(adapter, 'lock', { locked: false });
    await handleStandardCommand(adapter, 'climate', { on: true, temp: 21.5 });
    await handleStandardCommand(adapter, 'climate', { on: 'false' });
    await handleStandardCommand(adapter, 'setChargeLimit', { percent: '80' });
    await handleStandardCommand(adapter, 'setChargeCurrent', { amps: 16 });
    await handleStandardCommand(adapter, 'signal', {});
    await handleStandardCommand(adapter, 'signal', { kind: 'both' });
    expect(adapter.calls).to.deep.equal([
      [VIN, 'door_lock', undefined, true],
      [VIN, 'door_unlock', undefined, true],
      [VIN, 'set_temps', 'driver_temp', 21.5],
      [VIN, 'auto_conditioning_start', undefined, true],
      [VIN, 'auto_conditioning_stop', undefined, true],
      [VIN, 'set_charge_limit', undefined, 80],
      [VIN, 'set_charging_amps', 'charging_amps', 16],
      [VIN, 'flash_lights', undefined, true],
      [VIN, 'honk_horn', undefined, true],
      [VIN, 'flash_lights', undefined, true],
    ]);
  });

  it('refuses missing or wrong parameters without sending anything', async () => {
    const adapter = fakeAdapter({ cars: [{ vin: VIN, name: 'Tessi' }] });
    for (const [command, message] of [
      ['lock', {}],
      ['climate', { temp: 20 }],
      ['climate', { on: true, temp: 'warm' }],
      ['charge', { on: 'yes' }],
      ['setChargeLimit', { percent: 0 }],
      ['setChargeCurrent', {}],
      ['signal', { kind: 'siren' }],
    ]) {
      expect((await handleStandardCommand(adapter, command, message)).reason, command).to.equal('BAD_REQUEST');
    }
    expect(adapter.calls).to.deep.equal([]);
  });

  it('answers COMMAND_FAILED or NOT_CONNECTED when the car did not take it', async () => {
    const one = [{ vin: VIN, name: 'Tessi' }];
    const refused = await handleStandardCommand(fakeAdapter({ cars: one, result: { result: false, reason: 'cable' } }), 'charge', { on: true });
    expect(refused).to.deep.equal({ error: 'The car did not take charge_start: cable', reason: 'COMMAND_FAILED' });
    const nothing = await handleStandardCommand(fakeAdapter({ cars: one, result: null }), 'charge', { on: true });
    expect(nothing.reason).to.equal('COMMAND_FAILED');
    const asleep = await handleStandardCommand(fakeAdapter({ cars: one, throwError: true }), 'lock', { locked: true });
    expect(asleep).to.deep.equal({ error: 'The car does not wake up (asleep)', reason: 'NOT_CONNECTED' });
  });

  it('answers pending while the car is still waking up', async () => {
    const adapter = fakeAdapter({ cars: [{ vin: VIN, name: 'Tessi' }], delayMs: 60, result: null });
    const answer = await handleStandardCommand(adapter, 'charge', { on: true }, { pendingMs: 10 });
    expect(answer).to.deep.equal({ ok: true, pending: true });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(adapter.calls.find((c) => c[0] === 'warn')[1]).to.include('did not take charge_start');
  });

  it('refresh reads all values, with wake: true after waking the car', async () => {
    const adapter = fakeAdapter({ cars: [{ vin: VIN, name: 'Tessi' }] });
    expect(await handleStandardCommand(adapter, 'refresh', {})).to.deep.equal({ ok: true });
    expect(await handleStandardCommand(adapter, 'refresh', { wake: true })).to.deep.equal({ ok: true });
    expect(adapter.calls).to.deep.equal([
      ['updateDevices', true, false],
      ['updateDevices', true, true],
      [VIN, 'wakeUpVehicle'],
      ['updateDevices', true, false],
      ['updateDevices', true, true],
    ]);
    const sleeping = fakeAdapter({ cars: [{ vin: VIN, name: 'Tessi' }], wakeState: 'asleep' });
    expect((await handleStandardCommand(sleeping, 'refresh', { wake: true })).reason).to.equal('NOT_CONNECTED');
  });

  it('getStatus reads the states, converts miles to km', async () => {
    const at = (val, ts = 1000) => ({ val, ts });
    const adapter = fakeAdapter({
      cars: [{ vin: VIN, name: 'Tessi' }],
      states: {
        [`${VIN}.charge_state.battery_level`]: at(76),
        [`${VIN}.charge_state.battery_range`]: at(200),
        [`${VIN}.charge_state.charging_state`]: at('Stopped'),
        [`${VIN}.vehicle_state.locked`]: at(true, 3000),
        [`${VIN}.climate_state.is_climate_on`]: at(false),
        [`${VIN}.climate_state.inside_temp`]: at(18.5),
        [`${VIN}.vehicle_state.odometer`]: at(10000),
        [`${VIN}.drive_state.latitude`]: at(52.5),
        [`${VIN}.drive_state.longitude`]: at(13.4),
      },
    });
    expect(await handleStandardCommand(adapter, 'getStatus', {})).to.deep.equal({
      batteryPercent: 76,
      rangeKm: 322,
      charging: false,
      plugged: true,
      locked: true,
      climate: false,
      insideTemp: 18.5,
      odometerKm: 16093,
      lat: 52.5,
      lon: 13.4,
      ts: 3000,
    });
    const empty = fakeAdapter({ cars: [{ vin: VIN, name: 'Tessi' }] });
    expect((await handleStandardCommand(empty, 'getStatus', {})).reason).to.equal('NOT_CONNECTED');
  });
});
