# TUI-VSCode Connection Implementation

This directory contains the implementation for connecting the Automatus TUI (Terminal User Interface) to the VSCode extension, enabling **TUI-controlled coding** as specified in Prompt 45.

## Architecture Overview

The TUI connection system consists of three main components:

```
Automatus TUI → WebSocket → VSCode Extension
     ↓              ↓              ↓
   Commands    Authentication   Execution
```

## Core Components

### 1. `TUIClient.ts`
- **Purpose**: WebSocket client that connects from VSCode to the bridge server
- **Key Features**:
  - Automatic reconnection with exponential backoff
  - JWT-based authentication
  - Command-response correlation
  - Heartbeat monitoring
  - Error handling and recovery

### 2. `TUIConnectionManager.ts`
- **Purpose**: High-level manager that integrates TUI client with VSCode extension
- **Key Features**:
  - VSCode status bar integration
  - Safety guard integration
  - Command logging and monitoring
  - User-friendly error messages
  - Connection state management

### 3. `TUIConnectionTest.ts`
- **Purpose**: Testing utilities and examples for TUI connection functionality
- **Key Features**:
  - Connection flow testing
  - Error handling verification
  - Status monitoring examples

## How It Works

### Connection Flow

1. **Bridge Server Setup**: VSCode extension starts bridge server on port 19888
2. **Token Generation**: Extension generates JWT token for TUI authentication
3. **TUI Connection**: TUI client connects to bridge server WebSocket
4. **Authentication**: TUI client authenticates using JWT token
5. **Command Exchange**: TUI can send commands, VSCode executes them

### Message Protocol

All messages follow the `BridgeMessage` interface:

```typescript
interface BridgeMessage {
  id: string;
  type: BridgeMessageType;
  timestamp: string;
  source: 'TUI' | 'VSCODE';
  sessionId: string;
}
```

### Command Structure

TUI commands use this structure:

```typescript
interface TUICommand extends BridgeMessage {
  type: 'COMMAND_EXECUTE';
  payload: {
    command: string;                    // Command name (e.g., 'ping', 'getStatus')
    args: any;                         // Command arguments
    safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access';
  };
}
```

## Usage Examples

### Basic Connection (from VSCode)

```typescript
import { TUIConnectionManager } from './TUIConnectionManager';

const tuiManager = new TUIConnectionManager(configManager, safetyGuard);

// Connect to TUI
await tuiManager.connectToTUI();

// Send a command
const response = await tuiManager.sendCommand({
  command: 'analyzeFile',
  args: { filePath: 'src/index.ts' },
  safetyLevel: 'read_only'
});
```

### VSCode Commands Available

The implementation adds these VSCode commands:

- `automatus.tui.connect` - Connect to Automatus TUI
- `automatus.tui.disconnect` - Disconnect from TUI
- `automatus.tui.showMenu` - Show TUI connection menu with options

### Status Bar Integration

The connection manager adds a status bar item showing:
- **Disconnected**: `$(circle-outline) TUI: Disconnected` (warning background)
- **Connecting**: `$(loading~spin) TUI: Connecting...` (prominent background)
- **Connected**: `$(check-all) TUI: Connected` (normal background)

## Testing

Run the included tests to verify functionality:

```typescript
import { runTUIConnectionTests } from './TUIConnectionTest';

// Run all TUI connection tests
await runTUIConnectionTests();
```

## Integration with Prompt 45 Goals

This implementation directly addresses Phase 1 requirements from Prompt 45:

### ✅ **Phase 1: Foundation + Bridge (Lines 390-396)**
- [x] **TUI-VSCode bridge communication protocol** ← **IMPLEMENTED**
- [x] **Workspace context sharing (TUI ↔ VSCode)** ← **Foundation ready**
- [x] **Basic command routing (TUI commands → VSCode execution)** ← **IMPLEMENTED**

### **Primary Goals Achieved**:
1. **TUI-Controlled Coding**: ✅ TUI can send commands to VSCode
2. **Bridge Architecture**: ✅ Secure WebSocket communication
3. **Workspace Integration**: ✅ Foundation for reading/modifying VSCode files
4. **Flexible Interface Options**: ✅ Works standalone OR as TUI endpoint

## Security Features

- **JWT Authentication**: Real cryptographic token validation
- **IP Blocking**: Automatic blocking of suspicious connections
- **Rate Limiting**: Per-IP and per-connection message limits
- **Safety Integration**: All commands logged through SafetyGuard
- **Origin Validation**: WebSocket origin checking for security

## Next Steps (Phase 2)

With the basic TUI connection implemented, the next steps from Prompt 45 are:

1. **Workspace Context Sharing**: Implement methods to send VSCode workspace state to TUI
2. **File Operations**: Enable TUI to read/modify VSCode files with approval
3. **Advanced Commands**: Implement specific coding commands (refactor, analyze, etc.)
4. **Visual Feedback**: Spawn VSCode UI panels from TUI commands

## Configuration

The TUI connection uses these VSCode settings:

```json
{
  "automatus.bridge.port": 19888,
  "automatus.bridge.timeout": 30000,
  "automatus.bridge.retryAttempts": 3,
  "automatus.bridge.enableHeartbeat": true,
  "automatus.bridge.heartbeatInterval": 30000
}
```

## Troubleshooting

### Common Issues

1. **Connection Failed**: Ensure bridge server is running (`automatus.bridge.start`)
2. **Authentication Failed**: Check JWT token generation
3. **Command Timeout**: Increase `bridge.timeout` setting
4. **Port Conflicts**: Change `bridge.port` setting

### Debug Mode

Enable debug logging by checking the extension console and SafetyGuard logs.