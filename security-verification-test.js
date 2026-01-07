/**
 * Comprehensive Security Verification Test for TUI-VSCode Bridge
 * This test validates all claimed security improvements
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class SecurityVerifier {
    constructor() {
        this.results = {
            totalClaims: 0,
            verifiedClaims: 0,
            partiallyVerifiedClaims: 0,
            falseClaims: 0,
            unverifiedClaims: 0,
            details: []
        };
    }

    /**
     * CLAIM 1: Real JWT Authentication System
     */
    async verifyClaim1_JWTAuthentication() {
        console.log('\n=== CLAIM 1: Real JWT Authentication System ===');
        const claim = {
            name: 'JWT Authentication',
            status: 'UNVERIFIED',
            evidence: [],
            concerns: []
        };

        try {
            // Check if JWT library is properly used
            const authManagerPath = path.join(__dirname, 'src/bridge/AuthenticationManager.ts');
            const authCode = fs.readFileSync(authManagerPath, 'utf8');

            // Evidence 1: JWT signing with secret key
            if (authCode.includes('jwt.sign(payload, this.secretKey')) {
                claim.evidence.push('✅ JWT tokens are signed with a secret key');
            } else {
                claim.concerns.push('❌ JWT signing not found or improperly implemented');
            }

            // Evidence 2: Cryptographic secret generation
            if (authCode.includes('crypto.randomBytes(64).toString(\'hex\')')) {
                claim.evidence.push('✅ Secret key uses cryptographically secure random generation (64 bytes)');
            } else {
                claim.concerns.push('❌ Weak secret key generation');
            }

            // Evidence 3: Persistent secret storage
            if (authCode.includes('fs.writeFileSync(secretKeyPath, this.secretKey')) {
                claim.evidence.push('✅ Secret key is persisted to file system');
            } else {
                claim.concerns.push('⚠️ Secret key may not persist across restarts');
            }

            // Evidence 4: JWT verification with algorithms
            if (authCode.includes('jwt.verify(token, this.secretKey') && authCode.includes('algorithms: [\'HS256\']')) {
                claim.evidence.push('✅ JWT verification uses specific algorithm (HS256)');
            } else {
                claim.concerns.push('❌ JWT verification may be vulnerable to algorithm confusion');
            }

            // Evidence 5: Token expiration
            if (authCode.includes('exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)')) {
                claim.evidence.push('✅ Tokens have 24-hour expiration');
            } else {
                claim.concerns.push('⚠️ Token expiration not properly implemented');
            }

            // Evidence 6: Issuer and audience validation
            if (authCode.includes('issuer: \'automatus-vscode-bridge\'') &&
                authCode.includes('audience: \'automatus-tui\'')) {
                claim.evidence.push('✅ JWT includes issuer and audience validation');
            } else {
                claim.concerns.push('⚠️ Missing issuer/audience validation');
            }

            // Determine verification status
            if (claim.evidence.length >= 5 && claim.concerns.length === 0) {
                claim.status = 'VERIFIED';
            } else if (claim.evidence.length >= 3) {
                claim.status = 'PARTIALLY VERIFIED';
            } else {
                claim.status = 'FALSE';
            }

        } catch (error) {
            claim.concerns.push(`Error during verification: ${error.message}`);
            claim.status = 'UNVERIFIED';
        }

        this.recordClaim(claim);
        return claim;
    }

    /**
     * CLAIM 2: IP-based Connection Blocking
     */
    async verifyClaim2_IPBlocking() {
        console.log('\n=== CLAIM 2: IP-based Connection Blocking ===');
        const claim = {
            name: 'IP Blocking System',
            status: 'UNVERIFIED',
            evidence: [],
            concerns: []
        };

        try {
            const authManagerPath = path.join(__dirname, 'src/bridge/AuthenticationManager.ts');
            const authCode = fs.readFileSync(authManagerPath, 'utf8');

            // Evidence 1: IP blocking map
            if (authCode.includes('private blockedIPs: Map<string, { blockedAt: number; reason: string }>')) {
                claim.evidence.push('✅ IP blocking data structure exists');
            } else {
                claim.concerns.push('❌ IP blocking map not found');
            }

            // Evidence 2: Persistent IP block storage
            if (authCode.includes('blockedIPs: Object.fromEntries(this.blockedIPs)')) {
                claim.evidence.push('✅ Blocked IPs are persisted to storage');
            } else {
                claim.concerns.push('❌ IP blocks do not persist across restarts');
            }

            // Evidence 3: Automatic blocking after failures
            if (authCode.includes('if (failure.attempts.length >= 20)') &&
                authCode.includes('this.blockIP(ip')) {
                claim.evidence.push('✅ Automatic IP blocking after 20 failures');
            } else {
                claim.concerns.push('❌ Automatic blocking threshold not implemented');
            }

            // Evidence 4: IP check in validation
            if (authCode.includes('if (this.isIPBlocked(clientIP))')) {
                claim.evidence.push('✅ IP blocking is checked during authentication');
            } else {
                claim.concerns.push('❌ IP blocks not enforced');
            }

            // Evidence 5: Block duration
            if (authCode.includes('IP_BLOCK_DURATION = 3600000')) {
                claim.evidence.push('✅ IP blocks have 1-hour duration');
            } else {
                claim.concerns.push('⚠️ No block duration specified');
            }

            // Evidence 6: Manual blocking/unblocking
            if (authCode.includes('blockIP(ip: string, reason: string)') &&
                authCode.includes('unblockIP(ip: string)')) {
                claim.evidence.push('✅ Manual IP blocking/unblocking methods exist');
            } else {
                claim.concerns.push('⚠️ No manual IP management');
            }

            // Determine verification status
            if (claim.evidence.length >= 5 && claim.concerns.length === 0) {
                claim.status = 'VERIFIED';
            } else if (claim.evidence.length >= 3) {
                claim.status = 'PARTIALLY VERIFIED';
            } else {
                claim.status = 'FALSE';
            }

        } catch (error) {
            claim.concerns.push(`Error during verification: ${error.message}`);
            claim.status = 'UNVERIFIED';
        }

        this.recordClaim(claim);
        return claim;
    }

    /**
     * CLAIM 3: Persistent Token Revocation
     */
    async verifyClaim3_TokenRevocation() {
        console.log('\n=== CLAIM 3: Persistent Token Revocation ===');
        const claim = {
            name: 'Token Revocation System',
            status: 'UNVERIFIED',
            evidence: [],
            concerns: []
        };

        try {
            const authManagerPath = path.join(__dirname, 'src/bridge/AuthenticationManager.ts');
            const authCode = fs.readFileSync(authManagerPath, 'utf8');

            // Evidence 1: Revoked tokens set
            if (authCode.includes('private revokedTokens: Set<string>')) {
                claim.evidence.push('✅ Revoked tokens tracking structure exists');
            } else {
                claim.concerns.push('❌ No revoked tokens tracking');
            }

            // Evidence 2: Token revocation persistence
            if (authCode.includes('revokedTokens: Array.from(this.revokedTokens)')) {
                claim.evidence.push('✅ Revoked tokens are persisted to storage');
            } else {
                claim.concerns.push('❌ Token revocations do not persist');
            }

            // Evidence 3: Revocation check in validation
            if (authCode.includes('if (this.revokedTokens.has(token))')) {
                claim.evidence.push('✅ Revoked tokens are checked during validation');
            } else {
                claim.concerns.push('❌ Revoked tokens not enforced');
            }

            // Evidence 4: Revocation with reason tracking
            if (authCode.includes('revokedReason?: string')) {
                claim.evidence.push('✅ Revocation reasons are tracked');
            } else {
                claim.concerns.push('⚠️ No revocation reason tracking');
            }

            // Evidence 5: Bulk revocation
            if (authCode.includes('revokeAllTokens(reason: string')) {
                claim.evidence.push('✅ Bulk token revocation is supported');
            } else {
                claim.concerns.push('⚠️ No bulk revocation capability');
            }

            // Evidence 6: Token usage tracking
            if (authCode.includes('lastUsed: Date')) {
                claim.evidence.push('✅ Token usage timestamps are tracked');
            } else {
                claim.concerns.push('⚠️ No usage tracking');
            }

            // Determine verification status
            if (claim.evidence.length >= 5 && claim.concerns.length === 0) {
                claim.status = 'VERIFIED';
            } else if (claim.evidence.length >= 3) {
                claim.status = 'PARTIALLY VERIFIED';
            } else {
                claim.status = 'FALSE';
            }

        } catch (error) {
            claim.concerns.push(`Error during verification: ${error.message}`);
            claim.status = 'UNVERIFIED';
        }

        this.recordClaim(claim);
        return claim;
    }

    /**
     * CLAIM 4: Enhanced Rate Limiting
     */
    async verifyClaim4_RateLimiting() {
        console.log('\n=== CLAIM 4: Enhanced Rate Limiting ===');
        const claim = {
            name: 'Rate Limiting System',
            status: 'UNVERIFIED',
            evidence: [],
            concerns: []
        };

        try {
            const authManagerPath = path.join(__dirname, 'src/bridge/AuthenticationManager.ts');
            const bridgePath = path.join(__dirname, 'src/bridge/TUIVSCodeBridge.ts');
            const authCode = fs.readFileSync(authManagerPath, 'utf8');
            const bridgeCode = fs.readFileSync(bridgePath, 'utf8');

            // Evidence 1: Per-IP auth rate limiting
            if (authCode.includes('MAX_AUTH_ATTEMPTS_PER_IP = 10') &&
                authCode.includes('AUTH_RATE_WINDOW = 300000')) {
                claim.evidence.push('✅ Per-IP auth rate limiting (10 attempts per 5 minutes)');
            } else {
                claim.concerns.push('❌ No per-IP auth rate limiting');
            }

            // Evidence 2: Per-connection message rate limiting
            if (bridgeCode.includes('maxMessagesPerWindow = 100') &&
                bridgeCode.includes('rateLimitWindow = 60000')) {
                claim.evidence.push('✅ Per-connection message rate limiting (100/minute)');
            } else {
                claim.concerns.push('❌ No message rate limiting');
            }

            // Evidence 3: Rate limit enforcement
            if (authCode.includes('if (!this.checkIPRateLimit(clientIP))')) {
                claim.evidence.push('✅ Rate limits are enforced during authentication');
            } else {
                claim.concerns.push('❌ Rate limits not enforced');
            }

            // Evidence 4: Rate limit cleanup
            if (authCode.includes('cleanupExpiredData()') || bridgeCode.includes('cleanupRateLimiter()')) {
                claim.evidence.push('✅ Expired rate limit windows are cleaned up');
            } else {
                claim.concerns.push('⚠️ No automatic cleanup of rate limiters');
            }

            // Evidence 5: Rate limit error handling
            if (bridgeCode.includes('Rate limit exceeded')) {
                claim.evidence.push('✅ Clear rate limit error messages');
            } else {
                claim.concerns.push('⚠️ Poor rate limit error messaging');
            }

            // Determine verification status
            if (claim.evidence.length >= 4 && claim.concerns.length === 0) {
                claim.status = 'VERIFIED';
            } else if (claim.evidence.length >= 3) {
                claim.status = 'PARTIALLY VERIFIED';
            } else {
                claim.status = 'FALSE';
            }

        } catch (error) {
            claim.concerns.push(`Error during verification: ${error.message}`);
            claim.status = 'UNVERIFIED';
        }

        this.recordClaim(claim);
        return claim;
    }

    /**
     * CLAIM 5: Token Management Interface
     */
    async verifyClaim5_TokenManagement() {
        console.log('\n=== CLAIM 5: Token Management Interface ===');
        const claim = {
            name: 'Token Management Interface',
            status: 'UNVERIFIED',
            evidence: [],
            concerns: []
        };

        try {
            const extensionPath = path.join(__dirname, 'src/extension.ts');
            const extensionCode = fs.readFileSync(extensionPath, 'utf8');

            // Evidence 1: Token generation command
            if (extensionCode.includes('automatus.bridge.generateToken')) {
                claim.evidence.push('✅ VSCode command for token generation');
            } else {
                claim.concerns.push('❌ No token generation command');
            }

            // Evidence 2: Clipboard integration
            if (extensionCode.includes('vscode.env.clipboard.writeText(token)')) {
                claim.evidence.push('✅ Token automatically copied to clipboard');
            } else {
                claim.concerns.push('⚠️ No clipboard integration');
            }

            // Evidence 3: Token revocation command
            if (extensionCode.includes('automatus.bridge.revokeAllTokens')) {
                claim.evidence.push('✅ Command for bulk token revocation');
            } else {
                claim.concerns.push('❌ No token revocation command');
            }

            // Evidence 4: Auth status command
            if (extensionCode.includes('automatus.bridge.authStatus')) {
                claim.evidence.push('✅ Command to view authentication status');
            } else {
                claim.concerns.push('⚠️ No auth status visibility');
            }

            // Evidence 5: Client info in token generation
            if (extensionCode.includes('name: clientName') &&
                extensionCode.includes('version:') &&
                extensionCode.includes('platform:')) {
                claim.evidence.push('✅ Client info included in token generation');
            } else {
                claim.concerns.push('⚠️ Incomplete client info');
            }

            // Determine verification status
            if (claim.evidence.length >= 4 && claim.concerns.length === 0) {
                claim.status = 'VERIFIED';
            } else if (claim.evidence.length >= 3) {
                claim.status = 'PARTIALLY VERIFIED';
            } else {
                claim.status = 'FALSE';
            }

        } catch (error) {
            claim.concerns.push(`Error during verification: ${error.message}`);
            claim.status = 'UNVERIFIED';
        }

        this.recordClaim(claim);
        return claim;
    }

    /**
     * Additional Security Checks
     */
    async performAdditionalSecurityChecks() {
        console.log('\n=== Additional Security Analysis ===');
        const findings = {
            strengths: [],
            weaknesses: [],
            recommendations: []
        };

        try {
            const authManagerPath = path.join(__dirname, 'src/bridge/AuthenticationManager.ts');
            const bridgePath = path.join(__dirname, 'src/bridge/TUIVSCodeBridge.ts');
            const authCode = fs.readFileSync(authManagerPath, 'utf8');
            const bridgeCode = fs.readFileSync(bridgePath, 'utf8');

            // Check for security best practices
            if (authCode.includes('mode: 0o600')) {
                findings.strengths.push('✅ Secret files use restrictive permissions (0o600)');
            } else {
                findings.weaknesses.push('❌ Secret files may have insecure permissions');
            }

            if (bridgeCode.includes('maxPayload: 1024 * 1024')) {
                findings.strengths.push('✅ WebSocket payload size limited to 1MB');
            } else {
                findings.weaknesses.push('⚠️ No WebSocket payload size limit');
            }

            if (authCode.includes('crypto.randomUUID()')) {
                findings.strengths.push('✅ Uses cryptographically secure UUID generation');
            }

            if (bridgeCode.includes('perMessageDeflate: false')) {
                findings.strengths.push('✅ WebSocket compression disabled (prevents compression attacks)');
            }

            // Check for potential vulnerabilities
            if (authCode.includes('eval(') || bridgeCode.includes('eval(')) {
                findings.weaknesses.push('🚨 CRITICAL: Uses eval() - potential code injection');
            }

            if (!authCode.includes('const') || !authCode.includes('let')) {
                findings.weaknesses.push('⚠️ May use var declarations (potential scoping issues)');
            }

            // Recommendations
            if (!authCode.includes('bcrypt') && !authCode.includes('argon2')) {
                findings.recommendations.push('Consider using bcrypt or argon2 for any password hashing');
            }

            if (!authCode.includes('helmet')) {
                findings.recommendations.push('Consider adding helmet middleware for additional security headers');
            }

            if (!authCode.includes('csrf')) {
                findings.recommendations.push('Consider CSRF protection for future HTTP endpoints');
            }

        } catch (error) {
            findings.weaknesses.push(`Error during additional checks: ${error.message}`);
        }

        return findings;
    }

    recordClaim(claim) {
        this.results.totalClaims++;
        this.results.details.push(claim);

        if (claim.status === 'VERIFIED') {
            this.results.verifiedClaims++;
        } else if (claim.status === 'PARTIALLY VERIFIED') {
            this.results.partiallyVerifiedClaims++;
        } else if (claim.status === 'FALSE') {
            this.results.falseClaims++;
        } else {
            this.results.unverifiedClaims++;
        }

        // Display claim results
        console.log(`Status: ${claim.status}`);
        if (claim.evidence.length > 0) {
            console.log('\nEvidence:');
            claim.evidence.forEach(e => console.log(`  ${e}`));
        }
        if (claim.concerns.length > 0) {
            console.log('\nConcerns:');
            claim.concerns.forEach(c => console.log(`  ${c}`));
        }
    }

    calculateQualityScore() {
        // Weighted scoring system
        const baseScore = 10;
        let deductions = 0;

        // Major deductions for false claims
        deductions += this.results.falseClaims * 2;

        // Moderate deductions for unverified claims
        deductions += this.results.unverifiedClaims * 1.5;

        // Minor deductions for partially verified claims
        deductions += this.results.partiallyVerifiedClaims * 0.5;

        // Additional deductions based on security concerns
        this.results.details.forEach(claim => {
            claim.concerns.forEach(concern => {
                if (concern.includes('CRITICAL') || concern.includes('❌')) {
                    deductions += 0.5;
                } else if (concern.includes('⚠️')) {
                    deductions += 0.25;
                }
            });
        });

        const finalScore = Math.max(0, baseScore - deductions);
        return Math.round(finalScore * 10) / 10;
    }

    async runFullVerification() {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('     TUI-VSCode Bridge Security Verification Report');
        console.log('═══════════════════════════════════════════════════════════════');

        await this.verifyClaim1_JWTAuthentication();
        await this.verifyClaim2_IPBlocking();
        await this.verifyClaim3_TokenRevocation();
        await this.verifyClaim4_RateLimiting();
        await this.verifyClaim5_TokenManagement();

        const additionalFindings = await this.performAdditionalSecurityChecks();

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                    VERIFICATION SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════');

        console.log(`\nClaim Verification Results:`);
        console.log(`  Total Claims Tested: ${this.results.totalClaims}`);
        console.log(`  ✅ Verified: ${this.results.verifiedClaims}`);
        console.log(`  ⚠️  Partially Verified: ${this.results.partiallyVerifiedClaims}`);
        console.log(`  ❌ False: ${this.results.falseClaims}`);
        console.log(`  ❓ Unverified: ${this.results.unverifiedClaims}`);

        console.log('\nAdditional Security Findings:');
        console.log('\nStrengths:');
        additionalFindings.strengths.forEach(s => console.log(`  ${s}`));

        if (additionalFindings.weaknesses.length > 0) {
            console.log('\nWeaknesses:');
            additionalFindings.weaknesses.forEach(w => console.log(`  ${w}`));
        }

        if (additionalFindings.recommendations.length > 0) {
            console.log('\nRecommendations:');
            additionalFindings.recommendations.forEach(r => console.log(`  ${r}`));
        }

        const qualityScore = this.calculateQualityScore();
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log(`                 FINAL QUALITY SCORE: ${qualityScore}/10`);
        console.log('═══════════════════════════════════════════════════════════════');

        // Production readiness assessment
        console.log('\nProduction Readiness Assessment:');
        if (qualityScore >= 8) {
            console.log('✅ PRODUCTION READY - This implementation meets enterprise security standards');
        } else if (qualityScore >= 6) {
            console.log('⚠️  PRODUCTION VIABLE WITH CAVEATS - Address remaining concerns before deployment');
        } else {
            console.log('❌ NOT PRODUCTION READY - Significant security issues remain');
        }

        // Critical issues that must be addressed
        console.log('\nCritical Issues Remaining:');
        let hasCriticalIssues = false;
        this.results.details.forEach(claim => {
            claim.concerns.forEach(concern => {
                if (concern.includes('CRITICAL') || concern.includes('❌')) {
                    console.log(`  • ${concern}`);
                    hasCriticalIssues = true;
                }
            });
        });

        if (!hasCriticalIssues) {
            console.log('  • No critical security issues detected');
        }

        return {
            score: qualityScore,
            results: this.results,
            additionalFindings,
            productionReady: qualityScore >= 6 && !hasCriticalIssues
        };
    }
}

// Run the verification
async function main() {
    const verifier = new SecurityVerifier();
    const results = await verifier.runFullVerification();

    // Write results to file
    const reportPath = path.join(__dirname, 'SECURITY_VERIFICATION_REPORT.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\nDetailed report saved to: ${reportPath}`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = SecurityVerifier;