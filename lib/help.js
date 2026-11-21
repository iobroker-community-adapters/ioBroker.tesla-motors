'use strict';

/**
 * The answer of the message "help": what the instance answers, written for AI agents (e.g. ioBroker.pi-agent or
 * the MCP server with send_to) and script authors. Keep it in sync with onMessage and the remote states
 * (remoteArray) in main.js.
 */

/**
 * Every command the instance answers; write = the command changes something; standard = the command of the shared
 * catalog of sendTo commands (family.command) it follows
 */
const COMMANDS = [
  { command: 'help', write: false },
  { command: 'getVehicles', write: false, standard: 'vehicle.getVehicles' },
  { command: 'getStatus', write: false, standard: 'vehicle.getStatus' },
  { command: 'lock', write: true, standard: 'vehicle.lock' },
  { command: 'climate', write: true, standard: 'vehicle.climate' },
  { command: 'charge', write: true, standard: 'vehicle.charge' },
  { command: 'setChargeLimit', write: true, standard: 'vehicle.setChargeLimit' },
  { command: 'setChargeCurrent', write: true, standard: 'vehicle.setChargeCurrent' },
  { command: 'signal', write: true, standard: 'vehicle.signal' },
  { command: 'refresh', write: true, standard: 'vehicle.refresh' },
  { command: 'generateKeyPair', write: true },
  { command: 'getVirtualKeyQr', write: false },
  { command: 'checkFleetStatus', write: false },
  { command: 'configureFleetTelemetry', write: true },
  { command: 'getFleetTelemetryConfig', write: false },
  { command: 'deleteFleetTelemetryConfig', write: true },
  { command: 'calcFleetCost', write: false },
];

const HELP = `ioBroker.tesla-motors: connects Tesla vehicles and energy products (Powerwall, solar) through the Tesla Fleet
API. Every vehicle is the device tesla-motors.0.<VIN> with the values of Tesla's vehicle_data (charge_state.*,
climate_state.*, drive_state.*, vehicle_state.*, e.g. charge_state.battery_level, vehicle_state.locked) and the
commands as states in tesla-motors.0.<VIN>.remote.*. An agent reads the car and controls it with the standard
commands below (they follow the shared catalog of the vehicle family and answer whether the car took it) or by
writing the remote states (ack false, no answer).

Commands (sendTo tesla-motors.0), standard commands of the shared catalog (vehicle = VIN or the name of the car,
compared without case; default the only car; errors {error, reason: NOT_FOUND | AMBIGUOUS (with candidates) |
BAD_REQUEST | NOT_CONNECTED (the car does not wake up) | COMMAND_FAILED}). The write commands wake a sleeping car
first and answer {ok: true} when the car took the command, or {ok: true, pending: true} after 14 s while it is still
waking (the rest then goes on in the background, failures go to the log):
- getVehicles {}: {vehicles: [{id: VIN, name}]}.
- getStatus {vehicle?}: {batteryPercent?, rangeKm?, charging?, plugged?, locked?, climate?, insideTemp? (°C),
  odometerKm?, lat?, lon?, ts (ms, the newest value)} from the states (Tesla's miles converted); does not wake the car.
- lock {vehicle?, locked: true | false}: door_lock / door_unlock (false UNLOCKS the car).
- climate {vehicle?, on: true | false, temp? (°C, as set_temps-driver_temp)}: set_temps, then auto_conditioning_start
  / auto_conditioning_stop.
- charge {vehicle?, on: true | false}: charge_start / charge_stop.
- setChargeLimit {vehicle?, percent (1-100)}: set_charge_limit. setChargeCurrent {vehicle?, amps}: set_charging_amps.
- signal {vehicle?, kind?: 'horn' | 'lights' (default) | 'both'}: honk_horn / flash_lights.
- refresh {vehicle?, wake?: false}: reads all values now (as force_update); wake: true wakes a sleeping car first.
Commands for the settings:
- generateKeyPair {}: creates a new key pair for command signing: {publicKey, privateKey, native, saveConfig}; the
  admin saves it into the settings (the virtual key on the car must then be installed again).
- getVirtualKeyQr {fleetkeyDomain?}: the link to install the virtual key on the car: "https://tesla.com/_ak/<domain>".
- checkFleetStatus {vin? or vins?}, getFleetTelemetryConfig {vin? or vins?}, configureFleetTelemetry {vin? or vins?},
  deleteFleetTelemetryConfig {vin? or vins?}: Fleet Telemetry of the cars (default all): {ok, result} or {ok: false,
  error}. calcFleetCost {...settings}: {text: html} cost estimate. All for the settings, not for agents.

States (tesla-motors.0.<VIN>.remote.*; write with ack false; a sleeping car is woken first, the values are read
again 5 s later; newer cars need the virtual key of the adapter installed; a failure is only logged):
- true triggers: wake_up, force_update (reads all values now), honk_horn, flash_lights, door_lock, door_unlock,
  remote_start_drive (allows driving without key), actuate_trunk-rear, actuate_trunk-front, window_control-vent,
  window_control-close, sun_roof_control-vent, sun_roof_control-close, charge_port_door_open, charge_port_door_close,
  charge_start, charge_stop, charge_standard, charge_max_range, auto_conditioning_start, auto_conditioning_stop,
  trigger_homelink (garage door), media_toggle_playback, media_next_track, media_prev_track, media_volume_up,
  media_volume_down.
- true / false (on / off): set_sentry_mode, set_bioweapon_mode, set_preconditioning_max,
  remote_steering_wheel_heater_request, remote_auto_seat_climate_request-0 (front left) and -1 (front right).
- numbers: set_charge_limit (%), set_charging_amps-charging_amps (A), set_temps-driver_temp and
  set_temps-passenger_temp (°C), remote_seat_heater_request-0 to -5 (seat 0 driver, 1 passenger, 2 rear left,
  4 rear center, 5 rear right; level 0-3), schedule_software_update-offset_sec (installs the waiting software
  update in that many seconds).
- JSON: set_scheduled_charging {"time": minutes after midnight (steps of 15), "enable": true},
  set_scheduled_departure {"departure_time", "enable", "preconditioning_enabled", "off_peak_charging_enabled",
  "end_off_peak_time", ...} (see its current value). share: a text (address) for the navigation; not with signing.
- Seat climate and steering wheel heater need the climate on (auto_conditioning_start). There is no state for the
  valet mode.
Energy products (tesla-motors.0.<id>.remote.*): backup-backup_reserve_percent (%), operation-self_consumption and
operation-backup (true), off_grid_vehicle_charging_reserve-off_grid_vehicle_charging_reserve_percent (%).

How to talk to the user:
- Name the car by its name (the device name), not by VIN; if there are several, ask which one.
- lock {locked: false} unlocks the car: only on the user's explicit request for exactly this, after confirmation.
  Locking is fine at any time on request.
- door_unlock, remote_start_drive, actuate_trunk-rear, actuate_trunk-front, set_sentry_mode (false switches the
  protection off), window_control-vent, sun_roof_control-vent, trigger_homelink and
  schedule_software_update-offset_sec only on the user's explicit request for exactly this, never as a side effect;
  repeat what will happen before writing.
- Every other remote state and standard command changes the car (honk, lights, charging, climate): only on the
  user's request.
- Give the battery in %, temperatures in °C, times in local time. Reading the values does not wake the car; writing
  a remote state or a standard write command does (refresh only with wake: true).
- generateKeyPair replaces the key in the settings: never call it for the user.`;

module.exports = { HELP, COMMANDS };
