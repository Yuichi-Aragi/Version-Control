/**
 * Services Module
 *
 * Exports services for timeline event processing, statistics calculation,
 * and timeline building.
 */

export { processContentDiff, computeOptimizedDiff } from './event-processor';
export { calculateStats } from './stats-calculator';
export { generateAndStoreTimelineEvent } from './timeline-builder';
