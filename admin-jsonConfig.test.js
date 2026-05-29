'use strict';

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

/**
 * Collects translation keys referenced by jsonConfig string properties.
 *
 * @param {unknown} node Current jsonConfig node to inspect.
 * @param {Set<string>} [keys] Accumulator for discovered translation keys.
 * @returns {Set<string>} The collected translation keys.
 */
function collectTranslationKeys(node, keys = new Set()) {
  if (!node || typeof node !== 'object') {
    return keys;
  }

  if (Array.isArray(node)) {
    return keys;
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      (key === 'label' || key === 'text' || key === 'help' || key === 'tooltip' || key === 'title') &&
      typeof value === 'string' &&
      !/^https?:\/\//.test(value)
    ) {
      keys.add(value);
      continue;
    }

    // Select option labels are defined inline and not expected in the adapter i18n files.
    if (key !== 'options') {
      collectTranslationKeys(value, keys);
    }
  }

  return keys;
}

/**
 * Finds an item by name in a nested jsonConfig tree.
 *
 * @param {Record<string, any>} config jsonConfig tree or sub tree.
 * @param {string} name Item/native attribute name to search.
 * @returns {Record<string, any> | undefined}
 */
function findJsonConfigItem(config, name) {
  if (!config || typeof config !== 'object') {
    return undefined;
  }

  if (config.items && typeof config.items === 'object' && !Array.isArray(config.items)) {
    if (config.items[name]) {
      return config.items[name];
    }

    for (const child of Object.values(config.items)) {
      const item = findJsonConfigItem(child, name);
      if (item) {
        return item;
      }
    }
  }

  return undefined;
}

/**
 * Collects all sendTo commands used by the jsonConfig.
 *
 * @param {Record<string, any>} config jsonConfig tree or sub tree.
 * @param {Set<string>} [commands] Accumulator for discovered commands.
 * @returns {Set<string>} The collected sendTo commands.
 */
function collectSendToCommands(config, commands = new Set()) {
  if (!config || typeof config !== 'object') {
    return commands;
  }

  if (config.type === 'sendTo' && config.command) {
    commands.add(config.command);
  }

  if (config.items && typeof config.items === 'object' && !Array.isArray(config.items)) {
    for (const child of Object.values(config.items)) {
      collectSendToCommands(child, commands);
    }
  }

  return commands;
}

describe('admin jsonConfig migration', () => {
  const rootDir = __dirname;
  const ioPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'io-package.json'), 'utf8'));
  const jsonConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'admin', 'jsonConfig.json'), 'utf8'));

  it('uses json admin config and keeps existing configurable native keys', () => {
    expect(ioPackage.common.adminUI).to.deep.equal({ config: 'json' });

    const expectedFields = [
      'clientId',
      'clientSecret',
      'publicKey',
      'privateKey',
      'fleetApiRegion',
      'fleetkeyDomain',
      'codeUrl',
      'intervalNormal',
      'locationInterval',
      'intervalDrive',
      'wakeup',
      'reset',
      'excludeDeviceList',
      'excludeElementList',
      'telemetryEnabled',
      'telemetryProxyUrl',
      'telemetryProxyAllowInsecure',
      'telemetryServerHost',
      'telemetryServerPort',
      'telemetryServerCaPem',
      'telemetryMqttBroker',
      'telemetryMqttUsername',
      'telemetryMqttPassword',
      'telemetryMqttTopicBase',
      'telemetryFields',
      'telemetryFieldsJson',
      'telemetryFallbackPollEnabled',
    ];

    for (const field of expectedFields) {
      expect(findJsonConfigItem(jsonConfig, field), `jsonConfig item ${field}`).to.exist;
      expect(ioPackage.native).to.have.property(field);
    }
  });

  it('keeps Fleet Telemetry admin actions available', () => {
    const commands = [...collectSendToCommands(jsonConfig)];

    expect(commands).to.include.members([
      'generateKeyPair',
      'checkFleetStatus',
      'configureFleetTelemetry',
      'getFleetTelemetryConfig',
      'deleteFleetTelemetryConfig',
    ]);
  });

  it('preserves Fleet Telemetry compatible polling semantics', () => {
    const intervalNormal = findJsonConfigItem(jsonConfig, 'intervalNormal');
    const telemetryFields = findJsonConfigItem(jsonConfig, 'telemetryFields');

    expect(intervalNormal).to.include({ type: 'number', min: 0 });
    expect(telemetryFields).to.include({ type: 'table', noDelete: true });
    expect(telemetryFields.default).to.be.an('array').that.is.not.empty;
    expect(telemetryFields.default.find((row) => row.field === 'Soc')).to.include({
      enabled: true,
      interval_seconds: 1,
      defaultMinimumDelta: '1 %',
    });
    expect(telemetryFields.default.find((row) => row.field === 'Location')).to.include({
      enabled: true,
      interval_seconds: 10,
      defaultMinimumDelta: '100 m',
    });

    const telemetryFieldsJson = findJsonConfigItem(jsonConfig, 'telemetryFieldsJson');
    expect(telemetryFieldsJson).to.include({ type: 'jsonEditor', expertMode: true });
  });

  it('keeps translations available for all jsonConfig texts', () => {
    const translationKeys = [...collectTranslationKeys(jsonConfig)].sort();
    const i18nDir = path.join(rootDir, 'admin', 'i18n');
    const languages = fs.readdirSync(i18nDir).filter(file => file.endsWith('.json'));

    expect(translationKeys.length).to.be.greaterThan(0);

    for (const language of languages) {
      const translations = JSON.parse(fs.readFileSync(path.join(i18nDir, language), 'utf8'));
      for (const key of translationKeys) {
        expect(translations, `${language} is missing "${key}"`).to.have.property(key);
      }
    }
  });
});
