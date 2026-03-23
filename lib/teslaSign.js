'use strict';

const protobuf = require('protobufjs');
const elliptic = require('elliptic');
const crypto = require('crypto');
const path = require('path');

const EPOCH_LENGTH = (1 << 30);
const PROTO_DIR = path.join(__dirname, 'proto');

// ─── Protobuf Loading ──────────────────────────────────────────────────────

let protoLoaded = false;
let Domain, msgProto, sessionInfoProto, carServerResponseProto, actionProto, ActionResult;
let Tags, SignatureTypes;
let vcsecUnsignedMsgProto, vcsecFromMsgProto;

async function loadProtos() {
  if (protoLoaded) return;

  const root = new protobuf.Root();
  root.resolvePath = (origin, target) => {
    // If target is already absolute, return as-is
    if (path.isAbsolute(target)) return target;
    // Resolve relative imports (like 'signatures.proto' imported from 'universal_message.proto')
    return path.join(PROTO_DIR, target);
  };

  await root.load([
    path.join(PROTO_DIR, 'signatures.proto'),
    path.join(PROTO_DIR, 'universal_message.proto'),
    path.join(PROTO_DIR, 'car_server.proto'),
    path.join(PROTO_DIR, 'vcsec.proto'),
  ]);

  Domain = root.lookupEnum('UniversalMessage.Domain').values;
  msgProto = root.lookupType('UniversalMessage.RoutableMessage');
  sessionInfoProto = root.lookupType('Signatures.SessionInfo');
  carServerResponseProto = root.lookupType('CarServer.Response');
  actionProto = root.lookupType('CarServer.Action');
  ActionResult = root.lookupEnum('CarServer.OperationStatus_E').values;
  Tags = root.lookupEnum('Signatures.Tag').values;
  SignatureTypes = root.lookupEnum('Signatures.SignatureType').values;
  vcsecUnsignedMsgProto = root.lookupType('VCSEC.UnsignedMessage');
  vcsecFromMsgProto = root.lookupType('VCSEC.FromVCSECMessage');

  protoLoaded = true;
}

// ─── Metadata (TLV hash builder) ───────────────────────────────────────────

class Metadata {
  constructor(hmacContext) {
    this.context = hmacContext;
    this.last = 0;
  }

  add(tag, value) {
    if (tag < this.last) throw new Error('metadata tags must be in increasing order');
    if (value === null || value === undefined) return;
    if (value.length > 255) throw new Error('metadata field > 255 bytes');
    this.last = tag;
    this.context.update(Buffer.from([tag]));
    this.context.update(Buffer.from([value.length]));
    this.context.update(value);
  }

  addUint32(tag, value) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    this.add(tag, buf);
  }

  checksum(message) {
    this.context.update(Buffer.from([Tags.TAG_END]));
    this.context.update(message);
    return this.context.digest();
  }
}

// ─── AuthSession (ECDH shared secret) ──────────────────────────────────────

class AuthSession {
  constructor(privateKeyBuf, serverPublicKeyBuf) {
    const ec = new elliptic.ec('p256');
    const privKey = ec.keyFromPrivate(privateKeyBuf);
    const pubKey = ec.keyFromPublic(serverPublicKeyBuf);
    const sharedSecret = privKey.derive(pubKey.getPublic());

    // SHA-1 of shared x-coordinate, take first 16 bytes as AES-128 key
    const hash = crypto.createHash('sha1');
    hash.update(Buffer.from(sharedSecret.toString(16).padStart(64, '0'), 'hex'));
    this.key = hash.digest().subarray(0, 16);
  }

  newHMAC(label) {
    const kdf = crypto.createHmac('sha256', this.key);
    kdf.update(Buffer.from(label, 'utf8'));
    return crypto.createHmac('sha256', kdf.digest());
  }
}

// ─── Signer (session state + HMAC signing) ─────────────────────────────────

class Signer {
  constructor(privateKeyBuf, publicKeyBuf, vin, sessionInfo) {
    this.session = new AuthSession(privateKeyBuf, sessionInfo.publicKey);
    this.localPublicKey = publicKeyBuf;
    this.vin = vin;
    this.timeZero = Math.floor(Date.now() / 1000) - sessionInfo.clockTime;
    this.epoch = Buffer.from(sessionInfo.epoch);
    this.counter = sessionInfo.counter;
  }

