'use strict';

const mqtt = require('mqtt');

/**
 * Default telemetry field selection for the first MQTT-based adapter integration.
 * The preset focuses on charging, lock and movement related data that is already
 * heavily used by existing ioBroker scripts.
 */
const DEFAULT_TELEMETRY_FIELDS = {
  ChargeState: { interval_seconds: 1 },
  DetailedChargeState: { interval_seconds: 1 },
  ChargeLimitSoc: { interval_seconds: 60 },
  ChargeAmps: { interval_seconds: 1 },
  ChargeCurrentRequest: { interval_seconds: 1 },
  ChargeCurrentRequestMax: { interval_seconds: 60 },
  ChargingCableType: { interval_seconds: 1 },
  ChargePortDoorOpen: { interval_seconds: 1 },
  EstBatteryRange: { interval_seconds: 60 },
  Soc: { interval_seconds: 1, minimum_delta: 1 },
  VehicleSpeed: { interval_seconds: 10 },
  Gear: { interval_seconds: 1 },
  // Location minimum_delta is measured in meters by Tesla. 100m is roughly
  // equivalent to 0.001° latitude/longitude and avoids tiny GPS jitter updates.
  Location: { interval_seconds: 10, minimum_delta: 100 },
  Locked: { interval_seconds: 1 },
  Odometer: { interval_seconds: 60 },
  VehicleName: { interval_seconds: 60 },
};

const DEFAULT_TELEMETRY_ALERT_TYPES = ['service', 'customer', 'service-fix'];
const DEFAULT_CUSTOM_FIELD_INTERVAL_SECONDS = 60;
const LOCATION_SCOPE_TELEMETRY_FIELDS = [
  'Location',
  'OriginLocation',
  'DestinationLocation',
  'DestinationName',
  'RouteLine',
  'GpsState',
  'GpsHeading',
];

/**
 * Mapping from Fleet Telemetry field names to the current ioBroker state tree.
 * This intentionally writes into the existing state paths so that old scripts
 * and aliases continue to work without any migration.
 */
const TELEMETRY_FIELD_MAPPINGS = {
  Soc: [{ statePath: 'charge_state.battery_level', targetType: 'number' }],
  ChargeState: [{ statePath: 'charge_state.charging_state', transform: normalizeChargeState, targetType: 'string' }],
  DetailedChargeState: [{ statePath: 'charge_state.detailed_charge_state', transform: normalizeDetailedChargeState, targetType: 'string' }],
  ChargeLimitSoc: [{ statePath: 'charge_state.charge_limit_soc', targetType: 'number' }],
  ChargeAmps: [
    { statePath: 'charge_state.charge_amps', targetType: 'number' },
    { statePath: 'charge_state.charger_actual_current', targetType: 'number' },
  ],
  ChargeCurrentRequest: [{ statePath: 'charge_state.charge_current_request', targetType: 'number' }],
  ChargeCurrentRequestMax: [{ statePath: 'charge_state.charge_current_request_max', targetType: 'number' }],
  ChargingCableType: [{ statePath: 'charge_state.conn_charge_cable', transform: normalizeCableType, targetType: 'string' }],
  ChargePortDoorOpen: [{ statePath: 'charge_state.charge_port_door_open', targetType: 'boolean' }],
  EstBatteryRange: [{ statePath: 'charge_state.est_battery_range', targetType: 'number' }],
  VehicleSpeed: [{ statePath: 'drive_state.speed', targetType: 'number' }],
  Gear: [{ statePath: 'drive_state.shift_state', transform: normalizeGear, targetType: 'string' }],
  Location: [
    { statePath: 'drive_state.latitude', pick: 'latitude', targetType: 'number' },
    { statePath: 'drive_state.longitude', pick: 'longitude', targetType: 'number' },
  ],
  Locked: [{ statePath: 'vehicle_state.locked', targetType: 'boolean' }],
  Odometer: [{ statePath: 'vehicle_state.odometer', targetType: 'number' }],
  VehicleName: [{ statePath: 'vehicle_state.vehicle_name', targetType: 'string' }],
};

