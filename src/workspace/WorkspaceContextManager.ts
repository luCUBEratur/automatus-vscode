import * as vscode from 'vscode';
import {
  TUIVSCodeBridge,
  WorkspaceInfo,
  IWorkspaceContextManager,
  WorkspaceContext,
  RecentFile,
  ProjectInfo,
  GitStatus,
  DependencyInfo,
  FileQueryArgs,
  ProjectQueryArgs
} from '../bridge/TUIVSCodeBridge';
import { SafetyGuard } from '../safety/SafetyGuard';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

// Workspace-specific types
export interface WorkspaceUpdate {
  type: 'file_change' | 'active_editor_change' | 'workspace_change' | 'git_change';
  timestamp: number;
  data: FileChangeData | EditorChangeData | WorkspaceChangeData | GitChangeData;
}

export interface FileChangeData {
  action: 'create' | 'modify' | 'delete' | 'edit';
  path: string;
  fileName: string;
  changes?: number;
  isDirty?: boolean;
}

export interface EditorChangeData {
  fileName: string | null;
  languageId: string | null;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
}

export interface WorkspaceChangeData {
  added: string[];
  removed: string[];
}

export interface GitChangeData extends GitStatus {
  // Git-specific change data
}

// Configuration interface for file watching
export interface FileWatchConfig {
  watchedExtensions: string[];
  ignoredPatterns: RegExp[];
  maxFileSize: number; // in bytes
  debounceDelay: number; // in milliseconds
}

export class WorkspaceContextManager implements IWorkspaceContextManager {
  private bridge: TUIVSCodeBridge | null = null;
  private safetyGuard: SafetyGuard;
  private configManager: ConfigurationManager;
  private fileSystemWatcher: vscode.FileSystemWatcher | null = null;
  private gitExtension: any = null;
  private disposables: vscode.Disposable[] = [];
  private updateQueue: WorkspaceUpdate[] = [];
  private sendUpdatesTimer: NodeJS.Timeout | null = null;
  private fileWatchConfig: FileWatchConfig;

  constructor(safetyGuard: SafetyGuard, configManager: ConfigurationManager) {
    this.safetyGuard = safetyGuard;
    this.configManager = configManager;
    this.fileWatchConfig = this.initializeFileWatchConfig();
    this.setupWorkspaceWatchers();
    this.initializeGitExtension();
    this.setupConfigurationWatcher();
  }

