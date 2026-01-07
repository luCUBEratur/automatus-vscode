import * as vscode from 'vscode';
import { SafeAutomatusClient } from '../automatus-client/SafeAutomatusClient';
import { SafetyGuard } from '../safety/SafetyGuard';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { CodeContext } from '../types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'automatusChat';
  private view?: vscode.WebviewView;
  private client: SafeAutomatusClient;
  private safetyGuard: SafetyGuard;
  private configManager: ConfigurationManager;
  private chatHistory: ChatMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    client: SafeAutomatusClient,
    safetyGuard: SafetyGuard,
    configManager: ConfigurationManager
  ) {
    this.client = client;
    this.safetyGuard = safetyGuard;
    this.configManager = configManager;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      this.handleMessage.bind(this),
      undefined,
      []
    );

    // Update view when configuration changes
    this.configManager.onConfigurationChanged(() => {
      this.updateSafetyStatus();
    });

    this.initializeChat();
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleUserMessage(message.text);
        break;
      case 'clearChat':
        await this.clearChat();
        break;
      case 'showSafetyInfo':
        await this.showSafetyInfo();
        break;
    }
  }

  private async handleUserMessage(userMessage: string): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();

      // Add user message to history
      this.addMessageToHistory({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      });

      // Check if user message requires any restricted operations
      if (this.containsRestrictedRequest(userMessage)) {
        this.addMessageToHistory({
          role: 'assistant',
          content: `I can only provide code previews and explanations in Safety Phase ${config.safetyPhase}. I cannot modify files or execute commands. Would you like me to generate a code preview instead?`,
          timestamp: new Date().toISOString()
        });
        this.updateChatView();
        return;
      }

      // Check permission
      const hasPermission = await this.safetyGuard.checkPermission('chat_interaction', 'chat');
      if (!hasPermission) {
        this.addMessageToHistory({
          role: 'assistant',
          content: 'Chat interaction not permitted by safety guard.',
          timestamp: new Date().toISOString()
        });
        this.updateChatView();
        return;
      }

      // Show typing indicator
      this.showTypingIndicator();

      try {
        // Determine the type of request and build context
        const context = this.buildChatContext();
        let response: string;

        // Add offline mode indicator if not connected
        const offlinePrefix = !this.client.isConnected() ? '🔴 **Offline Mode** - ' : '';

        if (this.isCodeGenerationRequest(userMessage)) {
          const preview = await this.client.generateCodePreview(userMessage, context);
          response = offlinePrefix + this.formatCodePreviewResponse(preview);
        } else if (this.isAnalysisRequest(userMessage)) {
          const analysis = await this.client.analyzeCode(context);
          response = offlinePrefix + this.formatAnalysisResponse(analysis);
        } else {
          // For other requests, provide general explanation
          const explanation = await this.client.explainCode(userMessage, context);
          response = offlinePrefix + this.formatExplanationResponse(explanation);
        }

        this.addMessageToHistory({
          role: 'assistant',
          content: response,
          timestamp: new Date().toISOString()
        });

        this.safetyGuard.logOperation('chat_interaction', {
          userMessage,
          responseGenerated: true,
          safetyPhase: config.safetyPhase
        });

      } catch (error) {
        this.addMessageToHistory({
          role: 'assistant',
          content: `I apologize, but I encountered an error: ${error}. Please try again or contact support if the issue persists.`,
          timestamp: new Date().toISOString(),
          isError: true
        });

        this.safetyGuard.logOperation('chat_interaction', {
          userMessage,
          error: error instanceof Error ? error.message : String(error),
          safetyPhase: config.safetyPhase
        });
      }

      this.hideTypingIndicator();
      this.updateChatView();

    } catch (error) {
      this.hideTypingIndicator();
      vscode.window.showErrorMessage(`Chat error: ${error}`);
    }
  }

  private containsRestrictedRequest(message: string): boolean {
    const restrictedKeywords = [
      'write file',
      'save file',
      'modify file',
      'delete file',
      'execute',
      'run command',
      'install',
      'npm install',
      'pip install',
      'git commit',
      'git push'
    ];

    const lowerMessage = message.toLowerCase();
    return restrictedKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private isCodeGenerationRequest(message: string): boolean {
    const generationKeywords = [
      'generate',
      'create',
      'write',
      'make',
      'build',
      'implement',
      'code for',
      'function to',
      'class to'
    ];

    const lowerMessage = message.toLowerCase();
    return generationKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private isAnalysisRequest(message: string): boolean {
    const analysisKeywords = [
      'analyze',
      'check',
      'review',
      'find issues',
      'problems',
      'bugs',
      'optimize',
      'improve'
    ];

    const lowerMessage = message.toLowerCase();
    return analysisKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private buildChatContext(): CodeContext {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return {
        currentFile: '',
        selectedText: '',
        cursorPosition: new vscode.Position(0, 0)
      };
    }

    return {
      currentFile: editor.document.fileName,
      selectedText: editor.document.getText(editor.selection),
      cursorPosition: editor.selection.active
    };
  }

  private formatCodePreviewResponse(preview: any): string {
    let response = `Here's a code preview:\n\n\`\`\`${preview.language}\n${preview.code}\n\`\`\`\n\n${preview.explanation}`;

    if (preview.safetyWarnings && preview.safetyWarnings.length > 0) {
      response += `\n\n⚠️ **Safety warnings:**\n${preview.safetyWarnings.map((w: string) => `- ${w}`).join('\n')}`;
    }

    response += '\n\n*Note: This is a preview only. No files will be modified in Phase 1.*';

    return response;
  }

  private formatAnalysisResponse(analysis: any): string {
    let response = `## Code Analysis Results\n\n**Summary:** ${analysis.summary}\n\n`;

    response += `**Quality Score:** ${analysis.quality}/10\n`;
    response += `**Complexity:** ${analysis.complexity}/10\n`;
    response += `**Issues Found:** ${analysis.issues.length}\n\n`;

    if (analysis.issues.length > 0) {
      response += '**Issues:**\n';
      analysis.issues.forEach((issue: any) => {
        response += `- Line ${issue.line}: ${issue.message} (${issue.severity})\n`;
      });
      response += '\n';
    }

    if (analysis.suggestions.length > 0) {
      response += '**Suggestions:**\n';
      analysis.suggestions.forEach((suggestion: string) => {
        response += `- ${suggestion}\n`;
      });
    }

    return response;
  }

  private formatExplanationResponse(explanation: any): string {
    let response = `${explanation.summary}\n\n`;

    if (explanation.details.length > 0) {
      response += '**Details:**\n';
      explanation.details.forEach((detail: string) => {
        response += `- ${detail}\n`;
      });
      response += '\n';
    }

    if (explanation.concepts.length > 0) {
      response += `**Key concepts:** ${explanation.concepts.join(', ')}\n\n`;
    }

    return response;
  }

  private addMessageToHistory(message: ChatMessage): void {
    this.chatHistory.push(message);

    // Keep only last 50 messages for performance
    if (this.chatHistory.length > 50) {
      this.chatHistory.shift();
    }
  }

  private async clearChat(): Promise<void> {
    this.chatHistory = [];
    this.updateChatView();

    this.safetyGuard.logOperation('clear_chat', {
      timestamp: new Date().toISOString()
    });
  }

  private async showSafetyInfo(): Promise<void> {
    await vscode.commands.executeCommand('automatus.showSafetyStatus');
  }

  private initializeChat(): void {
    const config = this.configManager.getConfiguration();
    const phaseInfo = this.configManager.getPhaseInfo();

    this.addMessageToHistory({
      role: 'assistant',
      content: `Welcome to Automatus! I'm running in **${phaseInfo.name}**.\n\nIn this phase, I can:\n${phaseInfo.permissions.map((p: string) => `- ${p.replace('_', ' ')}`).join('\n')}\n\nHow can I help you today?`,
      timestamp: new Date().toISOString()
    });

    this.updateChatView();
  }

  private showTypingIndicator(): void {
    this.view?.webview.postMessage({
      type: 'showTyping'
    });
  }

  private hideTypingIndicator(): void {
    this.view?.webview.postMessage({
      type: 'hideTyping'
    });
  }

  private updateChatView(): void {
    this.view?.webview.postMessage({
      type: 'updateChat',
      messages: this.chatHistory
    });
  }

  private updateSafetyStatus(): void {
    const config = this.configManager.getConfiguration();
    const phaseInfo = this.configManager.getPhaseInfo();

    this.view?.webview.postMessage({
      type: 'updateSafetyStatus',
      phase: config.safetyPhase,
      phaseName: phaseInfo.name,
      connected: this.client.isConnected()
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 10px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            background-color: var(--vscode-panel-background);
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 10px;
            font-size: 12px;
        }

        .status {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .phase-indicator {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
        }

        .connection-status {
            font-size: 10px;
        }

        .connected { color: #4CAF50; }
        .disconnected { color: #f44336; }

        .chat-container {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 10px;
            padding: 5px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
        }

        .message {
            margin-bottom: 15px;
            padding: 8px;
            border-radius: 6px;
        }

        .user-message {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: 20px;
        }

        .assistant-message {
            background-color: var(--vscode-panel-background);
            margin-right: 20px;
        }

        .error-message {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }

        .message-content {
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .timestamp {
            font-size: 10px;
            opacity: 0.6;
            margin-top: 5px;
        }

        .input-container {
            display: flex;
            gap: 5px;
        }

        .message-input {
            flex: 1;
            padding: 8px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: inherit;
        }

        .send-button {
            padding: 8px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
        }

        .send-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .actions {
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
        }

        .action-button {
            padding: 4px 8px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        .action-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .typing-indicator {
            display: none;
            padding: 8px;
            font-style: italic;
            opacity: 0.7;
        }

        .typing-indicator.visible {
            display: block;
        }

        code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }

        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="status">
            <span class="phase-indicator" id="phaseIndicator">Phase 1</span>
            <span class="connection-status" id="connectionStatus">●</span>
        </div>
    </div>

    <div class="actions">
        <button class="action-button" onclick="clearChat()">Clear</button>
        <button class="action-button" onclick="showSafetyInfo()">Safety Info</button>
    </div>

    <div class="chat-container" id="chatContainer"></div>

    <div class="typing-indicator" id="typingIndicator">Automatus is thinking...</div>

    <div class="input-container">
        <input
            type="text"
            class="message-input"
            id="messageInput"
            placeholder="Ask Automatus for help (preview-only in Phase 1)..."
            onkeypress="handleKeyPress(event)"
        >
        <button class="send-button" id="sendButton" onclick="sendMessage()">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let messages = [];

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();

            if (text) {
                vscode.postMessage({
                    type: 'sendMessage',
                    text: text
                });
                input.value = '';
                input.focus();
            }
        }

        function clearChat() {
            vscode.postMessage({
                type: 'clearChat'
            });
        }

        function showSafetyInfo() {
            vscode.postMessage({
                type: 'showSafetyInfo'
            });
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }

        function updateChatDisplay() {
            const container = document.getElementById('chatContainer');
            container.innerHTML = '';

            messages.forEach(message => {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${message.role}-message\${message.isError ? ' error-message' : ''}\`;

                const contentDiv = document.createElement('div');
                contentDiv.className = 'message-content';

                // Simple markdown-like formatting
                let content = message.content
                    .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                    .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
                    .replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\\n\`\`\`/g, '<pre><code>$2</code></pre>')
                    .replace(/\`([^\`]+)\`/g, '<code>$1</code>');

                contentDiv.innerHTML = content;
                messageDiv.appendChild(contentDiv);

                const timestampDiv = document.createElement('div');
                timestampDiv.className = 'timestamp';
                timestampDiv.textContent = new Date(message.timestamp).toLocaleTimeString();
                messageDiv.appendChild(timestampDiv);

                container.appendChild(messageDiv);
            });

            container.scrollTop = container.scrollHeight;
        }

        function showTyping() {
            document.getElementById('typingIndicator').classList.add('visible');
            document.getElementById('sendButton').disabled = true;
        }

        function hideTyping() {
            document.getElementById('typingIndicator').classList.remove('visible');
            document.getElementById('sendButton').disabled = false;
        }

        function updateSafetyStatus(phase, phaseName, connected) {
            document.getElementById('phaseIndicator').textContent = \`Phase \${phase}\`;
            const connectionEl = document.getElementById('connectionStatus');
            connectionEl.className = \`connection-status \${connected ? 'connected' : 'disconnected'}\`;
            connectionEl.textContent = connected ? '● Connected' : '● Disconnected';
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'updateChat':
                    messages = message.messages;
                    updateChatDisplay();
                    break;
                case 'showTyping':
                    showTyping();
                    break;
                case 'hideTyping':
                    hideTyping();
                    break;
                case 'updateSafetyStatus':
                    updateSafetyStatus(message.phase, message.phaseName, message.connected);
                    break;
            }
        });

        // Focus input on load
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('messageInput').focus();
        });
    </script>
</body>
</html>`;
  }
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isError?: boolean;
}