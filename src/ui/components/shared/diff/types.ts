import type { Change, DiffType } from '@/types';

// ============================================================================
// CORE DATA STRUCTURES
// ============================================================================

export type DiffLineType = 'add' | 'remove' | 'context' | 'collapsed';
export type DisplayMode = 'unified' | 'left' | 'right';

export interface DiffLineSegment {
    readonly text: string;
    readonly type: 'add' | 'remove' | 'unchanged';
}

export interface DiffLineData {
    readonly key: string;
    readonly index: number; // Index in the linear array of lines (0-based, immutable)
    readonly type: DiffLineType;
    readonly oldLineNum?: number | undefined;
    readonly newLineNum?: number | undefined;
    readonly content: string;
    readonly originalChangeIndex: number;
    readonly segments?: readonly DiffLineSegment[] | undefined;
    readonly isModified?: boolean; // Whether line has both add/remove segments (smart diff)
}

export interface SideBySideRowData {
    readonly key: string;
    readonly left?: DiffLineData | undefined;
    readonly right?: DiffLineData | undefined;
    readonly rowIndex: number;
}

export interface ProcessedDiffData {
    readonly linearLines: readonly DiffLineData[];
    readonly splitRows: readonly SideBySideRowData[];
    readonly totalLines: number;
    readonly totalRows: number;
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export interface VirtualizedProps {
    readonly height?: number | string | undefined;
    readonly width?: number | string | undefined;
    readonly overscanCount?: number | undefined;
    readonly className?: string | undefined;
}

export interface BaseDiffProps {
    readonly changes?: readonly Change[] | undefined;
    readonly lines?: readonly DiffLineData[] | undefined;
    readonly diffType: DiffType;
    readonly viewLayout?: 'split' | 'unified' | undefined;
    readonly searchQuery?: string | undefined;
    readonly isCaseSensitive?: boolean | undefined;
    readonly activeMatchInfo?: { 
        readonly lineIndex: number; 
        readonly matchIndexInLine: number;
    } | null | undefined;
    readonly onLineClick?: ((lineData: DiffLineData) => void) | undefined;
    readonly className?: string | undefined;
}
