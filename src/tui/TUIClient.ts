import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { TUICommand, VSCodeResponse, BridgeMessage } from '../bridge/types';

export interface TUIConnectionConfig {
  bridgeUrl: string;
  authToken: string;
  reconnectAttempts: number;
  reconnectDelay: number;
  heartbeatInterval: number;
}

export interface TUIClientEvents {
  'connected': () => void;
  'disconnected': (reason: string) => void;
  'message': (response: VSCodeResponse) => void;
  'error': (error: Error) => void;
  'authenticated': () => void;
  'authFailed': (reason: string) => void;
}

export declare interface TUIClient {
  on<U extends keyof TUIClientEvents>(event: U, listener: TUIClientEvents[U]): this;
  emit<U extends keyof TUIClientEvents>(event: U, ...args: Parameters<TUIClientEvents[U]>): boolean;
}

export class TUIClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private config: TUIConnectionConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private isAuthenticated = false;
  private reconnectAttempt = 0;
  private messageId = 0;
  private pendingCommands = new Map<string, {
    resolve: (response: VSCodeResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(config: TUIConnectionConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.config.bridgeUrl);

        const connectionTimeout = setTimeout(() => {
          if (this.socket) {
            this.socket.terminate();
          }
          reject(new Error('Connection timeout'));
        }, 10000);

        this.socket.on('open', () => {
          clearTimeout(connectionTimeout);
          this.isConnected = true;
          this.reconnectAttempt = 0;
          this.emit('connected');
          this.authenticate()
            .then(() => resolve())
            .catch(reject);
        });

        this.socket.on('close', (code: number, reason: string) => {
          clearTimeout(connectionTimeout);
          this.handleDisconnect(`Connection closed: ${code} ${reason}`);
          if (this.reconnectAttempt === 0) {
            reject(new Error(`Connection failed: ${code} ${reason}`));
          }
        });

        this.socket.on('error', (error: Error) => {
          clearTimeout(connectionTimeout);
          this.emit('error', error);
          reject(error);
        });

        this.socket.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private async authenticate(): Promise<void> {
    if (!this.isConnected || !this.socket) {
      throw new Error('Not connected to bridge');
    }

    return new Promise((resolve, reject) => {
      // Send authentication request command as expected by TUIVSCodeBridge
      const authCommand: TUICommand = {
        id: this.generateMessageId(),
        type: 'COMMAND_EXECUTE',
        timestamp: new Date().toISOString(),
        source: 'TUI',
        sessionId: 'tui-auth-session',
        payload: {
          command: 'auth_request',
          args: {
            token: this.config.authToken
          },
          safetyLevel: 'read_only'
        }
      };

      const timeout = setTimeout(() => {
        this.emit('authFailed', 'Authentication timeout');
        reject(new Error('Authentication timeout'));
      }, 5000);

      // Listen for auth response
      const authHandler = (response: VSCodeResponse) => {
        clearTimeout(timeout);
        if (response.payload.success) {
          this.isAuthenticated = true;
          this.startHeartbeat();
          this.emit('authenticated');
          resolve();
        } else {
          this.emit('authFailed', response.payload.error || 'Authentication failed');
          reject(new Error(response.payload.error || 'Authentication failed'));
        }
      };

      // Temporarily listen for the auth response
      this.once('message', authHandler);

      this.socket!.send(JSON.stringify(authCommand));
    });
  }

  async sendCommand(command: { command: string; args: any; safetyLevel: 'read_only' | 'controlled_write' | 'expanded_access' }): Promise<VSCodeResponse> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated with bridge');
    }

    if (!this.socket) {
      throw new Error('No active connection');
    }

    const fullCommand: TUICommand = {
      id: this.generateMessageId(),
      type: 'COMMAND_EXECUTE',
      timestamp: new Date().toISOString(),
      source: 'TUI',
      sessionId: 'tui-session',
      payload: command
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(fullCommand.id);
        reject(new Error('Command timeout'));
      }, 30000); // 30 second timeout

      this.pendingCommands.set(fullCommand.id, {
        resolve,
        reject,
        timeout
      });

      this.socket!.send(JSON.stringify(fullCommand));
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as any;

      // Handle heartbeat messages differently
      if (message.type === 'HEARTBEAT') {
        this.handleHeartbeat();
        return;
      }

      const response = message as VSCodeResponse;

      // Handle pending command responses
      const pending = this.pendingCommands.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(response.id);

        if (response.payload.success) {
          pending.resolve(response);
        } else {
          pending.reject(new Error(response.payload.error || 'Command failed'));
        }
        return;
      }

      // Emit general message event
      this.emit('message', response);

    } catch (error) {
      this.emit('error', new Error(`Failed to parse message: ${error}`));
    }
  }

  private handleDisconnect(reason: string): void {
    this.isConnected = false;
    this.isAuthenticated = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection lost'));
    }
    this.pendingCommands.clear();

    this.emit('disconnected', reason);

    // Auto-reconnect if configured
    if (this.reconnectAttempt < this.config.reconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = this.config.reconnectDelay * this.reconnectAttempt;

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.emit('error', error);
        if (this.reconnectAttempt < this.config.reconnectAttempts) {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isAuthenticated && this.socket) {
        const heartbeat: BridgeMessage = {
          id: this.generateMessageId(),
          type: 'HEARTBEAT',
          timestamp: new Date().toISOString(),
          source: 'TUI',
          sessionId: 'tui-heartbeat'
        };
        this.socket.send(JSON.stringify(heartbeat));
      }
    }, this.config.heartbeatInterval);
  }

  private handleHeartbeat(): void {
    // Heartbeat received, connection is healthy
    // Could implement latency tracking here
  }

  private generateMessageId(): string {
    return `tui-${Date.now()}-${++this.messageId}`;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    this.isConnected = false;
    this.isAuthenticated = false;
  }

  isConnectionActive(): boolean {
    return this.isConnected && this.isAuthenticated;
  }

  getConnectionState() {
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      reconnectAttempt: this.reconnectAttempt,
      pendingCommands: this.pendingCommands.size
    };
  }
}