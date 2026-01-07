#!/usr/bin/env node

/**
 * Comprehensive verification test for Automatus VSCode extension claims
 */

const fs = require('fs');
const path = require('path');

console.log('=== AUTOMATUS VSCODE EXTENSION VERIFICATION ===\n');

let verificationResults = {
  rootCauseAnalysis: { passed: false, issues: [] },
  extensionLifecycle: { passed: false, issues: [] },
  completeMigration: { passed: false, issues: [] },
  productionReadiness: { passed: false, issues: [] },
  disposalPatterns: { passed: false, issues: [] }
};

// Test 1: Verify ExtensionLifecycle.ts addresses root causes
console.log('1. VERIFYING ROOT CAUSE ANALYSIS...');
const lifecyclePath = path.join(__dirname, 'src/utils/ExtensionLifecycle.ts');
if (fs.existsSync(lifecyclePath)) {
  const lifecycleContent = fs.readFileSync(lifecyclePath, 'utf8');

  // Check for race condition handling
  if (lifecycleContent.includes('handleDisposalRaceCondition')) {
    console.log('  ✓ Race condition handler found');

    // Check if it actually handles the race condition vs just catching errors
    if (lifecycleContent.includes('// This is the actual root cause: VSCode is already disposing')) {
      console.log('  ✓ Root cause documented');
    } else {
      verificationResults.rootCauseAnalysis.issues.push('Root cause not clearly documented');
    }

    // Check for emergency shutdown
    if (lifecycleContent.includes('emergencyShutdown')) {
      console.log('  ✓ Emergency shutdown mechanism present');
    } else {
      verificationResults.rootCauseAnalysis.issues.push('No emergency shutdown mechanism');
    }

    // Check for component dependency tracking
    if (lifecycleContent.includes('calculateInitializationOrder')) {
      console.log('  ✓ Component dependency ordering implemented');
      verificationResults.rootCauseAnalysis.passed = true;
    } else {
      verificationResults.rootCauseAnalysis.issues.push('No component dependency ordering');
    }
  } else {
    verificationResults.rootCauseAnalysis.issues.push('No race condition handler found');
  }
} else {
  verificationResults.rootCauseAnalysis.issues.push('ExtensionLifecycle.ts not found');
}

// Test 2: Check if ExtensionLifecycle is actually an improvement
console.log('\n2. VERIFYING EXTENSIONLIFECYCLE ARCHITECTURE...');
if (fs.existsSync(lifecyclePath)) {
  const lifecycleContent = fs.readFileSync(lifecyclePath, 'utf8');

  // Check for singleton pattern
  if (lifecycleContent.includes('private static instance:')) {
    console.log('  ✓ Singleton pattern implemented');
  } else {
    verificationResults.extensionLifecycle.issues.push('Not using singleton pattern');
  }

  // Check for proper lifecycle state management
  if (lifecycleContent.includes('isActive:') && lifecycleContent.includes('isDeactivating:')) {
    console.log('  ✓ Lifecycle state tracking');
  } else {
    verificationResults.extensionLifecycle.issues.push('Missing lifecycle state tracking');
  }

  // Check if it's just wrapping subscriptions.push or actually solving issues
  const pushCount = (lifecycleContent.match(/subscriptions\.push/g) || []).length;
  const tryCount = (lifecycleContent.match(/try\s*{[^}]*subscriptions\.push/g) || []).length;

  if (pushCount === tryCount && pushCount > 0) {
    console.log('  ✓ Protected subscription registration');
    verificationResults.extensionLifecycle.passed = true;
  } else {
    verificationResults.extensionLifecycle.issues.push('Unprotected subscription registrations');
  }
}

// Test 3: Verify complete migration
console.log('\n3. VERIFYING COMPLETE MIGRATION...');
const srcDir = path.join(__dirname, 'src');
let migrationIssues = [];

// Find all TypeScript files
function findTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory() && !file.includes('test')) {
      results = results.concat(findTsFiles(file));
    } else if (file.endsWith('.ts') && !file.includes('test')) {
      results.push(file);
    }
  });
  return results;
}

const tsFiles = findTsFiles(srcDir);
tsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const fileName = path.relative(__dirname, file);

  // Skip ExtensionLifecycle.ts itself
  if (fileName.includes('ExtensionLifecycle.ts')) return;

  // Check for direct context.subscriptions.push usage
  if (content.includes('context.subscriptions.push')) {
    migrationIssues.push(`${fileName}: Still using context.subscriptions.push`);
  }

  // Check if files registering commands use safeRegisterDisposable
  if (content.includes('vscode.commands.registerCommand')) {
    if (!content.includes('safeRegisterDisposable')) {
      migrationIssues.push(`${fileName}: Registers commands but doesn't use safeRegisterDisposable`);
    }
  }

  // Check for workspace listeners without proper disposal
  if (content.includes('vscode.workspace.onDid')) {
    if (!content.includes('safeRegisterDisposable') && !content.includes('registerDisposable')) {
      migrationIssues.push(`${fileName}: Has workspace listeners without safe disposal`);
    }
  }
});

