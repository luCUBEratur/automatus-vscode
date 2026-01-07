import * as vscode from 'vscode';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SafetyGuard } from '../safety/SafetyGuard';

export interface TokenPayload {
  userId: string;
  sessionId: string;
  permissions: string[];
  safetyPhase: number;
  clientInfo: {
    name: string;
    version: string;
    platform: string;
  };
  iat: number;
  exp: number;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  payload?: TokenPayload;
  error?: string;
}

export interface TokenInfo {
  token: string;
  payload: TokenPayload;
  createdAt: Date;
  lastUsed: Date;
  revoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

export class AuthenticationManager {
  private configManager: ConfigurationManager;
  private safetyGuard: SafetyGuard;
  private secretKey!: string;
  private revokedTokens: Set<string> = new Set();
  private activeTokens: Map<string, TokenInfo> = new Map();
  private tokenStorePath: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // IP-based blocking
  private blockedIPs: Map<string, { blockedAt: number; reason: string }> = new Map();
  private authFailures: Map<string, { count: number; lastAttempt: number; attempts: number[] }> = new Map();

  // Rate limiting
  private ipRateLimiter: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly MAX_AUTH_ATTEMPTS_PER_IP = 10;
  private readonly AUTH_RATE_WINDOW = 300000; // 5 minutes
  private readonly IP_BLOCK_DURATION = 3600000; // 1 hour

  constructor(configManager: ConfigurationManager, safetyGuard: SafetyGuard, context: vscode.ExtensionContext) {
    this.configManager = configManager;
    this.safetyGuard = safetyGuard;
    this.tokenStorePath = path.join(context.globalStoragePath, 'bridge-tokens.json');

    this.initializeSecretKey(context);
    this.loadPersistedData();
    this.startCleanupInterval();
  }

