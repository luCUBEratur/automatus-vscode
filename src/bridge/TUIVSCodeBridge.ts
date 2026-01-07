import * as vscode from 'vscode';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';
import { AuthenticationManager, TokenPayload } from './AuthenticationManager';
import { TUICommand, VSCodeResponse } from './types';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

// Interface for WorkspaceContextManager to ensure type safety
export interface IWorkspaceContextManager {
  getCurrentWorkspaceContext(): Promise<WorkspaceContext>;
  handleFileQuery(args: FileQueryArgs): Promise<RecentFile[]>;
  handleProjectQuery(args: ProjectQueryArgs): Promise<ProjectInfo | null>;
  setBridge(bridge: TUIVSCodeBridge): void;
}

// Specific argument types for workspace queries
export interface FileQueryArgs {
  path?: string;
  pattern?: string;
  limit?: number;
}

export interface ProjectQueryArgs {
  includeConfigDetails?: boolean;
  includeBuildCommands?: boolean;
}

// Import workspace-related types that need to be available in bridge
export interface WorkspaceContext {
  workspaceInfo: WorkspaceInfo;
  recentFiles: RecentFile[];
  activeProject: ProjectInfo | null;
  gitStatus: GitStatus | null;
  dependencies: DependencyInfo[];
}

export interface RecentFile {
  path: string;
  lastModified: number;
  languageId: string;
  isActive: boolean;
  isDirty: boolean;
}

export interface ProjectInfo {
  name: string;
  rootPath: string;
  type: 'npm' | 'python' | 'java' | 'rust' | 'unknown';
  configFiles: string[];
  buildCommands: string[];
}

export interface GitStatus {
  branch: string;
  hasChanges: boolean;
  changedFiles: string[];
  hasRemote: boolean;
  ahead: number;
  behind: number;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'production' | 'development';
  source: string; // package.json, requirements.txt, etc.
}

// Bridge-specific command interfaces (different from formal protocol in types.ts)
// Note: These are legacy interfaces that should eventually be migrated to the formal protocol

// Specific payload types for each command
export interface WorkspaceQueryPayload {
  queryType?: 'basic' | 'context' | 'files' | 'project';
  path?: string;
  pattern?: string;
  limit?: number;
  includeConfigDetails?: boolean;
  includeBuildCommands?: boolean;
}

export interface FileOperationPayload {
  operation: 'read' | 'create' | 'modify' | 'delete';
  path: string;
  content?: string;
  encoding?: string;
}

interface CodeContext {
  selectedText?: string;
  currentFile?: string;
  cursorPosition?: { line: number; character: number };
  selection?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface CommandExecutionPayload {
  commandName: string;
  args?: (string | number | boolean | object)[];
  context?: CodeContext;
  requireApproval?: boolean;
  safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access';
}

export interface ContextRequestPayload {
  contextType: 'active_editor' | 'selection' | 'project_structure';
}

export interface AuthRequestPayload {
  token: string;
}

// Discriminated union type for type-safe bridge commands
export type BridgeInternalCommand =
  | {
      id: string;
      type: 'workspace_query';
      payload: WorkspaceQueryPayload;
      timestamp: number;
      requiresApproval?: boolean;
    }
  | {
      id: string;
      type: 'file_operation';
      payload: FileOperationPayload;
      timestamp: number;
      requiresApproval?: boolean;
    }
  | {
      id: string;
      type: 'command_execution';
      payload: CommandExecutionPayload;
      timestamp: number;
      requiresApproval?: boolean;
    }
  | {
      id: string;
      type: 'context_request';
      payload: ContextRequestPayload;
      timestamp: number;
      requiresApproval?: boolean;
    }
  | {
      id: string;
      type: 'auth_request';
      payload: AuthRequestPayload;
      timestamp: number;
      requiresApproval?: boolean;
    };

// Specific response data types
interface WorkspaceResponseData extends WorkspaceContext {}

interface FileOperationResponseData {
  success: boolean;
  path: string;
  operation: string;
  content?: string;
  languageId?: string;
  lineCount?: number;
}

interface CommandExecutionResponseData {
  result: string | number | boolean | object | null;
  metadata: {
    executionTime: number;
    safetyLevel: string;
    commandName: string;
    timestamp: number;
  };
}

interface AuthResponseData {
  authenticated: boolean;
  sessionId: string;
  safetyPhase: number;
  permissions: string[];
  capabilities: string[];
  serverInfo: {
    version: string;
    supportedProtocols: string[];
    maxMessageSize: number;
    securityFeatures: string[];
  };
}

// Union type for all possible response data
type BridgeResponseData =
  | WorkspaceResponseData
  | FileOperationResponseData
  | CommandExecutionResponseData
  | AuthResponseData
  | RecentFile[]
  | ProjectInfo
  | WorkspaceInfo
  | { error: string; details?: string };

interface BridgeInternalResponse {
  id: string;
  success: boolean;
  data?: BridgeResponseData;
  error?: string;
  timestamp: number;
}

export interface WorkspaceInfo {
  rootPath: string | undefined;
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
  activeEditor: {
    fileName: string;
    languageId: string;
    lineCount: number;
    isDirty: boolean;
    selection: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  } | null;
  openFiles: Array<{
    fileName: string;
    languageId: string;
    isDirty: boolean;
  }>;
}

export interface FileChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  content?: string;
  encoding?: string;
}

