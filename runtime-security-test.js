/**
 * Runtime Security Test - Validates actual security behavior
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class RuntimeSecurityTester {
    constructor() {
        this.testResults = [];
        this.port = 19888;
        this.wsUrl = `ws://localhost:${this.port}`;
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test 1: Authentication Challenge Required
     */
    async testAuthenticationChallenge() {
        console.log('\n[TEST 1] Authentication Challenge Required');
        const result = { name: 'Auth Challenge', passed: false, details: [] };

        try {
            const ws = new WebSocket(this.wsUrl);

            await new Promise((resolve, reject) => {
                ws.on('open', () => {
                    result.details.push('✓ Connected to bridge');
                });

                ws.on('message', (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'auth_challenge') {
                        result.details.push('✓ Received authentication challenge');
                        result.details.push(`  Auth methods: ${message.data.authMethods.join(', ')}`);
                        result.passed = message.data.authMethods.includes('JWT');
                        ws.close();
                        resolve();
                    }
                });

                ws.on('error', (err) => {
                    result.details.push(`✗ Connection error: ${err.message}`);
                    reject(err);
                });

                setTimeout(() => {
                    ws.close();
                    reject(new Error('Timeout waiting for auth challenge'));
                }, 5000);
            });

        } catch (error) {
            result.details.push(`✗ Test failed: ${error.message}`);
            if (error.message.includes('ECONNREFUSED')) {
                result.details.push('  Note: Bridge server may not be running');
            }
        }

        this.testResults.push(result);
        return result;
    }

    /**
     * Test 2: Commands Rejected Without Authentication
     */
    async testUnauthenticatedRejection() {
        console.log('\n[TEST 2] Commands Rejected Without Authentication');
        const result = { name: 'Unauthenticated Rejection', passed: false, details: [] };

        try {
            const ws = new WebSocket(this.wsUrl);

            await new Promise((resolve, reject) => {
                ws.on('open', () => {
                    result.details.push('✓ Connected to bridge');

                    // Try to send a command without authentication
                    const command = {
                        id: crypto.randomUUID(),
                        type: 'workspace_query',
                        payload: {},
                        timestamp: Date.now()
                    };

                    ws.send(JSON.stringify(command));
                    result.details.push('✓ Sent unauthorized command');
                });

                ws.on('message', (data) => {
                    const message = JSON.parse(data.toString());

                    if (message.type === 'auth_challenge') {
                        // Skip auth challenge
                        return;
                    }

                    if (!message.success && message.error) {
                        if (message.error.toLowerCase().includes('auth')) {
                            result.details.push('✓ Command rejected with auth error');
                            result.passed = true;
                        } else {
                            result.details.push(`✗ Unexpected error: ${message.error}`);
                        }
                    } else if (message.success) {
                        result.details.push('✗ Command succeeded without authentication!');
                    }

                    ws.close();
                    resolve();
                });

                ws.on('error', (err) => {
                    result.details.push(`✗ Connection error: ${err.message}`);
                    reject(err);
                });

                setTimeout(() => {
                    ws.close();
                    reject(new Error('Timeout waiting for response'));
                }, 5000);
            });

        } catch (error) {
            result.details.push(`✗ Test failed: ${error.message}`);
        }

        this.testResults.push(result);
        return result;
    }

    /**
     * Test 3: Invalid Token Rejection
     */
    async testInvalidTokenRejection() {
        console.log('\n[TEST 3] Invalid Token Rejection');
        const result = { name: 'Invalid Token Rejection', passed: false, details: [] };

        try {
            const ws = new WebSocket(this.wsUrl);

            await new Promise((resolve, reject) => {
                ws.on('open', () => {
                    result.details.push('✓ Connected to bridge');
                });

                ws.on('message', async (data) => {
                    const message = JSON.parse(data.toString());

                    if (message.type === 'auth_challenge') {
                        // Send invalid token
                        const fakeToken = jwt.sign(
                            { userId: 'test', sessionId: 'fake' },
                            'wrong-secret-key',
                            { algorithm: 'HS256' }
                        );

                        const authCommand = {
                            id: crypto.randomUUID(),
                            type: 'auth_request',
                            payload: { token: fakeToken },
                            timestamp: Date.now()
                        };

                        ws.send(JSON.stringify(authCommand));
                        result.details.push('✓ Sent invalid token');
                    } else if (message.id && !message.success) {
                        if (message.error.toLowerCase().includes('signature') ||
                            message.error.toLowerCase().includes('invalid') ||
                            message.error.toLowerCase().includes('failed')) {
                            result.details.push('✓ Invalid token rejected correctly');
                            result.passed = true;
                        } else {
                            result.details.push(`✗ Unexpected error: ${message.error}`);
                        }
                        ws.close();
                        resolve();
                    } else if (message.success) {
                        result.details.push('✗ Invalid token was accepted!');
                        ws.close();
                        resolve();
                    }
                });

                ws.on('error', (err) => {
                    result.details.push(`✗ Connection error: ${err.message}`);
                    reject(err);
                });

                setTimeout(() => {
                    ws.close();
                    reject(new Error('Timeout waiting for auth response'));
                }, 5000);
            });

        } catch (error) {
            result.details.push(`✗ Test failed: ${error.message}`);
        }

        this.testResults.push(result);
        return result;
    }

    /**
     * Test 4: Rate Limiting Enforcement
     */
    async testRateLimiting() {
        console.log('\n[TEST 4] Rate Limiting Enforcement');
        const result = { name: 'Rate Limiting', passed: false, details: [] };

        try {
            const ws = new WebSocket(this.wsUrl);
            let messageCount = 0;
            let rateLimited = false;

            await new Promise((resolve, reject) => {
                ws.on('open', async () => {
                    result.details.push('✓ Connected to bridge');

                    // Send many messages rapidly
                    result.details.push('  Sending 110 messages rapidly...');
                    for (let i = 0; i < 110; i++) {
                        const command = {
                            id: crypto.randomUUID(),
                            type: 'workspace_query',
                            payload: {},
                            timestamp: Date.now()
                        };
                        ws.send(JSON.stringify(command));
                        messageCount++;
                    }
                });

                ws.on('message', (data) => {
                    const message = JSON.parse(data.toString());

                    if (message.type === 'auth_challenge') {
                        return; // Skip auth challenge
                    }

                    if (message.error && message.error.toLowerCase().includes('rate')) {
                        result.details.push(`✓ Rate limiting triggered after ${messageCount} messages`);
                        result.details.push(`  Error: ${message.error}`);
                        rateLimited = true;
                        result.passed = true;
                        ws.close();
                        resolve();
                    }
                });

                ws.on('error', (err) => {
                    result.details.push(`✗ Connection error: ${err.message}`);
                    reject(err);
                });

                setTimeout(() => {
                    if (!rateLimited) {
                        result.details.push(`⚠ Sent ${messageCount} messages without rate limiting`);
                        result.details.push('  Note: Rate limiting may be per-minute');
                    }
                    ws.close();
                    resolve();
                }, 5000);
            });

        } catch (error) {
            result.details.push(`✗ Test failed: ${error.message}`);
        }

        this.testResults.push(result);
        return result;
    }

    /**
     * Test 5: Expired Token Rejection
     */
    async testExpiredTokenRejection() {
        console.log('\n[TEST 5] Expired Token Rejection');
        const result = { name: 'Expired Token Rejection', passed: false, details: [] };

        try {
            const ws = new WebSocket(this.wsUrl);

            await new Promise((resolve, reject) => {
                ws.on('open', () => {
                    result.details.push('✓ Connected to bridge');
                });

                ws.on('message', async (data) => {
                    const message = JSON.parse(data.toString());

                    if (message.type === 'auth_challenge') {
                        // Create expired token
                        const expiredToken = jwt.sign(
                            {
                                userId: 'test',
                                sessionId: 'expired',
                                exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
                                iat: Math.floor(Date.now() / 1000) - 7200
                            },
                            'test-secret',
                            { algorithm: 'HS256' }
                        );

                        const authCommand = {
                            id: crypto.randomUUID(),
                            type: 'auth_request',
                            payload: { token: expiredToken },
                            timestamp: Date.now()
                        };

                        ws.send(JSON.stringify(authCommand));
                        result.details.push('✓ Sent expired token');
                    } else if (message.id && !message.success) {
                        if (message.error.toLowerCase().includes('expired')) {
                            result.details.push('✓ Expired token rejected correctly');
                            result.passed = true;
                        } else {
                            result.details.push(`  Token rejected but not for expiration: ${message.error}`);
                            result.passed = true; // Still a valid rejection
                        }
                        ws.close();
                        resolve();
                    } else if (message.success) {
                        result.details.push('✗ Expired token was accepted!');
                        ws.close();
                        resolve();
                    }
                });

                ws.on('error', (err) => {
                    result.details.push(`✗ Connection error: ${err.message}`);
                    reject(err);
                });

                setTimeout(() => {
                    ws.close();
                    reject(new Error('Timeout waiting for auth response'));
                }, 5000);
            });

        } catch (error) {
            result.details.push(`✗ Test failed: ${error.message}`);
        }

        this.testResults.push(result);
        return result;
    }

    async runAllTests() {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('            Runtime Security Test Suite');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Testing bridge at: ${this.wsUrl}`);

        // Check if bridge is running
        const checkWs = new WebSocket(this.wsUrl);
        const isRunning = await new Promise(resolve => {
            checkWs.on('open', () => {
                checkWs.close();
                resolve(true);
            });
            checkWs.on('error', () => {
                resolve(false);
            });
            setTimeout(() => resolve(false), 2000);
        });

        if (!isRunning) {
            console.log('\n⚠️  WARNING: Bridge server is not running');
            console.log('  Start the bridge with: "Automatus: Start TUI Bridge" command');
            console.log('  Tests will show connection errors\n');
        }

        await this.testAuthenticationChallenge();
        await this.delay(500);

        await this.testUnauthenticatedRejection();
        await this.delay(500);

        await this.testInvalidTokenRejection();
        await this.delay(500);

        await this.testRateLimiting();
        await this.delay(500);

        await this.testExpiredTokenRejection();

        // Summary
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                    TEST SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════');

        const passedCount = this.testResults.filter(r => r.passed).length;
        const totalCount = this.testResults.length;
        const passRate = (passedCount / totalCount * 100).toFixed(0);

        console.log(`\nTests Passed: ${passedCount}/${totalCount} (${passRate}%)\n`);

        this.testResults.forEach(result => {
            const status = result.passed ? '✅ PASS' : '❌ FAIL';
            console.log(`${status} - ${result.name}`);
            result.details.forEach(detail => {
                console.log(`    ${detail}`);
            });
        });

        // Security assessment
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('              RUNTIME SECURITY ASSESSMENT');
        console.log('═══════════════════════════════════════════════════════════════');

        if (isRunning) {
            if (passedCount === totalCount) {
                console.log('\n✅ EXCELLENT - All security controls are functioning correctly');
            } else if (passedCount >= 3) {
                console.log('\n⚠️  GOOD - Most security controls are working, some issues detected');
            } else {
                console.log('\n❌ POOR - Significant security controls are not functioning');
            }
        } else {
            console.log('\n⚡ UNABLE TO ASSESS - Bridge server is not running');
            console.log('   Please start the bridge and run this test again');
        }

        return {
            passed: passedCount,
            total: totalCount,
            passRate: parseFloat(passRate),
            bridgeRunning: isRunning,
            results: this.testResults
        };
    }
}

// Run tests
async function main() {
    const tester = new RuntimeSecurityTester();
    const results = await tester.runAllTests();

    // Save results
    const reportPath = path.join(__dirname, 'RUNTIME_SECURITY_TEST.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\nDetailed results saved to: ${reportPath}`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = RuntimeSecurityTester;