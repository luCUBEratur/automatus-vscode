import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createSafeOutputChannel, safeDispose } from '../utils/outputChannel';
import { BackupManager } from '../utils/backupManager';
import {
  AutomatusConfig,
  CodeChange,
  SafetyGuardConfig,
  SAFETY_PHASES
} from '../types';

export class SafetyGuard {
  private config: AutomatusConfig;
  private guardConfig: SafetyGuardConfig;
  private outputChannel: vscode.OutputChannel;
  private backupManager: BackupManager;
  private auditLog: AuditEntry[] = [];

  constructor(config: AutomatusConfig) {
    this.config = config;
    this.outputChannel = createSafeOutputChannel('Automatus Safety');
    this.backupManager = BackupManager.getInstance();

    // Initialize guard configuration based on safety phase
    this.guardConfig = this.initializeGuardConfig();
  }

  private initializeGuardConfig(): SafetyGuardConfig {
    const phase = SAFETY_PHASES.find(p => p.phase === this.config.safetyPhase);

    if (!phase) {
      throw new Error(`Invalid safety phase: ${this.config.safetyPhase}`);
    }

    return {
      allowedOperations: phase.permissions,
      restrictedPaths: this.getRestrictedPaths(),
      requireApprovalFor: this.getApprovalRequiredOperations(),
      auditLevel: this.config.auditLogLevel as 'minimal' | 'standard' | 'verbose'
    };
  }

  private getRestrictedPaths(): string[] {
    const workspaceRoot = vscode.workspace.rootPath || '';
    const restricted = [
      path.join(workspaceRoot, '.git'),
      path.join(workspaceRoot, 'node_modules'),
      path.join(workspaceRoot, '.vscode'),
      path.join(workspaceRoot, 'package.json'),
      path.join(workspaceRoot, 'package-lock.json')
    ];

    // Add common git patterns
    restricted.push('.git', '/.git');

    // Add system-critical paths
    if (process.platform === 'win32') {
      restricted.push('C:\\Windows', 'C:\\Program Files');
    } else {
      restricted.push('/etc', '/usr', '/bin', '/sbin', '/System');
    }

    return restricted;
  }

  private getApprovalRequiredOperations(): string[] {
    const baseOperations = ['write_file', 'delete_file', 'execute_command'];

    switch (this.config.safetyPhase) {
      case 1:
        return [...baseOperations, 'read_file']; // Everything requires approval in phase 1
      case 2:
        return [...baseOperations, 'write_outside_safe'];
      case 3:
        return ['delete_file', 'execute_command', 'write_critical'];
      case 4:
        return ['delete_file', 'execute_system_command'];
      default:
        return baseOperations;
    }
  }

  async checkPermission(operation: string, target: string): Promise<boolean> {
    this.logAudit('permission_check', { operation, target });

    // Check if operation is allowed in current phase
    if (!this.guardConfig.allowedOperations.includes(operation)) {
      this.logSafety(`Operation '${operation}' not allowed in safety phase ${this.config.safetyPhase}`);
      return false;
    }

    // Check path restrictions
    if (this.isRestrictedPath(target)) {
      this.logSafety(`Access to restricted path denied: ${target}`);
      return false;
    }

    // Check if target is in allowed directories for write operations
    if (operation.includes('write') && !this.isAllowedDirectory(target)) {
      this.logSafety(`Write operation outside allowed directories denied: ${target}`);
      return false;
    }

    return true;
  }

  async requestUserApproval(change: CodeChange): Promise<boolean> {
    const safetyWarnings = this.analyzeSafetyRisks(change);

    let message = `Automatus wants to modify ${change.file}:\n${change.description}`;

    if (safetyWarnings.length > 0) {
      message += `\n\nSafety warnings:\n${safetyWarnings.join('\n')}`;
    }

    const options = safetyWarnings.length > 0 ?
      ['Approve (Risky)', 'Deny'] :
      ['Approve', 'Deny'];

    const choice = await vscode.window.showWarningMessage(message, ...options);

    const approved = choice?.includes('Approve') || false;

    this.logAudit('user_approval', {
      change: change.description,
      file: change.file,
      approved,
      safetyWarnings
    });

    return approved;
  }

