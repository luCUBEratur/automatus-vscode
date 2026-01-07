import * as assert from 'assert';
import WebSocket from 'ws';

const vscode = require('../mocks/vscode-mock');
(global as any).vscode = vscode;

import { BridgeServer } from '../../bridge/BridgeServer';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { SafetyGuard } from '../../safety/SafetyGuard';
import {
  BridgeMessage,
  TUICommand,
  BridgeConfig
} from '../../bridge/types';
import { AutomatusConfig } from '../../types';

suite('Bridge Resilience Tests', () => {
  let server: BridgeServer;
  let client: WebSocket;
  let mockConfig: AutomatusConfig;
  let serverPort: number;

  setup(async () => {
    (global as any).vscode = vscode;

    serverPort = 19997; // Use different port for resilience tests
    mockConfig = {
      kernelMode: 'external',
      safetyPhase: 1,
      allowedDirectories: [],
      requireApproval: false,
      createBackups: true,
      codeGenerationMode: 'preview_only',
      auditLogLevel: 'all',
      serverUrl: 'http://localhost:9000',
      bridgePort: serverPort,
      bridgeTimeout: 5000,
      bridgeRetryAttempts: 3,
      bridgeEnableHeartbeat: false,
      bridgeHeartbeatInterval: 1000
    };

    const mockContext = {
      globalStoragePath: '/tmp/vscode-test-storage',
      subscriptions: []
    } as any;

    const configManager = ConfigurationManager.getInstance();
    configManager.getConfiguration = () => mockConfig;
    const safetyGuard = new SafetyGuard(mockConfig);
    server = new BridgeServer(configManager, safetyGuard, mockContext);
    await server.start();
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  teardown(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    if (server) {
      await server.stop();
    }
  });

  test('Message queue handles connection failures', async function() {
    this.timeout(8000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    // Send initial command
    const initialCommand: TUICommand = {
      id: 'test-initial',
      type: 'COMMAND_EXECUTE',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'test-session-queue',
      payload: {
        command: 'getWorkspaceFiles',
        args: {},
        safetyLevel: 'read_only'
      }
    };

    client.send(JSON.stringify(initialCommand));
    await new Promise(resolve => setTimeout(resolve, 500));

    // Close connection to simulate failure
    client.close();
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = server.getConnectionState();
    assert.strictEqual(state.isConnected, false, 'Connection should be closed');

    // Reconnect
    client = new WebSocket(`ws://localhost:${serverPort}`);
    let reconnected = false;

    client.on('open', () => {
      reconnected = true;
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Reconnection timeout')), 5000);
      const checkReconnection = () => {
        if (reconnected) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkReconnection, 100);
        }
      };
      checkReconnection();
    });

    assert.strictEqual(reconnected, true, 'Should reconnect successfully');
  });

  test('Circuit breaker opens after failures', async function() {
    this.timeout(10000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    let errorCount = 0;
    const errors: any[] = [];

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      if (message.type === 'ERROR') {
        errors.push(message);
        errorCount++;
      }
    });

    // Send commands that will fail
    for (let i = 0; i < 6; i++) {
      const failingCommand: TUICommand = {
        id: `test-fail-${i}`,
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'test-session-cb',
        payload: {
          command: 'nonExistentCommand',
          args: {},
          safetyLevel: 'read_only'
        }
      };

      client.send(JSON.stringify(failingCommand));
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    assert.ok(errorCount >= 5, `Should receive multiple errors, got ${errorCount}`);

    // Debug: log error codes
    const errorCodes = errors.map(e => e.payload?.code || 'no-code');
    console.log('Error codes received:', errorCodes);

    const circuitBreakerErrors = errors.filter(error =>
      error.payload && error.payload.code === 'CIRCUIT_BREAKER_OPEN'
    );

    const unknownCommandErrors = errors.filter(error =>
      error.payload && error.payload.code === 'UNKNOWN_COMMAND'
    );

    console.log(`Circuit breaker errors: ${circuitBreakerErrors.length}, Unknown command errors: ${unknownCommandErrors.length}`);

    // Circuit breaker should open after 5 failures of the same command
    assert.ok(unknownCommandErrors.length >= 5, 'Should have multiple unknown command errors first');

    // Circuit breaker MUST actually trigger - this is the critical functionality test
    assert.ok(circuitBreakerErrors.length > 0, `Circuit breaker must open after failures. Got ${circuitBreakerErrors.length} circuit breaker errors, ${unknownCommandErrors.length} unknown command errors`);

    // Verify we get the expected sequence: failures followed by circuit breaker opening
    assert.ok(unknownCommandErrors.length >= 5 && circuitBreakerErrors.length >= 1,
      `Expected at least 5 unknown command errors followed by circuit breaker errors. Got ${unknownCommandErrors.length} unknown, ${circuitBreakerErrors.length} circuit breaker`);
  });

  test('Health monitoring detects status correctly', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const health = server.getHealthStatus();

    assert.ok(health, 'Should return health status');
    assert.ok(['healthy', 'degraded', 'unhealthy'].includes(health.status), 'Valid status');
    assert.ok(typeof health.uptime === 'number', 'Should include uptime');
    assert.ok(health.metrics, 'Should include metrics');
    assert.ok(Array.isArray(health.issues), 'Should include issues array');

    // Fresh server should be healthy
    assert.strictEqual(health.status, 'healthy', 'Fresh server should be healthy');
  });

  test('Performance metrics collection works', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    // Execute some commands to generate metrics
    for (let i = 0; i < 3; i++) {
      const command: TUICommand = {
        id: `test-metrics-${i}`,
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'test-session-metrics',
        payload: {
          command: 'getWorkspaceFiles',
          args: {},
          safetyLevel: 'read_only'
        }
      };

      client.send(JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const metrics = server.getPerformanceMetrics();

    assert.ok(metrics, 'Should return performance metrics');
    assert.ok(metrics.commandsExecuted !== undefined, 'Should include commands executed count');
    assert.ok(metrics.performance, 'Should include performance data');
    assert.ok(typeof metrics.performance.currentMemoryUsage === 'number', 'Should track memory');
  });

  test('Rate limiting prevents message flooding', async function() {
    this.timeout(8000);

    // Create server with low rate limit for testing
    const testConfig: AutomatusConfig = {
      ...mockConfig,
      bridgePort: 19996
    };

    const mockContext = {
      globalStoragePath: '/tmp/vscode-test-storage',
      subscriptions: []
    } as any;

    const testConfigManager = ConfigurationManager.getInstance();
    testConfigManager.getConfiguration = () => testConfig;
    const testSafetyGuard = new SafetyGuard(testConfig);
    const testServer = new BridgeServer(testConfigManager, testSafetyGuard, mockContext);
    await testServer.start();

    client = new WebSocket(`ws://localhost:19996`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    let rateLimitError = false;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as any;
      if (message.type === 'ERROR' && message.payload && message.payload.code === 'RATE_LIMIT_EXCEEDED') {
        rateLimitError = true;
      }
    });

    // Send many messages quickly to trigger rate limiting
    for (let i = 0; i < 150; i++) { // More than the 100/minute limit
      const command: TUICommand = {
        id: `test-rate-${i}`,
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'test-session-rate',
        payload: {
          command: 'getWorkspaceFiles',
          args: {},
          safetyLevel: 'read_only'
        }
      };

      client.send(JSON.stringify(command));
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    await testServer.stop();

    assert.strictEqual(rateLimitError, true, 'Should trigger rate limiting');
  });
});

export { };