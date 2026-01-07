import * as vscode from 'vscode';
import { BridgeServer } from './bridge/BridgeServer';
import { SafeAutomatusClient } from './automatus-client/SafeAutomatusClient';
import { SafetyGuard } from './safety/SafetyGuard';
import { ConfigurationManager } from './config/ConfigurationManager';
import { Phase1Commands } from './commands/Phase1Commands';
import { ChatViewProvider } from './ui/ChatViewProvider';
import { SafetyStatusViewProvider, SafetyStatusViewCommands } from './ui/SafetyStatusViewProvider';
import { TUIConnectionManager } from './tui/TUIConnectionManager';
import { WorkspaceContextManager } from './workspace/WorkspaceContextManager';
import { getExtensionLifecycle, safeRegisterDisposable, LifecycleComponent } from './utils/ExtensionLifecycle';

let bridgeServer: BridgeServer;
let client: SafeAutomatusClient;
let safetyGuard: SafetyGuard;
let configManager: ConfigurationManager;
let phase1Commands: Phase1Commands;
let chatProvider: ChatViewProvider;
let statusProvider: SafetyStatusViewProvider;
let statusCommands: SafetyStatusViewCommands;
let tuiConnectionManager: TUIConnectionManager;
let workspaceContextManager: WorkspaceContextManager;

export async function activate(context: vscode.ExtensionContext) {
	console.log('Activating Automatus extension...');

	try {
		// Initialize extension lifecycle management
		await getExtensionLifecycle().initialize(context);
		// Initialize configuration manager
		configManager = ConfigurationManager.getInstance();
		const config = configManager.getConfiguration();

		// Initialize safety guard first
		safetyGuard = new SafetyGuard(config);

		// Initialize bridge server
		bridgeServer = new BridgeServer(configManager, safetyGuard, context);

		// Initialize workspace context manager
		workspaceContextManager = new WorkspaceContextManager(safetyGuard, configManager);

		// Initialize TUI connection manager with bridge token generator
		tuiConnectionManager = new TUIConnectionManager(
			configManager,
			safetyGuard,
			async () => {
				return await bridgeServer.generateToken({
					name: 'automatus-tui-client',
					version: '1.0.0',
					platform: process.platform
				});
			}
		);

		// Initialize client
		client = new SafeAutomatusClient(config);

		// Initialize Phase 1 commands
		try {
			console.log('Extension: Creating Phase1Commands instance...');
			phase1Commands = new Phase1Commands(client, safetyGuard, configManager);
			console.log('Extension: Calling registerCommands...');
			phase1Commands.registerCommands(context);
			console.log('Extension: Phase1Commands registration completed');
		} catch (error) {
			console.error('Extension: Failed to initialize Phase1Commands:', error);
			vscode.window.showErrorMessage(`Failed to register commands: ${error}`);
		}

		// Initialize chat view provider
		chatProvider = new ChatViewProvider(context.extensionUri, client, safetyGuard, configManager);
		safeRegisterDisposable(
			vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
		);

		// Initialize safety status view provider
		statusProvider = new SafetyStatusViewProvider(configManager, safetyGuard, client);
		safeRegisterDisposable(
			vscode.window.registerTreeDataProvider('automatusStatus', statusProvider)
		);

		// Initialize safety status commands
		statusCommands = new SafetyStatusViewCommands(configManager, safetyGuard, statusProvider);
		statusCommands.registerCommands(context);

		// Set up configuration change handlers
		configManager.onConfigurationChanged((newConfig) => {
			client.updateConfig(newConfig);
			safetyGuard.updateConfig(newConfig);
		});

		// Set context for views visibility
		await vscode.commands.executeCommand('setContext', 'automatus.activated', true);

		// Attempt to connect to server (non-blocking)
		connectToServer();

		// Show welcome message
		const phaseInfo = configManager.getPhaseInfo();
		vscode.window.showInformationMessage(
			`Automatus activated with TUI bridge. ${phaseInfo.name} mode - ready for TUI commands.`
		);

		// Register additional commands
		registerGlobalCommands(context);

		// Register bridge commands
		registerBridgeCommands(context);

		console.log('Automatus extension activated successfully');

	} catch (error) {
		console.error('Failed to activate Automatus extension:', error);
		vscode.window.showErrorMessage(`Automatus activation failed: ${error}`);
	}
}

async function connectToServer(): Promise<void> {
	try {
		const connected = await client.connect();
		if (connected) {
			vscode.window.showInformationMessage('Connected to Automatus server');
			statusProvider.refresh();
		} else {
			vscode.window.showWarningMessage('Failed to connect to Automatus server. Some features may be limited.');
		}
	} catch (error) {
		console.warn('Server connection failed:', error);
		vscode.window.showWarningMessage('Automatus server not available. Running in offline mode.');
	}
}

