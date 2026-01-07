import * as assert from 'assert';
import WebSocket from 'ws';

const vscode = require('../mocks/vscode-mock');
(global as any).vscode = vscode;

import { BridgeServer } from '../../bridge/BridgeServer';
import { BridgeClient } from '../../bridge/BridgeClient';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { SafetyGuard } from '../../safety/SafetyGuard';
import {
  BridgeMessage,
  HandshakeMessage,
  WorkspaceRequest,
  TUICommand,
  BridgeConfig
} from '../../bridge/types';
import { AutomatusConfig } from '../../types';

suite('Bridge Integration Tests', () => {
  let server: BridgeServer;
  let client: WebSocket;
  let mockConfig: AutomatusConfig;
  let serverPort: number;

  setup(async () => {
    (global as any).vscode = vscode;

    serverPort = 19999; // Use different port for testing
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
      bridgeRetryAttempts: 1,
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

    // Give server time to start
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

  test('Bridge server starts and accepts connections', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    const connected = await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    assert.strictEqual(connected, true, 'Should connect to bridge server');
    assert.strictEqual(client.readyState, WebSocket.OPEN, 'Connection should be open');
  });

  test('Handshake protocol works correctly', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const handshakeMessage: HandshakeMessage = {
      id: 'test-handshake-1',
      type: 'HANDSHAKE',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'test-session-1',
      payload: {
        version: '1.0.0',
        capabilities: ['readFile', 'writeFile'],
        safetyPhase: 1,
        clientInfo: {
          name: 'Test TUI',
          version: '1.0.0',
          platform: 'test'
        }
      }
    };

    let responseReceived = false;
    let handshakeResponse: HandshakeMessage;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      if (message.type === 'HANDSHAKE') {
        handshakeResponse = message as HandshakeMessage;
        responseReceived = true;
      }
    });

    client.send(JSON.stringify(handshakeMessage));

    // Wait for response
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Handshake timeout')), 2000);
      const checkResponse = () => {
        if (responseReceived) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });

    assert.ok(handshakeResponse!, 'Should receive handshake response');
    assert.strictEqual(handshakeResponse.source, 'VSCODE', 'Response should be from VSCode');
    assert.ok(handshakeResponse.payload.capabilities.length > 0, 'Should include capabilities');
  });

  test('Workspace request returns project information', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const workspaceRequest: WorkspaceRequest = {
      id: 'test-workspace-1',
      type: 'WORKSPACE_REQUEST',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'test-session-1',
      payload: {
        requestedData: ['files', 'structure', 'diagnostics']
      }
    };

    let responseReceived = false;
    let workspaceResponse: any;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      if (message.type === 'WORKSPACE_RESPONSE') {
        workspaceResponse = message;
        responseReceived = true;
      }
    });

    client.send(JSON.stringify(workspaceRequest));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Workspace request timeout')), 2000);
      const checkResponse = () => {
        if (responseReceived) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });

    assert.ok(workspaceResponse, 'Should receive workspace response');
    assert.ok(Array.isArray(workspaceResponse.payload.openFiles), 'Should include open files array');
    assert.ok(Array.isArray(workspaceResponse.payload.projectStructure), 'Should include project structure');
    assert.ok(Array.isArray(workspaceResponse.payload.diagnostics), 'Should include diagnostics');
  });

  test('Command execution works for read-only operations', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const commandMessage: TUICommand = {
      id: 'test-command-1',
      type: 'COMMAND_EXECUTE',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'test-session-1',
      payload: {
        command: 'getWorkspaceFiles',
        args: { pattern: '**/*.ts' },
        safetyLevel: 'read_only'
      }
    };

    let responseReceived = false;
    let commandResponse: any;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      if (message.type === 'COMMAND_RESPONSE') {
        commandResponse = message;
        responseReceived = true;
      }
    });

    client.send(JSON.stringify(commandMessage));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Command execution timeout')), 2000);
      const checkResponse = () => {
        if (responseReceived) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });

    assert.ok(commandResponse, 'Should receive command response');
    assert.strictEqual(commandResponse.payload.success, true, 'Command should succeed');
    assert.ok(commandResponse.payload.result, 'Should include command result');
  });

  test('Safety enforcement blocks unauthorized operations', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const unauthorizedCommand: TUICommand = {
      id: 'test-command-2',
      type: 'COMMAND_EXECUTE',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'test-session-1',
      payload: {
        command: 'nonExistentCommand',
        args: {},
        safetyLevel: 'expanded_access'
      }
    };

    let errorReceived = false;
    let errorMessage: any;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      if (message.type === 'ERROR') {
        errorMessage = message;
        errorReceived = true;
      }
    });

    client.send(JSON.stringify(unauthorizedCommand));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Error response timeout')), 2000);
      const checkResponse = () => {
        if (errorReceived) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });

    assert.ok(errorMessage, 'Should receive error response');
    assert.strictEqual(errorMessage.payload.code, 'UNKNOWN_COMMAND', 'Should indicate unknown command');
  });

  test('Connection state tracking works correctly', async function() {
    this.timeout(3000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 2000);
    });

    // Check connection state
    const state = server.getConnectionState();
    assert.strictEqual(state.isConnected, true, 'Server should report connection');
    assert.ok(state.sessionId, 'Should have session ID');
    assert.ok(state.connectionTime, 'Should have connection time');

    // Close connection and verify state update
    client.close();

    // Give time for disconnection to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    const disconnectedState = server.getConnectionState();
    assert.strictEqual(disconnectedState.isConnected, false, 'Server should report disconnection');
  });

  test('File modification tracking metadata is present', async function() {
    this.timeout(5000);

    client = new WebSocket(`ws://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client.on('open', () => resolve(true));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const readCommand: TUICommand = {
      id: 'test-metadata-1',
      type: 'COMMAND_EXECUTE',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'test-session-1',
      payload: {
        command: 'getWorkspaceFiles',
        args: {},
        safetyLevel: 'read_only'
      }
    };

    let responseReceived = false;
    let commandResponse: any;

    client.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as BridgeMessage;
      if (message.type === 'COMMAND_RESPONSE') {
        commandResponse = message;
        responseReceived = true;
      }
    });

    client.send(JSON.stringify(readCommand));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Metadata test timeout')), 3000);
      const checkResponse = () => {
        if (responseReceived) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });

    assert.ok(commandResponse, 'Should receive command response');
    assert.ok(commandResponse.payload.metadata, 'Should include metadata');
    assert.ok(Array.isArray(commandResponse.payload.metadata.filesModified), 'Should track modified files array');
    assert.ok(typeof commandResponse.payload.metadata.executionTime === 'number', 'Should track execution time');
    assert.strictEqual(typeof commandResponse.payload.metadata.userApproved, 'boolean', 'Should track user approval as boolean');

    // For read operations, no files should be modified
    assert.strictEqual(commandResponse.payload.metadata.filesModified.length, 0,
      'Read operations should not modify any files');

    // For read operations with no approval required, userApproved should be false
    assert.strictEqual(commandResponse.payload.metadata.userApproved, false,
      'Read operations without approval should have userApproved as false');
  });
});

export { };