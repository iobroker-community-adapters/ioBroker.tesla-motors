![Logo](admin/tesla-motors.png)

# ioBroker.tesla-motors

[![NPM version](https://img.shields.io/npm/v/iobroker.tesla-motors.svg)](https://www.npmjs.com/package/iobroker.tesla-motors)
[![Downloads](https://img.shields.io/npm/dm/iobroker.tesla-motors.svg)](https://www.npmjs.com/package/iobroker.tesla-motors)
![Number of Installations (latest)](https://iobroker.live/badges/tesla-motors-installed.svg)
![Number of Installations (stable)](https://iobroker.live/badges/tesla-motors-stable.svg)
[![Dependency Status](https://img.shields.io/david/iobroker-community-adapters/iobroker.tesla-motors.svg)](https://david-dm.org/iobroker-community-adapters/iobroker.tesla-motors)

[![NPM](https://nodei.co/npm/iobroker.tesla-motors.png?downloads=true)](https://nodei.co/npm/iobroker.tesla-motors/)

**Tests:** ![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.tesla-motors/workflows/Test%20and%20Release/badge.svg)

## Tesla adapter for ioBroker

All Tesla vehicles and Powerwalls from the Tesla App are displayed and updated via the official **Tesla Fleet API**.

Vehicle commands (lock, unlock, climate, charging, etc.) are supported for all models including post-2021 vehicles that require **end-to-end command signing** (Vehicle Command Protocol).

### Requirements

- Tesla account with vehicles or energy products
- Node.js >= 20
- A registered Tesla Fleet API application (Client ID + Client Secret) from [developer.tesla.com](https://developer.tesla.com)
- A Fleet Key domain (for virtual key installation on the vehicle)

### Setup (Step by Step)

The adapter admin UI guides you through 5 steps:

#### Step 1: Generate Key Pair

Click **Generate Key Pair** in the adapter settings. This creates an ECDSA P-256 key pair used for signing vehicle commands. The keys are stored in the adapter configuration.

#### Step 2: Fleet API Credentials

Enter your **Client ID** and **Client Secret** from your Tesla Developer application. Select the correct **Region** (EU, NA, or CN) - this is auto-detected from the JWT token after login.

#### Step 3: Fleet Key Domain

Enter your **Fleet Key Domain** (e.g. `abc123.fleetkey.net`). This domain must host your public key so Tesla can verify your application. The adapter shows a link and QR code for installing the virtual key on your vehicle.

#### Step 4: Tesla Login (OAuth2)

Click **Login with Tesla** to authenticate via OAuth2. You will be redirected to `auth.tesla.com`. After login, copy the callback URL and paste it into the adapter settings.

Required scopes: `openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds energy_device_data energy_cmds`

#### Step 5: Virtual Key Installation

Open the virtual key URL (`https://tesla.com/_ak/<your-domain>`) on your phone while near your vehicle. Confirm the key on the vehicle's touchscreen. This is required for signed vehicle commands on post-2021 models.

### Remote Commands

Remote commands are available under `tesla-motors.0.<VIN>.remote`.

Supported commands include:

- **Lock/Unlock**: `door_lock`, `door_unlock`
- **Climate**: `auto_conditioning_start`, `auto_conditioning_stop`, `set_temps`, `set_preconditioning_max`, `remote_seat_heater_request`, `remote_steering_wheel_heater_request`
- **Charging**: `charge_start`, `charge_stop`, `set_charge_limit`, `set_charging_amps`, `charge_port_door_open`, `charge_port_door_close`, `set_scheduled_charging`
- **Trunk**: `actuate_trunk` (front/rear)
- **Windows**: `window_control` (vent/close)
- **Security**: `set_sentry_mode`, `remote_start_drive`
- **Media**: `media_toggle_playback`, `media_next_track`, `media_prev_track`
- **Other**: `flash_lights`, `honk_horn`, `trigger_homelink`, `schedule_software_update`

### Field Description

- df: driver front
- dr: driver rear
- pf: passenger front
- pr: passenger rear
- ft: front trunk
- rt: rear trunk

### Technical Details

- **Fleet API**: Regional endpoints (EU/NA/CN) with automatic region detection from JWT token
- **Command Signing**: ECDSA P-256 + HMAC-SHA256 via protobuf (Vehicle Command Protocol)
- **Two Domains**: DOMAIN_INFOTAINMENT (climate, charging, media) and DOMAIN_VEHICLE_SECURITY (lock, unlock, trunk)
- **Session Management**: ECDH handshake per domain, epoch + counter based, stored in ioBroker state
- **Token Refresh**: Automatic refresh before expiry

### Questions and Discussions

<https://forum.iobroker.net/topic/47203/test-tesla-motors-v1-0-0>

<!--
  Placeholder for the next version (at the beginning of the line):
  ### **WORK IN PROGRESS**
-->

## Changelog

### **WORK IN PROGRESS**

- (TA2k) Migrate to Tesla Fleet API with OAuth2
- (TA2k) Add Vehicle Command Protocol signing (ECDSA P-256) for post-2021 vehicles
- (TA2k) Add admin UI for Fleet API setup (key generation, credentials, virtual key)
- (TA2k) Add regional endpoint detection (EU/NA/CN) from JWT token
- (TA2k) Store session in ioBroker state to avoid restart loops
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires admin >= 7.6.17 now

### 1.5.0 (2025-12-28)

- (mcm1957) Adapter requires node.js >= 20, js-controller >= 6.0.11 and admin >= 6.17.14 now.
- (TA2k) powerwall backup history has been fixed
- (TA2k) Dependencies have been updated.

### 1.4.5 (2024-04-19)

- cleaned up token folder to reduce state objects

### 1.4.4 (2024-04-10)

- improve energy history data

### 1.4.3 (2024-04-10)

- fix for too many state in the powerwall energy history

### 1.4.2 (2023-11-17)

- fix km states are not refreshed

### 1.4.1 (2023-11-17)

- fix \_km states are not refreshed

### 1.4.0 (2023-11-14)

- fix location fetching and add new option to change location fetching interval

### 1.3.5 (2023-10-24)

- fix vehicle update

### 1.3.4 (2023-10-24)

- add wall_connector devices

### 1.3.4-alpha.0 (2023-10-18)

- (mcm1957) Standard iobroker release environment has been added.
- (mcm1957) Some dependencies have been updated.

### 1.3.2

- Create history elements by index not by date

### 1.3.1

- login url and ordered car fix

### 1.0.2

- (iobroker-community-adapters) ALL DATA POINTS ARE NEW, Vis must be adapted. New version with new states for Tesla and Powerwalls.

## License

MIT License

Copyright (c) 2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2021-2025 iobroker-community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
