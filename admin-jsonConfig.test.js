'use strict';

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

function collectTranslationKeys(node, keys = new Set()) {
  if (!node || typeof node !== 'object') {
    return keys;
  }

  if (Array.isArray(node)) {
    return keys;
  }

  for (const [key, value] of Object.entries(node)) {
    if ((key === 'label' || key === 'text' || key === 'help' || key === 'tooltip') && typeof value === 'string') {
      keys.add(value);
      continue;
    }

    if (key !== 'options') {
      collectTranslationKeys(value, keys);
    }
  }

  return keys;
}

describe('admin jsonConfig migration', () => {
  const rootDir = __dirname;
  const ioPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'io-package.json'), 'utf8'));
  const jsonConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'admin', 'jsonConfig.json'), 'utf8'));

  it('uses json admin config and keeps existing native keys', () => {
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
    ];

    for (const field of expectedFields) {
      expect(jsonConfig.items).to.have.property(field);
      expect(ioPackage.native).to.have.property(field);
    }
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
