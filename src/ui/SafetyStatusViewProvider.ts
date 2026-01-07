import * as vscode from 'vscode';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';
import { SafeAutomatusClient } from '../automatus-client/SafeAutomatusClient';
import { SAFETY_PHASES } from '../types';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

export class SafetyStatusViewProvider implements vscode.TreeDataProvider<StatusItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<StatusItem | undefined | null | void> = new vscode.EventEmitter<StatusItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<StatusItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private configManager: ConfigurationManager,
    private safetyGuard: SafetyGuard,
    private client: SafeAutomatusClient
  ) {
    // Refresh tree when configuration changes
    this.configManager.onConfigurationChanged(() => {
      this.refresh();
    });

    // Refresh every 30 seconds to update connection status
    setInterval(() => {
      this.refresh();
    }, 30000);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StatusItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatusItem): Thenable<StatusItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootItems());
    } else {
      return Promise.resolve(this.getChildItems(element));
    }
  }

  private getRootItems(): StatusItem[] {
    const config = this.configManager.getConfiguration();
    const phaseInfo = this.configManager.getPhaseInfo();
    const connected = this.client.isConnected();

    return [
      new StatusItem(
        'Safety Phase',
        `Phase ${config.safetyPhase}: ${phaseInfo.name}`,
        vscode.TreeItemCollapsibleState.Expanded,
        'phase',
        this.getPhaseIcon(config.safetyPhase),
        'Current safety phase and restrictions'
      ),
      new StatusItem(
        'Connection',
        connected ? 'Connected' : 'Disconnected',
        vscode.TreeItemCollapsibleState.None,
        'connection',
        connected ? '$(check)' : '$(close)',
        `Server connection: ${config.serverUrl}`
      ),
      new StatusItem(
        'Permissions',
        `${phaseInfo.permissions.length} active`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'permissions',
        '$(shield)',
        'Available operations in current phase'
      ),
      new StatusItem(
        'Safety Settings',
        'Configuration',
        vscode.TreeItemCollapsibleState.Collapsed,
        'settings',
        '$(settings)',
        'Current safety configuration'
      ),
      new StatusItem(
        'Audit Log',
        'View logs',
        vscode.TreeItemCollapsibleState.None,
        'audit',
        '$(file-text)',
        'View audit trail'
      )
    ];
  }

  private getChildItems(element: StatusItem): StatusItem[] {
    const config = this.configManager.getConfiguration();
    const phaseInfo = this.configManager.getPhaseInfo();

    switch (element.contextValue) {
      case 'phase':
        return [
          new StatusItem(
            'Description',
            phaseInfo.description,
            vscode.TreeItemCollapsibleState.None,
            'info',
            '$(info)',
            phaseInfo.description
          ),
          new StatusItem(
            'Capabilities',
            phaseInfo.capabilities.join(', '),
            vscode.TreeItemCollapsibleState.None,
            'info',
            '$(tools)',
            'Available capability packs'
          ),
          new StatusItem(
            'Progress to Next Phase',
            this.getPhaseProgress(config.safetyPhase),
            vscode.TreeItemCollapsibleState.None,
            'progress',
            this.getProgressIcon(config.safetyPhase),
            'Requirements for next phase'
          )
        ];

      case 'permissions':
        return phaseInfo.permissions.map((permission: string) =>
          new StatusItem(
            permission.replace('_', ' '),
            '✓ Allowed',
            vscode.TreeItemCollapsibleState.None,
            'permission',
            '$(check)',
            `Permission: ${permission}`
          )
        );

      case 'settings':
        return [
          new StatusItem(
            'Require Approval',
            config.requireApproval ? 'Enabled' : 'Disabled',
            vscode.TreeItemCollapsibleState.None,
            'setting',
            config.requireApproval ? '$(check)' : '$(close)',
            'User approval required for file operations'
          ),
          new StatusItem(
            'Create Backups',
            config.createBackups ? 'Enabled' : 'Disabled',
            vscode.TreeItemCollapsibleState.None,
            'setting',
            config.createBackups ? '$(check)' : '$(close)',
            'Automatic backup creation before modifications'
          ),
          new StatusItem(
            'Allowed Directories',
            `${config.allowedDirectories.length} configured`,
            vscode.TreeItemCollapsibleState.Collapsed,
            'directories',
            '$(folder)',
            'Directories where file operations are allowed'
          ),
          new StatusItem(
            'Audit Level',
            config.auditLogLevel,
            vscode.TreeItemCollapsibleState.None,
            'setting',
            '$(file-text)',
            'Current audit logging level'
          )
        ];

      case 'directories':
        return config.allowedDirectories.map(dir =>
          new StatusItem(
            dir,
            'Allowed',
            vscode.TreeItemCollapsibleState.None,
            'directory',
            '$(folder)',
            `Allowed directory: ${dir}`
          )
        );

      default:
        return [];
    }
  }

  private getPhaseIcon(phase: number): string {
    switch (phase) {
      case 1: return '$(shield)';
      case 2: return '$(unlock)';
      case 3: return '$(gear)';
      case 4: return '$(rocket)';
      default: return '$(question)';
    }
  }

  private getProgressIcon(currentPhase: number): string {
    if (currentPhase >= 4) {
      return '$(check)';
    }
    return '$(arrow-right)';
  }

  private getPhaseProgress(currentPhase: number): string {
    switch (currentPhase) {
      case 1:
        return 'Ready for Phase 2: Controlled Write Operations';
      case 2:
        return 'Demonstrate safe usage to unlock Phase 3';
      case 3:
        return 'Build safety record for Phase 4';
      case 4:
        return 'Maximum safety phase reached';
      default:
        return 'Unknown phase';
    }
  }
}

