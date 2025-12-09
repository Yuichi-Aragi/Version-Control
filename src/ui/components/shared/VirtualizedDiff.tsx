import { useMemo, type FC, type Ref, useEffect, useRef, useLayoutEffect } from 'react';
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso';
import type { Change, DiffType } from '../../../types';
import clsx from 'clsx';
import { HighlightedText } from './HighlightedText';

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

const CONTEXT_SIZE = 3;

const splitPartsToLines = (parts: Change[], targetType: 'add' | 'remove'): DiffLineSegment[][] => {
    const lines: DiffLineSegment[][] = [];
    let currentLineSegments: DiffLineSegment[] = [];

    for (const part of parts) {
        if (targetType === 'add' && part.removed) continue;
        if (targetType === 'remove' && part.added) continue;

        const type = part.added ? 'add' : part.removed ? 'remove' : 'unchanged';
        const values = part.value.split('\n');

        for (let i = 0; i < values.length; i++) {
            const val = values[i];
            if (val) {
                currentLineSegments.push({ text: val, type });
            }
            if (i < values.length - 1) {
                lines.push(currentLineSegments);
                currentLineSegments = [];
            }
        }
    }
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
        
        if (diffType === 'smart' && type === 'context' && part.count && part.count > (CONTEXT_SIZE * 2)) {
            const allLines = part.value.split('\n');
            if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
                allLines.pop();
            }

            const topContext = allLines.slice(0, CONTEXT_SIZE);
            const bottomContext = allLines.slice(allLines.length - CONTEXT_SIZE);
            
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

            lines.push({
                key: `${keyCounter++}`,
                type: 'collapsed',
                content: '',
                originalChangeIndex: changeIndex
            });
            
            const skippedCount = allLines.length - (CONTEXT_SIZE * 2);
            oldLineNum += skippedCount;
            newLineNum += skippedCount;

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

        let segmentLines: DiffLineSegment[][] | null = null;
        if (diffType === 'smart' && (part as any).parts && (type === 'add' || type === 'remove')) {
            segmentLines = splitPartsToLines((part as any).parts, type as 'add' | 'remove');
        }

        const partLines = part.value.split('\n');
        const lastIndex = partLines.length - 1;

        partLines.forEach((line, i) => {
            if (i === lastIndex && line === '') return;

            const lineData: DiffLineData = {
                key: `${keyCounter++}`,
                type,
                content: line,
                originalChangeIndex: changeIndex,
            };

            if (segmentLines && segmentLines[i]) {
                lineData.segments = segmentLines[i];
            }

            if (type !== 'add') lineData.oldLineNum = oldLineNum++;
            if (type !== 'remove') lineData.newLineNum = newLineNum++;

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

export const DiffLine: FC<DiffLineProps> = ({ 
    data, 
    isHighlighted, 
    searchQuery, 
    isCaseSensitive, 
    isTargetLine, 
    targetMatchIndexInLine, 
    onClick 
}) => {
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
                                <HighlightedText 
                                    text={seg.text} 
                                    {...(searchQuery && { query: searchQuery })}
                                    {...(isCaseSensitive !== undefined && { caseSensitive: isCaseSensitive })}
                                    activeMatchIndex={isTargetLine ? targetMatchIndexInLine : -1}
                                />
                            </span>
                        ))
                    ) : (
                        <HighlightedText 
                            text={data.content || '\u00A0'} 
                            {...(searchQuery && { query: searchQuery })}
                            {...(isCaseSensitive !== undefined && { caseSensitive: isCaseSensitive })}
                            activeMatchIndex={isTargetLine ? targetMatchIndexInLine : -1}
                        />
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

const LineDiffViewer: FC<LineDiffViewerProps> = ({ 
    changes, 
    diffType, 
    virtuosoHandleRef, 
    setVirtuosoScrollerRef, 
    highlightedIndex, 
    searchQuery, 
    isCaseSensitive, 
    activeMatchInfo, 
    onLineClick, 
    onRangeChanged 
}) => {
    const lines = useMemo(() => processLineChanges(changes, diffType), [changes, diffType]);
    
    return (
        <Virtuoso
            {...(virtuosoHandleRef && { ref: virtuosoHandleRef })}
            {...(setVirtuosoScrollerRef && { scrollerRef: setVirtuosoScrollerRef })}
            className="v-virtuoso-container"
            data={lines}
            {...(onRangeChanged && { rangeChanged: onRangeChanged })}
            itemContent={(index, data) => (
                <DiffLine 
                    data={data}
                    isHighlighted={index === highlightedIndex}
                    {...(searchQuery && { searchQuery })}
                    {...(isCaseSensitive !== undefined && { isCaseSensitive })}
                    isTargetLine={activeMatchInfo?.lineIndex === index}
                    targetMatchIndexInLine={activeMatchInfo?.lineIndex === index ? activeMatchInfo.matchIndexInLine : -1}
                    {...(onLineClick && { onClick: onLineClick })}
                />
            )}
        />
    );
};

export const StaticDiff: FC<{
    changes: Change[];
    diffType: DiffType;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
    onLineClick?: (lineData: DiffLineData) => void;
}> = ({
    changes,
    diffType,
    searchQuery,
    isCaseSensitive,
    activeMatchInfo,
    onLineClick
}) => {
    const lines = useMemo(() => processLineChanges(changes, diffType), [changes, diffType]);
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (activeMatchInfo && containerRef.current) {
            const targetLine = containerRef.current.children[activeMatchInfo.lineIndex];
            if (targetLine) {
                targetLine.scrollIntoView({ block: 'center', behavior: 'auto' });
            }
        }
    }, [activeMatchInfo]);

    return (
        <div className="v-static-diff-container" ref={containerRef} style={{ height: '100%', overflowY: 'auto' }}>
            {lines.map((data, index) => (
                <DiffLine 
                    key={data.key}
                    data={data}
                    isHighlighted={activeMatchInfo?.lineIndex === index}
                    {...(searchQuery && { searchQuery })}
                    {...(isCaseSensitive && { isCaseSensitive })}
                    isTargetLine={activeMatchInfo?.lineIndex === index}
                    targetMatchIndexInLine={activeMatchInfo?.lineIndex === index ? activeMatchInfo.matchIndexInLine : -1}
                    {...(onLineClick && { onClick: onLineClick })}
                />
            ))}
        </div>
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
                    <HighlightedText 
                        text={part.value} 
                        {...(searchQuery && { query: searchQuery })}
                        {...(isCaseSensitive !== undefined && { caseSensitive: isCaseSensitive })}
                    />
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
}> = (props) => {
    const { diffType, unifiedViewContainerRef, activeUnifiedMatchIndex } = props;
    
    useEffect(() => {
        if (diffType !== 'lines' && diffType !== 'smart' && unifiedViewContainerRef && 'current' in unifiedViewContainerRef && unifiedViewContainerRef.current) {
            const marks = unifiedViewContainerRef.current.querySelectorAll('mark');
            marks.forEach((mark, index) => {
                mark.classList.toggle('is-active-match', index === activeUnifiedMatchIndex);
            });
        }
    }, [activeUnifiedMatchIndex, diffType, unifiedViewContainerRef, props.changes, props.searchQuery]);

    switch (diffType) {
        case 'lines':
        case 'smart':
            return <LineDiffViewer {...props} />;
        case 'words':
        case 'chars':
            return <UnifiedDiffViewer 
                changes={props.changes} 
                {...(props.searchQuery && { searchQuery: props.searchQuery })}
                {...(props.isCaseSensitive !== undefined && { isCaseSensitive: props.isCaseSensitive })}
                {...(unifiedViewContainerRef && { unifiedViewContainerRef })}
            />;
        default:
            return <LineDiffViewer {...props} diffType="lines" />;
    }
};
VirtualizedDiff.displayName = 'VirtualizedDiff';
