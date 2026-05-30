'use strict';

/**
 * Tesla product and vehicle responses may contain a `tokens` property. These
 * values are deprecated vehicle tokens and must not be mirrored into ioBroker
 * states, because the adapter intentionally deletes the legacy token object.
 *
 * @param {unknown} payload Tesla response object or response array.
 * @returns {unknown} The same payload instance without shallow `tokens` keys.
 */
function removeVehicleTokens(payload) {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      removeVehicleTokens(entry);
    }
    return payload;
  }

  if (payload && typeof payload === 'object') {
    delete /** @type {{ tokens?: unknown }} */ (payload).tokens;
  }

  return payload;
}

module.exports = {
  removeVehicleTokens,
};
