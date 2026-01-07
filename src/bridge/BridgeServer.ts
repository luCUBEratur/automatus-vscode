import * as vscode from 'vscode';
import { TUIVSCodeBridge, WorkspaceInfo } from './TUIVSCodeBridge';
import { TUICommand, VSCodeResponse } from './types';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';
import { AuthenticationManager } from './AuthenticationManager';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

export interface BridgeMetrics {
  connectionsTotal: number;
  connectionsActive: number;
  commandsExecuted: number;
  errors: number;
  uptime: number;
  lastActivity: number;
  performance?: {
    peakMemoryUsage: number;
    currentMemoryUsage: number;
    messageQueueSize: number;
    circuitBreakers?: any[];
  };
}

export interface BridgeHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  metrics: BridgeMetrics;
  uptime?: number;
  configuration: {
    port: number;
    safetyPhase: number;
    requireApproval: boolean;
  };
}

export class BridgeServer {
  private bridge: TUIVSCodeBridge;
  private configManager: ConfigurationManager;
  private safetyGuard: SafetyGuard;
  private authManager: AuthenticationManager;
  private isRunning = false;
  private startTime = 0;
  private metrics: BridgeMetrics = {
    connectionsTotal: 0,
    connectionsActive: 0,
    commandsExecuted: 0,
    errors: 0,
    uptime: 0,
    lastActivity: 0
  };

  private statusBarItem: vscode.StatusBarItem;
  private configChangeListener: vscode.Disposable | null = null;

  constructor(configManager: ConfigurationManager, safetyGuard: SafetyGuard, context: vscode.ExtensionContext) {
    this.configManager = configManager;
    this.safetyGuard = safetyGuard;
    this.authManager = new AuthenticationManager(configManager, safetyGuard, context);
    this.bridge = new TUIVSCodeBridge(configManager, safetyGuard, this.authManager);

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this.setupConfigurationWatcher();
    this.updateStatusBar();

    safeRegisterDisposable(this.statusBarItem);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      vscode.window.showWarningMessage('Automatus Bridge is already running');
      return;
    }

    try {
      this.startTime = Date.now();
      await this.bridge.start();
      this.isRunning = true;
      this.metrics.connectionsTotal = 0;
      this.metrics.errors = 0;
      this.updateStatusBar();

      this.safetyGuard.logOperation('bridge_server_start', {
        port: this.configManager.getConfiguration().bridgePort,
        safetyPhase: this.configManager.getConfiguration().safetyPhase,
        success: true
      });

    } catch (error) {
      this.isRunning = false;
      this.metrics.errors++;
      this.updateStatusBar();

      const errorMsg = error instanceof Error ? error.message : String(error);
      this.safetyGuard.logOperation('bridge_server_start', {
        success: false,
        error: errorMsg
      });

      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      vscode.window.showWarningMessage('Automatus Bridge is not running');
      return;
    }

