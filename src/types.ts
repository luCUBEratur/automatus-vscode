import * as vscode from 'vscode';

export interface CodeContext {
  currentFile: string;
  selectedText: string;
  cursorPosition: vscode.Position;
  projectStructure?: FileTree;
  dependencies?: string[];
  gitHistory?: CommitInfo[];
}

export interface FileTree {
  [key: string]: string | FileTree;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface SafeAutomatusRequest {
  type: 'preview_generation' | 'analysis' | 'explanation';
  context: CodeContext;
  prompt: string;
  safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access';
  userConsent?: boolean;
  capability?: 'coding_agent' | 'data_analysis_agent' | 'security_watcher';
}

export interface AnalysisResult {
  summary: string;
  issues: CodeIssue[];
  suggestions: string[];
  complexity: number;
  quality: number;
}

export interface CodeIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  type: string;
}

export interface CodePreview {
  language: string;
  code: string;
  explanation: string;
  insertionPoint?: vscode.Position;
  safetyWarnings?: string[];
}

export interface Explanation {
  summary: string;
  details: string[];
  concepts: string[];
  relatedCode?: string[];
}

export interface WritePermission {
  granted: boolean;
  path: string;
  reason?: string;
  restrictions?: string[];
}

export interface CodeChange {
  file: string;
  range: vscode.Range;
  newText: string;
  description: string;
}

export interface ApplyResult {
  success: boolean;
  appliedChanges: number;
  errors?: string[];
  backupPath?: string;
}

export interface SafetyPhase {
  phase: 1 | 2 | 3 | 4;
  name: string;
  description: string;
  permissions: string[];
  capabilities: string[];
}

export interface AutomatusConfig {
  kernelMode: 'embedded' | 'external';
  safetyPhase: 1 | 2 | 3 | 4;
  allowedDirectories: string[];
  requireApproval: boolean;
  createBackups: boolean;
  codeGenerationMode: 'preview_only' | 'controlled_write' | 'full_access';
  auditLogLevel: 'all' | 'changes_only' | 'errors_only';
  serverUrl: string;
  bridgePort: number;
  bridgeTimeout: number;
  bridgeRetryAttempts: number;
  bridgeEnableHeartbeat: boolean;
  bridgeHeartbeatInterval: number;
}

export interface SafetyGuardConfig {
  allowedOperations: string[];
  restrictedPaths: string[];
  requireApprovalFor: string[];
  auditLevel: 'minimal' | 'standard' | 'verbose';
}

export interface AutomatusFix {
  title: string;
  description: string;
  changes: CodeChange[];
  confidence: number;
  safetyLevel: 'safe' | 'moderate' | 'risky';
}

export const SAFETY_PHASES: SafetyPhase[] = [
  {
    phase: 1,
    name: 'Read-Only Safety Phase',
    description: 'Preview-only operations, no file modifications',
    permissions: ['read', 'analyze', 'explain', 'preview_generation', 'analyze_code', 'explain_code', 'chat_interaction'],
    capabilities: ['coding_agent_preview']
  },
  {
    phase: 2,
    name: 'Controlled Write Phase',
    description: 'Controlled write operations to safe directories',
    permissions: ['read', 'analyze', 'explain', 'preview_generation', 'analyze_code', 'explain_code', 'chat_interaction', 'write_safe'],
    capabilities: ['coding_agent_preview', 'coding_agent_write_safe']
  },
  {
    phase: 3,
    name: 'Expanded Permissions Phase',
    description: 'Wider file access with explicit user consent',
    permissions: ['read', 'analyze', 'explain', 'preview_generation', 'analyze_code', 'explain_code', 'chat_interaction', 'write_safe', 'write_approved'],
    capabilities: ['coding_agent_preview', 'coding_agent_write_safe', 'data_analysis_agent']
  },
  {
    phase: 4,
    name: 'Mature Safety Phase',
    description: 'Advanced features with proven safety record',
    permissions: ['read', 'analyze', 'explain', 'preview_generation', 'analyze_code', 'explain_code', 'chat_interaction', 'write_safe', 'write_approved', 'advanced'],
    capabilities: ['coding_agent_preview', 'coding_agent_write_safe', 'data_analysis_agent', 'security_watcher']
  }
];