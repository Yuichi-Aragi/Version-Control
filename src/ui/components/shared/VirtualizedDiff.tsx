import { useMemo, type FC, Fragment, type Ref, useEffect } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { Change } from 'diff';
import type { DiffType } from '../../../types';
import clsx from 'clsx';

export interface DiffLineData {
    key: string;
    type: 'add' | 'remove' | 'context';
    oldLineNum?: number;
    newLineNum?: number;
    content: string;
}

const escapeRegExp = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

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

export const processLineChanges = (changes: Change[]): DiffLineData[] => {
    const lines: DiffLineData[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let keyCounter = 0;

    for (const part of changes) {
        const type = part.added ? 'add' : part.removed ? 'remove' : 'context';
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
            };

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
        if (onClick) {
            onClick(data);
        }
    };
    
    return (
        <div className={clsx('diff-line', `diff-${data.type}`, { 'is-scrolled-to': isHighlighted, 'is-clickable': !!onClick })} onClick={handleClick}>
            <div className="diff-line-gutter">
                <span className="diff-line-num old">{data.oldLineNum ?? ''}</span>
                <span className="diff-line-num new">{data.newLineNum ?? ''}</span>
            </div>
            <span className="diff-line-prefix">
                {data.type === 'add' ? '+' : data.type === 'remove' ? '-' : '\u00A0'}
            </span>
            <span className="diff-line-content">
                {searchQuery ? (
                    <HighlightedText 
                        text={data.content || '\u00A0'} 
                        query={searchQuery} 
                        caseSensitive={isCaseSensitive ?? false}
                        isTargetLine={isTargetLine}
                        targetMatchIndexInLine={targetMatchIndexInLine}
                    />
                ) : (
                    data.content || '\u00A0'
                )}
            </span>
        </div>
    );
};
DiffLine.displayName = 'DiffLine';

interface LineDiffViewerProps {
    changes: Change[];
    scrollerRef?: Ref<VirtuosoHandle>;
    highlightedIndex?: number | null;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
    onLineClick?: (lineData: DiffLineData) => void;
}

const LineDiffViewer: FC<LineDiffViewerProps> = ({ changes, scrollerRef, highlightedIndex, searchQuery, isCaseSensitive, activeMatchInfo, onLineClick }) => {
    const lines = useMemo(() => processLineChanges(changes), [changes]);
    
    // Create a props object for Virtuoso
    const virtuosoProps: {
        className: string;
        data: DiffLineData[];
        itemContent: (index: number, data: DiffLineData) => React.ReactElement;
    } = {
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
    
    // Only add ref if it's defined
    if (scrollerRef !== undefined) {
        return (
            <Virtuoso
                ref={scrollerRef}
                {...virtuosoProps}
            />
        );
    }
    
    return <Virtuoso {...virtuosoProps} />;
};

const UnifiedDiffViewer: FC<{ 
    changes: Change[]; 
    searchQuery?: string; 
    isCaseSensitive?: boolean;
    unifiedViewRef?: Ref<HTMLPreElement>;
}> = ({ changes, searchQuery, isCaseSensitive, unifiedViewRef }) => (
    <pre className="v-unified-diff-view" ref={unifiedViewRef}>
        <code>
            {changes.map((part, index) => (
                <span
                    key={index}
                    className={clsx({
                        'diff-add': part.added,
                        'diff-remove': part.removed,
                    })}
                >
                    {searchQuery ? (
                        <HighlightedText text={part.value} query={searchQuery} caseSensitive={isCaseSensitive ?? false} />
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
    scrollerRef?: Ref<VirtuosoHandle>;
    unifiedViewRef?: Ref<HTMLPreElement>;
    highlightedIndex?: number | null;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
    activeUnifiedMatchIndex: number;
    onLineClick?: (lineData: DiffLineData) => void;
}> = ({ changes, diffType, scrollerRef, unifiedViewRef, highlightedIndex, searchQuery, isCaseSensitive, activeMatchInfo, activeUnifiedMatchIndex, onLineClick }) => {
    
    useEffect(() => {
        if (diffType !== 'lines' && unifiedViewRef && 'current' in unifiedViewRef && unifiedViewRef.current) {
            const marks = unifiedViewRef.current.querySelectorAll('mark');
            marks.forEach((mark, index) => {
                mark.classList.toggle('is-active-match', index === activeUnifiedMatchIndex);
            });
        }
    }, [activeUnifiedMatchIndex, diffType, unifiedViewRef, changes, searchQuery]);

    const commonProps: { searchQuery?: string; isCaseSensitive?: boolean } = {};
    if (searchQuery !== undefined) commonProps.searchQuery = searchQuery;
    if (isCaseSensitive !== undefined) commonProps.isCaseSensitive = isCaseSensitive;

    switch (diffType) {
        case 'lines': {
            const lineViewerProps: LineDiffViewerProps = {
                changes,
                activeMatchInfo,
                ...commonProps,
            };
            if (scrollerRef) {
                lineViewerProps.scrollerRef = scrollerRef;
            }
            if (highlightedIndex !== undefined) {
                lineViewerProps.highlightedIndex = highlightedIndex;
            }
            if (onLineClick) {
                lineViewerProps.onLineClick = onLineClick;
            }
            return <LineDiffViewer {...lineViewerProps} />;
        }
        case 'words':
        case 'chars':
        case 'json': {
            const unifiedViewerProps: React.ComponentProps<typeof UnifiedDiffViewer> = {
                changes,
                ...commonProps,
            };
            if (unifiedViewRef) {
                unifiedViewerProps.unifiedViewRef = unifiedViewRef;
            }
            return <UnifiedDiffViewer {...unifiedViewerProps} />;
        }
        default: {
            const lineViewerProps: LineDiffViewerProps = {
                changes,
                activeMatchInfo,
                ...commonProps,
            };
            if (scrollerRef) {
                lineViewerProps.scrollerRef = scrollerRef;
            }
            if (highlightedIndex !== undefined) {
                lineViewerProps.highlightedIndex = highlightedIndex;
            }
            if (onLineClick) {
                lineViewerProps.onLineClick = onLineClick;
            }
            return <LineDiffViewer {...lineViewerProps} />;
        }
    }
};
VirtualizedDiff.displayName = 'VirtualizedDiff';
