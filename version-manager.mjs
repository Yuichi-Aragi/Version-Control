import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// --- Helper Functions ---

/**
 * Executes a shell command where failure is considered critical and stops the script.
 * @param {string} command The command to execute.
 */
function run(command) {
  console.log(`> ${command}`);
  // stdio: 'inherit' ensures that the build process output is shown in the GitHub Actions log.
  execSync(command, { encoding: 'utf-8', stdio: 'inherit' });
}

/**
 * Executes a command silently for cleanup. Failure does not stop the script.
 * @param {string} command The command to execute.
 * @returns {boolean} True if successful, false otherwise.
 */
function runSilently(command) {
    try {
        execSync(command, { stdio: 'pipe' });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Reads and parses a JSON file.
 * @param {string} filePath Path to the JSON file.
 * @returns {object} The parsed JSON object.
 */
function readJsonFile(filePath) {
  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error reading or parsing ${filePath}:`, error);
    process.exit(1);
  }
}

/**
 * Writes an object to a JSON file with pretty printing.
 * @param {string} filePath Path to the JSON file.
 * @param {object} data The object to write.
 */
function writeJsonFile(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Successfully updated ${filePath}`);
}

/**
 * Compares two semantic version strings.
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if v1 === v2
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
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
 * @param {string[]} versionKeys An array of version strings.
 * @returns {string|null} The latest version string or null if the array is empty.
 */
function getLatestVersion(versionKeys) {
    if (!versionKeys || versionKeys.length === 0) return null;
    return versionKeys.sort(compareVersions).pop();
}


// --- Main Logic ---

// 1. Read initial files and store their original content for potential rollback.
const manifest = readJsonFile('manifest.json');
const versions = readJsonFile('versions.json');
const packageJson = readJsonFile('package.json');

const originalVersionsContent = readFileSync('versions.json', 'utf-8');
const originalPackageJsonContent = readFileSync('package.json', 'utf-8');

const manifestVersion = manifest.version;
const minAppVersion = manifest.minAppVersion;

// 2. Pre-check: Ensure the new version is actually greater than the latest known version.
const latestKnownVersion = getLatestVersion(Object.keys(versions));
if (latestKnownVersion && compareVersions(manifestVersion, latestKnownVersion) <= 0) {
    console.log(`Manifest version '${manifestVersion}' is not newer than the latest version in versions.json ('${latestKnownVersion}'). No action needed.`);
    process.exit(0);
}

// 3. Start the main process with rollback capability
try {
    console.log(`New version '${manifestVersion}' is valid. Starting update and release process.`);

    // Sync package.json if needed
    if (packageJson.version !== manifestVersion) {
        packageJson.version = manifestVersion;
        writeJsonFile('package.json', packageJson);
    }

    // Update versions.json
    versions[manifestVersion] = minAppVersion;
    writeJsonFile('versions.json', versions);

    // --- Build Process ---
    // If this fails, the catch block will be executed.
    console.log("Running build script...");
    run('npm run build');

    // --- Release Process ---
    const tagName = manifestVersion;
    const releaseAssets = "main.js styles.css manifest.json";

    console.log(`Checking for existing release with tag '${tagName}'...`);
    if (runSilently(`gh release view ${tagName}`)) {
        console.log(`Release '${tagName}' found. Deleting it before creating a new one.`);
        run(`gh release delete ${tagName} --yes`);
    } else {
        console.log(`No existing release found for tag '${tagName}'.`);
    }

    console.log(`Creating new release '${tagName}' with assets: ${releaseAssets}`);
    run(`gh release create ${tagName} ${releaseAssets} --title "Version ${tagName}" --notes "Automated release for version ${tagName}."`);
    
    console.log("Process completed successfully.");

} catch (error) {
    console.error("\n--- AN ERROR OCCURRED! ---");
    console.error("Error message:", error.message);
    console.error("--- INITIATING ROLLBACK ---");

    // Rollback file changes
    writeFileSync('versions.json', originalVersionsContent);
    console.log("Reverted versions.json.");
    writeFileSync('package.json', originalPackageJsonContent);
    console.log("Reverted package.json.");

    // Attempt to rollback release and tag
    const tagName = manifest.version;
    console.log(`Attempting to delete release and tag '${tagName}' if they were created...`);
    
    if (runSilently(`gh release delete ${tagName} --yes`)) {
        console.log(`Successfully deleted remote release '${tagName}'.`);
    } else {
        console.log(`Could not delete remote release '${tagName}' (it likely never existed).`);
    }
    
    // The tag is often deleted with the release, but we try explicitly just in case.
    if (runSilently(`git push --delete origin ${tagName}`)) {
        console.log(`Successfully deleted remote tag '${tagName}'.`);
    } else {
        console.log(`Could not delete remote tag '${tagName}' (it likely never existed or was already deleted).`);
    }

    console.error("--- ROLLBACK COMPLETE ---");
    process.exit(1); // Exit with an error code to fail the workflow run
}
