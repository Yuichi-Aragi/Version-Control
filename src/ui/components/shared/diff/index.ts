import { 
    processLineChanges, 
    processSideBySideChanges 
} from './processors';
import { 
    validateChange, 
    validateChanges, 
    validateDiffType, 
    escapeRegExp, 
    invariant 
} from './utils';

// Re-export components
export { VirtualizedDiff, type VirtualizedDiffProps } from './VirtualizedDiff';
export { StaticDiff, type StaticDiffProps } from './StaticDiff';
export { DiffLine } from './DiffLine';

// Re-export types
export * from './types';

// Re-export processors directly for consumers
export { processLineChanges, processSideBySideChanges } from './processors';

// Export utilities namespace for testing and advanced use
export const DiffUtils = {
    processLineChanges,
    processSideBySideChanges,
    validateChange,
    validateChanges,
    validateDiffType,
    escapeRegExp,
    invariant,
} as const;
