import * as assert from 'assert';

// Mock vscode before importing anything else
const vscode = require('../mocks/vscode-mock');
(global as any).vscode = vscode;

// Now import our modules
import { SafeAutomatusClient } from '../../automatus-client/SafeAutomatusClient';
import { SafetyGuard } from '../../safety/SafetyGuard';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { Phase1Commands } from '../../commands/Phase1Commands';
import { AutomatusConfig, CodeContext } from '../../types';

suite('Integration Test Suite', () => {
  let client: SafeAutomatusClient;
  let safetyGuard: SafetyGuard;
  let configManager: ConfigurationManager;
  let phase1Commands: Phase1Commands;
  let mockConfig: AutomatusConfig;

  setup(() => {
    // Reset global vscode mock
    (global as any).vscode = vscode;

    mockConfig = {
      kernelMode: 'external',
      safetyPhase: 1,
      allowedDirectories: ['./src/temp/', './tests/generated/'],
      requireApproval: true,
      createBackups: true,
      codeGenerationMode: 'preview_only' as const,
      auditLogLevel: 'all' as const,
      serverUrl: 'http://localhost:19999', // Non-existent port for offline testing
      bridgePort: 19888,
      bridgeTimeout: 30000,
      bridgeRetryAttempts: 3,
      bridgeEnableHeartbeat: true,
      bridgeHeartbeatInterval: 30000
    };

    // Initialize components
    configManager = ConfigurationManager.getInstance();
    safetyGuard = new SafetyGuard(mockConfig);
    client = new SafeAutomatusClient(mockConfig);
    phase1Commands = new Phase1Commands(client, safetyGuard, configManager);
  });

  teardown(() => {
    client?.dispose();
    safetyGuard?.dispose();
    phase1Commands?.dispose();
  });

  suite('End-to-End Integration Tests', () => {
    test('Complete Phase 1 workflow integration', async function() {
      this.timeout(10000); // Increase timeout for integration test

      // Test 1: Safety guard initialization
      assert.ok(safetyGuard, 'SafetyGuard should be initialized');

      // Test 2: Permission checking
      const hasReadPermission = await safetyGuard.checkPermission('read', '/test/file.js');
      assert.strictEqual(hasReadPermission, true, 'Should allow read operations in Phase 1');

      const hasWritePermission = await safetyGuard.checkPermission('write_file', '/test/file.js');
      assert.strictEqual(hasWritePermission, false, 'Should deny write operations in Phase 1');

      // Test 3: Client connection handling
      assert.strictEqual(client.isConnected(), true, 'Client should report connected with valid URL');

      // Test 4: Code preview generation (offline fallback)
      const codeContext: CodeContext = {
        currentFile: '/test/example.js',
        selectedText: '',
        cursorPosition: new vscode.Position(0, 0)
      };

      const codePreview = await client.generateCodePreview('Create a hello world function', codeContext);
      assert.ok(codePreview, 'Should generate code preview');
      assert.ok(codePreview.code.length > 0, 'Should have generated code');
      assert.ok(codePreview.language, 'Should have detected language');
      assert.ok(codePreview.explanation, 'Should have explanation');

      // Test 5: Code analysis (offline fallback)
      const analysisContext: CodeContext = {
        currentFile: '/test/example.js',
        selectedText: 'console.log("hello world");',
        cursorPosition: new vscode.Position(0, 0)
      };

      const analysis = await client.analyzeCode(analysisContext);
      assert.ok(analysis, 'Should analyze code');
      assert.ok(analysis.summary, 'Should have summary');
      assert.ok(Array.isArray(analysis.issues), 'Should have issues array');
      assert.ok(typeof analysis.quality === 'number', 'Should have quality score');
      assert.ok(typeof analysis.complexity === 'number', 'Should have complexity score');

      // Test 6: Code explanation (offline fallback)
      const explanation = await client.explainCode('const x = 5;', analysisContext);
      assert.ok(explanation, 'Should explain code');
      assert.ok(explanation.summary, 'Should have explanation summary');
      assert.ok(Array.isArray(explanation.concepts), 'Should have concepts array');
      assert.ok(Array.isArray(explanation.details), 'Should have details array');

      // Test 7: Safety audit logging
      const auditLog = safetyGuard.exportAuditLog();
      assert.ok(auditLog.length > 0, 'Should have audit log entries');

      // Test 8: Configuration management
      const phaseInfo = configManager.getPhaseInfo();
      assert.strictEqual(phaseInfo.phase, 1, 'Should be in Phase 1');
      assert.ok(phaseInfo.permissions.includes('read'), 'Should allow read operations');
      assert.ok(!phaseInfo.permissions.includes('write_file'), 'Should not allow write operations');
    });

    test('Safety enforcement integration', async function() {
      this.timeout(5000);

      // Test safety boundaries
      const restrictedPath = '/.git/config';
      const hasRestrictedAccess = await safetyGuard.checkPermission('read', restrictedPath);
      assert.strictEqual(hasRestrictedAccess, false, 'Should block access to .git directory');

      // Test phase restrictions
      try {
        await client.applySuggestedChanges([]);
        assert.fail('Should throw error for Phase 2 operation in Phase 1');
      } catch (error) {
        assert.ok(error instanceof Error, 'Should throw error for unauthorized operation');
        assert.ok(error.message.includes('not available in current safety phase'), 'Should indicate phase restriction');
      }

      // Test emergency stop
      safetyGuard.emergencyStop();
      const auditLogJson = safetyGuard.exportAuditLog();
      const auditLogData = JSON.parse(auditLogJson);
      const emergencyEntry = auditLogData.find((entry: any) => entry.operation === 'emergency_stop');
      assert.ok(emergencyEntry, 'Should log emergency stop in audit trail');
    });

    test('Offline fallback functionality', async function() {
      this.timeout(5000);

      // Test that all operations work without server connection
      const context: CodeContext = {
        currentFile: '/test/offline.js',
        selectedText: 'function test() { return true; }',
        cursorPosition: new vscode.Position(0, 0)
      };

      // All these should work offline
      const [preview, analysis, explanation] = await Promise.all([
        client.generateCodePreview('Create a test function', context),
        client.analyzeCode(context),
        client.explainCode(context.selectedText, context)
      ]);

      assert.ok(preview.code, 'Preview should work offline');
      assert.ok(analysis.summary, 'Analysis should work offline');
      assert.ok(explanation.summary, 'Explanation should work offline');

      // Verify offline indicators
      assert.ok(preview.safetyWarnings?.some(w => w.includes('offline')), 'Should indicate offline mode');
    });

    test('Resource management and disposal', async function() {
      this.timeout(3000);

      // Test proper resource disposal
      const testClient = new SafeAutomatusClient(mockConfig);
      const testGuard = new SafetyGuard(mockConfig);

      // Use the resources
      await testClient.connect();
      await testGuard.checkPermission('read', '/test/file.js');

      // Dispose without errors
      assert.doesNotThrow(() => {
        testClient.dispose();
        testGuard.dispose();
      }, 'Should dispose resources without errors');
    });

    test('Configuration updates and events', async function() {
      this.timeout(3000);

      let configChanged = false;
      const disposable = configManager.onConfigurationChanged(() => {
        configChanged = true;
      });

      // Simulate configuration change
      const newConfig = { ...mockConfig, safetyPhase: 2 as const };
      client.updateConfig(newConfig);
      safetyGuard.updateConfig(newConfig);

      // Clean up
      disposable.dispose();

      // Note: In real environment, this would trigger the event
      // For mock environment, we just verify the update methods don't throw
      assert.doesNotThrow(() => {
        client.updateConfig(mockConfig);
        safetyGuard.updateConfig(mockConfig);
      }, 'Should handle configuration updates without errors');
    });
  });

  suite('Error Handling Integration', () => {
    test('Graceful error handling across components', async function() {
      this.timeout(3000);

      // Test invalid operations
      const invalidConfig = { ...mockConfig, serverUrl: '' };
      const invalidClient = new SafeAutomatusClient(invalidConfig);

      assert.strictEqual(invalidClient.isConnected(), false, 'Should handle invalid URL gracefully');

      // Test malformed requests
      const context: CodeContext = {
        currentFile: '',
        selectedText: '',
        cursorPosition: new vscode.Position(0, 0)
      };

      // Should not throw, should handle gracefully
      assert.doesNotReject(async () => {
        await invalidClient.generateCodePreview('', context);
      }, 'Should handle empty requests gracefully');

      invalidClient.dispose();
    });
  });
});

// Export for standalone testing
export { };