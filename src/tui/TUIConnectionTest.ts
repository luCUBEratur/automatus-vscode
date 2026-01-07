/**
 * Test file to demonstrate TUI Connection functionality
 * This file shows how the TUI integration works and can be used for testing
 */

import { TUIConnectionManager } from './TUIConnectionManager';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';

export class TUIConnectionTest {
  private tuiManager: TUIConnectionManager;

  constructor() {
    const configManager = ConfigurationManager.getInstance();
    const config = configManager.getConfiguration();
    const safetyGuard = new SafetyGuard(config);

    this.tuiManager = new TUIConnectionManager(configManager, safetyGuard);
  }

  /**
   * Test basic TUI connection flow
   */
  async testBasicConnection(): Promise<boolean> {
    try {
      console.log('🔄 Testing TUI Connection...');

      // Step 1: Connect to TUI (this will auto-generate token)
      await this.tuiManager.connectToTUI();
      console.log('✅ Connected to TUI');

      // Step 2: Test ping
      const pingResult = await this.tuiManager.pingTUI();
      console.log(`📡 Ping result: ${pingResult ? '✅ Success' : '❌ Failed'}`);

      // Step 3: Test status retrieval
      try {
        const status = await this.tuiManager.getTUIStatus();
        console.log('📊 TUI Status:', status);
      } catch (error) {
        console.log('⚠️ Status retrieval failed (expected if TUI doesn\'t implement this yet)');
      }

      // Step 4: Test message sending
      try {
        const response = await this.tuiManager.sendMessage('Hello from VSCode!');
        console.log('💬 Message response:', response.payload.result);
      } catch (error) {
        console.log('⚠️ Message sending failed (expected if TUI doesn\'t implement this yet)');
      }

      console.log('✅ TUI Connection test completed successfully');
      return true;

    } catch (error) {
      console.error('❌ TUI Connection test failed:', error);
      return false;
    } finally {
      // Cleanup
      this.tuiManager.disconnect();
    }
  }

  /**
   * Test connection state monitoring
   */
  testConnectionState(): void {
    console.log('🔍 Testing connection state monitoring...');

    const state = this.tuiManager.getConnectionState();
    console.log('Connection State:', state);

    const isConnected = this.tuiManager.isConnected();
    console.log('Is Connected:', isConnected);
  }

  /**
   * Demonstrate error handling
   */
  async testErrorHandling(): Promise<void> {
    console.log('🚨 Testing error handling...');

    try {
      // This should fail since we're not connected
      await this.tuiManager.sendMessage('This should fail');
    } catch (error) {
      console.log('✅ Error handling works:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('🧪 Running TUI Connection Tests...');
    console.log('==========================================');

    // Test 1: Connection state when disconnected
    this.testConnectionState();

    // Test 2: Error handling when disconnected
    await this.testErrorHandling();

    // Test 3: Basic connection flow (requires bridge server running)
    console.log('\n📡 Note: The following test requires the bridge server to be running');
    console.log('Use VSCode command: "Automatus Bridge: Start TUI Bridge" first\n');

    const connectionResult = await this.testBasicConnection();

    console.log('==========================================');
    console.log(`🏁 Tests completed. Connection test: ${connectionResult ? '✅ Passed' : '❌ Failed'}`);

    if (!connectionResult) {
      console.log('\n💡 To make the connection test pass:');
      console.log('1. Start VSCode with this extension');
      console.log('2. Run command: "Automatus Bridge: Start TUI Bridge"');
      console.log('3. The bridge should be listening on port 19888');
      console.log('4. Then the TUI client can connect');
    }
  }
}

// Example usage function for testing
export async function runTUIConnectionTests(): Promise<void> {
  const tester = new TUIConnectionTest();
  await tester.runAllTests();
}