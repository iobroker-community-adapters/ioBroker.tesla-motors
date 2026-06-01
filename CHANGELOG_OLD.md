# Older changes
## 2.0.2 (2026-04-17)

- (TA2k) Migrate to Tesla Fleet API with OAuth2
- (TA2k) Add Vehicle Command Protocol signing (ECDSA P-256) for post-2021 vehicles
- (TA2k) Add admin UI for Fleet API setup (key generation, credentials, virtual key)
- (TA2k) Add regional endpoint detection (EU/NA/CN) from JWT token
- (TA2k) Store session in ioBroker state to avoid restart loops
- (copilot) Adapter requires admin >= 7.7.22 now

## 1.5.0 (2025-12-28)

- (mcm1957) Adapter requires node.js >= 20, js-controller >= 6.0.11 and admin >= 6.17.14 now.
- (TA2k) powerwall backup history has been fixed
- (TA2k) Dependencies have been updated.

## 1.4.5 (2024-04-19)

- cleaned up token folder to reduce state objects

## 1.4.4 (2024-04-10)

- improve energy history data

## 1.4.3 (2024-04-10)

- fix for too many state in the powerwall energy history

## 1.4.2 (2023-11-17)

- fix km states are not refreshed

## 1.4.1 (2023-11-17)

- fix \_km states are not refreshed

## 1.4.0 (2023-11-14)

- fix location fetching and add new option to change location fetching interval

## 1.3.5 (2023-10-24)

- fix vehicle update

## 1.3.4 (2023-10-24)

- add wall_connector devices

## 1.3.4-alpha.0 (2023-10-18)

- (mcm1957) Standard iobroker release environment has been added.
- (mcm1957) Some dependencies have been updated.

## 1.3.2

- Create history elements by index not by date

## 1.3.1

- login url and ordered car fix

## 1.0.2

- (iobroker-community-adapters) ALL DATA POINTS ARE NEW, Vis must be adapted. New version with new states for Tesla and Powerwalls.
