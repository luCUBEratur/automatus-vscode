import * as vscode from 'vscode';
import { BridgeServer } from './BridgeServer';
import { BridgeConfig } from './types';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

export class BridgeClient {
  private server: BridgeServer | null = null;
  private context: vscode.ExtensionContext;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;
  private connectionHealthCheck: NodeJS.Timeout | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async activate(): Promise<void> {
    await this.startWithRecovery();
  }

  private async startWithRecovery(): Promise<void> {
    try {
      await this.startServer();
      this.reconnectAttempts = 0;
      this.startHealthCheck();
    } catch (error) {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.scheduleReconnect();
      } else {
        vscode.window.showErrorMessage(`Failed to start Automatus bridge after ${this.maxReconnectAttempts} attempts: ${error}`);
        throw error;
      }
    }
  }

  private async startServer(): Promise<void> {
    const configManager = ConfigurationManager.getInstance();
    const safetyGuard = new SafetyGuard(configManager.getConfiguration());

    this.server = new BridgeServer(configManager, safetyGuard, this.context);
    safeRegisterDisposable(this.server);

    await this.server.start();

    this.registerCommands();
    this.registerStatusBarItem();

    if (this.reconnectAttempts === 0) {
      const config = configManager.getConfiguration();
      vscode.window.showInformationMessage(
        `Automatus bridge server started on port ${config.bridgePort || 19888}`
      );
    } else {
      vscode.window.showInformationMessage(
        `Automatus bridge reconnected successfully (attempt ${this.reconnectAttempts + 1})`
      );
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);

    vscode.window.showWarningMessage(
      `Bridge connection failed. Retrying in ${delay / 1000}s... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectInterval = setTimeout(async () => {
      this.isReconnecting = false;
      await this.startWithRecovery();
    }, delay);
  }

  private startHealthCheck(): void {
    // Check connection health every 30 seconds
    this.connectionHealthCheck = setInterval(() => {
      if (!this.server) {
        return;
      }

      const health = this.server.getHealthStatus();

      // Take recovery actions based on health status
      if (health.status === 'unhealthy') {
        this.log('Health check: Server unhealthy, initiating recovery...');
        this.handleUnhealthyServer(health);
      } else if (health.status === 'degraded') {
        this.log('Health check: Server degraded, attempting optimization...');
        this.handleDegradedServer(health);
      }

      // Monitor for high memory usage
      if (health.metrics.performance?.currentMemoryUsage && health.metrics.performance.currentMemoryUsage > 500) {
        this.log('Health check: High memory usage detected, triggering cleanup...');
        this.triggerMemoryCleanup();
      }

      // Monitor circuit breakers
      if (health.metrics.performance?.circuitBreakers && health.metrics.performance.circuitBreakers.length > 0) {
        this.log(`Health check: ${health.metrics.performance.circuitBreakers.length} circuit breakers open`);
      }
    }, 30000);
  }

  private handleUnhealthyServer(health: any): void {
    // For unhealthy servers, try to restart the bridge
    const criticalIssues = health.issues.filter((issue: string) =>
      issue.includes('unhealthy') || issue.includes('memory') || issue.includes('connection')
    );

    if (criticalIssues.length > 0) {
      vscode.window.showWarningMessage(
        `Automatus bridge is unhealthy (${health.issues.join(', ')}). Attempting restart...`
      );

      // Attempt automatic restart
      this.restartBridge();
    }
  }

  private handleDegradedServer(health: any): void {
    // For degraded servers, try optimization actions
    const degradationIssues = health.issues;

    if (degradationIssues.some((issue: string) => issue.includes('Circuit breakers'))) {
      // Reset circuit breakers that have been open for too long
      this.log('Attempting to reset circuit breakers...');
      // Circuit breakers will auto-reset after timeout, but we can log the attempt
    }

    if (degradationIssues.some((issue: string) => issue.includes('High message rate'))) {
      this.log('High message rate detected, monitoring will continue...');
      // Rate limiting is already in place, just monitor
    }

    if (degradationIssues.some((issue: string) => issue.includes('memory'))) {
      this.triggerMemoryCleanup();
    }
  }

  private async restartBridge(): Promise<void> {
    try {
      this.log('Initiating bridge restart...');

      // Stop current server
      if (this.server) {
        await this.server.stop();
        this.server = null;
      }

      // Clear reconnection state
      this.isReconnecting = false;
      this.reconnectAttempts = 0;

      // Start with recovery logic
      await this.startWithRecovery();

      vscode.window.showInformationMessage('Automatus bridge restarted successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to restart bridge: ${error}`);
    }
  }

  private triggerMemoryCleanup(): void {
    if (!this.server) {
      return;
    }

    this.log('Triggering memory cleanup...');

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      this.log('Forced garbage collection completed');
    } else {
      // Alternative cleanup strategies when gc is not available
      this.performManualCleanup();
    }

    // Clear old performance data to free memory
    // This would be handled by the server's cleanup mechanisms
    this.log('Memory cleanup completed');
  }

  private performManualCleanup(): void {
    try {
      // Clear internal caches and temporary data
      this.clearInternalCaches();

      // Force V8 to run incremental GC by creating memory pressure
      this.createMemoryPressure();

      // Clear any lingering timeouts or intervals
      this.clearStaleTimers();

      this.log('Manual memory cleanup completed');
    } catch (error) {
      this.logError('Error during manual cleanup', error);
    }
  }

  private clearInternalCaches(): void {
    // Clear any internal caches that might exist
    if ((this as any).messageCache) {
      (this as any).messageCache.clear();
    }

    // Clear diagnostic cache if it exists
    if ((this as any).diagnosticCache) {
      (this as any).diagnosticCache = new Map();
    }

    // Ask server to clean up its metrics
    if (this.server) {
      try {
        // This will trigger the server's cleanup method we implemented
        this.server.getHealthStatus();
      } catch (error) {
        // Ignore errors during cleanup attempt
      }
    }
  }

  private createMemoryPressure(): void {
    // Create temporary large objects to trigger GC
    const tempArrays = [];
    for (let i = 0; i < 10; i++) {
      tempArrays.push(new Array(100000).fill(null));
    }
    // Let them go out of scope to be collected
    tempArrays.length = 0;
  }

  private clearStaleTimers(): void {
    // Clear any stale timers that might be holding references
    // This is a defensive measure for potential memory leaks

    // If we had stored timer IDs, we would clear them here
    // For now, this serves as a placeholder for future timer management
  }

  private log(message: string): void {
    console.log(`[Automatus Bridge Client] ${message}`);
  }

  private logError(message: string, error?: any): void {
    console.error(`[Automatus Bridge Client ERROR] ${message}`, error);
  }

  async deactivate(): Promise<void> {
    // Clear all timers
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck);
      this.connectionHealthCheck = null;
    }

    if (this.server) {
      await this.server.stop();
      this.server = null;
    }

    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  private loadBridgeConfig(): BridgeConfig {
    const config = vscode.workspace.getConfiguration('automatus.bridge');

    const rawConfig = {
      port: config.get('port', 19888),
      protocol: 'websocket' as const,
      timeout: config.get('timeout', 30000),
      retryAttempts: config.get('retryAttempts', 3),
      enableHeartbeat: config.get('enableHeartbeat', true),
      heartbeatInterval: config.get('heartbeatInterval', 30000),
      safetySettings: {
        requireApproval: config.get('safety.requireApproval', true),
        allowedOperations: config.get('safety.allowedOperations', [
          'readFile',
          'getWorkspaceFiles',
          'getCurrentSelection'
        ]),
        maxFileSize: config.get('safety.maxFileSize', 1024 * 1024), // 1MB
        allowedExtensions: config.get('safety.allowedExtensions', [
          '.ts', '.js', '.tsx', '.jsx',
          '.py', '.java', '.cpp', '.c', '.h',
          '.cs', '.php', '.rb', '.go', '.rs',
          '.swift', '.kt', '.vue', '.svelte'
        ])
      }
    };

    // Validate the configuration
    this.validateBridgeConfig(rawConfig);

    return rawConfig;
  }

  private validateBridgeConfig(config: any): void {
    const errors: string[] = [];

    // Validate port
    if (typeof config.port !== 'number' || config.port < 1024 || config.port > 65535) {
      errors.push(`Invalid port number: ${config.port}. Must be between 1024 and 65535.`);
      config.port = 19888; // Reset to default
    }

    // Validate timeout
    if (typeof config.timeout !== 'number' || config.timeout < 1000 || config.timeout > 300000) {
      errors.push(`Invalid timeout: ${config.timeout}. Must be between 1000ms and 300000ms (5 minutes).`);
      config.timeout = 30000; // Reset to default
    }

    // Validate retry attempts
    if (typeof config.retryAttempts !== 'number' || config.retryAttempts < 0 || config.retryAttempts > 10) {
      errors.push(`Invalid retry attempts: ${config.retryAttempts}. Must be between 0 and 10.`);
      config.retryAttempts = 3; // Reset to default
    }

    // Validate heartbeat interval
    if (typeof config.heartbeatInterval !== 'number' || config.heartbeatInterval < 1000 || config.heartbeatInterval > 300000) {
      errors.push(`Invalid heartbeat interval: ${config.heartbeatInterval}. Must be between 1000ms and 300000ms.`);
      config.heartbeatInterval = 30000; // Reset to default
    }

    // Validate safety settings
    if (!config.safetySettings || typeof config.safetySettings !== 'object') {
      errors.push('Safety settings must be an object.');
      config.safetySettings = {
        requireApproval: true,
        allowedOperations: ['readFile', 'getWorkspaceFiles', 'getCurrentSelection'],
        maxFileSize: 1024 * 1024,
        allowedExtensions: ['.ts', '.js', '.txt']
      };
    } else {
      // Validate max file size
      if (typeof config.safetySettings.maxFileSize !== 'number' ||
          config.safetySettings.maxFileSize < 1024 ||
          config.safetySettings.maxFileSize > 100 * 1024 * 1024) {
        errors.push(`Invalid max file size: ${config.safetySettings.maxFileSize}. Must be between 1KB and 100MB.`);
        config.safetySettings.maxFileSize = 1024 * 1024; // Reset to 1MB default
      }

      // Validate allowed operations
      if (!Array.isArray(config.safetySettings.allowedOperations)) {
        errors.push('Allowed operations must be an array.');
        config.safetySettings.allowedOperations = ['readFile', 'getWorkspaceFiles', 'getCurrentSelection'];
      } else {
        const validOperations = [
          'readFile', 'writeFile', 'getWorkspaceFiles', 'getCurrentSelection',
          'runCommand', 'showMessage', 'getProjectStructure', 'getDiagnostics'
        ];
        const invalidOps = config.safetySettings.allowedOperations.filter(
          (op: any) => typeof op !== 'string' || !validOperations.includes(op)
        );
        if (invalidOps.length > 0) {
          errors.push(`Invalid allowed operations: ${invalidOps.join(', ')}. Must be from: ${validOperations.join(', ')}`);
          config.safetySettings.allowedOperations = config.safetySettings.allowedOperations.filter(
            (op: any) => typeof op === 'string' && validOperations.includes(op)
          );
        }
      }

      // Validate allowed extensions
      if (!Array.isArray(config.safetySettings.allowedExtensions)) {
        errors.push('Allowed extensions must be an array.');
        config.safetySettings.allowedExtensions = ['.ts', '.js', '.txt'];
      } else {
        const invalidExt = config.safetySettings.allowedExtensions.filter(
          (ext: any) => typeof ext !== 'string' || !ext.startsWith('.')
        );
        if (invalidExt.length > 0) {
          errors.push(`Invalid file extensions: ${invalidExt.join(', ')}. Extensions must start with '.'.`);
          config.safetySettings.allowedExtensions = config.safetySettings.allowedExtensions.filter(
            (ext: any) => typeof ext === 'string' && ext.startsWith('.')
          );
        }
      }
    }

    // Log validation errors but don't throw - we've corrected the values
    if (errors.length > 0) {
      const errorMessage = `Configuration validation issues (corrected automatically):\n${errors.join('\n')}`;
      this.log(errorMessage);
      vscode.window.showWarningMessage('Automatus bridge configuration had issues. Check logs for details.');
    }
  }

  private registerCommands(): void {
    // Command to manually start/stop bridge
    const startCommand = vscode.commands.registerCommand('automatus.bridge.start', async () => {
      if (!this.server) {
        await this.activate();
      } else {
        vscode.window.showInformationMessage('Automatus bridge is already running');
      }
    });

    const stopCommand = vscode.commands.registerCommand('automatus.bridge.stop', async () => {
      if (this.server) {
        await this.server.stop();
        this.server = null;
        vscode.window.showInformationMessage('Automatus bridge stopped');
      }
    });

    const statusCommand = vscode.commands.registerCommand('automatus.bridge.status', () => {
      if (this.server) {
        const state = this.server.getConnectionState();
        const status = `
Automatus Bridge Status:
- Connected: ${state.isConnected}
- Session ID: ${state.sessionId || 'N/A'}
- Messages Sent: ${state.messagesSent}
- Messages Received: ${state.messagesReceived}
- Last Heartbeat: ${state.lastHeartbeat || 'N/A'}
        `.trim();

        vscode.window.showInformationMessage(status, { modal: true });
      } else {
        vscode.window.showWarningMessage('Automatus bridge is not running');
      }
    });

    // Command to open configuration
    const configCommand = vscode.commands.registerCommand('automatus.bridge.configure', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'automatus.bridge');
    });

    const healthCommand = vscode.commands.registerCommand('automatus.bridge.health', () => {
      if (this.server) {
        const health = this.server.getHealthStatus();
        const statusIcon = health.status === 'healthy' ? '✅' :
                          health.status === 'degraded' ? '⚠️' : '❌';

        const uptime = health.uptime ? Math.round(health.uptime / 1000 / 60) : 0; // minutes
        const memoryInfo = health.metrics.performance?.currentMemoryUsage
          ? `Memory: ${health.metrics.performance.currentMemoryUsage}MB`
          : '';
        const message = `${statusIcon} Bridge Health: ${health.status.toUpperCase()}
Uptime: ${uptime} minutes
Issues: ${health.issues.length > 0 ? health.issues.join(', ') : 'None'}
${memoryInfo}
        `;

        vscode.window.showInformationMessage(message, { modal: true });
      } else {
        vscode.window.showWarningMessage('Automatus bridge is not running');
      }
    });

    const metricsCommand = vscode.commands.registerCommand('automatus.bridge.metrics', () => {
      if (this.server) {
        const metrics = this.server.getPerformanceMetrics();
        const panel = vscode.window.createWebviewPanel(
          'automatusBridgeMetrics',
          'Bridge Performance Metrics',
          vscode.ViewColumn.One,
          { enableScripts: false }
        );

        panel.webview.html = this.generateMetricsHTML(metrics);
      } else {
        vscode.window.showWarningMessage('Automatus bridge is not running');
      }
    });

    [startCommand, stopCommand, statusCommand, configCommand, healthCommand, metricsCommand].forEach(cmd => {
      safeRegisterDisposable(cmd);
    });
  }

  private registerStatusBarItem(): void {
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    statusBarItem.text = '$(plug) Automatus';
    statusBarItem.tooltip = 'Automatus TUI Bridge Status';
    statusBarItem.command = 'automatus.bridge.status';

    // Update status based on connection
    const updateStatus = () => {
      if (this.server) {
        const state = this.server.getConnectionState();
        if (state.isConnected) {
          statusBarItem.text = '$(plug) Automatus Connected';
          statusBarItem.color = '#00ff00';
        } else {
          statusBarItem.text = '$(plug) Automatus Listening';
          statusBarItem.color = '#ffff00';
        }
      } else {
        statusBarItem.text = '$(plug) Automatus Stopped';
        statusBarItem.color = '#ff0000';
      }
    };

    updateStatus();
    statusBarItem.show();

    // Update every 5 seconds
    const interval = setInterval(updateStatus, 5000);

    safeRegisterDisposable(statusBarItem);
    safeRegisterDisposable(new vscode.Disposable(() => clearInterval(interval)));
  }

  // Public API for other extension parts
  getBridgeServer(): BridgeServer | null {
    return this.server;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getConnectionState() {
    return this.server?.getConnectionState() || null;
  }

  private generateMetricsHTML(metrics: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 20px 0;
          }
          .metric-card {
            background-color: var(--vscode-input-background);
            padding: 20px;
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
          }
          .metric-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: var(--vscode-textLink-foreground);
          }
          .metric-item {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
            padding: 5px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .metric-value {
            font-weight: bold;
            color: var(--vscode-textPreformat-foreground);
          }
          .command-table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
          }
          .command-table th,
          .command-table td {
            text-align: left;
            padding: 8px 12px;
            border: 1px solid var(--vscode-panel-border);
          }
          .command-table th {
            background-color: var(--vscode-button-background);
            font-weight: bold;
          }
          .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
          }
          .healthy { background-color: #00ff00; }
          .degraded { background-color: #ffff00; }
          .unhealthy { background-color: #ff0000; }
        </style>
      </head>
      <body>
        <h1>Automatus Bridge Performance Metrics</h1>
        <p><em>Report generated: ${metrics.timestamp}</em></p>

        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-title">System Performance</div>
            <div class="metric-item">
              <span>Peak Memory Usage</span>
              <span class="metric-value">${metrics.performance.peakMemoryUsage}MB</span>
            </div>
            <div class="metric-item">
              <span>Current Memory Usage</span>
              <span class="metric-value">${metrics.performance.currentMemoryUsage}MB</span>
            </div>
            <div class="metric-item">
              <span>Message Queue Size</span>
              <span class="metric-value">${metrics.performance.messageQueueSize}</span>
            </div>
            <div class="metric-item">
              <span>Circuit Breakers Open</span>
              <span class="metric-value">${metrics.performance.circuitBreakers.length}</span>
            </div>
          </div>

          <div class="metric-card">
            <div class="metric-title">Connection Status</div>
            <div class="metric-item">
              <span>Connected</span>
              <span class="metric-value">${metrics.connectionState.isConnected ? 'Yes' : 'No'}</span>
            </div>
            <div class="metric-item">
              <span>Messages Sent</span>
              <span class="metric-value">${metrics.connectionState.messagesSent}</span>
            </div>
            <div class="metric-item">
              <span>Messages Received</span>
              <span class="metric-value">${metrics.connectionState.messagesReceived}</span>
            </div>
            <div class="metric-item">
              <span>Session ID</span>
              <span class="metric-value">${metrics.connectionState.sessionId || 'N/A'}</span>
            </div>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-title">Command Performance</div>
          <table class="command-table">
            <thead>
              <tr>
                <th>Command</th>
                <th>Executions</th>
                <th>Errors</th>
                <th>Success Rate</th>
                <th>Avg Time (ms)</th>
                <th>Min/Max Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(metrics.commands).map(([cmd, stats]: [string, any]) => `
                <tr>
                  <td>${cmd}</td>
                  <td>${stats.totalExecutions}</td>
                  <td>${stats.errors}</td>
                  <td>${stats.successRate}</td>
                  <td>${stats.avgExecutionTime}</td>
                  <td>${stats.minExecutionTime}/${stats.maxExecutionTime}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        ${metrics.performance.circuitBreakers.length > 0 ? `
          <div class="metric-card">
            <div class="metric-title">⚠️ Circuit Breakers (Open)</div>
            ${metrics.performance.circuitBreakers.map(([cmd, breaker]: [string, any]) => `
              <div class="metric-item">
                <span>${cmd}</span>
                <span class="metric-value">${breaker.failures} failures</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </body>
      </html>
    `;
  }
}