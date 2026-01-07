#!/usr/bin/env node

/**
 * Final Production Readiness Verification Script
 * Performs comprehensive checks on the Automatus VSCode Extension
 */

const fs = require('fs');
const path = require('path');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

// Track overall verification status
let hasErrors = false;
let hasWarnings = false;

function log(message, type = 'info') {
  const prefix = {
    success: `${colors.green}✓${colors.reset}`,
    error: `${colors.red}✗${colors.reset}`,
    warning: `${colors.yellow}⚠${colors.reset}`,
    info: `${colors.blue}ℹ${colors.reset}`,
    header: `${colors.bold}═${colors.reset}`
  }[type] || '';

  console.log(`${prefix} ${message}`);

  if (type === 'error') hasErrors = true;
  if (type === 'warning') hasWarnings = true;
}

function header(title) {
  console.log('\n' + colors.bold + '═'.repeat(60) + colors.reset);
  console.log(colors.bold + title + colors.reset);
  console.log(colors.bold + '═'.repeat(60) + colors.reset);
}

// 1. Check for required files
function checkRequiredFiles() {
  header('1. REQUIRED FILES CHECK');

  const requiredFiles = [
    'package.json',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    '.vscodeignore',
    'out/extension.js'
  ];

  requiredFiles.forEach(file => {
    const exists = fs.existsSync(file);
    if (exists) {
      log(`Found: ${file}`, 'success');
    } else {
      log(`Missing: ${file}`, 'error');
    }
  });
}

// 2. Verify package.json
function verifyPackageJson() {
  header('2. PACKAGE.JSON VERIFICATION');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  // Required fields
  const requiredFields = [
    'name', 'displayName', 'description', 'version',
    'publisher', 'engines', 'main', 'categories', 'activationEvents'
  ];

  requiredFields.forEach(field => {
    if (pkg[field]) {
      log(`${field}: ${JSON.stringify(pkg[field]).substring(0, 50)}...`, 'success');
    } else {
      log(`Missing required field: ${field}`, 'error');
    }
  });

  // Check for icon (warning if missing, not error)
  if (!pkg.icon) {
    log('No extension icon specified (marketplace will use default)', 'warning');
  }

  // Check version
  if (pkg.version === '0.0.0' || pkg.version === '0.0.1') {
    log(`Version is still ${pkg.version} - consider updating for release`, 'warning');
  }
}

// 3. Check TypeScript compilation
function checkTypeScriptCompilation() {
  header('3. TYPESCRIPT COMPILATION CHECK');

  // Check for .js files in out directory
  const outDir = 'out';
  if (fs.existsSync(outDir)) {
    const jsFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.js'));
    if (jsFiles.length > 0) {
      log(`Found ${jsFiles.length} compiled JavaScript files`, 'success');
    } else {
      log('No compiled JavaScript files found in out/', 'error');
    }
  } else {
    log('Output directory not found', 'error');
  }

  // Check for TypeScript errors (look for .d.ts files as indicator of successful compilation)
  const hasDtsFiles = fs.existsSync('out/extension.d.ts');
  if (!hasDtsFiles) {
    log('TypeScript declaration files not found (compilation may have warnings)', 'warning');
  } else {
    log('TypeScript declaration files found', 'success');
  }
}

// 4. Check for DisposableStore usage (should be eliminated)
function checkDisposableStore() {
  header('4. DISPOSABLESTORE ELIMINATION CHECK');

  const srcFiles = getAllFiles('src', '.ts');
  let foundDisposableStore = false;

  srcFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('DisposableStore')) {
      log(`Found DisposableStore in: ${file}`, 'error');
      foundDisposableStore = true;
    }
  });

  if (!foundDisposableStore) {
    log('No DisposableStore usage found - properly eliminated', 'success');
  }
}

// 5. Verify disposal patterns
function verifyDisposalPatterns() {
  header('5. DISPOSAL PATTERN VERIFICATION');

  const disposalFiles = [
    'src/commands/Phase1Commands.ts',
    'src/bridge/BridgeServer.ts',
    'src/config/ConfigurationManager.ts',
    'src/safety/SafetyGuard.ts',
    'src/automatus-client/SafeAutomatusClient.ts'
  ];

  disposalFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');

      // Check for dispose method with error handling
      if (content.includes('dispose():') || content.includes('dispose()')) {
        if (content.includes('try') && content.includes('catch')) {
          log(`${path.basename(file)}: Has dispose() with error handling`, 'success');
        } else {
          log(`${path.basename(file)}: Has dispose() but missing error handling`, 'warning');
        }
      } else {
        log(`${path.basename(file)}: Missing dispose() method`, 'error');
      }
    }
  });
}

