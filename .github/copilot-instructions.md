# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.2
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context
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


## Tesla API Integration Patterns

### Authentication Flow
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

### Vehicle State Management
```javascript
// Pattern for managing vehicle states with proper error handling
async updateVehicleData(vehicleId) {
    try {
        // Wake up vehicle if needed
        if (this.config.wakeup) {
            await this.wakeUpVehicle(vehicleId);
        }
        
        // Fetch different data types based on availability
        const [vehicleData, driveState, chargeState, climateState] = await Promise.allSettled([
            this.getVehicleData(vehicleId),
            this.getVehicleDriveState(vehicleId),
            this.getVehicleChargeState(vehicleId),
            this.getVehicleClimateState(vehicleId)
        ]);
        
        // Process each result, handling failures gracefully
        this.processVehicleDataResults(vehicleId, { vehicleData, driveState, chargeState, climateState });
    } catch (error) {
        this.log.error(`Failed to update vehicle ${vehicleId}: ${error.message}`);
    }
}
```

### WebSocket Connection Management
```javascript
// Pattern for WebSocket streaming data
initializeWebSocket(vehicleId) {
    const ws = new WebSocket(`wss://streaming.vn.teslamotors.com/streaming/`);
    
    ws.on('open', () => {
        this.log.info(`WebSocket connected for vehicle ${vehicleId}`);
        // Send authentication and subscribe to data streams
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


## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
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

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
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
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Get all states created by adapter
                        const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
                        
                        console.log(`📊 Found ${stateIds.length} states`);

                        if (stateIds.length > 0) {
                            console.log('✅ Adapter successfully created states');
                            
                            // Show sample of created states
                            const allStates = await new Promise((res, rej) => {
                                harness.states.getStates(stateIds, (err, states) => {
                                    if (err) return rej(err);
                                    res(states || []);
                                });
                            });
                            
                            console.log('📋 Sample states created:');
                            stateIds.slice(0, 5).forEach((stateId, index) => {
                                const state = allStates[index];
                                console.log(`   ${stateId}: ${state && state.val !== undefined ? state.val : 'undefined'}`);
                            });
                            
                            await harness.stopAdapter();
                            resolve(true);
                        } else {
                            console.log('❌ No states were created by the adapter');
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

#### Testing Both Success AND Failure Scenarios

**IMPORTANT**: For every "it works" test, implement corresponding "it doesn't work and fails" tests. This ensures proper error handling and validates that your adapter fails gracefully when expected.

```javascript
// Example: Testing successful configuration
it('should configure and start adapter with valid configuration', function () {
    return new Promise(async (resolve, reject) => {
        // ... successful configuration test as shown above
    });
}).timeout(40000);

// Example: Testing failure scenarios
it('should NOT create daily states when daily is disabled', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();
            
            console.log('🔍 Step 1: Fetching adapter object...');
            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });
            
            if (!obj) return reject(new Error('Adapter object not found'));
            console.log('✅ Step 1.5: Adapter object loaded');

            console.log('🔍 Step 2: Updating adapter config...');
            Object.assign(obj.native, {
                position: TEST_COORDINATES,
                createCurrently: false,
                createHourly: true,
                createDaily: false, // Daily disabled for this test
            });

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    console.log('✅ Step 2.5: Adapter object updated');
                    res(undefined);
                });
            });

            console.log('🔍 Step 3: Starting adapter...');
            await harness.startAdapterAndWait();
            console.log('✅ Step 4: Adapter started');

            console.log('⏳ Step 5: Waiting 20 seconds for states...');
            await new Promise((res) => setTimeout(res, 20000));

            console.log('🔍 Step 6: Fetching state IDs...');
            const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');

            console.log(`📊 Step 7: Found ${stateIds.length} total states`);

            const hourlyStates = stateIds.filter((key) => key.includes('hourly'));
            if (hourlyStates.length > 0) {
                console.log(`✅ Step 8: Correctly ${hourlyStates.length} hourly weather states created`);
            } else {
                console.log('❌ Step 8: No hourly states created (test failed)');
                return reject(new Error('Expected hourly states but found none'));
            }

            // Check daily states should NOT be present
            const dailyStates = stateIds.filter((key) => key.includes('daily'));
            if (dailyStates.length === 0) {
                console.log(`✅ Step 9: No daily states found as expected`);
            } else {
                console.log(`❌ Step 9: Daily states present (${dailyStates.length}) (test failed)`);
                return reject(new Error('Expected no daily states but found some'));
            }

            await harness.stopAdapter();
            console.log('🛑 Step 10: Adapter stopped');

            resolve(true);
        } catch (error) {
            reject(error);
        }
    });
}).timeout(40000);

// Example: Testing missing required configuration  
it('should handle missing required configuration properly', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();
            
            console.log('🔍 Step 1: Fetching adapter object...');
            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });
            
            if (!obj) return reject(new Error('Adapter object not found'));

            console.log('🔍 Step 2: Removing required configuration...');
            // Remove required configuration to test failure handling
            delete obj.native.position; // This should cause failure or graceful handling

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    res(undefined);
                });
            });

            console.log('🔍 Step 3: Starting adapter...');
            await harness.startAdapterAndWait();

            console.log('⏳ Step 4: Waiting for adapter to process...');
            await new Promise((res) => setTimeout(res, 10000));

            console.log('🔍 Step 5: Checking adapter behavior...');
            const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');

            // Check if adapter handled missing configuration gracefully
            if (stateIds.length === 0) {
                console.log('✅ Adapter properly handled missing configuration - no invalid states created');
                resolve(true);
            } else {
                // If states were created, check if they're in error state
                const connectionState = await new Promise((res, rej) => {
                    harness.states.getState('your-adapter.0.info.connection', (err, state) => {
                        if (err) return rej(err);
                        res(state);
                    });
                });
                
                if (!connectionState || connectionState.val === false) {
                    console.log('✅ Adapter properly failed with missing configuration');
                    resolve(true);
                } else {
                    console.log('❌ Adapter should have failed or handled missing config gracefully');
                    reject(new Error('Adapter should have handled missing configuration'));
                }
            }

            await harness.stopAdapter();
        } catch (error) {
            console.log('✅ Adapter correctly threw error with missing configuration:', error.message);
            resolve(true);
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
    // Configure and start adapter first...
    harness.objects.getObject('system.adapter.tagesschau.0', async (err, obj) => {
        if (err) {
            console.error('Error getting adapter object:', err);
            reject(err);
            return;
        }

        // Configure adapter as needed
        obj.native.someConfig = 'test-value';
        harness.objects.setObject(obj._id, obj);

        await harness.startAdapterAndWait();

        // Wait for adapter to create states
        setTimeout(() => {
            // Access bulk states using pattern matching
            harness.dbConnection.getStateIDs('tagesschau.0.*').then(stateIds => {
                if (stateIds && stateIds.length > 0) {
                    harness.states.getStates(stateIds, (err, allStates) => {
                        if (err) {
                            console.error('❌ Error getting states:', err);
                            reject(err); // Properly fail the test instead of just resolving
                            return;
                        }

                        // Verify states were created and have expected values
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
        }, 20000); // Allow more time for multiple state creation
    });
})).timeout(45000);
```

#### Key Integration Testing Rules

1. **NEVER test API URLs directly** - Let the adapter handle API calls
2. **ALWAYS use the harness** - `getHarness()` provides the testing environment  
3. **Configure via objects** - Use `harness.objects.setObject()` to set adapter configuration
4. **Start properly** - Use `harness.startAdapterAndWait()` to start the adapter
5. **Check states** - Use `harness.states.getState()` to verify results
6. **Use timeouts** - Allow time for async operations with appropriate timeouts
7. **Test real workflow** - Initialize → Configure → Start → Verify States

#### Workflow Dependencies
Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-latest
  steps:
    - name: Run integration tests
      run: npx mocha test/integration-*.js --exit
```

#### What NOT to Do
❌ Direct API testing: `axios.get('https://api.example.com')`
❌ Mock adapters: `new MockAdapter()`  
❌ Direct internet calls in tests
❌ Bypassing the harness system

#### What TO Do
✅ Use `@iobroker/testing` framework
✅ Configure via `harness.objects.setObject()`
✅ Start via `harness.startAdapterAndWait()`
✅ Test complete adapter lifecycle
✅ Verify states via `harness.states.getState()`
✅ Allow proper timeouts for async operations

### API Testing with Credentials
For adapters that connect to external APIs requiring authentication, implement comprehensive credential testing:

#### Password Encryption for Integration Tests
When creating integration tests that need encrypted passwords (like those marked as `encryptedNative` in io-package.json):

1. **Read system secret**: Use `harness.objects.getObjectAsync("system.config")` to get `obj.native.secret`
2. **Apply XOR encryption**: Implement the encryption algorithm:
   ```javascript
   async function encryptPassword(harness, password) {
       const systemConfig = await harness.objects.getObjectAsync("system.config");
       if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
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
3. **Store encrypted password**: Set the encrypted result in adapter config, not the plain text
4. **Result**: Adapter will properly decrypt and use credentials, enabling full API connectivity testing

#### Demo Credentials Testing Pattern
- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file (e.g., `test/integration-demo.js`) for credential-based tests
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria with recognizable log messages
- Expected success pattern: Look for specific adapter initialization messages
- Test should fail clearly with actionable error messages for debugging

#### Enhanced Test Failure Handling
```javascript
it("Should connect to API with demo credentials", async () => {
    // ... setup and encryption logic ...
    
    const connectionState = await harness.states.getStateAsync("adapter.0.info.connection");
    
    if (connectionState && connectionState.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
            "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
    }
}).timeout(120000); // Extended timeout for API calls
```

## README Updates

### Required Sections
When updating README.md files, ensure these sections are present and well-documented:

1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history and changes (use "## **WORK IN PROGRESS**" section for ongoing changes following AlCalzone release-script standard)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, and community support

### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (at minimum English and German)
- When creating PRs, add entries to README under "## **WORK IN PROGRESS**" section following ioBroker release script standard
- Always reference related issues in commits and PR descriptions (e.g., "solves #xx" or "fixes #xx")

### Mandatory README Updates for PRs
For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `## **WORK IN PROGRESS**` section before committing
- Use format: `* (author) **TYPE**: Description of user-visible change`
- Types: **NEW** (features), **FIXED** (bugs), **ENHANCED** (improvements), **TESTING** (test additions), **CI/CD** (automation)
- Focus on user impact, not technical implementation details
- Example: `* (DutchmanNL) **FIXED**: Adapter now properly validates login credentials instead of always showing "credentials missing"`

### Documentation Workflow Standards
- **Mandatory README updates**: Establish requirement to update README.md for every PR/feature
- **Standardized documentation**: Create consistent format and categories for changelog entries
- **Enhanced development workflow**: Integrate documentation requirements into standard development process

### Changelog Management with AlCalzone Release-Script
Follow the [AlCalzone release-script](https://github.com/AlCalzone/release-script) standard for changelog management:

#### Format Requirements
- Always use `## **WORK IN PROGRESS**` as the placeholder for new changes
- Add all PR/commit changes under this section until ready for release
- Never modify version numbers manually - only when merging to main branch
- Maintain this format in README.md or CHANGELOG.md:

```markdown
# Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ## **WORK IN PROGRESS**
-->

## **WORK IN PROGRESS**

-   Did some changes
-   Did some more changes

## v0.1.0 (2023-01-01)
Initial release
```

#### Workflow Process
- **During Development**: All changes go under `## **WORK IN PROGRESS**`
- **For Every PR**: Add user-facing changes to the WORK IN PROGRESS section
- **Before Merge**: Version number and date are only added when merging to main
- **Release Process**: The release-script automatically converts the placeholder to the actual version

#### Change Entry Format
Use this consistent format for changelog entries:
- `- (author) **TYPE**: User-friendly description of the change`
- Types: **NEW** (features), **FIXED** (bugs), **ENHANCED** (improvements)
- Focus on user impact, not technical implementation details
- Reference related issues: "fixes #XX" or "solves #XX"

#### Example Entry
```markdown
## **WORK IN PROGRESS**

- (DutchmanNL) **FIXED**: Adapter now properly validates login credentials instead of always showing "credentials missing" (fixes #25)
- (DutchmanNL) **NEW**: Added support for device discovery to simplify initial setup
```

## Dependency Updates

### Package Management
- Always use `npm` for dependency management in ioBroker adapters
- When working on new features in a repository with an existing package-lock.json file, use `npm ci` to install dependencies. Use `npm install` only when adding or updating dependencies.
- Keep dependencies minimal and focused
- Only update dependencies to latest stable versions when necessary or in separate Pull Requests. Avoid updating dependencies when adding features that don't require these updates.
- When you modify `package.json`:
  1. Run `npm install` to update and sync `package-lock.json`.
  2. If `package-lock.json` was updated, commit both `package.json` and `package-lock.json`.

### Dependency Best Practices
- Prefer built-in Node.js modules when possible
- Use `@iobroker/adapter-core` for adapter base functionality
- Avoid deprecated packages
- Document any specific version requirements

## JSON-Config Admin Instructions

### Configuration Schema
When creating admin configuration interfaces:

- Use JSON-Config format for modern ioBroker admin interfaces
- Provide clear labels and help text for all configuration options
- Include input validation and error messages
- Group related settings logically
- Example structure:
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

### Admin Interface Guidelines
- Use consistent naming conventions
- Provide sensible default values
- Include validation for required fields
- Add tooltips for complex configuration options
- Ensure translations are available for all supported languages (minimum English and German)
- Write end-user friendly labels and descriptions, avoiding technical jargon where possible

## Best Practices for Dependencies

### HTTP Client Libraries
- **Preferred:** Use native `fetch` API (Node.js 20+ required for adapters; built-in since Node.js 18)
- **Avoid:** `axios` unless specific features are required (reduces bundle size)

### Example with fetch:
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

### Other Dependency Recommendations
- **Logging:** Use adapter built-in logging (`this.log.*`)
- **Scheduling:** Use adapter built-in timers and intervals
- **File operations:** Use Node.js `fs/promises` for async file operations
- **Configuration:** Use adapter config system rather than external config libraries

## Error Handling Patterns

### Tesla API Rate Limiting
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

### Vehicle Unavailable Handling
```javascript
async safeVehicleCommand(vehicleId, command, ...args) {
    try {
        // Check if vehicle is online
        const vehicle = await this.getVehicleStatus(vehicleId);
        if (vehicle.state !== 'online') {
            if (this.config.wakeup) {
                await this.wakeUpVehicle(vehicleId);
                await this.delay(15000); // Wait for wake up
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


## Configuration Management (JSON-Config)

### admin/jsonConfig.json Structure
ioBroker adapters use JSON-Config for modern admin interfaces:

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

### Configuration Validation
```javascript
// Validate and sanitize configuration
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


## State Management

### Creating Tesla-specific States
```javascript
// Tesla state creation patterns
async createVehicleStates(vehicleId, vinNumber) {
    const vehiclePrefix = `${vehicleId}`;
    
    // Vehicle information states
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
    
    // Battery state
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
    
    // Remote command states
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

### Handling Large JSON Objects
```javascript
// Use json2iob for complex Tesla data structures
async processVehicleData(vehicleId, data) {
    const json2iob = require('./lib/json2iob');
    
    // Convert complex JSON to ioBroker objects
    await json2iob.json2iob(
        this,
        `${vehicleId}`,
        data,
        {
            forceIndex: true,
            channelName: 'Tesla Vehicle Data'
        }
    );
    
    // Set specific important states directly
    if (data.charge_state) {
        await this.setStateAsync(`${vehicleId}.charge_state.battery_level`, {
            val: data.charge_state.battery_level,
            ack: true
        });
    }
}
```


## WebSocket and Real-time Data

### Streaming Connection Management  
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
                // Send authentication message
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


## Adapter Lifecycle Management

### Proper Initialization
```javascript
async onReady() {
    // Validate configuration
    if (!this.validateConfig()) {
        return;
    }
    
    // Initialize request client with Tesla-specific settings
    this.requestClient = axios.create({
        timeout: 30000,
        headers: {
            'User-Agent': 'TeslaMobile/3.10.9-433/adff2e065/android/10'
        }
    });
    
    // Set up authentication and start main process
    if (this.config.codeUrl) {
        await this.authenticateWithTesla();
        await this.discoverVehicles();
        this.startPeriodicUpdate();
    }
    
    // Set connection status
    this.setState('info.connection', { val: true, ack: true });
}
```

### Clean Shutdown
```javascript
async unload(callback) {
    try {
        // Clear all intervals
        if (this.updateInterval) {
            this.clearInterval(this.updateInterval);
        }
        
        if (this.locationInterval) {
            this.clearInterval(this.locationInterval);
        }
        
        // Close WebSocket connections
        if (this.streamingManager) {
            this.streamingManager.closeAllConnections();
        }
        
        // Close HTTP client
        if (this.requestClient) {
            // Axios doesn't need explicit closing, but cancel pending requests
            this.cancelPendingRequests();
        }
        
        this.setState('info.connection', { val: false, ack: true });
        callback();
    } catch (e) {
        callback();
    }
}
```


## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
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

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

