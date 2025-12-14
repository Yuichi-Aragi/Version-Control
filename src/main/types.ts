import type { Debouncer, TFile } from 'obsidian';

/**
 * Information about a debounced operation for auto-save functionality.
 */
export interface DebouncerInfo {
    debouncer: Debouncer<[TFile], void>;
    interval: number; // in milliseconds
}

/**
 * Queued request to show the changelog panel.
 */
export interface QueuedChangelogRequest {
    forceRefresh: boolean;
    isManualRequest: boolean;
}