// 6. Check for test coverage
function checkTestCoverage() {
  header('6. TEST COVERAGE CHECK');

  const testFiles = getAllFiles('src/test', '.ts');
  log(`Found ${testFiles.length} test files`, testFiles.length > 0 ? 'success' : 'warning');

  // Check for specific test categories
  const hasExtensionTests = testFiles.some(f => f.includes('extension.test'));
  const hasDisposalTests = testFiles.some(f => f.includes('disposal'));
  const hasCircuitBreakerTests = testFiles.some(f => f.includes('circuit') || f.includes('breaker'));

  log(`Extension tests: ${hasExtensionTests ? 'Present' : 'Missing'}`,
      hasExtensionTests ? 'success' : 'warning');
  log(`Disposal tests: ${hasDisposalTests ? 'Present' : 'Missing'}`,
      hasDisposalTests ? 'success' : 'warning');
  log(`Circuit breaker tests: ${hasCircuitBreakerTests ? 'Present' : 'Missing'}`,
      hasCircuitBreakerTests ? 'success' : 'warning');
}

// 7. Production packaging check
function checkProductionPackaging() {
  header('7. PRODUCTION PACKAGING CHECK');

  // Check VSIX file exists
  const vsixFiles = fs.readdirSync('.').filter(f => f.endsWith('.vsix'));
  if (vsixFiles.length > 0) {
    log(`Found VSIX package: ${vsixFiles[0]}`, 'success');
    const stats = fs.statSync(vsixFiles[0]);
    const sizeKB = Math.round(stats.size / 1024);
    log(`Package size: ${sizeKB} KB`, sizeKB < 500 ? 'success' : 'warning');
  } else {
    log('No VSIX package found - run "npm run package" to create', 'warning');
  }

  // Check .vscodeignore
  if (fs.existsSync('.vscodeignore')) {
    const ignoreContent = fs.readFileSync('.vscodeignore', 'utf8');
    const hasTestExclusion = ignoreContent.includes('test') || ignoreContent.includes('.vscode-test');
    const hasSrcExclusion = ignoreContent.includes('src');

    log(`.vscodeignore excludes tests: ${hasTestExclusion}`, hasTestExclusion ? 'success' : 'warning');
    log(`.vscodeignore excludes source: ${hasSrcExclusion}`, hasSrcExclusion ? 'success' : 'warning');
  }
}

// 8. Marketplace requirements
function checkMarketplaceRequirements() {
  header('8. MARKETPLACE REQUIREMENTS CHECK');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  // Check publisher
  if (pkg.publisher && pkg.publisher !== 'your-publisher-name') {
    log(`Publisher configured: ${pkg.publisher}`, 'success');
  } else {
    log('Publisher not properly configured', 'error');
  }

  // Check repository
  if (pkg.repository && pkg.repository.url) {
    log(`Repository URL: ${pkg.repository.url}`, 'success');
  } else {
    log('Repository URL not configured', 'warning');
  }

  // Check categories
  if (pkg.categories && pkg.categories.length > 0) {
    log(`Categories: ${pkg.categories.join(', ')}`, 'success');
  } else {
    log('No categories specified', 'warning');
  }

  // Check keywords
  if (pkg.keywords && pkg.keywords.length > 0) {
    log(`Keywords: ${pkg.keywords.join(', ')}`, 'success');
  } else {
    log('No keywords specified', 'warning');
  }
}

// Helper function to get all files recursively
function getAllFiles(dir, ext) {
  const files = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    fs.readdirSync(currentDir).forEach(file => {
      const fullPath = path.join(currentDir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory() && !file.startsWith('.')) {
        walk(fullPath);
      } else if (file.endsWith(ext)) {
        files.push(fullPath);
      }
    });
  }

  walk(dir);
  return files;
}

// Main execution
function main() {
  console.log(colors.bold + '\n🔍 AUTOMATUS VSCODE EXTENSION - FINAL PRODUCTION VERIFICATION\n' + colors.reset);

  checkRequiredFiles();
  verifyPackageJson();
  checkTypeScriptCompilation();
  checkDisposableStore();
  verifyDisposalPatterns();
  checkTestCoverage();
  checkProductionPackaging();
  checkMarketplaceRequirements();

  // Final summary
  header('VERIFICATION SUMMARY');

  if (hasErrors) {
    log(`Verification completed with ERRORS - not ready for production`, 'error');
    process.exit(1);
  } else if (hasWarnings) {
    log(`Verification completed with warnings - review before release`, 'warning');
    log('The extension is technically ready but could benefit from:', 'info');
    log('  • Adding an icon for marketplace visibility', 'info');
    log('  • Updating version number from 0.1.0', 'info');
    log('  • Completing test coverage', 'info');
  } else {
    log(`All checks passed - ready for production! 🚀`, 'success');
  }

  console.log('\n' + colors.bold + '═'.repeat(60) + colors.reset + '\n');
}

// Run verification
main();