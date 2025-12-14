import type { UIService } from '@/services';
import type { TFile } from 'obsidian';

/**
 * User notification utilities for version thunks.
 */

/**
 * Shows a success notification for saving a version.
 *
 * @param uiService - The UI service.
 * @param displayName - The display name of the version.
 * @param file - The file that was versioned.
 */
export function notifyVersionSaved(
    uiService: UIService,
    displayName: string,
    file: TFile
): void {
    uiService.showNotice(`Version ${displayName} saved for "${file.basename}".`);
}

/**
 * Shows a background notification for saving a version.
 *
 * @param uiService - The UI service.
 * @param displayName - The display name of the version.
 * @param file - The file that was versioned.
 */
export function notifyVersionSavedInBackground(
    uiService: UIService,
    displayName: string,
    file: TFile
): void {
    uiService.showNotice(
        `Version ${displayName} saved for "${file.basename}" in the background.`,
        4000
    );
}

/**
 * Shows a notification for duplicate content (no save occurred).
 *
 * @param uiService - The UI service.
 */
export function notifyDuplicateContent(uiService: UIService): void {
    uiService.showNotice(
        "Content is identical to the latest version. No new version was saved.",
        4000
    );
}

/**
 * Shows a notification for a successful restore.
 *
 * @param uiService - The UI service.
 * @param file - The file that was restored.
 * @param versionId - The ID of the version that was restored.
 */
export function notifyRestoreSuccess(
    uiService: UIService,
    file: TFile,
    versionId: string
): void {
    uiService.showNotice(
        `Successfully restored "${file.basename}" to version ${versionId.substring(0, 6)}...`
    );
}

/**
 * Shows a notification for a restore cancellation.
 *
 * @param uiService - The UI service.
 */
export function notifyRestoreCancelled(uiService: UIService): void {
    uiService.showNotice(
        `Restore cancelled because the active note changed during backup.`,
        5000
    );
}

/**
 * Shows a notification for a successful delete.
 *
 * @param uiService - The UI service.
 * @param versionId - The ID of the deleted version.
 */
export function notifyDeleteSuccess(uiService: UIService, versionId: string): void {
    uiService.showNotice(`Version ${versionId.substring(0, 6)}... deleted successfully.`);
}

/**
 * Shows a background notification for a successful delete.
 *
 * @param uiService - The UI service.
 * @param fileName - The name of the file.
 */
export function notifyDeleteInBackground(uiService: UIService, fileName: string): void {
    uiService.showNotice(`Version deleted for "${fileName}" in the background.`, 4000);
}

/**
 * Shows a notification when the last version is deleted.
 *
 * @param uiService - The UI service.
 * @param fileName - The name of the file.
 */
export function notifyLastVersionDeleted(uiService: UIService, fileName: string): void {
    uiService.showNotice(
        `Last version and branch deleted. "${fileName}" may now be on a different branch or no longer under version control.`
    );
}

/**
 * Shows a notification for deleting all versions.
 *
 * @param uiService - The UI service.
 * @param fileName - The name of the file.
 */
export function notifyDeleteAllSuccess(uiService: UIService, fileName: string): void {
    uiService.showNotice(
        `All versions for the current branch of "${fileName}" have been deleted.`
    );
}

/**
 * Shows a background notification for deleting all versions.
 *
 * @param uiService - The UI service.
 * @param fileName - The name of the file.
 */
export function notifyDeleteAllInBackground(uiService: UIService, fileName: string): void {
    uiService.showNotice(
        `All versions for "${fileName}" have been deleted in the background.`,
        5000
    );
}

/**
 * Shows a notification for branch creation.
 *
 * @param uiService - The UI service.
 * @param branchName - The name of the created branch.
 */
export function notifyBranchCreated(uiService: UIService, branchName: string): void {
    uiService.showNotice(`Branch "${branchName}" created.`, 3000);
}

/**
 * Shows a notification for branch switching.
 *
 * @param uiService - The UI service.
 * @param branchName - The name of the branch switched to.
 */
export function notifyBranchSwitched(uiService: UIService, branchName: string): void {
    uiService.showNotice(`Switched to branch "${branchName}".`);
}
