/**
 * UI Utilities Module
 *
 * This module provides utility functions for DOM manipulation and string formatting.
 *
 * @module ui/utils
 *
 * ## Namespaces
 *
 * - **dom**: DOM manipulation utilities (element creation, class handling)
 * - **strings**: String formatting utilities (truncation, relative time)
 *
 * ## Usage
 *
 * ```typescript
 * import { dom, strings } from '@/ui/utils';
 *
 * // DOM utilities
 * const element = dom.createElement('div', { className: 'panel' });
 *
 * // String utilities
 * const truncated = strings.truncate(text, 50);
 * const relative = strings.formatRelativeTime(timestamp);
 * ```
 */

// ============================================================================
// NAMESPACE EXPORTS
// ============================================================================

export * as dom from './dom';
export * as strings from './strings';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Options for string truncation.
 */
export interface TruncateOptions {
    maxLength: number;
    ellipsis?: string;
    preserveWords?: boolean;
}

/**
 * Options for relative time formatting.
 */
export interface RelativeTimeOptions {
    now?: number;
    style?: 'short' | 'long' | 'narrow';
}
