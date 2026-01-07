import * as assert from 'assert';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { TUIVSCodeBridge, BridgeInternalCommand, AuthRequestPayload, WorkspaceQueryPayload } from '../../bridge/TUIVSCodeBridge';
import { BridgeServer } from '../../bridge/BridgeServer';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { SafetyGuard } from '../../safety/SafetyGuard';

suite('Bridge Performance Test Suite', () => {
  let configManager: ConfigurationManager;
  let safetyGuard: SafetyGuard;
  let bridge: TUIVSCodeBridge;
  let bridgeServer: BridgeServer;
  let testPort: number;

  setup(async () => {
    testPort = 19998;

    configManager = ConfigurationManager.getInstance();

    const testConfig = {
      ...configManager.getConfiguration(),
      bridgePort: testPort,
      bridgeTimeout: 10000,
      bridgeRetryAttempts: 1,
      bridgeEnableHeartbeat: false, // Disable for performance testing
      safetyPhase: 2 as 1 | 2 | 3 | 4,
      requireApproval: false
    };

    const mockContext = {
      globalStoragePath: '/tmp/vscode-test-storage',
      subscriptions: []
    } as any;

    configManager.getConfiguration = () => testConfig;
    safetyGuard = new SafetyGuard(testConfig);

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
      bridgeServer.dispose();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  suite('Message Throughput Tests', () => {
    test('should handle high-frequency workspace queries', async function() {
      this.timeout(30000); // Allow 30 seconds for this test

      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('High-frequency test timeout'));
        }, 25000);

        let authenticated = false;
        let messagesReceived = 0;
        const totalMessages = 50;
        const startTime = Date.now();

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge' && !authenticated) {
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

            // Start rapid fire of workspace queries
            for (let i = 0; i < totalMessages; i++) {
              const workspaceQuery: BridgeInternalCommand = {
                id: `workspace-${i}`,
                type: 'workspace_query',
                payload: {},
                timestamp: Date.now()
              };

              setTimeout(() => {
                client.send(JSON.stringify(workspaceQuery));
              }, i * 10); // Send every 10ms
            }
          }

          if (message.id?.startsWith('workspace-') && message.success) {
            messagesReceived++;

            if (messagesReceived === totalMessages) {
              const endTime = Date.now();
              const duration = endTime - startTime;
              const throughput = (totalMessages / duration) * 1000; // messages per second

              clearTimeout(timeout);

              console.log(`Processed ${totalMessages} workspace queries in ${duration}ms`);
              console.log(`Throughput: ${throughput.toFixed(2)} messages/sec`);

              // Assert reasonable performance (at least 10 messages per second)
              assert.ok(throughput >= 10, `Throughput should be at least 10 msg/sec, got ${throughput.toFixed(2)}`);

              client.close();
              resolve();
            }
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    test('should handle concurrent context requests', async function() {
      this.timeout(20000);

      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Concurrent requests test timeout'));
        }, 15000);

        let authenticated = false;
        let messagesReceived = 0;
        const totalMessages = 20;
        const startTime = Date.now();

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge' && !authenticated) {
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

            // Send concurrent context requests
            for (let i = 0; i < totalMessages; i++) {
              const contextRequest: BridgeInternalCommand = {
                id: `context-${i}`,
                type: 'context_request',
                payload: { contextType: 'active_editor' },
                timestamp: Date.now()
              };

              client.send(JSON.stringify(contextRequest));
            }
          }

          if (message.id?.startsWith('context-')) {
            messagesReceived++;

            if (messagesReceived === totalMessages) {
              const endTime = Date.now();
              const duration = endTime - startTime;

              clearTimeout(timeout);

              console.log(`Processed ${totalMessages} concurrent context requests in ${duration}ms`);

              // Assert reasonable performance (should complete within 10 seconds)
              assert.ok(duration < 10000, `Should complete within 10 seconds, took ${duration}ms`);

              client.close();
              resolve();
            }
          }
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });

  suite('Memory and Resource Tests', () => {
    test('should not leak memory during extended operations', async function() {
      this.timeout(45000);

      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Memory test timeout'));
        }, 40000);

        let authenticated = false;
        let operationCount = 0;
        const maxOperations = 100;
        const initialMemory = process.memoryUsage().heapUsed;

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge' && !authenticated) {
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
            startOperations();
          }

          if (message.id?.startsWith('operation-')) {
            operationCount++;

            if (operationCount >= maxOperations) {
              const finalMemory = process.memoryUsage().heapUsed;
              const memoryIncrease = finalMemory - initialMemory;
              const memoryIncreasePercent = (memoryIncrease / initialMemory) * 100;

              clearTimeout(timeout);

              console.log(`Memory usage after ${maxOperations} operations:`);
              console.log(`Initial: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
              console.log(`Final: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
              console.log(`Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB (${memoryIncreasePercent.toFixed(2)}%)`);

              // Assert memory increase is reasonable (less than 50% increase)
              assert.ok(memoryIncreasePercent < 50,
                `Memory increase should be less than 50%, got ${memoryIncreasePercent.toFixed(2)}%`);

              client.close();
              resolve();
            } else if (operationCount % 20 === 0) {
              // Force garbage collection periodically if available
              if (global.gc) {
                global.gc();
              }
              continueOperations();
            } else {
              continueOperations();
            }
          }
        });

        function startOperations() {
          continueOperations();
        }

        function continueOperations() {
          // Alternate between different operation types
          const operationType = operationCount % 3;
          let command: BridgeInternalCommand;

          switch (operationType) {
            case 0:
              command = {
                id: `operation-${operationCount}`,
                type: 'workspace_query',
                payload: {},
                timestamp: Date.now()
              };
              break;
            case 1:
              command = {
                id: `operation-${operationCount}`,
                type: 'context_request',
                payload: { contextType: 'active_editor' },
                timestamp: Date.now()
              };
              break;
            case 2:
              command = {
                id: `operation-${operationCount}`,
                type: 'context_request',
                payload: { contextType: 'selection' },
                timestamp: Date.now()
              };
              break;
            default:
              command = {
                id: `operation-${operationCount}`,
                type: 'workspace_query',
                payload: {},
                timestamp: Date.now()
              };
          }

          client.send(JSON.stringify(command));
        }

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });

  suite('Stress Tests', () => {
    test('should handle rapid connection and disconnection cycles', async function() {
      this.timeout(30000);

      await bridge.start();

      const config = configManager.getConfiguration();
      const cycles = 10;
      const startTime = Date.now();

      for (let i = 0; i < cycles; i++) {
        await new Promise<void>((resolve, reject) => {
          const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

          const timeout = setTimeout(() => {
            client.close();
            reject(new Error(`Connection cycle ${i} timeout`));
          }, 5000);

          client.on('open', () => {
            clearTimeout(timeout);
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

        // Brief pause between cycles
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Completed ${cycles} connection cycles in ${duration}ms`);

      // Assert reasonable performance
      assert.ok(duration < 20000, `Should complete ${cycles} cycles in under 20 seconds, took ${duration}ms`);

      // Verify bridge is still healthy
      const health = bridgeServer.getStatus();
      assert.notStrictEqual(health.status, 'unhealthy', 'Bridge should still be healthy after stress test');
    });

    test('should maintain performance under load', async function() {
      this.timeout(60000);

      await bridge.start();

      const config = configManager.getConfiguration();
      const client = new WebSocket(`ws://localhost:${config.bridgePort}`);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.close();
          reject(new Error('Load test timeout'));
        }, 55000);

        let authenticated = false;
        let operationsCompleted = 0;
        const targetOperations = 200;
        const operationTimes: number[] = [];

        client.on('open', () => {
          // Wait for auth challenge
        });

        client.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_challenge' && !authenticated) {
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
            startLoadTest();
          }

          if (message.id?.startsWith('load-')) {
            const operationIndex = parseInt(message.id.spltest('-')[1]);
            const operationStartTime = parseInt(message.id.spltest('-')[2]);
            const operationEndTime = Date.now();
            const operationTime = operationEndTime - operationStartTime;

            operationTimes.push(operationTime);
            operationsCompleted++;

            if (operationsCompleted >= targetOperations) {
              clearTimeout(timeout);

              // Calculate performance metrics
              const avgTime = operationTimes.reduce((sum, time) => sum + time, 0) / operationTimes.length;
              const maxTime = Math.max(...operationTimes);
              const minTime = Math.min(...operationTimes);

              console.log(`Load test completed: ${targetOperations} operations`);
              console.log(`Average response time: ${avgTime.toFixed(2)}ms`);
              console.log(`Min response time: ${minTime}ms`);
              console.log(`Max response time: ${maxTime}ms`);

              // Assert performance criteria
              assert.ok(avgTime < 100, `Average response time should be under 100ms, got ${avgTime.toFixed(2)}ms`);
              assert.ok(maxTime < 1000, `Max response time should be under 1000ms, got ${maxTime}ms`);

              client.close();
              resolve();
            }
          }
        });

        function startLoadTest() {
          for (let i = 0; i < targetOperations; i++) {
            setTimeout(() => {
              const operationStartTime = Date.now();
              const command: BridgeInternalCommand = {
                id: `load-${i}-${operationStartTime}`,
                type: 'workspace_query',
                payload: {},
                timestamp: operationStartTime
              };

              client.send(JSON.stringify(command));
            }, i * 20); // Stagger operations every 20ms
          }
        }

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });
});

