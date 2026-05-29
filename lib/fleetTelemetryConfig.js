'use strict';

const axios = require('axios').default;
const https = require('node:https');
const {
  LOCATION_SCOPE_TELEMETRY_FIELDS,
  buildFleetTelemetryProxyPayload,
  parseTelemetryFieldsFromAdapterConfig,
} = require('./fleetTelemetry');

const TELEMETRY_INFO_STATES = [
  {
    id: 'info.telemetryConnected',
    common: { name: 'Telemetry MQTT connected', type: 'boolean', role: 'indicator.connected', read: true, write: false, def: false },
  },
  {
    id: 'info.telemetryConfigured',
    common: { name: 'Telemetry configured', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
  },
  {
    id: 'info.telemetrySynced',
    common: { name: 'Telemetry synced on vehicle', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
  },
  {
    id: 'info.telemetryLastMessage',
    common: { name: 'Last telemetry MQTT message metadata', type: 'string', role: 'json', read: true, write: false, def: '' },
  },
  {
    id: 'info.telemetryLastError',
    common: { name: 'Last telemetry error', type: 'string', role: 'text', read: true, write: false, def: '' },
  },
  {
    id: 'info.telemetryLastApiSync',
    common: { name: 'Last periodic Fleet API sync run', type: 'string', role: 'json', read: true, write: false, def: '' },
  },
  {
    id: 'info.telemetryLastVehicleDataSync',
    common: { name: 'Last vehicle_data API sync run', type: 'string', role: 'json', read: true, write: false, def: '' },
  },
  {
    id: 'info.telemetryLastChargeHistorySync',
    common: { name: 'Last charge history API sync run', type: 'string', role: 'json', read: true, write: false, def: '' },
  },
];
const FLEET_TELEMETRY_ADMIN_COMMANDS = new Set([
  'checkFleetStatus',
  'configureFleetTelemetry',
  'getFleetTelemetryConfig',
  'deleteFleetTelemetryConfig',
]);

/**
 * Checks whether a sendTo command belongs to the Fleet Telemetry admin actions.
 *
 * @param {string} command
 * @returns {boolean}
 */
function isFleetTelemetryAdminCommand(command) {
  return FLEET_TELEMETRY_ADMIN_COMMANDS.has(command);
}

/**
 * Normalizes Tesla/Fleet API response objects.
 *
 * @param {any} data
 * @returns {any}
 */
function extractTeslaResponse(data) {
  if (!data) {
    return null;
  }
  return data.response !== undefined ? data.response : data;
}

/**
 * Normalizes fleet status responses to a VIN keyed map.
 *
 * @param {any} data
 * @returns {Record<string, any>}
 */
function normalizeFleetStatusResponse(data) {
  const response = extractTeslaResponse(data);
  if (!response) {
    return {};
  }

  if (Array.isArray(response)) {
    return response.reduce((accumulator, entry) => {
      const vin = entry.vin || entry.VIN;
      if (vin) {
        accumulator[vin] = entry;
      }
      return accumulator;
    }, {});
  }

  if (response.vehicles && Array.isArray(response.vehicles)) {
    return response.vehicles.reduce((accumulator, entry) => {
      const vin = entry.vin || entry.VIN;
      if (vin) {
        accumulator[vin] = entry;
      }
      return accumulator;
    }, {});
  }

  if (response.vehicle_info && typeof response.vehicle_info === 'object' && !Array.isArray(response.vehicle_info)) {
    const keyPairedVins = new Set(response.key_paired_vins || response.keyPairedVins || []);
    const unpairedVins = new Set(response.unpaired_vins || response.unpairedVins || []);

    return Object.entries(response.vehicle_info).reduce((accumulator, [vin, entry]) => {
      if (!vin) {
        return accumulator;
      }

      const status = {
        vin,
        ...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}),
      };

      if (keyPairedVins.has(vin)) {
        status.key_paired = true;
      } else if (unpairedVins.has(vin)) {
        status.key_paired = false;
      }

      accumulator[vin] = status;
      return accumulator;
    }, {});
  }

  if (typeof response === 'object') {
    const keys = Object.keys(response);
    const looksLikeVinMap = keys.every((key) => /^[A-HJ-NPR-Z0-9]{10,}$/.test(key));
    if (looksLikeVinMap) {
      return response;
    }
  }

  return {};
}

/**
 * Parses Tesla firmware versions such as 2025.2.6 into comparable number arrays.
 *
 * @param {string} version
 * @returns {number[]}
 */
function parseFirmwareVersion(version) {
  return String(version || '')
    .split('.')
    .map((part) => parseInt(part, 10))
    .filter((part) => !isNaN(part));
}