function registerGlobalCommands(context: vscode.ExtensionContext): void {
	const commands = [
		vscode.commands.registerCommand('automatus.reconnect', async () => {
			try {
				await client.disconnect();
				const connected = await client.connect();
				if (connected) {
					vscode.window.showInformationMessage('Reconnected to Automatus server');
				} else {
					vscode.window.showErrorMessage('Failed to reconnect to Automatus server');
				}
				statusProvider.refresh();
			} catch (error) {
				vscode.window.showErrorMessage(`Reconnection failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('automatus.showOutput', () => {
			// This command is provided by the client's output channel
			client['outputChannel']?.show();
		}),

		vscode.commands.registerCommand('automatus.about', () => {
			const panel = vscode.window.createWebviewPanel(
				'automatusAbout',
				'About Automatus',
				vscode.ViewColumn.One,
				{ enableScripts: false }
			);

			const config = configManager.getConfiguration();
			const phaseInfo = configManager.getPhaseInfo();

			panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background-color: var(--vscode-panel-background);
            border-radius: 8px;
        }
        .logo {
            font-size: 48px;
            margin-bottom: 10px;
        }
        .version {
            color: var(--vscode-descriptionForeground);
        }
        .section {
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--vscode-input-background);
            border-radius: 5px;
        }
        .feature {
            margin: 8px 0;
            padding: 8px;
            background-color: var(--vscode-panel-background);
            border-radius: 3px;
        }
        .phase-indicator {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🤖</div>
        <h1>Automatus</h1>
        <div class="version">Version 0.1.0</div>
        <p>AI-powered development assistant with safety-first architecture</p>
    </div>

    <div class="section">
        <h3>Current Status</h3>
        <div class="phase-indicator">Phase ${config.safetyPhase}: ${phaseInfo.name}</div>
        <p>${phaseInfo.description}</p>
    </div>

    <div class="section">
        <h3>Available Features</h3>
        ${phaseInfo.permissions.map((perm: string) =>
            `<div class="feature">✓ ${perm.replace('_', ' ')}</div>`
        ).join('')}
    </div>

    <div class="section">
        <h3>Safety Features</h3>
        <div class="feature">✓ Incremental permission system</div>
        <div class="feature">✓ User approval for file operations</div>
        <div class="feature">✓ Comprehensive audit logging</div>
        <div class="feature">✓ Automatic backup creation</div>
        <div class="feature">✓ Emergency stop capability</div>
    </div>

    <div class="section">
        <h3>Getting Started</h3>
        <ul>
            <li>Open the Automatus chat panel to ask questions</li>
            <li>Select code and use "Explain Code" for detailed explanations</li>
            <li>Try "Generate Code Preview" for AI-powered code suggestions</li>
            <li>Check the Safety Status view for current permissions</li>
        </ul>
    </div>
</body>
</html>`;
		}),

		vscode.commands.registerCommand('automatus.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'automatus');
		})
	];

	commands.forEach(cmd => safeRegisterDisposable(cmd));
}

function registerBridgeCommands(context: vscode.ExtensionContext): void {
	const commands = [
		vscode.commands.registerCommand('automatus.bridge.start', async () => {
			try {
				await bridgeServer.start();
				// Connect workspace context manager to bridge
				const bridge = bridgeServer.getBridge();
				workspaceContextManager.setBridge(bridge);
				bridge.setWorkspaceContextManager(workspaceContextManager);
				vscode.window.showInformationMessage('TUI Bridge started successfully');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to start TUI Bridge: ${errorMsg}`);
			}
		}),

		vscode.commands.registerCommand('automatus.bridge.stop', async () => {
			try {
				await bridgeServer.stop();
				vscode.window.showInformationMessage('TUI Bridge stopped');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to stop TUI Bridge: ${errorMsg}`);
			}
		}),

		vscode.commands.registerCommand('automatus.bridge.status', async () => {
			const health = bridgeServer.getStatus();
			const metrics = bridgeServer.getMetrics();

			const panel = vscode.window.createWebviewPanel(
				'automatusBridgeStatus',
				'TUI Bridge Status',
				vscode.ViewColumn.One,
				{ enableScripts: false }
			);

			panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        .status {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .healthy { background-color: #1e4d2b; border-left: 4px solid #4caf50; }
        .degraded { background-color: #4d2e1e; border-left: 4px solid #ff9800; }
        .unhealthy { background-color: #4d1e1e; border-left: 4px solid #f44336; }
        .metric {
            display: inline-block;
            margin: 10px;
            padding: 15px;
            background-color: var(--vscode-input-background);
            border-radius: 5px;
            min-width: 120px;
            text-align: center;
        }
        .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .metric-label {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .issue {
            background-color: var(--vscode-inputValidation-errorBackground);
            padding: 8px;
            margin: 4px 0;
            border-radius: 3px;
            border-left: 3px solid var(--vscode-inputValidation-errorBorder);
        }
    </style>
</head>
<body>
    <h2>TUI Bridge Status</h2>

    <div class="status ${health.status}">
        <h3>Overall Health: ${health.status.toUpperCase()}</h3>
        <p>Port: ${health.configuration.port}</p>
        <p>Safety Phase: ${health.configuration.safetyPhase}</p>
        <p>Require Approval: ${health.configuration.requireApproval ? 'Yes' : 'No'}</p>
    </div>

    <div class="metrics">
        <div class="metric">
            <div class="metric-value">${metrics.connectionsActive}</div>
            <div class="metric-label">Active Connections</div>
        </div>
        <div class="metric">
            <div class="metric-value">${metrics.commandsExecuted}</div>
            <div class="metric-label">Commands Executed</div>
        </div>
        <div class="metric">
            <div class="metric-value">${metrics.errors}</div>
            <div class="metric-label">Errors</div>
        </div>
        <div class="metric">
            <div class="metric-value">${Math.round(metrics.uptime / 1000)}s</div>
            <div class="metric-label">Uptime</div>
        </div>
    </div>

    ${health.issues.length > 0 ? `
    <h3>Issues</h3>
    ${health.issues.map(issue => `<div class="issue">${issue}</div>`).join('')}
    ` : ''}
</body>
</html>`;
		}),

		vscode.commands.registerCommand('automatus.bridge.configure', async () => {
			await bridgeServer.configure();
		}),

		vscode.commands.registerCommand('automatus.bridge.health', async () => {
			const health = bridgeServer.getStatus();
			const status = health.status;
			const icon = status === 'healthy' ? '✅' : status === 'degraded' ? '⚠️' : '❌';

			vscode.window.showInformationMessage(
				`${icon} Bridge Health: ${status.toUpperCase()}${health.issues.length > 0 ? ` (${health.issues.length} issues)` : ''}`,
				'View Details'
			).then(choice => {
				if (choice === 'View Details') {
					vscode.commands.executeCommand('automatus.bridge.status');
				}
			});
		}),

		vscode.commands.registerCommand('automatus.bridge.metrics', async () => {
			const metrics = bridgeServer.getMetrics();
			const message = `Connections: ${metrics.connectionsActive}, Commands: ${metrics.commandsExecuted}, Errors: ${metrics.errors}, Uptime: ${Math.round(metrics.uptime / 1000)}s`;
			vscode.window.showInformationMessage(`📊 Bridge Metrics: ${message}`, 'View Details').then(choice => {
				if (choice === 'View Details') {
					vscode.commands.executeCommand('automatus.bridge.status');
				}
			});
		}),

		vscode.commands.registerCommand('automatus.bridge.generateToken', async () => {
			const clientName = await vscode.window.showInputBox({
				prompt: 'Enter client name',
				value: 'TUI Client',
				validateInput: (value) => value.length < 3 ? 'Client name must be at least 3 characters' : undefined
			});

			if (!clientName) {return;}

			try {
				const token = await bridgeServer.generateToken({
					name: clientName,
					version: '1.0.0',
					platform: process.platform
				});

				await vscode.env.clipboard.writeText(token);
				vscode.window.showInformationMessage(
					`🔑 Bridge token generated for "${clientName}" and copied to clipboard`,
					'Show Token'
				).then(choice => {
					if (choice === 'Show Token') {
						vscode.window.showInformationMessage(token, { modal: true });
					}
				});
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to generate token: ${errorMsg}`);
			}
		}),

		vscode.commands.registerCommand('automatus.bridge.revokeAllTokens', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'This will revoke ALL bridge tokens. Active TUI connections will be disconnected.',
				{ modal: true },
				'Revoke All'
			);

			if (confirm === 'Revoke All') {
				try {
					bridgeServer.revokeAllTokens('Manual revocation via VSCode command');
					vscode.window.showInformationMessage('All bridge tokens have been revoked');
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					vscode.window.showErrorMessage(`Failed to revoke tokens: ${errorMsg}`);
				}
			}
		}),

		vscode.commands.registerCommand('automatus.bridge.authStatus', async () => {
			try {
				const status = bridgeServer.getAuthenticationStatus();
				const message = `Authentication Status:
Active Tokens: ${status.activeTokens}
Revoked Tokens: ${status.revokedTokens}
Blocked IPs: ${status.blockedIPs}
Auth Failures: ${status.authFailures}`;

				vscode.window.showInformationMessage(message, { modal: true });
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to get auth status: ${errorMsg}`);
			}
		}),

		// TUI Connection Commands
		vscode.commands.registerCommand('automatus.tui.connect', async () => {
			try {
				// First ensure bridge is running
				if (!bridgeServer || bridgeServer.getStatus().status === 'unhealthy') {
					await bridgeServer.start();
					// Connect workspace context manager to bridge
					const bridge = bridgeServer.getBridge();
					workspaceContextManager.setBridge(bridge);
					bridge.setWorkspaceContextManager(workspaceContextManager);
				}

				// Connect to TUI (token will be auto-generated)
				await tuiConnectionManager.connectToTUI();
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to connect to TUI: ${errorMsg}`);
			}
		}),

		vscode.commands.registerCommand('automatus.tui.disconnect', () => {
			tuiConnectionManager.disconnect();
			vscode.window.showInformationMessage('Disconnected from Automatus TUI');
		}),

		vscode.commands.registerCommand('automatus.tui.showMenu', async () => {
			const connectionState = tuiConnectionManager.getConnectionState();
			const isConnected = tuiConnectionManager.isConnected();

			const options = [
				...(isConnected ? [
					'💬 Send Test Message',
					'📊 Get TUI Status',
					'🏓 Ping TUI',
					'🔌 Disconnect'
				] : [
					'🔗 Connect to TUI'
				]),
				'📋 Show Connection State'
			];

			const selection = await vscode.window.showQuickPick(options, {
				placeHolder: 'Select TUI action'
			});

			if (!selection) {return;}

			try {
				switch (selection) {
					case '🔗 Connect to TUI':
						vscode.commands.executeCommand('automatus.tui.connect');
						break;
					case '💬 Send Test Message':
						const message = await vscode.window.showInputBox({
							prompt: 'Enter test message to send to TUI'
						});
						if (message) {
							const response = await tuiConnectionManager.sendMessage(message);
							vscode.window.showInformationMessage(`TUI Response: ${JSON.stringify(response.payload.result)}`);
						}
						break;
					case '📊 Get TUI Status':
						const status = await tuiConnectionManager.getTUIStatus();
						vscode.window.showInformationMessage(`TUI Status: ${JSON.stringify(status)}`);
						break;
					case '🏓 Ping TUI':
						const pingResult = await tuiConnectionManager.pingTUI();
						vscode.window.showInformationMessage(`Ping result: ${pingResult ? '✅ Success' : '❌ Failed'}`);
						break;
					case '🔌 Disconnect':
						vscode.commands.executeCommand('automatus.tui.disconnect');
						break;
					case '📋 Show Connection State':
						const state = JSON.stringify(connectionState, null, 2);
						vscode.window.showInformationMessage(state, { modal: true });
						break;
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`TUI command failed: ${errorMsg}`);
			}
		})
	];

	commands.forEach(cmd => safeRegisterDisposable(cmd));
}