/**
 * Normalizes the MQTT broker setting into a connectable URL.
 *
 * @param {string} broker
 * @returns {string}
 */
function normalizeMqttBrokerUrl(broker) {
  const trimmed = String(broker || '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return 'mqtt://' + trimmed;
}

/**
 * Parses a JSON payload from Fleet Telemetry's MQTT datastore.
 *
 * @param {Buffer|string} payload
 * @returns {any}
 */
function parseTelemetryPayload(payload) {
  const raw = Buffer.isBuffer(payload) ? payload.toString('utf-8') : String(payload);
  return JSON.parse(raw);
}

/**
 * Fleet Telemetry represents invalid values as JSON objects with invalid=true.
 *
 * @param {any} value
 * @returns {boolean}
 */
function isInvalidTelemetryValue(value) {
  return !!value && typeof value === 'object' && value.invalid === true;
}

/**
 * Converts values such as ShiftStateD to the existing ioBroker format D.
 *
 * @param {any} value
 * @returns {any}
 */
function normalizeGear(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.startsWith('ShiftState') ? value.substring('ShiftState'.length) : value;
}

/**
 * Converts values such as DetailedChargeStateCharging to Charging.
 *
 * @param {any} value
 * @returns {any}
 */
function normalizeDetailedChargeState(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.startsWith('DetailedChargeState') ? value.substring('DetailedChargeState'.length) : value;
}

/**
 * Converts values such as ChargeStateCharging to Charging.
 *
 * @param {any} value
 * @returns {any}
 */
function normalizeChargeState(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.startsWith('ChargeState') ? value.substring('ChargeState'.length) : value;
}

/**
 * Converts values such as CableTypeIEC to IEC and keeps the legacy
 * "<invalid>" representation for unknown / unavailable cable states.
 *
 * @param {any} value
 * @returns {any}
 */
function normalizeCableType(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.startsWith('CableType') ? value.substring('CableType'.length) : value;
  if (!normalized || normalized === 'Unknown' || normalized === 'SNA') {
    return '<invalid>';
  }
  return normalized;
}

/**
 * Converts MQTT payload values into the expected ioBroker state type.
 *
 * @param {any} value
 * @param {'string'|'number'|'boolean'|undefined} targetType
 * @returns {any}
 */
function coerceTelemetryValue(value, targetType) {
  if (!targetType) {
    return value;
  }

  if (targetType === 'string') {
    return value === null || value === undefined ? value : String(value);
  }

  if (targetType === 'number') {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  if (targetType === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
    return undefined;
  }

  return value;
}

/**
 * Builds the payload for the vehicle-command proxy endpoint.
 *
 * @param {string[]} vins
 * @param {{ hostname: string; port?: number; ca: string; fields?: Record<string, any>; alertTypes?: string[] }} options
 * @returns {{ vins: string[]; config: Record<string, any> }}
 */
function buildFleetTelemetryProxyPayload(vins, options) {
  const hostname = String(options.hostname || '').trim();
  const ca = String(options.ca || '').trim();
  return {
    vins,
    config: {
      hostname,
      port: Number(options.port) || 443,
      ca,
      fields: options.fields || cloneDefaultTelemetryFields(),
      alert_types: options.alertTypes || [...DEFAULT_TELEMETRY_ALERT_TYPES],
      delivery_policy: 'latest',
    },
  };
}

/**
 * Parses the optional admin setting for Fleet Telemetry fields. The setting is
 * intentionally flexible:
 *
 * - empty string: use the adapter default preset
 * - object: { "Soc": 60, "Locked": { "interval_seconds": 1 } }
 * - object wrapper: { "fields": { ... } }
 * - array: [ "Soc", "Locked" ] using default or 60s intervals
 *
 * Values set to false, null or { enabled: false } are omitted.
 *
 * @param {string | Record<string, any> | string[] | null | undefined} value
 * @returns {Record<string, { interval_seconds: number } & Record<string, any>>}
 */
function parseTelemetryFieldsConfig(value) {
  if (value === undefined || value === null || value === '') {
    return cloneDefaultTelemetryFields();
  }

  let parsed = value;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) {
      return cloneDefaultTelemetryFields();
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid telemetry fields JSON: ${error.message}`, { cause: error });
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.fields && typeof parsed.fields === 'object') {
    parsed = parsed.fields;
  }

  if (Array.isArray(parsed)) {
    return normalizeTelemetryFieldEntries(
      Object.fromEntries(
        parsed.map((fieldName) => {
          const normalizedName = String(fieldName || '').trim();
          return [normalizedName, true];
        }),
      ),
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Telemetry fields must be a JSON object or array');
  }

  return normalizeTelemetryFieldEntries(parsed);
}

/**
 * @param {Record<string, any>} entries
 * @returns {Record<string, { interval_seconds: number } & Record<string, any>>}
 */
function normalizeTelemetryFieldEntries(entries) {
  /** @type {Record<string, { interval_seconds: number } & Record<string, any>>} */
  const normalized = {};
  for (const [rawFieldName, rawOptions] of Object.entries(entries)) {
    const fieldName = String(rawFieldName || '').trim();
    if (!fieldName) {
      continue;
    }

    const fieldOptions = normalizeTelemetryFieldOptions(fieldName, rawOptions);
    if (!fieldOptions) {
      continue;
    }
    normalized[fieldName] = fieldOptions;
  }
  return normalized;
}

/**
 * @param {string} fieldName
 * @param {any} rawOptions
 * @returns {({ interval_seconds: number } & Record<string, any>) | null}
 */
function normalizeTelemetryFieldOptions(fieldName, rawOptions) {
  if (rawOptions === false || rawOptions === null) {
    return null;
  }

  if (rawOptions === true || rawOptions === undefined) {
    return addDefaultTelemetryMinimumDelta(fieldName, { interval_seconds: getDefaultTelemetryInterval(fieldName) });
  }

  if (typeof rawOptions === 'number' || typeof rawOptions === 'string') {
    return addDefaultTelemetryMinimumDelta(fieldName, { interval_seconds: normalizeTelemetryInterval(rawOptions, fieldName) });
  }

  if (typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
    throw new Error(`Telemetry field "${fieldName}" must be a number, boolean or object`);
  }

  if (rawOptions.enabled === false || rawOptions.disabled === true) {
    return null;
  }

  const normalized = { ...rawOptions };
  delete normalized.enabled;
  delete normalized.disabled;
  normalized.interval_seconds = normalizeTelemetryInterval(
    normalized.interval_seconds === undefined ? getDefaultTelemetryInterval(fieldName) : normalized.interval_seconds,
    fieldName,
  );
  if (normalized.minimum_delta !== undefined) {
    if (normalized.minimum_delta === '' || normalized.minimum_delta === false || normalized.minimum_delta === null) {
      delete normalized.minimum_delta;
    } else {
      normalized.minimum_delta = normalizeTelemetryMinimumDelta(normalized.minimum_delta, fieldName);
    }
  }

  return normalized;
}

/**
 * @param {string} fieldName
 * @returns {number}
 */
function getDefaultTelemetryInterval(fieldName) {
  return DEFAULT_TELEMETRY_FIELDS[fieldName]?.interval_seconds || DEFAULT_CUSTOM_FIELD_INTERVAL_SECONDS;
}

/**
 * @param {string} fieldName
 * @returns {number | undefined}
 */
function getDefaultTelemetryMinimumDelta(fieldName) {
  return DEFAULT_TELEMETRY_FIELDS[fieldName]?.minimum_delta;
}

/**
 * @param {string} fieldName
 * @param {{ interval_seconds: number } & Record<string, any>} options
 * @returns {{ interval_seconds: number } & Record<string, any>}
 */
function addDefaultTelemetryMinimumDelta(fieldName, options) {
  const minimumDelta = getDefaultTelemetryMinimumDelta(fieldName);
  if (minimumDelta !== undefined) {
    return { ...options, minimum_delta: minimumDelta };
  }
  return options;
}

/**
 * @param {any} rawInterval
 * @param {string} fieldName
 * @returns {number}
 */
function normalizeTelemetryInterval(rawInterval, fieldName) {
  const interval = Number(rawInterval);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`Telemetry field "${fieldName}" requires interval_seconds greater than 0`);
  }
  return Math.round(interval);
}

/**
 * @param {any} rawMinimumDelta
 * @param {string} fieldName
 * @returns {number}
 */
function normalizeTelemetryMinimumDelta(rawMinimumDelta, fieldName) {
  const minimumDelta = Number(rawMinimumDelta);
  if (!Number.isFinite(minimumDelta) || minimumDelta <= 0) {
    throw new Error(`Telemetry field "${fieldName}" requires minimum_delta greater than 0 when configured`);
  }
  return minimumDelta;
}

/**
 * Deep-clones the default field preset to keep the runtime mutations local.
 *
 * @returns {Record<string, { interval_seconds: number } & Record<string, any>>}
 */
function cloneDefaultTelemetryFields() {
  return JSON.parse(JSON.stringify(DEFAULT_TELEMETRY_FIELDS));
}

/**
 * Extracts all state updates for a given Fleet Telemetry field.
 *
 * @param {string} vin
 * @param {string} fieldName
 * @param {any} value
 * @returns {Array<{ id: string; value: any }>}
 */
function getTelemetryStateUpdates(vin, fieldName, value) {
  if (!vin || !fieldName || isInvalidTelemetryValue(value)) {
    return [];
  }

  const mappings = TELEMETRY_FIELD_MAPPINGS[fieldName];
  if (!mappings) {
    return [];
  }

  /** @type {Array<{ id: string; value: any }>} */
  const updates = [];
  for (const mapping of mappings) {
    let nextValue = value;
    if (mapping.pick) {
      if (!nextValue || typeof nextValue !== 'object' || nextValue[mapping.pick] === undefined) {
        continue;
      }
      nextValue = nextValue[mapping.pick];
    }
    if (mapping.transform) {
      nextValue = mapping.transform(nextValue);
    }
    nextValue = coerceTelemetryValue(nextValue, mapping.targetType);
    if (nextValue === undefined || isInvalidTelemetryValue(nextValue)) {
      continue;
    }
    updates.push({
      id: `${vin}.${mapping.statePath}`,
      value: nextValue,
    });
  }
  return updates;
}

/**
 * Builds a generic raw telemetry state update for fields that do not yet have
 * an explicit mapping into the existing Tesla state tree. This makes every
 * configurable Fleet Telemetry field usable from ioBroker scripts without
 * requiring a new adapter release for each Tesla field addition.
 *
 * @param {string} vin
 * @param {string} fieldName
 * @param {any} value
 * @returns {{ id: string; value: any; forcedType?: 'json' } | null}
 */
function getTelemetryRawStateUpdate(vin, fieldName, value) {
  if (!vin || !fieldName || isInvalidTelemetryValue(value)) {
    return null;
  }

  const id = `${vin}.telemetry.fields.${fieldName}`;
  if (value && typeof value === 'object') {
    return {
      id,
      value: JSON.stringify(value),
      forcedType: 'json',
    };
  }

  return {
    id,
    value,
  };
}

/**
 * Creates the MQTT topic list used by the adapter.
 *
 * @param {string} topicBase
 * @returns {string[]}
 */
function getTelemetrySubscriptions(topicBase) {
  const base = String(topicBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return [];
  }
  return [`${base}/+/v/+`, `${base}/+/connectivity`, `${base}/+/errors/+`, `${base}/+/alerts/+/current`];
}

/**
 * Parses an MQTT topic from the official Fleet Telemetry MQTT datastore.
 *
 * @param {string} topicBase
 * @param {string} topic
 * @returns {{ kind: 'metric' | 'connectivity' | 'error' | 'alert' | 'unknown'; vin?: string; fieldName?: string; suffix?: string }}
 */
function parseTelemetryTopic(topicBase, topic) {
  const base = String(topicBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return { kind: 'unknown' };
  }

  const prefix = `${base}/`;
  if (!topic.startsWith(prefix)) {
    return { kind: 'unknown' };
  }

  const parts = topic.substring(prefix.length).split('/');
  if (parts.length === 3 && parts[1] === 'v') {
    return { kind: 'metric', vin: parts[0], fieldName: parts[2] };
  }
  if (parts.length === 2 && parts[1] === 'connectivity') {
    return { kind: 'connectivity', vin: parts[0] };
  }
  if (parts.length === 3 && parts[1] === 'errors') {
    return { kind: 'error', vin: parts[0], suffix: parts[2] };
  }
  if (parts.length === 4 && parts[1] === 'alerts') {
    return { kind: 'alert', vin: parts[0], suffix: `${parts[2]}/${parts[3]}` };
  }
  return { kind: 'unknown' };
}

/**
 * Lightweight runtime bridge between Tesla Fleet Telemetry MQTT topics and the
 * existing ioBroker Tesla state tree.
 */
class FleetTelemetryManager {
  /**
   * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.client = null;
    this.createdObjects = new Set();
  }

  /**
   * Connects to the configured MQTT broker and subscribes to telemetry topics.
   */
  async start() {
    if (!this.adapter.config.telemetryEnabled) {
      return;
    }

    const brokerUrl = normalizeMqttBrokerUrl(this.adapter.config.telemetryMqttBroker);
    const topicBase = String(this.adapter.config.telemetryMqttTopicBase || '').trim();
    if (!brokerUrl || !topicBase) {
      await this.adapter.setStateAsync('info.telemetryLastError', 'Telemetry MQTT broker or topic base is not configured', true);
      this.adapter.log.warn('Telemetry mode is enabled, but MQTT broker/topic base is missing');
      return;
    }

    this.client = mqtt.connect(brokerUrl, {
      username: this.adapter.config.telemetryMqttUsername || undefined,
      password: this.adapter.config.telemetryMqttPassword || undefined,
      clientId: `iobroker-tesla-${this.adapter.instance}-${Date.now()}`,
      keepalive: 30,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      resubscribe: true,
    });

    this.client.on('connect', async () => {
      this.adapter.log.info(`Connected to telemetry MQTT broker ${brokerUrl}`);
      await this.adapter.setStateAsync('info.telemetryConnected', true, true);
      await this.adapter.setStateAsync('info.telemetryLastError', '', true);
      await this.subscribe(topicBase);
    });

    this.client.on('reconnect', () => {
      this.adapter.log.info('Reconnecting to telemetry MQTT broker');
    });

    this.client.on('close', async () => {
      await this.adapter.setStateAsync('info.telemetryConnected', false, true);
    });

    this.client.on('error', async (error) => {
      this.adapter.log.warn(`Telemetry MQTT error: ${error.message}`);
      await this.adapter.setStateAsync('info.telemetryLastError', error.message, true);
    });

    this.client.on('message', async (topic, payload) => {
      await this.handleMessage(topicBase, topic, payload);
    });
  }

  /**
   * Disconnects from MQTT during adapter unload.
   */
  async stop() {
    if (!this.client) {
      return;
    }
    const client = this.client;
    this.client = null;
    await new Promise((resolve) => client.end(true, resolve));
  }

  /**
   * @param {string} topicBase
   */
  async subscribe(topicBase) {
    if (!this.client) {
      return;
    }

    for (const topic of getTelemetrySubscriptions(topicBase)) {
      await new Promise((resolve, reject) => {
        this.client.subscribe(topic, { qos: 0 }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      }).catch(async (error) => {
        this.adapter.log.warn(`Failed to subscribe telemetry topic ${topic}: ${error.message}`);
        await this.adapter.setStateAsync('info.telemetryLastError', error.message, true);
      });
    }
  }

  /**
   * @param {string} topicBase
   * @param {string} topic
   * @param {Buffer} payload
   */
  async handleMessage(topicBase, topic, payload) {
    let decoded;
    try {
      decoded = parseTelemetryPayload(payload);
    } catch (error) {
      this.adapter.log.warn(`Failed to parse telemetry payload for topic ${topic}: ${error.message}`);
      await this.adapter.setStateAsync('info.telemetryLastError', error.message, true);
      return;
    }

    await this.adapter.setStateAsync(
      'info.telemetryLastMessage',
      JSON.stringify({
        topic,
        receivedAt: new Date().toISOString(),
      }),
      true,
    );

    const parsedTopic = parseTelemetryTopic(topicBase, topic);
    if (parsedTopic.kind === 'metric' && parsedTopic.vin && parsedTopic.fieldName) {
      const updates = getTelemetryStateUpdates(parsedTopic.vin, parsedTopic.fieldName, decoded);
      if (updates.length) {
        for (const update of updates) {
          await this.ensureStateExists(update.id, update.value);
          await this.adapter.setStateAsync(update.id, update.value, true);
        }
      } else {
        const rawUpdate = getTelemetryRawStateUpdate(parsedTopic.vin, parsedTopic.fieldName, decoded);
        if (rawUpdate) {
          await this.ensureStateExists(rawUpdate.id, rawUpdate.value, rawUpdate.forcedType);
          await this.adapter.setStateAsync(rawUpdate.id, rawUpdate.value, true);
        }
      }
      return;
    }

    if (parsedTopic.kind === 'connectivity' && parsedTopic.vin) {
      await this.ensureStateExists(`${parsedTopic.vin}.telemetry.connectivity`, JSON.stringify(decoded), 'json');
      await this.adapter.setStateAsync(`${parsedTopic.vin}.telemetry.connectivity`, JSON.stringify(decoded), true);
      return;
    }

    if ((parsedTopic.kind === 'error' || parsedTopic.kind === 'alert') && parsedTopic.vin) {
      const suffix = parsedTopic.kind === 'error' ? 'last_error' : 'last_alert';
      await this.ensureStateExists(`${parsedTopic.vin}.telemetry.${suffix}`, JSON.stringify(decoded), 'json');
      await this.adapter.setStateAsync(`${parsedTopic.vin}.telemetry.${suffix}`, JSON.stringify(decoded), true);
    }
  }

  /**
   * Creates missing channel/state objects lazily so telemetry-only setups do not
   * depend on a previous vehicle_data poll.
   *
   * @param {string} id
   * @param {any} value
   * @param {'auto'|'json'} [forcedType='auto']
   */
  async ensureStateExists(id, value, forcedType = 'auto') {
    const parts = id.split('.');
    let currentPath = '';

    for (let index = 0; index < parts.length - 1; index++) {
      currentPath = currentPath ? `${currentPath}.${parts[index]}` : parts[index];
      if (this.createdObjects.has(currentPath)) {
        continue;
      }
      await this.adapter.setObjectNotExistsAsync(currentPath, {
        type: index === 0 ? 'device' : 'channel',
        common: {
          name: parts[index],
        },
        native: {},
      });
      this.createdObjects.add(currentPath);
    }

    if (this.createdObjects.has(id)) {
      return;
    }

    const stateType = forcedType === 'json' ? 'string' : inferIoBrokerType(value);
    const role = stateType === 'boolean' ? 'indicator' : stateType === 'number' ? 'value' : stateType === 'string' ? 'text' : 'state';

    await this.adapter.setObjectNotExistsAsync(id, {
      type: 'state',
      common: {
        name: parts[parts.length - 1],
        type: stateType,
        role,
        read: true,
        write: false,
      },
      native: {},
    });
    this.createdObjects.add(id);
  }
}

/**
 * @param {any} value
 * @returns {'string'|'number'|'boolean'}
 */
function inferIoBrokerType(value) {
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  return 'string';
}

module.exports = {
  DEFAULT_CUSTOM_FIELD_INTERVAL_SECONDS,
  DEFAULT_TELEMETRY_ALERT_TYPES,
  DEFAULT_TELEMETRY_FIELDS,
  FleetTelemetryManager,
  LOCATION_SCOPE_TELEMETRY_FIELDS,
  TELEMETRY_FIELD_MAPPINGS,
  buildFleetTelemetryProxyPayload,
  coerceTelemetryValue,
  cloneDefaultTelemetryFields,
  getTelemetryStateUpdates,
  getTelemetryRawStateUpdate,
  getTelemetrySubscriptions,
  normalizeCableType,
  normalizeChargeState,
  normalizeDetailedChargeState,
  normalizeGear,
  normalizeMqttBrokerUrl,
  parseTelemetryFieldsConfig,
  parseTelemetryPayload,
  parseTelemetryTopic,
};
