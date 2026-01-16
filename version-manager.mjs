// --- Core Imports ---
import { 
  readFileSync, 
  writeFileSync, 
  copyFileSync, 
  existsSync, 
  unlinkSync, 
  mkdirSync,
  renameSync,
  statSync
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

// --- Configuration ---
const CONFIG = {
  EXEC_TIMEOUT: 60_000,
  VERSION_FILES: {
    STABLE: 'versions.json',
    BETA: 'version-beta.json'
  },
  REQUIRED_FILES: ['manifest.json', 'package.json'],
  BUILD_OUTPUT: 'assets/main.js',
  ASSETS: {
    MANIFEST: 'manifest.json',
    STYLES: 'assets/styles.css'
  }
};

// --- Type Definitions ---
/**
 * @typedef {Object} VersionEntry
 * @property {string} version - Semantic version string
 * @property {string} minAppVersion - Minimum application version
 */

/**
 * @typedef {Object} ManifestData
 * @property {string} version - Plugin version
 * @property {string} minAppVersion - Minimum Obsidian app version
 * @property {string} id - Plugin identifier
 * @property {string} name - Plugin display name
 */

/**
 * @typedef {Object} PackageJson
 * @property {string} version - Package version
 * @property {string} name - Package name
 */

// --- Helper Functions ---

/**
 * Executes a shell command with strict error handling
 * @param {string} command - Shell command to execute
 * @param {Object} options - Execution options
 */
function run(command, options = {}) {
  const fullCommand = `set -euo pipefail; ${command}`;
  console.log(`> ${command}`);
  
  try {
    execSync(fullCommand, {
      encoding: 'utf-8',
      stdio: 'inherit',
      timeout: CONFIG.EXEC_TIMEOUT,
      shell: '/bin/bash',
      ...options
    });
  } catch (error) {
    const msg = `Command failed (exit ${error.status || 'unknown'}): ${command}`;
    throw new Error(msg, { cause: error });
  }
}

/**
 * Executes a command silently, returning boolean success
 * @param {string} command - Command to execute
 * @returns {boolean} Success status
 */
function runSilently(command) {
  try {
    execSync(command, { stdio: 'pipe', timeout: CONFIG.EXEC_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely reads and parses JSON files
 * @param {string} filePath - Path to JSON file
 * @returns {any} Parsed JSON object
 */
function readJsonFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse JSON "${filePath}": ${error.message}`, { cause: error });
  }
}

/**
 * Atomically writes formatted JSON with error recovery
 * @param {string} filePath - Target file path
 * @param {any} data - Data to serialize
 */
function writeJsonFile(filePath, data) {
  const tempDir = join(tmpdir(), 'version-manager');
  mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, `${Date.now()}-${Math.random()}-${basename(filePath)}.tmp`);
  
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    renameSync(tempPath, filePath);
    console.log(`✅ Updated ${filePath}`);
  } catch (error) {
    // Cleanup temp file if it exists
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw new Error(`Failed to write "${filePath}": ${error.message}`, { cause: error });
  }
}

/**
 * Validates and checks for beta version pattern
 * @param {string} version - Version string to validate
 * @returns {boolean} True if beta version
 */
function isBetaVersion(version) {
  if (!semver.valid(version)) {
    throw new Error(`Invalid semver version: "${version}"`);
  }
  return /^.+-beta\.\d+$/.test(version);
}

/**
 * Retrieves latest version entry from versions map
 * @param {Object} versions - Version mapping object
 * @returns {VersionEntry|null} Latest version or null
 */
function getLatestVersionEntry(versions) {
  const keys = Object.keys(versions);
  if (keys.length === 0) return null;
  
  const latest = keys.reduce((max, v) => semver.gt(v, max) ? v : max, keys[0]);
  return { version: latest, minAppVersion: versions[latest] };
}

/**
 * Determines if a release should be triggered
 * @param {VersionEntry|null} latest - Latest version entry
 * @param {string} newVersion - New version candidate
 * @param {string} newMinApp - New minimum app version
 * @returns {boolean} True if release is warranted
 */
function shouldTriggerRelease(latest, newVersion, newMinApp) {
  if (!latest) {
    console.log('ℹ️ First release detected');
    return true;
  }
  
  const versionCmp = semver.compare(newVersion, latest.version);
  if (versionCmp > 0) {
    console.log(`📈 Version ${newVersion} > ${latest.version}`);
    return true;
  }
  
  if (versionCmp === 0 && semver.gt(newMinApp, latest.minAppVersion)) {
    console.log(`📈 Same version ${newVersion} but minAppVersion increased from ${latest.minAppVersion} to ${newMinApp}`);
    return true;
  }
  
  return false;
}

/**
 * Retry wrapper for transient failures
 * @param {Function} fn - Async function to retry
 * @param {number} attempts - Maximum retry attempts
 * @param {number} delayMs - Delay between retries
 * @returns {Promise<any>}
 */
async function retry(fn, attempts = 3, delayMs = 1500) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        console.warn(`⚠️  Attempt ${i + 1}/${attempts} failed: ${error.message}`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Validates build output exists and has content
 * @param {string} expectedPath - Path to build artifact
 */
function validateBuildOutput(expectedPath = CONFIG.BUILD_OUTPUT) {
  console.log(`🔍 Validating build output: ${expectedPath}`);
  
  if (!existsSync(expectedPath)) {
    throw new Error(`Build artifact not found: ${expectedPath}`);
  }
  
  const stats = statSync(expectedPath);
  if (stats.size === 0) {
    throw new Error(`Build artifact is empty: ${expectedPath}`);
  }
  
  console.log(`✅ Build valid (${stats.size} bytes)`);
}

/**
 * Prepares a file for release by copying to root
 * @param {string} sourcePath - Source file path
 * @param {string} destPath - Destination path
 */
function prepareReleaseAsset(sourcePath, destPath) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Asset source not found: ${sourcePath}`);
  }
  
  copyFileSync(sourcePath, destPath);
  console.log(`📋 Prepared asset: ${destPath}`);
}

// --- Main Execution ---

async function main() {
  const start = Date.now();
  const branch = process.env.GITHUB_REF_NAME || 'local';
  console.log(`\n🚀 Version Manager v2026.1.0 | Branch: ${branch}`);
  
  // Create backups of critical files
  const backups = new Map();
  const filesToBackup = [
    ...CONFIG.REQUIRED_FILES,
    CONFIG.VERSION_FILES.STABLE,
    CONFIG.VERSION_FILES.BETA
  ];
  
  for (const file of filesToBackup) {
    if (existsSync(file)) {
      backups.set(file, readFileSync(file, 'utf-8'));
    }
  }
  
  // Load and validate manifest
  /** @type {ManifestData} */
  const manifest = readJsonFile(CONFIG.ASSETS.MANIFEST);
  const { version: manifestVersion, minAppVersion, id: pluginId, name: pluginName } = manifest;
  
  if (!semver.valid(manifestVersion)) {
    throw new Error(`manifest.json contains invalid version: "${manifestVersion}"`);
  }
  if (!semver.valid(minAppVersion)) {
    throw new Error(`manifest.json contains invalid minAppVersion: "${minAppVersion}"`);
  }
  
  console.log(`📦 ${pluginName} (${pluginId}) v${manifestVersion} (min: ${minAppVersion})`);
  
  // Determine release type and version file
  const isBeta = isBetaVersion(manifestVersion);
  const versionFile = isBeta ? CONFIG.VERSION_FILES.BETA : CONFIG.VERSION_FILES.STABLE;
  console.log(`🎯 ${isBeta ? '🔬 Beta' : '📦 Stable'} release | Version file: ${versionFile}`);
  
  // Load version data
  const versions = existsSync(versionFile) ? readJsonFile(versionFile) : {};
  const packageJson = readJsonFile('package.json');
  
  // Prevent duplicate versions
  if (versions[manifestVersion]) {
    throw new Error(`Version ${manifestVersion} already exists in ${versionFile}`);
  }
  
  // Check if stable version conflicts with beta
  if (isBeta && existsSync(CONFIG.VERSION_FILES.STABLE)) {
    const stableVersions = readJsonFile(CONFIG.VERSION_FILES.STABLE);
    if (stableVersions[manifestVersion]) {
      throw new Error(`Beta version ${manifestVersion} conflicts with stable release`);
    }
  }
  
  // Determine if release is needed
  const latest = getLatestVersionEntry(versions);
  if (!shouldTriggerRelease(latest, manifestVersion, minAppVersion)) {
    console.log(`ℹ️ No release needed. Latest: v${latest?.version}`);
    process.exit(0);
  }
  
  // For stable releases, sync package.json version
  if (!isBeta && packageJson.version !== manifestVersion) {
    console.log('🔄 Syncing package.json version');
    packageJson.version = manifestVersion;
    writeJsonFile('package.json', packageJson);
  }
  
  try {
    // Build project
    console.log('🏗️ Building project...');
    run('pnpm run build');
    validateBuildOutput();
    
    // Prepare release assets
    const releaseAssets = [CONFIG.ASSETS.MANIFEST];
    
    // Copy main build artifact
    const mainJsPath = 'assets/main.js';
    prepareReleaseAsset(CONFIG.BUILD_OUTPUT, mainJsPath);
    releaseAssets.push(mainJsPath);
    
    // Include assets/styles.css if non-empty
    const stylesPath = CONFIG.ASSETS.STYLES;
    if (existsSync(stylesPath)) {
      const content = readFileSync(stylesPath, 'utf-8').trim();
      if (content.length > 0) {
        releaseAssets.push(stylesPath);
        console.log(`🎨 Including ${stylesPath}`);
      } else {
        console.log(`⚠️ Skipping empty ${stylesPath}`);
      }
    }
    
    // Delete existing release if present
    console.log(`🔎 Checking for existing release ${manifestVersion}...`);
    if (runSilently(`gh release view ${manifestVersion}`)) {
      console.log(`♻️ Removing existing release ${manifestVersion}...`);
      await retry(() => run(`gh release delete ${manifestVersion} --yes --cleanup-tag`));
    }
    
    // Create GitHub release
    const assets = releaseAssets.join(' ');
    const prereleaseFlag = isBeta ? '--prerelease' : '';
    const title = isBeta ? `${pluginName} Beta ${manifestVersion}` : `${pluginName} ${manifestVersion}`;
    const notes = `Automated release for ${pluginId} v${manifestVersion}`;
    
    console.log(`📦 Creating ${isBeta ? 'pre-release' : 'release'} ${manifestVersion}...`);
    await retry(() =>
      run(`gh release create ${manifestVersion} ${assets} --title "${title}" --notes "${notes}" ${prereleaseFlag}`)
    );
    
    // Update version file (beta.json or versions.json)
    if (versions[manifestVersion] !== minAppVersion) {
      versions[manifestVersion] = minAppVersion;
      writeJsonFile(versionFile, versions);
    }
    
    // Cleanup temporary assets
    if (existsSync(mainJsPath)) {
      unlinkSync(mainJsPath);
    }
    
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n🎉 Success! Release completed in ${duration}s`);
    
  } catch (error) {
    console.error(`\n❌ Fatal Error: ${error.message}`);
    
    // Restore all backups
    console.log('\n🔄 Rolling back changes...');
    for (const [file, content] of backups) {
      writeFileSync(file, content, 'utf-8');
      console.log(`↩️ Restored ${file}`);
    }
    
    // Cleanup temp files
    if (existsSync('assets/main.js')) {
      unlinkSync('assets/main.js');
    }
    
    // Attempt to remove failed release
    if (runSilently(`gh release view ${manifestVersion}`)) {
      console.log(`🧹 Cleaning up failed release ${manifestVersion}...`);
      runSilently(`gh release delete ${manifestVersion} --yes --cleanup-tag`);
    }
    
    console.log('✅ Rollback complete');
    process.exit(1);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('\n💥 Unhandled error:', err);
    process.exit(1);
  });
}

export { main };
