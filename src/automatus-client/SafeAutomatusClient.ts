import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { createSafeOutputChannel, safeDispose } from '../utils/outputChannel';
import { BackupManager } from '../utils/backupManager';
import {
  CodeContext,
  SafeAutomatusRequest,
  AnalysisResult,
  CodePreview,
  Explanation,
  WritePermission,
  ApplyResult,
  CodeChange,
  AutomatusConfig
} from '../types';

export class SafeAutomatusClient {
  private config: AutomatusConfig;
  private outputChannel: vscode.OutputChannel;
  private sessionId: string;
  private backupManager: BackupManager;

  constructor(config: AutomatusConfig) {
    this.config = config;
    this.outputChannel = createSafeOutputChannel('Automatus');
    this.sessionId = uuidv4();
    this.backupManager = BackupManager.getInstance();
  }

  async connect(): Promise<boolean> {
    try {
      // Initialize backup manager from workspace
      await this.backupManager.initializeFromWorkspace();

      // Test connection to the REST API server
      const response = await fetch(`${this.getRestUrl()}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        this.log('Connected to Automatus server');
        return true;
      } else {
        this.log(`Server health check failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      this.log(`Failed to connect: ${error}`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close with REST API
    this.log('Disconnected from Automatus server');
  }

  isConnected(): boolean {
    // For REST API, we'll assume connected if we have a valid server URL
    return !!this.config.serverUrl;
  }

  // Phase 1: Read-only operations
  async analyzeCode(context: CodeContext): Promise<AnalysisResult> {
    if (this.config.safetyPhase < 1) {
      throw new Error('Analysis not available in current safety phase');
    }

    const request: SafeAutomatusRequest = {
      type: 'analysis',
      context,
      prompt: 'Analyze this code for issues and suggestions',
      safetyLevel: 'read_only',
      capability: 'coding_agent'
    };

    return this.sendRequest(request);
  }

  async generateCodePreview(prompt: string, context: CodeContext): Promise<CodePreview> {
    if (this.config.safetyPhase < 1) {
      throw new Error('Code preview not available in current safety phase');
    }

    const request: SafeAutomatusRequest = {
      type: 'preview_generation',
      context,
      prompt,
      safetyLevel: 'read_only',
      capability: 'coding_agent'
    };

    return this.sendRequest(request);
  }

  async explainCode(selection: string, context: CodeContext): Promise<Explanation> {
    if (this.config.safetyPhase < 1) {
      throw new Error('Code explanation not available in current safety phase');
    }

    const request: SafeAutomatusRequest = {
      type: 'explanation',
      context,
      prompt: `Explain this code: ${selection}`,
      safetyLevel: 'read_only',
      capability: 'coding_agent'
    };

    return this.sendRequest(request);
  }

  // Phase 2: Controlled write operations (user approval required)
  async requestFileWrite(path: string, content: string): Promise<WritePermission> {
    if (this.config.safetyPhase < 2) {
      throw new Error('File write not available in current safety phase');
    }

    // Normalize path for comparison (handle both relative and absolute paths)
    let normalizedPath = path;
    if (path.startsWith('./')) {
      normalizedPath = path.substring(2);
    }

    // Check if path is in allowed directories
    const isAllowed = this.config.allowedDirectories.some(dir => {
      let normalizedDir = dir;
      if (dir.startsWith('./')) {
        normalizedDir = dir.substring(2);
      }
      return normalizedPath.startsWith(normalizedDir);
    });

    if (!isAllowed) {
      return {
        granted: false,
        path,
        reason: 'Path not in allowed directories',
        restrictions: this.config.allowedDirectories
      };
    }

    return {
      granted: true,
      path,
      restrictions: this.config.allowedDirectories
    };
  }

  async applySuggestedChanges(changes: CodeChange[]): Promise<ApplyResult> {
    if (this.config.safetyPhase < 2) {
      throw new Error('Apply changes not available in current safety phase');
    }

    // Request user approval if required
    if (this.config.requireApproval) {
      const approved = await this.requestUserApproval(changes);
      if (!approved) {
        return {
          success: false,
          appliedChanges: 0,
          errors: ['User denied approval']
        };
      }
    }

    // Create backups if enabled
    let backupPath: string | undefined;
    if (this.config.createBackups) {
      backupPath = await this.createBackups(changes);
    }

    try {
      let appliedChanges = 0;
      const errors: string[] = [];

      for (const change of changes) {
        try {
          const document = await vscode.workspace.openTextDocument(change.file);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, change.range, change.newText);

          const success = await vscode.workspace.applyEdit(edit);
          if (success) {
            appliedChanges++;
          } else {
            errors.push(`Failed to apply change to ${change.file}`);
          }
        } catch (error) {
          errors.push(`Error applying change to ${change.file}: ${error}`);
        }
      }

      this.auditLog('apply_changes', { changes, appliedChanges, errors });

      return {
        success: appliedChanges > 0,
        appliedChanges,
        errors: errors.length > 0 ? errors : undefined,
        backupPath
      };
    } catch (error) {
      return {
        success: false,
        appliedChanges: 0,
        errors: [`Failed to apply changes: ${error}`]
      };
    }
  }

  // Phase 3: Enhanced capabilities (graduated permissions)
  async runCapabilityPack(capability: string, context: any): Promise<any> {
    if (this.config.safetyPhase < 3) {
      throw new Error('Capability packs not available in current safety phase');
    }

    const request: SafeAutomatusRequest = {
      type: 'analysis',
      context,
      prompt: `Run capability pack: ${capability}`,
      safetyLevel: 'expanded_access',
      capability: capability as any
    };

    return this.sendRequest(request);
  }

  private async sendRequest(request: SafeAutomatusRequest): Promise<any> {
    try {
      // Convert request to chat message format
      const chatRequest = {
        message: this.formatRequestAsMessage(request),
        session_id: this.sessionId,
        context: {
          type: request.type,
          safetyLevel: request.safetyLevel,
          capability: request.capability,
          codeContext: request.context
        }
      };

      const response = await fetch(`${this.getRestUrl()}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatRequest)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { response: string };
      return this.parseResponseForType(data.response, request.type);

    } catch (error) {
      this.log(`Request failed: ${error}`);
      // Provide offline fallback for Phase 1 operations
      return this.handleOfflineRequest(request);
    }
  }

  private getRestUrl(): string {
    // Convert WebSocket URL to HTTP URL if needed
    let url = this.config.serverUrl;
    if (url.startsWith('ws://')) {
      url = url.replace('ws://', 'http://');
    } else if (url.startsWith('wss://')) {
      url = url.replace('wss://', 'https://');
    }
    return url;
  }

  private formatRequestAsMessage(request: SafeAutomatusRequest): string {
    switch (request.type) {
      case 'preview_generation':
        return `Generate code for: ${request.prompt}. Context: ${JSON.stringify(request.context)}`;
      case 'analysis':
        return `Analyze this code: ${request.context?.selectedText || 'current selection'}. Provide quality metrics, issues, and suggestions.`;
      case 'explanation':
        return `Explain this code in detail: ${request.context?.selectedText || 'current selection'}`;
      default:
        return request.prompt;
    }
  }

  private parseResponseForType(response: string, type: string): any {
    // Parse the response based on expected type
    switch (type) {
      case 'preview_generation':
        return this.parseCodePreviewResponse(response);
      case 'analysis':
        return this.parseAnalysisResponse(response);
      case 'explanation':
        return this.parseExplanationResponse(response);
      default:
        return { result: response };
    }
  }

  private async requestUserApproval(changes: CodeChange[]): Promise<boolean> {
    const changesSummary = changes.map(c =>
      `${c.file}: ${c.description}`
    ).join('\n');

    const choice = await vscode.window.showInformationMessage(
      `Automatus wants to make ${changes.length} change(s):\n\n${changesSummary}`,
      'Approve',
      'Deny'
    );

    return choice === 'Approve';
  }

  private async createBackups(changes: CodeChange[]): Promise<string> {
    const filesToBackup = [...new Set(changes.map(change => change.file))];

    try {
      const backupInfo = await this.backupManager.createBackup(
        filesToBackup,
        'apply_suggested_changes',
        this.config.safetyPhase,
        true // User approved since this is called after approval
      );

      this.log(`Created backup ${backupInfo.backupId} for ${filesToBackup.length} files`);
      return backupInfo.backupDirectory;

    } catch (error) {
      this.log(`Failed to create backup: ${error}`);
      throw error;
    }
  }

  private auditLog(operation: string, data: any): void {
    if (this.config.auditLogLevel === 'errors_only') {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      data,
      safetyPhase: this.config.safetyPhase
    };

    this.log(`AUDIT: ${JSON.stringify(logEntry)}`);
  }

  private async handleOfflineRequest(request: SafeAutomatusRequest): Promise<any> {
    this.log(`Handling request offline: ${request.type}`);

    switch (request.type) {
      case 'preview_generation':
        return {
          language: this.inferLanguageFromContext(request.context),
          code: this.generateOfflineCodePreview(request.prompt),
          explanation: `This is an offline code preview for: "${request.prompt}". Connect to Automatus server for AI-powered generation.`,
          safetyWarnings: ['Generated offline - limited functionality']
        };

      case 'analysis':
        return {
          summary: 'Offline analysis available. Connect to server for detailed AI analysis.',
          issues: this.performBasicAnalysis(request.context),
          suggestions: ['Connect to Automatus server for AI-powered suggestions'],
          complexity: 3,
          quality: 7
        };

      case 'explanation':
        return {
          summary: `Code explanation (offline mode): This appears to be ${this.inferCodeType(request.context.selectedText)}.`,
          details: [
            'Offline mode provides basic code structure analysis',
            'Connect to Automatus server for detailed AI explanations',
            'Selected text analysis shows standard code patterns'
          ],
          concepts: this.extractBasicConcepts(request.context.selectedText),
          relatedCode: []
        };

      default:
        throw new Error(`Operation ${request.type} not supported in offline mode`);
    }
  }

  private inferLanguageFromContext(context: CodeContext): string {
    const extension = context.currentFile.split('.').pop()?.toLowerCase() || '';
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'rb': 'ruby'
    };
    return languageMap[extension] || 'plaintext';
  }

  private generateOfflineCodePreview(prompt: string): string {
    // Basic offline code generation based on prompt keywords
    const promptLower = prompt.toLowerCase();

    if (promptLower.includes('function')) {
      return `// Generated offline - basic template
function ${this.extractFunctionName(prompt)}() {
  // TODO: Implement functionality
  // Connect to Automatus server for AI-powered code generation
  return null;
}`;
    }

    if (promptLower.includes('class')) {
      const className = this.extractClassName(prompt);
      return `// Generated offline - basic template
class ${className} {
  constructor() {
    // TODO: Initialize properties
  }

  // TODO: Add methods
  // Connect to Automatus server for AI-powered implementation
}`;
    }

    return `// Offline code preview
// Prompt: ${prompt}
// TODO: Connect to Automatus server for AI-powered code generation

console.log("Hello from offline mode!");`;
  }

  private performBasicAnalysis(context: CodeContext): any[] {
    const issues = [];
    const code = context.selectedText || '';

    // Basic static analysis
    if (code.includes('console.log')) {
      issues.push({
        line: 1,
        severity: 'info',
        message: 'Console logging detected',
        type: 'style'
      });
    }

    if (code.includes('var ')) {
      issues.push({
        line: 1,
        severity: 'warning',
        message: 'Consider using let or const instead of var',
        type: 'modernization'
      });
    }

    if (code.length > 1000) {
      issues.push({
        line: 1,
        severity: 'warning',
        message: 'Function/block appears to be quite long',
        type: 'complexity'
      });
    }

    return issues;
  }

  private inferCodeType(selectedText: string): string {
    if (selectedText.includes('function')) {return 'function definition';}
    if (selectedText.includes('class')) {return 'class definition';}
    if (selectedText.includes('const') || selectedText.includes('let')) {return 'variable declaration';}
    if (selectedText.includes('if')) {return 'conditional logic';}
    if (selectedText.includes('for') || selectedText.includes('while')) {return 'loop structure';}
    return 'code block';
  }

  private extractBasicConcepts(selectedText: string): string[] {
    const concepts = [];
    if (selectedText.includes('async') || selectedText.includes('await')) {concepts.push('asynchronous programming');}
    if (selectedText.includes('Promise')) {concepts.push('promises');}
    if (selectedText.includes('function')) {concepts.push('functions');}
    if (selectedText.includes('class')) {concepts.push('object-oriented programming');}
    if (selectedText.includes('const') || selectedText.includes('let')) {concepts.push('variable declarations');}
    return concepts.length > 0 ? concepts : ['basic code structure'];
  }

  private extractFunctionName(prompt: string): string {
    const words = prompt.toLowerCase().replace(/[^a-z\s]/g, '').split(' ');
    const meaningfulWords = words.filter(w => !['a', 'an', 'the', 'to', 'for', 'of', 'in', 'that', 'function'].includes(w));
    return meaningfulWords.slice(0, 2).join('_') || 'generatedFunction';
  }

  private extractClassName(prompt: string): string {
    const words = prompt.toLowerCase().replace(/[^a-z\s]/g, '').split(' ');
    const meaningfulWords = words.filter(w => !['a', 'an', 'the', 'to', 'for', 'of', 'in', 'that', 'class'].includes(w));
    const name = meaningfulWords.slice(0, 2).join('');
    return name.charAt(0).toUpperCase() + name.slice(1) || 'GeneratedClass';
  }

  private parseCodePreviewResponse(response: string): CodePreview {
    // Extract code blocks from response
    const codeBlockMatch = response.match(/```(\w+)?\n([\s\S]*?)```/);

    if (codeBlockMatch) {
      return {
        language: codeBlockMatch[1] || 'plaintext',
        code: codeBlockMatch[2].trim(),
        explanation: response.replace(/```(\w+)?\n[\s\S]*?```/, '').trim(),
        safetyWarnings: this.extractSafetyWarnings(response)
      };
    }

    return {
      language: 'plaintext',
      code: response,
      explanation: 'Generated code from Automatus server',
      safetyWarnings: []
    };
  }

  private parseAnalysisResponse(response: string): AnalysisResult {
    // Try to extract structured analysis information
    const issueMatches = response.match(/(?:issue|problem|error|warning)[s]?[:\s]+(.*?)(?=\n\n|\n[A-Z]|$)/gi) || [];
    const suggestionMatches = response.match(/(?:suggestion|recommendation|improvement)[s]?[:\s]+(.*?)(?=\n\n|\n[A-Z]|$)/gi) || [];

    return {
      summary: response.split('\n')[0] || 'Code analysis completed',
      issues: issueMatches.map((issue, index) => ({
        line: index + 1,
        severity: this.detectSeverity(issue),
        message: issue.replace(/^(?:issue|problem|error|warning)[s]?[:\s]+/i, ''),
        type: 'analysis'
      })),
      suggestions: suggestionMatches.map(s => s.replace(/^(?:suggestion|recommendation|improvement)[s]?[:\s]+/i, '')),
      complexity: this.extractComplexity(response),
      quality: this.extractQuality(response)
    };
  }

  private parseExplanationResponse(response: string): Explanation {
    const sections = response.split('\n\n');

    return {
      summary: sections[0] || response,
      details: sections.slice(1).filter(s => s.trim().length > 0),
      concepts: this.extractConceptsFromResponse(response),
      relatedCode: this.extractCodeExamples(response)
    };
  }

  private extractSafetyWarnings(response: string): string[] {
    const warnings: string[] = [];
    if (response.includes('security') || response.includes('unsafe')) {
      warnings.push('Potential security considerations');
    }
    if (response.includes('deprecated')) {
      warnings.push('Uses deprecated features');
    }
    return warnings;
  }

  private detectSeverity(issue: string): 'error' | 'warning' | 'info' {
    const lowerIssue = issue.toLowerCase();
    if (lowerIssue.includes('error') || lowerIssue.includes('critical')) {
      return 'error';
    }
    if (lowerIssue.includes('warning') || lowerIssue.includes('problem')) {
      return 'warning';
    }
    return 'info';
  }

  private extractComplexity(response: string): number {
    // Simple heuristic based on content
    if (response.includes('complex') || response.includes('complicated')) {
      return 7;
    }
    if (response.includes('simple') || response.includes('straightforward')) {
      return 3;
    }
    return 5; // Default
  }

  private extractQuality(response: string): number {
    // Simple heuristic based on content
    if (response.includes('excellent') || response.includes('high quality')) {
      return 9;
    }
    if (response.includes('good') || response.includes('well')) {
      return 7;
    }
    if (response.includes('poor') || response.includes('problematic')) {
      return 4;
    }
    return 6; // Default
  }

  private extractConceptsFromResponse(response: string): string[] {
    const concepts: string[] = [];
    const techTerms = ['async', 'await', 'promise', 'class', 'function', 'closure', 'prototype', 'inheritance', 'polymorphism'];

    for (const term of techTerms) {
      if (response.toLowerCase().includes(term)) {
        concepts.push(term);
      }
    }

    return concepts.length > 0 ? concepts : ['general programming'];
  }

  private extractCodeExamples(response: string): string[] {
    const codeBlocks = response.match(/```[\s\S]*?```/g) || [];
    return codeBlocks.map(block => block.replace(/```(\w+)?\n?|```/g, '').trim());
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  updateConfig(config: AutomatusConfig): void {
    this.config = config;
  }

  dispose(): void {
    try {
      // Disconnect first to clean up any pending operations
      this.disconnect();
    } catch (error) {
      // Log but don't throw during disposal
      console.warn('Error during client disconnect:', error);
    }

    // Use safe disposal to prevent VSCode disposal store warnings
    safeDispose(this.outputChannel);

    // Clear references to help with garbage collection
    (this as any).outputChannel = null;
    (this as any).backupManager = null;
  }
}
