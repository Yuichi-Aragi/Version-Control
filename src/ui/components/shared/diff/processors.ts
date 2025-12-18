import { isString, isNotNil, clamp } from 'es-toolkit';
import type { Change, DiffType } from '@/types';
import type { 
    DiffLineData, 
    DiffLineSegment, 
    DiffLineType, 
    ProcessedDiffData, 
    SideBySideRowData 
} from './types';
import { CONTEXT_SIZE } from './constants';
import { validateChange, validateChanges, validateDiffType, invariant } from './utils';

/**
 * Simple, strictly typed memoization helper.
 * Used to avoid signature mismatches with external libraries and ensure
 * correct caching behavior for multi-argument functions.
 */
function memoize<T extends (...args: any[]) => any>(
    fn: T,
    resolver: (...args: Parameters<T>) => string
): T {
    const cache = new Map<string, ReturnType<T>>();
    return ((...args: Parameters<T>): ReturnType<T> => {
        const key = resolver(...args);
        if (cache.has(key)) {
            return cache.get(key)!;
        }
        const result = fn(...args);
        cache.set(key, result);
        return result;
    }) as T;
}

/**
 * Splits a list of Change parts into line segments for intra-line highlighting.
 */
export const splitPartsToLines = memoize(
    (
        parts: readonly Change[],
        targetType: 'add' | 'remove'
    ): readonly (readonly DiffLineSegment[])[] => {
        invariant(Array.isArray(parts), 'Parts must be an array');
        
        const lines: DiffLineSegment[][] = [];
        let currentLineSegments: DiffLineSegment[] = [];

        for (const part of parts) {
            validateChange(part);
            
            // Skip parts that don't match target type
            if (targetType === 'add' && part.removed) continue;
            if (targetType === 'remove' && part.added) continue;

            const type = part.added ? 'add' : part.removed ? 'remove' : 'unchanged';
            const values = part.value.split('\n');

            for (let i = 0; i < values.length; i++) {
                const val = values[i];
                
                // Empty strings from split are only added for non-empty content
                if (isString(val) && val !== '') {
                    currentLineSegments.push({ text: val, type });
                }
                
                // If we hit a newline (except the last split), finalize current line
                if (i < values.length - 1) {
                    if (currentLineSegments.length > 0) {
                        lines.push(currentLineSegments);
                        currentLineSegments = [];
                    }
                }
            }
        }
        
        // Flush remaining segments
        if (currentLineSegments.length > 0) {
            lines.push(currentLineSegments);
        }
        
        return lines;
    },
    (parts: readonly Change[], targetType: string) => 
        `${JSON.stringify(parts)}-${targetType}`
);

/**
 * Processes raw Change objects into a linear list of lines (Unified view structure).
 */