    try {
      await this.bridge.stop();
      this.isRunning = false;
      this.updateStatusBar();

      this.safetyGuard.logOperation('bridge_server_stop', {
        uptime: Date.now() - this.startTime,
        commandsExecuted: this.metrics.commandsExecuted,
        success: true
      });

    } catch (error) {
      this.metrics.errors++;
      this.updateStatusBar();

      const errorMsg = error instanceof Error ? error.message : String(error);
      this.safetyGuard.logOperation('bridge_server_stop', {
        success: false,
        error: errorMsg
      });

      throw error;
    }
  }

  async restart(): Promise<void> {
    if (this.isRunning) {
      await this.stop();
    }
    await this.start();
  }

  getStatus(): BridgeHealth {
    this.updateMetrics();

    const issues: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isRunning) {
      issues.push('Bridge server is not running');
      status = 'unhealthy';
    }

    if (this.metrics.errors > 10) {
      issues.push(`High error count: ${this.metrics.errors}`);
      status = status === 'healthy' ? 'degraded' : status;
    }

    const config = this.configManager.getConfiguration();
    if (config.safetyPhase < 1 || config.safetyPhase > 4) {
      issues.push(`Invalid safety phase: ${config.safetyPhase}`);
      status = 'unhealthy';
    }

    const timeSinceActivity = Date.now() - this.metrics.lastActivity;
    if (this.isRunning && this.metrics.connectionsActive === 0 && timeSinceActivity > 300000) { // 5 minutes
      issues.push('No activity for extended period');
      status = status === 'healthy' ? 'degraded' : status;
    }

    return {
      status,
      issues,
      metrics: { ...this.metrics },
      uptime: this.metrics.uptime,
      configuration: {
        port: config.bridgePort || 19888,
        safetyPhase: config.safetyPhase,
        requireApproval: config.requireApproval
      }
    };
  }

  getMetrics(): BridgeMetrics {
    this.updateMetrics();
    return {
      ...this.metrics,
      performance: {
        peakMemoryUsage: process.memoryUsage().heapUsed,
        currentMemoryUsage: process.memoryUsage().heapUsed,
        messageQueueSize: 0,
        circuitBreakers: []
      }
    };
  }

  getBridge(): TUIVSCodeBridge {
    return this.bridge;
  }

  async configure(): Promise<void> {
    const config = this.configManager.getConfiguration();

    const portInput = await vscode.window.showInputBox({
      prompt: 'Bridge WebSocket Port',
      value: String(config.bridgePort || 19888),
      validateInput: (value) => {
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return 'Port must be between 1024 and 65535';
        }
        return undefined;
      }
    });

    if (!portInput) {
      return; // User cancelled
    }

    const requireApproval = await vscode.window.showQuickPick(
      ['Yes', 'No'],
      {
        placeHolder: 'Require user approval for TUI operations?',
        canPickMany: false
      }
    );

    if (!requireApproval) {
      return; // User cancelled
    }

    const allowedOps = await vscode.window.showQuickPick(
      [
        'readFile',
        'writeFile',
        'getWorkspaceFiles',
        'getCurrentSelection',
        'executeCommand'
      ],
      {
        placeHolder: 'Select allowed TUI operations (ESC when done)',
        canPickMany: true
      }
    );

    try {
      const vsConfig = vscode.workspace.getConfiguration('automatus');
      await Promise.all([
        vsConfig.update('bridge.port', parseInt(portInput, 10)),
        vsConfig.update('bridge.safety.requireApproval', requireApproval === 'Yes'),
        vsConfig.update('bridge.safety.allowedOperations', allowedOps || [])
      ]);

      vscode.window.showInformationMessage('Bridge configuration updated successfully');

      if (this.isRunning) {
        const restart = await vscode.window.showInformationMessage(
          'Restart bridge to apply new configuration?',
          'Yes', 'No'
        );

        if (restart === 'Yes') {
          await this.restart();
        }
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to update configuration: ${errorMsg}`);
    }
  }

  private setupConfigurationWatcher(): void {
    this.configChangeListener = this.configManager.onConfigurationChanged((newConfig) => {
      this.updateStatusBar();

      if (this.isRunning) {
        // Log configuration changes while running
        this.safetyGuard.logOperation('bridge_config_change', {
          newSafetyPhase: newConfig.safetyPhase,
          newPort: newConfig.bridgePort,
          requireApproval: newConfig.requireApproval
        });
      }
    });

    safeRegisterDisposable(this.configChangeListener);
  }

  private updateMetrics(): void {
    this.metrics.connectionsActive = this.bridge.getConnectionCount();
    this.metrics.uptime = this.isRunning ? Date.now() - this.startTime : 0;

    if (this.bridge.isConnected()) {
      this.metrics.lastActivity = Date.now();
    }
  }

  private updateStatusBar(): void {
    const config = this.configManager.getConfiguration();

    if (this.isRunning) {
      const connections = this.bridge.getConnectionCount();
      this.statusBarItem.text = `$(radio-tower) TUI Bridge: ${connections} conn`;
      this.statusBarItem.tooltip = `Automatus TUI Bridge
Running on port: ${config.bridgePort || 19888}
Active connections: ${connections}
Safety Phase: ${config.safetyPhase}
Commands executed: ${this.metrics.commandsExecuted}`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = '$(radio-tower) TUI Bridge: Off';
      this.statusBarItem.tooltip = 'Automatus TUI Bridge is stopped\nClick to start';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.statusBarItem.command = 'automatus.bridge.status';
    this.statusBarItem.show();
  }

  // Legacy compatibility methods for BridgeClient
  getHealthStatus() {
    return this.getStatus();
  }

  getConnectionState() {
    return {
      isConnected: this.bridge.isConnected(),
      connectionCount: this.bridge.getConnectionCount(),
      lastActivity: this.metrics.lastActivity,
      sessionId: 'bridge-session',
      messagesSent: 0,
      messagesReceived: 0,
      lastHeartbeat: Date.now(),
      connectionTime: new Date(this.startTime).toISOString()
    };
  }

  getPerformanceMetrics() {
    return this.getMetrics();
  }

  async generateToken(clientInfo: { name: string; version: string; platform: string }): Promise<string> {
    return await this.authManager.generateToken(clientInfo);
  }

  revokeAllTokens(reason: string = 'Manual revocation'): void {
    this.authManager.revokeAllTokens(reason);
  }

  getAuthenticationStatus() {
    return this.authManager.getAuthenticationStatus();
  }

  dispose(): void {
    try {
      if (this.configChangeListener) {
        this.configChangeListener.dispose();
      }

      if (this.isRunning) {
        this.stop().catch(error => {
          console.error('Error stopping bridge during disposal:', error);
        });
      }

      this.bridge.dispose();
      this.authManager.dispose();
    } catch (error) {
      // Ignore disposal errors that can occur when the VS Code disposable store is already disposed
    }
  }
}