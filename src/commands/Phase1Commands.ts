import * as vscode from 'vscode';
import { SafeAutomatusClient } from '../automatus-client/SafeAutomatusClient';
import { SafetyGuard } from '../safety/SafetyGuard';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { CodeContext, CodePreview, AnalysisResult, Explanation } from '../types';
import { createSafeOutputChannel, safeDispose } from '../utils/outputChannel';
import { safeRegisterDisposable } from '../utils/ExtensionLifecycle';

export class Phase1Commands {
  private client: SafeAutomatusClient;
  private safetyGuard: SafetyGuard;
  private configManager: ConfigurationManager;
  private outputChannel: vscode.OutputChannel;

  constructor(
    client: SafeAutomatusClient,
    safetyGuard: SafetyGuard,
    configManager: ConfigurationManager
  ) {
    this.client = client;
    this.safetyGuard = safetyGuard;
    this.configManager = configManager;
    this.outputChannel = createSafeOutputChannel('Automatus Commands');
  }

  registerCommands(context: vscode.ExtensionContext): void {
    console.log('Phase1Commands: Registering commands...');
    const commands = [
      vscode.commands.registerCommand('automatus.generateCodePreview', this.generateCodePreview.bind(this)),
      vscode.commands.registerCommand('automatus.analyzeCodeSelection', this.analyzeCodeSelection.bind(this)),
      vscode.commands.registerCommand('automatus.explainCode', this.explainCode.bind(this)),
      vscode.commands.registerCommand('automatus.openChat', this.openChat.bind(this)),
      vscode.commands.registerCommand('automatus.showSafetyStatus', this.showSafetyStatus.bind(this))
    ];

    commands.forEach(cmd => safeRegisterDisposable(cmd));
    console.log(`Phase1Commands: Registered ${commands.length} commands successfully`);
  }