export class SafetyStatusViewCommands {
  constructor(
    private configManager: ConfigurationManager,
    private safetyGuard: SafetyGuard,
    private statusProvider: SafetyStatusViewProvider
  ) {}

  registerCommands(context: vscode.ExtensionContext): void {
    const commands = [
      vscode.commands.registerCommand('automatus.safety.upgradePhase', this.upgradePhase.bind(this)),
      vscode.commands.registerCommand('automatus.safety.downgradePhase', this.downgradePhase.bind(this)),
      vscode.commands.registerCommand('automatus.safety.toggleApproval', this.toggleApproval.bind(this)),
      vscode.commands.registerCommand('automatus.safety.toggleBackups', this.toggleBackups.bind(this)),
      vscode.commands.registerCommand('automatus.safety.editDirectories', this.editAllowedDirectories.bind(this)),
      vscode.commands.registerCommand('automatus.safety.viewAudit', this.viewAuditLog.bind(this)),
      vscode.commands.registerCommand('automatus.safety.exportAudit', this.exportAuditLog.bind(this)),
      vscode.commands.registerCommand('automatus.safety.emergencyStop', this.emergencyStop.bind(this))
    ];

    commands.forEach(cmd => safeRegisterDisposable(cmd));
  }

  private async upgradePhase(): Promise<void> {
    const config = this.configManager.getConfiguration();
    const nextPhase = Math.min(config.safetyPhase + 1, 4) as 1 | 2 | 3 | 4;

    if (nextPhase === config.safetyPhase) {
      vscode.window.showInformationMessage('Already at maximum safety phase.');
      return;
    }

    const nextPhaseInfo = SAFETY_PHASES.find(p => p.phase === nextPhase);
    const choice = await vscode.window.showWarningMessage(
      `Upgrade to ${nextPhaseInfo?.name}?\n\nThis will enable: ${nextPhaseInfo?.permissions.join(', ')}`,
      'Upgrade',
      'Cancel'
    );

    if (choice === 'Upgrade') {
      const success = await this.configManager.setSafetyPhase(nextPhase);
      if (success) {
        this.statusProvider.refresh();
      }
    }
  }

