import { useMemo, type FC, Fragment, type Ref, useEffect } from 'react';
import { Virtuoso, type VirtuosoHandle, type VirtuosoProps, type ListRange } from 'react-virtuoso';
import type { Change } from 'diff';
import type { DiffType } from '../../../types';
import clsx from 'clsx';
import { escapeRegExp } from '../../utils/strings';

export interface DiffLineSegment {
    text: string;
    type: 'add' | 'remove' | 'unchanged';
}

export interface DiffLineData {
    key: string;
    type: 'add' | 'remove' | 'context' | 'collapsed';
    oldLineNum?: number;
    newLineNum?: number;
    content: string;
    originalChangeIndex: number;
    segments?: DiffLineSegment[];
}

const HighlightedText: FC<{ 
    text: string; 
    query: string; 
    caseSensitive: boolean;
    isTargetLine?: boolean;
    targetMatchIndexInLine?: number;
}> = ({ text, query, caseSensitive, isTargetLine, targetMatchIndexInLine }) => {
    if (!query.trim()) {
        return <>{text}</>;
    }
    
    try {
        const regex = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
        const parts = text.split(regex);
        const matches = text.match(regex);
    
        if (!matches) {
            return <>{text}</>;
        }
    
        return (
            <>
                {parts.map((part, i) => (
                     <Fragment key={i}>
                        {part}
                        {i < matches.length && (
                            <mark className={clsx({ 'is-active-match': isTargetLine && i === targetMatchIndexInLine })}>
                                {matches[i]}
                            </mark>
                        )}
                    </Fragment>
                ))}
            </>
        );
    } catch (e) {
        return <>{text}</>;
    }
};

const CONTEXT_SIZE = 3;

/**
 * Helper to split word diff parts into lines.
 * This is necessary because diffWordsWithSpace preserves newlines in the values.
 */
const splitPartsToLines = (parts: Change[], targetType: 'add' | 'remove'): DiffLineSegment[][] => {
    const lines: DiffLineSegment[][] = [];
    let currentLineSegments: DiffLineSegment[] = [];

    for (const part of parts) {
        // Filter: For 'add' lines, we only want 'added' and 'unchanged' parts.
        // For 'remove' lines, we only want 'removed' and 'unchanged' parts.
        if (targetType === 'add' && part.removed) continue;
        if (targetType === 'remove' && part.added) continue;

        const type = part.added ? 'add' : part.removed ? 'remove' : 'unchanged';
        const values = part.value.split('\n');

        for (let i = 0; i < values.length; i++) {
            const val = values[i];
            if (val) {
                currentLineSegments.push({ text: val, type });
            }
            
            // If there are more parts in the split, it means we hit a newline.
            // Push current line and start a new one.
            if (i < values.length - 1) {
                lines.push(currentLineSegments);
                currentLineSegments = [];
            }
        }
    }
    // Push the last line if it has content
    if (currentLineSegments.length > 0) {
        lines.push(currentLineSegments);
    }
    
    return lines;
};


export const processLineChanges = (changes: Change[], diffType: DiffType = 'lines'): DiffLineData[] => {
    const lines: DiffLineData[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let keyCounter = 0;

    for (const [changeIndex, part] of changes.entries()) {
        const type = part.added ? 'add' : part.removed ? 'remove' : 'context';
        
        // Context folding for Smart Diff
        if (diffType === 'smart' && type === 'context' && part.count && part.count > (CONTEXT_SIZE * 2)) {
            // Split the context block: keep top context, collapse middle, keep bottom context
            const allLines = part.value.split('\n');
            // Remove the last empty string from split if it exists
            if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
                allLines.pop();
            }

            const topContext = allLines.slice(0, CONTEXT_SIZE);
            const bottomContext = allLines.slice(allLines.length - CONTEXT_SIZE);
            
            // Add top context
            topContext.forEach(line => {
                lines.push({
                    key: `${keyCounter++}`,
                    type: 'context',
                    oldLineNum: oldLineNum++,
                    newLineNum: newLineNum++,
                    content: line,
                    originalChangeIndex: changeIndex
                });
            });

            // Add collapsed marker
            lines.push({
                key: `${keyCounter++}`,
                type: 'collapsed',
                content: '',
                originalChangeIndex: changeIndex
            });
            
            // Increment counters for the skipped lines
            const skippedCount = allLines.length - (CONTEXT_SIZE * 2);
            oldLineNum += skippedCount;
            newLineNum += skippedCount;

            // Add bottom context
            bottomContext.forEach(line => {
                lines.push({
                    key: `${keyCounter++}`,
                    type: 'context',
                    oldLineNum: oldLineNum++,
                    newLineNum: newLineNum++,
                    content: line,
                    originalChangeIndex: changeIndex
                });
            });
            
            continue;
        }

        // Standard processing or Smart Diff with parts
        let segmentLines: DiffLineSegment[][] | null = null;
        
        // If this is a smart diff and we have word-level parts attached
        if (diffType === 'smart' && (part as any).parts && (type === 'add' || type === 'remove')) {
            segmentLines = splitPartsToLines((part as any).parts, type as 'add' | 'remove');
        }

        const partLines = part.value.split('\n');
        const lastIndex = partLines.length - 1;

        partLines.forEach((line, i) => {
            if (i === lastIndex && line === '') {
                return;
            }

            const lineData: DiffLineData = {
                key: `${keyCounter++}`,
                type,
                content: line,
                originalChangeIndex: changeIndex,
            };

            if (segmentLines && segmentLines[i]) {
                lineData.segments = segmentLines[i];
            }

            if (type !== 'add') {
                lineData.oldLineNum = oldLineNum++;
            }
            if (type !== 'remove') {
                lineData.newLineNum = newLineNum++;
            }

            lines.push(lineData);
        });
    }
    return lines;
};

