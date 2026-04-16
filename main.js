'use strict';

const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const qs = require('qs');
const Json2iob = require('./lib/json2iob');
const { loadProtos, TeslaCommandSigner, parseECKeyFromPem } = require('./lib/teslaSign');

// Fleet API regional endpoints (like HA const.py:17-18)
const FLEET_API_REGIONS = {
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  cn: 'https://fleet-api.prd.cn.vn.cloud.tesla.cn',
};
const FLEET_AUTH_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com';

// Vehicle data endpoints to request (like HA coordinator.py:40-47)
const VEHICLE_ENDPOINTS = ['charge_state', 'climate_state', 'drive_state', 'vehicle_state', 'vehicle_config'];

class Teslamotors extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'tesla-motors',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('message', this.onMessage.bind(this));
    this.on('unload', this.onUnload.bind(this));

    this.session = {};
    this.sleepTimes = {};
    this.lastStates = {};
    this.lastActive = {};
    this.updateIntervalDrive = {};
    this.idArray = [];

    this.json2iob = new Json2iob(this);
    this.vin2id = {};
    this.id2vin = {};
    this.commandSigners = {}; // Per-VIN TeslaCommandSigner instances

    // Region and scopes derived from JWT (like HA __init__.py:81-84)
    this.region = null;
    this.scopes = [];

    this.requestClient = axios.create();
  }

  /**
   * Returns the Fleet API base URL for the current region.
   */
  getFleetApiBaseUrl() {
    const region = this.region || this.config.fleetApiRegion || 'eu';
    return FLEET_API_REGIONS[region] || FLEET_API_REGIONS.eu;
  }

  /**
   * Returns headers for Fleet API requests.
   */
  getFleetHeaders() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + this.session.access_token,
    };
  }

  /**
   * Decode JWT token without signature verification (like HA __init__.py:81).
   * Extracts region (ou_code) and scopes (scp).
   */
  parseJwtToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));

      // Region from JWT (like HA __init__.py:83)
      if (payload.ou_code) {
        const regionCode = payload.ou_code.toLowerCase();
        if (FLEET_API_REGIONS[regionCode]) {
          this.region = regionCode;
          this.log.info('Region from JWT: ' + regionCode);
        }
      }

      // Scopes from JWT (like HA __init__.py:82)
      if (payload.scp) {
        this.scopes = payload.scp;
        this.log.debug('Scopes from JWT: ' + this.scopes.join(', '));
      }
    } catch (error) {
      this.log.warn('Failed to parse JWT token: ' + error.message);
    }
  }

  async saveSession() {
    await this.setStateAsync('info.fleetSession', JSON.stringify(this.session), true);
  }

  async onReady() {
    this.setState('info.connection', false, true);

    // Load protobuf definitions for command signing
    try {
      await loadProtos();
      this.log.debug('Protobuf definitions loaded');
    } catch (/** @type {any} */ e) {
      this.log.error('Failed to load protobuf definitions: ' + e.message);
    }

    if (this.config.intervalNormal < 1) {
      this.log.info('Set interval to minimum 1');
      this.config.intervalNormal = 1;
    }
    this.adapterConfig = 'system.adapter.' + this.name + '.' + this.instance;

    // Create state for fleet session storage (avoids adapter restart on save)
    await this.setObjectNotExistsAsync('info.fleetSession', {
      type: 'state',
      common: { name: 'Fleet API Session', type: 'string', role: 'json', read: true, write: false },
      native: {},
    });

    if (this.config.reset) {
      const obj = await this.getForeignObjectAsync(this.adapterConfig);
      if (obj) {
        obj.native.reset = false;
        obj.native.codeUrl = '';
        obj.native.fleetSession = {};
        await this.setForeignObjectAsync(this.adapterConfig, obj);
        await this.setStateAsync('info.fleetSession', '', true);
        this.log.info('Login Token resetted');
        this.terminate();
      }
    }

    // Load fleet session from state
    const sessionState = await this.getStateAsync('info.fleetSession');
    if (sessionState && sessionState.val) {
      try {
        this.session = JSON.parse(sessionState.val);
        this.log.info('Fleet session loaded');
        this.log.info('Refresh session');
        await this.refreshToken(true);
      } catch (e) {
        this.log.warn('Failed to parse fleet session: ' + e.message);
      }
    } else {
      // Migration: load from native config (old storage)
      const obj = await this.getForeignObjectAsync(this.adapterConfig);
      if (obj && obj.native.fleetSession && obj.native.fleetSession.refresh_token) {
        this.session = obj.native.fleetSession;
        this.log.info('Fleet session migrated from native config');
        await this.saveSession();
        this.log.info('Refresh session');
        await this.refreshToken(true);
      }
    }

    this.updateInterval = null;
    this.reLoginTimeout = null;
    this.refreshTokenTimeout = null;

    this.subscribeStates('*');

    if (!this.session.access_token) {
      this.log.info('Initial login');
      await this.login();
    }
    if (this.session.access_token) {
      // Parse JWT for region and scopes
      this.parseJwtToken(this.session.access_token);

      this.log.info('Receive device list');
      await this.getDeviceList();
      this.log.info('Device list received, ' + this.idArray.length + ' devices found. Starting first update (forceUpdate=true)');
      await this.updateDevices(true);
      this.updateInterval = setInterval(async () => {
        await this.updateDevices();
      }, this.config.intervalNormal * 1000);
      this.log.info('Update interval set to ' + this.config.intervalNormal + 's');
      if (this.config.locationInterval > 10) {
        this.updateDevices(false, true);
        this.locationInterval = setInterval(async () => {
          await this.updateDevices(false, true);
        }, this.config.locationInterval * 1000);
      } else {
        this.log.info('Location interval is less than 10s. Skip location update');
      }
      const intervalTime = this.session.expires_in ? (this.session.expires_in - 200) * 1000 : 3000 * 1000;
      this.refreshTokenInterval = setInterval(() => {
        this.refreshToken();
      }, intervalTime);
    }
  }

  /**
   * Fleet API OAuth login (no PKCE, uses client_id + client_secret).
   */
  async login() {
    if (!this.config.codeUrl) {
      this.log.info('Waiting for codeURL please visit instance settings and copy url after login');
      return;
    }
    if (!this.config.clientId || !this.config.clientSecret) {
      this.log.error('clientId and clientSecret are required for Fleet API login');
      return;
    }

    let code;
    try {
      const queryParams = qs.parse(this.config.codeUrl.split('?')[1]);
      code = queryParams.code;
    } catch (error) {
      this.log.error(error);
      this.log.error('Invalid codeURL please visit instance settings and copy url after login');
      return;
    }

    const data = {
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: code,
      audience: this.getFleetApiBaseUrl(),
      redirect_uri: 'https://auth.tesla.com/void/callback',
    };
    this.log.debug(JSON.stringify(data));
    await this.requestClient({
      method: 'post',
      url: FLEET_AUTH_URL + '/oauth2/v3/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: qs.stringify(data),
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.parseJwtToken(this.session.access_token);
        this.log.info('Login successful');
        this.setState('info.connection', true, true);

        // Persist session immediately
        await this.saveSession();
        return res.data;
      })
      .catch(async (error) => {
        this.setState('info.connection', false, true);
        this.log.error(error);
        if (error.response) {
          this.log.error(JSON.stringify(error.response.data));
        }
        if (error.response && error.response.status === 403) {
          this.log.error('Please relogin in the settings and copy a new codeURL');
        }
      });
  }

  /**
   * Load device list via Fleet API /products endpoint (like HA __init__.py:109).
   * Returns vehicles (by VIN) and energy sites (by energy_site_id).
   */
  async getDeviceList() {
    await this.requestClient({
      method: 'get',
      url: this.getFleetApiBaseUrl() + '/api/1/products',
      headers: this.getFleetHeaders(),
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));

        this.idArray = [];
        this.log.info(`Found ${res.data.response.length} devices`);
        for (const device of res.data.response) {
          const id = device.vin || device.id;
          if (!device.id && !device.vin) {
            this.log.info('No ID found for device ' + JSON.stringify(device));
            continue;
          }
          const excludeList = this.config.excludeDeviceList.replace(/\s/g, '').split(',');
          if (excludeList.includes(id)) {
            this.log.info('Skip device ' + id);
            continue;
          }
          this.log.info(`Found device ${id} from type ${device.vehicle_id ? 'vehicle' : device.resource_type}`);

          // Remove cached_data to save memory (like HA __init__.py:133)
          delete device.cached_data;

          if (device.vehicle_id) {
            // Fleet API uses VIN directly as identifier
            this.vin2id[id] = id;
            this.id2vin[id] = id;
            this.idArray.push({
              id: id,
              type: 'vehicle',
              vehicle_id: device.vehicle_id,
              vin: id,
              signing: device.command_signing === 'required',
            });

            // Initialize command signer for this vehicle
            if (this.config.privateKey) {
              try {
                const keys = parseECKeyFromPem(this.config.privateKey);
                const self = this;
                this.commandSigners[id] = new TeslaCommandSigner({
                  vin: id,
                  privateKey: keys.privateKey,
                  publicKey: keys.publicKey,
                  sendSignedCommand: async (vin, buffer) => {
                    const res = await self.requestClient({
                      method: 'post',
                      url: self.getFleetApiBaseUrl() + '/api/1/vehicles/' + vin + '/signed_command',
                      headers: self.getFleetHeaders(),
                      data: { routable_message: buffer.toString('base64') },
                    });
                    if (!res.data || !res.data.response) throw new Error('Invalid signed_command response');
                    return Buffer.from(res.data.response, 'base64');
                  },
                  log: self.log,
                });
                this.log.info(`Command signer initialized for ${id} (signing=${device.command_signing === 'required'})`);
              } catch (/** @type {any} */ e) {
                this.log.warn(`Failed to init command signer for ${id}: ${e.message}`);
              }
            } else {
              this.log.info(`No private key configured - vehicle commands requiring signing will not work for ${id}`);
            }
          } else {
            if (!device.energy_site_id) {
              this.log.warn('No energy_site_id found for device ' + JSON.stringify(device));
              continue;
            }
            const deviceId = device.id_s || device.id;
            this.vin2id[id] = deviceId;
            this.id2vin[deviceId] = id;
            this.idArray.push({
              id: deviceId,
              type: device.resource_type || 'unknown',
              energy_site_id: device.energy_site_id,
            });
          }
          await this.setObjectNotExistsAsync(id, {
            type: 'device',
            common: {
              name: device.display_name || device.site_name || device.resource_type,
            },
            native: {},
          });

          this.json2iob.parse(id, device);

          await this.setObjectNotExistsAsync(id + '.remote', {
            type: 'channel',
            common: {
              name: 'Remote Controls',
            },
            native: {},
          });

          let remoteArray = [
            { command: 'force_update' },
            { command: 'wake_up' },
            { command: 'honk_horn' },
            { command: 'flash_lights' },
            { command: 'remote_start_drive' },
            { command: 'trigger_homelink' },
            { command: 'set_sentry_mode' },
            { command: 'door_unlock' },
            { command: 'door_lock' },
            { command: 'actuate_trunk-rear' },
            { command: 'actuate_trunk-front' },
            { command: 'window_control-vent' },
            { command: 'window_control-close' },
            { command: 'sun_roof_control-vent' },
            { command: 'sun_roof_control-close' },
            { command: 'charge_port_door_open' },
            { command: 'charge_port_door_close' },
            { command: 'charge_start' },
            { command: 'charge_stop' },
            { command: 'charge_standard' },
            { command: 'charge_max_range' },
            { command: 'set_charge_limit', type: 'number', role: 'level' },
            { command: 'set_temps-driver_temp', type: 'number', role: 'level' },
            { command: 'set_temps-passenger_temp', type: 'number', role: 'level' },
            { command: 'set_bioweapon_mode' },
            {
              command: 'set_scheduled_charging',
              name: 'Number of minutes from midnight in intervals of 15',
              type: 'json',
              role: 'state',
            },
            { command: 'set_scheduled_departure', name: 'Change default json to modify', type: 'json', role: 'state' },
            { command: 'set_charging_amps-charging_amps', type: 'number', role: 'level' },
            { command: 'remote_seat_heater_request-0', type: 'number', role: 'level' },
            { command: 'remote_seat_heater_request-1', type: 'number', role: 'level' },
            { command: 'remote_seat_heater_request-2', type: 'number', role: 'level' },
            { command: 'remote_seat_heater_request-3', type: 'number', role: 'level' },
            { command: 'remote_seat_heater_request-4', type: 'number', role: 'level' },
            { command: 'remote_seat_heater_request-5', type: 'number', role: 'level' },
            { command: 'schedule_software_update-offset_sec', type: 'number', role: 'level' },
            { command: 'auto_conditioning_start' },
            { command: 'auto_conditioning_stop' },
            { command: 'media_toggle_playback' },
            { command: 'media_next_track' },
            { command: 'media_prev_track' },
            { command: 'media_volume_up' },
            { command: 'media_volume_down' },
            { command: 'set_preconditioning_max' },
            { command: 'share', type: 'string', role: 'text' },
            { command: 'remote_steering_wheel_heater_request' },
          ];
          if (!device.vehicle_id) {
            remoteArray = [
              { command: 'backup-backup_reserve_percent', type: 'number', role: 'level' },
              { command: 'operation-self_consumption' },
              { command: 'operation-backup' },
              {
                command: 'off_grid_vehicle_charging_reserve-off_grid_vehicle_charging_reserve_percent',
                type: 'number',
                role: 'level',
              },
            ];
          }
          remoteArray.forEach(async (remote) => {
            await this.setObjectNotExistsAsync(id + '.remote.' + remote.command, {
              type: 'state',
              common: {
                name: remote.name || '',
                type: remote.type || 'boolean',
                role: remote.role || 'button',
                write: true,
                read: true,
              },
              native: {},
            });
            if (remote.command === 'set_scheduled_departure') {
              this.setState(
                id + '.remote.' + remote.command,
                `{
                                "departure_time": 375,
                                "preconditioning_weekdays_only": false,
                                "enable": true,
                                "off_peak_charging_enabled": true,
                                "preconditioning_enabled": false,
                                "end_off_peak_time": 420,
                                "off_peak_charging_weekdays_only": true
                            }`,
                true,
              );
            }
            if (remote.command === 'set_scheduled_charging') {
              this.setState(
                id + '.remote.' + remote.command,
                `{
                                    "time": 0,
                                    "enable": true
                                }`,
                true,
              );
            }
          });
          this.delObjectAsync(
            this.name + '.' + this.instance + '.' + id + '.remote.set_scheduled_charging-scheduled_charging',
          );
          this.delObjectAsync(
            this.name + '.' + this.instance + '.' + id + '.remote.set_scheduled_departure-scheduled_departure',
          );
          this.delObject(id + '.tokens', { recursive: true });
        }
      })
      .catch(async (error) => {
        if (error.response && error.response.status === 412) {
          this.log.info('Partner account not registered. Registering automatically...');
          const registered = await this.registerPartnerAccount();
          if (registered) {
            this.log.info('Partner registration successful. Retrying device list...');
            return this.getDeviceList();
          }
        }
        // 421 = wrong region, extract correct region from error and retry
        if (error.response && error.response.status === 421) {
          const errorMsg = error.response.data && error.response.data.error || '';
          const match = errorMsg.match(/fleet-api\.prd\.(\w+)\./);
          if (match && match[1] && FLEET_API_REGIONS[match[1]] && match[1] !== this.region) {
            this.log.info(`Region mismatch: switching from ${this.region} to ${match[1]}`);
            this.region = match[1];
            return this.getDeviceList();
          }
        }
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  /**
   * Register partner account in all regions (like HA config_flow.py).
   * Tesla requires this before /products can be called.
   */
  async registerPartnerAccount() {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.fleetkeyDomain) {
      this.log.error('clientId, clientSecret and fleetkeyDomain are required for partner registration');
      return false;
    }
    let anySuccess = false;
    for (const [region, baseUrl] of Object.entries(FLEET_API_REGIONS)) {
      if (region === 'cn') continue; // Skip China (like HA)
      try {
        const tokenRes = await this.requestClient({
          method: 'post',
          url: FLEET_AUTH_URL + '/oauth2/v3/token',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: qs.stringify({
            grant_type: 'client_credentials',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds energy_device_data energy_cmds',
            audience: baseUrl,
          }),
        });
        const partnerToken = tokenRes.data.access_token;

        const regRes = await this.requestClient({
          method: 'post',
          url: baseUrl + '/api/1/partner_accounts',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + partnerToken,
          },
          data: { domain: this.config.fleetkeyDomain },
        });
        this.log.info(`Partner registered in ${region}: ${JSON.stringify(regRes.data)}`);
        anySuccess = true;
      } catch (error) {
        this.log.warn(`Partner registration failed for ${region}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return anySuccess;
  }

  /**
   * Update all devices via Fleet API.
   * Vehicles: Free state check before expensive vehicle_data call (like HA coordinator.py:101-107).
   * Energy Sites: live_status, site_info, calendar_history (like HA coordinator.py:175-181).
   */
  async updateDevices(forceUpdate, location = false) {
    this.log.debug('updateDevices start (forceUpdate=' + forceUpdate + ', location=' + location + ', devices=' + this.idArray.length + ')');
    const fleetBase = this.getFleetApiBaseUrl();

    const energySiteArray = [
      { path: '', url: fleetBase + '/api/1/energy_sites/{energy_site_id}/site_info' },
      {
        path: '.live_status',
        url: fleetBase + '/api/1/energy_sites/{energy_site_id}/live_status',
      },
      {
        path: '.backup_history',
        url: fleetBase + '/api/1/energy_sites/{energy_site_id}/calendar_history?kind=backup&period=day&time_zone=Europe%2FBerlin',
      },
      {
        path: '.energy_history',
        url: fleetBase + '/api/1/energy_sites/{energy_site_id}/calendar_history?kind=energy&period=day&time_zone=Europe%2FBerlin',
      },
      {
        path: '.self_consumption_history',
        url:
          fleetBase + '/api/1/energy_sites/{energy_site_id}/calendar_history?kind=self_consumption&period=day&start_date=2016-01-01T00%3A00%3A00%2B01%3A00&time_zone=Europe%2FBerlin&end_date=' +
          this.getDate(),
      },
      {
        path: '.self_consumption_history_lifetime',
        url:
          fleetBase + '/api/1/energy_sites/{energy_site_id}/calendar_history?kind=self_consumption&period=lifetime&time_zone=Europe%2FBerlin&end_date=' +
          this.getDate(),
      },
      {
        path: '.energy_history_lifetime',
        url:
          fleetBase + '/api/1/energy_sites/{energy_site_id}/calendar_history?kind=energy&time_zone=Europe/Berlin&period=lifetime&end_date=' +
          this.getDate(),
      },
    ];
    const wallboxArray = [
      { path: '', url: fleetBase + '/api/1/energy_sites/{energy_site_id}/site_info' },
      {
        path: '.live_status',
        url: fleetBase + '/api/1/energy_sites/{energy_site_id}/live_status',
      },
      {
        path: '.telemetry_history',
        url:
          fleetBase + '/api/1/energy_sites/{energy_site_id}/telemetry_history?period=month&time_zone=Europe%2FBerlin&kind=charge&start_date=2016-01-01T00%3A00%3A00%2B01%3A00&end_date=' +
          this.getDate(),
      },
    ];

    this.idArray.forEach(async (product) => {
      if (product.type === 'vehicle') {
        await this.updateVehicle(product, forceUpdate, location);
      } else {
        const currentArray = product.type === 'wall_connector' ? wallboxArray : energySiteArray;
        await this.updateEnergyDevice(product, currentArray);
      }
    });
  }

  /**
   * Update a single vehicle via Fleet API.
   * Uses free API call to check state before expensive vehicle_data (like HA coordinator.py:101-107).
   */
  async updateVehicle(product, forceUpdate, location) {
    const vin = product.vin;
    const fleetBase = this.getFleetApiBaseUrl();
    const headers = this.getFleetHeaders();

    this.log.debug(vin + ' updateVehicle start (forceUpdate=' + forceUpdate + ', location=' + location + ')');

    // Free API call - check vehicle state without using quota (like HA coordinator.py:103)
    let state;
    try {
      const stateRes = await this.requestClient({
        method: 'get',
        url: fleetBase + '/api/1/vehicles/' + vin,
        headers: headers,
      });
      if (stateRes.data.response && stateRes.data.response.tokens) {
        delete stateRes.data.response.tokens;
      }
      this.json2iob.parse(vin, stateRes.data.response, { preferedArrayName: 'timestamp' });
      state = stateRes.data.response.state;
      this.log.debug(vin + ' state check response keys: ' + Object.keys(stateRes.data.response || {}).join(', '));
    } catch (/** @type {any} */ error) {
      if (error.response && error.response.status === 429) {
        this.log.warn(vin + ' rate limited on state check, skip this refresh');
        return;
      }
      if (error.response && error.response.status === 401) {
        this.log.info(vin + ' 401 on state check, scheduling token refresh');
        this.scheduleTokenRefresh();
        return;
      }
      if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
        this.log.info(vin + ' server error on state check: ' + error.response.status);
        return;
      }
      this.log.error('Vehicle state check failed for ' + vin);
      this.log.error(error);
      error.response && this.log.error(JSON.stringify(error.response.data));
      return;
    }

    this.log.info(vin + ' vehicle state: ' + state);

    // If not online, skip expensive call (like HA coordinator.py:106-107)
    if (state !== 'online') {
      if (forceUpdate || this.config.wakeup) {
        // Wake up on first poll after start (forceUpdate) or if wakeup is configured
        this.log.info(vin + ' is ' + state + ', waking up (forceUpdate=' + forceUpdate + ', wakeup=' + this.config.wakeup + ')');
        await this.wakeUpVehicle(vin, headers, fleetBase);
      } else {
        this.log.info(vin + ' is ' + state + ', skip vehicle_data call (wakeup=' + this.config.wakeup + ')');
        this.lastStates[vin] = state;
        return;
      }
    }
    this.lastStates[vin] = state;

    // Sleep management (like HA coordinator.py:130-146)
    if (!forceUpdate && this.lastStates[vin] !== 'asleep') {
      const waitForSleep = await this.checkWaitForSleepState(vin);
      if (waitForSleep && !this.config.wakeup) {
        if (!this.sleepTimes[vin]) {
          this.sleepTimes[vin] = Date.now();
        }
        if (Date.now() - this.sleepTimes[vin] >= 900000) {
          this.log.info(vin + ' wait for sleep was not successful after 15min, resuming updates');
          this.sleepTimes[vin] = null;
        } else {
          this.log.debug(vin + ' skip update, waiting for sleep (' + Math.round((Date.now() - this.sleepTimes[vin]) / 1000) + 's)');
          return;
        }
      }
    }

    // Build endpoints with scope check (like HA coordinator.py:92-96)
    let endpoints;
    if (location) {
      endpoints = this.scopes.includes('vehicle_location') ? ['location_data'] : [];
      if (endpoints.length === 0) {
        this.log.debug(vin + ' no vehicle_location scope, skip location update');
        return;
      }
    } else {
      endpoints = [...VEHICLE_ENDPOINTS];
      if (this.scopes.includes('vehicle_location')) {
        endpoints.push('location_data');
      }
    }

    // Vehicle data call (quota-consuming)
    try {
      const url = fleetBase + '/api/1/vehicles/' + vin + '/vehicle_data?endpoints=' + endpoints.join(',');
      this.log.info(vin + ' fetching vehicle_data: ' + endpoints.join(','));
      const res = await this.requestClient({ method: 'get', url: url, headers: headers });

      if (!res.data || !res.data.response) {
        this.log.info(vin + ' vehicle_data response is empty or malformed');
        this.log.debug(vin + ' raw response: ' + JSON.stringify(res.data).substring(0, 500));
        return;
      }
      if (res.data.response.tokens) delete res.data.response.tokens;

      const data = res.data.response;
      const dataKeys = Object.keys(data);
      this.log.info(vin + ' vehicle_data received, keys: ' + dataKeys.join(', '));

      // Log which endpoints returned data vs null/error
      for (const ep of VEHICLE_ENDPOINTS) {
        if (data[ep] === null || data[ep] === undefined) {
          this.log.debug(vin + ' endpoint ' + ep + ' is null/missing');
        } else if (data[ep] && data[ep].error) {
          this.log.info(vin + ' endpoint ' + ep + ' returned error: ' + data[ep].error);
        } else if (typeof data[ep] === 'object') {
          this.log.debug(vin + ' endpoint ' + ep + ' has ' + Object.keys(data[ep]).length + ' fields');
        }
      }

      this.json2iob.parse(vin, data);
      this.log.debug(vin + ' vehicle_data parsed to ioBroker objects');

      // Drive state interval management
      if (data.drive_state) {
        if (data.drive_state.shift_state && this.config.intervalDrive > 0) {
          if (!this.updateIntervalDrive[vin]) {
            this.updateIntervalDrive[vin] = setInterval(async () => {
              this.updateDrive(vin);
            }, this.config.intervalDrive * 1000);
          }
        } else {
          if (this.updateIntervalDrive[vin]) {
            clearInterval(this.updateIntervalDrive[vin]);
            this.updateIntervalDrive[vin] = null;
          }
        }
      }

      // Sleep management based on activity (like HA coordinator.py:130-146)
      if (data.charge_state && data.vehicle_state) {
        const isActive =
          data.charge_state.charging_state === 'Charging' ||
          data.vehicle_state.is_user_present ||
          data.vehicle_state.sentry_mode;
        if (isActive) {
          this.lastActive[vin] = Date.now();
          this.sleepTimes[vin] = null;
        }
      }
    } catch (/** @type {any} */ error) {
      if (error.response && error.response.status === 429) {
        this.log.warn(vin + ' rate limited on vehicle_data, skip this refresh');
        return;
      }
      if (error.response && error.response.status === 401) {
        this.log.info(vin + ' 401 on vehicle_data, scheduling token refresh');
        this.scheduleTokenRefresh();
        return;
      }
      if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
        this.log.info(vin + ' server error on vehicle_data: ' + error.response.status);
        return;
      }
      this.log.error('Vehicle data failed for ' + vin);
      this.log.error(error);
      error.response && this.log.error(JSON.stringify(error.response.data));
    }

    // Charge history (max once per hour)
    if (!location) {
      const diff = 60 * 60 * 1000;
      if (!this.lastChargeHistory || Date.now() - this.lastChargeHistory > diff) {
        this.lastChargeHistory = Date.now();
        try {
          const url = fleetBase + '/api/1/vehicles/' + vin + '/charge_history';
          const res = await this.requestClient({ method: 'post', url: url, headers: headers });
          if (res.data && res.data.response) {
            const data = res.data.response;
            if (data.charging_history_graph) {
              delete data.charging_history_graph.y_labels;
              delete data.charging_history_graph.x_labels;
            }
            if (data.gas_savings) delete data.gas_savings.card;
            if (data.energy_cost_breakdown) delete data.energy_cost_breakdown.card;
            if (data.charging_tips) delete data.charging_tips;
            this.json2iob.parse(vin + '.charge_history', data, { preferedArrayName: 'title', forceIndex: true });
          }
        } catch (error) {
          this.log.debug('Charge history failed for ' + vin + ': ' + (error.response ? error.response.status : error.message));
        }
      }
    }
  }

  /**
   * Update energy device (powerwall/wallbox) via Fleet API.
   */
  async updateEnergyDevice(product, statusArray) {
    const id = product.id;
    const energy_site_id = product.energy_site_id;
    const headers = this.getFleetHeaders();

    for (const element of statusArray) {
      const excludeList = this.config.excludeElementList.replace(/\s/g, '').split(',');
      if (element.path && excludeList.includes(element.path.replace('.', ''))) {
        this.log.info('Skip path ' + element.path);
        continue;
      }
      const url = element.url.replace('{energy_site_id}', energy_site_id);
      this.log.debug(url);

      await this.requestClient({
        method: element.method || 'GET',
        url: url,
        headers: headers,
      })
        .then((res) => {
          this.log.debug(JSON.stringify(res.data));
          if (!res.data) return;
          if (res.data.response && res.data.response.tokens) delete res.data.response.tokens;

          const data = res.data.response;
          const preferedArrayName = 'timestamp';
          let forceIndex = false;

          if (element.path.includes('lifetime')) {
            for (const serie of data.time_series) {
              if (!data.total) {
                data.total = JSON.parse(JSON.stringify(serie));
              } else {
                for (const key in serie) {
                  if (typeof serie[key] === 'number') {
                    data.total[key] += serie[key];
                  } else {
                    data.total[key] = serie[key];
                  }
                }
              }
            }
          }
          if (element.path.includes('energy_history')) {
            const totals = {};
            for (const serie of data.time_series) {
              let date = serie.timestamp.split('T')[0];
              if (element.path.includes('lifetime')) {
                date = serie.timestamp.slice(0, 4);
              }
              if (!totals[date]) {
                totals[date] = JSON.parse(JSON.stringify(serie));
              } else {
                for (const key in serie) {
                  if (typeof serie[key] === 'number') {
                    totals[date][key] += serie[key];
                  } else {
                    totals[date][key] = serie[key];
                  }
                }
              }
            }
            const totalArray = [];
            for (const key in totals) {
              totalArray.push(totals[key]);
            }
            data.time_series = totalArray;
          }
          if (element.path.includes('history')) {
            forceIndex = true;
          }

          this.json2iob.parse(this.id2vin[id] + element.path, data, {
            preferedArrayName: preferedArrayName,
            forceIndex: forceIndex,
          });
        })
        .catch((error) => {
          if (error.response && error.response.status === 401) {
            this.scheduleTokenRefresh();
            return;
          }
          if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
            this.log.debug(url);
            this.log.debug(error);
            return;
          }
          this.log.error('Energy device update failed');
          this.log.error(url);
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    }
  }

  /**
   * Update drive state for a vehicle via Fleet API.
   */
  async updateDrive(vin) {
    try {
      const res = await this.requestClient({
        method: 'get',
        url: this.getFleetApiBaseUrl() + '/api/1/vehicles/' + vin + '/vehicle_data?endpoints=drive_state',
        headers: this.getFleetHeaders(),
      });
      if (!res.data) return;
      if (res.data.response && res.data.response.tokens) delete res.data.response.tokens;
      this.json2iob.parse(vin, res.data.response);
    } catch (error) {
      if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
        this.log.debug('Drive update error: ' + error.response.status);
        return;
      }
      this.log.error('Drive update failed for ' + vin);
      this.log.error(error);
      error.response && this.log.error(JSON.stringify(error.response.data));
    }
  }

  /**
   * Wake up vehicle via Fleet API (no signing required).
   */
  async wakeUpVehicle(vin, headers, fleetBase) {
    let state = 'asleep';
    let retries = 0;
    while (state !== 'online' && retries < 5) {
      try {
        const res = await this.requestClient({
          method: 'post',
          url: fleetBase + '/api/1/vehicles/' + vin + '/wake_up',
          headers: headers,
        });
        state = res.data.response.state;
      } catch (error) {
        if (error.response && error.response.status !== 408 && error.response.status !== 503) {
          break;
        }
      }
      if (state !== 'online') {
        await this.sleep(10000);
      }
      retries++;
    }
    return state;
  }

  /**
   * Token refresh via Fleet API.
   * Refresh tokens are single-use - always save the new one!
   */
  async refreshToken(firstStart) {
    if (!this.config.clientId) {
      this.log.error('clientId is required for token refresh');
      return;
    }
    await this.requestClient({
      method: 'post',
      url: FLEET_AUTH_URL + '/oauth2/v3/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: qs.stringify({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: this.session.refresh_token,
      }),
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session.access_token = res.data.access_token;
        this.session.expires_in = res.data.expires_in;
        // Refresh tokens are single-use - save the new one
        if (res.data.refresh_token) {
          this.session.refresh_token = res.data.refresh_token;
          this.log.debug('New refresh token saved');
        }
        this.parseJwtToken(this.session.access_token);
        this.setState('info.connection', true, true);

        // Persist new session immediately (refresh token is single-use!)
        await this.saveSession();
        return res.data;
      })
      .catch(async (error) => {
        this.setState('info.connection', false, true);
        this.log.error('refresh token failed');
        this.log.error(error);
        if (error.code === 'ENOTFOUND') {
          this.log.error('No connection to Tesla server please check your connection');
          return;
        }
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          this.session = {};
          error.response && this.log.error(JSON.stringify(error.response.data));
          this.log.error('Start relogin in 1min');
          this.reLoginTimeout = setTimeout(() => {
            this.login();
          }, 1000 * 60 * 1);
        } else if (firstStart) {
          this.log.error('No connection to tesla server restart adapter in 1min');
          this.reLoginTimeout = setTimeout(() => {
            this.restart();
          }, 1000 * 60 * 1);
        }
      });
  }

  /**
   * Schedule a token refresh in 30 seconds (deduped).
   */
  scheduleTokenRefresh() {
    if (this.refreshTokenTimeout) return;
    this.log.info('Received 401 error. Refresh Token in 30 seconds');
    this.refreshTokenTimeout = setTimeout(() => {
      this.refreshTokenTimeout = null;
      this.log.info('Start refresh token');
      this.refreshToken();
    }, 1000 * 30);
  }

  async checkWaitForSleepState(vin) {
    const shift_state = await this.getStateAsync(vin + '.drive_state.shift_state');
    const chargeState = await this.getStateAsync(vin + '.charge_state.charging_state');

    if (
      (shift_state && shift_state.val !== null && shift_state.val !== 'P') ||
      (chargeState && !['Disconnected', 'Complete', 'NoPower', 'Stopped'].includes(chargeState.val))
    ) {
      if (shift_state && chargeState) {
        this.log.debug(
          'Skip sleep waiting because shift state: ' + shift_state.val + ' or charge state: ' + chargeState.val,
        );
      }
      return false;
    }
    const checkStates = [
      '.drive_state.shift_state',
      '.drive_state.speed',
      '.climate_state.is_climate_on',
      '.charge_state.battery_level',
      '.vehicle_state.odometer',
      '.vehicle_state.locked',
      '.charge_state.charge_port_door_open',
      '.vehicle_state.df',
    ];
    for (const stateId of checkStates) {
      const curState = await this.getStateAsync(vin + stateId);
      this.log.debug('Check state: ' + vin + stateId);
      if (stateId === '.drive_state.shift_state' && curState && (curState.val === 'P' || curState.val === null)) {
        continue;
      }
      if (curState && (curState.ts <= Date.now() - 1800000 || curState.ts - curState.lc <= 1800000)) {
        this.log.debug(
          `Skip sleep waiting because state ${vin + stateId} changed in last 30min TS: ${new Date(
            curState.ts,
          ).toLocaleString()} LC: ${new Date(curState.lc).toLocaleString()} value: ${curState.val}`,
        );
        return false;
      }
    }
    this.log.debug('Since 30 min no changes receiving. Start waiting for sleep');
    return true;
  }

  /**
   * Send command via Fleet API.
   * Vehicle wake_up: No signing needed.
   * Other vehicle commands: Signed via Vehicle Command Protocol.
   * Energy commands: Fleet API.
   */
  async sendCommand(id, command, action, value, nonVehicle) {
    const fleetBase = this.getFleetApiBaseUrl();
    const headers = this.getFleetHeaders();

    // Energy site commands via Fleet API
    if (nonVehicle) {
      const url = fleetBase + '/api/1/energy_sites/' + id + '/' + command;
      const data = this.buildCommandData(id, command, action, value);
      this.log.debug(url);
      this.log.debug(JSON.stringify(data));
      return await this.requestClient({ method: 'post', url: url, headers: headers, data: data })
        .then((res) => {
          this.log.info(JSON.stringify(res.data));
          if (res.data.response && res.data.response.tokens) delete res.data.response.tokens;
          return res.data.response;
        })
        .catch((error) => {
          if (error.response && error.response.status === 401) {
            this.scheduleTokenRefresh();
            return;
          }
          this.log.error(url);
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
          throw error;
        });
    }

    // Vehicle commands
    const vin = id;

    // wake_up works without signing
    if (command === 'wake_up') {
      const url = fleetBase + '/api/1/vehicles/' + vin + '/wake_up';
      this.log.debug(url);
      return await this.requestClient({ method: 'post', url: url, headers: headers })
        .then((res) => {
          this.log.info(JSON.stringify(res.data));
          if (res.data.response && res.data.response.tokens) delete res.data.response.tokens;
          return res.data.response;
        })
        .catch((error) => {
          if (error.response && error.response.status === 401) {
            this.scheduleTokenRefresh();
            return;
          }
          this.log.error('wake_up failed for ' + vin);
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
          throw error;
        });
    }

    // All other vehicle commands require signing
    const signer = this.commandSigners[vin];
    if (!signer) {
      this.log.warn(`No command signer for ${vin}. Check that a private key is configured and the virtual key is installed on the vehicle.`);
      return null;
    }

    this.log.info(`Sending signed command: ${command}${action ? '-' + action : ''} to ${vin}`);
    try {
      const result = await this.executeSignedCommand(signer, command, action, value);
      this.log.info(`Command ${command} successful for ${vin}`);
      return result;
    } catch (/** @type {any} */ error) {
      if (error.message && error.message.includes('Key not on vehicle whitelist')) {
        this.log.error(`Virtual Key not installed on vehicle ${vin}. Open https://tesla.com/_ak/${this.config.fleetkeyDomain || 'your-domain'} on your phone to install it.`);
      } else if (error.message && error.message.includes('401')) {
        this.scheduleTokenRefresh();
      } else {
        this.log.error(`Command ${command} failed for ${vin}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Map ioBroker remote command to TeslaCommandSigner method call.
   */
  async executeSignedCommand(signer, command, action, value) {
    switch (command) {
      // VCSEC commands (Vehicle Security domain)
      case 'door_lock':
        return signer.doorLock();
      case 'door_unlock':
        return signer.doorUnlock();
      case 'remote_start_drive':
        return signer.remoteStartDrive();
      case 'actuate_trunk':
        return signer.actuateTrunk(action || 'rear');

      // Charging commands
      case 'charge_start':
        return signer.chargeStart();
      case 'charge_stop':
        return signer.chargeStop();
      case 'charge_standard':
        return signer.chargeStandard();
      case 'charge_max_range':
        return signer.chargeMaxRange();
      case 'set_charge_limit':
        return signer.setChargeLimit(parseInt(value) || 80);
      case 'set_charging_amps':
        return signer.setChargingAmps(parseInt(value) || 32);
      case 'charge_port_door_open':
        return signer.chargePortDoorOpen();
      case 'charge_port_door_close':
        return signer.chargePortDoorClose();
      case 'set_scheduled_charging': {
        const sc = typeof value === 'string' ? JSON.parse(value) : value;
        return signer.scheduledCharging(!!sc.enable, sc.time || 0);
      }
      case 'set_scheduled_departure': {
        const sd = typeof value === 'string' ? JSON.parse(value) : value;
        return signer.scheduledDeparture({
          enabled: !!sd.enable,
          departureTime: sd.departure_time || 0,
          preconditioningTimes: sd.preconditioning_weekdays_only ? { weekdays: {} } : { allWeek: {} },
          offPeakChargingTimes: sd.off_peak_charging_weekdays_only ? { weekdays: {} } : { allWeek: {} },
          offPeakHoursEndTime: sd.end_off_peak_time || 0,
        });
      }

      // HVAC / Climate commands
      case 'auto_conditioning_start':
        return signer.hvacAutoOn();
      case 'auto_conditioning_stop':
        return signer.hvacAutoOff();
      case 'set_temps':
        return signer.setTemps(parseFloat(value) || 20);
      case 'set_preconditioning_max':
        return signer.setPreconditioningMax(!!value);
      case 'remote_steering_wheel_heater_request':
        return signer.steeringWheelHeater(!!value);
      case 'remote_seat_heater_request':
        return signer.seatHeater(parseInt(action) || 0, parseInt(value) || 0);
      case 'set_bioweapon_mode':
        return signer.bioweaponMode(!!value);

      // Vehicle control commands
      case 'honk_horn':
        return signer.honkHorn();
      case 'flash_lights':
        return signer.flashLights();
      case 'set_sentry_mode':
        return signer.sentryMode(!!value);
      case 'window_control':
        return signer.windowControl(action || 'vent');
      case 'sun_roof_control':
        return signer.sunroofControl(action || 'vent');
      case 'trigger_homelink':
        // TODO: get lat/lon from drive_state
        return signer.triggerHomelink(0, 0);
      case 'schedule_software_update':
        return signer.scheduleSoftwareUpdate(parseInt(value) || 0);
      case 'set_valet_mode':
        return signer.setValetMode(!!value);

      // Media commands
      case 'media_toggle_playback':
        return signer.mediaTogglePlayback();
      case 'media_next_track':
        return signer.mediaNextTrack();
      case 'media_prev_track':
        return signer.mediaPreviousTrack();
      case 'media_volume_up':
        return signer.mediaVolumeUp();
      case 'media_volume_down':
        return signer.mediaVolumeDown();

      // Share (not supported via signed commands - would need different approach)
      case 'share':
        this.log.warn('Share command is not supported via signed commands');
        return null;

      default:
        this.log.warn(`Unknown vehicle command: ${command}`);
        return null;
    }
  }

  /**
   * Build command data payload for energy site commands.
   */
  buildCommandData(id, command, action, value) {
    const valueArray = ['backup', 'off_grid_vehicle_charging_reserve'];
    const default_real_modeArray = ['operation'];
    const data = {};
    if (valueArray.includes(command)) {
      data[action] = value;
    }
    if (default_real_modeArray.includes(command)) {
      data['default_real_mode'] = action;
    }
    return data;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getDate() {
    return new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString();
  }

  /**
   * Handle messages from admin UI (e.g. server-side key pair generation).
   * @param {ioBroker.Message} obj
   */
  async onMessage(obj) {
    if (obj.command === 'generateKeyPair') {
      try {
        // @ts-ignore - TS confuses Node.js crypto with browser global
        const nodeCrypto = require('node:crypto');
        const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'sec1', format: 'pem' },
        });
        this.sendTo(obj.from, obj.command, { publicKey, privateKey }, obj.callback);
      } catch (/** @type {any} */ e) {
        this.sendTo(obj.from, obj.command, { error: e.message }, obj.callback);
      }
    }
  }

  /**
   * @param {() => void} callback
   */
  async onUnload(callback) {
    try {
      this.setState('info.connection', false, true);
      Object.keys(this.updateIntervalDrive).forEach((element) => {
        clearInterval(this.updateIntervalDrive[element]);
      });
      this.updateInterval && clearInterval(this.updateInterval);
      this.refreshTimeout && clearTimeout(this.refreshTimeout);
      this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
      this.locationInterval && clearInterval(this.locationInterval);
      this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
      this.log.info('Save login session');
      await this.saveSession();
      this.log.debug('Session saved');
      callback();
    } catch (_e) {
      callback();
    }
  }

  /**
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        if (id.indexOf('.remote.') === -1) {
          this.log.warn('No remote command');
          return;
        }
        const vin = id.split('.')[2];
        let productId = this.vin2id[vin];

        let command = id.split('.')[4];
        const action = command.split('-')[1];
        command = command.split('-')[0];
        if (command === 'force_update') {
          this.updateDevices(true);
          this.updateDevices(true, true);
          return;
        }

        // Determine if this is a vehicle or energy device
        const product = this.idArray.find((p) => p.vin === vin || p.id === productId);
        let nonVehicle = false;
        if (product && product.type !== 'vehicle') {
          // Energy site: use energy_site_id
          const productIdState = await this.getStateAsync(vin + '.energy_site_id');
          if (productIdState) {
            productId = productIdState.val;
            nonVehicle = true;
          }
        } else if (product && product.type === 'vehicle') {
          // Vehicle: wake up if needed
          productId = vin; // Fleet API uses VIN
          const stateRes = await this.requestClient({
            method: 'get',
            url: this.getFleetApiBaseUrl() + '/api/1/vehicles/' + vin,
            headers: this.getFleetHeaders(),
          }).catch(() => null);

          if (stateRes && stateRes.data && stateRes.data.response) {
            const vehicleState = stateRes.data.response.state;
            if (vehicleState !== 'online') {
              this.log.info('Wake up ' + vin);
              await this.wakeUpVehicle(vin, this.getFleetHeaders(), this.getFleetApiBaseUrl());
            }
          }
        }
        await this.sendCommand(productId, command, action, state.val, nonVehicle).catch(() => {});
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(async () => {
          await this.updateDevices(true);
        }, 5 * 1000);
      } else {
        if (id.indexOf('.remote.') !== -1) {
          return;
        }
        const resultDict = {
          driver_temp_setting: 'set_temps-driver_temp',
          charge_limit_soc: 'set_charge_limit',
          locked: 'door_lock',
          is_auto_conditioning_on: 'auto_conditioning_start',
          charge_port_door_open: 'charge_port_door_open',
          passenger_temp_setting: 'set_temps-passenger_temp',
          backup_reserve_percent: 'backup-backup_reserve_percent',
          off_grid_vehicle_charging_reserve_percent:
            'off_grid_vehicle_charging_reserve-off_grid_vehicle_charging_reserve_percent',
        };
        const idArray = id.split('.');
        const stateName = idArray[idArray.length - 1];
        const vin = id.split('.')[2];
        let value = true;
        if (resultDict[stateName] && isNaN(state.val)) {
          if (
            !state.val ||
            state.val === 'INVALID' ||
            state.val === 'NOT_CHARGING' ||
            state.val === 'ERROR' ||
            state.val === 'UNLOCKED'
          ) {
            value = false;
          }
        } else {
          value = state.val;
        }
        if (resultDict[stateName]) {
          this.log.debug('refresh remote state' + resultDict[stateName] + ' from ' + id);
          await this.setStateAsync(vin + '.remote.' + resultDict[stateName], value, true);
        }
      }
    }
  }
}

if (require.main !== module) {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Teslamotors(options);
} else {
  new Teslamotors();
}
