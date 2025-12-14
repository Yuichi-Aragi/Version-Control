import type { UIService } from '@/services';

/**
 * Error handling utilities for version thunks.
 */

/**
 * Handles errors during version operations with consistent logging and user notifications.
 *
 * @param error - The error that occurred.
 * @param operation - The name of the operation that failed (e.g., "saveNewVersion", "restoreVersion").
 * @param uiService - The UI service for showing notifications.
 * @param isAuto - Whether this was an automatic operation (affects notification behavior).
 * @returns The error message as a string.
 */
export function handleVersionError(
    error: unknown,
    operation: string,
    uiService: UIService,
    isAuto: boolean = false
): string {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    console.error(`Version Control: Error in ${operation} thunk.`, error);

    if (!isAuto) {
        uiService.showNotice(`An unexpected error occurred while ${operation}. Please check the console.`);
    }

    return message;
}

/**
 * Handles errors with a custom message to the user.
 *
 * @param error - The error that occurred.
 * @param operation - The name of the operation that failed.
 * @param customMessage - Custom message to show to the user.
 * @param uiService - The UI service for showing notifications.
 * @param duration - Optional duration for the notification in milliseconds.
 * @returns The error message as a string.
 */
export function handleVersionErrorWithMessage(
    error: unknown,
    operation: string,
    customMessage: string,
    uiService: UIService,
    duration: number = 5000
): string {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    console.error(`Version Control: Error in ${operation} thunk.`, error);
    uiService.showNotice(customMessage, duration);
    return message;
}
