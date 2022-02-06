"use strict";

/*
 * Created with @iobroker/create-adapter v1.34.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const qs = require("qs");
const WebSocket = require("ws");
const crypto = require("crypto");
const Json2iob = require("./lib/json2iob");
const axiosCookieJarSupport = require("axios-cookiejar-support").default;
const tough = require("tough-cookie");

class Teslamotors extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "tesla-motors",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.session = {};
        this.ownSession = {};
        this.sleepTimes = {};
        this.lastStates = {};
        this.updateIntervalDrive = {};
        this.idArray = [];

        this.json2iob = new Json2iob(this);
        this.vin2id = {};
        this.id2vin = {};
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        if (this.config.intervalNormal < 1) {
            this.log.info("Set interval to minimum 1");
            this.config.intervalNormal = 1;
        }
        this.adapterConfig = "system.adapter." + this.name + "." + this.instance;
        const obj = await this.getForeignObjectAsync(this.adapterConfig);
        if (this.config.reset) {
            if (obj) {
                obj.native.session = {};
                obj.native.cookies = "";
                obj.native.captchaSvg = "";
                obj.native.reset = false;
                obj.native.captcha = "";
                obj.native.codeUrl = "";
                await this.setForeignObjectAsync(this.adapterConfig, obj);
                this.log.info("Login Token resetted");
                this.terminate();
            }
        }

        axiosCookieJarSupport(axios);
        this.cookieJar = new tough.CookieJar();

        if (obj && obj.native.cookies) {
            this.cookieJar = tough.CookieJar.fromJSON(obj.native.cookies);
        }

        this.requestClient = axios.create();

        if (obj && obj.native.session && obj.native.session.refresh_token) {
            this.session = obj.native.session;

            await this.refreshToken(true);
        }
        this.updateInterval = null;
        this.reLoginTimeout = null;
        this.refreshTokenTimeout = null;

        this.subscribeStates("*");
        this.headers = {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "x-tesla-user-agent": "TeslaApp/3.10.14-474/540f6f430/ios/12.5.1",
            "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "accept-language": "de-de",
        };
        if (!this.session.access_token) {
            await this.login();
        }
        if (this.session.access_token && this.ownSession.access_token) {
            await this.getDeviceList();
            this.updateDevices();
            this.updateInterval = setInterval(async () => {
                await this.updateDevices();
            }, this.config.intervalNormal * 1000);

            this.refreshTokenInterval = setInterval(() => {
                this.refreshToken();
            }, this.session.expires_in * 1000);
        }
    }
    async login() {
        if (!this.config.codeUrl) {
            this.log.info("Waiting for codeURL please visit instance settings and copy url after login");
            return;
        }
        const codeChallenge = "Tb-FGN3adrpojN8dmKySlVfBPdg-rA-voNN_3lftZVM";
        const code_verifier = "82326a2311262e580d179dc5023f3a7fd9bc3c9e0049f83138596b66c34fcdc7";
        let code = "";
        try {
            code = this.config.codeUrl.split("https://auth.tesla.com/void/callback?code=")[1].split("&state")[0];
        } catch (error) {
            this.log.error("Invalid codeURL please visit instance settings and copy url after login");
            return;
        }

        const data = {
            grant_type: "authorization_code",
            code: code,
            client_id: "ownerapi",
            redirect_uri: "https://auth.tesla.com/void/callback",
            scope: "openid offline_access",
            code_verifier: code_verifier,
        };
        this.log.debug(JSON.stringify(data));
        await this.requestClient({
            method: "post",
            url: "https://auth.tesla.com/oauth2/v3/token",
            headers: this.headers,
            data: qs.stringify(data),
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));
                this.session = res.data;

                await this.getOwnerToken();
                this.log.info("Login successful");
                this.setState("info.connection", true, true);
                return res.data;
            })
            .catch(async (error) => {
                this.setState("info.connection", false, true);
                this.log.error(error);
                if (error.response) {
                    this.log.error(JSON.stringify(error.response.data));
                }
                if (error.response && error.response.status === 403) {
                    this.log.error("Please relogin in the settings and copy a new codeURL");
                    const obj = await this.getForeignObjectAsync(this.adapterConfig);
                    if (obj) {
                        obj.native.codeUrl = "";
                        this.setForeignObject(this.adapterConfig, obj);
                    }
                }
            });
    }

    async getDeviceList() {
        const headers = {
            "Content-Type": "application/json",
            Accept: "*/*",
            "User-Agent": "ioBroker 1.0.0",
            Authorization: "Bearer " + this.ownSession.access_token,
        };
        await this.requestClient({
            method: "get",
            url: "https://owner-api.teslamotors.com/api/1/products",
            headers: headers,
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));

                this.idArray = [];
                for (const device of res.data.response) {
                    const id = device.vin || device.id;
                    const deviceId = device.id_s || device.id;
                    this.vin2id[id] = deviceId;
                    this.id2vin[deviceId] = id;
                    this.log.debug(id);
                    if (device.vehicle_id) {
                        this.idArray.push({ id: this.vin2id[id], type: "vehicle", vehicle_id: device.vehicle_id });
                    } else {
                        this.idArray.push({ id: this.vin2id[id], type: device.resource_type || "unknown", energy_site_id: device.energy_site_id });
                    }
                    await this.setObjectNotExistsAsync(id, {
                        type: "device",
                        common: {
                            name: device.display_name || device.site_name || device.resource_type,
                        },
                        native: {},
                    });

                    this.json2iob.parse(id, device);

                    await this.setObjectNotExistsAsync(id + ".remote", {
                        type: "channel",
                        common: {
                            name: "Remote Controls",
                        },
                        native: {},
                    });

                    let remoteArray = [
                        { command: "force_update" },
                        { command: "wake_up" },
                        { command: "honk_horn" },
                        { command: "flash_lights" },
                        { command: "remote_start_drive" },
                        { command: "trigger_homelink" },
                        { command: "set_sentry_mode" },
                        { command: "door_unlock" },
                        { command: "door_lock" },
                        { command: "actuate_trunk-rear" },
                        { command: "actuate_trunk-front" },
                        { command: "window_control-vent" },
                        { command: "window_control-close" },
                        { command: "sun_roof_control-vent" },
                        { command: "sun_roof_control-close" },
                        { command: "charge_port_door_open" },
                        { command: "charge_port_door_close" },
                        { command: "charge_start" },
                        { command: "charge_stop" },
                        { command: "charge_standard" },
                        { command: "charge_max_range" },
                        { command: "set_charge_limit", type: "number", role: "level" },
                        { command: "set_temps-driver_temp", type: "number", role: "level" },
                        { command: "set_temps-passenger_temp", type: "number", role: "level" },
                        { command: "set_bioweapon_mode" },
                        { command: "set_scheduled_charging", name: "Number of minutes from midnight in intervals of 15", type: "json", role: "state" },
                        { command: "set_scheduled_departure", name: "Change default json to modify", type: "json", role: "state" },
                        { command: "set_charging_amps-charging_amps", type: "number", role: "level" },
                        { command: "remote_seat_heater_request-0", type: "number", role: "level" },
                        { command: "remote_seat_heater_request-1", type: "number", role: "level" },
                        { command: "remote_seat_heater_request-2", type: "number", role: "level" },
                        { command: "remote_seat_heater_request-3", type: "number", role: "level" },
                        { command: "remote_seat_heater_request-4", type: "number", role: "level" },
                        { command: "remote_seat_heater_request-5", type: "number", role: "level" },
                        { command: "schedule_software_update-offset_sec", type: "number", role: "level" },
                        { command: "auto_conditioning_start" },
                        { command: "auto_conditioning_stop" },
                        { command: "media_toggle_playback" },
                        { command: "media_next_track" },
                        { command: "media_prev_track" },
                        { command: "media_volume_up" },
                        { command: "media_volume_down" },
                        { command: "set_preconditioning_max" },
                        { command: "share", type: "string", role: "text" },
                        { command: "remote_steering_wheel_heater_request" },
                    ];
                    if (!device.vehicle_id) {
                        remoteArray = [
                            { command: "backup-backup_reserve_percent", type: "number", role: "level" },
                            { command: "operation-self_consumption" },
                            { command: "operation-backup" },
                            { command: "off_grid_vehicle_charging_reserve-off_grid_vehicle_charging_reserve_percent", type: "number", role: "level" },
                        ];
                    }
                    remoteArray.forEach(async (remote) => {
                        await this.setObjectNotExistsAsync(id + ".remote." + remote.command, {
                            type: "state",
                            common: {
                                name: remote.name || "",
                                type: remote.type || "boolean",
                                role: remote.role || "button",
                                write: true,
                                read: true,
                            },
                            native: {},
                        });
                        if (remote.command === "set_scheduled_departure") {
                            this.setState(
                                id + ".remote." + remote.command,
                                `{
                                "departure_time": 375,
                                "preconditioning_weekdays_only": false,
                                "enable": true,
                                "off_peak_charging_enabled": true,
                                "preconditioning_enabled": false,
                                "end_off_peak_time": 420,
                                "off_peak_charging_weekdays_only": true
                            }`,
                                true
                            );
                        }
                        if (remote.command === "set_scheduled_charging") {
                            this.setState(
                                id + ".remote." + remote.command,
                                `{
                                    "time": 0,
                                    "enable": true
                                }`,
                                true
                            );
                        }
                    });
                    this.delObjectAsync(this.name + "." + this.instance + "." + id + ".remote.set_scheduled_charging-scheduled_charging");
                    this.delObjectAsync(this.name + "." + this.instance + "." + id + ".remote.set_scheduled_departure-scheduled_departure");
                }
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }
    async updateDevices(forceUpdate) {
        const vehicleStatusArray = [
            { path: "", url: "https://owner-api.teslamotors.com/api/1/vehicles/{id}/vehicle_data" },
            { path: ".charge_history", url: "https://owner-api.teslamotors.com/api/1/vehicles/{id}/charge_history" },
        ];
        const powerwallArray = [
            { path: "", url: "https://owner-api.teslamotors.com/api/1/powerwalls/{id}/status" },
            // { path: ".powerhistory", url: "https://owner-api.teslamotors.com/api/1/powerwalls/{id}/powerhistory" },
            // { path: ".energyhistory", url: "https://owner-api.teslamotors.com/api/1/powerwalls/{id}/energyhistory" },
            { path: "", url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/site_status" },
            { path: "", url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/site_info" },
            { path: ".live_status", url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/live_status" },
            { path: ".backup_history", url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/history?kind=backup" },
            {
                path: ".energy_history",
                url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/calendar_history?kind=energy&period=day&time_zone=Europe%2FBerlin&end_date=" + this.getDate(),
            },
            {
                path: ".self_consumption_history",
                url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/calendar_history?kind=self_consumption&period=day&time_zone=Europe%2FBerlin&end_date=" + this.getDate(),
            },
            {
                path: ".self_consumption_history_lifetime",
                url:
                    "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/calendar_history?kind=self_consumption&start_date=2016-01-01T00%3A00%3A00%2B01%3A00&period=lifetime&time_zone=Europe%2FBerlin&end_date=" +
                    this.getDate(),
            },
            {
                path: ".energy_history_lifetime",
                url:
                    "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/calendar_history?kind=energy&start_date=2016-01-01T00%3A00%3A00%2B01%3A00&time_zone=Europe/Berlin&period=lifetime&end_date=" +
                    this.getDate(),
            },
            // { path: ".historyEnergy", url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/history?kind=energy&period=day" },
            // { path: ".historyPower", url: "https://owner-api.teslamotors.com/api/1/energy_sites/{energy_site_id}/history?kind=power&period=day" },
        ];

        const headers = {
            "Content-Type": "application/json; charset=utf-8",
            Accept: "*/*",
            "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "x-tesla-user-agent": "TeslaApp/3.10.14-474/540f6f430/ios/12.5.1",
            Authorization: "Bearer " + this.ownSession.access_token,
        };

        this.idArray.forEach(async (product) => {
            //check state
            const id = product.id;
            let currentArray;
            const energy_site_id = product.energy_site_id;
            if (product.type === "vehicle") {
                let state = await this.checkState(id);
                this.log.debug(id + ": " + state);
                if (state === "asleep" && !this.config.wakeup) {
                    this.log.debug(id + " asleep skip update");
                    this.lastStates[id] = state;
                    return;
                }
                let waitForSleep = false;
                if (this.lastStates[id] && this.lastStates[id] !== "asleep" && forceUpdate !== true) {
                    waitForSleep = await this.checkWaitForSleepState(id);
                } else {
                    if (forceUpdate) {
                        this.log.debug("Skip wait because force update");
                    } else {
                        this.log.debug("Skip wait because last state was asleep");
                    }
                }
                this.lastStates[id] = state;

                if (waitForSleep && !this.config.wakeup) {
                    if (!this.sleepTimes[id]) {
                        this.sleepTimes[id] = Date.now();
                        if (this.ws) {
                            this.ws.close();
                        }
                    }
                    //wait 15min
                    if (Date.now() - this.sleepTimes[id] >= 900000) {
                        this.log.debug(id + " wait for sleep was not successful");
                        this.sleepTimes[id] = null;
                    } else {
                        this.log.debug(id + " skip update. Waiting for sleep");
                        return;
                    }
                }

                if (this.config.wakeup && state !== "online") {
                    while (state !== "online") {
                        let errorButNotTimeout = false;

                        const vehicleState = await this.sendCommand(id, "wake_up").catch((error) => {
                            //timeout and reset connection
                            if (error.response && error.response.status !== 408 && error.response.status !== 503) {
                                errorButNotTimeout = true;
                            }
                        });
                        if (errorButNotTimeout || !vehicleState) {
                            break;
                        }
                        state = vehicleState.state;
                        await this.sleep(10000);
                    }
                }
                currentArray = vehicleStatusArray;

                if (this.config.streaming) {
                    this.connectToWS(product.vehicle_id, product.id);
                }
            } else {
                currentArray = powerwallArray;
            }
            currentArray.forEach(async (element) => {
                let url = element.url.replace("{id}", id);
                url = url.replace("{energy_site_id}", energy_site_id);
                this.log.debug(url);

                if (element.path === ".charge_history") {
                    const diff = 60 * 60 * 1000;
                    if (!this.lastChargeHistory || Date.now() - this.lastChargeHistory > diff) {
                        this.lastChargeHistory = Date.now();
                    } else {
                        this.log.debug("Skip charge history because last update was less than 1h ago");
                        return;
                    }
                }
                await this.requestClient({
                    method: "get",
                    url: url,
                    headers: headers,
                })
                    .then((res) => {
                        this.log.debug(JSON.stringify(res.data));

                        if (!res.data) {
                            return;
                        }
                        const data = res.data.response;
                        let preferedArrayName = "timestamp";
                        if (element.path === ".charge_history") {
                            preferedArrayName = "title";
                            if (data && data.charging_history_graph) {
                                delete data.charging_history_graph.y_labels;
                                delete data.charging_history_graph.x_labels;
                            }
                        }
                        this.json2iob.parse(this.id2vin[id] + element.path, data, { preferedArrayName: preferedArrayName });
                        if (data.drive_state) {
                            if (data.drive_state.shift_state && this.config.intervalDrive > 0) {
                                if (!this.updateIntervalDrive[id]) {
                                    this.updateIntervalDrive[id] = setInterval(async () => {
                                        this.updateDrive(id);
                                    }, this.config.intervalDrive * 1000);
                                }
                            } else {
                                if (this.updateIntervalDrive[id]) {
                                    clearInterval(this.updateIntervalDrive[id]);
                                    this.updateIntervalDrive[id] = null;
                                }
                            }
                        }
                    })
                    .catch((error) => {
                        if (error.response && error.response.status === 401) {
                            error.response && this.log.error(JSON.stringify(error.response.data));
                            this.log.info(element.path + " receive 401 error. Refresh Token in 30 seconds");
                            if (this.refreshTokenTimeout) {
                                return;
                            }
                            this.refreshTokenTimeout = setTimeout(() => {
                                this.refreshTokenTimeout = null;
                                this.ownSession = null;
                                this.log.info("Start refresh token");
                                this.refreshToken();
                            }, 1000 * 30);

                            return;
                        }

                        if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
                            this.log.debug(url);
                            this.log.debug(error);
                            error.response && this.log.debug(JSON.stringify(error.response.data));
                            return;
                        }
                        this.log.error("General error");
                        this.log.error(url);
                        this.log.error(error);
                        error.response && this.log.error(JSON.stringify(error.response.data));
                    });
            });
        });
    }
    async updateDrive(id) {
        const headers = {
            "Content-Type": "application/json; charset=utf-8",
            Accept: "*/*",
            "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "x-tesla-user-agent": "TeslaApp/3.10.14-474/540f6f430/ios/12.5.1",
            Authorization: "Bearer " + this.ownSession.access_token,
        };
        await this.requestClient({
            method: "get",
            url: "https://owner-api.teslamotors.com/api/1/vehicles/" + id + "/vehicle_data?endpoints=drive_state",
            headers: headers,
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));

                if (!res.data) {
                    return;
                }
                const data = res.data.response;

                this.json2iob.parse(this.id2vin[id], data);
            })
            .catch((error) => {
                if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
                    this.log.debug(error);
                    error.response && this.log.debug(JSON.stringify(error.response.data));
                    return;
                }

                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }
    async checkState(id) {
        const headers = {
            "Content-Type": "application/json; charset=utf-8",
            Accept: "*/*",
            "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "x-tesla-user-agent": "TeslaApp/3.10.14-474/540f6f430/ios/12.5.1",
            Authorization: "Bearer " + this.ownSession.access_token,
        };
        return await this.requestClient({
            method: "get",
            url: "https://owner-api.teslamotors.com/api/1/vehicles/" + id,
            headers: headers,
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                this.json2iob.parse(this.id2vin[id], res.data.response, { preferedArrayName: "timestamp" });
                return res.data.response.state;
            })
            .catch((error) => {
                if (error.response && error.response.status === 404) {
                    return;
                }
                if (error.response && (error.response.status >= 500 || error.response.status === 408)) {
                    this.log.debug(error);
                    error.response && this.log.debug(JSON.stringify(error.response.data));
                    return;
                }
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
                return;
            });
    }

    async refreshToken(firstStart) {
        await this.requestClient({
            method: "post",
            url: "https://auth.tesla.com/oauth2/v3/token",
            headers: this.headers,
            data: "grant_type=refresh_token&client_id=ownerapi&scope=openid email offline_access&refresh_token=" + this.session.refresh_token,
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));
                this.session.access_token = res.data.access_token;
                this.session.expires_in = res.data.expires_in;

                await this.getOwnerToken();
                this.setState("info.connection", true, true);
                return res.data;
            })
            .catch(async (error) => {
                this.setState("info.connection", false, true);
                this.log.error("refresh token failed");
                this.log.error(error);
                if (error.code === "ENOTFOUND") {
                    this.log.error("No connection to Tesla server please check your connection");
                    return;
                }
                //received a real http error
                if (error.response && error.response.status >= 400 && error.response.status < 500) {
                    this.session = {};
                    error.response && this.log.error(JSON.stringify(error.response.data));
                    this.log.error("Start relogin in 1min");
                    this.reLoginTimeout = setTimeout(() => {
                        this.login();
                    }, 1000 * 60 * 1);
                } else if (firstStart) {
                    //connection problems
                    this.log.error("No connection to tesla server restart adapter in 1min");
                    this.reLoginTimeout = setTimeout(() => {
                        this.restart();
                    }, 1000 * 60 * 1);
                }
            });
    }
    async getOwnerToken() {
        if (this.ownSession && this.ownSession.expires_in && this.ownSession.created_at) {
            const endTimeStamp = this.ownSession.expires_in * 0.75 + this.ownSession.created_at;
            if (Date.now() / 1000 <= endTimeStamp) {
                this.log.debug("Skip OwnerToken request");
                return;
            }
        }
        this.log.info("Start own Token Refresh");
        if (this.ownSession && this.ownSession.expires_in) {
            this.log.info("Expires: " + this.ownSession.expires_in + " Created_at: " + this.ownSession.created_at);
        }

        await this.requestClient({
            method: "post",
            url: "https://owner-api.teslamotors.com/oauth/token",
            headers: {
                "content-type": "application/json; charset=utf-8",
                accept: "*/*",
                authorization: "bearer " + this.session.access_token,
                "accept-language": "de-de",
                "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                "x-tesla-user-agent": "TeslaApp/3.10.14-474/540f6f430/ios/12.5.1",
            },
            data: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", client_id: "81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384" },
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));
                this.ownSession = res.data;

                return res.data;
            })
            .catch(async (error) => {
                this.setState("info.connection", false, true);
                this.log.error("own token failed");
                this.log.error(error);
                if (error.response && error.response.status === 408) {
                    this.log.warn("Tesla server not reachable. Retry in 30sec.");
                    this.reLoginTimeout = setTimeout(() => {
                        this.getOwnerToken();
                    }, 1000 * 30);
                    return;
                }
                if (error.response && error.response.status >= 400 && error.response.status < 500) {
                    this.session = {};
                    error.response && this.log.error(JSON.stringify(error.response.data));
                    this.log.error("Start relogin in 1min");
                    this.reLoginTimeout = setTimeout(() => {
                        this.login();
                    }, 1000 * 60 * 1);
                } else {
                    this.log.error("No connection to tesla server restart adapter in 1min");
                    this.reLoginTimeout = setTimeout(() => {
                        this.restart();
                    }, 1000 * 60 * 1);
                }
            });
    }
    async checkWaitForSleepState(id) {
        const shift_state = await this.getStateAsync("driveState.shift_state");
        const chargeState = await this.getStateAsync("chargeState.charging_state");

        if ((shift_state && shift_state.val !== null && shift_state.val !== "P") || (chargeState && !["Disconnected", "Complete", "NoPower", "Stopped"].includes(chargeState.val))) {
            if (shift_state && chargeState) {
                this.log.debug("Skip sleep waiting because shift state: " + shift_state.val + " or charge state: " + chargeState.val);
            }
            return false;
        }
        const checkStates = [
            ".drive_state.shift_state",
            ".drive_state.speed",
            ".climate_state.is_climate_on",
            ".charge_state.battery_level",
            ".vehicle_state.odometer",
            ".vehicle_state.locked",
            ".charge_state.charge_port_door_open",
            ".vehicle_state.df",
        ];
        for (const stateId of checkStates) {
            const curState = await this.getStateAsync(id + stateId);
            //laste update not older than 30min and last change not older then 30min
            if (curState && (curState.ts <= Date.now() - 1800000 || curState.ts - curState.lc <= 1800000)) {
                return false;
            }
        }
        this.log.debug("Since 30 min no changes receiving. Start waiting for sleep");
        return true;
    }
    async sendCommand(id, command, action, value, nonVehicle) {
        const headers = {
            "Content-Type": "application/json; charset=utf-8",
            Accept: "*/*",
            "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "x-tesla-user-agent": "TeslaApp/3.10.14-474/540f6f430/ios/12.5.1",
            Authorization: "Bearer " + this.ownSession.access_token,
        };
        let url = "https://owner-api.teslamotors.com/api/1/vehicles/" + id + "/command/" + command;

        if (command === "wake_up") {
            url = "https://owner-api.teslamotors.com/api/1/vehicles/" + id + "/wake_up";
        }
        if (nonVehicle) {
            url = "https://owner-api.teslamotors.com/api/1/energy_sites/" + id + "/" + command;
        }
        const passwordArray = ["remote_start_drive"];
        const latlonArray = ["trigger_homelink", "window_control"];
        const onArray = ["remote_steering_wheel_heater_request", "set_preconditioning_max", "set_sentry_mode", "set_bioweapon_mode"];
        const valueArray = ["set_temps", "backup", "off_grid_vehicle_charging_reserve", "schedule_software_update", "set_charging_amps"];
        const stateArray = ["sun_roof_control"];
        const commandArray = ["window_control"];
        const percentArray = ["set_charge_limit"];
        const default_real_modeArray = ["operation"];
        const heaterArray = ["remote_seat_heater_request"];
        const shareArray = ["share"];
        const trunkArray = ["actuate_trunk"];
        const plainArray = ["set_scheduled_charging", "set_scheduled_departure"];
        let data = {};
        if (passwordArray.includes(command)) {
            data["password"] = this.config.password;
        }
        if (latlonArray.includes(command)) {
            const latState = await this.getStateAsync(id + ".drive_state.latitude");
            const lonState = await this.getStateAsync(id + ".drive_state.longitude");
            data["lat"] = latState ? latState.val : 0;
            data["lon"] = lonState ? lonState.val : 0;
        }
        if (onArray.includes(command)) {
            data["on"] = value;
        }
        if (valueArray.includes(command)) {
            if (command === "set_temps") {
                const driverState = await this.getStateAsync(id + ".climate_state.driver_temp_setting");
                const passengerState = await this.getStateAsync(id + ".climate_state.passenger_temp_setting");
                data["driver_temp"] = driverState ? driverState.val : 23;
                data["passenger_temp"] = passengerState ? passengerState.val : driverState.val;
            }
            data[action] = value;
        }
        if (heaterArray.includes(command)) {
            data["heater"] = action;
            data["level"] = value;
        }
        if (stateArray.includes(command)) {
            data["state"] = action;
        }
        if (commandArray.includes(command)) {
            data["command"] = action;
        }
        if (percentArray.includes(command)) {
            data["percent"] = value;
        }
        if (default_real_modeArray.includes(command)) {
            data["default_real_mode"] = action;
        }
        if (trunkArray.includes(command)) {
            data["which_trunk"] = action;
        }
        if (shareArray.includes(command)) {
            data = {
                type: "share_ext_content_raw",
                value: {
                    "android.intent.ACTION": "android.intent.action.SEND",
                    "android.intent.TYPE": "text/plain",
                    "android.intent.extra.SUBJECT": "Ortsname",
                    "android.intent.extra.TEXT": value,
                },
                locale: "de-DE",
                timestamp_ms: (Date.now() / 1000).toFixed(0),
            };
        }

        if (plainArray.includes(command)) {
            try {
                data = JSON.parse(value);
            } catch (error) {
                this.log.error(error);
            }
        }
        this.log.debug(url);
        this.log.debug(JSON.stringify(data));
        return await this.requestClient({
            method: "post",
            url: url,
            headers: headers,
            data: data,
        })
            .then((res) => {
                this.log.info(JSON.stringify(res.data));
                return res.data.response;
            })
            .catch((error) => {
                if (error.response && error.response.status === 401) {
                    error.response && this.log.debug(JSON.stringify(error.response.data));
                    this.log.info(command + " receive 401 error. Refresh Token in 30 seconds");
                    if (this.refreshTokenTimeout) {
                        return;
                    }
                    this.refreshTokenTimeout = setTimeout(() => {
                        this.refreshTokenTimeout = null;
                        this.ownSession = null;
                        this.log.info("Start refresh token");
                        this.refreshToken();
                    }, 1000 * 30);

                    return;
                }

                this.log.error(url);
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
                throw error;
            });
    }

    async connectToWS(vehicleId, id) {
        if (this.ws) {
            this.ws.close();
        }
        this.ws = new WebSocket("wss://streaming.vn.teslamotors.com/streaming/", {
            perMessageDeflate: false,
        });
        this.wsAuthMessage = {
            msg_type: "data:subscribe_oauth",
            token: this.ownSession.access_token,
            value: "speed,odometer,soc,elevation,est_heading,est_lat,est_lng,power,shift_state,range,est_range,heading",
            tag: vehicleId.toString(),
        };
        this.ws.on("open", () => {
            this.log.debug("WS open");
            this.ws.send(JSON.stringify(this.wsAuthMessage));
        });

        this.ws.on("message", (message) => {
            this.log.debug("WS received:" + message);
            try {
                const jsonMessage = JSON.parse(message);
                if (jsonMessage.msg_type === "data:error" && !this.sleepTimes[id]) {
                    this.ws.send(JSON.stringify(this.wsAuthMessage));
                }
                if (jsonMessage.msg_type === "data:update") {
                    const array = jsonMessage.value.split(",");

                    const streamdata = {
                        timestamp: array[0],
                        speed: array[1],
                        odometer: array[2],
                        soc: array[3],
                        elevation: array[4],
                        est_heading: array[5],
                        est_lat: array[6],
                        est_lng: array[7],
                        power: array[8],
                        shift_state: array[9],
                        range: array[10],
                        est_range: array[11],
                        heading: array[12],
                    };
                    this.json2iob.parse(this.id2vin[id] + ".streamData", streamdata);
                }
            } catch (error) {
                this.log.error(error);
            }
        });

        this.ws.on("error", (err) => {
            this.log.error("websocket error: " + err);
        });
    }
    getCodeChallenge() {
        let hash = "";
        let result = "";
        const chars = "0123456789abcdef";
        result = "";
        for (let i = 64; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
        hash = crypto.createHash("sha256").update(result).digest("base64");
        hash = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

        return [result, hash];
    }
    randomString(length) {
        let result = "";
        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
    extractHidden(body) {
        const returnObject = {};
        let matches;
        if (body.matchAll) {
            matches = body.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g);
        } else {
            this.log.warn("The adapter needs in the future NodeJS v12. https://forum.iobroker.net/topic/22867/how-to-node-js-f%C3%BCr-iobroker-richtig-updaten");
            matches = this.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g, body);
        }
        for (const match of matches) {
            returnObject[match[1]] = match[2];
        }
        return returnObject;
    }
    matchAll(re, str) {
        let match;
        const matches = [];

        while ((match = re.exec(str))) {
            // add all matched groups
            matches.push(match);
        }

        return matches;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    getDate() {
        return new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString();
    }
    async cleanOldObjects() {
        const driveState = await this.getObjectAsync("driveState");
        if (driveState) {
            await this.delObject("chargeState", { recursive: true });
            await this.delObject("climateState", { recursive: true });
            await this.delObject("driveState", { recursive: true });
            await this.delObject("vehicle", { recursive: true });
            await this.delObject("softwareUpdate", { recursive: true });
            await this.delObject("command", { recursive: true });
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            this.setState("info.connection", false, true);

            if (this.ws) {
                this.ws.close();
            }
            Object.keys(this.updateIntervalDrive).forEach((element) => {
                clearInterval(this.updateIntervalDrive[element]);
            });
            clearInterval(this.updateInterval);
            clearTimeout(this.refreshTimeout);
            clearTimeout(this.refreshTokenTimeout);
            const obj = await this.getForeignObjectAsync(this.adapterConfig);
            this.log.info("Save login session");
            if (obj) {
                obj.native.session = this.session;
                this.log.debug("Session saved");
                await this.setForeignObjectAsync(this.adapterConfig, obj);
            }
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */

    async onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
                if (id.indexOf(".remote.") === -1) {
                    this.log.warn("No remote command");
                    return;
                }
                let productId = this.vin2id[id.split(".")[2]];

                let command = id.split(".")[4];
                const action = command.split("-")[1];
                command = command.split("-")[0];
                if (command === "force_update") {
                    this.updateDevices(true);
                    return;
                }
                let vehicleState = await this.checkState(productId);
                let nonVehicle = false;
                if (vehicleState) {
                    if (vehicleState !== "online") {
                        this.log.info("Wake up " + id);
                        while (vehicleState !== "online") {
                            let errorButNotTimeout = false;
                            const vehicleStateData = await this.sendCommand(productId, "wake_up").catch((error) => {
                                if (error.response && error.response.status !== 408 && error.response.status !== 503) {
                                    errorButNotTimeout = true;
                                }
                            });
                            if (errorButNotTimeout) {
                                break;
                            }
                            vehicleState = vehicleStateData.state;
                            await this.sleep(5000);
                        }
                    }
                } else {
                    const productIdState = await this.getStateAsync(productId + ".energy_site_id");
                    if (productIdState) {
                        productId = productIdState.val;
                        nonVehicle = true;
                    }
                }
                await this.sendCommand(productId, command, action, state.val, nonVehicle).catch(() => {});
                clearTimeout(this.refreshTimeout);
                this.refreshTimeout = setTimeout(async () => {
                    await this.updateDevices(true);
                }, 5 * 1000);
            } else {
                if (id.indexOf(".remote.") !== -1) {
                    return;
                }
                const resultDict = {
                    driver_temp_setting: "set_temps-driver_temp",
                    charge_limit_soc: "set_charge_limit",
                    locked: "door_lock",
                    is_auto_conditioning_on: "auto_conditioning_start",
                    charge_port_door_open: "charge_port_door_open",
                    passenger_temp_setting: "set_temps-passenger_temp",
                    backup_reserve_percent: "backup-backup_reserve_percent",
                    off_grid_vehicle_charging_reserve_percent: "off_grid_vehicle_charging_reserve-off_grid_vehicle_charging_reserve_percent",
                };
                const idArray = id.split(".");
                const stateName = idArray[idArray.length - 1];
                const vin = id.split(".")[2];
                let value = true;
                if (resultDict[stateName] && isNaN(state.val)) {
                    if (!state.val || state.val === "INVALID" || state.val === "NOT_CHARGING" || state.val === "ERROR" || state.val === "UNLOCKED") {
                        value = false;
                    }
                } else {
                    value = state.val;
                }
                if (resultDict[stateName]) {
                    this.log.debug("refresh remote state" + resultDict[stateName] + " from " + id);
                    await this.setStateAsync(vin + ".remote." + resultDict[stateName], value, true);
                }
            }
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Teslamotors(options);
} else {
    // otherwise start the instance directly
    new Teslamotors();
}
