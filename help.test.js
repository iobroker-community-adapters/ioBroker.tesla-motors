'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const { HELP, COMMANDS } = require('./lib/help');
const { FLEET_TELEMETRY_ADMIN_COMMANDS } = require('./lib/fleetTelemetryConfig');

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

/** The commands of onMessage in main.js and the Fleet Telemetry commands it hands over */
function handledCommands() {
  const start = main.indexOf('  async onMessage(obj) {');
  const end = main.indexOf('\n  }\n', start);
  expect(start).to.be.greaterThan(0);
  const commands = [...main.slice(start, end).matchAll(/obj\.command === '([^']+)'/g)].map((m) => m[1]);
  return [...commands, ...FLEET_TELEMETRY_ADMIN_COMMANDS];
}

/** The remote states created for vehicles and energy products */
function remoteStates() {
  const start = main.indexOf('let remoteArray = [');
  const end = main.indexOf('remoteArray.forEach(', start);
  expect(start).to.be.greaterThan(0);
  return [...main.slice(start, end).matchAll(/command: '([^']+)'/g)].map((m) => m[1]);
}

describe('help', () => {
  it('lists exactly the commands the instance answers, each once', () => {
    const listed = COMMANDS.map((c) => c.command);
    expect(new Set(listed).size).to.equal(listed.length);
    expect([...listed].sort()).to.deep.equal([...new Set(handledCommands())].sort());
  });

  it('names every command and every remote state', () => {
    for (const { command } of COMMANDS.filter((c) => c.command !== 'help')) {
      expect(HELP).to.include(command);
    }
    const states = remoteStates();
    expect(states.length).to.be.greaterThan(40);
    for (const state of states) {
      // numbered states (seats) are named as a range: "remote_seat_heater_request-0 to -5"
      const name = state.replace(/-\d$/, '-0');
      expect(HELP).to.match(new RegExp(`(^|[^\\w-])${name}(?![\\w-])`, 'm'), state);
    }
  });

  it('keeps the lines short', () => {
    for (const line of HELP.split('\n')) {
      expect(line.length, line).to.be.at.most(120);
    }
  });
});
