import * as vscode from 'vscode';
import { TUIClient, TUIConnectionConfig } from './TUIClient';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';
import { TUICommand, VSCodeResponse } from '../bridge/types';

export class TUIConnectionManager {
  private client: TUIClient | null = null;
  private configManager: ConfigurationManager;
  private safetyGuard: SafetyGuard;
  private statusBarItem: vscode.StatusBarItem;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private bridgeTokenGenerator?: () => Promise<string>;

  constructor(
    configManager: ConfigurationManager,
    safetyGuard: SafetyGuard,
    bridgeTokenGenerator?: () => Promise<string>
  ) {
    this.configManager = configManager;
    this.safetyGuard = safetyGuard;
    this.bridgeTokenGenerator = bridgeTokenGenerator;

    // Create status bar item for TUI connection status
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      90
    );
    this.updateStatusBar('disconnected');
    this.statusBarItem.show();
  }

  async connectToTUI(authToken?: string): Promise<void> {
    if (this.client && this.client.isConnectionActive()) {
      vscode.window.showInformationMessage('Already connected to Automatus TUI');
      return;
    }

    try {
      // Get connection configuration
      const config = await this.getConnectionConfig(authToken);

      // Create new client
      this.client = new TUIClient(config);
      this.setupClientEventHandlers();

      this.updateStatusBar('connecting');
      await this.client.connect();

      this.reconnectAttempts = 0;
      this.updateStatusBar('connected');

      vscode.window.showInformationMessage('✅ Connected to Automatus TUI');

      this.safetyGuard.logOperation('tui_connection_established', {
        bridgeUrl: config.bridgeUrl,
        reconnectAttempts: this.reconnectAttempts
      });

    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  private async getConnectionConfig(authToken?: string): Promise<TUIConnectionConfig> {
    const config = this.configManager.getConfiguration();

    return {
      bridgeUrl: `ws://localhost:${config.bridgePort || 19888}`,
      authToken: authToken || await this.generateTUIToken(),
      reconnectAttempts: 3,
      reconnectDelay: 2000, // 2 seconds
      heartbeatInterval: 30000 // 30 seconds
    };
  }

  private async generateTUIToken(): Promise<string> {
    if (this.bridgeTokenGenerator) {
      try {
        return await this.bridgeTokenGenerator();
      } catch (error) {
        console.warn('Token generator failed, using fallback:', error);
      }
    }

    // Fallback to a test token if bridge token generator isn't available
    console.warn('No token generator available, using fallback token');
    return 'fallback-test-token-' + Date.now();
  }

  private setupClientEventHandlers(): void {
    if (!this.client) {return;}

    this.client.on('connected', () => {
      this.updateStatusBar('authenticating');
    });

    this.client.on('authenticated', () => {
      this.updateStatusBar('connected');
    });

    this.client.on('disconnected', (reason: string) => {
      this.updateStatusBar('disconnected');
      this.handleDisconnection(reason);
    });

    this.client.on('error', (error: Error) => {
      this.safetyGuard.logOperation('tui_connection_error', {
        error: error.message
      });
      vscode.window.showErrorMessage(`TUI Connection Error: ${error.message}`);
    });

    this.client.on('authFailed', (reason: string) => {
      this.updateStatusBar('auth-failed');
      vscode.window.showErrorMessage(`TUI Authentication Failed: ${reason}`);
    });

    this.client.on('message', (response: VSCodeResponse) => {
      this.handleTUIMessage(response);
    });
  }

  private handleConnectionError(error: Error): void {
    this.updateStatusBar('error');
    this.safetyGuard.logOperation('tui_connection_failed', {
      error: error.message,
      reconnectAttempts: this.reconnectAttempts
    });

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      vscode.window.showErrorMessage(
        `Failed to connect to Automatus TUI: ${error.message}`,
        'Retry'
      ).then(selection => {
        if (selection === 'Retry') {
          this.reconnectAttempts = 0;
          this.connectToTUI();
        }
      });
    }
  }

  private handleDisconnection(reason: string): void {
    this.safetyGuard.logOperation('tui_connection_lost', {
      reason,
      reconnectAttempts: this.reconnectAttempts
    });

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      vscode.window.showWarningMessage(
        `Lost connection to Automatus TUI: ${reason}. Attempting to reconnect...`
      );
      this.scheduleReconnect();
    } else {
      vscode.window.showErrorMessage(
        `Lost connection to Automatus TUI: ${reason}`,
        'Reconnect'
      ).then(selection => {
        if (selection === 'Reconnect') {
          this.reconnectAttempts = 0;
          this.connectToTUI();
        }
      });
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s

    setTimeout(() => {
      this.connectToTUI();
    }, delay);
  }

  private handleTUIMessage(response: VSCodeResponse): void {
    // Handle unsolicited messages from TUI (notifications, etc.)
    this.safetyGuard.logOperation('tui_message_received', {
      messageType: response.type,
      messageId: response.id
    });

    // Could implement specific message handlers here
    if (response.type === 'COMMAND_RESPONSE') {
      vscode.window.showInformationMessage(`TUI: ${response.payload.result}`);
    }
  }

  async sendCommand(command: { command: string; args: any; safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access' }): Promise<VSCodeResponse> {
    if (!this.client || !this.client.isConnectionActive()) {
      throw new Error('Not connected to Automatus TUI');
    }

    this.safetyGuard.logOperation('tui_command_sent', {
      command: command.command
    });

    try {
      const response = await this.client.sendCommand(command);

      this.safetyGuard.logOperation('tui_command_completed', {
        command: command.command,
        success: response.payload.success,
        responseId: response.id
      });

      return response;
    } catch (error) {
      this.safetyGuard.logOperation('tui_command_failed', {
        command: command.command,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Basic command implementations for testing
  async pingTUI(): Promise<boolean> {
    try {
      const response = await this.sendCommand({
        command: 'ping',
        args: { timestamp: Date.now() },
        safetyLevel: 'read_only'
      });
      return response.payload.success;
    } catch {
      return false;
    }
  }

  async getTUIStatus(): Promise<any> {
    const response = await this.sendCommand({
      command: 'getStatus',
      args: {},
      safetyLevel: 'read_only'
    });
    return response.payload.result;
  }

  async sendMessage(message: string): Promise<VSCodeResponse> {
    return this.sendCommand({
      command: 'sendMessage',
      args: { message },
      safetyLevel: 'read_only'
    });
  }

  private updateStatusBar(status: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error' | 'auth-failed'): void {
    switch (status) {
      case 'disconnected':
        this.statusBarItem.text = '$(circle-outline) TUI: Disconnected';
        this.statusBarItem.tooltip = 'Click to connect to Automatus TUI';
        this.statusBarItem.command = 'automatus.tui.connect';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;

      case 'connecting':
        this.statusBarItem.text = '$(loading~spin) TUI: Connecting...';
        this.statusBarItem.tooltip = 'Connecting to Automatus TUI';
        this.statusBarItem.command = undefined;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        break;

      case 'authenticating':
        this.statusBarItem.text = '$(loading~spin) TUI: Authenticating...';
        this.statusBarItem.tooltip = 'Authenticating with Automatus TUI';
        this.statusBarItem.command = undefined;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        break;

      case 'connected':
        this.statusBarItem.text = '$(check-all) TUI: Connected';
        this.statusBarItem.tooltip = 'Connected to Automatus TUI - Click for options';
        this.statusBarItem.command = 'automatus.tui.showMenu';
        this.statusBarItem.backgroundColor = undefined;
        break;

      case 'error':
        this.statusBarItem.text = '$(error) TUI: Error';
        this.statusBarItem.tooltip = 'TUI connection error - Click to retry';
        this.statusBarItem.command = 'automatus.tui.connect';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;

      case 'auth-failed':
        this.statusBarItem.text = '$(shield) TUI: Auth Failed';
        this.statusBarItem.tooltip = 'TUI authentication failed - Click to retry';
        this.statusBarItem.command = 'automatus.tui.connect';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.updateStatusBar('disconnected');
  }

  isConnected(): boolean {
    return this.client ? this.client.isConnectionActive() : false;
  }

  getConnectionState() {
    if (!this.client) {
      return { connected: false, authenticated: false, reconnectAttempts: this.reconnectAttempts };
    }
    return this.client.getConnectionState();
  }

  dispose(): void {
    this.disconnect();
    this.statusBarItem.dispose();
  }
}