  validateSessionInfo(encodedSessionInfo, challenge, tag) {
    const meta = new Metadata(this.session.newHMAC('session info'));
    meta.add(Tags.TAG_SIGNATURE_TYPE, Buffer.from([SignatureTypes.SIGNATURE_TYPE_HMAC]));
    meta.add(Tags.TAG_PERSONALIZATION, Buffer.from(this.vin));
    meta.add(Tags.TAG_CHALLENGE, challenge);
    const validTag = meta.checksum(encodedSessionInfo);
    return crypto.timingSafeEqual(validTag, tag);
  }

  generateSignature(encodedPayload, domain, expiresIn) {
    this.counter++;
    const meta = new Metadata(this.session.newHMAC('authenticated command'));
    meta.add(Tags.TAG_SIGNATURE_TYPE, Buffer.from([SignatureTypes.SIGNATURE_TYPE_HMAC_PERSONALIZED]));
    meta.add(Tags.TAG_DOMAIN, Buffer.from([domain]));
    meta.add(Tags.TAG_PERSONALIZATION, Buffer.from(this.vin));

    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn - this.timeZero;
    if (expiresAt > EPOCH_LENGTH || expiresAt < 0) throw new Error('out of bounds expiration');

    meta.add(Tags.TAG_EPOCH, this.epoch);
    meta.addUint32(Tags.TAG_EXPIRES_AT, expiresAt);
    meta.addUint32(Tags.TAG_COUNTER, this.counter);

    return {
      signerIdentity: { publicKey: this.localPublicKey },
      HMAC_Personalized_data: {
        epoch: this.epoch,
        counter: this.counter,
        expiresAt: expiresAt,
        tag: meta.checksum(encodedPayload),
      },
    };
  }
}

// ─── TeslaCommandSigner (main class for adapter integration) ───────────────

class TeslaCommandSigner {
  /**
     * @param {object} options
     * @param {string} options.vin - Vehicle Identification Number
     * @param {Buffer} options.privateKey - EC P-256 private key (raw 32 bytes)
     * @param {Buffer} options.publicKey - EC P-256 public key (uncompressed 65 bytes)
     * @param {function} options.sendSignedCommand - async (vin, buffer) => Buffer
     * @param {object} [options.log] - logger with .debug(), .info(), .warn(), .error()
     */
  constructor(options) {
    this.vin = options.vin;
    this.privateKey = options.privateKey;
    this.publicKey = options.publicKey;
    this.sendSignedCommand = options.sendSignedCommand;
    this.log = options.log || console;
    this.signers = {}; // per-domain signers
  }

  // ── Low-level message transport ────────────────────────────────────