  private async generateCodePreview(): Promise<void> {
    console.log('Phase1Commands: generateCodePreview command executed');
    try {
      const config = this.configManager.getConfiguration();
      if (config.safetyPhase < 1) {
        vscode.window.showErrorMessage('Code preview requires Safety Phase 1 or higher');
        return;
      }

      // Check permission
      const hasPermission = await this.safetyGuard.checkPermission('preview_generation', 'current_file');
      if (!hasPermission) {
        vscode.window.showErrorMessage('Code preview not permitted by safety guard');
        return;
      }

      const prompt = await vscode.window.showInputBox({
        prompt: 'Describe the code you want to generate',
        placeHolder: 'e.g., "Create a function to sort an array of objects by name"'
      });

      if (!prompt) {
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const context = this.buildCodeContext(editor);

      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating code preview...',
        cancellable: true
      }, async (progress, token) => {
        try {
          const codePreview = await this.client.generateCodePreview(prompt, context);

          if (token.isCancellationRequested) {
            return;
          }

          await this.showCodePreview(codePreview, editor);

          this.safetyGuard.logOperation('generate_code_preview', {
            prompt,
            success: true,
            language: codePreview.language
          });

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`Code generation failed: ${errorMsg}`);
          vscode.window.showErrorMessage(`Code generation failed: ${errorMsg}`);

          this.safetyGuard.logOperation('generate_code_preview', {
            prompt,
            success: false,
            error: errorMsg
          });
        }
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Generate code preview error: ${errorMsg}`);
      vscode.window.showErrorMessage(`Generate code preview failed: ${errorMsg}`);
    }
  }

  private async analyzeCodeSelection(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      if (config.safetyPhase < 1) {
        vscode.window.showErrorMessage('Code analysis requires Safety Phase 1 or higher');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showInformationMessage('Please select code to analyze');
        return;
      }

      // Check permission
      const hasPermission = await this.safetyGuard.checkPermission('analyze_code', editor.document.fileName);
      if (!hasPermission) {
        vscode.window.showErrorMessage('Code analysis not permitted by safety guard');
        return;
      }

      const context = this.buildCodeContext(editor);

      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing code...',
        cancellable: true
      }, async (progress, token) => {
        try {
          const analysis = await this.client.analyzeCode(context);

          if (token.isCancellationRequested) {
            return;
          }

          await this.showAnalysisResult(analysis);

          this.safetyGuard.logOperation('analyze_code', {
            file: editor.document.fileName,
            success: true,
            issuesFound: analysis.issues.length
          });

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`Code analysis failed: ${errorMsg}`);
          vscode.window.showErrorMessage(`Code analysis failed: ${errorMsg}`);

          this.safetyGuard.logOperation('analyze_code', {
            file: editor.document.fileName,
            success: false,
            error: errorMsg
          });
        }
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Analyze code error: ${errorMsg}`);
      vscode.window.showErrorMessage(`Code analysis failed: ${errorMsg}`);
    }
  }

  private async explainCode(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      if (config.safetyPhase < 1) {
        vscode.window.showErrorMessage('Code explanation requires Safety Phase 1 or higher');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showInformationMessage('Please select code to explain');
        return;
      }

      // Check permission
      const hasPermission = await this.safetyGuard.checkPermission('explain_code', editor.document.fileName);
      if (!hasPermission) {
        vscode.window.showErrorMessage('Code explanation not permitted by safety guard');
        return;
      }

      const selectedText = editor.document.getText(selection);
      const context = this.buildCodeContext(editor);

      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Explaining code...',
        cancellable: true
      }, async (progress, token) => {
        try {
          const explanation = await this.client.explainCode(selectedText, context);

          if (token.isCancellationRequested) {
            return;
          }

          await this.showExplanation(explanation);

          this.safetyGuard.logOperation('explain_code', {
            file: editor.document.fileName,
            success: true,
            conceptsCount: explanation.concepts.length
          });

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`Code explanation failed: ${errorMsg}`);
          vscode.window.showErrorMessage(`Code explanation failed: ${errorMsg}`);

          this.safetyGuard.logOperation('explain_code', {
            file: editor.document.fileName,
            success: false,
            error: errorMsg
          });
        }
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Explain code error: ${errorMsg}`);
      vscode.window.showErrorMessage(`Code explanation failed: ${errorMsg}`);
    }
  }

  private async openChat(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      if (config.safetyPhase < 1) {
        vscode.window.showErrorMessage('Chat requires Safety Phase 1 or higher');
        return;
      }

      // Focus on the chat view
      await vscode.commands.executeCommand('automatusChat.focus');

      // Show information about chat capabilities in current phase
      const phaseInfo = this.configManager.getPhaseInfo();
      vscode.window.showInformationMessage(
        `Automatus Chat opened in ${phaseInfo.name}. Available: ${phaseInfo.permissions.join(', ')}`
      );

      this.safetyGuard.logOperation('open_chat', {
        safetyPhase: config.safetyPhase,
        success: true
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Open chat error: ${errorMsg}`);
      vscode.window.showErrorMessage(`Failed to open chat: ${errorMsg}`);
    }
  }

  private async showSafetyStatus(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      const phaseInfo = this.configManager.getPhaseInfo();

      const statusMessage = `
Safety Phase: ${config.safetyPhase} - ${phaseInfo.name}
Description: ${phaseInfo.description}
Permissions: ${phaseInfo.permissions.join(', ')}
Capabilities: ${phaseInfo.capabilities.join(', ')}
Require Approval: ${config.requireApproval ? 'Yes' : 'No'}
Create Backups: ${config.createBackups ? 'Yes' : 'No'}
Allowed Directories: ${config.allowedDirectories.join(', ')}
Server: ${config.serverUrl}
Connected: ${this.client.isConnected() ? 'Yes' : 'No'}
      `.trim();

      const panel = vscode.window.createWebviewPanel(
        'automatusSafetyStatus',
        'Automatus Safety Status',
        vscode.ViewColumn.One,
        {
          enableScripts: false,
          retainContextWhenHidden: true
        }
      );

      panel.webview.html = this.getSafetyStatusHtml(statusMessage);

      this.safetyGuard.logOperation('show_safety_status', {
        safetyPhase: config.safetyPhase,
        success: true
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Show safety status error: ${errorMsg}`);
      vscode.window.showErrorMessage(`Failed to show safety status: ${errorMsg}`);
    }
  }

  private buildCodeContext(editor: vscode.TextEditor): CodeContext {
    return {
      currentFile: editor.document.fileName,
      selectedText: editor.document.getText(editor.selection),
      cursorPosition: editor.selection.active,
      // Phase 1 doesn't include project structure for safety
      projectStructure: undefined,
      dependencies: undefined,
      gitHistory: undefined
    };
  }

  private async showCodePreview(preview: CodePreview, editor: vscode.TextEditor): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'automatusCodePreview',
      'Code Preview - Automatus',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getCodePreviewHtml(preview);

    // Show safety warnings if any
    if (preview.safetyWarnings && preview.safetyWarnings.length > 0) {
      vscode.window.showWarningMessage(
        `Safety warnings: ${preview.safetyWarnings.join(', ')}`,
        'Understood'
      );
    }
  }

  private async showAnalysisResult(analysis: AnalysisResult): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'automatusAnalysis',
      'Code Analysis - Automatus',
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getAnalysisHtml(analysis);
  }

  private async showExplanation(explanation: Explanation): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'automatusExplanation',
      'Code Explanation - Automatus',
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getExplanationHtml(explanation);
  }

  private getSafetyStatusHtml(status: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: monospace; padding: 20px; background-color: #1e1e1e; color: #d4d4d4; }
        .status { background-color: #2d2d30; padding: 15px; border-radius: 5px; white-space: pre-line; }
        .phase-1 { border-left: 5px solid #4CAF50; }
        .phase-2 { border-left: 5px solid #FF9800; }
        .phase-3 { border-left: 5px solid #2196F3; }
        .phase-4 { border-left: 5px solid #9C27B0; }
    </style>
</head>
<body>
    <h2>🛡️ Automatus Safety Status</h2>
    <div class="status">${status}</div>
</body>
</html>`;
  }

  private getCodePreviewHtml(preview: CodePreview): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', sans-serif; padding: 20px; background-color: #1e1e1e; color: #d4d4d4; }
        .preview { background-color: #2d2d30; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .code { background-color: #1e1e1e; padding: 10px; border-radius: 3px; font-family: monospace; overflow-x: auto; }
        .warning { background-color: #663300; padding: 10px; border-radius: 3px; margin-bottom: 10px; }
        .explanation { background-color: #0d1117; padding: 10px; border-radius: 3px; margin-top: 10px; }
        .phase-indicator { background-color: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; display: inline-block; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="phase-indicator">📖 Preview Only - Phase 1</div>
    <div class="preview">
        <h3>Generated Code (${preview.language})</h3>
        ${preview.safetyWarnings ? preview.safetyWarnings.map(w => `<div class="warning">⚠️ ${w}</div>`).join('') : ''}
        <div class="code">${this.escapeHtml(preview.code)}</div>
        <div class="explanation"><strong>Explanation:</strong> ${preview.explanation}</div>
        <p><em>Note: This is a preview only. No files will be modified in Phase 1.</em></p>
    </div>
</body>
</html>`;
  }

  private getAnalysisHtml(analysis: AnalysisResult): string {
    const issuesHtml = analysis.issues.map(issue => `
      <div class="issue issue-${issue.severity}">
        <strong>Line ${issue.line}:</strong> ${issue.message} (${issue.type})
      </div>
    `).join('');

    const suggestionsHtml = analysis.suggestions.map(suggestion => `
      <li>${suggestion}</li>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', sans-serif; padding: 20px; background-color: #1e1e1e; color: #d4d4d4; }
        .analysis { background-color: #2d2d30; padding: 15px; border-radius: 5px; }
        .issue { padding: 8px; margin: 5px 0; border-radius: 3px; }
        .issue-error { background-color: #662222; border-left: 3px solid #f44336; }
        .issue-warning { background-color: #663300; border-left: 3px solid #ff9800; }
        .issue-info { background-color: #003366; border-left: 3px solid #2196f3; }
        .metrics { display: flex; gap: 20px; margin: 15px 0; }
        .metric { background-color: #1e1e1e; padding: 10px; border-radius: 3px; text-align: center; flex: 1; }
        ul { margin-left: 20px; }
    </style>
</head>
<body>
    <div class="analysis">
        <h3>📊 Code Analysis Results</h3>
        <p><strong>Summary:</strong> ${analysis.summary}</p>

        <div class="metrics">
            <div class="metric">
                <div style="font-size: 24px; color: #4CAF50;">${analysis.quality}/10</div>
                <div>Quality Score</div>
            </div>
            <div class="metric">
                <div style="font-size: 24px; color: #2196F3;">${analysis.complexity}/10</div>
                <div>Complexity</div>
            </div>
            <div class="metric">
                <div style="font-size: 24px; color: #FF9800;">${analysis.issues.length}</div>
                <div>Issues Found</div>
            </div>
        </div>

        <h4>Issues:</h4>
        ${issuesHtml || '<p>No issues found.</p>'}

        <h4>Suggestions:</h4>
        <ul>${suggestionsHtml || '<li>No suggestions.</li>'}</ul>
    </div>
</body>
</html>`;
  }

  private getExplanationHtml(explanation: Explanation): string {
    const conceptsHtml = explanation.concepts.map(concept => `
      <span class="concept">${concept}</span>
    `).join('');

    const detailsHtml = explanation.details.map(detail => `
      <li>${detail}</li>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', sans-serif; padding: 20px; background-color: #1e1e1e; color: #d4d4d4; }
        .explanation { background-color: #2d2d30; padding: 15px; border-radius: 5px; }
        .concept { background-color: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; margin: 2px; display: inline-block; font-size: 12px; }
        .summary { background-color: #1e1e1e; padding: 10px; border-radius: 3px; margin: 10px 0; }
        ul { margin-left: 20px; }
    </style>
</head>
<body>
    <div class="explanation">
        <h3>💡 Code Explanation</h3>
        <div class="summary">${explanation.summary}</div>

        <h4>Key Concepts:</h4>
        <div style="margin-bottom: 15px;">${conceptsHtml}</div>

        <h4>Details:</h4>
        <ul>${detailsHtml}</ul>

        ${explanation.relatedCode ? `
        <h4>Related Code:</h4>
        <ul>
        ${explanation.relatedCode.map(code => `<li><code>${this.escapeHtml(code)}</code></li>`).join('')}
        </ul>
        ` : ''}
    </div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  dispose(): void {
    try {
      // Use safe disposal to prevent VSCode disposal store warnings
      safeDispose(this.outputChannel);

      // Clear references to help with garbage collection
      (this as any).outputChannel = null;
      (this as any).client = null;
      (this as any).safetyGuard = null;
      (this as any).configManager = null;
    } catch (error) {
      // Ignore disposal errors that can occur when the VS Code disposable store is already disposed
    }
  }
}