suite('Bridge Server Performance Tests', () => {
  let configManager: ConfigurationManager;
  let safetyGuard: SafetyGuard;
  let bridgeServer: BridgeServer;

  setup(async () => {
    configManager = ConfigurationManager.getInstance();

    const testConfig = {
      ...configManager.getConfiguration(),
      bridgePort: 19997,
      safetyPhase: 2 as 1 | 2 | 3 | 4,
      requireApproval: false
    };

    const mockContext = {
      globalStoragePath: '/tmp/vscode-test-storage',
      subscriptions: []
    } as any;

    configManager.getConfiguration = () => testConfig;
    safetyGuard = new SafetyGuard(testConfig);
    bridgeServer = new BridgeServer(configManager, safetyGuard, mockContext);
  });

  teardown(async () => {
    try {
      bridgeServer.dispose();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should start and stop quickly', async function() {
    this.timeout(10000);

    const startTime = Date.now();
    await bridgeServer.start();
    const startDuration = Date.now() - startTime;

    console.log(`Bridge server start time: ${startDuration}ms`);
    assert.ok(startDuration < 5000, `Start time should be under 5 seconds, took ${startDuration}ms`);

    const stopTime = Date.now();
    await bridgeServer.stop();
    const stopDuration = Date.now() - stopTime;

    console.log(`Bridge server stop time: ${stopDuration}ms`);
    assert.ok(stopDuration < 2000, `Stop time should be under 2 seconds, took ${stopDuration}ms`);
  });

  test('should handle rapid start/stop cycles', async function() {
    this.timeout(30000);

    const cycles = 5;
    const startTime = Date.now();

    for (let i = 0; i < cycles; i++) {
      await bridgeServer.start();
      await bridgeServer.stop();
    }

    const totalDuration = Date.now() - startTime;
    const avgCycleTime = totalDuration / cycles;

    console.log(`Completed ${cycles} start/stop cycles in ${totalDuration}ms`);
    console.log(`Average cycle time: ${avgCycleTime.toFixed(2)}ms`);

    assert.ok(avgCycleTime < 3000, `Average cycle time should be under 3 seconds, got ${avgCycleTime.toFixed(2)}ms`);
  });
});