/**
 * Shared Components Module
 *
 * This module provides shared/utility components used across the UI.
 * These components handle common display patterns like text highlighting and virtualization.
 *
 * @module ui/components/shared
 *
 * ## Components
 *
 * - **HighlightedText**: Text component with search term highlighting
 * - **VirtualizedDiff**: Virtualized diff view for large diffs
 * - **VirtualizedPlaintext**: Virtualized text view for large content
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   HighlightedText,
 *   VirtualizedDiff,
 *   VirtualizedPlaintext
 * } from '@/ui/components/shared';
 *
 * // Highlight search matches
 * <HighlightedText text={content} highlight={searchQuery} />
 *
 * // Virtualized diff for performance
 * <VirtualizedDiff changes={changes} height={400} />
 * ```
 */

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

export { HighlightedText } from './HighlightedText';
export { VirtualizedDiff } from './VirtualizedDiff';
export { VirtualizedPlaintext } from './VirtualizedPlaintext';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { Change } from '@/types';

/**
 * Props for HighlightedText component.
 */
export interface HighlightedTextProps {
    text: string;
    highlight: string;
    caseSensitive?: boolean;
    highlightClassName?: string;
}

/**
 * Props for virtualized components.
 */
export interface VirtualizedProps {
    height: number;
    width?: number | string;
    overscanCount?: number;
}

/**
 * Props for VirtualizedDiff component.
 */
export interface VirtualizedDiffProps extends VirtualizedProps {
    changes: Change[];
    showLineNumbers?: boolean;
}

/**
 * Props for VirtualizedPlaintext component.
 */
export interface VirtualizedPlaintextProps extends VirtualizedProps {
    content: string;
    showLineNumbers?: boolean;
    wrapLines?: boolean;
}
