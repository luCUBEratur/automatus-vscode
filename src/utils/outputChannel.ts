import * as vscode from 'vscode';

// Track disposal state to prevent warnings
let isGloballyDisposing = false;

const NOOP_OUTPUT_CHANNEL: vscode.OutputChannel = {
  name: 'Automatus (noop)',
  append: () => {},
  appendLine: () => {},
  clear: () => {},
  show: () => {},
  hide: () => {},
  dispose: () => {},
  replace: () => {}
};

// Enhanced test-safe output channel that handles disposal gracefully
const createTestSafeOutputChannel = (name: string): vscode.OutputChannel => {
  return {
    name: `${name} (test-safe)`,
    append: () => {},
    appendLine: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {
      // Safely handle disposal in test environment
    },
    replace: () => {}
  };
};

export const isTestEnvironment = (): boolean => {
  return process.argv.includes('--extensionTestsPath') ||
    process.env.VSCODE_TEST !== undefined ||
    process.env.NODE_ENV === 'test';
};

// Enhanced detection for when VSCode is shutting down
let isVSCodeShuttingDown = false;

// Set shutdown flag on process exit events
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    isGloballyDisposing = true;
    isVSCodeShuttingDown = true;
  });
  process.on('beforeExit', () => {
    isGloballyDisposing = true;
    isVSCodeShuttingDown = true;
  });
  process.on('SIGTERM', () => {
    isGloballyDisposing = true;
    isVSCodeShuttingDown = true;
  });
  process.on('SIGINT', () => {
    isGloballyDisposing = true;
    isVSCodeShuttingDown = true;
  });
}

export const createSafeOutputChannel = (name: string): vscode.OutputChannel => {
  if (isTestEnvironment()) {
    return createTestSafeOutputChannel(name);
  }

  try {
    return vscode.window.createOutputChannel(name);
  } catch (error) {
    // If VSCode is shutting down, return test-safe channel
    if (error && (error as any).message?.includes('disposed')) {
      isGloballyDisposing = true;
      return createTestSafeOutputChannel(name);
    }
    return NOOP_OUTPUT_CHANNEL;
  }
};

// Export function to check if we're in disposal state
export const isDisposing = (): boolean => isGloballyDisposing;

// Export function to safely create disposables
export const safeDispose = (disposable: vscode.Disposable | undefined): void => {
  if (!disposable || isGloballyDisposing) {
    return;
  }

  try {
    disposable.dispose();
  } catch (error) {
    // Ignore disposal errors when VSCode is shutting down
    if (error && (error as any).message?.includes('disposed')) {
      isGloballyDisposing = true;
    }
  }
};

// Simple lifecycle-aware registration that doesn't try to work around disposal issues
export const safeSubscriptionPush = (subscriptions: vscode.Disposable[], disposable: vscode.Disposable): void => {
  // Import the lifecycle manager here to avoid circular dependencies
  const { getExtensionLifecycle } = require('./ExtensionLifecycle');
  const lifecycle = getExtensionLifecycle();

  if (lifecycle.isOperational()) {
    // Use the lifecycle manager's safe registration
    lifecycle.registerDisposable(disposable);
  } else {
    // Extension is not active, dispose immediately
    try {
      disposable.dispose();
    } catch (error) {
      // Ignore disposal errors during shutdown
    }
  }
};