export interface VSCodeOperation {
  type: 'read_file' | 'write_file' | 'execute_command' | 'show_panel';
  target: string;
  data?: string | object | null;
  options?: {
    encoding?: string;
    createIfNotExists?: boolean;
    showInEditor?: boolean;
    preserveSelection?: boolean;
    [key: string]: string | boolean | number | undefined;
  };
}

export interface BridgeConnection {
  id: string;
  socket: WebSocket;
  lastHeartbeat: number;
  authenticated: boolean;
  tokenPayload?: TokenPayload;
  clientIP: string;
  connectedAt: number;
}

export class TUIVSCodeBridge {
  private server: WebSocket.Server | null = null;
  private connections: Map<string, BridgeConnection> = new Map();
  private configManager: ConfigurationManager;
  private safetyGuard: SafetyGuard;
  private authManager: AuthenticationManager;
  private workspaceContextManager: IWorkspaceContextManager | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isActive = false;
  private messageRateLimiter = new Map<string, { count: number; resetTime: number }>();
  private rateLimitWindow = 60000; // 1 minute window
  private maxMessagesPerWindow = 100; // Max 100 messages per minute per connection

  constructor(configManager: ConfigurationManager, safetyGuard: SafetyGuard, authManager: AuthenticationManager) {
    this.configManager = configManager;
    this.safetyGuard = safetyGuard;
    this.authManager = authManager;
  }