  private analyzeSafetyRisks(change: CodeChange): string[] {
    const warnings: string[] = [];
    const content = change.newText.toLowerCase();

    // Check for potentially dangerous patterns
    const riskyPatterns = [
      { pattern: /exec\s*\(/gi, warning: 'Contains code execution functions' },
      { pattern: /eval\s*\(/gi, warning: 'Contains eval() function' },
      { pattern: /require\s*\(/gi, warning: 'Contains require() calls' },
      { pattern: /import\s+.*from\s+['"][^'"]*['"]/gi, warning: 'Contains dynamic imports' },
      { pattern: /fs\.(write|delete|unlink)/gi, warning: 'Contains file system operations' },
      { pattern: /child_process/gi, warning: 'Contains child process operations' },
      { pattern: /\.env|process\.env/gi, warning: 'Accesses environment variables' },
      { pattern: /password|secret|token|key/gi, warning: 'May contain sensitive information' }
    ];

    for (const { pattern, warning } of riskyPatterns) {
      if (pattern.test(content)) {
        warnings.push(warning);
      }
    }

    // Check file extension risks
    const ext = path.extname(change.file).toLowerCase();
    if (['.sh', '.bat', '.ps1', '.exe'].includes(ext)) {
      warnings.push('Modifying executable file');
    }

    if (['.json', '.yaml', '.yml', '.toml'].includes(ext) &&
        change.file.includes('package')) {
      warnings.push('Modifying package configuration');
    }

    return warnings;
  }

  logOperation(operation: string, result: any): void {
    this.logAudit('operation', { operation, result, success: !result.error });
  }

  async createBackup(filePath: string): Promise<string> {
    if (!this.config.createBackups) {
      return '';
    }

    try {
      const backupInfo = await this.backupManager.createBackup(
        [filePath],
        'safety_guard_backup',
        this.config.safetyPhase,
        false // Not user-initiated
      );

      this.logAudit('backup_created', {
        original: filePath,
        backupId: backupInfo.backupId,
        backupDirectory: backupInfo.backupDirectory,
        timestamp: backupInfo.timestamp
      });

      return backupInfo.backupDirectory;
    } catch (error) {
      this.logSafety(`Failed to create backup for ${filePath}: ${error}`);
      throw error;
    }
  }

  private isRestrictedPath(targetPath: string): boolean {
    const normalizedTarget = path.normalize(targetPath);

    return this.guardConfig.restrictedPaths.some(restrictedPath => {
      const normalizedRestricted = path.normalize(restrictedPath);

      // Check if target starts with restricted path
      if (normalizedTarget.startsWith(normalizedRestricted)) {
        return true;
      }

      // Also check if the target contains .git anywhere in the path
      if (normalizedTarget.includes('.git')) {
        return true;
      }

      return false;
    });
  }

  private isAllowedDirectory(targetPath: string): boolean {
    const workspaceRoot = vscode.workspace.rootPath || '';
    const normalizedTarget = path.normalize(targetPath);

    return this.config.allowedDirectories.some(allowedDir => {
      const fullAllowedPath = path.normalize(path.join(workspaceRoot, allowedDir));
      return normalizedTarget.startsWith(fullAllowedPath);
    });
  }

  private logAudit(operation: string, data: any): void {
    const entry: AuditEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      operation,
      data,
      safetyPhase: this.config.safetyPhase,
      userId: 'current-user' // In a real implementation, get actual user ID
    };

    this.auditLog.push(entry);

    // Keep only last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }

    if (this.guardConfig.auditLevel !== 'minimal') {
      this.outputChannel.appendLine(
        `AUDIT [${entry.timestamp}]: ${operation} - ${JSON.stringify(data)}`
      );
    }
  }

  private logSafety(message: string): void {
    const logMessage = `[SAFETY] ${message}`;
    this.outputChannel.appendLine(logMessage);
    console.warn(logMessage);
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  exportAuditLog(): string {
    return JSON.stringify(this.auditLog, null, 2);
  }

  updateConfig(config: AutomatusConfig): void {
    this.config = config;
    this.guardConfig = this.initializeGuardConfig();
    this.logAudit('config_updated', { newPhase: config.safetyPhase });
  }

  emergencyStop(): void {
    this.logAudit('emergency_stop', { reason: 'Manual emergency stop activated' });
    this.logSafety('EMERGENCY STOP ACTIVATED - All AI operations halted');

    // In a real implementation, this would terminate all ongoing operations
    vscode.window.showErrorMessage('Automatus Emergency Stop Activated');
  }

  dispose(): void {
    try {
      // Log final disposal for audit trail
      if (this.config?.auditLogLevel !== 'errors_only') {
        this.logSafety('SafetyGuard disposed');
      }
    } catch (error) {
      console.warn('Error during final audit log:', error);
    }

    // Use safe disposal to prevent VSCode disposal store warnings
    safeDispose(this.outputChannel);

    // Clear references to help with garbage collection
    (this as any).outputChannel = null;
    (this as any).backupManager = null;
    if (this.auditLog) {
      this.auditLog.length = 0; // Clear audit log array
    }
  }
}

interface AuditEntry {
  id: string;
  timestamp: string;
  operation: string;
  data: any;
  safetyPhase: number;
  userId: string;
}