  private initializeSecretKey(context: vscode.ExtensionContext): void {
    // Generate or load a persistent secret key
    const secretKeyPath = path.join(context.globalStoragePath, 'bridge-secret.key');

    try {
      if (fs.existsSync(secretKeyPath)) {
        this.secretKey = fs.readFileSync(secretKeyPath, 'utf8');
      } else {
        // Generate a strong secret key
        this.secretKey = crypto.randomBytes(64).toString('hex');

        // Ensure directory exists
        const dir = path.dirname(secretKeyPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Save the secret key securely
        fs.writeFileSync(secretKeyPath, this.secretKey, { mode: 0o600 });
      }
    } catch (error) {
      // Fallback to session-based secret if file system is not available
      this.secretKey = crypto.randomBytes(64).toString('hex');
      vscode.window.showWarningMessage(
        'Bridge authentication using session-based secret. Tokens will not persist across restarts.'
      );
    }
  }

  private loadPersistedData(): void {
    try {
      if (fs.existsSync(this.tokenStorePath)) {
        const data = JSON.parse(fs.readFileSync(this.tokenStorePath, 'utf8'));

        // Load revoked tokens
        if (data.revokedTokens) {
          this.revokedTokens = new Set(data.revokedTokens);
        }

        // Load blocked IPs (only if not expired)
        if (data.blockedIPs) {
          const now = Date.now();
          for (const [ip, blockInfo] of Object.entries(data.blockedIPs)) {
            const block = blockInfo as { blockedAt: number; reason: string };
            if (now - block.blockedAt < this.IP_BLOCK_DURATION) {
              this.blockedIPs.set(ip, block);
            }
          }
        }
      }
    } catch (error) {
      // Ignore load errors, start fresh
      this.safetyGuard.logOperation('auth_data_load_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private savePersistedData(): void {
    try {
      const data = {
        revokedTokens: Array.from(this.revokedTokens),
        blockedIPs: Object.fromEntries(this.blockedIPs),
        lastSaved: new Date().toISOString()
      };

      // Ensure directory exists
      const dir = path.dirname(this.tokenStorePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.tokenStorePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (error) {
      this.safetyGuard.logOperation('auth_data_save_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async generateToken(clientInfo: { name: string; version: string; platform: string }, userId: string = 'bridge-user'): Promise<string> {
    const config = this.configManager.getConfiguration();
    const sessionId = crypto.randomUUID();

    const payload: TokenPayload = {
      userId,
      sessionId,
      permissions: this.getPermissionsForPhase(config.safetyPhase),
      safetyPhase: config.safetyPhase,
      clientInfo,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const token = jwt.sign(payload, this.secretKey, {
      algorithm: 'HS256',
      issuer: 'automatus-vscode-bridge',
      audience: 'automatus-tui'
    });

    // Store token info
    const tokenInfo: TokenInfo = {
      token,
      payload,
      createdAt: new Date(),
      lastUsed: new Date(),
      revoked: false
    };

    this.activeTokens.set(token, tokenInfo);

    this.safetyGuard.logOperation('bridge_token_generated', {
      sessionId,
      safetyPhase: config.safetyPhase,
      clientInfo,
      expiresIn: '24h'
    });

    return token;
  }

  async validateToken(token: string, clientIP: string): Promise<AuthResult> {
    // Check IP blocking first
    if (this.isIPBlocked(clientIP)) {
      const blockInfo = this.blockedIPs.get(clientIP);
      return {
        success: false,
        error: `IP blocked: ${blockInfo?.reason || 'Security violation'}`
      };
    }

    // Check IP rate limiting
    if (!this.checkIPRateLimit(clientIP)) {
      this.recordAuthFailure(clientIP, 'Rate limit exceeded');
      return {
        success: false,
        error: 'Authentication rate limit exceeded. Please try again later.'
      };
    }

    try {
      // Check if token is revoked
      if (this.revokedTokens.has(token)) {
        this.recordAuthFailure(clientIP, 'Revoked token used');
        return {
          success: false,
          error: 'Token has been revoked'
        };
      }

      // Verify JWT signature and decode
      const decoded = jwt.verify(token, this.secretKey, {
        algorithms: ['HS256'],
        issuer: 'automatus-vscode-bridge',
        audience: 'automatus-tui'
      }) as TokenPayload;

      // Additional validation
      const config = this.configManager.getConfiguration();

      // Check if safety phase has changed (tokens are only valid for current phase or lower)
      if (decoded.safetyPhase > config.safetyPhase) {
        this.recordAuthFailure(clientIP, 'Safety phase mismatch');
        return {
          success: false,
          error: 'Token safety phase is higher than current configuration'
        };
      }

      // Update token usage
      const tokenInfo = this.activeTokens.get(token);
      if (tokenInfo) {
        tokenInfo.lastUsed = new Date();
      }

      this.safetyGuard.logOperation('bridge_token_validated', {
        sessionId: decoded.sessionId,
        clientIP,
        safetyPhase: decoded.safetyPhase,
        clientInfo: decoded.clientInfo
      });

      return {
        success: true,
        payload: decoded
      };

    } catch (error) {
      let errorMsg: string;

      if (error instanceof jwt.JsonWebTokenError) {
        errorMsg = 'Invalid token signature';
      } else if (error instanceof jwt.TokenExpiredError) {
        errorMsg = 'Token has expired';
      } else if (error instanceof jwt.NotBeforeError) {
        errorMsg = 'Token not yet valid';
      } else {
        errorMsg = 'Token validation failed';
      }

      this.recordAuthFailure(clientIP, errorMsg);

      this.safetyGuard.logOperation('bridge_token_validation_failed', {
        error: errorMsg,
        clientIP,
        tokenPresent: !!token
      });

      return {
        success: false,
        error: errorMsg
      };
    }
  }

  revokeToken(token: string, reason: string = 'Manual revocation'): void {
    this.revokedTokens.add(token);

    const tokenInfo = this.activeTokens.get(token);
    if (tokenInfo) {
      tokenInfo.revoked = true;
      tokenInfo.revokedAt = new Date();
      tokenInfo.revokedReason = reason;
    }

    this.savePersistedData();

    this.safetyGuard.logOperation('bridge_token_revoked', {
      reason,
      sessionId: tokenInfo?.payload.sessionId || 'unknown'
    });
  }

  revokeAllTokens(reason: string = 'Mass revocation'): void {
    for (const [token, tokenInfo] of this.activeTokens) {
      this.revokedTokens.add(token);
      tokenInfo.revoked = true;
      tokenInfo.revokedAt = new Date();
      tokenInfo.revokedReason = reason;
    }

    this.savePersistedData();

    this.safetyGuard.logOperation('bridge_all_tokens_revoked', {
      reason,
      count: this.activeTokens.size
    });
  }

  blockIP(ip: string, reason: string): void {
    this.blockedIPs.set(ip, {
      blockedAt: Date.now(),
      reason
    });

    this.savePersistedData();

    this.safetyGuard.logOperation('bridge_ip_blocked', {
      ip,
      reason
    });
  }

  unblockIP(ip: string): void {
    const wasBlocked = this.blockedIPs.delete(ip);

    if (wasBlocked) {
      this.savePersistedData();
      this.safetyGuard.logOperation('bridge_ip_unblocked', { ip });
    }
  }

  private isIPBlocked(ip: string): boolean {
    const blockInfo = this.blockedIPs.get(ip);
    if (!blockInfo) {
      return false;
    }

    // Check if block has expired
    if (Date.now() - blockInfo.blockedAt > this.IP_BLOCK_DURATION) {
      this.blockedIPs.delete(ip);
      return false;
    }

    return true;
  }

  private checkIPRateLimit(ip: string): boolean {
    const now = Date.now();
    let limiter = this.ipRateLimiter.get(ip);

    if (!limiter || now > limiter.resetTime) {
      // Reset or create new rate limit window
      limiter = { count: 1, resetTime: now + this.AUTH_RATE_WINDOW };
      this.ipRateLimiter.set(ip, limiter);
      return true;
    }

    if (limiter.count >= this.MAX_AUTH_ATTEMPTS_PER_IP) {
      return false;
    }

    limiter.count++;
    return true;
  }

  private recordAuthFailure(ip: string, reason: string): void {
    const now = Date.now();
    let failure = this.authFailures.get(ip) || { count: 0, lastAttempt: 0, attempts: [] };

    // Clean old attempts (older than 1 hour)
    failure.attempts = failure.attempts.filter(time => now - time < 3600000);

    failure.count++;
    failure.lastAttempt = now;
    failure.attempts.push(now);
    this.authFailures.set(ip, failure);

    // Block IP if too many failures
    if (failure.attempts.length >= 20) { // 20 failures in 1 hour
      this.blockIP(ip, `Too many authentication failures: ${reason}`);
    }

    this.safetyGuard.logOperation('bridge_auth_failure', {
      ip,
      reason,
      failureCount: failure.count,
      recentAttempts: failure.attempts.length
    });
  }

  private getPermissionsForPhase(phase: number): string[] {
    const permissions: string[] = ['read'];

    if (phase >= 2) {
      permissions.push('write_controlled');
    }

    if (phase >= 3) {
      permissions.push('write_expanded');
    }

    if (phase >= 4) {
      permissions.push('admin');
    }

    return permissions;
  }

  private startCleanupInterval(): void {
    // Clean up expired data every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredData();
    }, 3600000);
  }

  private cleanupExpiredData(): void {
    const now = Date.now();

    // Clean up IP blocks
    for (const [ip, blockInfo] of this.blockedIPs) {
      if (now - blockInfo.blockedAt > this.IP_BLOCK_DURATION) {
        this.blockedIPs.delete(ip);
      }
    }

    // Clean up rate limiters
    for (const [ip, limiter] of this.ipRateLimiter) {
      if (now > limiter.resetTime) {
        this.ipRateLimiter.delete(ip);
      }
    }

    // Clean up old auth failures
    for (const [ip, failure] of this.authFailures) {
      failure.attempts = failure.attempts.filter(time => now - time < 3600000);
      if (failure.attempts.length === 0) {
        this.authFailures.delete(ip);
      }
    }

    // Clean up expired tokens
    for (const [token, tokenInfo] of this.activeTokens) {
      if (tokenInfo.payload.exp * 1000 < now) {
        this.activeTokens.delete(token);
      }
    }

    this.savePersistedData();
  }

  getAuthenticationStatus(): {
    activeTokens: number;
    revokedTokens: number;
    blockedIPs: number;
    authFailures: number;
  } {
    return {
      activeTokens: this.activeTokens.size,
      revokedTokens: this.revokedTokens.size,
      blockedIPs: this.blockedIPs.size,
      authFailures: this.authFailures.size
    };
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.savePersistedData();
  }
}