'use strict';

const { expect } = require('chai');
const {
  buildFleetVehicleCommandPayload,
  getVehicleCommandProtocolRequiredFromProduct,
  isVehicleCommandProtocolUnsupportedError,
} = require('./lib/vehicleCommand');

describe('Vehicle command compatibility helper', () => {
  it('detects whether Tesla requires the Vehicle Command Protocol from product data', () => {
    expect(getVehicleCommandProtocolRequiredFromProduct({ command_signing: 'required' })).to.equal(true);
    expect(getVehicleCommandProtocolRequiredFromProduct({ command_signing: 'not_required' })).to.equal(false);
    expect(getVehicleCommandProtocolRequiredFromProduct({ command_signing: 'unsupported' })).to.equal(false);
    expect(getVehicleCommandProtocolRequiredFromProduct({ command_signing: 'future_value' })).to.equal(undefined);
    expect(getVehicleCommandProtocolRequiredFromProduct({})).to.equal(undefined);
  });

  it('recognizes the Tesla error for vehicles without Vehicle Command Protocol support', () => {
    const error = {
      response: {
        status: 422,
        data: {
          error: 'vehicle does not support the Tesla Vehicle Command Protocol, please refer to the documentation',
        },
      },
    };

    expect(isVehicleCommandProtocolUnsupportedError(error)).to.equal(true);
    expect(
      isVehicleCommandProtocolUnsupportedError(new Error('vehicle does not support the Tesla Vehicle Command Protocol')),
    ).to.equal(true);
    expect(isVehicleCommandProtocolUnsupportedError({ response: { status: 403, data: error.response.data } })).to.equal(false);
  });

  it('builds payloads for legacy Fleet charging commands', async () => {
    expect(await buildFleetVehicleCommandPayload('set_charge_limit', undefined, 80)).to.deep.equal({
      percent: 80,
    });

    expect(await buildFleetVehicleCommandPayload('set_charging_amps', 'charging_amps', 12)).to.deep.equal({
      charging_amps: 12,
    });
  });

  it('builds payloads for legacy Fleet climate temperature updates', async () => {
    const states = {
      'climate_state.driver_temp_setting': { val: 21 },
      'climate_state.passenger_temp_setting': { val: 22 },
    };
    const payload = await buildFleetVehicleCommandPayload('set_temps', 'driver_temp', 23, {
      readState: async (id) => states[id],
    });

    expect(payload).to.deep.equal({
      driver_temp: 23,
      passenger_temp: 22,
    });
  });

  it('builds payloads for location based legacy Fleet commands', async () => {
    const states = {
      'drive_state.latitude': { val: 51.1 },
      'drive_state.longitude': { val: 6.7 },
    };
    const payload = await buildFleetVehicleCommandPayload('window_control', 'close', true, {
      readState: async (id) => states[id],
    });

    expect(payload).to.deep.equal({
      lat: 51.1,
      lon: 6.7,
      command: 'close',
    });
  });

  it('passes scheduled charging JSON through for legacy Fleet commands', async () => {
    const payload = await buildFleetVehicleCommandPayload(
      'set_scheduled_charging',
      undefined,
      '{"time":375,"enable":true}',
    );

    expect(payload).to.deep.equal({
      time: 375,
      enable: true,
    });
  });

  it('builds payloads for automatic front-seat climate on legacy Fleet commands', async () => {
    const payload = await buildFleetVehicleCommandPayload('remote_auto_seat_climate_request', '1', true);

    expect(payload).to.deep.equal({
      auto_seat_position: 1,
      auto_climate_on: true,
    });
  });

  it('builds numeric heater payloads for legacy Fleet seat heater commands', async () => {
    const payload = await buildFleetVehicleCommandPayload('remote_seat_heater_request', '3', 2);

    expect(payload).to.deep.equal({
      heater: 3,
      level: 2,
    });
  });
});
