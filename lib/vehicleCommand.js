'use strict';

const VEHICLE_COMMAND_PROTOCOL_UNSUPPORTED_PATTERN = /does not support the Tesla Vehicle Command Protocol/i;

/**
 * Reads the command-signing information from a Fleet API product response.
 *
 * Tesla reports `command_signing: "required"` for vehicles that need the
 * Vehicle Command Protocol. Older Model S/X vehicles and some fleet/business
 * vehicles can continue to use the normal Fleet command endpoints instead.
 *
 * @param {Record<string, any> | null | undefined} product
 * @returns {boolean | undefined} `true` when signing is required, `false` when
 * direct Fleet commands should be used, `undefined` when Tesla did not report a
 * usable value.
 */
function getVehicleCommandProtocolRequiredFromProduct(product) {
  const commandSigning = product && product.command_signing;
  if (commandSigning === undefined || commandSigning === null || commandSigning === '') {
    return undefined;
  }

  if (commandSigning === true || commandSigning === false) {
    return commandSigning;
  }

  const normalizedCommandSigning = String(commandSigning).toLowerCase();
  if (normalizedCommandSigning === 'required') {
    return true;
  }
  if (['not_required', 'unsupported', 'not_supported', 'none'].includes(normalizedCommandSigning)) {
    return false;
  }

  return undefined;
}

/**
 * Detects the Fleet API error returned when a signed command was sent to a
 * vehicle that does not support the Vehicle Command Protocol.
 *
 * @param {any} error
 * @returns {boolean}
 */
function isVehicleCommandProtocolUnsupportedError(error) {
  const status = error && error.response && error.response.status;
  const responseData = error && error.response && error.response.data;
  const message = [
    responseData && responseData.error,
    responseData && responseData.error_description,
    responseData && responseData.message,
    error && error.message,
  ]
    .filter(Boolean)
    .join(' ');

  if (!VEHICLE_COMMAND_PROTOCOL_UNSUPPORTED_PATTERN.test(message)) {
    return false;
  }

  // Axios errors include response.status. Some lower-level signer errors can
  // also be plain Error instances, so keep the text match as a fallback when no
  // HTTP status is available.
  return status === undefined || status === 422;
}

/**
 * Returns the value of a state read via the passed adapter callback.
 *
 * @param {(id: string) => Promise<ioBroker.State | null | undefined>} readState
 * @param {string} id
 * @param {any} fallback
 * @returns {Promise<any>}
 */
async function readStateValue(readState, id, fallback) {
  const state = await readState(id);
  return state && state.val !== undefined && state.val !== null ? state.val : fallback;
}

/**
 * Builds the JSON payload for the normal Fleet command endpoint
 * `/api/1/vehicles/{vin}/command/{command}`.
 *
 * This intentionally mirrors the legacy Owner/Fleet command payloads. It is
 * used for vehicles where the Vehicle Command Protocol is not required or not
 * supported, for example pre-2021 Model S/X vehicles.
 *
 * @param {string} command
 * @param {string | undefined} action
 * @param {any} value
 * @param {{
 *   readState?: (id: string) => Promise<ioBroker.State | null | undefined>;
 *   password?: string;
 * }} [context]
 * @returns {Promise<Record<string, any>>}
 */
async function buildFleetVehicleCommandPayload(command, action, value, context = {}) {
  const readState = context.readState || (async () => null);
  const passwordArray = ['remote_start_drive'];
  const latlonArray = ['trigger_homelink', 'window_control'];
  const onArray = [
    'remote_steering_wheel_heater_request',
    'set_preconditioning_max',
    'set_sentry_mode',
    'set_bioweapon_mode',
    'set_valet_mode',
  ];
  const valueArray = ['set_temps', 'schedule_software_update', 'set_charging_amps'];
  const stateArray = ['sun_roof_control'];
  const commandArray = ['window_control'];
  const percentArray = ['set_charge_limit'];
  const heaterArray = ['remote_seat_heater_request'];
  const shareArray = ['share'];
  const trunkArray = ['actuate_trunk'];
  const plainArray = ['set_scheduled_charging', 'set_scheduled_departure'];
  /** @type {Record<string, any>} */
  let data = {};

  if (passwordArray.includes(command) && context.password) {
    data.password = context.password;
  }

  if (latlonArray.includes(command)) {
    data.lat = await readStateValue(readState, 'drive_state.latitude', 0);
    data.lon = await readStateValue(readState, 'drive_state.longitude', 0);
  }

  if (onArray.includes(command)) {
    data.on = value;
  }

  if (valueArray.includes(command)) {
    if (command === 'set_temps') {
      const driverTemp = await readStateValue(readState, 'climate_state.driver_temp_setting', 23);
      data.driver_temp = driverTemp;
      data.passenger_temp = await readStateValue(readState, 'climate_state.passenger_temp_setting', driverTemp);
    }
    if (action) {
      data[action] = value;
    }
  }

  if (heaterArray.includes(command)) {
    data.heater = parseInt(action || '0', 10) || 0;
    data.level = value;
  }

  if (command === 'remote_auto_seat_climate_request') {
    data.auto_seat_position = parseInt(action || '0', 10) || 0;
    data.auto_climate_on = value;
  }

  if (command === 'set_valet_mode' && context.password) {
    data.password = context.password;
  }

  if (stateArray.includes(command)) {
    data.state = action;
  }

  if (commandArray.includes(command)) {
    data.command = action;
  }

  if (percentArray.includes(command)) {
    data.percent = value;
  }

  if (trunkArray.includes(command)) {
    data.which_trunk = action || 'rear';
  }

  if (shareArray.includes(command)) {
    data = {
      type: 'share_ext_content_raw',
      value: {
        'android.intent.ACTION': 'android.intent.action.SEND',
        'android.intent.TYPE': 'text/plain',
        'android.intent.extra.SUBJECT': 'Ortsname',
        'android.intent.extra.TEXT': value,
      },
      locale: 'de-DE',
      timestamp_ms: (Date.now() / 1000).toFixed(0),
    };
  }

  if (plainArray.includes(command)) {
    try {
      data = typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      throw new Error(`Invalid JSON payload for ${command}: ${error.message}`);
    }
  }

  return data;
}

module.exports = {
  buildFleetVehicleCommandPayload,
  getVehicleCommandProtocolRequiredFromProduct,
  isVehicleCommandProtocolUnsupportedError,
};