if (migrationIssues.length === 0) {
  console.log('  ✓ All files migrated to new pattern');
  verificationResults.completeMigration.passed = true;
} else {
  console.log('  ✗ Migration issues found:');
  migrationIssues.forEach(issue => {
    console.log(`    - ${issue}`);
    verificationResults.completeMigration.issues.push(issue);
  });
}

// Test 4: Production readiness
console.log('\n4. VERIFYING PRODUCTION READINESS...');
const packageJsonPath = path.join(__dirname, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  let productionReady = true;

  // Check required fields
  const requiredFields = ['name', 'displayName', 'description', 'version', 'publisher', 'engines', 'main'];
  requiredFields.forEach(field => {
    if (!packageJson[field]) {
      verificationResults.productionReadiness.issues.push(`Missing required field: ${field}`);
      productionReady = false;
    } else {
      console.log(`  ✓ ${field}: ${JSON.stringify(packageJson[field]).substring(0, 50)}`);
    }
  });

  // Check if it can be packaged
  const { execSync } = require('child_process');
  try {
    console.log('  Testing packaging...');
    execSync('npx vsce ls', { stdio: 'pipe' });
    console.log('  ✓ Can be packaged with vsce');
  } catch (error) {
    verificationResults.productionReadiness.issues.push('Cannot be packaged with vsce');
    productionReady = false;
  }

  verificationResults.productionReadiness.passed = productionReady;
}

// Test 5: Disposal pattern consistency
console.log('\n5. VERIFYING DISPOSAL PATTERN CONSISTENCY...');
let disposalIssues = [];
tsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const fileName = path.relative(__dirname, file);

  // Check for mixed disposal approaches
  if (content.includes('subscriptions.push') && content.includes('safeRegisterDisposable')) {
    if (!fileName.includes('ExtensionLifecycle')) {
      disposalIssues.push(`${fileName}: Mixed disposal patterns`);
    }
  }

  // Check for dispose methods that don't handle errors
  const disposeMatches = content.match(/dispose\(\)[^{]*{[^}]*}/g) || [];
  disposeMatches.forEach(match => {
    if (!match.includes('try') && !match.includes('catch')) {
      // Check if it's just calling other dispose methods
      if (!match.match(/\w+\.dispose\(\)/)) {
        disposalIssues.push(`${fileName}: Dispose method without error handling`);
      }
    }
  });
});

if (disposalIssues.length === 0) {
  console.log('  ✓ Consistent disposal patterns');
  verificationResults.disposalPatterns.passed = true;
} else {
  console.log('  ✗ Disposal pattern issues:');
  disposalIssues.forEach(issue => {
    console.log(`    - ${issue}`);
    verificationResults.disposalPatterns.issues.push(issue);
  });
}

// FINAL VERDICT
console.log('\n=== VERIFICATION SUMMARY ===\n');
let totalPassed = 0;
let criticalIssues = [];

Object.entries(verificationResults).forEach(([test, result]) => {
  const status = result.passed ? '✓ PASSED' : '✗ FAILED';
  console.log(`${test}: ${status}`);
  if (result.passed) totalPassed++;
  if (!result.passed && result.issues.length > 0) {
    criticalIssues = criticalIssues.concat(result.issues);
  }
});

console.log(`\nOverall: ${totalPassed}/5 tests passed`);

if (criticalIssues.length > 0) {
  console.log('\nCRITICAL ISSUES FOUND:');
  criticalIssues.forEach((issue, i) => {
    console.log(`  ${i + 1}. ${issue}`);
  });
}

// PRODUCTION READINESS SCORE
const readinessScore = (totalPassed / 5) * 100;
console.log(`\n=== PRODUCTION READINESS: ${readinessScore}% ===`);

if (readinessScore === 100) {
  console.log('✅ READY FOR PRODUCTION');
} else if (readinessScore >= 80) {
  console.log('⚠️  ALMOST READY - Minor issues to address');
} else if (readinessScore >= 60) {
  console.log('⚠️  NOT READY - Significant issues remain');
} else {
  console.log('❌ NOT READY FOR PRODUCTION - Major issues found');
}

process.exit(readinessScore === 100 ? 0 : 1);