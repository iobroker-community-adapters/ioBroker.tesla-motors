'use strict';

const { expect } = require('chai');
const {
  FleetTelemetryManager,
  buildFleetTelemetryProxyPayload,
  getTelemetryRawStateUpdate,
  getTelemetryStateUpdates,
  normalizeCableType,
  normalizeChargeState,
  normalizeMqttBrokerUrl,
  parseTelemetryFieldsConfig,
  parseTelemetryTopic,
} = require('./lib/fleetTelemetry');

describe('Fleet Telemetry helper', () => {
  it('normalizes a bare MQTT host to mqtt://', () => {
    expect(normalizeMqttBrokerUrl('127.0.0.1:1883')).to.equal('mqtt://127.0.0.1:1883');
  });

  it('keeps a fully qualified MQTT URL unchanged', () => {
    expect(normalizeMqttBrokerUrl('mqtts://broker.example.com:8883')).to.equal('mqtts://broker.example.com:8883');
  });

  it('parses metric and connectivity topics', () => {
    expect(parseTelemetryTopic('tesla-telemetry', 'tesla-telemetry/LRW123/v/Soc')).to.deep.equal({
      kind: 'metric',
      vin: 'LRW123',
      fieldName: 'Soc',
    });
    expect(parseTelemetryTopic('tesla-telemetry', 'tesla-telemetry/LRW123/connectivity')).to.deep.equal({
      kind: 'connectivity',
      vin: 'LRW123',
    });
  });

  it('normalizes telemetry enum names to the existing adapter values', () => {
    expect(normalizeChargeState('ChargeStateCharging')).to.equal('Charging');
    expect(normalizeCableType('CableTypeIEC')).to.equal('IEC');
    expect(normalizeCableType('CableTypeUnknown')).to.equal('<invalid>');
  });

  it('maps telemetry metrics into the existing Tesla state tree', () => {
    expect(getTelemetryStateUpdates('VIN123', 'Soc', '57.5')).to.deep.equal([
      { id: 'VIN123.charge_state.battery_level', value: 57.5 },
    ]);

    expect(getTelemetryStateUpdates('VIN123', 'ChargeState', 'ChargeStateCharging')).to.deep.equal([
      { id: 'VIN123.charge_state.telemetry_charge_state', value: 'Charging' },
    ]);

    expect(getTelemetryStateUpdates('VIN123', 'ChargingCableType', 'CableTypeIEC')).to.deep.equal([
      { id: 'VIN123.charge_state.conn_charge_cable', value: 'IEC' },
    ]);

    expect(getTelemetryStateUpdates('VIN123', 'ChargePortDoorOpen', 'true')).to.deep.equal([
      { id: 'VIN123.charge_state.charge_port_door_open', value: true },
    ]);

    expect(getTelemetryStateUpdates('VIN123', 'Location', { latitude: '1.23', longitude: 4.56 })).to.deep.equal([
      { id: 'VIN123.drive_state.latitude', value: 1.23 },
      { id: 'VIN123.drive_state.longitude', value: 4.56 },
    ]);

    expect(getTelemetryStateUpdates('VIN123', 'DetailedChargeState', 'DetailedChargeStateCharging')).to.deep.equal([
      { id: 'VIN123.charge_state.charging_state', value: 'Charging' },
      { id: 'VIN123.charge_state.detailed_charge_state', value: 'Charging' },
    ]);
  });

  it('ignores invalid telemetry datums', () => {
    expect(getTelemetryStateUpdates('VIN123', 'Soc', { invalid: true })).to.deep.equal([]);
  });

  it('skips unchanged telemetry state writes', async () => {
    const writes = [];
    const adapter = {
      getStateAsync: async () => ({ val: 'Stopped' }),
      setStateAsync: async (id, value, ack) => writes.push({ id, value, ack }),
      log: { debug: () => {} },
    };
    const manager = new FleetTelemetryManager(adapter);

    const changed = await manager.setStateIfChanged('VIN123.charge_state.charging_state', 'Stopped');

    expect(changed).to.equal(false);
    expect(writes).to.deep.equal([]);
  });

  it('deduplicates concurrent telemetry writes for the same value', async () => {
    const writes = [];
    const states = new Map([['VIN123.charge_state.charging_state', { val: 'Charging' }]]);
    const adapter = {
      getStateAsync: async (id) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return states.get(id);
      },
      setStateAsync: async (id, value, ack) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        writes.push({ id, value, ack });
        states.set(id, { val: value });
      },
      log: { debug: () => {} },
    };
    const manager = new FleetTelemetryManager(adapter);

    const results = await Promise.all([
      manager.setStateIfChanged('VIN123.charge_state.charging_state', 'Stopped'),
      manager.setStateIfChanged('VIN123.charge_state.charging_state', 'Stopped'),
    ]);

    expect(results.filter(Boolean)).to.have.length(1);
    expect(writes).to.deep.equal([
      { id: 'VIN123.charge_state.charging_state', value: 'Stopped', ack: true },
    ]);
  });

  it('creates raw states for telemetry fields without an explicit adapter mapping', () => {
    expect(getTelemetryRawStateUpdate('VIN123', 'InsideTemp', 21.5)).to.deep.equal({
      id: 'VIN123.telemetry.fields.InsideTemp',
      value: 21.5,
    });

    expect(getTelemetryRawStateUpdate('VIN123', 'DestinationLocation', { latitude: 1, longitude: 2 })).to.deep.equal({
      id: 'VIN123.telemetry.fields.DestinationLocation',
      value: JSON.stringify({ latitude: 1, longitude: 2 }),
      forcedType: 'json',
    });
  });

  it('builds the proxy payload for fleet_telemetry_config', () => {
    const payload = buildFleetTelemetryProxyPayload(['VIN123'], {
      hostname: 'telemetry.example.com',
      port: 4443,
      ca: '-----BEGIN CERTIFICATE-----',
    });

    expect(payload.vins).to.deep.equal(['VIN123']);
    expect(payload.config.hostname).to.equal('telemetry.example.com');
    expect(payload.config.port).to.equal(4443);
    expect(payload.config.ca).to.equal('-----BEGIN CERTIFICATE-----');
    expect(payload.config.delivery_policy).to.equal('latest');
    expect(payload.config.fields).to.have.property('Soc').that.deep.equals({ interval_seconds: 1, minimum_delta: 1 });
    expect(payload.config.fields).to.have.property('Location').that.deep.equals({ interval_seconds: 10, minimum_delta: 100 });
  });

  it('parses custom telemetry field intervals from JSON', () => {
    const fields = parseTelemetryFieldsConfig(
      JSON.stringify({
        Soc: 300,
        Locked: { interval_seconds: '2' },
        VehicleName: false,
        Location: { interval_seconds: 10, minimum_delta: 25 },
      }),
    );

    expect(fields).to.deep.equal({
      Soc: { interval_seconds: 300, minimum_delta: 1 },
      Locked: { interval_seconds: 2 },
      Location: { interval_seconds: 10, minimum_delta: 25 },
    });
  });

  it('applies default telemetry minimum_delta values when omitted', () => {
    const fields = parseTelemetryFieldsConfig({
      Soc: { interval_seconds: 60 },
      EstBatteryRange: { interval_seconds: 300 },
      DestinationLocation: { interval_seconds: 10 },
      Location: { interval_seconds: 10, minimum_delta: '' },
    });

    expect(fields).to.deep.equal({
      Soc: { interval_seconds: 60, minimum_delta: 1 },
      EstBatteryRange: { interval_seconds: 300, minimum_delta: 1 },
      DestinationLocation: { interval_seconds: 10, minimum_delta: 100 },
      Location: { interval_seconds: 10 },
    });
  });

  it('supports array based telemetry field selection', () => {
    const fields = parseTelemetryFieldsConfig(['Soc', 'Locked', 'UnknownFutureField']);

    expect(fields).to.deep.equal({
      Soc: { interval_seconds: 1, minimum_delta: 1 },
      Locked: { interval_seconds: 1 },
      UnknownFutureField: { interval_seconds: 60 },
    });
  });

  it('rejects invalid telemetry field intervals', () => {
    expect(() => parseTelemetryFieldsConfig({ Soc: 0 })).to.throw(/greater than 0/);
    expect(() => parseTelemetryFieldsConfig({ Soc: { interval_seconds: 60, minimum_delta: 0 } })).to.throw(/minimum_delta greater than 0/);
    expect(() => parseTelemetryFieldsConfig('{')).to.throw(/Invalid telemetry fields JSON/);
  });
});