export const processLineChanges = memoize(
    (
        changes: readonly Change[],
        diffType: DiffType = 'lines'
    ): readonly DiffLineData[] => {
        validateChanges(changes);
        validateDiffType(diffType);
        
        const lines: DiffLineData[] = [];
        let oldLineNum = 1;
        let newLineNum = 1;
        let keyCounter = 0;
        let linearIndex = 0;

        /**
         * Helper to push a line with proper type safety and line numbering
         */
        const pushLine = (
            content: string,
            type: DiffLineType,
            originalChangeIndex: number,
            segments?: readonly DiffLineSegment[],
            isModified: boolean = false
        ): void => {
            
            let currentOldLineNum: number | undefined;
            let currentNewLineNum: number | undefined;

            // Calculate line numbers before object creation to satisfy readonly
            switch (type) {
                case 'add':
                    currentNewLineNum = newLineNum++;
                    break;
                case 'remove':
                    currentOldLineNum = oldLineNum++;
                    break;
                case 'context':
                    currentOldLineNum = oldLineNum++;
                    currentNewLineNum = newLineNum++;
                    break;
                case 'collapsed':
                    // Collapsed lines don't affect line numbers
                    break;
            }

            const lineData: DiffLineData = {
                key: `line-${keyCounter++}`,
                index: linearIndex++,
                type,
                content,
                originalChangeIndex,
                segments,
                // Use conditional spread to satisfy exactOptionalPropertyTypes
                ...(isModified ? { isModified: true } : {}),
                oldLineNum: currentOldLineNum,
                newLineNum: currentNewLineNum,
            };

            lines.push(lineData);
        };

        // Handle word/char diffs (stream processing)
        if (diffType === 'words' || diffType === 'chars') {
            let currentSegments: DiffLineSegment[] = [];
            let hasAdd = false;
            let hasRemove = false;

            for (const [changeIndex, part] of changes.entries()) {
                const type = part.added ? 'add' : part.removed ? 'remove' : 'unchanged';
                const values = part.value.split('\n');

                for (let i = 0; i < values.length; i++) {
                    const val = values[i];
                    
                    if (isString(val) && val !== '') {
                        currentSegments.push({ text: val, type });
                        
                        // Track what types we have in this line
                        if (type === 'add') hasAdd = true;
                        else if (type === 'remove') hasRemove = true;
                    }

                    // Handle newline (end of line)
                    if (i < values.length - 1) {
                        // Determine line type based on segment composition
                        let lineType: DiffLineType;
                        if (hasAdd && hasRemove) {
                            lineType = 'context';
                        } else if (hasAdd && !hasRemove) {
                            lineType = 'add';
                        } else if (hasRemove && !hasAdd) {
                            lineType = 'remove';
                        } else {
                            lineType = 'context';
                        }

                        const content = currentSegments.map(s => s.text).join('');
                        const isModified = hasAdd && hasRemove;
                        
                        pushLine(
                            content,
                            lineType,
                            changeIndex,
                            [...currentSegments],
                            isModified
                        );
                        
                        // Reset for next line
                        currentSegments = [];
                        hasAdd = false;
                        hasRemove = false;
                    }
                }
            }

            // Process any remaining segments
            if (currentSegments.length > 0) {
                let lineType: DiffLineType;
                if (hasAdd && hasRemove) {
                    lineType = 'context';
                } else if (hasAdd && !hasRemove) {
                    lineType = 'add';
                } else if (hasRemove && !hasAdd) {
                    lineType = 'remove';
                } else {
                    lineType = 'context';
                }

                const content = currentSegments.map(s => s.text).join('');
                const isModified = hasAdd && hasRemove;
                
                pushLine(
                    content,
                    lineType,
                    changes.length - 1,
                    [...currentSegments],
                    isModified
                );
            }

            return lines;
        }

        // Handle line and smart diffs
        for (const [changeIndex, part] of changes.entries()) {
            const type = part.added ? 'add' as const : 
                        part.removed ? 'remove' as const : 
                        'context' as const;

            // Handle collapsed context for Smart diff
            if (
                diffType === 'smart' && 
                type === 'context' && 
                typeof part.count === 'number' && 
                part.count > (CONTEXT_SIZE * 2)
            ) {
                const allLines = part.value.split('\n').filter(line => 
                    isString(line) && line !== ''
                );
                
                if (allLines.length === 0) continue;

                const topContext = allLines.slice(0, CONTEXT_SIZE);
                const bottomContext = allLines.slice(-CONTEXT_SIZE);
                
                // Add top context lines
                topContext.forEach(line => {
                    pushLine(line, 'context', changeIndex);
                });
                
                // Add collapsed line marker
                pushLine('', 'collapsed', changeIndex);
                
                // Adjust line numbers for skipped lines
                const skippedCount = allLines.length - (CONTEXT_SIZE * 2);
                oldLineNum += clamp(skippedCount, 0, Infinity);
                newLineNum += clamp(skippedCount, 0, Infinity);

                // Add bottom context lines
                bottomContext.forEach(line => {
                    pushLine(line, 'context', changeIndex);
                });
                
                continue;
            }

            // Handle smart diff with intra-line segments
            let segmentLines: readonly (readonly DiffLineSegment[])[] | null = null;
            const smartPart = part as Change & { parts?: readonly Change[] };
            
            if (
                diffType === 'smart' && 
                Array.isArray(smartPart.parts) && 
                (type === 'add' || type === 'remove')
            ) {
                segmentLines = splitPartsToLines(smartPart.parts, type);
            }

            const partLines = part.value.split('\n');
            const lastIndex = partLines.length - 1;

            partLines.forEach((line, i) => {
                // Skip empty last line that comes from trailing newline
                if (i === lastIndex && line === '' && partLines.length > 1) return;

                const segments = segmentLines && segmentLines[i] ? segmentLines[i] : undefined;
                
                // For smart diff with segments, determine if line is modified
                let isModified = false;
                if (Array.isArray(segments)) {
                    const hasAdd = segments.some(s => s.type === 'add');
                    const hasRemove = segments.some(s => s.type === 'remove');
                    isModified = hasAdd && hasRemove;
                }

                pushLine(
                    line,
                    type,
                    changeIndex,
                    segments,
                    isModified
                );
            });
        }

        return lines;
    },
    // Fix: Allow diffType to be optional/undefined in resolver to match function signature
    (changes: readonly Change[], diffType?: string) => 
        `${JSON.stringify(changes)}-${diffType ?? 'lines'}`
);

