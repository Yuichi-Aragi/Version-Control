import {
    useMemo,
    useCallback,
    useRef,
    useState,
    useEffect,
    useLayoutEffect,
    type FC,
    type CSSProperties,
} from 'react';
import clsx from 'clsx';
import { isNotNil, isNil } from 'es-toolkit';
import type { DiffLineData, BaseDiffProps } from './types';
import { validateChanges, validateDiffType, invariant } from './utils';
import { processDiffData } from './processors';
import { DiffLine } from './DiffLine';

export interface StaticDiffProps extends BaseDiffProps {
    readonly style?: CSSProperties | undefined;
}

export const StaticDiff: FC<StaticDiffProps> = ({
    changes,
    lines,
    diffType,
    viewLayout = 'unified',
    searchQuery,
    isCaseSensitive = false,
    activeMatchInfo,
    onLineClick,
    className,
    style,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [hasScrolled, setHasScrolled] = useState(false);

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

    // Process diff data
    const processedData = useMemo(() => {
        return processDiffData(changes, lines, diffType, viewLayout);
    }, [changes, lines, diffType, viewLayout]);

    // Handle scrolling to active match
    useLayoutEffect(() => {
        if (
            isNil(activeMatchInfo) || 
            hasScrolled || 
            isNil(containerRef.current) ||
            typeof activeMatchInfo.lineIndex !== 'number'
        ) return;
        
        const targetElement = containerRef.current.children[activeMatchInfo.lineIndex];
        if (isNotNil(targetElement)) {
            targetElement.scrollIntoView({ 
                block: 'center', 
                behavior: 'auto' 
            });
            setHasScrolled(true);
        }
    }, [activeMatchInfo, hasScrolled]);

    // Reset scroll state when active match changes
    useEffect(() => {
        setHasScrolled(false);
    }, [activeMatchInfo?.lineIndex, activeMatchInfo?.matchIndexInLine]);

    // Memoize line click handler
    const handleLineClick = useCallback((lineData: DiffLineData) => {
        if (isNotNil(onLineClick)) {
            onLineClick(lineData);
        }
    }, [onLineClick]);

    const containerClass = clsx(
        'v-static-diff-container',
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

    // Handle split view
    if (viewLayout === 'split') {
        const { splitRows } = processedData;
        
        return (
            <div
                ref={containerRef}
                className={containerClass}
                style={{ height: '100%', overflowY: 'auto', ...style }}
                role="table"
                aria-label="Side by side diff view"
            >
                {splitRows.map((row) => (
                    <div key={row.key} className="diff-split-row" role="row">
                        <div className="diff-split-cell" role="cell">
                            {isNotNil(row.left) ? (
                                <DiffLine
                                    data={row.left}
                                    isHighlighted={false}
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
                        <div className="diff-empty-gutter" aria-hidden="true" />
                        <div className="diff-split-cell" role="cell">
                            {isNotNil(row.right) ? (
                                <DiffLine
                                    data={row.right}
                                    isHighlighted={false}
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
                ))}
            </div>
        );
    }

    // Unified view
    const { linearLines } = processedData;
    
    return (
        <div
            ref={containerRef}
            className={containerClass}
            style={{ height: '100%', overflowY: 'auto', ...style }}
            role="table"
            aria-label="Unified diff view"
        >
            {linearLines.map((data) => (
                <DiffLine
                    key={data.key}
                    data={data}
                    isHighlighted={activeMatchInfo?.lineIndex === data.index}
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
            ))}
        </div>
    );
};

StaticDiff.displayName = 'StaticDiff';
