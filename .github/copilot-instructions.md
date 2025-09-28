# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
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
                        
                        // Check that states were created
                        const states = await harness.states.getStatesAsync('your-adapter.0.*');
                        
                        if (Object.keys(states).length === 0) {
                            return reject(new Error('No states were created by the adapter'));
                        }
                        
                        console.log(`✅ Step 4: Found ${Object.keys(states).length} states created by adapter`);
                        
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            }).timeout(180000); // Increase timeout for API calls
        });
    }
});
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