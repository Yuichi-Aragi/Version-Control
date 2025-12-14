import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import semver from 'semver';

// --- Configurable Defaults ---
const EXEC_TIMEOUT = 60_000; // 60s timeout for commands

// --- Helper Functions ---

/**
 * Executes a shell command where failure is considered critical and stops the script.
 * Provides better handling of stuck or failed processes.
 * @param {string} command The command to execute.
 */
function run(command) {
  console.log(`> ${command}`);
  try {
    execSync(command, {
      encoding: 'utf-8',
      stdio: 'inherit',
      timeout: EXEC_TIMEOUT
    });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

/**
 * Executes a command silently for cleanup. Failure does not stop the script.
 * Includes internal timeout safeguard.
 * @param {string} command The command to execute.
 * @returns {boolean} True if successful, false otherwise.
 */
function runSilently(command) {
  try {
    execSync(command, { stdio: 'pipe', timeout: EXEC_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and parses a JSON file safely.
 * @param {string} filePath Path to the JSON file.
 * @returns {object} The parsed JSON object.
 */
function readJsonFile(filePath) {
  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`❌ Error reading or parsing JSON file: ${filePath}`);
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * Atomically writes an object to a JSON file with pretty printing.
 * Prevents partial/corrupted writes.
 * @param {string} filePath Path to the JSON file.
 * @param {object} data The object to write.
 */
function writeJsonFile(filePath, data) {
  try {
    const tmpPath = join(tmpdir(), `${Date.now()}-${Math.random()}-${filePath.replace(/[\\/]/g, '_')}`);
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, filePath);
    console.log(`✅ Successfully updated ${filePath}`);
  } catch (error) {
    console.error(`❌ Failed writing file: ${filePath}`);
    throw error;
  }
}

/**
 * Gets the latest version from versions.json with its minAppVersion.
 * Returns null if versions.json is empty.
 */
function getLatestVersionEntry(versions) {
  const versionKeys = Object.keys(versions);
  if (versionKeys.length === 0) return null;
  
  const latestVersion = versionKeys.reduce((latest, v) => {
    return semver.gt(v, latest) ? v : latest;
  }, versionKeys[0]);
  
  return {
    version: latestVersion,
    minAppVersion: versions[latestVersion]
  };
}

/**
 * Checks if the new version/minAppVersion should trigger a release.
 * Returns true if either:
 * 1. New version is greater than latest version
 * 2. Version is the same but minAppVersion is greater
 */
function shouldTriggerRelease(latestEntry, newVersion, newMinAppVersion) {
  if (!latestEntry) return true; // First release
  
  const versionComparison = semver.compare(newVersion, latestEntry.version);
  
  if (versionComparison > 0) {
    console.log(`📈 New version ${newVersion} is greater than latest ${latestEntry.version}`);
    return true;
  }
  
  if (versionComparison === 0) {
    const minAppComparison = semver.compare(newMinAppVersion, latestEntry.minAppVersion);
    if (minAppComparison > 0) {
      console.log(`📈 Same version ${newVersion} but minAppVersion increased from ${latestEntry.minAppVersion} to ${newMinAppVersion}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Retries a given function a few times if it fails.
 * Useful for transient network or GitHub CLI errors.
 */
async function retry(fn, attempts = 3, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        console.warn(`⚠️  Attempt ${i+1} failed. Retrying in ${delayMs}ms...`);
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Ensures main.js is available for release by copying/renaming index.js
 * Looks for index.js in common build output locations
 */
function ensureMainJsForRelease() {
  console.log("🔍 Ensuring main.js is available for release...");
  
  // Common build output locations for Obsidian plugins
  const possiblePaths = [
    'main/index.js',
    'dist/index.js',
    'index.js',
    'build/index.js'
  ];
  
  let sourcePath = null;
  
  // Find the first existing index.js file
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      sourcePath = path;
      console.log(`✅ Found index.js at: ${path}`);
      break;
    }
  }
  
  if (!sourcePath) {
    throw new Error('❌ Could not find index.js in any expected location: ' + possiblePaths.join(', '));
  }
  
  // Copy index.js to main.js in the root directory
  copyFileSync(sourcePath, 'main.js');
  console.log(`✅ Copied ${sourcePath} to main.js`);
  
  // Verify the copy was successful
  if (!existsSync('main.js')) {
    throw new Error('❌ Failed to create main.js file');
  }
  
  // Check if the file has content
  const mainJsContent = readFileSync('main.js', 'utf-8');
  if (mainJsContent.trim().length === 0) {
    console.warn('⚠️  main.js appears to be empty');
  } else {
    console.log(`✅ main.js created successfully (${mainJsContent.length} bytes)`);
  }
}

// --- Main Logic ---

async function main() {
  // Log the current branch for context
  const currentBranch = process.env.GITHUB_REF_NAME;
  console.log(`\n---\n🔄 Workflow triggered on branch: '${currentBranch || 'Unknown'}'\n---`);

  // Read original files for backup
  const originalManifestContent = readFileSync('manifest.json', 'utf-8');
  const originalVersionsContent = readFileSync('versions.json', 'utf-8');
  const originalPackageJsonContent = readFileSync('package.json', 'utf-8');
  
  const manifest = JSON.parse(originalManifestContent);
  const versions = JSON.parse(originalVersionsContent);
  const packageJson = JSON.parse(originalPackageJsonContent);

  const manifestVersion = manifest.version;
  const minAppVersion = manifest.minAppVersion;

  // Check if we should trigger a release
  const latestEntry = getLatestVersionEntry(versions);
  
  if (!shouldTriggerRelease(latestEntry, manifestVersion, minAppVersion)) {
    console.log(`ℹ️ No need to trigger release. Current: v${manifestVersion} (min ${minAppVersion}), Latest: v${latestEntry?.version} (min ${latestEntry?.minAppVersion})`);
    process.exit(0);
  }

  try {
    console.log(`🚀 Starting update process for version: ${manifestVersion} (minApp: ${minAppVersion})`);

    // Sync package.json
    if (packageJson.version !== manifestVersion) {
      packageJson.version = manifestVersion;
      writeJsonFile('package.json', packageJson);
    }

    // Build
    console.log("🏗️ Running build...");
    try {
      run('pnpm run build');
    } catch (buildError) {
      console.error('❌ Build failed!');
      console.error('Build error:', buildError.message);
      throw new Error(`Build failed: ${buildError.message}`);
    }

    // Ensure main.js is available by copying/renaming index.js
    ensureMainJsForRelease();

    // Release
    const tagName = manifestVersion;

    // Determine release assets - always include main.js, manifest.json, and optionally styles.css
    const baseAssets = ['main.js', 'manifest.json'];
    const cssPath = 'styles.css';
    const finalAssets = [...baseAssets];

    if (existsSync(cssPath)) {
      const cssContent = readFileSync(cssPath, 'utf-8').trim();
      if (cssContent.length > 0) {
        finalAssets.push(cssPath);
        console.log(`ℹ️ Including '${cssPath}' in release as it is not empty.`);
      } else {
        console.log(`ℹ️ Skipping '${cssPath}' in release as it is empty.`);
      }
    } else {
      console.log(`ℹ️ Skipping '${cssPath}' in release as it does not exist.`);
    }
    const releaseAssets = finalAssets.join(' ');

    console.log(`🔎 Checking for existing release '${tagName}'...`);
    if (runSilently(`gh release view ${tagName}`)) {
      console.log(`♻️ Deleting existing release and tag '${tagName}' to prevent conflicts...`);
      await retry(() => run(`gh release delete ${tagName} --yes --cleanup-tag`));
    } else {
      console.log(`✅ No existing release found for '${tagName}'.`);
    }

    console.log(`📦 Creating new release '${tagName}' with assets: ${releaseAssets}`);
    await retry(() =>
      run(`gh release create ${tagName} ${releaseAssets} --title "Version ${tagName}" --notes "Automated release for version ${tagName}."`)
    );

    // Update versions.json only after successful release
    if (versions[manifestVersion] !== minAppVersion) {
      versions[manifestVersion] = minAppVersion;
      writeJsonFile('versions.json', versions);
    }

    // Clean up the temporary main.js file (optional, but good practice)
    if (existsSync('main.js')) {
      unlinkSync('main.js');
      console.log('🧹 Cleaned up temporary main.js file');
    }

    console.log("🎉 Process completed successfully.");

  } catch (error) {
    console.error("\n--- ❌ ERROR OCCURRED ---");
    console.error("Error message:", error.message);
    console.error("--- ⏪ INITIATING ROLLBACK ---");

    // Clean up temporary main.js file if it exists
    if (existsSync('main.js')) {
      unlinkSync('main.js');
      console.log("🧹 Removed temporary main.js file.");
    }

    // Restore original files
    writeFileSync('versions.json', originalVersionsContent, 'utf-8');
    console.log("↩️ Reverted versions.json.");
    writeFileSync('package.json', originalPackageJsonContent, 'utf-8');
    console.log("↩️ Reverted package.json.");
    writeFileSync('manifest.json', originalManifestContent, 'utf-8');
    console.log("↩️ Reverted manifest.json.");

    // Cleanup release/tag if created
    const tagName = manifestVersion;
    console.log(`🧹 Attempting to remove release/tag '${tagName}'...`);

    if (runSilently(`gh release view ${tagName}`)) {
      if (runSilently(`gh release delete ${tagName} --yes --cleanup-tag`)) {
        console.log(`✅ Deleted release and tag '${tagName}'.`);
      }
    } else {
       console.log(`ℹ️ No release found for '${tagName}', skipping cleanup.`);
    }

    console.error("--- ROLLBACK COMPLETE ---");
    console.error("❌ Release process failed. Check logs above for details.");
    process.exit(1);
  }
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("An unexpected error occurred in the main execution block:", err);
    process.exit(1);
  });
}

export { main };
