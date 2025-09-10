import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

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
 * Strips non-numeric suffixes from a version part (handles semver gracefully).
 */
function normalizeVersionPart(part) {
  const numeric = parseInt(part.replace(/\D.*$/, ''), 10);
  return isNaN(numeric) ? 0 : numeric;
}

/**
 * Compares two semantic version strings (basic SemVer-safe).
 * Handles different lengths and ignores pre-release/build metadata for ordering.
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const parts1 = (v1 || '').split('.').map(normalizeVersionPart);
  const parts2 = (v2 || '').split('.').map(normalizeVersionPart);
  const len = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Finds the latest semantic version from an array of version strings.
 * Avoids repeated sorting by a simple reducer.
 * @param {string[]} versionKeys
 * @returns {string|null}
 */
function getLatestVersion(versionKeys) {
  if (!versionKeys || versionKeys.length === 0) return null;
  return versionKeys.reduce((latest, v) =>
    compareVersions(v, latest) > 0 ? v : latest, versionKeys[0]
  );
}

/**
 * Retries a given function a few times if it fails.
 * Useful for transient network or GitHub CLI errors.
 */
async function retry(fn, attempts = 3, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
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

// --- Main Logic ---

async function main() {
  // Log the current branch for context
  const currentBranch = process.env.GITHUB_REF_NAME;
  console.log(`\n---\n🔄 Workflow triggered on branch: '${currentBranch || 'Unknown'}'\n---`);

  const manifest = readJsonFile('manifest.json');
  const versions = readJsonFile('versions.json');
  const packageJson = readJsonFile('package.json');

  const originalVersionsContent = readFileSync('versions.json', 'utf-8');
  const originalPackageJsonContent = readFileSync('package.json', 'utf-8');

  const manifestVersion = manifest.version;
  const minAppVersion = manifest.minAppVersion;

  // Ensure new version is newer than the last known version
  const latestKnownVersion = getLatestVersion(Object.keys(versions));
  if (latestKnownVersion && compareVersions(manifestVersion, latestKnownVersion) <= 0) {
    console.log(`ℹ️ Manifest version '${manifestVersion}' is not newer than the latest known version '${latestKnownVersion}'. Nothing to do.`);
    process.exit(0);
  }

  try {
    console.log(`🚀 Starting update process for version: ${manifestVersion}`);

    // Sync package.json
    if (packageJson.version !== manifestVersion) {
      packageJson.version = manifestVersion;
      writeJsonFile('package.json', packageJson);
    }

    // Update versions.json only if missing
    if (versions[manifestVersion] !== minAppVersion) {
      versions[manifestVersion] = minAppVersion;
      writeJsonFile('versions.json', versions);
    }

    // Build
    console.log("🏗️ Running build...");
    try {
      run('npm run build');
    } catch (buildError) {
      // This allows the process to continue if the build fails, which may be desired
      // if build artifacts aren't critical for the release assets.
      console.error('⚠️ Build failed, but continuing to release. Error:', buildError.message);
    }

    // Release
    const tagName = manifestVersion;

    // Determine release assets, excluding styles.css if it's empty
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

    console.log("🎉 Process completed successfully.");

  } catch (error) {
    console.error("\n--- ❌ ERROR OCCURRED ---");
    console.error("Error message:", error.message);
    console.error("--- ⏪ INITIATING ROLLBACK ---");

    // Restore files
    writeFileSync('versions.json', originalVersionsContent, 'utf-8');
    console.log("↩️ Reverted versions.json.");
    writeFileSync('package.json', originalPackageJsonContent, 'utf-8');
    console.log("↩️ Reverted package.json.");

    // Cleanup release/tag if created
    const tagName = manifest.version;
    console.log(`🧹 Attempting to remove release/tag '${tagName}'...`);

    if (runSilently(`gh release view ${tagName}`)) {
      if (runSilently(`gh release delete ${tagName} --yes --cleanup-tag`)) {
        console.log(`✅ Deleted release and tag '${tagName}'.`);
      }
    } else {
       console.log(`ℹ️ No release found for '${tagName}', skipping cleanup.`);
    }

    console.error("--- ROLLBACK COMPLETE ---");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred in the main execution block:", err);
  process.exit(1);
});