  setWorkspaceContextManager(manager: IWorkspaceContextManager): void {
    this.workspaceContextManager = manager;
  }

  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error('Bridge is already active');
    }

    const config = this.configManager.getConfiguration();
    const port = config.bridgePort || 19888;
    const timeout = config.bridgeTimeout || 30000;

    try {
      this.server = new WebSocket.Server({
        port,
        clientTracking: true,
        perMessageDeflate: false,
        maxPayload: 1024 * 1024, // 1MB max payload
        verifyClient: (info: { origin?: string; req: any }) => {
          // Validate origin for security
          const origin = info.origin || info.req.headers.origin;
          if (origin && !this.isAllowedOrigin(origin)) {
            this.safetyGuard.logOperation('bridge_connection_rejected', {
              origin,
              reason: 'Invalid origin'
            });
            return false;
          }
          return true;
        }
      });

      this.server.on('connection', this.handleConnection.bind(this));
      this.server.on('error', this.handleServerError.bind(this));

      this.setupHeartbeat();
      this.registerTUIEndpoint();
      this.isActive = true;

      this.safetyGuard.logOperation('bridge_start', {
        port,
        timeout,
        success: true
      });

      vscode.window.showInformationMessage(
        `Automatus TUI Bridge started on port ${port}`
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.safetyGuard.logOperation('bridge_start', {
        port,
        success: false,
        error: errorMsg
      });
      throw new Error(`Failed to start TUI bridge: ${errorMsg}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      // Clear heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Close all connections gracefully
      const closePromises = Array.from(this.connections.values()).map(conn => {
        return new Promise<void>((resolve) => {
          if (conn.socket.readyState === WebSocket.OPEN) {
            conn.socket.close(1000, 'Bridge shutting down');
          }
          resolve();
        });
      });

      await Promise.allSettled(closePromises);
      this.connections.clear();

      // Close server
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          this.server!.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
        this.server = null;
      }

      this.isActive = false;

      this.safetyGuard.logOperation('bridge_stop', {
        success: true,
        connectionsClosed: closePromises.length
      });

      vscode.window.showInformationMessage('Automatus TUI Bridge stopped');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.safetyGuard.logOperation('bridge_stop', {
        success: false,
        error: errorMsg
      });
      throw new Error(`Failed to stop TUI bridge: ${errorMsg}`);
    }
  }

  private registerTUIEndpoint(): void {
    // Register VSCode commands that the bridge can execute
    const commands = [
      vscode.commands.registerCommand('automatus.bridge.getWorkspace', this.getCurrentWorkspace.bind(this)),
      vscode.commands.registerCommand('automatus.bridge.executeOperation', this.executeInVSCodeContext.bind(this)),
      vscode.commands.registerCommand('automatus.bridge.sendHeartbeat', this.handleHeartbeat.bind(this))
    ];

    commands.forEach(cmd => safeRegisterDisposable(cmd));
  }

  private handleConnection(socket: WebSocket): void {
    const connectionId = uuidv4();
    const clientIP = this.getSocketRemoteAddress(socket);

    const connection: BridgeConnection = {
      id: connectionId,
      socket,
      lastHeartbeat: Date.now(),
      authenticated: false,
      clientIP,
      connectedAt: Date.now()
    };

    this.connections.set(connectionId, connection);

    socket.on('message', (data: WebSocket.Data) => {
      this.handleTUICommand(connectionId, data).catch(error => {
        console.error('Error handling TUI command:', error);
        this.sendErrorResponse(connectionId, 'unknown', `Command handling failed: ${error}`);
      });
    });

    socket.on('close', (code: number, reason: string) => {
      this.connections.delete(connectionId);
      this.safetyGuard.logOperation('bridge_connection_closed', {
        connectionId,
        code,
        reason: reason.toString()
      });
    });

    socket.on('error', (error: Error) => {
      console.error('WebSocket connection error:', error);
      this.connections.delete(connectionId);
      this.safetyGuard.logOperation('bridge_connection_error', {
        connectionId,
        error: error.message
      });
    });

    // Send initial auth challenge
    this.sendMessage(connectionId, {
      type: 'auth_challenge',
      data: {
        connectionId,
        serverVersion: '0.1.0',
        authMethods: ['JWT'],
        message: 'Please provide a valid JWT token to authenticate'
      }
    });

    this.safetyGuard.logOperation('bridge_connection_established', {
      connectionId,
      remoteAddress: (socket as any)._socket?.remoteAddress || 'unknown'
    });
  }

  private async handleTUICommand(connectionId: string, data: WebSocket.Data): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // Check rate limiting first
    if (!this.checkRateLimit(connectionId)) {
      this.sendErrorResponse(connectionId, 'unknown', 'Rate limit exceeded. Please slow down.');
      return;
    }

    try {
      // Try to parse as formal TUICommand first, fallback to legacy format
      let command: BridgeInternalCommand;
      const rawCommand = JSON.parse(data.toString());

      // Handle formal protocol (from TUIClient)
      if (rawCommand.type === 'COMMAND_EXECUTE' && rawCommand.payload) {
        // Convert formal TUICommand to internal format for legacy compatibility
        command = {
          id: rawCommand.id,
          type: rawCommand.payload.command, // Extract command from payload
          payload: rawCommand.payload.args,
          timestamp: new Date(rawCommand.timestamp).getTime(),
          requiresApproval: rawCommand.payload.requireApproval
        } as BridgeInternalCommand;
      } else {
        // Legacy format
        command = rawCommand as BridgeInternalCommand;
      }

      // Update heartbeat
      connection.lastHeartbeat = Date.now();

      // Handle authentication first
      if (!connection.authenticated && command.type !== 'auth_request') {
        this.sendErrorResponse(connectionId, command.id, 'Authentication required');
        return;
      }

      let response: BridgeInternalResponse;

      switch (command.type) {
        case 'auth_request':
          response = await this.handleAuthRequest(connectionId, command);
          break;
        case 'workspace_query':
          response = await this.handleWorkspaceQuery(command);
          break;
        case 'file_operation':
          response = await this.handleFileOperation(command);
          break;
        case 'command_execution':
          response = await this.handleCommandExecution(command);
          break;
        case 'context_request':
          response = await this.handleContextRequest(command);
          break;
      }

      this.sendMessage(connectionId, response);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Failed to parse TUI command:', errorMsg);
      this.sendErrorResponse(connectionId, 'unknown', `Invalid command format: ${errorMsg}`);
    }
  }

  private async handleAuthRequest(connectionId: string, command: Extract<BridgeInternalCommand, { type: 'auth_request' }>): Promise<BridgeInternalResponse> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return {
        id: command.id,
        success: false,
        error: 'Connection not found',
        timestamp: Date.now()
      };
    }

    // Enhanced validation for auth request payload
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        id: command.id,
        success: false,
        error: 'Invalid auth request: missing payload',
        timestamp: Date.now()
      };
    }

    const token = command.payload.token;
    if (!token || typeof token !== 'string') {
      return {
        id: command.id,
        success: false,
        error: 'Invalid auth request: token is required and must be a string',
        timestamp: Date.now()
      };
    }

    // Use the real authentication manager
    const authResult = await this.authManager.validateToken(token, connection.clientIP);

    if (authResult.success && authResult.payload) {
      connection.authenticated = true;
      connection.tokenPayload = authResult.payload;

      this.safetyGuard.logOperation('bridge_auth_success', {
        connectionId,
        sessionId: authResult.payload.sessionId,
        safetyPhase: authResult.payload.safetyPhase,
        clientInfo: authResult.payload.clientInfo,
        remoteAddress: connection.clientIP
      });

      return {
        id: command.id,
        success: true,
        data: {
          authenticated: true,
          sessionId: authResult.payload.sessionId,
          safetyPhase: authResult.payload.safetyPhase,
          permissions: authResult.payload.permissions,
          capabilities: this.getAvailableCapabilities(authResult.payload.safetyPhase),
          serverInfo: {
            version: '0.1.0',
            supportedProtocols: ['websocket'],
            maxMessageSize: 1024 * 1024,
            securityFeatures: ['JWT', 'IP_BLOCKING', 'RATE_LIMITING', 'TOKEN_REVOCATION']
          }
        },
        timestamp: Date.now()
      };
    } else {
      this.safetyGuard.logOperation('bridge_auth_failure', {
        connectionId,
        reason: authResult.error || 'Unknown authentication error',
        remoteAddress: connection.clientIP
      });

      return {
        id: command.id,
        success: false,
        error: authResult.error || 'Authentication failed',
        timestamp: Date.now()
      };
    }
  }

  private getSocketRemoteAddress(socket: WebSocket): string {
    try {
      const req = (socket as any).upgradeReq || (socket as any)._socket?.upgradeReq || (socket as any)._socket;

      // Try multiple ways to extract client IP
      const forwardedFor = req?.headers?.['x-forwarded-for'];
      if (forwardedFor) {
        // Take the first IP from X-Forwarded-For header
        const ips = forwardedFor.split(',');
        return ips[0].trim();
      }

      // Fallback to connection remote address
      const remoteAddress = req?.connection?.remoteAddress ||
                          req?.socket?.remoteAddress ||
                          req?.remoteAddress;

      if (remoteAddress) {
        // Remove IPv6 prefix if present (::ffff:192.168.1.1 -> 192.168.1.1)
        return remoteAddress.replace(/^::ffff:/, '');
      }

      return '127.0.0.1'; // Safer fallback than 'unknown' for localhost development
    } catch {
      return '127.0.0.1';
    }
  }

  private isAllowedOrigin(origin: string): boolean {
    // Allow localhost and development origins
    const allowedOrigins = [
      'vscode-webview://',
      'vscode-file://',
      'file://',
      'http://localhost',
      'https://localhost',
      'http://127.0.0.1',
      'https://127.0.0.1'
    ];

    // Check if origin starts with any allowed pattern
    return allowedOrigins.some(allowed => origin.startsWith(allowed)) ||
           // Allow null origin (direct WebSocket connections)
           origin === null ||
           // Allow undefined origin (some development scenarios)
           origin === undefined;
  }

  private getConnectionRemoteAddress(connectionId: string): string {
    const connection = this.connections.get(connectionId);
    return connection?.clientIP || 'unknown';
  }

  private checkRateLimit(connectionId: string): boolean {
    const now = Date.now();
    let limiter = this.messageRateLimiter.get(connectionId);

    if (!limiter || now > limiter.resetTime) {
      // Reset or create new rate limit window
      limiter = { count: 1, resetTime: now + this.rateLimitWindow };
      this.messageRateLimiter.set(connectionId, limiter);
      return true;
    }

    if (limiter.count >= this.maxMessagesPerWindow) {
      // Rate limit exceeded
      this.safetyGuard.logOperation('bridge_rate_limit_exceeded', {
        connectionId,
        count: limiter.count,
        remoteAddress: this.getConnectionRemoteAddress(connectionId)
      });
      return false;
    }

    limiter.count++;
    return true;
  }

  private cleanupRateLimiter(): void {
    const now = Date.now();
    for (const [connectionId, limiter] of this.messageRateLimiter) {
      if (now > limiter.resetTime) {
        this.messageRateLimiter.delete(connectionId);
      }
    }
  }

  private async handleWorkspaceQuery(command: Extract<BridgeInternalCommand, { type: 'workspace_query' }>): Promise<BridgeInternalResponse> {
    try {
      // Use enhanced workspace context manager if available, fallback to basic info
      let workspaceData;

      if (this.workspaceContextManager) {
        // Check the specific query type
        const queryType = command.payload.queryType || 'basic';

        switch (queryType) {
          case 'context':
            workspaceData = await this.workspaceContextManager.getCurrentWorkspaceContext();
            break;
          case 'files':
            workspaceData = await this.workspaceContextManager.handleFileQuery(command.payload);
            break;
          case 'project':
            workspaceData = await this.workspaceContextManager.handleProjectQuery(command.payload);
            break;
          case 'basic':
          default:
            workspaceData = await this.workspaceContextManager.getCurrentWorkspaceContext();
            break;
        }
      } else {
        // Fallback to basic workspace info
        workspaceData = this.getCurrentWorkspace();
      }

      this.safetyGuard.logOperation('bridge_workspace_query', {
        commandId: command.id,
        queryType: command.payload.queryType || 'basic',
        hasWorkspace: !!(workspaceData && ((workspaceData as any).workspaceInfo?.rootPath || (workspaceData as any).rootPath)),
        enhanced: !!this.workspaceContextManager
      });

      return {
        id: command.id,
        success: true,
        data: workspaceData || { error: "No workspace data available" },
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: command.id,
        success: false,
        error: `Workspace query failed: ${errorMsg}`,
        timestamp: Date.now()
      };
    }
  }

  private async handleFileOperation(command: Extract<BridgeInternalCommand, { type: 'file_operation' }>): Promise<BridgeInternalResponse> {
    const config = this.configManager.getConfiguration();

    // Check safety phase
    if (config.safetyPhase < 2) {
      return {
        id: command.id,
        success: false,
        error: 'File operations require Safety Phase 2 or higher',
        timestamp: Date.now()
      };
    }

    try {
      const { operation, path, content } = command.payload;

      // Check if approval is required
      if (command.requiresApproval && config.requireApproval) {
        const approved = await this.requestUserApproval(operation, path, content);
        if (!approved) {
          return {
            id: command.id,
            success: false,
            error: 'Operation cancelled by user',
            timestamp: Date.now()
          };
        }
      }

      // Check safety permissions
      const hasPermission = await this.safetyGuard.checkPermission(operation, path);
      if (!hasPermission) {
        return {
          id: command.id,
          success: false,
          error: 'Operation not permitted by safety guard',
          timestamp: Date.now()
        };
      }

      const result = await this.executeFileOperation(operation, path, content);

      this.safetyGuard.logOperation('bridge_file_operation', {
        commandId: command.id,
        operation,
        path,
        success: true
      });

      return {
        id: command.id,
        success: true,
        data: result,
        timestamp: Date.now()
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.safetyGuard.logOperation('bridge_file_operation', {
        commandId: command.id,
        operation: command.payload.operation,
        path: command.payload.path,
        success: false,
        error: errorMsg
      });

      return {
        id: command.id,
        success: false,
        error: `File operation failed: ${errorMsg}`,
        timestamp: Date.now()
      };
    }
  }

  private async handleCommandExecution(command: Extract<BridgeInternalCommand, { type: 'command_execution' }>): Promise<BridgeInternalResponse> {
    try {
      const { commandName, args, context, requireApproval, safetyLevel } = command.payload;

      // Check safety level requirements
      const config = this.configManager.getConfiguration();
      if (!this.validateSafetyLevel(safetyLevel, config.safetyPhase)) {
        return {
          id: command.id,
          success: false,
          error: `Command requires safety level '${safetyLevel}' but current phase is ${config.safetyPhase}`,
          timestamp: Date.now()
        };
      }

      // Validate command against whitelist based on safety level
      const allowedCommands = this.getAllowedCommands(safetyLevel, config.safetyPhase);
      if (!allowedCommands.includes(commandName)) {
        return {
          id: command.id,
          success: false,
          error: `Command '${commandName}' not allowed in safety level '${safetyLevel}'`,
          timestamp: Date.now()
        };
      }

      // Check if user approval is required
      if ((requireApproval || config.requireApproval) && safetyLevel !== 'read_only') {
        const approved = await this.requestUserApproval(
          `TUI wants to execute command: ${commandName}`,
          JSON.stringify({ commandName, args, context }, null, 2)
        );

        if (!approved) {
          return {
            id: command.id,
            success: false,
            error: 'Command execution cancelled by user',
            timestamp: Date.now()
          };
        }
      }

      // Execute the command with proper context
      const startTime = Date.now();
      let result;

      try {
        // Enhanced command execution with context
        switch (commandName) {
          case 'automatus.generateCodePreview':
            result = await this.executeCodePreview(args, context);
            break;
          case 'automatus.analyzeCodeSelection':
            result = await this.executeCodeAnalysis(args, context);
            break;
          case 'automatus.explainCode':
            result = await this.executeCodeExplanation(args, context);
            break;
          default:
            // Execute standard VSCode command
            result = await vscode.commands.executeCommand(commandName, ...(args || []));
        }
      } catch (commandError) {
        throw new Error(`Command execution failed: ${commandError}`);
      }

      const executionTime = Date.now() - startTime;

      this.safetyGuard.logOperation('bridge_command_execution', {
        commandId: command.id,
        commandName,
        safetyLevel,
        executionTime,
        success: true,
        contextProvided: !!context
      });

      return {
        id: command.id,
        success: true,
        data: {
          result,
          metadata: {
            executionTime,
            safetyLevel,
            commandName,
            timestamp: Date.now()
          }
        },
        timestamp: Date.now()
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.safetyGuard.logOperation('bridge_command_execution', {
        commandId: command.id,
        commandName: command.payload.commandName,
        success: false,
        error: errorMsg
      });

      return {
        id: command.id,
        success: false,
        error: errorMsg,
        timestamp: Date.now()
      };
    }
  }

  private validateSafetyLevel(requestedLevel: string, currentPhase: number): boolean {
    switch (requestedLevel) {
      case 'read_only':
        return currentPhase >= 1;
      case 'controlled_write':
        return currentPhase >= 2;
      case 'expanded_access':
        return currentPhase >= 3;
      default:
        return false;
    }
  }

  private getAllowedCommands(safetyLevel: string, phase: number): string[] {
    const readOnlyCommands = [
      'automatus.generateCodePreview',
      'automatus.analyzeCodeSelection',
      'automatus.explainCode',
      'automatus.showSafetyStatus',
      'workbench.action.files.openFile',
      'workbench.action.showAllSymbols'
    ];

    if (safetyLevel === 'read_only') {
      return readOnlyCommands;
    }

    const controlledWriteCommands = [
      ...readOnlyCommands,
      'workbench.action.files.save',
      'workbench.action.files.saveAs',
      'editor.action.formatDocument',
      'editor.action.organizeImports'
    ];

    if (safetyLevel === 'controlled_write' && phase >= 2) {
      return controlledWriteCommands;
    }

    const expandedAccessCommands = [
      ...controlledWriteCommands,
      'workbench.action.files.saveAll',
      'git.commit',
      'git.push',
      'workbench.action.terminal.new'
    ];

    if (safetyLevel === 'expanded_access' && phase >= 3) {
      return expandedAccessCommands;
    }

    return readOnlyCommands;
  }

  private async executeCodePreview(args: any, context: any): Promise<any> {
    // Implement enhanced code preview with TUI context
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      throw new Error('No active editor');
    }

    // Use context if provided, otherwise fall back to current selection
    const code = context?.selectedText || activeEditor.document.getText(activeEditor.selection);
    const fileName = context?.currentFile || activeEditor.document.fileName;

    return {
      preview: `Code preview for ${fileName}:\n${code}`,
      language: activeEditor.document.languageId,
      context: context || {}
    };
  }

  private async executeCodeAnalysis(args: any, context: any): Promise<any> {
    // Implement enhanced code analysis with TUI context
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      throw new Error('No active editor');
    }

    const code = context?.selectedText || activeEditor.document.getText(activeEditor.selection);
    return {
      analysis: `Analysis of code: ${code.length} characters`,
      language: activeEditor.document.languageId,
      complexity: Math.floor(Math.random() * 10) + 1,
      issues: [],
      context: context || {}
    };
  }

  private async executeCodeExplanation(args: any, context: any): Promise<any> {
    // Implement enhanced code explanation with TUI context
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      throw new Error('No active editor');
    }

    const code = context?.selectedText || activeEditor.document.getText(activeEditor.selection);
    return {
      explanation: `This code: ${code.substring(0, 100)}${code.length > 100 ? '...' : ''}`,
      language: activeEditor.document.languageId,
      concepts: ['variables', 'functions', 'control flow'],
      context: context || {}
    };
  }

  private async handleContextRequest(command: Extract<BridgeInternalCommand, { type: 'context_request' }>): Promise<BridgeInternalResponse> {
    try {
      const { contextType } = command.payload;
      let contextData: any;

      switch (contextType) {
        case 'active_editor':
          contextData = await this.getActiveEditorContext();
          break;
        case 'selection':
          contextData = await this.getSelectionContext();
          break;
        case 'project_structure':
          // Only available in Phase 2+
          if (this.configManager.getConfiguration().safetyPhase < 2) {
            throw new Error('Project structure access requires Safety Phase 2 or higher');
          }
          contextData = await this.getProjectStructure();
          break;
        default:
          throw new Error(`Unknown context type: ${contextType}`);
      }

      return {
        id: command.id,
        success: true,
        data: contextData,
        timestamp: Date.now()
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: command.id,
        success: false,
        error: `Context request failed: ${errorMsg}`,
        timestamp: Date.now()
      };
    }
  }

  getCurrentWorkspace(): WorkspaceInfo {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const activeEditor = vscode.window.activeTextEditor;
    const openFiles = vscode.workspace.textDocuments.map(doc => ({
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

  async executeInVSCodeContext(operation: VSCodeOperation): Promise<any> {
    const config = this.configManager.getConfiguration();

    switch (operation.type) {
      case 'read_file':
        const hasReadPermission = await this.safetyGuard.checkPermission('read_file', operation.target);
        if (!hasReadPermission) {
          throw new Error('Read permission denied by safety guard');
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(operation.target));
        return {
          fileName: document.fileName,
          content: document.getText(),
          languageId: document.languageId,
          lineCount: document.lineCount
        };

      case 'write_file':
        if (config.safetyPhase < 2) {
          throw new Error('Write operations require Safety Phase 2 or higher');
        }

        const hasWritePermission = await this.safetyGuard.checkPermission('write_file', operation.target);
        if (!hasWritePermission) {
          throw new Error('Write permission denied by safety guard');
        }

        const edit = new vscode.WorkspaceEdit();
        edit.createFile(vscode.Uri.file(operation.target), { ignoreIfExists: true });
        const dataObj = (operation.data && typeof operation.data === 'object') ? operation.data as any : {};
        if (dataObj.content) {
          edit.insert(vscode.Uri.file(operation.target), new vscode.Position(0, 0), dataObj.content);
        }

        const success = await vscode.workspace.applyEdit(edit);
        return { success, path: operation.target };

      case 'execute_command':
        const args = (operation.data && typeof operation.data === 'object' && Array.isArray((operation.data as any).args))
          ? (operation.data as any).args : [];
        return await vscode.commands.executeCommand(operation.target, ...args);

      case 'show_panel':
        // Create webview panel for visual feedback
        const panel = vscode.window.createWebviewPanel(
          operation.target,
          ((operation.data && typeof operation.data === 'object') ? (operation.data as any).title : null) || 'Automatus Panel',
          vscode.ViewColumn.One,
          {
            enableScripts: ((operation.data && typeof operation.data === 'object') ? (operation.data as any).enableScripts : false) || false,
            retainContextWhenHidden: true
          }
        );

        const htmlContent = (operation.data && typeof operation.data === 'object') ? (operation.data as any).html : null;
        if (htmlContent) {
          panel.webview.html = htmlContent;
        }

        return { panelId: operation.target, created: true };

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  private async executeFileOperation(operation: string, path: string, content?: string): Promise<any> {
    const uri = vscode.Uri.file(path);
    const edit = new vscode.WorkspaceEdit();

    switch (operation) {
      case 'read':
        const document = await vscode.workspace.openTextDocument(uri);
        return {
          content: document.getText(),
          languageId: document.languageId,
          lineCount: document.lineCount
        };

      case 'create':
        edit.createFile(uri, { ignoreIfExists: false });
        if (content) {
          edit.insert(uri, new vscode.Position(0, 0), content);
        }
        break;

      case 'modify':
        if (!content) {
          throw new Error('Content required for modify operation');
        }
        const existingDoc = await vscode.workspace.openTextDocument(uri);
        const fullRange = new vscode.Range(
          existingDoc.positionAt(0),
          existingDoc.positionAt(existingDoc.getText().length)
        );
        edit.replace(uri, fullRange, content);
        break;

      case 'delete':
        edit.deleteFile(uri);
        break;

      default:
        throw new Error(`Unknown file operation: ${operation}`);
    }

    const success = await vscode.workspace.applyEdit(edit);
    return { success, path, operation };
  }

  private async getActiveEditorContext(): Promise<any> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    return {
      fileName: editor.document.fileName,
      languageId: editor.document.languageId,
      content: editor.document.getText(),
      cursorPosition: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      },
      selection: {
        start: { line: editor.selection.start.line, character: editor.selection.start.character },
        end: { line: editor.selection.end.line, character: editor.selection.end.character },
        text: editor.document.getText(editor.selection)
      }
    };
  }

  private async getSelectionContext(): Promise<any> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return null;
    }

    return {
      selectedText: editor.document.getText(editor.selection),
      range: {
        start: { line: editor.selection.start.line, character: editor.selection.start.character },
        end: { line: editor.selection.end.line, character: editor.selection.end.character }
      },
      fileName: editor.document.fileName,
      languageId: editor.document.languageId
    };
  }

  private async getProjectStructure(): Promise<any> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    // Simple project structure - in production this would be more sophisticated
    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);
    return {
      rootPath: workspaceFolders[0].uri.fsPath,
      files: files.map(file => file.fsPath)
    };
  }

  private async requestUserApproval(operation: string, path: string, content?: string): Promise<boolean> {
    const message = `TUI Bridge wants to ${operation} file: ${path}`;
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Allow',
      'Deny'
    );
    return choice === 'Allow';
  }

  private getAvailableCapabilities(safetyPhase?: number): string[] {
    const phase = safetyPhase || this.configManager.getConfiguration().safetyPhase;
    const capabilities: string[] = ['workspace_query', 'context_request'];

    if (phase >= 2) {
      capabilities.push('file_operation', 'command_execution');
    }

    if (phase >= 3) {
      capabilities.push('advanced_operations', 'bulk_operations');
    }

    if (phase >= 4) {
      capabilities.push('admin_operations', 'system_integration');
    }

    return capabilities;
  }

  private setupHeartbeat(): void {
    const config = this.configManager.getConfiguration();
    const interval = config.bridgeHeartbeatInterval || 30000;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = config.bridgeTimeout || 30000;

      for (const [connectionId, connection] of this.connections) {
        if (now - connection.lastHeartbeat > timeout) {
          console.log(`Connection ${connectionId} timed out, closing`);
          connection.socket.close(1000, 'Heartbeat timeout');
          this.connections.delete(connectionId);
        }
      }
    }, interval);
  }

  private handleHeartbeat(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
    }
  }

  private sendMessage(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (connection && connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  }

  private sendErrorResponse(connectionId: string, commandId: string, error: string): void {
    this.sendMessage(connectionId, {
      id: commandId,
      success: false,
      error,
      timestamp: Date.now()
    });
  }

  private handleServerError(error: Error): void {
    console.error('Bridge server error:', error);
    this.safetyGuard.logOperation('bridge_server_error', {
      error: error.message,
      timestamp: Date.now()
    });

    vscode.window.showErrorMessage(
      `Automatus TUI Bridge error: ${error.message}`
    );
  }

  isConnected(): boolean {
    return this.isActive && this.connections.size > 0;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  dispose(): void {
    try {
      this.stop().catch(error => {
        console.error('Error stopping bridge during disposal:', error);
      });
    } catch (error) {
      // Ignore disposal errors that can occur when the VS Code disposable store is already disposed
    }
  }
}