  private async downgradePhase(): Promise<void> {
    const config = this.configManager.getConfiguration();
    const prevPhase = Math.max(config.safetyPhase - 1, 1) as 1 | 2 | 3 | 4;

    if (prevPhase === config.safetyPhase) {
      vscode.window.showInformationMessage('Already at minimum safety phase.');
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      `Downgrade to Phase ${prevPhase}? Some features will be disabled.`,
      'Downgrade',
      'Cancel'
    );

    if (choice === 'Downgrade') {
      const success = await this.configManager.setSafetyPhase(prevPhase);
      if (success) {
        this.statusProvider.refresh();
      }
    }
  }

  private async toggleApproval(): Promise<void> {
    const success = await this.configManager.toggleRequireApproval();
    if (success) {
      this.statusProvider.refresh();
    }
  }

  private async toggleBackups(): Promise<void> {
    const success = await this.configManager.toggleBackupCreation();
    if (success) {
      this.statusProvider.refresh();
    }
  }

  private async editAllowedDirectories(): Promise<void> {
    const config = this.configManager.getConfiguration();
    const current = config.allowedDirectories.join(', ');

    const input = await vscode.window.showInputBox({
      prompt: 'Enter allowed directories (comma-separated)',
      value: current,
      placeHolder: './src/temp/, ./tests/generated/'
    });

    if (input !== undefined) {
      const directories = input.split(',').map(d => d.trim()).filter(d => d.length > 0);
      const success = await this.configManager.updateAllowedDirectories(directories);
      if (success) {
        this.statusProvider.refresh();
      }
    }
  }

  private async viewAuditLog(): Promise<void> {
    const auditLog = this.safetyGuard.getAuditLog();

    const panel = vscode.window.createWebviewPanel(
      'automatusAuditLog',
      'Automatus Audit Log',
      vscode.ViewColumn.One,
      {
        enableScripts: false,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getAuditLogHtml(auditLog);
  }

  private async exportAuditLog(): Promise<void> {
    const auditJson = this.safetyGuard.exportAuditLog();

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('automatus-audit-log.json'),
      filters: {
        'JSON files': ['json'],
        'All files': ['*']
      }
    });

    if (uri) {
      try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(auditJson, 'utf8'));
        vscode.window.showInformationMessage(`Audit log exported to ${uri.fsPath}`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to export audit log: ${error}`);
      }
    }
  }

  private async emergencyStop(): Promise<void> {
    const choice = await vscode.window.showErrorMessage(
      'Emergency Stop will halt all Automatus operations immediately. Continue?',
      { modal: true },
      'Emergency Stop',
      'Cancel'
    );

    if (choice === 'Emergency Stop') {
      this.safetyGuard.emergencyStop();
      this.statusProvider.refresh();
    }
  }

  private getAuditLogHtml(auditLog: any[]): string {
    const logEntries = auditLog.map(entry => `
      <div class="log-entry">
        <div class="log-header">
          <span class="timestamp">${new Date(entry.timestamp).toLocaleString()}</span>
          <span class="operation">${entry.operation}</span>
          <span class="phase">Phase ${entry.safetyPhase}</span>
        </div>
        <div class="log-data"><pre>${JSON.stringify(entry.data, null, 2)}</pre></div>
      </div>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 20px;
        }
        .log-entry {
            margin-bottom: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        .log-header {
            background-color: var(--vscode-panel-background);
            padding: 8px 12px;
            display: flex;
            gap: 15px;
            align-items: center;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .timestamp {
            font-family: monospace;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .operation {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .phase {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
        }
        .log-data {
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
        }
        .log-data pre {
            margin: 0;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .summary {
            background-color: var(--vscode-panel-background);
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="summary">
        <h2>🛡️ Automatus Security Audit Log</h2>
        <p>Total entries: ${auditLog.length}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    ${logEntries || '<p>No audit entries found.</p>'}
</body>
</html>`;
  }
}

class StatusItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    iconPath?: string,
    public readonly tooltip?: string
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = contextValue;
    this.iconPath = iconPath ? new vscode.ThemeIcon(iconPath.replace('$(', '').replace(')', '')) : undefined;
    this.tooltip = tooltip;
  }
}