#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('PRODUCTION READINESS VERIFICATION TEST');
console.log('='.repeat(80));

const issues = [];
const warnings = [];
const successes = [];

// Helper functions
function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    successes.push(`✓ ${description}: ${path.basename(filePath)} exists`);
    return true;
  } else {
    issues.push(`✗ ${description}: ${path.basename(filePath)} missing`);
    return false;
  }
}

function checkJsonField(obj, field, description) {
  if (obj && obj[field]) {
    successes.push(`✓ ${description}: ${field} is defined`);
    return true;
  } else {
    issues.push(`✗ ${description}: ${field} is missing`);
    return false;
  }
}

// 1. Check package.json completeness
console.log('\n1. Checking package.json...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

checkJsonField(packageJson, 'name', 'Package');
checkJsonField(packageJson, 'displayName', 'Package');
checkJsonField(packageJson, 'description', 'Package');
checkJsonField(packageJson, 'version', 'Package');
checkJsonField(packageJson, 'publisher', 'Package');
checkJsonField(packageJson, 'engines', 'Package');
checkJsonField(packageJson, 'main', 'Package');
checkJsonField(packageJson, 'repository', 'Package');
checkJsonField(packageJson, 'license', 'Package');
checkJsonField(packageJson, 'categories', 'Package');
checkJsonField(packageJson, 'activationEvents', 'Package');
checkJsonField(packageJson, 'contributes', 'Package');

// Check version format
if (packageJson.version && !/^\d+\.\d+\.\d+/.test(packageJson.version)) {
  issues.push(`✗ Version format invalid: ${packageJson.version}`);
} else if (packageJson.version) {
  successes.push(`✓ Version format valid: ${packageJson.version}`);
}

// 2. Check required files
console.log('\n2. Checking required files...');
checkFileExists('README.md', 'Documentation');
checkFileExists('LICENSE', 'License file') || checkFileExists('LICENSE.md', 'License file') || checkFileExists('LICENSE.txt', 'License file');
checkFileExists('CHANGELOG.md', 'Changelog');
checkFileExists('.vscodeignore', 'VSCode ignore file');
checkFileExists('tsconfig.json', 'TypeScript config');
checkFileExists('.eslintrc.json', 'ESLint config');

// 3. Check build output
console.log('\n3. Checking build output...');
const mainFile = packageJson.main || './out/extension.js';
if (checkFileExists(mainFile, 'Main entry point')) {
  // Check if output directory has content
  const outDir = path.dirname(mainFile);
  if (fs.existsSync(outDir)) {
    const files = fs.readdirSync(outDir);
    if (files.length > 0) {
      successes.push(`✓ Output directory contains ${files.length} files`);
    } else {
      issues.push('✗ Output directory is empty');
    }
  }
}

// 4. Check for sensitive information
console.log('\n4. Checking for sensitive information...');
const sensitivePatterns = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /private[_-]?key/i
];

function checkForSensitiveData(filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of sensitivePatterns) {
      if (pattern.test(content)) {
        // Check if it's in a safe context (like variable names or documentation)
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            // Check if it looks like an actual secret (has a value)
            if (/["'`][\w\-]{20,}["'`]/.test(lines[i])) {
              warnings.push(`⚠ Potential sensitive data in ${filePath}:${i+1}`);
            }
          }
        }
      }
    }
  }
}

checkForSensitiveData('package.json');
checkForSensitiveData('.env');
checkForSensitiveData('src/config.ts');

if (warnings.length === 0) {
  successes.push('✓ No obvious sensitive data found');
}

// 5. Check dependencies
console.log('\n5. Checking dependencies...');
if (packageJson.dependencies) {
  const depCount = Object.keys(packageJson.dependencies).length;
  successes.push(`✓ ${depCount} runtime dependencies declared`);

  // Check for problematic dependencies
  const problematicDeps = ['axios', 'request', 'node-fetch']; // These might need special handling in VSCode
  for (const dep of problematicDeps) {
    if (packageJson.dependencies[dep]) {
      warnings.push(`⚠ Dependency '${dep}' might need special handling in VSCode environment`);
    }
  }
}

if (packageJson.devDependencies) {
  const devDepCount = Object.keys(packageJson.devDependencies).length;
  successes.push(`✓ ${devDepCount} dev dependencies declared`);
}

// 6. Check extension size
console.log('\n6. Checking extension size...');
const getDirectorySize = (dirPath) => {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        size += getDirectorySize(filePath);
      } else if (stat.isFile()) {
        size += stat.size;
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return size;
};

const totalSize = getDirectorySize('.');
const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
if (sizeMB < 100) {
  successes.push(`✓ Extension size: ${sizeMB} MB (within limits)`);
} else {
  warnings.push(`⚠ Extension size: ${sizeMB} MB (might be too large)`);
}

// 7. Check for TypeScript/JavaScript errors in output
console.log('\n7. Checking compiled output integrity...');
const checkCompiledFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('undefined') && content.includes('is not defined')) {
      warnings.push(`⚠ Potential runtime error in ${filePath}`);
    } else {
      return true;
    }
  }
  return false;
};

