/**
 * Mock VSCode API for integration testing
 */

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export class Selection extends Range {
  constructor(start: Position, end: Position) {
    super(start, end);
  }

  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }

  get active(): Position {
    return this.end;
  }
}

export class Uri {
  constructor(public scheme: string, public authority: string, public path: string) {}

  static file(path: string): Uri {
    return new Uri('file', '', path);
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export class WorkspaceEdit {
  private edits: Map<string, any[]> = new Map();

  replace(uri: Uri, range: Range, newText: string): void {
    if (!this.edits.has(uri.toString())) {
      this.edits.set(uri.toString(), []);
    }
    this.edits.get(uri.toString())!.push({ range, newText, type: 'replace' });
  }
}

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        'kernel.mode': 'external',
        'safety.currentPhase': 1,
        'safety.requireApproval': true,
        'safety.createBackups': true,
        'safety.allowedDirectories': ['./src/temp/', './tests/generated/'],
        'codeGeneration.mode': 'preview_only',
        'audit.logLevel': 'all',
        'server.url': 'http://localhost:9000'
      };

      const fullKey = section ? `${section}.${key}` : key;
      return config[fullKey] ?? defaultValue;
    },
    has: (key: string) => true,
    update: async (key: string, value: any) => Promise.resolve(),
    inspect: (key: string) => ({ defaultValue: undefined, globalValue: undefined, workspaceValue: undefined })
  }),

  openTextDocument: async (uri: Uri) => ({
    uri,
    fileName: uri.path,
    getText: (range?: Range) => 'mock file content',
    lineAt: (line: number) => ({ text: 'mock line content' }),
    save: async () => true
  }),

  applyEdit: async (edit: WorkspaceEdit) => true,

  onDidChangeConfiguration: (callback: Function) => ({
    dispose: () => {}
  }),

  rootPath: '/mock/workspace'
};

export const window = {
  showInformationMessage: async (message: string, ...items: string[]) => items[0],
  showWarningMessage: async (message: string, ...items: string[]) => items[0],
  showErrorMessage: async (message: string, ...items: string[]) => items[0],
  showInputBox: async (options: any) => 'mock input',

  createOutputChannel: (name: string) => ({
    appendLine: (text: string) => console.log(`[${name}] ${text}`),
    show: () => {},
    dispose: () => {}
  }),

  createWebviewPanel: (viewType: string, title: string, column: any, options?: any) => ({
    webview: {
      html: '',
      options: options || {},
      onDidReceiveMessage: (callback: Function) => ({ dispose: () => {} })
    },
    dispose: () => {}
  }),

  withProgress: async (options: any, task: Function) => {
    const progress = { report: (value: any) => {} };
    const token = { isCancellationRequested: false };
    return await task(progress, token);
  },

  activeTextEditor: {
    document: {
      fileName: '/mock/file.js',
      getText: (range?: Range) => 'console.log("test");'
    },
    selection: new Selection(new Position(0, 0), new Position(0, 0))
  }
};

export const commands = {
  registerCommand: (command: string, callback: Function) => ({
    dispose: () => {}
  }),

  executeCommand: async (command: string, ...args: any[]) => {
    console.log(`Executing command: ${command}`);
    return Promise.resolve();
  },

  getCommands: async (filterInternal?: boolean) => [
    'automatus.generateCodePreview',
    'automatus.analyzeCodeSelection',
    'automatus.explainCode',
    'automatus.openChat',
    'automatus.showSafetyStatus'
  ]
};

export const extensions = {
  getExtension: (id: string) => ({
    isActive: true,
    activate: async () => {},
    exports: {}
  })
};

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
  Beside = -2
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15
}

// Mock the entire vscode module
export default {
  Position,
  Range,
  Selection,
  Uri,
  WorkspaceEdit,
  workspace,
  window,
  commands,
  extensions,
  ViewColumn,
  ProgressLocation,
  mockExtensionContext: {
    subscriptions: [],
    workspaceState: {
      get: (_key: string, defaultValue?: any) => defaultValue,
      update: (_key: string, _value: any) => Promise.resolve()
    },
    globalState: {
      get: (_key: string, defaultValue?: any) => defaultValue,
      update: (_key: string, _value: any) => Promise.resolve(),
      setKeysForSync: (_keys: string[]) => {}
    },
    extensionPath: '/mock/extension/path',
    extensionUri: Uri.file('/mock/extension/path'),
    storagePath: '/mock/storage/path',
    globalStoragePath: '/mock/global/storage/path',
    logPath: '/mock/log/path',
    logUri: Uri.file('/mock/log/path'),
    storageUri: Uri.file('/mock/storage/path'),
    globalStorageUri: Uri.file('/mock/global/storage/path'),
    extensionMode: 1, // ExtensionMode.Development
    environmentVariableCollection: {
      persistent: true,
      description: 'Mock environment variables',
      clear: () => {},
      get: (_variable: string) => undefined,
      forEach: (_callback: any) => {},
      replace: (_variable: string, _value: string) => {},
      append: (_variable: string, _value: string) => {},
      prepend: (_variable: string, _value: string) => {},
      delete: (_variable: string) => {}
    },
    secrets: {
      get: (_key: string) => Promise.resolve(undefined),
      store: (_key: string, _value: string) => Promise.resolve(),
      delete: (_key: string) => Promise.resolve(),
      onDidChange: () => ({ dispose: () => {} })
    }
  }
};