/**
 * Returns true when the firmware is equal or newer than the provided minimum.
 *
 * @param {string} version
 * @param {number[]} minimum
 * @returns {boolean}
 */
function isMinimumFirmwareVersion(version, minimum) {
  const current = parseFirmwareVersion(version);
  for (let index = 0; index < Math.max(current.length, minimum.length); index++) {
    const left = current[index] || 0;
    const right = minimum[index] || 0;
    if (left > right) {
      return true;
    }
    if (left < right) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true if the reported firmware version supports proxy based telemetry config.
 *
 * @param {string} version
 * @returns {boolean}
 */
function isTelemetryFirmwareSupported(version) {
  return isMinimumFirmwareVersion(version, [2024, 26]);
}

/**
 * Attempts to derive the virtual-key pairing state from the fleet_status response.
 *
 * @param {any} status
 * @returns {boolean|null}
 */
function getVirtualKeyStatus(status) {
  const candidates = [
    status.virtual_key_paired,
    status.virtualKeyPaired,
    status.application_key_paired,
    status.applicationKeyPaired,
    status.public_key_available,
    status.publicKeyAvailable,
    status.public_key_present,
    status.publicKeyPresent,
    status.public_key_paired,
    status.publicKeyPaired,
    status.key_paired,
    status.keyPaired,
  ].filter((value) => value !== undefined);

  if (candidates.length === 0) {
    return null;
  }
  return candidates.some((value) => value === true);
}

/**
 * Encapsulates all Fleet Telemetry control-plane work that still needs the main
 * adapter context: diagnostic states, vehicle-command proxy access, fleet_status
 * validation and sendTo admin commands.
 */
class FleetTelemetryConfigurationManager {
  /**
   * @param {any} adapter
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.proxyClient = null;
  }

  /**
   * @param {string} command
   * @returns {boolean}
   */
  isAdminCommand(command) {
    return isFleetTelemetryAdminCommand(command);
  }

  /**
   * Creates telemetry related info states used by the MQTT bridge and admin actions.
   */
  async createInfoStates() {
    for (const state of TELEMETRY_INFO_STATES) {
      await this.adapter.setObjectNotExistsAsync(state.id, {
        type: 'state',
        common: state.common,
        native: {},
      });
    }
  }

  /**
   * Resets telemetry diagnostics on adapter startup so stale connection/errors do
   * not survive a restart.
   */
  async resetInfoStates() {
    for (const state of TELEMETRY_INFO_STATES) {
      await this.adapter.setStateAsync(state.id, state.common.def, true);
    }
  }

  /**
   * Returns all currently known vehicle VINs from the loaded product list.
   *
   * @returns {string[]}
   */
  getKnownVehicleVins() {
    return this.adapter.idArray.filter((product) => product.type === 'vehicle').map((product) => product.vin);
  }

  /**
   * Lazily builds an Axios client for the local vehicle-command proxy.
   */
  getProxyClient() {
    if (this.proxyClient) {
      return this.proxyClient;
    }

    const baseURL = String(this.adapter.config.telemetryProxyUrl || '').trim().replace(/\/+$/, '');
    if (!baseURL) {
      throw new Error('telemetryProxyUrl is not configured');
    }

    this.proxyClient = axios.create({
      baseURL,
      timeout: 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !this.adapter.config.telemetryProxyAllowInsecure,
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    return this.proxyClient;
  }

  /**
   * Executes a request against the local vehicle-command proxy with the current
   * Fleet OAuth token.
   *
   * @param {import('axios').AxiosRequestConfig} requestConfig
   * @returns {Promise<import('axios').AxiosResponse<any>>}
   */
  async requestProxy(requestConfig) {
    const client = this.getProxyClient();
    return client.request({
      ...requestConfig,
      headers: {
        Authorization: 'Bearer ' + this.adapter.session.access_token,
        ...(requestConfig.headers || {}),
      },
    });
  }

  /**
   * Calls Tesla's fleet_status endpoint and returns both the raw response and a
   * VIN keyed map to simplify validation in the admin actions.
   *
   * @param {string[]} [vins]
   * @returns {Promise<{raw: any; normalized: Record<string, any>}>}
   */
  async getFleetStatus(vins = this.getKnownVehicleVins()) {
    if (!vins.length) {
      throw new Error('No Tesla vehicle found for fleet status');
    }

    const response = await this.adapter.requestClient({
      method: 'post',
      url: this.adapter.getFleetApiBaseUrl() + '/api/1/vehicles/fleet_status',
      headers: this.adapter.getFleetHeaders(),
      data: { vins },
    });

    return {
      raw: response.data,
      normalized: normalizeFleetStatusResponse(response.data),
    };
  }

  /**
   * Builds the standard telemetry configuration payload for the vehicle-command proxy.
   *
   * @param {string[]} vins
   * @returns {{ vins: string[]; config: Record<string, any> }}
   */
  buildConfigPayload(vins) {
    if (!this.adapter.config.telemetryServerHost) {
      throw new Error('telemetryServerHost is not configured');
    }
    if (!this.adapter.config.telemetryServerCaPem) {
      throw new Error('telemetryServerCaPem is not configured');
    }

    const fields = parseTelemetryFieldsFromAdapterConfig(this.adapter.config);
    if (!this.adapter.scopes.includes('vehicle_location')) {
      const omittedFields = [];
      for (const fieldName of LOCATION_SCOPE_TELEMETRY_FIELDS) {
        if (fields[fieldName]) {
          delete fields[fieldName];
          omittedFields.push(fieldName);
        }
      }
      if (omittedFields.length) {
        this.adapter.log.info(`vehicle_location scope missing, omit Fleet Telemetry location fields: ${omittedFields.join(', ')}`);
      }
    }

    return buildFleetTelemetryProxyPayload(vins, {
      hostname: this.adapter.config.telemetryServerHost,
      port: this.adapter.config.telemetryServerPort,
      ca: this.adapter.config.telemetryServerCaPem,
      fields,
    });
  }

  /**
   * Reads telemetry configuration state for a VIN.
   *
   * @param {string} vin
   * @returns {Promise<any>}
   */
  async getConfig(vin) {
    const response = await this.requestProxy({
      method: 'get',
      url: `/api/1/vehicles/${vin}/fleet_telemetry_config`,
    });
    const data = extractTeslaResponse(response.data);
    const configured = !!(data && data.config);

    if (data && typeof data.synced === 'boolean') {
      await this.adapter.setStateAsync('info.telemetrySynced', configured && data.synced === true, true);
    }
    await this.adapter.setStateAsync('info.telemetryConfigured', configured, true);
    await this.adapter.setStateAsync('info.telemetryLastError', '', true);
    return data;
  }

  /**
   * Refreshes the diagnostic states that show whether Fleet Telemetry is already
   * configured and synced on the known vehicles. This is intentionally called
   * during startup too, so an already configured vehicle is reflected correctly
   * after an adapter restart.
   *
   * @param {string[]} [vins]
   * @returns {Promise<Record<string, any>>}
   */
  async refreshConfigurationStates(vins = this.getKnownVehicleVins()) {
    if (!vins.length) {
      await this.adapter.setStateAsync('info.telemetryConfigured', false, true);
      await this.adapter.setStateAsync('info.telemetrySynced', false, true);
      return {};
    }

    const configs = {};
    let anyConfigured = false;
    let allConfiguredAreSynced = true;

    for (const vin of vins) {
      try {
        configs[vin] = await this.getConfig(vin);
        const configured = !!(configs[vin] && configs[vin].config);
        anyConfigured = anyConfigured || configured;
        if (configured && configs[vin].synced !== true) {
          allConfiguredAreSynced = false;
        }
      } catch (error) {
        allConfiguredAreSynced = false;
        configs[vin] = { error: error.message };
      }
    }

    await this.adapter.setStateAsync('info.telemetryConfigured', anyConfigured, true);
    await this.adapter.setStateAsync('info.telemetrySynced', anyConfigured && allConfiguredAreSynced, true);
    return configs;
  }

  /**
   * Deletes a telemetry configuration from a VIN.
   *
   * @param {string} vin
   * @returns {Promise<any>}
   */
  async deleteConfig(vin) {
    const response = await this.requestProxy({
      method: 'delete',
      url: `/api/1/vehicles/${vin}/fleet_telemetry_config`,
    });
    await this.adapter.setStateAsync('info.telemetryConfigured', false, true);
    await this.adapter.setStateAsync('info.telemetrySynced', false, true);
    await this.adapter.setStateAsync('info.telemetryLastError', '', true);
    return extractTeslaResponse(response.data);
  }

  /**
   * Validates the current vehicle status and configures Fleet Telemetry through
   * the local vehicle-command proxy.
   *
   * @param {string[]} [vins]
   * @returns {Promise<{status: any; configure: any; configs: Record<string, any>; skippedVehicles: any[]}>}
   */
  async configure(vins = this.getKnownVehicleVins()) {
    if (!vins.length) {
      throw new Error('No Tesla vehicle found for telemetry configuration');
    }

    const status = await this.getFleetStatus(vins);
    /** @type {string[]} */
    const validationErrors = [];

    for (const vin of vins) {
      const vehicleStatus = status.normalized[vin];
      if (!vehicleStatus) {
        validationErrors.push(`${vin}: fleet_status missing`);
        continue;
      }

      const firmwareVersion = vehicleStatus.firmware_version || vehicleStatus.firmwareVersion;
      const streamingToggleState = vehicleStatus.safety_screen_streaming_toggle_enabled;
      if (typeof streamingToggleState === 'boolean') {
        if (firmwareVersion && !isMinimumFirmwareVersion(firmwareVersion, [2025, 20])) {
          validationErrors.push(`${vin}: unsupported_firmware (${firmwareVersion})`);
        }
        if (streamingToggleState === false) {
          validationErrors.push(`${vin}: streaming_toggle_disabled`);
        }
      } else {
        if (firmwareVersion && !isTelemetryFirmwareSupported(firmwareVersion)) {
          validationErrors.push(`${vin}: unsupported_firmware (${firmwareVersion})`);
        }

        const virtualKeyState = getVirtualKeyStatus(vehicleStatus);
        if (virtualKeyState === false) {
          validationErrors.push(`${vin}: missing_key`);
        }
      }

      if (vehicleStatus.limit_reached === true || vehicleStatus.config_limit_reached === true) {
        validationErrors.push(`${vin}: max_configs`);
      }
    }

    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.join('; ');
      await this.adapter.setStateAsync('info.telemetryLastError', errorMessage, true);
      throw new Error(errorMessage);
    }

    const payload = this.buildConfigPayload(vins);
    const configureResponse = await this.requestProxy({
      method: 'post',
      url: '/api/1/vehicles/fleet_telemetry_config',
      data: payload,
    });

    const configureData = extractTeslaResponse(configureResponse.data);
    const skippedVehicles = Array.isArray(configureData && configureData.skipped_vehicles) ? configureData.skipped_vehicles : [];
    if (skippedVehicles.length >= vins.length) {
      const errorMessage = skippedVehicles
        .map((entry) => `${entry.vin || entry.VIN || 'unknown'}: ${entry.reason || entry.code || 'skipped'}`)
        .join('; ');
      await this.adapter.setStateAsync('info.telemetryConfigured', false, true);
      await this.adapter.setStateAsync('info.telemetrySynced', false, true);
      await this.adapter.setStateAsync('info.telemetryLastError', errorMessage, true);
      throw new Error(errorMessage);
    }

    const configs = {};
    let allSynced = true;
    for (const vin of vins) {
      try {
        configs[vin] = await this.getConfig(vin);
        if (!configs[vin] || configs[vin].synced !== true) {
          allSynced = false;
        }
      } catch (error) {
        allSynced = false;
        configs[vin] = { error: error.message };
      }
    }

    await this.adapter.setStateAsync('info.telemetryConfigured', true, true);
    await this.adapter.setStateAsync('info.telemetrySynced', allSynced, true);
    await this.adapter.setStateAsync('info.telemetryLastError', '', true);

    return {
      status,
      configure: configureData,
      configs,
      skippedVehicles,
    };
  }

  /**
   * Executes one of the admin sendTo commands and returns its raw result.
   *
   * @param {string} command
   * @param {{vin?: string; vins?: string[]}} [message]
   * @returns {Promise<any>}
   */
  async handleAdminCommand(command, message = {}) {
    if (!this.isAdminCommand(command)) {
      throw new Error(`Unsupported Fleet Telemetry command: ${command}`);
    }
    if (!this.adapter.session.access_token) {
      throw new Error('Fleet API session is not available yet');
    }
    if (!this.adapter.idArray.length) {
      await this.adapter.getDeviceList({ throwOnError: true });
    }

    const vins = Array.isArray(message.vins) ? message.vins : message.vin ? [message.vin] : this.getKnownVehicleVins();

    if (command === 'checkFleetStatus') {
      return this.getFleetStatus(vins);
    }
    if (command === 'configureFleetTelemetry') {
      return this.configure(vins);
    }
    if (command === 'getFleetTelemetryConfig') {
      const result = {};
      for (const vin of vins) {
        result[vin] = await this.getConfig(vin);
      }
      return result;
    }
    if (command === 'deleteFleetTelemetryConfig') {
      const result = {};
      for (const vin of vins) {
        result[vin] = await this.deleteConfig(vin);
      }
      return result;
    }
    throw new Error(`Unsupported Fleet Telemetry command: ${command}`);
  }
}

module.exports = {
  FLEET_TELEMETRY_ADMIN_COMMANDS,
  FleetTelemetryConfigurationManager,
  TELEMETRY_INFO_STATES,
  extractTeslaResponse,
  getVirtualKeyStatus,
  isFleetTelemetryAdminCommand,
  isMinimumFirmwareVersion,
  isTelemetryFirmwareSupported,
  normalizeFleetStatusResponse,
  parseFirmwareVersion,
};
