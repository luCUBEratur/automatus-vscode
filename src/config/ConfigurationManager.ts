import * as vscode from 'vscode';
import { AutomatusConfig, SAFETY_PHASES } from '../types';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private config: AutomatusConfig;
  private configChangeEmitter = new vscode.EventEmitter<AutomatusConfig>();

  public readonly onConfigurationChanged = this.configChangeEmitter.event;

  private constructor() {
    this.config = this.loadConfiguration();
    this.setupConfigurationWatcher();
  }

  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  getConfiguration(): AutomatusConfig {
    return { ...this.config };
  }

  private loadConfiguration(): AutomatusConfig {
    const vsconfig = vscode.workspace.getConfiguration('automatus');

    return {
      kernelMode: vsconfig.get('kernel.mode', 'external') as 'embedded' | 'external',
      safetyPhase: vsconfig.get('safety.currentPhase', 1) as 1 | 2 | 3 | 4,
      allowedDirectories: vsconfig.get('safety.allowedDirectories', ['./src/temp/', './tests/generated/']),
      requireApproval: vsconfig.get('safety.requireApproval', true),
      createBackups: vsconfig.get('safety.createBackups', true),
      codeGenerationMode: vsconfig.get('codeGeneration.mode', 'preview_only') as 'preview_only' | 'controlled_write' | 'full_access',
      auditLogLevel: vsconfig.get('audit.logLevel', 'all') as 'all' | 'changes_only' | 'errors_only',
      serverUrl: vsconfig.get('server.url', 'http://localhost:9000'),
      bridgePort: vsconfig.get('bridge.port', 19888),
      bridgeTimeout: vsconfig.get('bridge.timeout', 30000),
      bridgeRetryAttempts: vsconfig.get('bridge.retryAttempts', 3),
      bridgeEnableHeartbeat: vsconfig.get('bridge.enableHeartbeat', true),
      bridgeHeartbeatInterval: vsconfig.get('bridge.heartbeatInterval', 30000)
    };
  }

  private setupConfigurationWatcher(): void {
    const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('automatus')) {
        const newConfig = this.loadConfiguration();
        const oldPhase = this.config.safetyPhase;

        this.config = newConfig;

        // Validate configuration changes
        this.validateConfigurationChange(oldPhase, newConfig.safetyPhase);

        this.configChangeEmitter.fire(newConfig);
      }
    });

    // Register the watcher for safe disposal
    safeRegisterDisposable(watcher);
  }

  private validateConfigurationChange(oldPhase: number, newPhase: number): void {
    // Prevent jumping phases without proper progression
    if (newPhase > oldPhase + 1) {
      vscode.window.showWarningMessage(
        `Cannot jump from Phase ${oldPhase} to Phase ${newPhase}. ` +
        'Safety phases must be progressed incrementally.',
        'Revert to Safe Phase'
      ).then((choice) => {
        if (choice) {
          this.setSafetyPhase(Math.min(oldPhase + 1, 4) as 1 | 2 | 3 | 4);
        }
      });
    }

    // Warn about phase regression
    if (newPhase < oldPhase) {
      vscode.window.showInformationMessage(
        `Safety phase reduced from ${oldPhase} to ${newPhase}. ` +
        'Some features may no longer be available.'
      );
    }

    // Validate phase-specific requirements
    this.validatePhaseRequirements(newPhase);
  }

  private validatePhaseRequirements(phase: number): void {
    const phaseInfo = SAFETY_PHASES.find(p => p.phase === phase);
    if (!phaseInfo) {
      return;
    }

    switch (phase) {
      case 2:
        if (this.config.allowedDirectories.length === 0) {
          vscode.window.showWarningMessage(
            'Phase 2 requires at least one allowed directory for controlled writes.'
          );
        }
        break;
      case 3:
        if (!this.config.requireApproval && !this.config.createBackups) {
          vscode.window.showWarningMessage(
            'Phase 3 requires either user approval or backup creation for safety.'
          );
        }
        break;
      case 4:
        if (this.config.auditLogLevel === 'errors_only') {
          vscode.window.showWarningMessage(
            'Phase 4 should use comprehensive audit logging for safety tracking.'
          );
        }
        break;
    }
  }

  async setSafetyPhase(phase: 1 | 2 | 3 | 4): Promise<boolean> {
    try {
      const config = vscode.workspace.getConfiguration('automatus');
      await config.update('safety.currentPhase', phase, vscode.ConfigurationTarget.Workspace);

      const phaseInfo = SAFETY_PHASES.find(p => p.phase === phase);
      vscode.window.showInformationMessage(
        `Safety phase updated to ${phase}: ${phaseInfo?.name || 'Unknown'}`
      );

      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update safety phase: ${error}`);
      return false;
    }
  }

  async updateAllowedDirectories(directories: string[]): Promise<boolean> {
    try {
      const config = vscode.workspace.getConfiguration('automatus');
      await config.update('safety.allowedDirectories', directories, vscode.ConfigurationTarget.Workspace);
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update allowed directories: ${error}`);
      return false;
    }
  }

  async setServerUrl(url: string): Promise<boolean> {
    try {
      // Validate URL format
      new URL(url); // This will throw if invalid

      const config = vscode.workspace.getConfiguration('automatus');
      await config.update('server.url', url, vscode.ConfigurationTarget.Workspace);
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Invalid server URL: ${error}`);
      return false;
    }
  }

  async toggleRequireApproval(): Promise<boolean> {
    try {
      const newValue = !this.config.requireApproval;
      const config = vscode.workspace.getConfiguration('automatus');
      await config.update('safety.requireApproval', newValue, vscode.ConfigurationTarget.Workspace);

      vscode.window.showInformationMessage(
        `User approval requirement ${newValue ? 'enabled' : 'disabled'}`
      );

      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to toggle approval requirement: ${error}`);
      return false;
    }
  }

  async toggleBackupCreation(): Promise<boolean> {
    try {
      const newValue = !this.config.createBackups;
      const config = vscode.workspace.getConfiguration('automatus');
      await config.update('safety.createBackups', newValue, vscode.ConfigurationTarget.Workspace);

      vscode.window.showInformationMessage(
        `Backup creation ${newValue ? 'enabled' : 'disabled'}`
      );

      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to toggle backup creation: ${error}`);
      return false;
    }
  }

  exportConfiguration(): string {
    return JSON.stringify({
      automatus: this.config,
      exported: new Date().toISOString(),
      version: '0.1.0'
    }, null, 2);
  }

  async importConfiguration(configJson: string): Promise<boolean> {
    try {
      const imported = JSON.parse(configJson);
      const importedConfig = imported.automatus as AutomatusConfig;

      // Validate imported configuration
      if (!this.validateImportedConfig(importedConfig)) {
        throw new Error('Invalid configuration format');
      }

      // Apply configuration
      const config = vscode.workspace.getConfiguration('automatus');
      const updates = [
        config.update('kernel.mode', importedConfig.kernelMode),
        config.update('safety.currentPhase', importedConfig.safetyPhase),
        config.update('safety.allowedDirectories', importedConfig.allowedDirectories),
        config.update('safety.requireApproval', importedConfig.requireApproval),
        config.update('safety.createBackups', importedConfig.createBackups),
        config.update('codeGeneration.mode', importedConfig.codeGenerationMode),
        config.update('audit.logLevel', importedConfig.auditLogLevel),
        config.update('server.url', importedConfig.serverUrl)
      ];

      await Promise.all(updates);

      vscode.window.showInformationMessage('Configuration imported successfully');
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to import configuration: ${error}`);
      return false;
    }
  }

  private validateImportedConfig(config: any): config is AutomatusConfig {
    return (
      config &&
      typeof config.kernelMode === 'string' &&
      ['embedded', 'external'].includes(config.kernelMode) &&
      typeof config.safetyPhase === 'number' &&
      [1, 2, 3, 4].includes(config.safetyPhase) &&
      Array.isArray(config.allowedDirectories) &&
      typeof config.requireApproval === 'boolean' &&
      typeof config.createBackups === 'boolean' &&
      typeof config.codeGenerationMode === 'string' &&
      ['preview_only', 'controlled_write', 'full_access'].includes(config.codeGenerationMode) &&
      typeof config.auditLogLevel === 'string' &&
      ['all', 'changes_only', 'errors_only'].includes(config.auditLogLevel) &&
      typeof config.serverUrl === 'string'
    );
  }

  getPhaseInfo(phase?: number): any {
    const targetPhase = phase || this.config.safetyPhase;
    return SAFETY_PHASES.find(p => p.phase === targetPhase);
  }

  canProgressToPhase(targetPhase: number): boolean {
    return targetPhase <= this.config.safetyPhase + 1;
  }

  dispose(): void {
    try {
      this.configChangeEmitter.dispose();
    } catch (error) {
      // Ignore disposal errors that can occur when the VS Code disposable store is already disposed
    }
  }
}