  async _sendRequest(req, domain) {
    const message = msgProto.create(req);
    const buffer = Buffer.from(msgProto.encode(message).finish());
    this.log.debug(`[TeslaSigning] Sending ${buffer.length}B to domain ${domain} for ${this.vin}`);
    const bufResp = await this.sendSignedCommand(this.vin, buffer);
    this.log.debug(`[TeslaSigning] Received ${bufResp.length}B response`);
    const res = msgProto.decode(bufResp);

    // Validate source/destination
    if (!res.fromDestination || res.fromDestination.domain !== req.toDestination.domain) {
      throw new Error('Invalid source domain in response');
    }
    if (!res.toDestination || !res.toDestination.routingAddress ||
            Buffer.compare(res.toDestination.routingAddress, req.fromDestination.routingAddress) !== 0) {
      throw new Error('Invalid destination address in response');
    }

    // Check for message-level errors
    if (res.signedMessageStatus && res.signedMessageStatus.signedMessageFault) {
      const fault = res.signedMessageStatus.signedMessageFault;
      this.log.debug(`[TeslaSigning] Message status: operationStatus=${res.signedMessageStatus.operationStatus}, fault=${fault}`);
      if (fault !== 0) { // 0 = MESSAGEFAULT_ERROR_NONE
        // If session-related error, invalidate session so next call re-handshakes
        const sessionErrors = [5, 6, 15, 17]; // INVALID_SIGNATURE, INVALID_TOKEN_OR_COUNTER, INCORRECT_EPOCH, TIME_EXPIRED
        if (sessionErrors.includes(fault)) {
          this.log.warn(`Session error (fault ${fault}) for domain ${domain}, will re-handshake`);
          this.signers[domain] = null;
        }
        throw new Error(`Vehicle message fault: ${fault}`);
      }
    }

    // Session info response (handshake)
    if (res.sessionInfo && res.signatureData) {
      this.log.debug(`[TeslaSigning] Received session info response for domain ${domain}`);
      if (!res.signatureData.sessionInfoTag || !res.signatureData.sessionInfoTag.tag) {
        throw new Error('Missing sessionInfo HMAC tag');
      }
      const sessionInfo = sessionInfoProto.decode(res.sessionInfo);

      if (sessionInfo.status === 1) { // SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST
        throw new Error('Key not on vehicle whitelist - Virtual Key not installed');
      }

      const signer = new Signer(this.privateKey, this.publicKey, this.vin, sessionInfo);
      if (!signer.validateSessionInfo(res.sessionInfo, res.requestUuid, res.signatureData.sessionInfoTag.tag)) {
        this.log.warn(`[TeslaSigning] Session info HMAC validation failed for domain ${domain}`);
        throw new Error('Session info HMAC validation failed');
      }
      this.signers[domain] = signer;
      this.log.debug(`[TeslaSigning] Session established for domain ${domain}, counter=${sessionInfo.counter}, epoch=${Buffer.from(sessionInfo.epoch).toString('hex').substring(0, 8)}...`);
      return { type: 'session', sessionInfo };
    }

    // Payload response
    if (res.protobufMessageAsBytes) {
      this.log.debug(`[TeslaSigning] Payload response: ${res.protobufMessageAsBytes.length}B for domain ${domain}`);
      if (domain === Domain.DOMAIN_VEHICLE_SECURITY) {
        return { type: 'vcsec', data: vcsecFromMsgProto.decode(res.protobufMessageAsBytes) };
      }
      return { type: 'carserver', data: carServerResponseProto.decode(res.protobufMessageAsBytes) };
    }

    throw new Error('Invalid response - no session info and no payload');
  }

  // ── Session management ─────────────────────────────────────────────

  async startSession(domain) {
    this.log.debug(`Starting session for domain ${domain} on VIN ${this.vin}`);
    await this._sendRequest({
      toDestination: { domain },
      fromDestination: { routingAddress: crypto.randomBytes(16) },
      sessionInfoRequest: { publicKey: this.publicKey },
      uuid: crypto.randomBytes(16),
    }, domain);
    this.log.debug(`Session established for domain ${domain}`);
  }

  async ensureSession(domain) {
    if (!this.signers[domain]) {
      await this.startSession(domain);
    }
  }

  // ── CarServer action (Infotainment domain) ─────────────────────────

  async _executeCarServerAction(vehicleAction, retried) {
    const domain = Domain.DOMAIN_INFOTAINMENT;
    await this.ensureSession(domain);

    const signer = this.signers[domain];
    if (!signer) throw new Error('No session for infotainment domain');

    const actionKey = Object.keys(vehicleAction)[0] || 'unknown';
    this.log.debug(`[TeslaSigning] CarServer action: ${actionKey}, counter=${signer.counter + 1}, retried=${!!retried}`);

    const payload = actionProto.create({ vehicleAction });
    const encodedPayload = Buffer.from(actionProto.encode(payload).finish());
    const signature = signer.generateSignature(encodedPayload, domain, 10);

    let response;
    try {
      response = await this._sendRequest({
        toDestination: { domain },
        fromDestination: { routingAddress: crypto.randomBytes(16) },
        protobufMessageAsBytes: encodedPayload,
        signatureData: signature,
        uuid: crypto.randomBytes(16),
        flags: 0,
      }, domain);
    } catch (err) {
      // On session errors, retry once with new session
      if (!retried && err.message.startsWith('Vehicle message fault:')) {
        this.log.info(`Retrying command after session error: ${err.message}`);
        this.signers[domain] = null;
        return this._executeCarServerAction(vehicleAction, true);
      }
      throw err;
    }

    if (response.type !== 'carserver') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }

