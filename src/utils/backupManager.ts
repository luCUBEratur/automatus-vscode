import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface BackupInfo {
  backupId: string;
  timestamp: string;
  originalFiles: string[];
  backupDirectory: string;
  metadata: {
    operation: string;
    safetyPhase: number;
    userApproved: boolean;
  };
}

export class BackupManager {
  private static instance: BackupManager;
  private backupHistory: BackupInfo[] = [];

  private constructor() {}

  static getInstance(): BackupManager {
    if (!BackupManager.instance) {
      BackupManager.instance = new BackupManager();
    }
    return BackupManager.instance;
  }

  async createBackup(
    files: string[],
    operation: string,
    safetyPhase: number,
    userApproved: boolean = false
  ): Promise<BackupInfo> {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    // Create backup directory
    const workspaceRoot = vscode.workspace.rootPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace found for backup creation');
    }

    const backupDirectory = path.join(workspaceRoot, '.automatus-backups', backupId);

    try {
      // Ensure backup directory exists
      await fs.mkdir(backupDirectory, { recursive: true });

      // Create backup manifest
      const manifest = {
        backupId,
        timestamp,
        originalFiles: files,
        operation,
        safetyPhase,
        userApproved,
        restoredFiles: []
      };

      // Copy each file to backup
      const backedUpFiles: string[] = [];
      for (const filePath of files) {
        try {
          // Resolve absolute path
          const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

          // Check if file exists
          const fileStats = await fs.stat(absolutePath);
          if (fileStats.isFile()) {
            // Create relative path for backup structure
            const relativePath = path.relative(workspaceRoot, absolutePath);
            const backupFilePath = path.join(backupDirectory, relativePath);

            // Ensure backup subdirectories exist
            await fs.mkdir(path.dirname(backupFilePath), { recursive: true });

            // Copy file content
            const content = await fs.readFile(absolutePath);
            await fs.writeFile(backupFilePath, content);

            backedUpFiles.push(relativePath);
          }
        } catch (error) {
          console.warn(`Failed to backup file ${filePath}:`, error);
          // Continue with other files rather than failing entirely
        }
      }

      // Update manifest with successfully backed up files
      manifest.originalFiles = backedUpFiles;

      // Save manifest
      const manifestPath = path.join(backupDirectory, 'backup-manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const backupInfo: BackupInfo = {
        backupId,
        timestamp,
        originalFiles: backedUpFiles,
        backupDirectory,
        metadata: {
          operation,
          safetyPhase,
          userApproved
        }
      };

      // Add to history
      this.backupHistory.push(backupInfo);

      // Cleanup old backups (keep only last 10)
      await this.cleanupOldBackups();

      return backupInfo;

    } catch (error) {
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async restoreBackup(backupId: string): Promise<void> {
    const backup = this.backupHistory.find(b => b.backupId === backupId);
    if (!backup) {
      throw new Error(`Backup ${backupId} not found`);
    }

    const workspaceRoot = vscode.workspace.rootPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace found for backup restoration');
    }

    try {
      // Load manifest
      const manifestPath = path.join(backup.backupDirectory, 'backup-manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Restore each file
      for (const relativePath of manifest.originalFiles) {
        const backupFilePath = path.join(backup.backupDirectory, relativePath);
        const originalFilePath = path.join(workspaceRoot, relativePath);

        // Read backup content
        const backupContent = await fs.readFile(backupFilePath);

        // Ensure target directory exists
        await fs.mkdir(path.dirname(originalFilePath), { recursive: true });

        // Restore file
        await fs.writeFile(originalFilePath, backupContent);
      }

      // Show success message
      vscode.window.showInformationMessage(
        `Backup ${backupId} restored successfully. ${manifest.originalFiles.length} files restored.`
      );

    } catch (error) {
      throw new Error(`Failed to restore backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    const backup = this.backupHistory.find(b => b.backupId === backupId);
    if (!backup) {
      throw new Error(`Backup ${backupId} not found`);
    }

    try {
      // Remove backup directory
      await fs.rm(backup.backupDirectory, { recursive: true, force: true });

      // Remove from history
      this.backupHistory = this.backupHistory.filter(b => b.backupId !== backupId);

    } catch (error) {
      throw new Error(`Failed to delete backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getBackupHistory(): BackupInfo[] {
    return [...this.backupHistory].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async getBackupSize(backupId: string): Promise<number> {
    const backup = this.backupHistory.find(b => b.backupId === backupId);
    if (!backup) {
      return 0;
    }

    try {
      return await this.calculateDirectorySize(backup.backupDirectory);
    } catch {
      return 0;
    }
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isFile()) {
          const stats = await fs.stat(entryPath);
          totalSize += stats.size;
        } else if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(entryPath);
        }
      }
    } catch {
      // Ignore errors, return current total
    }

    return totalSize;
  }

  private async cleanupOldBackups(): Promise<void> {
    const maxBackups = 10;

    if (this.backupHistory.length <= maxBackups) {
      return;
    }

    // Sort by timestamp and keep only the most recent
    const sortedBackups = this.backupHistory.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const backupsToDelete = sortedBackups.slice(maxBackups);

    for (const backup of backupsToDelete) {
      try {
        await this.deleteBackup(backup.backupId);
      } catch (error) {
        console.warn(`Failed to cleanup old backup ${backup.backupId}:`, error);
      }
    }
  }

  async initializeFromWorkspace(): Promise<void> {
    const workspaceRoot = vscode.workspace.rootPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const backupsRoot = path.join(workspaceRoot, '.automatus-backups');

    try {
      const backupDirs = await fs.readdir(backupsRoot, { withFileTypes: true });

      for (const dir of backupDirs) {
        if (dir.isDirectory() && dir.name.startsWith('backup_')) {
          try {
            const manifestPath = path.join(backupsRoot, dir.name, 'backup-manifest.json');
            const manifestContent = await fs.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(manifestContent);

            const backupInfo: BackupInfo = {
              backupId: manifest.backupId,
              timestamp: manifest.timestamp,
              originalFiles: manifest.originalFiles,
              backupDirectory: path.join(backupsRoot, dir.name),
              metadata: {
                operation: manifest.operation,
                safetyPhase: manifest.safetyPhase,
                userApproved: manifest.userApproved
              }
            };

            this.backupHistory.push(backupInfo);
          } catch {
            // Ignore invalid backups
          }
        }
      }
    } catch {
      // Backup directory doesn't exist yet, that's fine
    }
  }
}