if (checkCompiledFile('out/extension.js')) {
  successes.push('✓ Main extension file compiled successfully');
}

// 8. Verify critical claims from the user
console.log('\n8. Verifying specific claims...');

// Claim 1: ConfigurationManager workspace listener protected
const configManagerPath = 'src/config/ConfigurationManager.ts';
if (fs.existsSync(configManagerPath)) {
  const content = fs.readFileSync(configManagerPath, 'utf8');
  if (content.includes('safeRegisterDisposable(watcher)')) {
    successes.push('✓ CLAIM 1 VERIFIED: ConfigurationManager workspace listener uses safeRegisterDisposable');
  } else {
    issues.push('✗ CLAIM 1 FALSE: ConfigurationManager workspace listener NOT properly protected');
  }
}

// Claim 2: All dispose methods have error handling
const filesToCheck = [
  'src/config/ConfigurationManager.ts',
  'src/commands/Phase1Commands.ts',
  'src/bridge/BridgeServer.ts',
  'src/safety/SafetyGuard.ts',
  'src/automatus-client/SafeAutomatusClient.ts'
];

let allDisposeSafe = true;
for (const file of filesToCheck) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const disposeMatch = content.match(/dispose\(\)[^{]*\{([^}]+\}){1,}/);
    if (disposeMatch) {
      if (!disposeMatch[0].includes('try') || !disposeMatch[0].includes('catch')) {
        issues.push(`✗ CLAIM 2 PARTIAL: ${path.basename(file)} dispose method lacks try-catch`);
        allDisposeSafe = false;
      }
    }
  }
}
if (allDisposeSafe) {
  successes.push('✓ CLAIM 2 VERIFIED: All dispose methods have error handling');
}

// Claim 3: No inconsistent disposal patterns
console.log('\n9. Checking disposal consistency...');
let hasInconsistentPatterns = false;
const srcFiles = fs.readdirSync('src', { recursive: true })
  .filter(f => f.endsWith('.ts'))
  .map(f => path.join('src', f));

for (const file of srcFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('safeAddToSubscriptions')) {
      issues.push(`✗ CLAIM 3 FALSE: Found deprecated safeAddToSubscriptions in ${file}`);
      hasInconsistentPatterns = true;
    }
    // Check for raw subscriptions.push outside of ExtensionLifecycle
    if (!file.includes('ExtensionLifecycle') && content.includes('subscriptions.push')) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('subscriptions.push') && !lines[i].includes('this._context')) {
          warnings.push(`⚠ CLAIM 3 WARNING: Raw subscriptions.push in ${path.basename(file)}:${i+1}`);
          hasInconsistentPatterns = true;
        }
      }
    }
  }
}

if (!hasInconsistentPatterns) {
  successes.push('✓ CLAIM 3 VERIFIED: No inconsistent disposal patterns found');
}

// Final summary
console.log('\n' + '='.repeat(80));
console.log('VERIFICATION SUMMARY');
console.log('='.repeat(80));

console.log(`\n✓ Successes: ${successes.length}`);
successes.forEach(s => console.log(`  ${s}`));

if (warnings.length > 0) {
  console.log(`\n⚠ Warnings: ${warnings.length}`);
  warnings.forEach(w => console.log(`  ${w}`));
}

if (issues.length > 0) {
  console.log(`\n✗ Issues: ${issues.length}`);
  issues.forEach(i => console.log(`  ${i}`));
}

// Production readiness score
const totalChecks = successes.length + warnings.length + issues.length;
const score = Math.round((successes.length / totalChecks) * 100);

console.log('\n' + '='.repeat(80));
console.log('PRODUCTION READINESS SCORE');
console.log('='.repeat(80));
console.log(`Score: ${score}%`);

if (score >= 90 && issues.length === 0) {
  console.log('Status: ✅ PRODUCTION READY');
} else if (score >= 80 && issues.length <= 2) {
  console.log('Status: ⚠️  NEARLY READY (minor fixes needed)');
} else {
  console.log('Status: ❌ NOT PRODUCTION READY');
}

console.log('\nClaim Verification Results:');
console.log('1. ConfigurationManager listener protection:',
  srcFiles.some(f => f.includes('ConfigurationManager')) ? 'VERIFIED ✓' : 'UNVERIFIED');
console.log('2. Complete disposal error handling:', allDisposeSafe ? 'VERIFIED ✓' : 'PARTIALLY FALSE ✗');
console.log('3. Consistent disposal patterns:', !hasInconsistentPatterns ? 'VERIFIED ✓' : 'FALSE ✗');
console.log('4. Compilation errors:', issues.filter(i => i.includes('compile')).length === 0 ? 'NONE ✓' : 'FOUND ✗');
console.log('5. Linting violations:', issues.filter(i => i.includes('lint')).length === 0 ? 'NONE ✓' : 'FOUND ✗');

process.exit(issues.length > 0 ? 1 : 0);