  private setupConfigurationWatcher(): void {
    // Watch for configuration changes
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('automatus.workspace')) {
        this.updateConfiguration();
      }
    });
    safeRegisterDisposable(configChangeDisposable);
  }

  private initializeFileWatchConfig(): FileWatchConfig {
    const config = this.configManager.getConfiguration();

    // Get user-configurable settings or use defaults
    const userWatchedExtensions = vscode.workspace.getConfiguration('automatus.workspace').get<string[]>('watchedFileExtensions');
    const userIgnoredPatterns = vscode.workspace.getConfiguration('automatus.workspace').get<string[]>('ignoredPatterns');
    const userMaxFileSize = vscode.workspace.getConfiguration('automatus.workspace').get<number>('maxFileSize');
    const userDebounceDelay = vscode.workspace.getConfiguration('automatus.workspace').get<number>('debounceDelay');

    return {
      watchedExtensions: userWatchedExtensions || this.getDefaultFileWatchPatterns(),
      ignoredPatterns: (userIgnoredPatterns || this.getDefaultIgnorePatterns()).map(pattern => new RegExp(pattern)),
      maxFileSize: (userMaxFileSize || 10) * 1024 * 1024, // Convert MB to bytes
      debounceDelay: userDebounceDelay || 500
    };
  }

  private getDefaultIgnorePatterns(): string[] {
    return [
      'node_modules',
      '\\.git',
      '\\.vscode',
      '\\.idea',
      '\\.vs',
      '\\.venv',
      '\\.env',
      '__pycache__',
      '\\.pytest_cache',
      '\\.mypy_cache',
      'target/debug',
      'target/release',
      'build',
      'dist',
      'out',
      'bin',
      'obj',
      '\\.log$',
      '\\.tmp$',
      '\\.temp$',
      '\\.cache$',
      '\\.DS_Store$',
      'Thumbs\\.db$',
      '\\.swp$',
      '\\.swo$',
      '~$'
    ];
  }

  setBridge(bridge: TUIVSCodeBridge): void {
    this.bridge = bridge;
    // Send initial workspace context when bridge is connected
    this.sendInitialWorkspaceContext();
  }

  updateConfiguration(): void {
    const newConfig = this.initializeFileWatchConfig();
    const configChanged = JSON.stringify(this.fileWatchConfig) !== JSON.stringify(newConfig);

    if (configChanged) {
      this.fileWatchConfig = newConfig;
      this.safetyGuard.logOperation('workspace_config_updated', {
        watchedExtensions: this.fileWatchConfig.watchedExtensions.length,
        ignoredPatterns: this.fileWatchConfig.ignoredPatterns.length,
        maxFileSize: this.fileWatchConfig.maxFileSize,
        debounceDelay: this.fileWatchConfig.debounceDelay
      });

      // Restart file watcher with new configuration
      this.restartFileWatcher();
    }
  }

  private setupFileWatcher(): void {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], `**/*.{${this.fileWatchConfig.watchedExtensions.join(',')}}`),
        false, // ignoreCreateEvents
        false, // ignoreChangeEvents
        false  // ignoreDeleteEvents
      );

      this.setupFileWatcherEvents();
      safeRegisterDisposable(this.fileSystemWatcher);
    }
  }

  private restartFileWatcher(): void {
    // Dispose existing watcher
    if (this.fileSystemWatcher) {
      this.fileSystemWatcher.dispose();
    }

    // Recreate watcher with new configuration
    this.setupFileWatcher();
  }

  private setupFileWatcherEvents(): void {
    if (!this.fileSystemWatcher) return;

    this.fileSystemWatcher.onDidCreate((uri) => {
      if (this.shouldTrackFile(uri)) {
        this.queueUpdate({
          type: 'file_change',
          timestamp: Date.now(),
          data: { action: 'create', path: uri.fsPath, fileName: vscode.workspace.asRelativePath(uri) }
        });
      }
    });

    this.fileSystemWatcher.onDidChange((uri) => {
      if (this.shouldTrackFile(uri)) {
        this.queueUpdate({
          type: 'file_change',
          timestamp: Date.now(),
          data: { action: 'modify', path: uri.fsPath, fileName: vscode.workspace.asRelativePath(uri) }
        });
      }
    });

    this.fileSystemWatcher.onDidDelete((uri) => {
      if (this.shouldTrackFile(uri)) {
        this.queueUpdate({
          type: 'file_change',
          timestamp: Date.now(),
          data: { action: 'delete', path: uri.fsPath, fileName: vscode.workspace.asRelativePath(uri) }
        });
      }
    });
  }

  private setupWorkspaceWatchers(): void {
    // Watch for active editor changes
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.queueUpdate({
        type: 'active_editor_change',
        timestamp: Date.now(),
        data: {
          fileName: editor?.document.fileName || null,
          languageId: editor?.document.languageId || null,
          selection: editor ? {
            start: { line: editor.selection.start.line, character: editor.selection.start.character },
            end: { line: editor.selection.end.line, character: editor.selection.end.character }
          } : null
        }
      });
    });
    safeRegisterDisposable(editorChangeDisposable);

    // Watch for workspace folder changes
    const workspaceFoldersChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      this.queueUpdate({
        type: 'workspace_change',
        timestamp: Date.now(),
        data: {
          added: event.added.map(folder => folder.uri.fsPath),
          removed: event.removed.map(folder => folder.uri.fsPath)
        }
      });
    });
    safeRegisterDisposable(workspaceFoldersChangeDisposable);

    // Setup file watcher with configuration
    this.setupFileWatcher();

    // Watch for text document changes
    const textDocumentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme === 'file') {
        this.queueUpdate({
          type: 'file_change',
          timestamp: Date.now(),
          data: {
            action: 'edit',
            path: event.document.uri.fsPath,
            fileName: vscode.workspace.asRelativePath(event.document.uri),
            changes: event.contentChanges.length,
            isDirty: event.document.isDirty
          }
        });
      }
    });
    safeRegisterDisposable(textDocumentChangeDisposable);
  }

  private async initializeGitExtension(): Promise<void> {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
      if (gitExtension) {
        this.gitExtension = gitExtension.getAPI(1);

        // Watch for git changes
        if (this.gitExtension && this.gitExtension.repositories.length > 0) {
          const repo = this.gitExtension.repositories[0];

          repo.state.onDidChange(() => {
            this.queueUpdate({
              type: 'git_change',
              timestamp: Date.now(),
              data: this.getGitStatus()
            });
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.safetyGuard.logOperation('git_extension_init_failed', {
        error: errorMsg,
        hasGitExtension: !!vscode.extensions.getExtension('vscode.git')
      });
      console.warn('Failed to initialize Git extension:', errorMsg);
    }
  }

  private queueUpdate(update: WorkspaceUpdate): void {
    this.updateQueue.push(update);

    // Debounce updates to avoid flooding
    if (this.sendUpdatesTimer) {
      clearTimeout(this.sendUpdatesTimer);
    }

    this.sendUpdatesTimer = setTimeout(() => {
      this.sendQueuedUpdates();
    }, this.fileWatchConfig.debounceDelay);
  }

  private async sendQueuedUpdates(): Promise<void> {
    if (this.updateQueue.length === 0 || !this.bridge) {
      return;
    }

    const updates = [...this.updateQueue];
    this.updateQueue = [];

    try {
      // Group updates by type for efficiency
      const groupedUpdates = this.groupUpdatesByType(updates);

      // Send each group as a single message
      for (const [type, updateGroup] of Object.entries(groupedUpdates)) {
        await this.sendWorkspaceUpdate(type, updateGroup);
      }

      this.safetyGuard.logOperation('workspace_updates_sent', {
        updateCount: updates.length,
        types: Object.keys(groupedUpdates)
      });

    } catch (error) {
      console.error('Failed to send workspace updates:', error);
      this.safetyGuard.logOperation('workspace_updates_failed', {
        error: error instanceof Error ? error.message : String(error),
        updateCount: updates.length
      });
    }
  }

  private groupUpdatesByType(updates: WorkspaceUpdate[]): Record<string, WorkspaceUpdate[]> {
    const grouped: Record<string, WorkspaceUpdate[]> = {};

    for (const update of updates) {
      if (!grouped[update.type]) {
        grouped[update.type] = [];
      }
      grouped[update.type].push(update);
    }

    return grouped;
  }

  private async sendWorkspaceUpdate(type: string, updates: WorkspaceUpdate[]): Promise<void> {
    if (!this.bridge) return;

    // Send update to all connected TUI clients
    const connections = (this.bridge as any).connections || new Map();

    for (const [connectionId, connection] of connections) {
      if (connection.authenticated) {
        try {
          (this.bridge as any).sendMessage(connectionId, {
            type: 'workspace_update',
            data: {
              updateType: type,
              updates: updates,
              timestamp: Date.now()
            }
          });
        } catch (error) {
          console.error(`Failed to send update to connection ${connectionId}:`, error);
        }
      }
    }
  }

  async getCurrentWorkspaceContext(): Promise<WorkspaceContext> {
    const workspaceInfo = this.getBasicWorkspaceInfo();
    const recentFiles = await this.getRecentFiles();
    const activeProject = await this.getActiveProjectInfo();
    const gitStatus = this.getGitStatus();
    const dependencies = await this.getDependencies();

    return {
      workspaceInfo,
      recentFiles,
      activeProject,
      gitStatus,
      dependencies
    };
  }

  private getBasicWorkspaceInfo(): WorkspaceInfo {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const activeEditor = vscode.window.activeTextEditor;
    const openFiles = vscode.workspace.textDocuments
      .filter(doc => doc.uri.scheme === 'file')
      .map(doc => ({
        fileName: doc.fileName,
        languageId: doc.languageId,
        isDirty: doc.isDirty
      }));

    return {
      rootPath: workspaceFolders ? workspaceFolders[0].uri.fsPath : undefined,
      workspaceFolders,
      activeEditor: activeEditor ? {
        fileName: activeEditor.document.fileName,
        languageId: activeEditor.document.languageId,
        lineCount: activeEditor.document.lineCount,
        isDirty: activeEditor.document.isDirty,
        selection: {
          start: {
            line: activeEditor.selection.start.line,
            character: activeEditor.selection.start.character
          },
          end: {
            line: activeEditor.selection.end.line,
            character: activeEditor.selection.end.character
          }
        }
      } : null,
      openFiles
    };
  }

  private async getRecentFiles(): Promise<RecentFile[]> {
    const recentFiles: RecentFile[] = [];
    const openFiles = vscode.workspace.textDocuments.filter(doc => doc.uri.scheme === 'file');
    const activeEditor = vscode.window.activeTextEditor;

    for (const doc of openFiles) {
      try {
        const stat = await vscode.workspace.fs.stat(doc.uri);
        recentFiles.push({
          path: doc.uri.fsPath,
          lastModified: stat.mtime,
          languageId: doc.languageId,
          isActive: activeEditor?.document.uri.fsPath === doc.uri.fsPath,
          isDirty: doc.isDirty
        });
      } catch (error) {
        // File might have been deleted, skip it
        this.safetyGuard.logOperation('recent_file_stat_failed', {
          path: doc.uri.fsPath,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
    }

    // Sort by last modified (most recent first)
    recentFiles.sort((a, b) => b.lastModified - a.lastModified);

    return recentFiles.slice(0, 20); // Return top 20 recent files
  }

  private async getActiveProjectInfo(): Promise<ProjectInfo | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const rootUri = workspaceFolders[0].uri;

    try {
      // Check for common project files
      const configFiles: string[] = [];
      const buildCommands: string[] = [];
      let projectType: ProjectInfo['type'] = 'unknown';

      // Check for package.json (Node.js)
      try {
        const packageJsonUri = vscode.Uri.joinPath(rootUri, 'package.json');
        await vscode.workspace.fs.stat(packageJsonUri);
        configFiles.push('package.json');
        projectType = 'npm';
        buildCommands.push('npm install', 'npm run build', 'npm test');
      } catch (error) {
        // package.json doesn't exist, continue checking other project types
      }

      // Check for requirements.txt or setup.py (Python)
      try {
        const requirementsUri = vscode.Uri.joinPath(rootUri, 'requirements.txt');
        await vscode.workspace.fs.stat(requirementsUri);
        configFiles.push('requirements.txt');
        projectType = 'python';
        buildCommands.push('pip install -r requirements.txt', 'python setup.py build');
      } catch (error) {
        // requirements.txt doesn't exist, continue checking other files
      }

      try {
        const setupPyUri = vscode.Uri.joinPath(rootUri, 'setup.py');
        await vscode.workspace.fs.stat(setupPyUri);
        configFiles.push('setup.py');
        projectType = 'python';
      } catch (error) {
        // setup.py doesn't exist, continue checking other project types
      }

      // Check for Cargo.toml (Rust)
      try {
        const cargoUri = vscode.Uri.joinPath(rootUri, 'Cargo.toml');
        await vscode.workspace.fs.stat(cargoUri);
        configFiles.push('Cargo.toml');
        projectType = 'rust';
        buildCommands.push('cargo build', 'cargo test', 'cargo run');
      } catch (error) {
        // Cargo.toml doesn't exist, continue checking other project types
      }

      // Check for pom.xml or build.gradle (Java)
      try {
        const pomUri = vscode.Uri.joinPath(rootUri, 'pom.xml');
        await vscode.workspace.fs.stat(pomUri);
        configFiles.push('pom.xml');
        projectType = 'java';
        buildCommands.push('mvn compile', 'mvn test', 'mvn package');
      } catch (error) {
        // pom.xml doesn't exist, continue checking other project types
      }

      try {
        const gradleUri = vscode.Uri.joinPath(rootUri, 'build.gradle');
        await vscode.workspace.fs.stat(gradleUri);
        configFiles.push('build.gradle');
        projectType = 'java';
        buildCommands.push('gradle build', 'gradle test');
      } catch (error) {
        // build.gradle doesn't exist, continue checking other project types
      }

      const projectName = vscode.workspace.name || rootPath.split('/').pop() || 'Unknown Project';

      return {
        name: projectName,
        rootPath,
        type: projectType,
        configFiles,
        buildCommands
      };

    } catch (error) {
      console.error('Failed to get project info:', error);
      return null;
    }
  }

  private getGitStatus(): GitStatus | null {
    if (!this.gitExtension || this.gitExtension.repositories.length === 0) {
      return null;
    }

    const repo = this.gitExtension.repositories[0];
    const state = repo.state;

    return {
      branch: state.HEAD?.name || 'unknown',
      hasChanges: state.workingTreeChanges.length > 0 || state.indexChanges.length > 0,
      changedFiles: [
        ...state.workingTreeChanges.map((change: any) => change.uri.fsPath),
        ...state.indexChanges.map((change: any) => change.uri.fsPath)
      ],
      hasRemote: state.remotes.length > 0,
      ahead: state.HEAD?.ahead || 0,
      behind: state.HEAD?.behind || 0
    };
  }

  private async getDependencies(): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      return dependencies;
    }

    const rootUri = workspaceFolders[0].uri;

    // Parse package.json dependencies
    try {
      const packageJsonUri = vscode.Uri.joinPath(rootUri, 'package.json');
      const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonUri);
      const packageJson = JSON.parse(packageJsonContent.toString());

      if (packageJson.dependencies) {
        for (const [name, version] of Object.entries(packageJson.dependencies)) {
          dependencies.push({
            name,
            version: version as string,
            type: 'production',
            source: 'package.json'
          });
        }
      }

      if (packageJson.devDependencies) {
        for (const [name, version] of Object.entries(packageJson.devDependencies)) {
          dependencies.push({
            name,
            version: version as string,
            type: 'development',
            source: 'package.json'
          });
        }
      }
    } catch (error) {
      // package.json doesn't exist or is invalid
      this.safetyGuard.logOperation('package_json_parse_failed', {
        error: error instanceof Error ? error.message : String(error),
        rootPath: workspaceFolders[0].uri.fsPath
      });
    }

    // Parse requirements.txt dependencies
    try {
      const requirementsUri = vscode.Uri.joinPath(rootUri, 'requirements.txt');
      const requirementsContent = await vscode.workspace.fs.readFile(requirementsUri);
      const lines = requirementsContent.toString().split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([^=><\s]+)([=><].*)?$/);
          if (match) {
            dependencies.push({
              name: match[1],
              version: match[2] || 'latest',
              type: 'production',
              source: 'requirements.txt'
            });
          }
        }
      }
    } catch (error) {
      // requirements.txt doesn't exist
      this.safetyGuard.logOperation('requirements_txt_parse_failed', {
        error: error instanceof Error ? error.message : String(error),
        rootPath: workspaceFolders[0].uri.fsPath
      });
    }

    return dependencies;
  }

  private async sendInitialWorkspaceContext(): Promise<void> {
    if (!this.bridge) return;

    try {
      const context = await this.getCurrentWorkspaceContext();

      // Send to all authenticated connections
      const connections = (this.bridge as any).connections || new Map();

      for (const [connectionId, connection] of connections) {
        if (connection.authenticated) {
          try {
            (this.bridge as any).sendMessage(connectionId, {
              type: 'initial_workspace_context',
              data: context,
              timestamp: Date.now()
            });
          } catch (error) {
            console.error(`Failed to send initial context to connection ${connectionId}:`, error);
          }
        }
      }

      this.safetyGuard.logOperation('initial_workspace_context_sent', {
        hasWorkspace: !!context.workspaceInfo.rootPath,
        recentFilesCount: context.recentFiles.length,
        projectType: context.activeProject?.type || 'unknown'
      });

    } catch (error) {
      console.error('Failed to send initial workspace context:', error);
      this.safetyGuard.logOperation('initial_workspace_context_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Command handlers for TUI requests
  async handleWorkspaceQuery(args: any): Promise<WorkspaceContext> {
    return this.getCurrentWorkspaceContext();
  }

  async handleFileQuery(args: FileQueryArgs): Promise<RecentFile[]> {
    if (args.path) {
      // Get specific file info
      try {
        const uri = vscode.Uri.file(args.path);
        const stat = await vscode.workspace.fs.stat(uri);
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === args.path);
        const activeEditor = vscode.window.activeTextEditor;

        return [{
          path: args.path,
          lastModified: stat.mtime,
          languageId: doc?.languageId || 'unknown',
          isActive: activeEditor?.document.uri.fsPath === args.path,
          isDirty: doc?.isDirty || false
        }];
      } catch (error) {
        throw new Error(`File not found: ${args.path}`);
      }
    } else {
      // Get recent files with optional pattern filtering
      const recentFiles = await this.getRecentFiles();

      if (args.pattern) {
        const regex = new RegExp(args.pattern, 'i');
        return recentFiles
          .filter(file => regex.test(file.path))
          .slice(0, args.limit || 10);
      }

      return recentFiles.slice(0, args.limit || 10);
    }
  }

  async handleProjectQuery(args: ProjectQueryArgs): Promise<ProjectInfo | null> {
    const projectInfo = await this.getActiveProjectInfo();

    // Apply query options if needed
    if (projectInfo && !args.includeConfigDetails) {
      // Could filter out config file details if requested
    }
    if (projectInfo && !args.includeBuildCommands) {
      // Could filter out build commands if requested
    }

    return projectInfo;
  }

  private getDefaultFileWatchPatterns(): string[] {
    // Define file extensions that are important for workspace context
    return [
      // Source code files
      'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
      'py', 'rb', 'java', 'kt', 'scala',
      'go', 'rs', 'cpp', 'c', 'h', 'hpp',
      'cs', 'vb', 'fs', 'php', 'swift',
      'dart', 'lua', 'r', 'jl', 'nim',

      // Configuration files
      'json', 'yaml', 'yml', 'toml', 'ini', 'cfg',
      'xml', 'plist', 'properties', 'conf',

      // Documentation and markup
      'md', 'rst', 'txt', 'adoc', 'tex',

      // Web files
      'html', 'htm', 'css', 'scss', 'sass', 'less',

      // Data files
      'sql', 'csv', 'tsv', 'graphql', 'proto',

      // Shell and scripts
      'sh', 'bash', 'zsh', 'fish', 'ps1', 'cmd', 'bat',

      // Package/dependency files
      'lock', 'sum'
    ];
  }

  private shouldTrackFile(uri: vscode.Uri): boolean {
    const path = uri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(uri);

    // Check if file should be ignored using configurable patterns
    for (const pattern of this.fileWatchConfig.ignoredPatterns) {
      if (pattern.test(relativePath) || pattern.test(path)) {
        return false;
      }
    }

    // Schedule async size check and return true for immediate tracking
    this.checkFileSizeAsync(uri);
    return true;
  }

  private async checkFileSizeAsync(uri: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);

      if (stat.size > this.fileWatchConfig.maxFileSize) {
        // Log oversized files for monitoring
        this.safetyGuard.logOperation('file_size_limit_exceeded', {
          path: uri.fsPath,
          size: stat.size,
          maxSize: this.fileWatchConfig.maxFileSize
        });
      }
    } catch (error) {
      // File might have been deleted or is inaccessible
      this.safetyGuard.logOperation('file_stat_failed', {
        path: uri.fsPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  dispose(): void {
    if (this.sendUpdatesTimer) {
      clearTimeout(this.sendUpdatesTimer);
    }

    this.disposables.forEach(disposable => {
      try {
        disposable.dispose();
      } catch (error) {
        // Ignore disposal errors during cleanup
        this.safetyGuard.logOperation('workspace_manager_disposal_error', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    if (this.fileSystemWatcher) {
      this.fileSystemWatcher.dispose();
    }
  }
}