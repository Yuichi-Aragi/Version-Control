/**
 * UI Hooks Module
 *
 * This module provides custom React hooks for common UI patterns.
 *
 * @module ui/hooks
 *
 * ## Hooks
 *
 * - **useBackdropClick**: Handles click-outside behavior for modals/panels
 * - **useDelayedFocus**: Manages focus with configurable delay
 * - **usePanelClose**: Provides consistent panel close behavior
 * - **usePanelSearch**: Search state and filtering logic for panels
 * - **useRedux**: Redux hooks (useAppSelector, useAppDispatch)
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   useAppSelector,
 *   useAppDispatch,
 *   useBackdropClick,
 *   usePanelSearch
 * } from '@/ui/hooks';
 *
 * // Redux hooks
 * const noteId = useAppSelector(state => state.noteId);
 * const dispatch = useAppDispatch();
 *
 * // Backdrop click hook
 * const ref = useBackdropClick(onClose);
 *
 * // Panel search hook
 * const { query, setQuery, filteredItems } = usePanelSearch(items, filterFn);
 * ```
 */

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

export { useBackdropClick } from './useBackdropClick';
export { useDelayedFocus } from './useDelayedFocus';
export { usePanelClose } from './usePanelClose';
export { usePanelSearch } from './usePanelSearch';
export { useObsidianComponent } from './useObsidianComponent';

// ============================================================================
// REDUX HOOKS
// ============================================================================

export * from './useRedux';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { RefObject } from 'react';

/**
 * Return type for useBackdropClick hook.
 */
export type BackdropClickRef<T extends HTMLElement> = RefObject<T>;

/**
 * Configuration for usePanelSearch hook.
 */
export interface PanelSearchConfig<T> {
    items: T[];
    filterFn: (item: T, query: string) => boolean;
    debounceMs?: number;
}

/**
 * Return type for usePanelSearch hook.
 */
export interface PanelSearchResult<T> {
    query: string;
    setQuery: (query: string) => void;
    filteredItems: T[];
    isSearching: boolean;
}
