import type { AppState } from '@/state';
import { AppStatus } from '@/state';
import type { TFile } from 'obsidian';
import type { UIService } from '@/services';

/**
 * Validation utilities for version thunks.
 */

/**
 * Validates that the app is in a ready state for version operations.
 *
 * @param state - The current app state.
 * @param uiService - UI service for notifications.
 * @param isAuto - Whether this is an automatic operation.
 * @returns true if valid, false otherwise.
 */
export function validateReadyState(
    state: AppState,
    uiService: UIService,
    isAuto: boolean = false
): boolean {
    if (state.status !== AppStatus.READY) {
        if (!isAuto) {
            console.warn(
                "Version Control: Manual save attempt while not in Ready state. Aborting.",
                state.status
            );
            uiService.showNotice("VC: Cannot save version, the view is not ready.", 3000);
        }
        return false;
    }
    return true;
}

/**
 * Validates that a file exists in the state.
 *
 * @param file - The file from state.
 * @param uiService - UI service for notifications.
 * @param isAuto - Whether this is an automatic operation.
 * @returns true if file exists, false otherwise.
 */
export function validateFileExists(
    file: TFile | null,
    uiService: UIService,
    isAuto: boolean = false
): file is TFile {
    if (!file) {
        if (!isAuto) {
            uiService.showNotice("VC: Cannot save, no active file is selected.", 3000);
        }
        return false;
    }
    return true;
}

/**
 * Validates that rename is not in progress.
 *
 * @param isRenaming - Whether a rename is in progress.
 * @param uiService - UI service for notifications.
 * @param operation - The operation name for the error message.
 * @returns true if not renaming, false otherwise.
 */
export function validateNotRenaming(
    isRenaming: boolean,
    uiService: UIService,
    operation: string
): boolean {
    if (isRenaming) {
        uiService.showNotice(`Cannot ${operation} while database is being renamed.`);
        return false;
    }
    return true;
}

/**
 * Validates that both note ID and file exist.
 *
 * @param noteId - The note ID from state.
 * @param file - The file from state.
 * @returns true if both exist, false otherwise.
 */
export function validateNoteContext(
    noteId: string | null,
    file: TFile | null
): file is TFile {
    return noteId !== null && file !== null;
}
