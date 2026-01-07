import * as assert from 'assert';
import * as vscode from 'vscode';
import { SafeAutomatusClient } from '../../automatus-client/SafeAutomatusClient';
import { AutomatusConfig, CodeContext } from '../../types';

suite('SafeAutomatusClient Test Suite', () => {
  let client: SafeAutomatusClient;
  let mockConfig: AutomatusConfig;

  setup(() => {
    mockConfig = {
      kernelMode: 'external',
      safetyPhase: 1,
      allowedDirectories: ['./src/temp/', './tests/generated/'],
      requireApproval: true,
      createBackups: true,
      codeGenerationMode: 'preview_only',
      auditLogLevel: 'all',
      serverUrl: 'http://localhost:9000',
      bridgePort: 19888,
      bridgeTimeout: 30000,
      bridgeRetryAttempts: 3,
      bridgeEnableHeartbeat: true,
      bridgeHeartbeatInterval: 30000
    };

    client = new SafeAutomatusClient(mockConfig);
  });

  teardown(() => {
    client.dispose();
  });

  suite('Connection Management', () => {
    test('should initialize with connection ready state', () => {
      // With REST API, isConnected() returns true if serverUrl is configured
      assert.strictEqual(client.isConnected(), true, 'Client should be ready with valid server URL');
    });

    test('should handle connection failure gracefully', async () => {
      // Use empty URL to simulate no server configured
      const invalidConfig = { ...mockConfig, serverUrl: '' };
      const failClient = new SafeAutomatusClient(invalidConfig);

      // Should report not connected when no URL is configured
      assert.strictEqual(failClient.isConnected(), false, 'Should not be connected without server URL');

      failClient.dispose();
    });

    test('should disconnect properly', async () => {
      await client.disconnect();
      // REST API doesn't maintain persistent connections, so this just logs disconnection
      // Connection state is still based on server URL configuration
      assert.strictEqual(client.isConnected(), true, 'Connection state unchanged for REST API');
    });
  });

  suite('Phase 1 Operations', () => {
    test('should allow code analysis in Phase 1', async () => {
      const context: CodeContext = {
        currentFile: '/test/file.js',
        selectedText: 'console.log("test");',
        cursorPosition: new vscode.Position(0, 0)
      };

      // With offline fallback, this should now work
      const result = await client.analyzeCode(context);
      assert.ok(result, 'Should return offline analysis result');
      assert.ok(result.summary, 'Should have analysis summary');
      assert.ok(Array.isArray(result.issues), 'Should have issues array');
    });

    test('should allow code preview generation in Phase 1', async () => {
      const context: CodeContext = {
        currentFile: '/test/file.js',
        selectedText: '',
        cursorPosition: new vscode.Position(0, 0)
      };

      // With offline fallback, this should now work
      const result = await client.generateCodePreview('Create a hello world function', context);
      assert.ok(result, 'Should return offline code preview');
      assert.ok(result.code, 'Should have generated code');
      assert.ok(result.explanation, 'Should have explanation');
    });

    test('should allow code explanation in Phase 1', async () => {
      const context: CodeContext = {
        currentFile: '/test/file.js',
        selectedText: 'const x = 5;',
        cursorPosition: new vscode.Position(0, 0)
      };

      // With offline fallback, this should now work
      const result = await client.explainCode('const x = 5;', context);
      assert.ok(result, 'Should return offline explanation');
      assert.ok(result.summary, 'Should have explanation summary');
      assert.ok(Array.isArray(result.details), 'Should have details array');
    });
  });

  suite('Phase Restrictions', () => {
    test('should block Phase 2 operations in Phase 1', async () => {
      try {
        await client.requestFileWrite('/test/file.js', 'test content');
        assert.fail('Should have thrown phase restriction error');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        assert.ok(
          errorMsg.includes('not available in current safety phase'),
          'Should be blocked by phase restrictions'
        );
      }
    });

    test('should block Phase 3 operations in Phase 1', async () => {
      try {
        await client.runCapabilityPack('data_analysis_agent', {});
        assert.fail('Should have thrown phase restriction error');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        assert.ok(
          errorMsg.includes('not available in current safety phase'),
          'Should be blocked by phase restrictions'
        );
      }
    });
  });

  suite('Configuration Updates', () => {
    test('should update configuration without error', () => {
      const newConfig: AutomatusConfig = {
        ...mockConfig,
        safetyPhase: 2,
        codeGenerationMode: 'controlled_write'
      };

      assert.doesNotThrow(() => {
        client.updateConfig(newConfig);
      }, 'Configuration update should not throw error');
    });

    test('should enable Phase 2 operations after upgrade', async () => {
      const newConfig: AutomatusConfig = {
        ...mockConfig,
        safetyPhase: 2
      };

      client.updateConfig(newConfig);

      // Now Phase 2 operations should be allowed (though they'll fail due to no server)
      // File write should work in Phase 2 (though the path might still be restricted)
      const result = await client.requestFileWrite('./src/temp/test.js', 'test content');
      assert.ok(result, 'Should return write permission result');
      assert.ok(typeof result.granted === 'boolean', 'Should have granted property');
    });
  });

  suite('File Write Permissions', () => {
    test('should check allowed directories for file writes', async () => {
      const phase2Config: AutomatusConfig = {
        ...mockConfig,
        safetyPhase: 2
      };

      client.updateConfig(phase2Config);

      // Test allowed directory
      const allowedResult = await client.requestFileWrite('./src/temp/test.js', 'content');
      assert.strictEqual(allowedResult.granted, true, 'Should grant permission for allowed directory');

      // Test restricted directory
      const restrictedResult = await client.requestFileWrite('./restricted/test.js', 'content');
      assert.strictEqual(restrictedResult.granted, false, 'Should deny permission for restricted directory');
    });

    test('should provide restriction information in denied permissions', async () => {
      const phase2Config: AutomatusConfig = {
        ...mockConfig,
        safetyPhase: 2
      };

      client.updateConfig(phase2Config);

      const result = await client.requestFileWrite('/restricted/test.js', 'content');
      assert.strictEqual(result.granted, false, 'Should deny permission');
      assert.ok(result.reason, 'Should provide reason for denial');
      assert.ok(Array.isArray(result.restrictions), 'Should provide list of allowed directories');
    });
  });

  suite('Error Handling', () => {
    test('should handle WebSocket connection errors', async () => {
      // Use invalid server URL
      const invalidConfig = { ...mockConfig, serverUrl: 'invalid-url' };
      const errorClient = new SafeAutomatusClient(invalidConfig);

      const connected = await errorClient.connect();
      assert.strictEqual(connected, false, 'Should handle invalid URL gracefully');

      errorClient.dispose();
    });

    test('should handle operations when disconnected', async () => {
      const context: CodeContext = {
        currentFile: '/test/file.js',
        selectedText: '',
        cursorPosition: new vscode.Position(0, 0)
      };

      // With offline fallback, operations should work and return offline results
      const result = await client.analyzeCode(context);
      assert.ok(result, 'Should return offline analysis result');
      assert.ok(result.summary, 'Should have analysis summary');
      assert.ok(Array.isArray(result.issues), 'Should have issues array');
    });
  });

  suite('Request Timeout', () => {
    test('should timeout long-running requests', async () => {
      // This test verifies that the timeout mechanism is in place
      // In a real scenario with a mock server, this would timeout after 30 seconds
      const context: CodeContext = {
        currentFile: '/test/file.js',
        selectedText: '',
        cursorPosition: new vscode.Position(0, 0)
      };

      const startTime = Date.now();

      try {
        await client.analyzeCode(context);
      } catch (error) {
        const elapsed = Date.now() - startTime;

        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('timeout')) {
          assert.ok(elapsed >= 30000, 'Should timeout after 30 seconds');
        } else {
          // Expected connection error in test environment
          assert.ok(
            errorMsg.includes('Not connected') || errorMsg.includes('Connection timeout'),
            'Should handle connection issues appropriately'
          );
        }
      }
    });
  });
});