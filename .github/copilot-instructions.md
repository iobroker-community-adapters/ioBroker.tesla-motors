# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.5.7  
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

---

## 📑 Table of Contents

1. [Project Context](#project-context)
2. [Code Quality & Standards](#code-quality--standards)
   - [Code Style Guidelines](#code-style-guidelines)
   - [ESLint Configuration](#eslint-configuration)
3. [Testing](#testing)
   - [Unit Testing](#unit-testing)
   - [Integration Testing](#integration-testing)
   - [API Testing with Credentials](#api-testing-with-credentials)
4. [Development Best Practices](#development-best-practices)
   - [Dependency Management](#dependency-management)
   - [HTTP Client Libraries](#http-client-libraries)
   - [Error Handling](#error-handling)
5. [Admin UI Configuration](#admin-ui-configuration)
   - [JSON-Config Setup](#json-config-setup)
   - [Translation Management](#translation-management)
6. [Documentation](#documentation)
   - [README Updates](#readme-updates)
   - [Changelog Management](#changelog-management)
7. [CI/CD & GitHub Actions](#cicd--github-actions)
   - [Workflow Configuration](#workflow-configuration)
   - [Testing Integration](#testing-integration)

---

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

### Adapter-Specific Context
- **Adapter Name**: iobroker.tesla-motors
- **Primary Function**: Tesla vehicle and energy system integration adapter for ioBroker
- **Repository**: iobroker-community-adapters/ioBroker.tesla-motors
- **API Integration**: Tesla API for vehicles, Powerwalls, energy history and charging data
- **Authentication**: Tesla OAuth2 authentication with session management
- **Key Features**: 
  - Vehicle state monitoring (location, battery, climate, charging)
  - Remote vehicle control (wake up, climate, charging, doors, etc.)
  - Powerwall energy monitoring and control
  - Real-time WebSocket data streaming
  - Energy history tracking and statistics
- **External Dependencies**: 
  - Tesla API (owner-api.teslamotors.com)
  - WebSocket connections for real-time data
  - JSON handling for complex nested Tesla data structures
- **Configuration Requirements**:
  - OAuth2 authentication flow with Tesla
  - Configurable polling intervals for different data types
  - Location fetching intervals
  - Device filtering options
  - Session state management

---

## Code Quality & Standards

### Code Style Guidelines

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

**Timer and Resource Cleanup Example:**
```javascript
private connectionTimer?: NodeJS.Timeout;

async onReady() {
  this.connectionTimer = setInterval(() => this.checkConnection(), 30000);
}

onUnload(callback) {
  try {
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    callback();
  } catch (e) {
    callback();
  }
}
```

### ESLint Configuration

**CRITICAL:** ESLint validation must run FIRST in your CI/CD pipeline, before any other tests. This "lint-first" approach catches code quality issues early.

#### Setup
```bash
npm install --save-dev eslint @iobroker/eslint-config
```

#### Configuration (.eslintrc.json)
```json
{
  "extends": "@iobroker/eslint-config",
  "rules": {
    // Add project-specific rule overrides here if needed
  }
}
```

#### Package.json Scripts
```json
{
  "scripts": {
    "lint": "eslint --max-warnings 0 .",
    "lint:fix": "eslint . --fix"
  }
}
```

#### Best Practices
1. ✅ Run ESLint before committing — fix ALL warnings, not just errors
2. ✅ Use `lint:fix` for auto-fixable issues
3. ✅ Don't disable rules without documentation
4. ✅ Lint all relevant files (main code, tests, build scripts)
5. ✅ Keep `@iobroker/eslint-config` up to date
6. ✅ **ESLint warnings are treated as errors in CI** (`--max-warnings 0`). The `lint` script above already includes this flag — run `npm run lint` to match CI behavior locally

#### Common Issues
- **Unused variables**: Remove or prefix with underscore (`_variable`)
- **Missing semicolons**: Run `npm run lint:fix`
- **Indentation**: Use 4 spaces (ioBroker standard)
- **console.log**: Replace with `adapter.log.debug()` or remove

---

## Testing

### Unit Testing

- Use Jest as the primary testing framework
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files

**Example Structure:**
```javascript
describe('AdapterName', () => {
  let adapter;
  
  beforeEach(() => {
    // Setup test adapter instance
  });
  
  test('should initialize correctly', () => {
    // Test adapter initialization
  });
});
```

### Integration Testing

**CRITICAL:** Use the official `@iobroker/testing` framework. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation:** https://github.com/ioBroker/testing

#### Framework Structure

**✅ Correct Pattern:**
```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        // Get adapter object
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) return reject(new Error('Adapter object not found'));

                        // Configure adapter
                        Object.assign(obj.native, {
                            position: '52.520008,13.404954',
                            createHourly: true,
                        });

                        harness.objects.setObject(obj._id, obj);
                        
                        // Start and wait
                        await harness.startAdapterAndWait();
                        await new Promise(resolve => setTimeout(resolve, 15000));

                        // Verify states
                        const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
                        
                        if (stateIds.length > 0) {
                            console.log('✅ Adapter successfully created states');
                            await harness.stopAdapter();
                            resolve(true);
                        } else {
                            reject(new Error('Adapter did not create any states'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }).timeout(40000);
        });
    }
});
```

#### Testing Success AND Failure Scenarios

**IMPORTANT:** For every "it works" test, implement corresponding "it fails gracefully" tests.

**Failure Scenario Example:**
```javascript
it('should NOT create daily states when daily is disabled', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();
            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });
            
            if (!obj) return reject(new Error('Adapter object not found'));

            Object.assign(obj.native, {
                createDaily: false, // Daily disabled
            });

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    res(undefined);
                });
            });

            await harness.startAdapterAndWait();
            await new Promise((res) => setTimeout(res, 20000));

            const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
            const dailyStates = stateIds.filter((key) => key.includes('daily'));
            
            if (dailyStates.length === 0) {
                console.log('✅ No daily states found as expected');
                resolve(true);
            } else {
                reject(new Error('Expected no daily states but found some'));
            }

            await harness.stopAdapter();
        } catch (error) {
            reject(error);
        }
    });
}).timeout(40000);
```

#### Advanced Integration Testing - Tesla API Patterns

For Tesla adapter specifically, integration tests should handle:

```javascript
// Tesla-specific integration test patterns
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Tesla API Integration Tests', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should handle Tesla authentication and vehicle discovery', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        // Configure adapter with test credentials (if available)
                        const obj = await harness.objects.getObjectAsync('system.adapter.tesla-motors.0');
                        if (!obj) {
                            return reject(new Error('Tesla adapter object not found'));
                        }

                        // Mock or use test credentials
                        Object.assign(obj.native, {
                            codeUrl: process.env.TEST_TESLA_CODE_URL || '',
                            interval: 5,
                            wakeup: false,
                            session: {}
                        });

                        await harness.objects.setObjectAsync(obj._id, obj);
                        
                        // Start adapter
                        await harness.startAdapterAndWait();
                        
                        // Wait for authentication and vehicle discovery
                        await new Promise(resolve => setTimeout(resolve, 30000));
                        
                        // Check that vehicle states were created
                        const states = await harness.states.getStatesAsync('tesla-motors.0.*');
                        const vehicleStates = Object.keys(states).filter(id => 
                            id.includes('vehicle') || id.includes('remote') || id.includes('info')
                        );
                        
                        if (vehicleStates.length === 0) {
                            console.log('ℹ️  No vehicles found - this may be expected for test environments');
                        } else {
                            console.log(`✅ Found ${vehicleStates.length} vehicle-related states`);
                        }
                        
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            }).timeout(180000);
        });
    }
});
```

#### Advanced State Access Patterns

For testing adapters that create multiple states, use bulk state access methods to efficiently verify large numbers of states:

```javascript
it('should create and verify multiple states', () => new Promise(async (resolve, reject) => {
    harness.objects.getObject('system.adapter.tagesschau.0', async (err, obj) => {
        if (err) {
            console.error('Error getting adapter object:', err);
            reject(err);
            return;
        }

        obj.native.someConfig = 'test-value';
        harness.objects.setObject(obj._id, obj);

        await harness.startAdapterAndWait();

        setTimeout(() => {
            harness.dbConnection.getStateIDs('tagesschau.0.*').then(stateIds => {
                if (stateIds && stateIds.length > 0) {
                    harness.states.getStates(stateIds, (err, allStates) => {
                        if (err) {
                            console.error('❌ Error getting states:', err);
                            reject(err);
                            return;
                        }

                        const expectedStates = ['tagesschau.0.info.connection', 'tagesschau.0.articles.0.title'];
                        let foundStates = 0;
                        
                        for (const stateId of expectedStates) {
                            if (allStates[stateId]) {
                                foundStates++;
                                console.log(`✅ Found expected state: ${stateId}`);
                            } else {
                                console.log(`❌ Missing expected state: ${stateId}`);
                            }
                        }

                        if (foundStates === expectedStates.length) {
                            console.log('✅ All expected states were created successfully');
                            resolve();
                        } else {
                            reject(new Error(`Only ${foundStates}/${expectedStates.length} expected states were found`));
                        }
                    });
                } else {
                    reject(new Error('No states found matching pattern tagesschau.0.*'));
                }
            }).catch(reject);
        }, 20000);
    });
})).timeout(45000);
```

#### Key Rules

1. ✅ Use `@iobroker/testing` framework
2. ✅ Configure via `harness.objects.setObject()`
3. ✅ Start via `harness.startAdapterAndWait()`
4. ✅ Verify states via `harness.states.getState()`
5. ✅ Allow proper timeouts for async operations
6. ❌ NEVER test API URLs directly
7. ❌ NEVER bypass the harness system

#### Workflow Dependencies

Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-22.04
```

### API Testing with Credentials

For adapters connecting to external APIs requiring authentication:

#### Password Encryption for Integration Tests

```javascript
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    if (!systemConfig?.native?.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    return result;
}
```

#### Demo Credentials Testing Pattern

- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file: `test/integration-demo.js`
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria

**Example Implementation:**
```javascript
it("Should connect to API with demo credentials", async () => {
    const encryptedPassword = await encryptPassword(harness, "demo_password");
    
    await harness.changeAdapterConfig("your-adapter", {
        native: {
            username: "demo@provider.com",
            password: encryptedPassword,
        }
    });

    await harness.startAdapter();
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
    
    if (connectionState?.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection. Check logs for API errors.");
    }
}).timeout(120000);
```

---

## Development Best Practices

### Dependency Management

- Always use `npm` for dependency management
- Use `npm ci` for installing existing dependencies (respects package-lock.json)
- Use `npm install` only when adding or updating dependencies
- Keep dependencies minimal and focused
- Only update dependencies in separate Pull Requests

**When modifying package.json:**
1. Run `npm install` to sync package-lock.json
2. Commit both package.json and package-lock.json together

**Best Practices:**
- Prefer built-in Node.js modules when possible
- Use `@iobroker/adapter-core` for adapter base functionality
- Avoid deprecated packages
- Document specific version requirements

### HTTP Client Libraries

- **Preferred:** Use native `fetch` API (Node.js 20+ required)
- **Avoid:** `axios` unless specific features are required

**Example with fetch:**
```javascript
try {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
} catch (error) {
  this.log.error(`API request failed: ${error.message}`);
}
```

**Other Recommendations:**
- **Logging:** Use adapter built-in logging (`this.log.*`)
- **Scheduling:** Use adapter built-in timers and intervals
- **File operations:** Use Node.js `fs/promises`
- **Configuration:** Use adapter config system

### Error Handling

- Always catch and log errors appropriately
- Use adapter log levels (error, warn, info, debug)
- Provide meaningful, user-friendly error messages
- Handle network failures gracefully
- Implement retry mechanisms where appropriate
- Always clean up timers, intervals, and resources in `unload()` method

**Generic Example:**
```javascript
try {
  await this.connectToDevice();
} catch (error) {
  this.log.error(`Failed to connect to device: ${error.message}`);
  this.setState('info.connection', false, true);
}
```

**Tesla API Rate Limiting:**
```javascript
async makeApiCall(url, options, retries = 3) {
    try {
        const response = await this.requestClient(Object.assign({ url }, options));
        return response.data;
    } catch (error) {
        if (error.response?.status === 429 && retries > 0) {
            const retryAfter = error.response.headers['retry-after'] || 60;
            this.log.warn(`Rate limited, waiting ${retryAfter}s before retry`);
            await this.delay(retryAfter * 1000);
            return this.makeApiCall(url, options, retries - 1);
        }
        throw error;
    }
}
```

**Vehicle Unavailable Handling:**
```javascript
async safeVehicleCommand(vehicleId, command, ...args) {
    try {
        const vehicle = await this.getVehicleStatus(vehicleId);
        if (vehicle.state !== 'online') {
            if (this.config.wakeup) {
                await this.wakeUpVehicle(vehicleId);
                await this.delay(15000);
            } else {
                throw new Error('Vehicle is not online and wake up is disabled');
            }
        }
        return await this[command](vehicleId, ...args);
    } catch (error) {
        this.log.error(`Failed to execute ${command} on vehicle ${vehicleId}: ${error.message}`);
        throw error;
    }
}
```

---

## Admin UI Configuration

### JSON-Config Setup

Use JSON-Config format for modern ioBroker admin interfaces.

**Basic Structure:**
```json
{
  "type": "panel",
  "items": {
    "host": {
      "type": "text",
      "label": "Host address",
      "help": "IP address or hostname of the device"
    }
  }
}
```

**Tesla-specific JSON-Config Example:**
```json
{
  "type": "panel",
  "items": {
    "tesla_auth": {
      "type": "panel",
      "label": "Tesla Authentication",
      "items": {
        "codeUrl": {
          "type": "text",
          "label": "Authorization Code URL",
          "help": "Paste the complete URL from Tesla auth callback"
        }
      }
    },
    "polling": {
      "type": "panel",
      "label": "Polling Settings",
      "items": {
        "interval": {
          "type": "number",
          "label": "Update Interval (minutes)",
          "min": 1,
          "max": 60,
          "default": 5
        }
      }
    }
  }
}
```

**Configuration Validation:**
```javascript
validateConfig() {
    if (!this.config.codeUrl) {
        this.log.error('Tesla authorization URL is required');
        return false;
    }
    
    this.config.interval = Math.max(1, Math.min(60, this.config.interval || 5));
    this.config.locationInterval = Math.max(10, this.config.locationInterval || 60);
    
    return true;
}
```

**Guidelines:**
- ✅ Use consistent naming conventions
- ✅ Provide sensible default values
- ✅ Include validation for required fields
- ✅ Add tooltips for complex options
- ✅ Ensure translations for all supported languages (minimum English and German)
- ✅ Write end-user friendly labels, avoid technical jargon

### Translation Management

**CRITICAL:** Translation files must stay synchronized with `admin/jsonConfig.json`. Orphaned keys or missing translations cause UI issues and PR review delays.

#### Overview
- **Location:** `admin/i18n/{lang}/translations.json` for 11 languages (de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn)
- **Source of truth:** `admin/jsonConfig.json` - all `label` and `help` properties must have translations
- **Command:** `npm run translate` - auto-generates translations but does NOT remove orphaned keys
- **Formatting:** English uses tabs, other languages use 4 spaces

#### Critical Rules
1. ✅ Keys must match exactly with jsonConfig.json
2. ✅ No orphaned keys in translation files
3. ✅ All translations must be in native language (no English fallbacks)
4. ✅ Keys must be sorted alphabetically

#### Workflow for Translation Updates

**When modifying admin/jsonConfig.json:**

1. Make your changes to labels/help texts
2. Run automatic translation: `npm run translate`
3. Create validation script (`scripts/validate-translations.js`):

```javascript
const fs = require('fs');
const path = require('path');
const jsonConfig = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));

function extractTexts(obj, texts = new Set()) {
    if (typeof obj === 'object' && obj !== null) {
        if (obj.label) texts.add(obj.label);
        if (obj.help) texts.add(obj.help);
        for (const key in obj) {
            extractTexts(obj[key], texts);
        }
    }
    return texts;
}

const requiredTexts = extractTexts(jsonConfig);
const languages = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
let hasErrors = false;

languages.forEach(lang => {
    const translationPath = path.join('admin', 'i18n', lang, 'translations.json');
    const translations = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
    const translationKeys = new Set(Object.keys(translations));
    
    const missing = Array.from(requiredTexts).filter(text => !translationKeys.has(text));
    const orphaned = Array.from(translationKeys).filter(key => !requiredTexts.has(key));
    
    console.log(`\n=== ${lang} ===`);
    if (missing.length > 0) {
        console.error('❌ Missing keys:', missing);
        hasErrors = true;
    }
    if (orphaned.length > 0) {
        console.error('❌ Orphaned keys (REMOVE THESE):', orphaned);
        hasErrors = true;
    }
    if (missing.length === 0 && orphaned.length === 0) {
        console.log('✅ All keys match!');
    }
});

process.exit(hasErrors ? 1 : 0);
```

4. Run validation: `node scripts/validate-translations.js`
5. Remove orphaned keys manually from all translation files
6. Add missing translations in native languages
7. Run: `npm run lint && npm run test`

#### Add Validation to package.json

```json
{
  "scripts": {
    "translate": "translate-adapter",
    "validate:translations": "node scripts/validate-translations.js",
    "pretest": "npm run lint && npm run validate:translations"
  }
}
```

#### Translation Checklist

Before committing changes to admin UI or translations:
1. ✅ Validation script shows "All keys match!" for all 11 languages
2. ✅ No orphaned keys in any translation file
3. ✅ All translations in native language
4. ✅ Keys alphabetically sorted
5. ✅ `npm run lint` passes
6. ✅ `npm run test` passes
7. ✅ Admin UI displays correctly

---

## Documentation

### README Updates

#### Required Sections
1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history (use "## **WORK IN PROGRESS**" for ongoing changes)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, community support

#### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (minimum English and German)
- Always reference issues in commits and PRs (e.g., "fixes #xx")

#### Mandatory README Updates for PRs

For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `## **WORK IN PROGRESS**` section
- Use format: `* (author) **TYPE**: Description of user-visible change`
- Types: **NEW** (features), **FIXED** (bugs), **ENHANCED** (improvements), **TESTING** (test additions), **CI/CD** (automation)
- Focus on user impact, not technical details

**Example:**
```markdown
## **WORK IN PROGRESS**

* (DutchmanNL) **FIXED**: Adapter now properly validates login credentials (fixes #25)
* (DutchmanNL) **NEW**: Added device discovery to simplify initial setup
```

### Changelog Management

Follow the [AlCalzone release-script](https://github.com/AlCalzone/release-script) standard.

#### Format Requirements

```markdown
# Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ## **WORK IN PROGRESS**
-->

## **WORK IN PROGRESS**

- (author) **NEW**: Added new feature X
- (author) **FIXED**: Fixed bug Y (fixes #25)

## v0.1.0 (2023-01-01)
Initial release
```

#### Workflow Process
- **During Development:** All changes go under `## **WORK IN PROGRESS**`
- **For Every PR:** Add user-facing changes to WORK IN PROGRESS section
- **Before Merge:** Version number and date added when merging to main
- **Release Process:** Release-script automatically converts placeholder to actual version

#### Change Entry Format
- Format: `- (author) **TYPE**: User-friendly description`
- Types: **NEW**, **FIXED**, **ENHANCED**
- Focus on user impact, not technical implementation
- Reference issues: "fixes #XX" or "solves #XX"

---

## CI/CD & GitHub Actions

### Workflow Configuration

#### GitHub Actions Best Practices

**Must use ioBroker official testing actions:**
- `ioBroker/testing-action-check@v1` for lint and package validation
- `ioBroker/testing-action-adapter@v1` for adapter tests
- `ioBroker/testing-action-deploy@v1` for automated releases with Trusted Publishing (OIDC)

**Configuration:**
- **Node.js versions:** Test on 20.x, 22.x, 24.x
- **Platform:** Use ubuntu-22.04
- **Automated releases:** Deploy to npm on version tags (requires NPM Trusted Publishing)
- **Monitoring:** Include Sentry release tracking for error monitoring

#### Critical: Lint-First Validation Workflow

**ALWAYS run ESLint checks BEFORE other tests.** Benefits:
- Catches code quality issues immediately
- Prevents wasting CI resources on tests that would fail due to linting errors
- Provides faster feedback to developers
- Enforces consistent code quality

**Workflow Dependency Configuration:**
```yaml
jobs:
  check-and-lint:
    # Runs ESLint and package validation
    # Uses: ioBroker/testing-action-check@v1
    
  adapter-tests:
    needs: [check-and-lint]  # Wait for linting to pass
    # Run adapter unit tests
    
  integration-tests:
    needs: [check-and-lint, adapter-tests]  # Wait for both
    # Run integration tests
```

**Key Points:**
- The `check-and-lint` job has NO dependencies - runs first
- ALL other test jobs MUST list `check-and-lint` in their `needs` array
- If linting fails, no other tests run, saving time
- Fix all ESLint errors before proceeding

### Testing Integration

#### API Testing in CI/CD

For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

#### Testing Best Practices
- Run credential tests separately from main test suite
- Don't make credential tests required for deployment
- Provide clear failure messages for API issues
- Use appropriate timeouts for external calls (120+ seconds)

#### Package.json Integration
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

---

## Tesla-Specific Patterns

### Tesla API Integration Patterns

#### Authentication Flow
```javascript
// Tesla OAuth2 authentication pattern
async loginToTesla(authCode) {
    const tokenResponse = await this.requestClient({
        method: 'POST',
        url: 'https://auth.tesla.com/oauth2/v3/token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: qs.stringify({
            grant_type: 'authorization_code',
            client_id: 'ownerapi',
            code: authCode,
            code_verifier: this.codeVerifier,
            redirect_uri: 'https://auth.tesla.com/void/callback'
        })
    });
}
```

#### Vehicle State Management
```javascript
// Pattern for managing vehicle states with proper error handling
async updateVehicleData(vehicleId) {
    try {
        if (this.config.wakeup) {
            await this.wakeUpVehicle(vehicleId);
        }
        
        const [vehicleData, driveState, chargeState, climateState] = await Promise.allSettled([
            this.getVehicleData(vehicleId),
            this.getVehicleDriveState(vehicleId),
            this.getVehicleChargeState(vehicleId),
            this.getVehicleClimateState(vehicleId)
        ]);
        
        this.processVehicleDataResults(vehicleId, { vehicleData, driveState, chargeState, climateState });
    } catch (error) {
        this.log.error(`Failed to update vehicle ${vehicleId}: ${error.message}`);
    }
}
```

#### WebSocket Connection Management
```javascript
// Pattern for WebSocket streaming data
initializeWebSocket(vehicleId) {
    const ws = new WebSocket(`wss://streaming.vn.teslamotors.com/streaming/`);
    
    ws.on('open', () => {
        this.log.info(`WebSocket connected for vehicle ${vehicleId}`);
    });
    
    ws.on('message', (data) => {
        this.processStreamingData(vehicleId, data);
    });
    
    ws.on('close', () => {
        this.log.warn(`WebSocket disconnected for vehicle ${vehicleId}`);
        // Implement reconnection logic
    });
}
```

### State Management

#### Creating Tesla-specific States
```javascript
async createVehicleStates(vehicleId, vinNumber) {
    const vehiclePrefix = `${vehicleId}`;
    
    await this.setObjectNotExistsAsync(`${vehiclePrefix}.display_name`, {
        type: 'state',
        common: {
            name: 'Vehicle Display Name',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        }
    });
    
    await this.setObjectNotExistsAsync(`${vehiclePrefix}.charge_state.battery_level`, {
        type: 'state',
        common: {
            name: 'Battery Level',
            type: 'number',
            role: 'value.battery',
            unit: '%',
            min: 0,
            max: 100,
            read: true,
            write: false
        }
    });
    
    await this.setObjectNotExistsAsync(`${vehiclePrefix}.remote.climate_start`, {
        type: 'state',
        common: {
            name: 'Start Climate Control',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true
        }
    });
}
```

#### Handling Large JSON Objects
```javascript
// Use json2iob for complex Tesla data structures
async processVehicleData(vehicleId, data) {
    const json2iob = require('./lib/json2iob');
    
    await json2iob.json2iob(
        this,
        `${vehicleId}`,
        data,
        {
            forceIndex: true,
            channelName: 'Tesla Vehicle Data'
        }
    );
    
    if (data.charge_state) {
        await this.setStateAsync(`${vehicleId}.charge_state.battery_level`, {
            val: data.charge_state.battery_level,
            ack: true
        });
    }
}
```

### WebSocket and Real-time Data

#### Streaming Connection Management
```javascript
class TeslaStreamingManager {
    constructor(adapter) {
        this.adapter = adapter;
        this.connections = new Map();
        this.reconnectAttempts = new Map();
    }
    
    async startStreaming(vehicleId, token) {
        try {
            const ws = new WebSocket('wss://streaming.vn.teslamotors.com/streaming/');
            
            ws.on('open', () => {
                const authMessage = {
                    msg_type: 'data:subscribe',
                    token: token,
                    tag: vehicleId,
                    value: 'speed,odometer,soc,elevation,est_heading,est_lat,est_lng,power,shift_state,range,est_range,heading'
                };
                ws.send(JSON.stringify(authMessage));
            });
            
            ws.on('message', (data) => {
                this.processStreamingMessage(vehicleId, data);
            });
            
            this.connections.set(vehicleId, ws);
        } catch (error) {
            this.adapter.log.error(`Failed to start streaming for vehicle ${vehicleId}: ${error.message}`);
        }
    }
    
    processStreamingMessage(vehicleId, message) {
        try {
            const data = JSON.parse(message);
            if (data.msg_type === 'data:update') {
                this.updateVehicleStreamingData(vehicleId, data.value);
            }
        } catch (error) {
            this.adapter.log.debug(`Failed to parse streaming message: ${error.message}`);
        }
    }
}
```

### Adapter Lifecycle Management

#### Proper Initialization
```javascript
async onReady() {
    if (!this.validateConfig()) {
        return;
    }
    
    this.requestClient = axios.create({
        timeout: 30000,
        headers: {
            'User-Agent': 'TeslaMobile/3.10.9-433/adff2e065/android/10'
        }
    });
    
    if (this.config.codeUrl) {
        await this.authenticateWithTesla();
        await this.discoverVehicles();
        this.startPeriodicUpdate();
    }
    
    this.setState('info.connection', { val: true, ack: true });
}
```

#### Clean Shutdown
```javascript
async unload(callback) {
    try {
        if (this.updateInterval) {
            this.clearInterval(this.updateInterval);
        }
        
        if (this.locationInterval) {
            this.clearInterval(this.locationInterval);
        }
        
        if (this.streamingManager) {
            this.streamingManager.closeAllConnections();
        }
        
        if (this.requestClient) {
            this.cancelPendingRequests();
        }
        
        this.setState('info.connection', { val: false, ack: true });
        callback();
    } catch (e) {
        callback();
    }
}
```
