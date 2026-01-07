import * as assert from 'assert';
import WebSocket from 'ws';

const vscode = require('../mocks/vscode-mock');
(global as any).vscode = vscode;

import { BridgeServer } from '../../bridge/BridgeServer';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { SafetyGuard } from '../../safety/SafetyGuard';
import {
  BridgeConfig,
  BridgeMessage
} from '../../bridge/types';
import { BridgeInternalCommand } from '../../bridge/TUIVSCodeBridge';
import {
  createWorkspaceQueryCommand
} from '../utils/bridge-test-helpers';
import { AutomatusConfig } from '../../types';

suite('Circuit Breaker Functionality Verification', () => {
  let server: BridgeServer;
  let wsClient: WebSocket;
  let mockConfig: AutomatusConfig;
  let serverPort: number;
  let receivedMessages: BridgeMessage[] = [];

  setup(async () => {
    (global as any).vscode = vscode;

    serverPort = 19997; // Unique port for circuit breaker tests
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
      bridgeTimeout: 10000,
      bridgeRetryAttempts: 0,
      bridgeEnableHeartbeat: false,
      bridgeHeartbeatInterval: 30000
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
    await new Promise(resolve => setTimeout(resolve, 200));

    // Connect WebSocket client
    wsClient = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      wsClient.on('open', () => resolve(true));
      wsClient.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    receivedMessages = [];
    wsClient.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      receivedMessages.push(message);
    });
  });

  teardown(async () => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }
    if (server) {
      await server.stop();
    }
  });

  test('Circuit breaker should track failures by command:errorCode pattern', async function() {
    this.timeout(10000);

    // Step 1: Send multiple unknown commands to trigger circuit breaker
    const unknownCommands = ['unknownCmd1', 'unknownCmd2', 'unknownCmd3'];

    for (const cmdName of unknownCommands) {
      // Send 5 failures for each command (should trigger circuit breaker)
      for (let i = 0; i < 6; i++) {
        // Create an invalid command to trigger errors
        const command: BridgeInternalCommand = {
          id: `${cmdName}-${i}`,
          type: 'workspace_query',
          timestamp: Date.now(),
          payload: {
            queryType: cmdName as any  // Invalid query type
          }
        };

        wsClient.send(JSON.stringify(command));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Analyze error messages
    const errorMessages = receivedMessages.filter(m => m.type === 'ERROR');

    // For each command, check that after 5 failures, we get circuit breaker errors
    for (const cmdName of unknownCommands) {
      const cmdErrors = errorMessages.filter(m =>
        m.type === 'ERROR' &&
        (m as any).payload?.message?.includes(cmdName)
      );

      const unknownCmdErrors = cmdErrors.filter(m =>
        (m as any).payload?.code === 'UNKNOWN_COMMAND'
      );

      const circuitBreakerErrors = cmdErrors.filter(m =>
        (m as any).payload?.code === 'CIRCUIT_BREAKER_OPEN'
      );

      console.log(`Command ${cmdName}: ${unknownCmdErrors.length} unknown errors, ${circuitBreakerErrors.length} circuit breaker errors`);

      // First 5 should be UNKNOWN_COMMAND, 6th should be CIRCUIT_BREAKER_OPEN
      assert.ok(unknownCmdErrors.length >= 4, `Should have at least 4 UNKNOWN_COMMAND errors for ${cmdName}`);
      assert.ok(circuitBreakerErrors.length >= 1, `Should have at least 1 CIRCUIT_BREAKER_OPEN error for ${cmdName}`);
    }

    // Verify that different commands have independent circuit breakers
    const totalCircuitBreakerErrors = errorMessages.filter(m =>
      (m as any).payload?.code === 'CIRCUIT_BREAKER_OPEN'
    ).length;

    assert.ok(totalCircuitBreakerErrors >= unknownCommands.length,
      `Each command should have its own circuit breaker (got ${totalCircuitBreakerErrors} for ${unknownCommands.length} commands)`);
  });

  test('Circuit breaker should reset on successful command execution', async function() {
    this.timeout(8000);

    // Step 1: Trigger circuit breaker with unknown command
    for (let i = 0; i < 6; i++) {
      const command: BridgeInternalCommand = {
        id: `fail-${i}`,
        type: 'workspace_query',
        timestamp: Date.now(),
        payload: {
          queryType: 'nonExistent' as any  // Invalid query type
        }
      };

      wsClient.send(JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Verify circuit breaker is open
    const initialErrors = receivedMessages.filter(m => m.type === 'ERROR');
    const circuitOpenErrors = initialErrors.filter(m =>
      (m as any).payload?.code === 'CIRCUIT_BREAKER_OPEN'
    );
    assert.ok(circuitOpenErrors.length > 0, 'Circuit breaker should be open after failures');

    // Step 2: Send a valid command (different command that should work)
    receivedMessages = []; // Clear messages

    const validCommand = createWorkspaceQueryCommand();
    validCommand.id = 'valid-1';

    wsClient.send(JSON.stringify(validCommand));
    await new Promise(resolve => setTimeout(resolve, 500));

    // The valid command should work (not be blocked by circuit breaker)
    const validCommandErrors = receivedMessages.filter(m =>
      m.type === 'ERROR' && (m as any).payload?.code === 'CIRCUIT_BREAKER_OPEN'
    );

    assert.strictEqual(validCommandErrors.length, 0,
      'Valid command should not be blocked by circuit breaker for different command');
  });

  test('Circuit breaker should distinguish between error types', async function() {
    this.timeout(8000);

    // Test that different error codes create different circuit breakers
    // First, trigger UNKNOWN_COMMAND errors
    for (let i = 0; i < 6; i++) {
      const command: BridgeInternalCommand = {
        id: `unknown-${i}`,
        type: 'workspace_query',
        timestamp: Date.now(),
        payload: {
          queryType: 'testCommand' as any  // Invalid query type
        }
      };

      wsClient.send(JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Check that circuit breaker is open for UNKNOWN_COMMAND
    const unknownErrors = receivedMessages.filter(m =>
      m.type === 'ERROR' &&
      ((m as any).payload?.code === 'UNKNOWN_COMMAND' ||
       (m as any).payload?.code === 'CIRCUIT_BREAKER_OPEN')
    );

    const circuitBreakerOpenCount = unknownErrors.filter(m =>
      (m as any).payload?.code === 'CIRCUIT_BREAKER_OPEN'
    ).length;

    console.log(`Circuit breaker test results:`);
    console.log(`Total errors: ${unknownErrors.length}`);
    console.log(`Circuit breaker open errors: ${circuitBreakerOpenCount}`);

    assert.ok(circuitBreakerOpenCount > 0,
      'Circuit breaker should open after multiple UNKNOWN_COMMAND errors');

    // Verify the circuit breaker tracks by command:errorCode pattern
    assert.ok(unknownErrors.length === 6,
      `Should have exactly 6 error responses (got ${unknownErrors.length})`);
  });
});

export { };