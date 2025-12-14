/**
 * UI Contexts Module
 *
 * This module provides React contexts for dependency injection and shared state.
 *
 * @module ui/contexts
 *
 * ## Contexts
 *
 * - **TimeContext**: Provides current time updates for relative time displays
 *
 * ## Usage
 *
 * ```typescript
 * import { TimeProvider, useTime } from '@/ui/contexts';
 *
 * // Wrap components that need time updates
 * <TimeProvider>
 *   <HistoryList />
 * </TimeProvider>
 *
 * // Access current time in components
 * const now = useTime();
 * const relativeTime = formatRelativeTime(entry.timestamp, now);
 * ```
 */

// ============================================================================
// CONTEXT EXPORTS
// ============================================================================

export { TimeProvider, useTime } from './TimeContext';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Value provided by TimeContext.
 */
export type TimeContextValue = number;

/**
 * Props for TimeProvider component.
 */
export interface TimeProviderProps {
    children: React.ReactNode;
    updateInterval?: number;
}
