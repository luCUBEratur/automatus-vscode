import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtensionLifecycle, safeRegisterDisposable } from '../utils/ExtensionLifecycle';

suite('Disposal Validation Test', () => {
  let mockContext: vscode.ExtensionContext;

  setup(async () => {
    // Create a mock extension context
    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: () => Promise.resolve(),
        keys: () => []
      },
      globalState: {
        get: () => undefined,
        update: () => Promise.resolve(),
        setKeysForSync: () => {},
        keys: () => []
      },
      extensionPath: '/mock/path',
      extensionUri: vscode.Uri.file('/mock/path'),
      storagePath: '/mock/storage',
      globalStoragePath: '/mock/global',
      logPath: '/mock/log',
      logUri: vscode.Uri.file('/mock/log'),
      storageUri: vscode.Uri.file('/mock/storage'),
      globalStorageUri: vscode.Uri.file('/mock/global'),
      extensionMode: 1, // Development
      environmentVariableCollection: {} as any,
      secrets: {} as any,
      asAbsolutePath: (relativePath: string) => `/mock/path/${relativePath}`,
      extension: {} as any,
      languageModelAccessInformation: {} as any
    } as vscode.ExtensionContext;

    // Initialize lifecycle for clean tests
    await getExtensionLifecycle().initialize(mockContext);
  });

  test('ExtensionLifecycle handles disposables safely', () => {
    const lifecycle = getExtensionLifecycle();
    let disposeCallCount = 0;

    const mockDisposable = new vscode.Disposable(() => {
      disposeCallCount++;
    });

    // Test registering a disposable
    lifecycle.registerDisposable(mockDisposable);
    assert.strictEqual(disposeCallCount, 0, 'Disposable should not be disposed immediately');
    assert.strictEqual(lifecycle.isOperational(), true, 'Lifecycle should be operational');
  });

  test('safeRegisterDisposable works correctly', () => {
    let disposeCallCount = 0;

    const mockDisposable = new vscode.Disposable(() => {
      disposeCallCount++;
    });

    // Test registering disposable
    safeRegisterDisposable(mockDisposable);

    // Should be added to lifecycle management
    assert.strictEqual(disposeCallCount, 0, 'Disposable should not be disposed immediately');
    assert.strictEqual(getExtensionLifecycle().isOperational(), true, 'Lifecycle should be operational');
  });

  test('ExtensionLifecycle disposes all registered items', async () => {
    const lifecycle = getExtensionLifecycle();
    let disposeCallCount = 0;

    // Register multiple disposables
    for (let i = 0; i < 3; i++) {
      const mockDisposable = new vscode.Disposable(() => {
        disposeCallCount++;
      });
      lifecycle.registerDisposable(mockDisposable);
    }

    // Dispose all through deactivation
    await lifecycle.deactivate();

    assert.strictEqual(disposeCallCount, 3, 'All disposables should be disposed');
    assert.strictEqual(lifecycle.isOperational(), false, 'Lifecycle should not be operational after deactivation');
  });
});