'use strict';

const { expect } = require('chai');
const { removeVehicleTokens } = require('./lib/teslaResponse');

describe('Tesla response sanitizing', () => {
  it('removes deprecated vehicle tokens from product list entries before state parsing', () => {
    const products = [
      {
        vin: 'VIN123',
        display_name: 'Vehicle',
        tokens: ['legacy-token-a', 'legacy-token-b'],
      },
      {
        id: 'SITE123',
        site_name: 'Powerwall',
        tokens: ['legacy-site-token'],
      },
    ];

    const result = removeVehicleTokens(products);

    expect(result).to.equal(products);
    expect(products[0]).to.not.have.property('tokens');
    expect(products[1]).to.not.have.property('tokens');
    expect(products[0]).to.include({ vin: 'VIN123', display_name: 'Vehicle' });
    expect(products[1]).to.include({ id: 'SITE123', site_name: 'Powerwall' });
  });

  it('removes shallow tokens from a single vehicle response without touching other data', () => {
    const response = {
      id: 123,
      vin: 'VIN123',
      state: 'online',
      tokens: ['legacy-token'],
      vehicle_state: {
        locked: true,
        tokens: ['nested-value-is-not-a-state-root-token'],
      },
    };

    removeVehicleTokens(response);

    expect(response).to.not.have.property('tokens');
    expect(response.vehicle_state).to.deep.equal({
      locked: true,
      tokens: ['nested-value-is-not-a-state-root-token'],
    });
  });

  it('ignores empty responses', () => {
    expect(removeVehicleTokens(null)).to.equal(null);
    expect(removeVehicleTokens(undefined)).to.equal(undefined);
  });

  it('keeps empty arrays unchanged', () => {
    const products = [];

    const result = removeVehicleTokens(products);

    expect(result).to.equal(products);
    expect(products).to.deep.equal([]);
  });

  it('keeps scalar payloads unchanged', () => {
    expect(removeVehicleTokens(42)).to.equal(42);
    expect(removeVehicleTokens('online')).to.equal('online');
    expect(removeVehicleTokens(true)).to.equal(true);
  });
});