interface DiffLineProps {
    data: DiffLineData;
    isHighlighted: boolean;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    isTargetLine: boolean;
    targetMatchIndexInLine: number;
    onClick?: (lineData: DiffLineData) => void;
}

const DiffLine: FC<DiffLineProps> = ({ data, isHighlighted, searchQuery, isCaseSensitive, isTargetLine, targetMatchIndexInLine, onClick }) => {
    const handleClick = () => {
        if (onClick && data.type !== 'collapsed') {
            onClick(data);
        }
    };

    if (data.type === 'collapsed') {
        return (
            <div className="diff-line diff-collapsed">
                <div className="diff-line-gutter" aria-hidden="true"></div>
                <div className="diff-line-content">
                    <span className="diff-collapsed-marker">...</span>
                </div>
            </div>
        );
    }
    
    return (
        <div className={clsx('diff-line', `diff-${data.type}`, { 'is-scrolled-to': isHighlighted, 'is-clickable': !!onClick })} onClick={handleClick}>
            <div className="diff-line-gutter" aria-hidden="true">
                <span className="diff-line-num old">{data.oldLineNum ?? ''}</span>
                <span className="diff-line-num new">{data.newLineNum ?? ''}</span>
            </div>
            <div className="diff-line-content">
                <span className="diff-line-marker" aria-hidden="true">
                    {data.type === 'add' ? '+' : data.type === 'remove' ? '-' : ''}
                </span>
                <span className="diff-line-text">
                    {data.segments ? (
                        data.segments.map((seg, i) => (
                            <span key={i} className={clsx({
                                'diff-word-add': seg.type === 'add',
                                'diff-word-remove': seg.type === 'remove'
                            })}>
                                {searchQuery ? (
                                    <HighlightedText 
                                        text={seg.text} 
                                        query={searchQuery} 
                                        caseSensitive={isCaseSensitive ?? false}
                                        isTargetLine={isTargetLine}
                                        targetMatchIndexInLine={targetMatchIndexInLine}
                                    />
                                ) : (
                                    seg.text
                                )}
                            </span>
                        ))
                    ) : (
                        searchQuery ? (
                            <HighlightedText 
                                text={data.content || '\u00A0'} 
                                query={searchQuery} 
                                caseSensitive={isCaseSensitive ?? false}
                                isTargetLine={isTargetLine}
                                targetMatchIndexInLine={targetMatchIndexInLine}
                            />
                        ) : (
                            data.content || '\u00A0'
                        )
                    )}
                </span>
            </div>
        </div>
    );
};
DiffLine.displayName = 'DiffLine';

interface LineDiffViewerProps {
    changes: Change[];
    diffType: DiffType;
    virtuosoHandleRef?: Ref<VirtuosoHandle>;
    setVirtuosoScrollerRef?: (scroller: HTMLElement | Window | null) => void;
    highlightedIndex?: number | null;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
    onLineClick?: (lineData: DiffLineData) => void;
    onRangeChanged?: (range: ListRange) => void;
}

const LineDiffViewer: FC<LineDiffViewerProps> = ({ changes, diffType, virtuosoHandleRef, setVirtuosoScrollerRef, highlightedIndex, searchQuery, isCaseSensitive, activeMatchInfo, onLineClick, onRangeChanged }) => {
    const lines = useMemo(() => processLineChanges(changes, diffType), [changes, diffType]);
    
    const virtuosoProps: VirtuosoProps<DiffLineData, unknown> = {
        className: "v-virtuoso-container",
        data: lines,
        itemContent: (index, data) => {
            const isTargetLine = activeMatchInfo?.lineIndex === index;
            const targetMatchIndexInLine = isTargetLine ? activeMatchInfo.matchIndexInLine : -1;
            
            const diffLineProps: DiffLineProps = {
                data,
                isHighlighted: index === highlightedIndex,
                isTargetLine,
                targetMatchIndexInLine,
            };
            if (searchQuery !== undefined) {
                diffLineProps.searchQuery = searchQuery;
            }
            if (isCaseSensitive !== undefined) {
                diffLineProps.isCaseSensitive = isCaseSensitive;
            }
            if (onLineClick) {
                diffLineProps.onClick = onLineClick;
            }

            return <DiffLine {...diffLineProps} />;
        }
    };

    if (setVirtuosoScrollerRef) {
        virtuosoProps.scrollerRef = setVirtuosoScrollerRef;
    }

    if (onRangeChanged) {
        virtuosoProps.rangeChanged = onRangeChanged;
    }
    
    if (virtuosoHandleRef) {
        return (
            <Virtuoso
                ref={virtuosoHandleRef}
                {...virtuosoProps}
            />
        );
    }
    
    return (
        <Virtuoso
            {...virtuosoProps}
        />
    );
};

