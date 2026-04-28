/* global $, M, _, systemConfig, systemDictionary, systemLang, translateAll, translateWord */
'use strict';

// Field names are based on Tesla's official Fleet Telemetry vehicle_data.proto
// (teslamotors/fleet-telemetry, read on 2026-04-28). The adapter stores the
// selected fields as telemetryFieldsJson for backwards compatibility with older
// admin versions and manual JSON configurations.
(function () {
  var TELEMETRY_AVAILABLE_FIELDS = [
  "DriveRail",
  "ChargeState",
  "BmsFullchargecomplete",
  "VehicleSpeed",
  "Odometer",
  "PackVoltage",
  "PackCurrent",
  "Soc",
  "DCDCEnable",
  "Gear",
  "IsolationResistance",
  "PedalPosition",
  "BrakePedal",
  "DiStateR",
  "DiHeatsinkTR",
  "DiAxleSpeedR",
  "DiTorquemotor",
  "DiStatorTempR",
  "DiVBatR",
  "DiMotorCurrentR",
  "Location",
  "GpsState",
  "GpsHeading",
  "NumBrickVoltageMax",
  "BrickVoltageMax",
  "NumBrickVoltageMin",
  "BrickVoltageMin",
  "NumModuleTempMax",
  "ModuleTempMax",
  "NumModuleTempMin",
  "ModuleTempMin",
  "RatedRange",
  "Hvil",
  "DCChargingEnergyIn",
  "DCChargingPower",
  "ACChargingEnergyIn",
  "ACChargingPower",
  "ChargeLimitSoc",
  "FastChargerPresent",
  "EstBatteryRange",
  "IdealBatteryRange",
  "BatteryLevel",
  "TimeToFullCharge",
  "ScheduledChargingStartTime",
  "ScheduledChargingPending",
  "ScheduledDepartureTime",
  "PreconditioningEnabled",
  "ScheduledChargingMode",
  "ChargeAmps",
  "ChargeEnableRequest",
  "ChargerPhases",
  "ChargePortColdWeatherMode",
  "ChargeCurrentRequest",
  "ChargeCurrentRequestMax",
  "BatteryHeaterOn",
  "NotEnoughPowerToHeat",
  "SuperchargerSessionTripPlanner",
  "DoorState",
  "Locked",
  "FdWindow",
  "FpWindow",
  "RdWindow",
  "RpWindow",
  "VehicleName",
  "SentryMode",
  "SpeedLimitMode",
  "CurrentLimitMph",
  "Version",
  "TpmsPressureFl",
  "TpmsPressureFr",
  "TpmsPressureRl",
  "TpmsPressureRr",
  "SemitruckTpmsPressureRe1L0",
  "SemitruckTpmsPressureRe1L1",
  "SemitruckTpmsPressureRe1R0",
  "SemitruckTpmsPressureRe1R1",
  "SemitruckTpmsPressureRe2L0",
  "SemitruckTpmsPressureRe2L1",
  "SemitruckTpmsPressureRe2R0",
  "SemitruckTpmsPressureRe2R1",
  "TpmsLastSeenPressureTimeFl",
  "TpmsLastSeenPressureTimeFr",
  "TpmsLastSeenPressureTimeRl",
  "TpmsLastSeenPressureTimeRr",
  "InsideTemp",
  "OutsideTemp",
  "SeatHeaterLeft",
  "SeatHeaterRight",
  "SeatHeaterRearLeft",
  "SeatHeaterRearRight",
  "SeatHeaterRearCenter",
  "AutoSeatClimateLeft",
  "AutoSeatClimateRight",
  "DriverSeatBelt",
  "PassengerSeatBelt",
  "DriverSeatOccupied",
  "SemitruckPassengerSeatFoldPosition",
  "LateralAcceleration",
  "LongitudinalAcceleration",
  "CruiseSetSpeed",
  "LifetimeEnergyUsed",
  "LifetimeEnergyUsedDrive",
  "SemitruckTractorParkBrakeStatus",
  "SemitruckTrailerParkBrakeStatus",
  "BrakePedalPos",
  "RouteLastUpdated",
  "RouteLine",
  "MilesToArrival",
  "MinutesToArrival",
  "OriginLocation",
  "DestinationLocation",
  "CarType",
  "Trim",
  "ExteriorColor",
  "RoofColor",
  "ChargePort",
  "ChargePortLatch",
  "GuestModeEnabled",
  "PinToDriveEnabled",
  "PairedPhoneKeyAndKeyFobQty",
  "CruiseFollowDistance",
  "AutomaticBlindSpotCamera",
  "BlindSpotCollisionWarningChime",
  "SpeedLimitWarning",
  "ForwardCollisionWarning",
  "LaneDepartureAvoidance",
  "EmergencyLaneDepartureAvoidance",
  "AutomaticEmergencyBrakingOff",
  "LifetimeEnergyGainedRegen",
  "DiStateF",
  "DiStateREL",
  "DiStateRER",
  "DiHeatsinkTF",
  "DiHeatsinkTREL",
  "DiHeatsinkTRER",
  "DiAxleSpeedF",
  "DiAxleSpeedREL",
  "DiAxleSpeedRER",
  "DiSlaveTorqueCmd",
  "DiTorqueActualR",
  "DiTorqueActualF",
  "DiTorqueActualREL",
  "DiTorqueActualRER",
  "DiStatorTempF",
  "DiStatorTempREL",
  "DiStatorTempRER",
  "DiVBatF",
  "DiVBatREL",
  "DiVBatRER",
  "DiMotorCurrentF",
  "DiMotorCurrentREL",
  "DiMotorCurrentRER",
  "EnergyRemaining",
  "ServiceMode",
  "BMSState",
  "GuestModeMobileAccessState",
  "DestinationName",
  "DiInverterTR",
  "DiInverterTF",
  "DiInverterTREL",
  "DiInverterTRER",
  "DetailedChargeState",
  "CabinOverheatProtectionMode",
  "CabinOverheatProtectionTemperatureLimit",
  "CenterDisplay",
  "ChargePortDoorOpen",
  "ChargerVoltage",
  "ChargingCableType",
  "ClimateKeeperMode",
  "DefrostForPreconditioning",
  "DefrostMode",
  "EfficiencyPackage",
  "EstimatedHoursToChargeTermination",
  "EuropeVehicle",
  "ExpectedEnergyPercentAtTripArrival",
  "FastChargerType",
  "HomelinkDeviceCount",
  "HomelinkNearby",
  "HvacACEnabled",
  "HvacAutoMode",
  "HvacFanSpeed",
  "HvacFanStatus",
  "HvacLeftTemperatureRequest",
  "HvacPower",
  "HvacRightTemperatureRequest",
  "HvacSteeringWheelHeatAuto",
  "HvacSteeringWheelHeatLevel",
  "OffroadLightbarPresent",
  "PowershareHoursLeft",
  "PowershareInstantaneousPowerKW",
  "PowershareStatus",
  "PowershareStopReason",
  "PowershareType",
  "RearDisplayHvacEnabled",
  "RearSeatHeaters",
  "RemoteStartEnabled",
  "RightHandDrive",
  "RouteTrafficMinutesDelay",
  "SoftwareUpdateDownloadPercentComplete",
  "SoftwareUpdateExpectedDurationMinutes",
  "SoftwareUpdateInstallationPercentComplete",
  "SoftwareUpdateScheduledStartTime",
  "SoftwareUpdateVersion",
  "TonneauOpenPercent",
  "TonneauPosition",
  "TonneauTentMode",
  "TpmsHardWarnings",
  "TpmsSoftWarnings",
  "ValetModeEnabled",
  "WheelType",
  "WiperHeatEnabled",
  "LocatedAtHome",
  "LocatedAtWork",
  "LocatedAtFavorite",
  "SettingDistanceUnit",
  "SettingTemperatureUnit",
  "Setting24HourTime",
  "SettingTirePressureUnit",
  "SettingChargeUnit",
  "ClimateSeatCoolingFrontLeft",
  "ClimateSeatCoolingFrontRight",
  "LightsHazardsActive",
  "LightsTurnSignal",
  "LightsHighBeams",
  "MediaPlaybackStatus",
  "MediaPlaybackSource",
  "MediaAudioVolume",
  "MediaNowPlayingDuration",
  "MediaNowPlayingElapsed",
  "MediaNowPlayingArtist",
  "MediaNowPlayingTitle",
  "MediaNowPlayingAlbum",
  "MediaNowPlayingStation",
  "MediaAudioVolumeIncrement",
  "MediaAudioVolumeMax",
  "SunroofInstalled",
  "SeatVentEnabled",
  "RearDefrostEnabled",
  "ChargeRateMilePerHour",
  "MilesSinceReset",
  "SelfDrivingMilesSinceReset"
];

  var TELEMETRY_DEFAULT_FIELD_INTERVALS = {
  "ChargeState": 1,
  "DetailedChargeState": 1,
  "ChargeLimitSoc": 60,
  "ChargeAmps": 1,
  "ChargeCurrentRequest": 1,
  "ChargeCurrentRequestMax": 60,
  "ChargingCableType": 1,
  "ChargePortDoorOpen": 1,
  "EstBatteryRange": 60,
  "Soc": 1,
  "VehicleSpeed": 10,
  "Gear": 1,
  "Location": 10,
  "Locked": 1,
  "Odometer": 60,
  "VehicleName": 60
};

  var TELEMETRY_DEFAULT_FIELD_MINIMUM_DELTAS = {
  "Soc": 1,
  // Tesla expects Location minimum_delta in meters. 100m is approximately
  // equivalent to 0.001° latitude/longitude and filters GPS jitter well.
  "Location": 100
};

  var TELEMETRY_STATE_MAPPINGS = {
  "Soc": [
    "charge_state.battery_level"
  ],
  "ChargeState": [
    "charge_state.charging_state"
  ],
  "DetailedChargeState": [
    "charge_state.detailed_charge_state"
  ],
  "ChargeLimitSoc": [
    "charge_state.charge_limit_soc"
  ],
  "ChargeAmps": [
    "charge_state.charge_amps",
    "charge_state.charger_actual_current"
  ],
  "ChargeCurrentRequest": [
    "charge_state.charge_current_request"
  ],
  "ChargeCurrentRequestMax": [
    "charge_state.charge_current_request_max"
  ],
  "ChargingCableType": [
    "charge_state.conn_charge_cable"
  ],
  "ChargePortDoorOpen": [
    "charge_state.charge_port_door_open"
  ],
  "EstBatteryRange": [
    "charge_state.est_battery_range"
  ],
  "VehicleSpeed": [
    "drive_state.speed"
  ],
  "Gear": [
    "drive_state.shift_state"
  ],
  "Location": [
    "drive_state.latitude",
    "drive_state.longitude"
  ],
  "Locked": [
    "vehicle_state.locked"
  ],
  "Odometer": [
    "vehicle_state.odometer"
  ],
  "VehicleName": [
    "vehicle_state.vehicle_name"
  ]
};

  var TELEMETRY_LOCATION_SCOPE_FIELDS = [
  "Location",
  "OriginLocation",
  "DestinationLocation",
  "DestinationName",
  "RouteLine",
  "GpsState",
  "GpsHeading"
];

  var telemetryFieldState = {};
  var telemetryCustomFields = [];

  function getTelemetryAdminLanguage() {
    var language = '';

    if (typeof systemLang !== 'undefined' && systemLang) {
      language = systemLang;
    } else if (typeof systemConfig !== 'undefined' && systemConfig && systemConfig.common && systemConfig.common.language) {
      language = systemConfig.common.language;
    } else if (window.systemLang) {
      language = window.systemLang;
    } else if (window.systemConfig && window.systemConfig.common && window.systemConfig.common.language) {
      language = window.systemConfig.common.language;
    } else if (window.navigator && window.navigator.language) {
      language = window.navigator.language;
    }

    language = String(language || 'en').toLowerCase().replace('_', '-');
    if (language.indexOf('zh') === 0) return 'zh-cn';
    return language.split('-')[0] || 'en';
  }

  function applyTelemetryTextParams(text, params) {
    Object.keys(params || {}).forEach(function (name) {
      text = String(text).replace(new RegExp('\\{' + name + '\\}', 'g'), String(params[name]));
    });
    return text;
  }

  function translateTelemetry(key, params) {
    var text = '';
    var language = getTelemetryAdminLanguage();

    if (typeof systemDictionary !== 'undefined' && systemDictionary && systemDictionary[key]) {
      text = systemDictionary[key][language] || systemDictionary[key].en || '';
    }

    if (!text && typeof translateWord === 'function') {
      text = translateWord(key, language, systemDictionary);
    }

    if ((!text || text === key) && typeof _ === 'function') {
      try {
        text = _(key);
      } catch (error) {
        text = '';
      }
    }

    return applyTelemetryTextParams(text || key, params);
  }

  function getTelemetryCategoryTranslationKey(category) {
    return 'telemetry_category_' + String(category || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function translateTelemetryCategory(category) {
    var key = getTelemetryCategoryTranslationKey(category);
    var translated = translateTelemetry(key);
    return translated === key ? category : translated;
  }

  function translateTelemetryAdmin() {
    if (typeof translateAll === 'function') {
      translateAll(undefined, getTelemetryAdminLanguage(), systemDictionary);
    }
    $('[data-telemetry-i18n]').each(function () {
      var $element = $(this);
      $element.html(translateTelemetry($element.attr('data-telemetry-i18n')));
    });
    $('[data-telemetry-i18n-placeholder]').each(function () {
      var $element = $(this);
      $element.attr('placeholder', translateTelemetry($element.attr('data-telemetry-i18n-placeholder')));
    });
    if (typeof M !== 'undefined' && M.updateTextFields) M.updateTextFields();
  }

  window.translateTelemetryText = translateTelemetry;
  window.translateTelemetryAdmin = translateTelemetryAdmin;

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function humanizeTelemetryFieldName(fieldName) {
    return String(fieldName)
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\bA C\b/g, 'AC')
      .replace(/\bD C\b/g, 'DC')
      .replace(/\bD C D C\b/g, 'DCDC')
      .replace(/\bB M S\b/g, 'BMS')
      .replace(/\bK W\b/g, 'KW')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var TELEMETRY_FIELD_LABELS_DE = {
    Soc: 'Ladezustand',
    ChargeState: 'Ladestatus',
    DetailedChargeState: 'Detaillierter Ladestatus',
    ChargeLimitSoc: 'Ladelimit',
    ChargingCableType: 'Ladekabeltyp',
    ChargeAmps: 'Ladestrom',
    ChargeCurrentRequest: 'Angeforderter Ladestrom',
    ChargeCurrentRequestMax: 'Maximaler angeforderter Ladestrom',
    ChargePortDoorOpen: 'Ladeportklappe geöffnet',
    EstBatteryRange: 'Geschätzte Batteriereichweite',
    IdealBatteryRange: 'Ideale Batteriereichweite',
    RatedRange: 'Normreichweite',
    VehicleSpeed: 'Fahrgeschwindigkeit',
    Gear: 'Gang',
    Location: 'Standort',
    Odometer: 'Kilometerstand',
    Locked: 'Verriegelt',
    VehicleName: 'Fahrzeugname',
    RouteLine: 'Routenlinie',
    RouteLastUpdated: 'Route zuletzt aktualisiert',
    MilesToArrival: 'Meilen bis Ankunft',
    MinutesToArrival: 'Minuten bis Ankunft',
    OriginLocation: 'Startort',
    DestinationLocation: 'Zielort',
    DestinationName: 'Zielname',
    GpsState: 'GPS-Status',
    GpsHeading: 'GPS-Richtung',
    MediaPlaybackStatus: 'Medien-Wiedergabestatus',
    MediaPlaybackSource: 'Medienquelle',
    MediaAudioVolume: 'Medienlautstärke',
    MediaAudioVolumeIncrement: 'Lautstärkeschritt',
    MediaAudioVolumeMax: 'Maximale Medienlautstärke',
    MediaNowPlayingDuration: 'Dauer des aktuellen Titels',
    MediaNowPlayingElapsed: 'Abspielzeit des aktuellen Titels',
    MediaNowPlayingArtist: 'Aktueller Interpret',
    MediaNowPlayingTitle: 'Aktueller Titel',
    MediaNowPlayingAlbum: 'Aktuelles Album',
    MediaNowPlayingStation: 'Aktueller Sender',
    InsideTemp: 'Innentemperatur',
    OutsideTemp: 'Außentemperatur',
    HvacPower: 'Klimaanlage aktiv',
    HvacAutoMode: 'Klima-Automatikmodus',
    HvacFanSpeed: 'Gebläsestufe',
    HvacLeftTemperatureRequest: 'Zieltemperatur links',
    HvacRightTemperatureRequest: 'Zieltemperatur rechts',
    ClimateKeeperMode: 'Klimahaltemodus',
    CabinOverheatProtectionMode: 'Kabinen-Überhitzungsschutz',
    DoorState: 'Türstatus',
    FdWindow: 'Fenster vorne links',
    FpWindow: 'Fenster vorne rechts',
    RdWindow: 'Fenster hinten links',
    RpWindow: 'Fenster hinten rechts',
    SentryMode: 'Wächtermodus',
    SpeedLimitMode: 'Geschwindigkeitslimit-Modus',
    CurrentLimitMph: 'Aktuelles Geschwindigkeitslimit',
    Version: 'Softwareversion',
    TpmsPressureFl: 'Reifendruck vorne links',
    TpmsPressureFr: 'Reifendruck vorne rechts',
    TpmsPressureRl: 'Reifendruck hinten links',
    TpmsPressureRr: 'Reifendruck hinten rechts',
    BatteryLevel: 'Batteriestand',
    BatteryHeaterOn: 'Batterieheizung aktiv',
    TimeToFullCharge: 'Zeit bis Vollladung',
    ChargerVoltage: 'Ladespannung',
    ChargerPhases: 'Ladephasen',
    ChargeRateMilePerHour: 'Laderate',
    FastChargerPresent: 'Schnelllader verbunden',
    FastChargerType: 'Schnellladertyp',
    ScheduledChargingStartTime: 'Geplante Lade-Startzeit',
    ScheduledChargingPending: 'Geplantes Laden ausstehend',
    ScheduledDepartureTime: 'Geplante Abfahrtszeit',
    PreconditioningEnabled: 'Vorkonditionierung aktiviert',
    ScheduledChargingMode: 'Modus für geplantes Laden',
  };

  var TELEMETRY_FIELD_TERMS_DE = {
    AC: 'AC',
    Acceleration: 'Beschleunigung',
    Access: 'Zugriff',
    Active: 'aktiv',
    Actual: 'Ist',
    Album: 'Album',
    Amps: 'Ampere',
    And: 'und',
    Arrival: 'Ankunft',
    Artist: 'Interpret',
    At: 'bei',
    Audio: 'Audio',
    Auto: 'Automatisch',
    Automatic: 'Automatisch',
    Avoidance: 'Vermeidung',
    Axle: 'Achse',
    Battery: 'Batterie',
    Beams: 'Fernlicht',
    Belt: 'Gurt',
    Blind: 'Toter',
    Brake: 'Bremse',
    Braking: 'Bremsung',
    Brick: 'Zellblock',
    Cabin: 'Kabine',
    Cable: 'Kabel',
    Camera: 'Kamera',
    Car: 'Fahrzeug',
    Center: 'Mitte',
    Charge: 'Laden',
    Charger: 'Ladegerät',
    Charging: 'Laden',
    Chime: 'Ton',
    Climate: 'Klima',
    Cmd: 'Befehl',
    Cold: 'Kalt',
    Collision: 'Kollision',
    Color: 'Farbe',
    Complete: 'abgeschlossen',
    Cooling: 'Kühlung',
    Count: 'Anzahl',
    Cruise: 'Tempomat',
    Current: 'Strom',
    DC: 'DC',
    DCDC: 'DC/DC',
    Defrost: 'Entfrosten',
    Delay: 'Verzögerung',
    Departure: 'Abfahrt',
    Destination: 'Ziel',
    Detailed: 'Detailliert',
    Device: 'Gerät',
    Display: 'Display',
    Distance: 'Entfernung',
    Door: 'Tür',
    Download: 'Download',
    Drive: 'Antrieb',
    Driver: 'Fahrer',
    Driving: 'Fahren',
    Duration: 'Dauer',
    Efficiency: 'Effizienz',
    Elapsed: 'verstrichen',
    Emergency: 'Notfall',
    Enable: 'Aktivieren',
    Enabled: 'aktiviert',
    Energy: 'Energie',
    Enough: 'genug',
    Est: 'Geschätzt',
    Estimated: 'Geschätzt',
    Europe: 'Europa',
    Expected: 'Erwartet',
    Exterior: 'Außen',
    Fan: 'Gebläse',
    Fast: 'Schnell',
    Favorite: 'Favorit',
    Fl: 'vorne links',
    Fob: 'Schlüssel',
    Fold: 'Klapp',
    Follow: 'Folgeabstand',
    For: 'für',
    Forward: 'Vorwärts',
    Fp: 'vorne rechts',
    Fr: 'vorne rechts',
    Front: 'Vorne',
    Full: 'Voll',
    Fullchargecomplete: 'Vollladung abgeschlossen',
    Gained: 'Gewonnen',
    Gear: 'Gang',
    Gps: 'GPS',
    Guest: 'Gast',
    Hand: 'Hand',
    Hard: 'Hart',
    Hazards: 'Warnblinker',
    Heading: 'Richtung',
    Heat: 'Heizung',
    Heater: 'Heizung',
    Heaters: 'Heizungen',
    Heatsink: 'Kühlkörper',
    High: 'Hoch',
    Home: 'Zuhause',
    Homelink: 'Homelink',
    Hour: 'Stunde',
    Hours: 'Stunden',
    Hvac: 'Klima',
    Hvil: 'HVIL',
    Ideal: 'Ideal',
    In: 'ein',
    Increment: 'Schritt',
    Inside: 'Innen',
    Installation: 'Installation',
    Installed: 'installiert',
    Instantaneous: 'Momentan',
    Inverter: 'Inverter',
    Isolation: 'Isolation',
    KW: 'kW',
    Keeper: 'Halten',
    Key: 'Schlüssel',
    Lane: 'Spur',
    Last: 'Letzte',
    Latch: 'Verriegelung',
    Lateral: 'Quer',
    Left: 'Links',
    Level: 'Stufe',
    Lifetime: 'Lebensdauer',
    Lightbar: 'Lichtleiste',
    Lights: 'Lichter',
    Limit: 'Limit',
    Line: 'Linie',
    Located: 'befindet sich',
    Location: 'Standort',
    Locked: 'Verriegelt',
    Longitudinal: 'Längs',
    Max: 'Maximal',
    Media: 'Medien',
    Mile: 'Meile',
    Miles: 'Meilen',
    Min: 'Minimal',
    Minutes: 'Minuten',
    Mobile: 'Mobil',
    Mode: 'Modus',
    Module: 'Modul',
    Motor: 'Motor',
    Mph: 'mph',
    Name: 'Name',
    Nearby: 'in der Nähe',
    Not: 'Nicht',
    Now: 'Aktuell',
    Num: 'Anzahl',
    Occupied: 'belegt',
    Odometer: 'Kilometerstand',
    Off: 'Aus',
    Offroad: 'Offroad',
    On: 'An',
    Open: 'Offen',
    Origin: 'Start',
    Outside: 'Außen',
    Overheat: 'Überhitzung',
    Pack: 'Batteriepack',
    Package: 'Paket',
    Paired: 'gekoppelt',
    Park: 'Park',
    Passenger: 'Beifahrer',
    Pedal: 'Pedal',
    Pending: 'ausstehend',
    Per: 'pro',
    Percent: 'Prozent',
    Phases: 'Phasen',
    Phone: 'Telefon',
    Pin: 'PIN',
    Planner: 'Planer',
    Playback: 'Wiedergabe',
    Playing: 'spielend',
    Port: 'Port',
    Pos: 'Position',
    Position: 'Position',
    Power: 'Leistung',
    Powershare: 'Powershare',
    Preconditioning: 'Vorkonditionierung',
    Present: 'vorhanden',
    Pressure: 'Druck',
    Protection: 'Schutz',
    Qty: 'Anzahl',
    Rail: 'Schiene',
    Range: 'Reichweite',
    Rate: 'Rate',
    Rated: 'Norm',
    Rd: 'hinten links',
    Rear: 'Hinten',
    Reason: 'Grund',
    Regen: 'Rekuperation',
    Remaining: 'verbleibend',
    Remote: 'Fernstart',
    Request: 'Anforderung',
    Reset: 'Reset',
    Resistance: 'Widerstand',
    Right: 'Rechts',
    Rl: 'hinten links',
    Roof: 'Dach',
    Route: 'Route',
    Rp: 'hinten rechts',
    Rr: 'hinten rechts',
    Scheduled: 'Geplant',
    Seat: 'Sitz',
    Seen: 'gesehen',
    Self: 'Selbst',
    Semitruck: 'Semi-Truck',
    Sentry: 'Wächter',
    Service: 'Service',
    Session: 'Sitzung',
    Set: 'gesetzt',
    Setting: 'Einstellung',
    Setting24: '24-Stunden-Einstellung',
    Signal: 'Signal',
    Since: 'seit',
    Slave: 'Slave',
    Soc: 'Ladezustand',
    Soft: 'Weich',
    Software: 'Software',
    Source: 'Quelle',
    Speed: 'Geschwindigkeit',
    Spot: 'Winkel',
    Start: 'Start',
    State: 'Status',
    Station: 'Sender',
    Stator: 'Stator',
    Status: 'Status',
    Steering: 'Lenkrad',
    Stop: 'Stopp',
    Sunroof: 'Schiebedach',
    Supercharger: 'Supercharger',
    Temp: 'Temperatur',
    Temperature: 'Temperatur',
    Tent: 'Zelt',
    Termination: 'Beendigung',
    Time: 'Zeit',
    Tire: 'Reifen',
    Title: 'Titel',
    To: 'bis',
    Tonneau: 'Laderaumabdeckung',
    Torque: 'Drehmoment',
    Torquemotor: 'Motordrehmoment',
    Tpms: 'Reifendruckkontrolle',
    Tractor: 'Zugmaschine',
    Traffic: 'Verkehr',
    Trailer: 'Anhänger',
    Trim: 'Ausstattung',
    Trip: 'Fahrt',
    Turn: 'Blinker',
    Type: 'Typ',
    Unit: 'Einheit',
    Update: 'Update',
    Updated: 'aktualisiert',
    Used: 'verbraucht',
    Valet: 'Valet',
    Vehicle: 'Fahrzeug',
    Vent: 'Belüftung',
    Version: 'Version',
    Voltage: 'Spannung',
    Volume: 'Lautstärke',
    Warning: 'Warnung',
    Warnings: 'Warnungen',
    Weather: 'Wetter',
    Wheel: 'Rad',
    Window: 'Fenster',
    Wiper: 'Scheibenwischer',
    Work: 'Arbeit',
  };

  function translateTelemetryFieldName(fieldName) {
    var key = 'telemetry_field_' + fieldName;
    if (typeof systemDictionary !== 'undefined' && systemDictionary && systemDictionary[key]) {
      return translateTelemetry(key);
    }
    if (getTelemetryAdminLanguage() !== 'de') {
      return humanizeTelemetryFieldName(fieldName);
    }
    if (TELEMETRY_FIELD_LABELS_DE[fieldName]) {
      return TELEMETRY_FIELD_LABELS_DE[fieldName];
    }
    return humanizeTelemetryFieldName(fieldName)
      .split(' ')
      .map(function (term) { return TELEMETRY_FIELD_TERMS_DE[term] || term; })
      .join(' ');
  }

  function getTelemetryFieldCategory(fieldName) {
    if (/^Media/.test(fieldName)) return 'Media';
    if (/^Setting/.test(fieldName)) return 'User Preference';
    if (/^Di|^Hvil$/.test(fieldName)) return 'Powertrain';
    if (/Tpms|IsolationResistance/.test(fieldName)) return 'Service';
    if (/Location|Gps|RouteLine|RouteLastUpdated|DestinationName|MilesToArrival|MinutesToArrival|LocatedAt/.test(fieldName)) return 'Location';
    if (/Hvac|Climate|SeatHeater|SeatVent|Defrost|InsideTemp|OutsideTemp|CabinOverheat|RearDefrost|WiperHeat/.test(fieldName)) return 'Climate';
    if (/Charge|Charging|Charger|Battery|Soc|Range|Pack|Brick|Module|Bms|BMS|Preconditioning|Supercharger|Energy|Powershare|DCDC/.test(fieldName)) return 'Charging';
    if (/VehicleSpeed|Gear|Pedal|BrakePedal|Acceleration|CruiseSetSpeed|DriveRail|RouteTraffic/.test(fieldName)) return 'Driving';
    if (/Locked|SeatBelt|PinToDrive|CruiseFollowDistance|BlindSpot|SpeedLimitWarning|ForwardCollision|LaneDeparture|Emergency|AutomaticEmergency|MilesSinceReset|SelfDriving/.test(fieldName)) return 'Safety';
    if (/CarType|Trim|ExteriorColor|RoofColor|EuropeVehicle|EfficiencyPackage|RearSeatHeaters|RemoteStartEnabled|RightHandDrive|OffroadLightbarPresent|WheelType|SunroofInstalled|VehicleName|Version|ChargePort$/.test(fieldName)) return 'Vehicle Configuration';
    if (/DoorState|Window|SentryMode|SpeedLimitMode|CurrentLimit|GuestMode|PairedPhone|Homelink|CenterDisplay|SoftwareUpdate|Lights|Tonneau|ValetMode|ServiceMode|Semitruck|DriverSeatOccupied/.test(fieldName)) return 'Vehicle State';
    return 'Other';
  }

  function getTelemetryDefaultInterval(fieldName) {
    if (TELEMETRY_DEFAULT_FIELD_INTERVALS[fieldName]) return TELEMETRY_DEFAULT_FIELD_INTERVALS[fieldName];
    var category = getTelemetryFieldCategory(fieldName);
    if (category === 'Location' || category === 'Driving') return 10;
    if (category === 'Charging' || category === 'Vehicle State' || category === 'Safety') return 60;
    return 300;
  }

  function getTelemetryDefaultMinimumDelta(fieldName) {
    return TELEMETRY_DEFAULT_FIELD_MINIMUM_DELTAS[fieldName] || '';
  }

  function getTelemetryDefaultFieldEntry(fieldName) {
    var entry = { interval_seconds: TELEMETRY_DEFAULT_FIELD_INTERVALS[fieldName] };
    var minimumDelta = getTelemetryDefaultMinimumDelta(fieldName);
    if (minimumDelta !== '') {
      entry.minimum_delta = minimumDelta;
    }
    return entry;
  }

  function cloneTelemetryDefaultFields() {
    var result = {};
    Object.keys(TELEMETRY_DEFAULT_FIELD_INTERVALS).forEach(function (fieldName) {
      result[fieldName] = getTelemetryDefaultFieldEntry(fieldName);
    });
    return result;
  }

  function normalizeTelemetryFieldOption(fieldName, rawValue) {
    if (rawValue === false || rawValue === null) {
      return { enabled: false, interval: getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
    }
    if (rawValue === true || rawValue === undefined) {
      return { enabled: true, interval: getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'string') {
      return { enabled: true, interval: Number(rawValue) || getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
    }
    if (typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      return { enabled: false, interval: getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
    }

    var extraOptions = $.extend(true, {}, rawValue);
    var enabled = !(extraOptions.enabled === false || extraOptions.disabled === true);
    delete extraOptions.enabled;
    delete extraOptions.disabled;
    var interval = Number(extraOptions.interval_seconds);
    delete extraOptions.interval_seconds;
    var minimumDelta = '';
    if (extraOptions.minimum_delta !== undefined && extraOptions.minimum_delta !== '' && extraOptions.minimum_delta !== null && extraOptions.minimum_delta !== false) {
      minimumDelta = Number(extraOptions.minimum_delta);
    }
    delete extraOptions.minimum_delta;
    return {
      enabled: enabled,
      interval: interval > 0 ? Math.round(interval) : getTelemetryDefaultInterval(fieldName),
      minimumDelta: minimumDelta > 0 ? minimumDelta : '',
      extraOptions: extraOptions,
    };
  }

  function parseTelemetryFieldsJson(value) {
    var raw = String(value || '').trim();
    if (!raw) return cloneTelemetryDefaultFields();
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (typeof M !== 'undefined' && M.toast) M.toast({ html: translateTelemetry('telemetry_invalid_json_default') });
      return cloneTelemetryDefaultFields();
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.fields && typeof parsed.fields === 'object') {
      parsed = parsed.fields;
    }
    if (Array.isArray(parsed)) {
      var arrayFields = {};
      parsed.forEach(function (fieldName) {
        if (fieldName) arrayFields[String(fieldName).trim()] = true;
      });
      return arrayFields;
    }
    return parsed && typeof parsed === 'object' ? parsed : cloneTelemetryDefaultFields();
  }

  function getAllTelemetryFieldNames() {
    var seen = {};
    var result = [];
    TELEMETRY_AVAILABLE_FIELDS.concat(telemetryCustomFields).forEach(function (fieldName) {
      if (!fieldName || seen[fieldName]) return;
      seen[fieldName] = true;
      result.push(fieldName);
    });
    return result.sort(function (left, right) {
      var leftCategory = getTelemetryFieldCategory(left);
      var rightCategory = getTelemetryFieldCategory(right);
      if (leftCategory !== rightCategory) return leftCategory.localeCompare(rightCategory);
      return left.localeCompare(right);
    });
  }

  function setTelemetryFieldStateFromConfig(config) {
    telemetryFieldState = {};
    telemetryCustomFields = [];
    var officialFields = {};
    TELEMETRY_AVAILABLE_FIELDS.forEach(function (fieldName) { officialFields[fieldName] = true; });

    Object.keys(config || {}).forEach(function (fieldName) {
      var normalizedName = String(fieldName || '').trim();
      if (!normalizedName) return;
      telemetryFieldState[normalizedName] = normalizeTelemetryFieldOption(normalizedName, config[fieldName]);
      if (!officialFields[normalizedName]) telemetryCustomFields.push(normalizedName);
    });

    TELEMETRY_AVAILABLE_FIELDS.forEach(function (fieldName) {
      if (!telemetryFieldState[fieldName]) {
        telemetryFieldState[fieldName] = {
          enabled: false,
          interval: getTelemetryDefaultInterval(fieldName),
          minimumDelta: getTelemetryDefaultMinimumDelta(fieldName),
          extraOptions: {},
        };
      }
    });
  }

  function syncTelemetryFieldsJsonFromEditor() {
    var selected = {};
    $('.telemetry-field-row').each(function () {
      var $row = $(this);
      var fieldName = $row.attr('data-field');
      if (!fieldName) return;
      var state = telemetryFieldState[fieldName] || { extraOptions: {} };
      state.enabled = $row.find('.telemetry-field-enabled').prop('checked');
      var interval = Number($row.find('.telemetry-field-interval').val());
      state.interval = interval > 0 ? Math.round(interval) : getTelemetryDefaultInterval(fieldName);
      var minimumDelta = Number($row.find('.telemetry-field-minimum-delta').val());
      state.minimumDelta = minimumDelta > 0 ? minimumDelta : '';
      telemetryFieldState[fieldName] = state;
    });

    Object.keys(telemetryFieldState).sort().forEach(function (fieldName) {
      var state = telemetryFieldState[fieldName];
      if (!state || !state.enabled) return;
      var entry = $.extend(true, {}, state.extraOptions || {});
      entry.interval_seconds = state.interval > 0 ? Math.round(state.interval) : getTelemetryDefaultInterval(fieldName);
      if (Number(state.minimumDelta) > 0) {
        entry.minimum_delta = Number(state.minimumDelta);
      }
      selected[fieldName] = entry;
    });

    var json = JSON.stringify(selected, null, 2);
    $('#telemetryFieldsJson').val(json);
    $('#telemetryFieldsJsonPreview').val(json);
    updateTelemetryFieldSummary();
    return json;
  }

  function updateTelemetryFieldSummary() {
    var selectedCount = Object.keys(telemetryFieldState).filter(function (fieldName) {
      return telemetryFieldState[fieldName] && telemetryFieldState[fieldName].enabled;
    }).length;
    $('#telemetryFieldSummary').text(translateTelemetry('telemetry_selected_summary', { selected: selectedCount, total: getAllTelemetryFieldNames().length }));
  }

  function renderTelemetryFieldRows() {
    var search = String($('#telemetryFieldSearch').val() || '').toLowerCase();
    var categoryFilter = $('#telemetryFieldCategory').val() || '';
    var selectionFilter = $('#telemetryFieldSelectionFilter').val() || 'all';
    var $tbody = $('#telemetryFieldRows');
    var lastRenderedCategory = null;
    $tbody.empty();

    getAllTelemetryFieldNames().forEach(function (fieldName) {
      var category = getTelemetryFieldCategory(fieldName);
      var isDefault = !!TELEMETRY_DEFAULT_FIELD_INTERVALS[fieldName];
      var haystack = (fieldName + ' ' + humanizeTelemetryFieldName(fieldName) + ' ' + category + ' ' + translateTelemetryCategory(category)).toLowerCase();
      var state = telemetryFieldState[fieldName] || {
        enabled: false,
        interval: getTelemetryDefaultInterval(fieldName),
        minimumDelta: getTelemetryDefaultMinimumDelta(fieldName),
        extraOptions: {},
      };
      if (search && haystack.indexOf(search) === -1) return;
      if (categoryFilter === '__default' && !isDefault) return;
      if (categoryFilter && categoryFilter !== '__default' && category !== categoryFilter) return;
      if (selectionFilter === 'selected' && !state.enabled) return;
      if (selectionFilter === 'unselected' && state.enabled) return;

      var mapping = TELEMETRY_STATE_MAPPINGS[fieldName];
      var stateTarget = mapping ? mapping.join(', ') : translateTelemetry('telemetry_raw_state_target', { field: fieldName });
      var scopeBadge = TELEMETRY_LOCATION_SCOPE_FIELDS.indexOf(fieldName) >= 0 ? '<span class="new badge amber darken-3" data-badge-caption="' + escapeHtml(translateTelemetry('telemetry_badge_location_scope')) + '"></span>' : '';
      var defaultBadge = isDefault ? '<span class="new badge blue" data-badge-caption="' + escapeHtml(translateTelemetry('telemetry_badge_default')) + '"></span>' : '';
      var rowClass = state.enabled ? 'telemetry-field-row' : 'telemetry-field-row telemetry-field-row-disabled';
      var rowId = 'telemetryField_' + fieldName;

      if (lastRenderedCategory !== category) {
        lastRenderedCategory = category;
        $tbody.append(
          '<tr class="telemetry-field-category-row">' +
            '<td colspan="6">' + escapeHtml(translateTelemetryCategory(category)) + '</td>' +
          '</tr>'
        );
      }

      $tbody.append(
        '<tr class="' + rowClass + '" data-field="' + escapeHtml(fieldName) + '">' +
          '<td class="telemetry-field-enabled-cell">' +
            '<label for="' + rowId + '">' +
              '<input type="checkbox" id="' + rowId + '" class="filled-in telemetry-field-enabled" ' + (state.enabled ? 'checked' : '') + ' />' +
              '<span></span>' +
            '</label>' +
          '</td>' +
          '<td><span class="telemetry-field-label">' + escapeHtml(translateTelemetryFieldName(fieldName)) + '</span><br><code class="telemetry-field-id">' + escapeHtml(fieldName) + '</code></td>' +
          '<td>' + escapeHtml(translateTelemetryCategory(category)) + '<br>' + defaultBadge + scopeBadge + '</td>' +
          '<td><input type="number" min="1" step="1" class="telemetry-field-interval" value="' + escapeHtml(state.interval || getTelemetryDefaultInterval(fieldName)) + '" /></td>' +
          '<td><input type="number" min="0" step="any" class="telemetry-field-minimum-delta" value="' + escapeHtml(state.minimumDelta || '') + '" placeholder="' + escapeHtml(getTelemetryDefaultMinimumDelta(fieldName)) + '" /></td>' +
          '<td class="telemetry-field-state-target">' + escapeHtml(stateTarget) + '</td>' +
        '</tr>'
      );
    });

    $tbody.find('.telemetry-field-enabled').on('change', function () {
      var $row = $(this).closest('.telemetry-field-row');
      var fieldName = $row.attr('data-field');
      telemetryFieldState[fieldName] = telemetryFieldState[fieldName] || { interval: getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
      telemetryFieldState[fieldName].enabled = $(this).prop('checked');
      $row.toggleClass('telemetry-field-row-disabled', !telemetryFieldState[fieldName].enabled);
      syncTelemetryFieldsJsonFromEditor();
      if (window._onChange) window._onChange();
      if (($('#telemetryFieldSelectionFilter').val() || 'all') !== 'all') renderTelemetryFieldRows();
    });

    $tbody.find('.telemetry-field-interval').on('change keyup', function () {
      var $row = $(this).closest('.telemetry-field-row');
      var fieldName = $row.attr('data-field');
      telemetryFieldState[fieldName] = telemetryFieldState[fieldName] || { enabled: false, minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
      var interval = Number($(this).val());
      telemetryFieldState[fieldName].interval = interval > 0 ? Math.round(interval) : getTelemetryDefaultInterval(fieldName);
      syncTelemetryFieldsJsonFromEditor();
      if (window._onChange) window._onChange();
    });

    $tbody.find('.telemetry-field-minimum-delta').on('change keyup', function () {
      var $row = $(this).closest('.telemetry-field-row');
      var fieldName = $row.attr('data-field');
      telemetryFieldState[fieldName] = telemetryFieldState[fieldName] || { enabled: false, interval: getTelemetryDefaultInterval(fieldName), extraOptions: {} };
      var minimumDelta = Number($(this).val());
      telemetryFieldState[fieldName].minimumDelta = minimumDelta > 0 ? minimumDelta : '';
      syncTelemetryFieldsJsonFromEditor();
      if (window._onChange) window._onChange();
    });

    updateTelemetryFieldSummary();
  }

  function renderTelemetryCategoryOptions() {
    var categories = {};
    TELEMETRY_AVAILABLE_FIELDS.forEach(function (fieldName) { categories[getTelemetryFieldCategory(fieldName)] = true; });
    var options = '<option value="">' + escapeHtml(translateTelemetry('telemetry_all_categories')) + '</option><option value="__default">' + escapeHtml(translateTelemetry('telemetry_default_preset_filter')) + '</option>';
    Object.keys(categories).sort().forEach(function (category) {
      options += '<option value="' + escapeHtml(category) + '">' + escapeHtml(translateTelemetryCategory(category)) + '</option>';
    });
    $('#telemetryFieldCategory').html(options);
    if (typeof $.fn.formSelect === 'function') $('#telemetryFieldCategory').formSelect();
  }

  function renderTelemetrySelectionFilterOptions() {
    var options =
      '<option value="all">' + escapeHtml(translateTelemetry('telemetry_filter_all_fields')) + '</option>' +
      '<option value="selected">' + escapeHtml(translateTelemetry('telemetry_filter_selected_fields')) + '</option>' +
      '<option value="unselected">' + escapeHtml(translateTelemetry('telemetry_filter_unselected_fields')) + '</option>';
    $('#telemetryFieldSelectionFilter').html(options);
    if (typeof $.fn.formSelect === 'function') $('#telemetryFieldSelectionFilter').formSelect();
  }

  function setTelemetryDefaultPreset() {
    setTelemetryFieldStateFromConfig(cloneTelemetryDefaultFields());
    renderTelemetryFieldRows();
    syncTelemetryFieldsJsonFromEditor();
    if (window._onChange) window._onChange();
  }

  function updateVisibleTelemetryFields(enabled) {
    $('.telemetry-field-row:visible').each(function () {
      var fieldName = $(this).attr('data-field');
      telemetryFieldState[fieldName] = telemetryFieldState[fieldName] || { interval: getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
      telemetryFieldState[fieldName].enabled = enabled;
      $(this).find('.telemetry-field-enabled').prop('checked', enabled);
      $(this).toggleClass('telemetry-field-row-disabled', !enabled);
    });
    syncTelemetryFieldsJsonFromEditor();
    renderTelemetryFieldRows();
    if (window._onChange) window._onChange();
  }

  function resetVisibleIntervals() {
    $('.telemetry-field-row:visible').each(function () {
      var fieldName = $(this).attr('data-field');
      var interval = getTelemetryDefaultInterval(fieldName);
      var minimumDelta = getTelemetryDefaultMinimumDelta(fieldName);
      telemetryFieldState[fieldName] = telemetryFieldState[fieldName] || { enabled: false, extraOptions: {} };
      telemetryFieldState[fieldName].interval = interval;
      telemetryFieldState[fieldName].minimumDelta = minimumDelta;
      $(this).find('.telemetry-field-interval').val(interval);
      $(this).find('.telemetry-field-minimum-delta').val(minimumDelta);
    });
    syncTelemetryFieldsJsonFromEditor();
    if (window._onChange) window._onChange();
  }

  function addCustomTelemetryField() {
    var fieldName = String($('#telemetryCustomFieldName').val() || '').trim();
    if (!fieldName) return;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName)) {
      if (typeof M !== 'undefined' && M.toast) M.toast({ html: translateTelemetry('telemetry_invalid_field_name') });
      return;
    }
    if (TELEMETRY_AVAILABLE_FIELDS.indexOf(fieldName) < 0 && telemetryCustomFields.indexOf(fieldName) < 0) {
      telemetryCustomFields.push(fieldName);
    }
    telemetryFieldState[fieldName] = telemetryFieldState[fieldName] || { enabled: true, interval: getTelemetryDefaultInterval(fieldName), minimumDelta: getTelemetryDefaultMinimumDelta(fieldName), extraOptions: {} };
    telemetryFieldState[fieldName].enabled = true;
    $('#telemetryCustomFieldName').val('');
    renderTelemetryFieldRows();
    syncTelemetryFieldsJsonFromEditor();
    if (typeof M !== 'undefined' && M.updateTextFields) M.updateTextFields();
    if (window._onChange) window._onChange();
  }

  window.initTelemetryFieldEditor = function (settings) {
    translateTelemetryAdmin();
    var fieldsConfig = parseTelemetryFieldsJson(settings && settings.telemetryFieldsJson);
    setTelemetryFieldStateFromConfig(fieldsConfig);
    renderTelemetryCategoryOptions();
    renderTelemetrySelectionFilterOptions();
    renderTelemetryFieldRows();
    syncTelemetryFieldsJsonFromEditor();

    $('#telemetryFieldSearch').off('keyup change').on('keyup change', renderTelemetryFieldRows);
    $('#telemetryFieldCategory').off('change').on('change', renderTelemetryFieldRows);
    $('#telemetryFieldSelectionFilter').off('change').on('change', renderTelemetryFieldRows);
    $('#telemetryPresetDefault').off('click').on('click', setTelemetryDefaultPreset);
    $('#telemetryEnableVisible').off('click').on('click', function () { updateVisibleTelemetryFields(true); });
    $('#telemetryDisableVisible').off('click').on('click', function () { updateVisibleTelemetryFields(false); });
    $('#telemetryResetVisibleIntervals').off('click').on('click', resetVisibleIntervals);
    $('#telemetryAddCustomField').off('click').on('click', addCustomTelemetryField);
    $('#telemetryCustomFieldName').off('keydown').on('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCustomTelemetryField();
      }
    });
  };

  window.syncTelemetryFieldsJsonFromEditor = syncTelemetryFieldsJsonFromEditor;
}());
