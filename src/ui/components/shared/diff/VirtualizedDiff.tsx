import {
    useMemo,
    useCallback,
    useEffect,
    type FC,
    type Ref,
    type ComponentType,
} from 'react';
import {
    Virtuoso,
    type VirtuosoHandle,
    type ListRange,
    type ScrollSeekPlaceholderProps,
    type ContextProp,
    type VirtuosoProps,
} from 'react-virtuoso';
import clsx from 'clsx';
import { isNotNil } from 'es-toolkit';
import type { DiffLineData, VirtualizedProps, BaseDiffProps, SideBySideRowData } from './types';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, DEFAULT_OVERSCAN_COUNT } from './constants';
import { validateChanges, validateDiffType, invariant } from './utils';
import { processDiffData } from './processors';
import { DiffLine } from './DiffLine';

export interface VirtualizedDiffProps extends VirtualizedProps, BaseDiffProps {
    readonly virtuosoHandleRef?: Ref<VirtuosoHandle> | undefined;
    readonly setVirtuosoScrollerRef?: ((scroller: HTMLElement | Window | null) => void) | undefined;
    readonly highlightedIndex?: number | null | undefined;
    readonly onRangeChanged?: ((range: ListRange) => void) | undefined;
    readonly initialTopMostItemIndex?: number | undefined;
    readonly scrollSeekConfiguration?: ComponentType<ScrollSeekPlaceholderProps & ContextProp<unknown>> | undefined;
    
    // Deprecated: kept for backward compatibility only
    readonly activeUnifiedMatchIndex?: number | undefined;
}

