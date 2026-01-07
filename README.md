# Automatus VSCode Extension

AI-powered development assistant with safety-first architecture. Automatus provides intelligent code generation, analysis, and explanation capabilities while maintaining strict safety guardrails through an incremental permission system.

## Features

### Phase 1: Read-Only Safety Phase
- **Code Preview Generation**: Generate code snippets with detailed explanations (preview-only)
- **Code Analysis**: Analyze selected code for issues, complexity, and quality metrics
- **Code Explanation**: Get detailed explanations of complex code sections
- **Interactive Chat**: AI-powered chat interface for development questions
- **Safety Status**: Monitor current safety phase and permissions

### Advanced Phases (Incremental Unlock)
- **Phase 2**: Controlled write operations to safe directories
- **Phase 3**: Expanded permissions with user approval
- **Phase 4**: Advanced features with proven safety record

## Safety Features

- **Incremental Permission System**: Progress through safety phases as trust is established
- **User Approval Required**: Explicit consent for all file operations
- **Comprehensive Audit Logging**: Track all AI actions and modifications
- **Automatic Backups**: Safe backup creation before any changes
- **Emergency Stop**: Immediate halt of all AI operations when needed
- **Restricted Path Protection**: Block access to critical system files

## Requirements

- Visual Studio Code 1.74.0 or higher
- Optional: Automatus server for full functionality (extension works offline with limited features)

## Extension Settings

This extension contributes the following settings:

* `automatus.kernel.mode`: How to connect to Automatus kernel (`external` or `embedded`)
* `automatus.safety.currentPhase`: Current safety phase (1-4)
* `automatus.safety.allowedDirectories`: Directories where file operations are permitted
* `automatus.safety.requireApproval`: Require user approval for file operations
* `automatus.safety.createBackups`: Create backups before modifying files
* `automatus.codeGeneration.mode`: Code generation mode (`preview_only`, `controlled_write`, or `full_access`)
* `automatus.audit.logLevel`: Audit logging level (`all`, `changes_only`, or `errors_only`)
* `automatus.server.url`: Automatus server WebSocket URL

## Commands

### Phase 1 Commands
- `Automatus: Generate Code Preview` - Generate code with preview-only output
- `Automatus: Analyze Code Selection` - Analyze selected code for issues
- `Automatus: Explain Code` - Get detailed code explanations
- `Automatus: Open Chat Panel` - Open the interactive AI chat
- `Automatus: Show Safety Status` - Display current safety configuration

### Safety Management
- `Automatus: Upgrade Safety Phase` - Progress to next safety phase
- `Automatus: Emergency Stop` - Immediately halt all AI operations
- `Automatus: View Audit Log` - Review audit trail of all actions

## Getting Started

1. Install the extension
2. Open the Automatus chat panel from the Activity Bar
3. Start with code explanations and previews in Phase 1
4. Progress to higher phases as you build trust with the system

## Known Issues

- Extension requires server connection for full functionality (graceful offline fallback available)
- File operations intentionally restricted by safety phase for security
- Some advanced features planned for higher safety phases

## Release Notes

### 0.1.0

Initial MVP release featuring:
- Safety-first architecture with Phase 1 (read-only) operations
- Code preview generation and analysis
- Interactive chat interface
- Comprehensive safety monitoring and audit logging
- Foundation for incremental permission expansion