export async function deactivate(): Promise<void> {
	console.log('Deactivating Automatus extension...');

	// Clean up resources in proper order
	try {
		// First dispose TUI connection manager
		if (tuiConnectionManager) {
			tuiConnectionManager.dispose();
			tuiConnectionManager = undefined as any;
		}

		// Then dispose bridge server
		if (bridgeServer) {
			bridgeServer.dispose();
			bridgeServer = undefined as any;
		}

		// Then dispose command handlers to stop new operations
		if (phase1Commands) {
			try {
				phase1Commands.dispose();
			} catch (error) {
				// Ignore disposal errors - VSCode may have already disposed the store
				console.warn('Error disposing phase1Commands:', error);
			}
			phase1Commands = undefined as any;
		}

		// Then dispose client to clean up connections
		if (client) {
			try {
				client.dispose();
			} catch (error) {
				// Ignore disposal errors - VSCode may have already disposed the store
				console.warn('Error disposing client:', error);
			}
			client = undefined as any;
		}

		// Then dispose safety guard
		if (safetyGuard) {
			try {
				safetyGuard.dispose();
			} catch (error) {
				// Ignore disposal errors - VSCode may have already disposed the store
				console.warn('Error disposing safetyGuard:', error);
			}
			safetyGuard = undefined as any;
		}

		// Finally dispose configuration manager (it's a singleton, so be careful)
		if (configManager) {
			try {
				configManager.dispose();
			} catch (error) {
				// Ignore disposal errors - VSCode may have already disposed the store
				console.warn('Error disposing configManager:', error);
			}
			configManager = undefined as any;
		}

		// Clear other UI providers
		if (chatProvider) {
			chatProvider = undefined as any;
		}
		if (statusProvider) {
			statusProvider = undefined as any;
		}
		if (statusCommands) {
			statusCommands = undefined as any;
		}

		// Finally dispose all lifecycle managed resources
		try {
			await getExtensionLifecycle().deactivate();
		} catch (error) {
			console.warn('Error disposing lifecycle managed resources:', error);
		}

	} catch (error) {
		console.warn('Error during extension deactivation:', error);
	}

	console.log('Automatus extension deactivated');
}
