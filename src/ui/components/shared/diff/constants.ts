import type { DiffLineType } from './types';

export const CONTEXT_SIZE = 3 as const;
export const DEFAULT_OVERSCAN_COUNT = 10 as const;
export const DEFAULT_HEIGHT = '100%' as const;
export const DEFAULT_WIDTH = '100%' as const;

export const LINE_TYPE_CLASSES: Record<DiffLineType, string> = {
    add: 'diff-add',
    remove: 'diff-remove',
    context: 'diff-context',
    collapsed: 'diff-collapsed',
} as const;
