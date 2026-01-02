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
            
            if (targetType === 'add' && part.removed) continue;
            if (targetType === 'remove' && part.added) continue;

            const type = part.added ? 'add' : part.removed ? 'remove' : 'unchanged';
            const values = part.value.split('\n');

            for (let i = 0; i < values.length; i++) {
                const val = values[i];
                
                if (isString(val) && val !== '') {
                    currentLineSegments.push({ text: val, type });
                }
                
                if (i < values.length - 1) {
                    if (currentLineSegments.length > 0) {
                        lines.push(currentLineSegments);
                        currentLineSegments = [];
                    }
                }
            }
        }
        
        if (currentLineSegments.length > 0) {
            lines.push(currentLineSegments);
        }
        
        return lines;
    },
    (parts: readonly Change[], targetType: string) => 
        `${JSON.stringify(parts)}-${targetType}`
);

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

        const pushLine = (
            content: string,
            type: DiffLineType,
            originalChangeIndex: number,
            segments?: readonly DiffLineSegment[],
            isModified: boolean = false
        ): void => {
            
            let currentOldLineNum: number | undefined;
            let currentNewLineNum: number | undefined;

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
                    break;
            }

            const lineData: DiffLineData = {
                key: `line-${keyCounter++}`,
                index: linearIndex++,
                type,
                content,
                originalChangeIndex,
                segments,
                ...(isModified ? { isModified: true } : {}),
                oldLineNum: currentOldLineNum,
                newLineNum: currentNewLineNum,
            };

            lines.push(lineData);
        };

        for (const [changeIndex, part] of changes.entries()) {
            const type = part.added ? 'add' as const : 
                        part.removed ? 'remove' as const : 
                        'context' as const;

            // Handle collapsed context ONLY for Smart diff
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
                
                topContext.forEach(line => {
                    pushLine(line, 'context', changeIndex);
                });
                
                pushLine('', 'collapsed', changeIndex);
                
                const skippedCount = allLines.length - (CONTEXT_SIZE * 2);
                oldLineNum += clamp(skippedCount, 0, Infinity);
                newLineNum += clamp(skippedCount, 0, Infinity);

                bottomContext.forEach(line => {
                    pushLine(line, 'context', changeIndex);
                });
                
                continue;
            }

            // Handle intra-line segments for all modes if present
            let segmentLines: readonly (readonly DiffLineSegment[])[] | null = null;
            const smartPart = part as Change & { parts?: readonly Change[] };
            
            if (
                Array.isArray(smartPart.parts) && 
                (type === 'add' || type === 'remove')
            ) {
                segmentLines = splitPartsToLines(smartPart.parts, type);
            }

            const partLines = part.value.split('\n');
            const lastIndex = partLines.length - 1;

            partLines.forEach((line, i) => {
                if (i === lastIndex && line === '' && partLines.length > 1) return;

                const segments = segmentLines && segmentLines[i] ? segmentLines[i] : undefined;
                
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
    (changes: readonly Change[], diffType?: string) => 
        `${JSON.stringify(changes)}-${diffType ?? 'lines'}`
);

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
                flushBuffers();
                rows.push({
                    key: `sbs-${keyCounter++}`,
                    left: line,
                    right: line,
                    rowIndex: rowIndex++
                });
            }
        }
        
        flushBuffers();

        return rows;
    },
    (linearLines: readonly DiffLineData[]) => JSON.stringify(linearLines)
);

export const processDiffData = (
    changes: readonly Change[] | undefined,
    lines: readonly DiffLineData[] | undefined,
    diffType: DiffType,
    viewLayout: 'split' | 'unified'
): ProcessedDiffData => {
    invariant(
        !(isNotNil(changes) && isNotNil(lines)),
        'Cannot provide both changes and lines. Use one or the other.'
    );
    
    invariant(
        isNotNil(changes) || isNotNil(lines),
        'Must provide either changes or lines'
    );

    const linearLines = Array.isArray(lines) 
        ? lines
        : Array.isArray(changes)
        ? processLineChanges(changes, diffType)
        : [];

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
