# Automatus VSCode Extension - Installation & Usage Guide

## Installation

### Method 1: Install from VSIX (Recommended for testing)
1. Open VSCode
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) to open the command palette
3. Type "Extensions: Install from VSIX..." and select it
4. Navigate to the `automatus-0.1.0.vsix` file and select it
5. The extension will be installed and activated automatically

### Method 2: Development Installation
1. Clone or copy the extension source code to your machine
2. Open the extension folder in VSCode
3. Press `F5` to launch a new VSCode window with the extension loaded for testing

## First Time Setup

1. **Activate the Extension**: The extension activates automatically when VSCode starts
2. **Check Safety Status**: You'll see a notification showing you're in Phase 1 (Read-Only Safety Phase)
3. **Open Automatus Views**: Look for the robot icon (🤖) in the Activity Bar or go to View → Open View → Automatus Chat

## Using the Extension

### Phase 1 Features (Available Immediately)

#### 1. Interactive Chat
- Click the robot icon in the Activity Bar to open the Automatus chat panel
- Ask questions about code, request explanations, or generate code previews
- Example prompts:
  - "Explain this function"
  - "Generate a function to sort an array"
  - "What does this code do?"

#### 2. Code Analysis
1. Select code in any file
2. Right-click and select "Automatus: Analyze Code Selection" (or use Command Palette)
3. View detailed analysis including quality score, complexity, and suggestions

#### 3. Code Explanation
1. Select code you want explained
2. Use "Automatus: Explain Code" command
3. Get detailed explanations with key concepts and related information

#### 4. Code Preview Generation
1. Use "Automatus: Generate Code Preview" command
2. Enter your request (e.g., "Create a React component for a login form")
3. View the generated code with explanation (preview-only, no files modified)

#### 5. Safety Status Monitoring
- Use "Automatus: Show Safety Status" to view current permissions and phase information
- Monitor audit logs and safety settings

### Configuration

Access extension settings through:
- **File → Preferences → Settings** (or **Code → Preferences → Settings** on Mac)
- Search for "Automatus"

Key settings:
- **Safety Phase**: Currently locked to Phase 1 for safety
- **Server URL**: Configure connection to Automatus server (default: ws://localhost:8000)
- **Allowed Directories**: Directories where file operations will be permitted in higher phases
- **Require Approval**: Whether to require user approval for file operations
- **Create Backups**: Whether to create backups before modifying files

### Safety Features

#### Phase-based Permissions
- **Phase 1 (Current)**: Read-only operations, code previews, analysis
- **Phase 2+**: Will enable controlled file operations as safety is demonstrated

#### Audit Logging
- All interactions are logged for safety and debugging
- View logs through "Automatus: Show Safety Status" or the Safety Status tree view

#### Emergency Stop
- Use "Automatus: Emergency Stop" if you need to immediately halt all AI operations
- This is logged and can be reviewed later

## Troubleshooting

### Extension Not Responding
1. Check the Output panel (View → Output) and select "Automatus" from the dropdown
2. Look for error messages or connection issues
3. Try reloading VSCode (Developer: Reload Window)

### Server Connection Issues
- The extension works in offline mode with limited functionality
- To connect to an Automatus server, ensure it's running on the configured URL
- Default server URL: ws://localhost:8000

### Commands Not Appearing
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Search for "Automatus" - all commands should be prefixed with "Automatus:"
3. If commands are missing, try reloading the window

### Permission Errors
- In Phase 1, file modification operations are intentionally blocked
- This is expected behavior for safety
- Use preview operations instead of write operations

## Advanced Usage

### Progressing to Higher Phases
Future versions will allow progressing to Phase 2 and beyond as safety is demonstrated:
1. Use "Automatus: Upgrade Safety Phase" command (when available)
2. Review and approve additional permissions
3. Configure allowed directories for file operations

### Custom Configuration
```json
{
  "automatus.safety.allowedDirectories": [
    "./src/temp/",
    "./tests/generated/",
    "./sandbox/"
  ],
  "automatus.audit.logLevel": "all",
  "automatus.safety.requireApproval": true
}
```

## Support

For issues or questions:
1. Check the Output panel for error messages
2. Review the audit logs through the Safety Status view
3. Ensure you're using features appropriate for your current safety phase

## Safety Notes

- The extension is designed with safety as the primary concern
- Phase 1 operations are read-only and cannot modify files
- All interactions are logged for audit purposes
- The incremental permission system ensures controlled capability expansion

Enjoy using Automatus safely and productively!