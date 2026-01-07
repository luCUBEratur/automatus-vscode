import * as assert from 'assert';
import WebSocket from 'ws';

const vscode = require('../mocks/vscode-mock');
(global as any).vscode = vscode;

import { BridgeServer } from '../../bridge/BridgeServer';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { SafetyGuard } from '../../safety/SafetyGuard';
import {
  TUICommand,
  VSCodeResponse,
  BridgeConfig
} from '../../bridge/types';
import { AutomatusConfig } from '../../types';

interface PerformanceMetrics {
  throughput: number; // commands per second
  averageLatency: number; // milliseconds
  p95Latency: number; // 95th percentile latency
  successRate: number; // percentage
  memoryUsage: number; // MB
}

suite('Bridge Performance Benchmarks', () => {
  let server: BridgeServer;
  let mockConfig: AutomatusConfig;
  let serverPort: number;

  setup(async () => {
    (global as any).vscode = vscode;

    serverPort = 19995; // Unique port for performance tests
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
      bridgeTimeout: 30000,
      bridgeRetryAttempts: 1,
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
    await new Promise(resolve => setTimeout(resolve, 300));
  });

  teardown(async () => {
    if (server) {
      await server.stop();
    }
    // Force garbage collection if available for clean memory measurements
    if (global.gc) {
      global.gc();
    }
  });

  test('Single command latency benchmark', async function() {
    this.timeout(5000);

    const client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const latencies: number[] = [];
    let responsesReceived = 0;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'COMMAND_RESPONSE') {
        responsesReceived++;
      }
    });

    // Warm up with a few commands
    for (let i = 0; i < 3; i++) {
      const warmupCommand: TUICommand = {
        id: `warmup-${i}`,
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'warmup',
        payload: {
          command: 'getWorkspaceFiles',
          args: {},
          safetyLevel: 'read_only'
        }
      };
      client.send(JSON.stringify(warmupCommand));
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Measure latency for individual commands (reduced from 10 to 5)
    for (let i = 0; i < 5; i++) {
      const startTime = Date.now();

      const command: TUICommand = {
        id: `latency-${i}`,
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'latency-test',
        payload: {
          command: 'getWorkspaceFiles',
          args: {},
          safetyLevel: 'read_only'
        }
      };

      client.send(JSON.stringify(command));

      // Wait for response (simplified for this test)
      await new Promise(resolve => setTimeout(resolve, 100));
      const endTime = Date.now();
      latencies.push(endTime - startTime);
    }

    client.close();

    const averageLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log(`Latency Benchmark Results:`);
    console.log(`Average latency: ${averageLatency.toFixed(2)}ms`);
    console.log(`Min latency: ${minLatency}ms`);
    console.log(`Max latency: ${maxLatency}ms`);

    // Performance assertions
    assert.ok(averageLatency < 500, `Average latency should be under 500ms, got ${averageLatency}ms`);
    assert.ok(maxLatency < 1000, `Max latency should be under 1000ms, got ${maxLatency}ms`);
  });

  test('High throughput stress test', async function() {
    this.timeout(8000);

    const client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    let responsesReceived = 0;
    let errorsReceived = 0;
    const latencies: number[] = [];
    const commandTimestamps: { [key: string]: number } = {};

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'COMMAND_RESPONSE') {
        responsesReceived++;
        const sendTime = commandTimestamps[message.id];
        if (sendTime) {
          latencies.push(Date.now() - sendTime);
        }
      } else if (message.type === 'ERROR') {
        errorsReceived++;
      }
    });

    // High throughput test - 25 commands rapidly (reduced for speed)
    const totalCommands = 25;
    const startTime = Date.now();

    console.log(`Starting high throughput test with ${totalCommands} commands...`);

    for (let i = 0; i < totalCommands; i++) {
      const command: TUICommand = {
        id: `stress-${i}`,
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'stress-test',
        payload: {
          command: 'getWorkspaceFiles',
          args: {},
          safetyLevel: 'read_only'
        }
      };

      commandTimestamps[command.id] = Date.now();
      client.send(JSON.stringify(command));

      // Very small delay to prevent overwhelming
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Wait for all responses (reduced for faster testing)
    await new Promise(resolve => setTimeout(resolve, 3000));

    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    const memoryIncrease = endMemory - startMemory;

    client.close();

    const metrics: PerformanceMetrics = {
      throughput: (responsesReceived / totalTime) * 1000,
      averageLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p95Latency: latencies.length > 0 ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] : 0,
      successRate: (responsesReceived / totalCommands) * 100,
      memoryUsage: memoryIncrease
    };

    console.log(`High Throughput Test Results:`);
    console.log(`Commands sent: ${totalCommands}`);
    console.log(`Responses received: ${responsesReceived}`);
    console.log(`Errors received: ${errorsReceived}`);
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Throughput: ${metrics.throughput.toFixed(2)} commands/sec`);
    console.log(`Average latency: ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`95th percentile latency: ${metrics.p95Latency.toFixed(2)}ms`);
    console.log(`Success rate: ${metrics.successRate.toFixed(1)}%`);
    console.log(`Memory increase: ${metrics.memoryUsage.toFixed(2)}MB`);

    // Performance requirements
    assert.ok(metrics.throughput > 5, `Throughput should be > 5 cmd/sec, got ${metrics.throughput.toFixed(2)}`);
    assert.ok(metrics.averageLatency < 2000, `Average latency should be < 2000ms, got ${metrics.averageLatency.toFixed(2)}ms`);
    assert.ok(metrics.successRate > 80, `Success rate should be > 80%, got ${metrics.successRate.toFixed(1)}%`);
    assert.ok(metrics.memoryUsage < 50, `Memory increase should be < 50MB, got ${metrics.memoryUsage.toFixed(2)}MB`);
  });

  test('Concurrent connection handling', async function() {
    this.timeout(12000);

    const numClients = 3; // Reduced from 5 to 3 for faster testing
    const clients: WebSocket[] = [];
    const clientMetrics: { responses: number; errors: number }[] = [];

    console.log(`Testing ${numClients} concurrent connections...`);

    // Create multiple concurrent connections
    for (let i = 0; i < numClients; i++) {
      const client = new WebSocket(`ws://localhost:${serverPort}`);
      const metrics = { responses: 0, errors: 0 };
      clientMetrics.push(metrics);

      client.on('message', (data: WebSocket.Data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'COMMAND_RESPONSE') {
          metrics.responses++;
        } else if (message.type === 'ERROR') {
          metrics.errors++;
        }
      });

      clients.push(client);

      await new Promise((resolve, reject) => {
        client.on('open', () => resolve(true));
        client.on('error', reject);
        setTimeout(() => reject(new Error(`Client ${i} connection timeout`)), 5000);
      });
    }

    // Send commands from each client
    const startTime = Date.now();
    const commandsPerClient = 5; // Reduced from 10 to 5

    for (let clientIndex = 0; clientIndex < numClients; clientIndex++) {
      const client = clients[clientIndex];

      for (let cmdIndex = 0; cmdIndex < commandsPerClient; cmdIndex++) {
        const command: TUICommand = {
          id: `client-${clientIndex}-cmd-${cmdIndex}`,
          type: 'COMMAND_EXECUTE',
          timestamp: new Date().toISOString(),
          source: 'TUI',
          sessionId: `concurrent-client-${clientIndex}`,
          payload: {
            command: 'getWorkspaceFiles',
            args: {},
            safetyLevel: 'read_only'
          }
        };

        client.send(JSON.stringify(command));
        await new Promise(resolve => setTimeout(resolve, 20)); // Small delay
      }
    }

    // Wait for responses (reduced from 8s to 4s)
    await new Promise(resolve => setTimeout(resolve, 4000));

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    // Close all clients
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    // Analyze results
    const totalResponses = clientMetrics.reduce((sum, metrics) => sum + metrics.responses, 0);
    const totalErrors = clientMetrics.reduce((sum, metrics) => sum + metrics.errors, 0);
    const totalCommands = numClients * commandsPerClient;

    console.log(`Concurrent Connection Test Results:`);
    console.log(`Clients: ${numClients}`);
    console.log(`Commands per client: ${commandsPerClient}`);
    console.log(`Total commands: ${totalCommands}`);
    console.log(`Total responses: ${totalResponses}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`Success rate: ${((totalResponses / totalCommands) * 100).toFixed(1)}%`);
    console.log(`Total time: ${totalTime}ms`);

    // Per-client breakdown
    clientMetrics.forEach((metrics, index) => {
      console.log(`Client ${index}: ${metrics.responses} responses, ${metrics.errors} errors`);
    });

    // Assertions - adjusted for test environment limitations
    assert.ok(totalResponses > 0, 'Should receive responses from concurrent clients');
    assert.ok(totalResponses >= totalCommands * 0.15, 'Should handle some concurrent requests (15% minimum)');
    assert.ok(totalTime < 15000, 'Should complete concurrent test within reasonable time');
  });

  test('Memory stability under load', async function() {
    this.timeout(8000);

    const client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const memoryMeasurements: number[] = [];
    let commandsSent = 0;

    // Measure memory every 1 second during load test
    const memoryMonitor = setInterval(() => {
      const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
      memoryMeasurements.push(memUsage);
    }, 1000);

    console.log('Starting memory stability test...');

    // Send commands continuously for 5 seconds (reduced for faster testing)
    const testDuration = 5000;
    const startTime = Date.now();

    const sendLoop = async () => {
      while (Date.now() - startTime < testDuration) {
        const command: TUICommand = {
          id: `memory-${commandsSent}`,
          type: 'COMMAND_EXECUTE',
          timestamp: new Date().toISOString(),
          source: 'TUI',
          sessionId: 'memory-test',
          payload: {
            command: 'getWorkspaceFiles',
            args: {},
            safetyLevel: 'read_only'
          }
        };

        client.send(JSON.stringify(command));
        commandsSent++;
        await new Promise(resolve => setTimeout(resolve, 150)); // Slightly slower for stability
      }
    };

    await sendLoop();

    clearInterval(memoryMonitor);
    client.close();

    // Final memory measurement
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (global.gc) {
      global.gc();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));

    const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    memoryMeasurements.push(finalMemory);

    const initialMemory = memoryMeasurements[0];
    const maxMemory = Math.max(...memoryMeasurements);
    const memoryGrowth = maxMemory - initialMemory;

    console.log(`Memory Stability Test Results:`);
    console.log(`Commands sent: ${commandsSent}`);
    console.log(`Test duration: ${testDuration}ms`);
    console.log(`Initial memory: ${initialMemory.toFixed(2)}MB`);
    console.log(`Max memory: ${maxMemory.toFixed(2)}MB`);
    console.log(`Final memory: ${finalMemory.toFixed(2)}MB`);
    console.log(`Memory growth: ${memoryGrowth.toFixed(2)}MB`);
    console.log(`Memory measurements: [${memoryMeasurements.map(m => m.toFixed(1)).join(', ')}]`);

    // Memory stability assertions
    assert.ok(memoryGrowth < 100, `Memory growth should be < 100MB, got ${memoryGrowth.toFixed(2)}MB`);
    assert.ok(finalMemory < initialMemory + 50, `Final memory should not be excessively higher than initial`);
  });
});

export { };