/**
 * Processes linear lines into side-by-side rows with perfect alignment.
 */
export const processSideBySideChanges = memoize(
    (
        linearLines: readonly DiffLineData[]
    ): readonly SideBySideRowData[] => {
        invariant(Array.isArray(linearLines), 'linearLines must be an array');
        
        const rows: SideBySideRowData[] = [];
        let rowIndex = 0;
        let keyCounter = 0;

        let removeBuffer: DiffLineData[] = [];
        let addBuffer: DiffLineData[] = [];

        /**
         * Flush buffers by pairing remove and add lines
         */
        const flushBuffers = (): void => {
            if (removeBuffer.length === 0 && addBuffer.length === 0) return;

            const maxLen = Math.max(removeBuffer.length, addBuffer.length);
            
            for (let i = 0; i < maxLen; i++) {
                rows.push({
                    key: `sbs-${keyCounter++}`,
                    left: removeBuffer[i],
                    right: addBuffer[i],
                    rowIndex: rowIndex++
                });
            }
            
            removeBuffer = [];
            addBuffer = [];
        };

        for (const line of linearLines) {
            const shouldBeContext = 
                line.type === 'context' || 
                line.type === 'collapsed' ||
                (isNotNil(line.isModified) && line.isModified === true);
            
            if (shouldBeContext) {
                flushBuffers();
                rows.push({
                    key: `sbs-${keyCounter++}`,
                    left: line,
                    right: line,
                    rowIndex: rowIndex++
                });
            } else if (line.type === 'remove') {
                removeBuffer.push(line);
            } else if (line.type === 'add') {
                addBuffer.push(line);
            } else {
                // Safety fallback: treat as context
                flushBuffers();
                rows.push({
                    key: `sbs-${keyCounter++}`,
                    left: line,
                    right: line,
                    rowIndex: rowIndex++
                });
            }
        }
        
        // Flush any remaining buffers
        flushBuffers();

        return rows;
    },
    (linearLines: readonly DiffLineData[]) => JSON.stringify(linearLines)
);

/**
 * Processes all diff data with memoization support
 */
export const processDiffData = (
    changes: readonly Change[] | undefined,
    lines: readonly DiffLineData[] | undefined,
    diffType: DiffType,
    viewLayout: 'split' | 'unified'
): ProcessedDiffData => {
    // Validate inputs
    invariant(
        !(isNotNil(changes) && isNotNil(lines)),
        'Cannot provide both changes and lines. Use one or the other.'
    );
    
    invariant(
        isNotNil(changes) || isNotNil(lines),
        'Must provide either changes or lines'
    );

    // Process linear lines
    const linearLines = Array.isArray(lines) 
        ? lines
        : Array.isArray(changes)
        ? processLineChanges(changes, diffType)
        : [];

    // Process side-by-side rows if needed
    const splitRows = viewLayout === 'split'
        ? processSideBySideChanges(linearLines)
        : [];

    return {
        linearLines,
        splitRows,
        totalLines: linearLines.length,
        totalRows: viewLayout === 'split' ? splitRows.length : linearLines.length,
    };
};
