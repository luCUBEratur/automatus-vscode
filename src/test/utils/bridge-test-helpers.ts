// Test utilities for TUI Bridge - provides backwards compatibility for legacy test format
import { TUICommand } from '../../bridge/types';

// Legacy command format (for backwards compatibility in tests)
export interface LegacyTestCommand {
  id: string;
  type: 'workspace_query' | 'file_operation' | 'command_execution' | 'context_request' | 'auth_request';
  payload: any;
  timestamp: number;
  requiresApproval?: boolean;
}

// Convert legacy test format to formal TUICommand format
export function createTUICommand(legacy: LegacyTestCommand): TUICommand {
  // Handle auth_request specially
  if (legacy.type === 'auth_request') {
    return {
      id: legacy.id,
      type: 'COMMAND_EXECUTE',
      timestamp: new Date(legacy.timestamp).toISOString(),
      source: 'TUI',
      sessionId: 'test-session',
      payload: {
        command: 'auth_request',
        args: { token: legacy.payload.token },
        safetyLevel: 'read_only'
      }
    };
  }

  // Handle other command types
  const commandMap: Record<string, string> = {
    'workspace_query': 'getWorkspace',
    'file_operation': 'fileOperation',
    'command_execution': 'executeCommand',
    'context_request': 'getContext'
  };

  return {
    id: legacy.id,
    type: 'COMMAND_EXECUTE',
    timestamp: new Date(legacy.timestamp).toISOString(),
    source: 'TUI',
    sessionId: 'test-session',
    payload: {
      command: commandMap[legacy.type] || legacy.type,
      args: legacy.payload || {},
      safetyLevel: 'read_only',
      requireApproval: legacy.requiresApproval
    }
  };
}

// Helper for auth commands
export function createAuthCommand(token: string): TUICommand {
  return createTUICommand({
    id: `auth-${Date.now()}`,
    type: 'auth_request',
    payload: { token },
    timestamp: Date.now()
  });
}

// Helper for workspace query commands
export function createWorkspaceQueryCommand(): TUICommand {
  return createTUICommand({
    id: `workspace-${Date.now()}`,
    type: 'workspace_query',
    payload: {},
    timestamp: Date.now()
  });
}

// Helper for context request commands
export function createContextRequestCommand(contextType: string): TUICommand {
  return createTUICommand({
    id: `context-${Date.now()}`,
    type: 'context_request',
    payload: { contextType },
    timestamp: Date.now()
  });
}

// Helper for file operation commands
export function createFileOperationCommand(operation: string, path: string, content?: string): TUICommand {
  return createTUICommand({
    id: `file-${Date.now()}`,
    type: 'file_operation',
    payload: { operation, path, content },
    timestamp: Date.now(),
    requiresApproval: true
  });
}