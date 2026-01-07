/**
 * TUI-VSCode Bridge Communication Types
 * Defines the protocol for communication between Automatus TUI and VSCode Extension
 */

// Core Bridge Message Types
export interface BridgeMessage {
  id: string;
  type: BridgeMessageType;
  timestamp: string;
  source: 'TUI' | 'VSCODE';
  sessionId: string;
}

export type BridgeMessageType =
  | 'HANDSHAKE'
  | 'WORKSPACE_REQUEST'
  | 'WORKSPACE_RESPONSE'
  | 'COMMAND_EXECUTE'
  | 'COMMAND_RESPONSE'
  | 'FILE_CHANGE'
  | 'UI_SPAWN'
  | 'ERROR'
  | 'HEARTBEAT'
  | 'ANALYTICS_UPDATE';

// TUI Command Types
export interface TUICommand extends BridgeMessage {
  type: 'COMMAND_EXECUTE';
  payload: {
    command: string;
    args: (string | number | boolean | object)[] | object;
    context?: CodeContext;
    requireApproval?: boolean;
    safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access';
  };
}

export interface VSCodeResponse extends BridgeMessage {
  type: 'COMMAND_RESPONSE';
  payload: {
    success: boolean;
    result?: string | number | boolean | object | null;
    error?: string;
    metadata?: {
      executionTime: number;
      filesModified: string[];
      userApproved?: boolean;
    };
  };
}

// Workspace State Types
export interface WorkspaceRequest extends BridgeMessage {
  type: 'WORKSPACE_REQUEST';
  payload: {
    requestedData: ('files' | 'structure' | 'activeFile' | 'selection' | 'diagnostics')[];
  };
}

export interface WorkspaceResponse extends BridgeMessage {
  type: 'WORKSPACE_RESPONSE';
  payload: WorkspaceState;
}

export interface WorkspaceState {
  rootPath: string | undefined;
  activeFile?: FileInfo;
  openFiles: FileInfo[];
  projectStructure: ProjectNode[];
  selection?: {
    file: string;
    range: Range;
    text: string;
  };
  diagnostics: DiagnosticInfo[];
}

// File and Project Types
export interface FileInfo {
  path: string;
  relativePath: string;
  isModified: boolean;
  language: string;
  content?: string; // Only included when specifically requested
}

export interface ProjectNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectNode[];
}

export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface DiagnosticInfo {
  file: string;
  range: Range;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source: string;
}

// Code Context for Operations
export interface CodeContext {
  currentFile: string;
  selectedText: string;
  cursorPosition: { line: number; character: number };
  projectStructure?: ProjectNode[];
  dependencies?: string[];
  gitHistory?: CommitInfo[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

// File Operations
export interface FileOperation {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  content?: string;
  newPath?: string; // For rename operations
}

export interface FileChangeNotification extends BridgeMessage {
  type: 'FILE_CHANGE';
  payload: {
    operation: FileOperation;
    source: 'TUI' | 'USER' | 'EXTERNAL';
  };
}

// UI Spawning
export interface UISpawnRequest extends BridgeMessage {
  type: 'UI_SPAWN';
  payload: {
    panelType: 'preview' | 'diff' | 'analysis' | 'chat' | 'approval';
    title: string;
    data: string | object;
    options?: {
      column?: 'active' | 'beside' | 'one' | 'two' | 'three';
      preserveFocus?: boolean;
      enableScripts?: boolean;
    };
  };
}

// Error Handling
export interface BridgeError extends BridgeMessage {
  type: 'ERROR';
  payload: {
    code: string;
    message: string;
    details?: string | object;
    recoverable: boolean;
  };
}

// Handshake and Connection
export interface HandshakeMessage extends BridgeMessage {
  type: 'HANDSHAKE';
  payload: {
    version: string;
    capabilities: string[];
    safetyPhase: number;
    clientInfo: {
      name: string;
      version: string;
      platform: string;
    };
  };
}

// Bridge Configuration
export interface BridgeConfig {
  port: number;
  protocol: 'websocket' | 'ipc' | 'http';
  timeout: number;
  retryAttempts: number;
  enableHeartbeat: boolean;
  heartbeatInterval: number;
  safetySettings: {
    requireApproval: boolean;
    allowedOperations: string[];
    maxFileSize: number;
    allowedExtensions: string[];
  };
}

// Bridge Connection State
export interface BridgeConnectionState {
  isConnected: boolean;
  lastHeartbeat?: string;
  sessionId?: string;
  tuiVersion?: string;
  vscodeVersion?: string;
  connectionTime?: string;
  messagesSent: number;
  messagesReceived: number;
}

// Command Registry
export interface BridgeCommand {
  name: string;
  description: string;
  safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access';
  requireApproval: boolean;
  handler: (args: any, context: CodeContext) => Promise<any>;
}

export interface CommandRegistry {
  [commandName: string]: BridgeCommand;
}