export const VirtualizedDiff: FC<VirtualizedDiffProps> = ({
    changes,
    lines,
    diffType,
    viewLayout = 'unified',
    virtuosoHandleRef,
    setVirtuosoScrollerRef,
    highlightedIndex,
    searchQuery,
    isCaseSensitive = false,
    activeMatchInfo,
    onLineClick,
    onRangeChanged,
    height = DEFAULT_HEIGHT,
    width = DEFAULT_WIDTH,
    overscanCount = DEFAULT_OVERSCAN_COUNT,
    className,
    initialTopMostItemIndex,
    scrollSeekConfiguration,
}) => {
    // Validate props
    useEffect(() => {
        validateDiffType(diffType);
        
        if (Array.isArray(changes)) {
            validateChanges(changes);
        }
        
        if (Array.isArray(lines)) {
            invariant(Array.isArray(lines), 'lines must be an array');
        }
    }, [changes, lines, diffType]);

    // Process diff data with memoization
    const processedData = useMemo(() => {
        return processDiffData(changes, lines, diffType, viewLayout);
    }, [changes, lines, diffType, viewLayout]);

    // Memoize range change handler
    const handleRangeChanged = useCallback((range: ListRange) => {
        if (isNotNil(onRangeChanged)) {
            onRangeChanged(range);
        }
    }, [onRangeChanged]);

    // Memoize line click handler
    const handleLineClick = useCallback((lineData: DiffLineData) => {
        if (isNotNil(onLineClick)) {
            onLineClick(lineData);
        }
    }, [onLineClick]);

    // Container styling
    const containerClass = clsx(
        'v-virtuoso-container',
        className,
        {
            'v-diff-split-view': viewLayout === 'split',
            'v-diff-unified-view': viewLayout === 'unified',
            'diff-mode-smart': diffType === 'smart',
            'diff-mode-lines': diffType === 'lines',
            'diff-mode-words': diffType === 'words',
            'diff-mode-chars': diffType === 'chars',
        }
    );

    // Prepare optional props to satisfy exactOptionalPropertyTypes
    const commonVirtuosoProps = useMemo(() => {
        // Note: 'ref' is not part of VirtuosoProps, so it is passed directly in JSX
        const props: Partial<VirtuosoProps<any, unknown>> = {
            style: { height, width },
            className: containerClass,
            overscan: overscanCount,
        };

        // Conditionally add optional props to avoid passing 'undefined' 
        // which violates exactOptionalPropertyTypes
        if (setVirtuosoScrollerRef) {
            props.scrollerRef = setVirtuosoScrollerRef;
        }

        if (isNotNil(onRangeChanged)) {
            props.rangeChanged = handleRangeChanged;
        }

        if (initialTopMostItemIndex !== undefined) {
            props.initialTopMostItemIndex = initialTopMostItemIndex;
        }

        if (scrollSeekConfiguration) {
            props.components = { ScrollSeekPlaceholder: scrollSeekConfiguration };
        }

        return props;
    }, [
        height, 
        width, 
        containerClass, 
        overscanCount, 
        setVirtuosoScrollerRef, 
        onRangeChanged, 
        handleRangeChanged, 
        initialTopMostItemIndex, 
        scrollSeekConfiguration
    ]);

    // Handle split view rendering
    if (viewLayout === 'split') {
        const { splitRows } = processedData;
        
        return (
            <Virtuoso<SideBySideRowData, unknown>
                ref={virtuosoHandleRef ?? null}
                key="virtuoso-split-view"
                data={splitRows}
                totalCount={splitRows.length}
                itemContent={(_index, row) => (
                    <div className="diff-split-row" role="row">
                        <div className="diff-split-cell" role="cell">
                            {isNotNil(row.left) ? (
                                <DiffLine
                                    data={row.left}
                                    isHighlighted={row.left.index === highlightedIndex}
                                    searchQuery={searchQuery}
                                    isCaseSensitive={isCaseSensitive}
                                    isTargetLine={activeMatchInfo?.lineIndex === row.left.index}
                                    targetMatchIndexInLine={
                                        activeMatchInfo?.lineIndex === row.left.index 
                                            ? activeMatchInfo.matchIndexInLine 
                                            : -1
                                    }
                                    onClick={handleLineClick}
                                    diffType={diffType}
                                    displayMode="left"
                                />
                            ) : (
                                <div className="diff-empty-cell" aria-hidden="true" />
                            )}
                        </div>
                        <div className="diff-split-cell" role="cell">
                            {isNotNil(row.right) ? (
                                <DiffLine
                                    data={row.right}
                                    isHighlighted={row.right.index === highlightedIndex}
                                    searchQuery={searchQuery}
                                    isCaseSensitive={isCaseSensitive}
                                    isTargetLine={activeMatchInfo?.lineIndex === row.right.index}
                                    targetMatchIndexInLine={
                                        activeMatchInfo?.lineIndex === row.right.index 
                                            ? activeMatchInfo.matchIndexInLine 
                                            : -1
                                    }
                                    onClick={handleLineClick}
                                    diffType={diffType}
                                    displayMode="right"
                                />
                            ) : (
                                <div className="diff-empty-cell" aria-hidden="true" />
                            )}
                        </div>
                    </div>
                )}
                {...commonVirtuosoProps}
            />
        );
    }

    // Unified view rendering
    const { linearLines } = processedData;
    
    return (
        <Virtuoso<DiffLineData, unknown>
            ref={virtuosoHandleRef ?? null}
            key="virtuoso-unified-view"
            data={linearLines}
            totalCount={linearLines.length}
            itemContent={(_index, data) => (
                <DiffLine
                    data={data}
                    isHighlighted={data.index === highlightedIndex}
                    searchQuery={searchQuery}
                    isCaseSensitive={isCaseSensitive}
                    isTargetLine={activeMatchInfo?.lineIndex === data.index}
                    targetMatchIndexInLine={
                        activeMatchInfo?.lineIndex === data.index 
                            ? activeMatchInfo.matchIndexInLine 
                            : -1
                    }
                    onClick={handleLineClick}
                    diffType={diffType}
                    displayMode="unified"
                />
            )}
            {...commonVirtuosoProps}
        />
    );
};

VirtualizedDiff.displayName = 'VirtualizedDiff';
