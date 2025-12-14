import type { TFolder } from 'obsidian';
import type { HistorySettings } from '@/types';
import type { ActionItem } from '@/state';

/**
 * Type definitions for settings thunk payloads and related interfaces.
 */

/**
 * Format types supported for version export.
 */
export type ExportFormat = 'md' | 'json' | 'ndjson' | 'txt' | 'zip' | 'gzip';

/**
 * Action items for export format selection.
 */
export type ExportFormatActionItem = ActionItem<ExportFormat>;

/**
 * Action items for folder selection.
 */
export type FolderActionItem = ActionItem<TFolder>;

/**
 * Payload for updating settings.
 */
export type SettingsUpdatePayload = Partial<HistorySettings>;

/**
 * Icon mapping for export formats.
 */
export const EXPORT_FORMAT_ICONS: Record<ExportFormat, string> = {
    md: 'file-text',
    json: 'braces',
    ndjson: 'list-ordered',
    txt: 'file-code',
    zip: 'archive',
    gzip: 'archive',
};

/**
 * All supported export formats.
 */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['md', 'json', 'ndjson', 'txt', 'zip', 'gzip'] as const;
