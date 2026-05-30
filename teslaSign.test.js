'use strict';

const { expect } = require('chai');
const { TeslaCommandSigner } = require('./lib/teslaSign');

describe('Tesla command signer helpers', () => {
  /**
   * Verifies the payload that will be encoded as CarServer.AutoSeatClimateAction.
   * The test stubs the transport layer so it stays deterministic and does not
   * require a real vehicle session.
   */
  it('builds auto seat climate actions for the two supported front seats', async () => {
    const signer = new TeslaCommandSigner({
      vin: 'VIN123',
      privateKey: Buffer.alloc(32),
      publicKey: Buffer.alloc(65),
      sendSignedCommand: async () => Buffer.alloc(0),
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    const payloads = [];
    signer._executeCarServerAction = async (payload) => {
      payloads.push(payload);
      return payload;
    };

    await signer.autoSeatClimate(0, true);
    await signer.autoSeatClimate(1, false);

    expect(payloads).to.deep.equal([
      {
        autoSeatClimateAction: {
          carseat: [{ on: true, seatPosition: 1 }],
        },
      },
      {
        autoSeatClimateAction: {
          carseat: [{ on: false, seatPosition: 2 }],
        },
      },
    ]);
  });

  it('rejects unsupported auto seat climate positions before sending a command', async () => {
    const signer = new TeslaCommandSigner({
      vin: 'VIN123',
      privateKey: Buffer.alloc(32),
      publicKey: Buffer.alloc(65),
      sendSignedCommand: async () => Buffer.alloc(0),
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    try {
      await signer.autoSeatClimate(2, true);
      throw new Error('Expected autoSeatClimate to reject unsupported seats');
    } catch (error) {
      expect(error.message).to.equal('Unsupported auto seat climate position: 2');
    }
  });
});
