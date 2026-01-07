import * as assert from 'assert';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { TUIVSCodeBridge, WorkspaceInfo, BridgeInternalCommand } from '../../bridge/TUIVSCodeBridge';
import { VSCodeResponse } from '../../bridge/types';
import { BridgeServer, BridgeMetrics, BridgeHealth } from '../../bridge/BridgeServer';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { SafetyGuard } from '../../safety/SafetyGuard';
import { createAuthCommand, createWorkspaceQueryCommand, createContextRequestCommand, createFileOperationCommand } from '../utils/bridge-test-helpers';

suite('TUI-VSCode Bridge Test Suite', () => {
  let configManager: ConfigurationManager;
  let safetyGuard: SafetyGuard;
  let bridge: TUIVSCodeBridge;
  let bridgeServer: BridgeServer;
  let testPort: number;

  setup(async () => {
    // Use a test-specific port
    testPort = 19999;

    // Initialize configuration manager
    configManager = ConfigurationManager.getInstance();

    // Override configuration for testing
    const testConfig = {
      ...configManager.getConfiguration(),
      bridgePort: testPort,
      bridgeTimeout: 5000,
      bridgeRetryAttempts: 1,
      bridgeEnableHeartbeat: true,
      bridgeHeartbeatInterval: 1000,
      safetyPhase: 2 as 1 | 2 | 3 | 4,
      requireApproval: false // Disable for automated testing
    };

    // Mock the configuration manager to return our test config
    configManager.getConfiguration = () => testConfig;

    // Initialize safety guard with test config
    safetyGuard = new SafetyGuard(testConfig);

    const mockContext = {
      globalStoragePath: '/tmp/vscode-test-storage',
      subscriptions: []
    } as any;

    // Initialize bridge components
    const mockAuthManager = {
      generateToken: async () => 'test-token',
      validateToken: async () => ({ success: true }),
      revokeToken: () => {},
      revokeAllTokens: () => {},
      blockIP: () => {},
      unblockIP: () => {},
      getAuthenticationStatus: () => ({ activeTokens: 0, revokedTokens: 0, blockedIPs: 0, authFailures: 0 }),
      dispose: () => {}
    } as any;

    bridge = new TUIVSCodeBridge(configManager, safetyGuard, mockAuthManager);
    bridgeServer = new BridgeServer(configManager, safetyGuard, mockContext);
  });

  teardown(async () => {
    try {
      await bridge.stop();
    } catch (error) {
      // Ignore cleanup errors
    }

    try {
      bridgeServer.dispose();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  suite('TUIVSCodeBridge Core Functionality', () => {
    test('should start and stop bridge successfully', async () => {
      await bridge.start();
      assert.strictEqual(bridge.isConnected(), false, 'Bridge should not be connected without clients');

      await bridge.stop();
      assert.strictEqual(bridge.isConnected(), false, 'Bridge should not be connected after stopping');
    });

    test('should handle WebSocket connections', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Connection timeout'));
        }, 3000);

        client.on('open', () => {
          clearTimeout(timeout);
          assert.strictEqual(bridge.getConnectionCount(), 1, 'Bridge should have one connection');
          client.close();
        });

        client.on('close', () => {
          resolve();
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    test('should authenticate connections', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Authentication test timeout'));
        }, 5000);

        let authChallengeReceived = false;

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge') {
            authChallengeReceived = true;

            // Send auth request
            const authRequest: BridgeInternalCommand = {
              id: 'auth-test',
              type: 'auth_request',
              payload: { token: 'test-token' },
              timestamp: Date.now()
            };

            client.send(JSON.stringify(authRequest));
          }

          if (message.type === 'COMMAND_RESPONSE' && message.payload.success) {
            clearTimeout(timeout);
            assert.strictEqual(authChallengeReceived, true, 'Auth challenge should be received');
            client.close();
            resolve();
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    test('should handle workspace queries', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Workspace query test timeout'));
        }, 5000);

        let authenticated = false;

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge') {
            const authRequest: BridgeInternalCommand = {
              id: 'auth-test',
              type: 'auth_request',
              payload: { token: 'test-token' },
              timestamp: Date.now()
            };
            client.send(JSON.stringify(authRequest));
          }

          if (message.type === 'COMMAND_RESPONSE' && message.payload.success && !authenticated) {
            authenticated = true;

            // Send workspace query
            const workspaceQuery: BridgeInternalCommand = {
              id: 'workspace-test',
              type: 'workspace_query',
              payload: {},
              timestamp: Date.now()
            };

            client.send(JSON.stringify(workspaceQuery));
          }

          if (message.id === 'workspace-test' && message.success) {
            clearTimeout(timeout);

            const workspace: WorkspaceInfo = message.data;
            assert.ok(workspace, 'Workspace info should be returned');
            assert.ok(Array.isArray(workspace.openFiles), 'Open files should be an array');

            client.close();
            resolve();
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    test('should handle context requests', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Context request test timeout'));
        }, 5000);

        let authenticated = false;

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge') {
            const authRequest: BridgeInternalCommand = {
              id: 'auth-test',
              type: 'auth_request',
              payload: { token: 'test-token' },
              timestamp: Date.now()
            };
            client.send(JSON.stringify(authRequest));
          }

          if (message.type === 'COMMAND_RESPONSE' && message.payload.success && !authenticated) {
            authenticated = true;

            // Send context request
            const contextRequest: BridgeInternalCommand = {
              id: 'context-test',
              type: 'context_request',
              payload: { contextType: 'active_editor' },
              timestamp: Date.now()
            };

            client.send(JSON.stringify(contextRequest));
          }

          if (message.id === 'context-test') {
            clearTimeout(timeout);

            if (message.success) {
              // Context returned successfully (may be null if no active editor)
              client.close();
              resolve();
            } else {
              // Context request failed
              client.close();
              reject(new Error(`Context request failed: ${message.error}`));
            }
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    test('should enforce safety phase restrictions', async () => {
      // Set safety phase to 1 (read-only)
      const testConfig = {
        ...configManager.getConfiguration(),
        safetyPhase: 1 as 1 | 2 | 3 | 4
      };
      configManager.getConfiguration = () => testConfig;

      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Safety enforcement test timeout'));
        }, 5000);

        let authenticated = false;

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge') {
            const authRequest: BridgeInternalCommand = {
              id: 'auth-test',
              type: 'auth_request',
              payload: { token: 'test-token' },
              timestamp: Date.now()
            };
            client.send(JSON.stringify(authRequest));
          }

          if (message.type === 'COMMAND_RESPONSE' && message.payload.success && !authenticated) {
            authenticated = true;

            // Try to perform a write operation (should be rejected in phase 1)
            const fileOperation: BridgeInternalCommand = {
              id: 'write-test',
              type: 'file_operation',
              payload: {
                operation: 'create',
                path: '/tmp/test.txt',
                content: 'test content'
              },
              timestamp: Date.now(),
              requiresApproval: false
            };

            client.send(JSON.stringify(fileOperation));
          }

          if (message.id === 'write-test') {
            clearTimeout(timeout);

            // Should fail due to safety phase restriction
            assert.strictEqual(message.success, false, 'Write operation should fail in phase 1');
            assert.ok(message.error?.includes('Safety Phase 2'), 'Error should mention safety phase requirement');

            client.close();
            resolve();
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });

  suite('BridgeServer Management', () => {
    test('should start and stop bridge server', async () => {
      await bridgeServer.start();

      const health = bridgeServer.getStatus();
      assert.strictEqual(health.status, 'healthy', 'Bridge should be healthy after starting');

      await bridgeServer.stop();

      const stoppedHealth = bridgeServer.getStatus();
      assert.strictEqual(stoppedHealth.status, 'unhealthy', 'Bridge should be unhealthy after stopping');
    });

    test('should provide accurate metrics', async () => {
      const initialMetrics = bridgeServer.getMetrics();
      assert.strictEqual(initialMetrics.connectionsActive, 0, 'Should start with no connections');
      assert.strictEqual(initialMetrics.commandsExecuted, 0, 'Should start with no commands executed');

      await bridgeServer.start();

      const runningMetrics = bridgeServer.getMetrics();
      assert.ok(runningMetrics.uptime >= 0, 'Uptime should be non-negative');
    });

    test('should track bridge health status', async () => {
      const initialHealth = bridgeServer.getStatus();
      assert.strictEqual(initialHealth.status, 'unhealthy', 'Should be unhealthy when stopped');

      await bridgeServer.start();

      const runningHealth = bridgeServer.getStatus();
      assert.strictEqual(runningHealth.status, 'healthy', 'Should be healthy when running');
      assert.strictEqual(runningHealth.configuration.port, testPort, 'Should report correct port');
    });

    test('should handle configuration changes', async () => {
      await bridgeServer.start();

      // Simulate configuration change
      const newConfig = {
        ...configManager.getConfiguration(),
        requireApproval: true
      };

      // Update configuration
      configManager.getConfiguration = () => newConfig;

      const health = bridgeServer.getStatus();
      assert.strictEqual(health.configuration.requireApproval, true, 'Should reflect configuration change');
    });
  });

  suite('Error Handling and Resilience', () => {
    test('should handle connection errors gracefully', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Error handling test timeout'));
        }, 3000);

        client.on('open', () => {
          // Send malformed message
          client.send('invalid json');
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'ERROR') {
            clearTimeout(timeout);
            assert.ok(message.payload.message.includes('Invalid command format'),
              'Should receive parse error message');
            client.close();
            resolve();
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    test('should handle multiple connection attempts', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();

      // Try to connect multiple clients (should only allow one)
      const client1 = new WebSocket(`ws://localhost:${config.bridgePort}`);
      const client2 = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client1.close();
          client2.close();
          reject(new Error('Multiple connection test timeout'));
        }, 5000);

        let client1Connected = false;
        let client2Rejected = false;

        client1.on('open', () => {
          client1Connected = true;
          checkCompletion();
        });

        client2.on('close', (code) => {
          if (code === 1013) { // Service unavailable
            client2Rejected = true;
            checkCompletion();
          }
        });

        function checkCompletion() {
          if (client1Connected && client2Rejected) {
            clearTimeout(timeout);
            assert.strictEqual(bridge.getConnectionCount(), 1, 'Should only have one connection');
            client1.close();
            resolve();
          }
        }

        client1.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        client2.on('error', (error) => {
          // Expected for second client
          client2Rejected = true;
          checkCompletion();
        });
      });
    });

    test('should enforce rate limiting', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Rate limiting test timeout'));
        }, 5000);

        let messagesSent = 0;
        let rateLimitHit = false;

        client.on('open', () => {
          // Send many messages rapidly to trigger rate limiting
          const interval = setInterval(() => {
            if (messagesSent < 150) { // Exceed the 100 message limit
              const testMessage = {
                id: `test-${messagesSent}`,
                type: 'auth_request',
                payload: { token: 'test' },
                timestamp: Date.now()
              };
              client.send(JSON.stringify(testMessage));
              messagesSent++;
            } else {
              clearInterval(interval);
            }
          }, 10);
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.payload?.code === 'RATE_LIMIT_EXCEEDED') {
            clearTimeout(timeout);
            rateLimitHit = true;
            client.close();
            resolve();
          }
        });

        client.on('close', () => {
          if (!rateLimitHit) {
            clearTimeout(timeout);
            reject(new Error('Rate limiting was not enforced'));
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });

  suite('Integration Tests', () => {
    test('should work end-to-end: connect, authenticate, query workspace, disconnect', async () => {
      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('End-to-end test timeout'));
        }, 10000);

        let step = 0;

        client.on('open', () => {
          step = 1; // Connected
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          switch (step) {
            case 1: // Auth challenge
              if (message.type === 'auth_challenge') {
                step = 2;
                const authRequest: BridgeInternalCommand = {
                  id: 'auth-test',
                  type: 'auth_request',
                  payload: { token: 'test-token' },
                  timestamp: Date.now()
                };
                client.send(JSON.stringify(authRequest));
              }
              break;

            case 2: // Auth response
              if (message.payload?.success) {
                step = 3;
                const workspaceQuery: BridgeInternalCommand = {
                  id: 'workspace-test',
                  type: 'workspace_query',
                  payload: {},
                  timestamp: Date.now()
                };
                client.send(JSON.stringify(workspaceQuery));
              }
              break;

            case 3: // Workspace response
              if (message.id === 'workspace-test' && message.success) {
                step = 4;
                const contextRequest: BridgeInternalCommand = {
                  id: 'context-test',
                  type: 'context_request',
                  payload: { contextType: 'active_editor' },
                  timestamp: Date.now()
                };
                client.send(JSON.stringify(contextRequest));
              }
              break;

            case 4: // Context response
              if (message.id === 'context-test') {
                clearTimeout(timeout);
                client.close();
                resolve();
              }
              break;
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });
});