    const res = response.data;
    if (res.actionStatus && res.actionStatus.result !== undefined) {
      this.log.debug(`[TeslaSigning] CarServer result: ${res.actionStatus.result}${res.actionStatus.resultReason ? ' reason=' + JSON.stringify(res.actionStatus.resultReason) : ''}`);
      if (res.actionStatus.result === ActionResult.OPERATIONSTATUS_OK) {
        return res;
      }
      if (res.actionStatus.result === ActionResult.OPERATIONSTATUS_ERROR) {
        const reason = res.actionStatus.resultReason && res.actionStatus.resultReason.plainText
          ? res.actionStatus.resultReason.plainText
          : 'Unknown error';
        throw new Error(`Vehicle command error: ${reason}`);
      }
    }
    return res;
  }

  // ── VCSEC action (Vehicle Security domain) ─────────────────────────

  async _executeVCSECAction(unsignedMessage, retried) {
    const domain = Domain.DOMAIN_VEHICLE_SECURITY;
    await this.ensureSession(domain);

    const signer = this.signers[domain];
    if (!signer) throw new Error('No session for vehicle security domain');

    const actionKey = Object.keys(unsignedMessage)[0] || 'unknown';
    this.log.debug(`[TeslaSigning] VCSEC action: ${actionKey}=${JSON.stringify(unsignedMessage[actionKey])}, counter=${signer.counter + 1}, retried=${!!retried}`);

    const msg = vcsecUnsignedMsgProto.create(unsignedMessage);
    const encodedPayload = Buffer.from(vcsecUnsignedMsgProto.encode(msg).finish());
    const signature = signer.generateSignature(encodedPayload, domain, 10);

    let response;
    try {
      response = await this._sendRequest({
        toDestination: { domain },
        fromDestination: { routingAddress: crypto.randomBytes(16) },
        protobufMessageAsBytes: encodedPayload,
        signatureData: signature,
        uuid: crypto.randomBytes(16),
        flags: 0,
      }, domain);
    } catch (err) {
      if (!retried && err.message.startsWith('Vehicle message fault:')) {
        this.log.info(`Retrying VCSEC command after session error: ${err.message}`);
        this.signers[domain] = null;
        return this._executeVCSECAction(unsignedMessage, true);
      }
      throw err;
    }

    if (response.type === 'vcsec') {
      const data = response.data;
      if (data.commandStatus) {
        this.log.debug(`[TeslaSigning] VCSEC result: operationStatus=${data.commandStatus.operationStatus}`);
        if (data.commandStatus.operationStatus === 0) return data; // OK
        if (data.commandStatus.operationStatus === 2) { // ERROR
          const info = data.commandStatus.signedMessageStatus
            ? `fault=${data.commandStatus.signedMessageStatus.signedMessageInformation}`
            : 'unknown';
          throw new Error(`VCSEC command error: ${info}`);
        }
      }
      return data;
    }
    return response.data;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Vehicle Security Commands (VCSEC Domain)
  // ═══════════════════════════════════════════════════════════════════

  async doorLock() {
    return this._executeVCSECAction({ RKEAction: 1 }); // RKE_ACTION_LOCK
  }

  async doorUnlock() {
    return this._executeVCSECAction({ RKEAction: 0 }); // RKE_ACTION_UNLOCK
  }

  async remoteStartDrive() {
    return this._executeVCSECAction({ RKEAction: 20 }); // RKE_ACTION_REMOTE_DRIVE
  }

  async autoSecureVehicle() {
    return this._executeVCSECAction({ RKEAction: 29 }); // RKE_ACTION_AUTO_SECURE_VEHICLE
  }

  async actuateTrunk(which) {
    const move = { rearTrunk: 0, frontTrunk: 0 };
    if (which === 'rear') move.rearTrunk = 1; // CLOSURE_MOVE_TYPE_MOVE
    else if (which === 'front') move.frontTrunk = 1;
    return this._executeVCSECAction({ closureMoveRequest: move });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Charging Commands (Infotainment Domain)
  // ═══════════════════════════════════════════════════════════════════

  async chargeStart() {
    return this._executeCarServerAction({ chargingStartStopAction: { start: {} } });
  }

  async chargeStop() {
    return this._executeCarServerAction({ chargingStartStopAction: { stop: {} } });
  }

  async chargeMaxRange() {
    return this._executeCarServerAction({ chargingStartStopAction: { startMaxRange: {} } });
  }

  async chargeStandard() {
    return this._executeCarServerAction({ chargingStartStopAction: { startStandard: {} } });
  }

  async setChargeLimit(percent) {
    return this._executeCarServerAction({ chargingSetLimitAction: { percent } });
  }

  async setChargingAmps(chargingAmps) {
    return this._executeCarServerAction({ setChargingAmpsAction: { chargingAmps } });
  }

  async chargePortDoorOpen() {
    return this._executeCarServerAction({ chargePortDoorOpen: {} });
  }

  async chargePortDoorClose() {
    return this._executeCarServerAction({ chargePortDoorClose: {} });
  }

  async scheduledCharging(enabled, chargingTime) {
    return this._executeCarServerAction({ scheduledChargingAction: { enabled, chargingTime } });
  }

  async scheduledDeparture(params) {
    return this._executeCarServerAction({ scheduledDepartureAction: params });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Climate / HVAC Commands
  // ═══════════════════════════════════════════════════════════════════

  async hvacAutoOn() {
    return this._executeCarServerAction({ hvacAutoAction: { powerOn: true, manualOverride: true } });
  }

  async hvacAutoOff() {
    return this._executeCarServerAction({ hvacAutoAction: { powerOn: false, manualOverride: true } });
  }

  async setTemps(driverTemp, passengerTemp) {
    return this._executeCarServerAction({
      hvacTemperatureAdjustmentAction: {
        driverTempCelsius: driverTemp,
        passengerTempCelsius: passengerTemp || driverTemp,
      },
    });
  }

  async setPreconditioningMax(on) {
    return this._executeCarServerAction({
      hvacSetPreconditioningMaxAction: { on, manualOverride: false },
    });
  }

  async steeringWheelHeater(on) {
    return this._executeCarServerAction({
      hvacSteeringWheelHeaterAction: { powerOn: on },
    });
  }

  async seatHeater(seatPosition, level) {
    // Map seat number (0-5) to proto field names
    const seatMap = {
      0: 'CAR_SEAT_FRONT_LEFT',
      1: 'CAR_SEAT_FRONT_RIGHT',
      2: 'CAR_SEAT_REAR_LEFT',
      3: 'CAR_SEAT_REAR_CENTER',
      4: 'CAR_SEAT_REAR_RIGHT',
      5: 'CAR_SEAT_REAR_LEFT_BACK',
    };
    const levelMap = {
      0: 'SEAT_HEATER_OFF',
      1: 'SEAT_HEATER_LOW',
      2: 'SEAT_HEATER_MED',
      3: 'SEAT_HEATER_HIGH',
    };
    const seatField = seatMap[seatPosition] || 'CAR_SEAT_FRONT_LEFT';
    const levelField = levelMap[level] || 'SEAT_HEATER_OFF';
    return this._executeCarServerAction({
      hvacSeatHeaterActions: {
        hvacSeatHeaterAction: [{ [levelField]: {}, [seatField]: {} }],
      },
    });
  }

  async bioweaponMode(on) {
    return this._executeCarServerAction({
      hvacBioweaponModeAction: { on, manualOverride: true },
    });
  }

  async climateKeeper(mode) {
    // 0=Off, 1=On, 2=Dog, 3=Camp
    return this._executeCarServerAction({
      hvacClimateKeeperAction: { ClimateKeeperAction: mode, manualOverride: true },
    });
  }

  async setCabinOverheatProtection(on, fanOnly) {
    return this._executeCarServerAction({
      setCabinOverheatProtectionAction: { on, fanOnly: !!fanOnly },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Vehicle Control Commands
  // ═══════════════════════════════════════════════════════════════════

  async flashLights() {
    return this._executeCarServerAction({ vehicleControlFlashLightsAction: {} });
  }

  async honkHorn() {
    return this._executeCarServerAction({ vehicleControlHonkHornAction: {} });
  }

  async sentryMode(on) {
    return this._executeCarServerAction({
      vehicleControlSetSentryModeAction: { on },
    });
  }

  async windowControl(action) {
    // action: 'vent' or 'close'
    const windowAction = action === 'vent' ? { vent: {} } : { close: {} };
    return this._executeCarServerAction({
      vehicleControlWindowAction: windowAction,
    });
  }

  async sunroofControl(action) {
    const sunroofAction = {};
    if (action === 'vent') sunroofAction.vent = {};
    else if (action === 'close') sunroofAction.close = {};
    else if (action === 'open') sunroofAction.open = {};
    return this._executeCarServerAction({
      vehicleControlSunroofOpenCloseAction: sunroofAction,
    });
  }

  async triggerHomelink(latitude, longitude) {
    return this._executeCarServerAction({
      vehicleControlTriggerHomelinkAction: {
        location: { latitude, longitude },
      },
    });
  }

  async scheduleSoftwareUpdate(offsetSec) {
    return this._executeCarServerAction({
      vehicleControlScheduleSoftwareUpdateAction: { offsetSec: offsetSec || 0 },
    });
  }

  async cancelSoftwareUpdate() {
    return this._executeCarServerAction({
      vehicleControlCancelSoftwareUpdateAction: {},
    });
  }

  async setValetMode(on, password) {
    return this._executeCarServerAction({
      vehicleControlSetValetModeAction: { on, password: password || '' },
    });
  }

  async resetValetPin() {
    return this._executeCarServerAction({
      vehicleControlResetValetPinAction: {},
    });
  }

  async setPinToDrive(on, password) {
    return this._executeCarServerAction({
      vehicleControlSetPinToDriveAction: { on, password: password || '' },
    });
  }

  async resetPinToDrive() {
    return this._executeCarServerAction({
      vehicleControlResetPinToDriveAction: {},
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Speed Limit Commands
  // ═══════════════════════════════════════════════════════════════════

  async speedLimitActivate(pin) {
    return this._executeCarServerAction({
      drivingSpeedLimitAction: { activate: true, pin },
    });
  }

  async speedLimitDeactivate(pin) {
    return this._executeCarServerAction({
      drivingSpeedLimitAction: { activate: false, pin },
    });
  }

  async speedLimitSetLimit(limitMph) {
    return this._executeCarServerAction({
      drivingSetSpeedLimitAction: { limitMph },
    });
  }

  async speedLimitClearPin(pin) {
    return this._executeCarServerAction({
      drivingClearSpeedLimitPinAction: { pin },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Media Commands
  // ═══════════════════════════════════════════════════════════════════

  async mediaTogglePlayback() {
    return this._executeCarServerAction({ mediaPlayAction: {} });
  }

  async mediaNextTrack() {
    return this._executeCarServerAction({ mediaNextTrack: {} });
  }

  async mediaPreviousTrack() {
    return this._executeCarServerAction({ mediaPreviousTrack: {} });
  }

  async mediaNextFavorite() {
    return this._executeCarServerAction({ mediaNextFavorite: {} });
  }

  async mediaPreviousFavorite() {
    return this._executeCarServerAction({ mediaPreviousFavorite: {} });
  }

  async mediaVolumeUp() {
    return this._executeCarServerAction({ mediaUpdateVolume: { volumeDelta: 1 } });
  }

  async mediaVolumeDown() {
    return this._executeCarServerAction({ mediaUpdateVolume: { volumeDelta: -1 } });
  }

  async mediaSetVolume(volume) {
    return this._executeCarServerAction({ mediaUpdateVolume: { volumeAbsoluteFloat: volume } });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Misc Commands
  // ═══════════════════════════════════════════════════════════════════

  async setVehicleName(name) {
    return this._executeCarServerAction({ setVehicleNameAction: { vehicleName: name } });
  }

  async guestMode(active) {
    return this._executeCarServerAction({ guestModeAction: { GuestModeActive: active } });
  }
}

// ─── Key Parsing Utilities ─────────────────────────────────────────────────

/**
 * Parse a PEM-encoded EC private key and extract raw private + public key buffers.
 * Uses Node.js native crypto (JWK export) for robust parsing of both PKCS#8 and SEC1 formats.
 * @param {string} pem - PEM encoded EC private key
 * @returns {{ privateKey: Buffer, publicKey: Buffer }}
 */
function parseECKeyFromPem(pem) {
  const keyObj = crypto.createPrivateKey(pem);
  const jwk = keyObj.export({ format: 'jwk' });

  if (jwk.crv !== 'P-256') {
    throw new Error(`Expected P-256 curve, got ${jwk.crv}`);
  }

  const privateKey = Buffer.from(jwk.d, 'base64url');
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');

  // Uncompressed public key: 0x04 + x (32 bytes) + y (32 bytes) = 65 bytes
  const publicKey = Buffer.concat([Buffer.from([0x04]), x, y]);

  return { privateKey, publicKey };
}

module.exports = {
  loadProtos,
  TeslaCommandSigner,
  parseECKeyFromPem,
};