const UnifiedDiffViewer: FC<{ 
    changes: Change[]; 
    searchQuery?: string; 
    isCaseSensitive?: boolean;
    unifiedViewContainerRef?: Ref<HTMLPreElement>;
}> = ({ changes, searchQuery, isCaseSensitive, unifiedViewContainerRef }) => (
    <pre className="v-unified-diff-view" ref={unifiedViewContainerRef}>
        <code>
            {changes.map((part, index) => (
                <span
                    key={index}
                    data-change-index={index}
                    className={clsx({
                        'diff-add': part.added,
                        'diff-remove': part.removed,
                    })}
                >
                    {searchQuery ? (
                        <HighlightedText text={part.value} query={searchQuery} caseSensitive={isCaseSensitive ?? false} isTargetLine={false} targetMatchIndexInLine={-1} />
                    ) : (
                        part.value
                    )}
                </span>
            ))}
        </code>
    </pre>
);

export const VirtualizedDiff: FC<{
    changes: Change[];
    diffType: DiffType;
    virtuosoHandleRef?: Ref<VirtuosoHandle>;
    setVirtuosoScrollerRef?: (scroller: HTMLElement | Window | null) => void;
    unifiedViewContainerRef?: Ref<HTMLPreElement>;
    highlightedIndex?: number | null;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
    activeUnifiedMatchIndex: number;
    onLineClick?: (lineData: DiffLineData) => void;
    onRangeChanged?: (range: ListRange) => void;
}> = ({ changes, diffType, virtuosoHandleRef, setVirtuosoScrollerRef, unifiedViewContainerRef, highlightedIndex, searchQuery, isCaseSensitive, activeMatchInfo, activeUnifiedMatchIndex, onLineClick, onRangeChanged }) => {
    
    useEffect(() => {
        if (diffType !== 'lines' && diffType !== 'smart' && unifiedViewContainerRef && 'current' in unifiedViewContainerRef && unifiedViewContainerRef.current) {
            const marks = unifiedViewContainerRef.current.querySelectorAll('mark');
            marks.forEach((mark, index) => {
                mark.classList.toggle('is-active-match', index === activeUnifiedMatchIndex);
            });
        }
    }, [activeUnifiedMatchIndex, diffType, unifiedViewContainerRef, changes, searchQuery]);

    const commonProps: { searchQuery?: string; isCaseSensitive?: boolean } = {};
    if (searchQuery !== undefined) commonProps.searchQuery = searchQuery;
    if (isCaseSensitive !== undefined) commonProps.isCaseSensitive = isCaseSensitive;

    switch (diffType) {
        case 'lines':
        case 'smart': {
            const lineViewerProps: LineDiffViewerProps = {
                changes,
                diffType,
                activeMatchInfo,
                ...commonProps,
            };
            if (virtuosoHandleRef !== undefined) {
                lineViewerProps.virtuosoHandleRef = virtuosoHandleRef;
            }
            if (setVirtuosoScrollerRef !== undefined) {
                lineViewerProps.setVirtuosoScrollerRef = setVirtuosoScrollerRef;
            }
            if (highlightedIndex !== undefined) {
                lineViewerProps.highlightedIndex = highlightedIndex;
            }
            if (onLineClick !== undefined) {
                lineViewerProps.onLineClick = onLineClick;
            }
            if (onRangeChanged !== undefined) {
                lineViewerProps.onRangeChanged = onRangeChanged;
            }
            return <LineDiffViewer {...lineViewerProps} />;
        }
        case 'words':
        case 'chars': {
            const unifiedViewerProps: React.ComponentProps<typeof UnifiedDiffViewer> = {
                changes,
                ...commonProps,
            };
            if (unifiedViewContainerRef) {
                unifiedViewerProps.unifiedViewContainerRef = unifiedViewContainerRef;
            }
            return <UnifiedDiffViewer {...unifiedViewerProps} />;
        }
        default: {
            // Fallback to lines if something unexpected happens
            const lineViewerProps: LineDiffViewerProps = {
                changes,
                diffType: 'lines',
                activeMatchInfo,
                ...commonProps,
            };
            return <LineDiffViewer {...lineViewerProps} />;
        }
    }
};
VirtualizedDiff.displayName = 'VirtualizedDiff';
