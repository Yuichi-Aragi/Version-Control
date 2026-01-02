import { memo, useCallback, useMemo, type FC, type ReactNode } from 'react';
import clsx from 'clsx';
import { isNotNil, isString } from 'es-toolkit';
import type { DiffType } from '@/types';
import { HighlightedText } from '../HighlightedText';
import type { DiffLineData, DisplayMode } from './types';
import { LINE_TYPE_CLASSES } from './constants';
import { escapeRegExp } from './utils';

interface DiffLineProps {
    readonly data: DiffLineData;
    readonly isHighlighted: boolean;
    readonly searchQuery?: string | undefined;
    readonly isCaseSensitive?: boolean | undefined;
    readonly isTargetLine: boolean;
    readonly targetMatchIndexInLine: number;
    readonly onClick?: ((lineData: DiffLineData) => void) | undefined;
    readonly diffType?: DiffType | undefined;
    readonly displayMode?: DisplayMode;
    readonly className?: string | undefined;
}

const DiffLineComponent: FC<DiffLineProps> = ({ 
    data, 
    isHighlighted, 
    searchQuery, 
    isCaseSensitive = false,
    isTargetLine, 
    targetMatchIndexInLine, 
    onClick,
    diffType = 'lines',
    displayMode = 'unified',
    className
}) => {
    const handleClick = useCallback(() => {
        if (isNotNil(onClick) && data.type !== 'collapsed') {
            onClick(data);
        }
    }, [onClick, data]);

    const searchRegex = useMemo(() => {
        const trimmedQuery = isString(searchQuery) ? searchQuery.trim() : '';
        if (!trimmedQuery) return null;
        
        try {
            return new RegExp(
                escapeRegExp(trimmedQuery), 
                isCaseSensitive ? 'g' : 'gi'
            );
        } catch {
            return null;
        }
    }, [searchQuery, isCaseSensitive]);

    const getSegmentClass = useCallback((segType: 'add' | 'remove' | 'unchanged'): string => {
        if (segType === 'unchanged') return '';
        
        // Smart, Line, and Char modes all use character-level refinement in the worker,
        // but 'chars' mode needs specific styling (no line background).
        // 'words' mode uses word-level refinement.
        
        if (diffType === 'chars') {
            return segType === 'add' ? 'diff-char-add' : 'diff-char-remove';
        }
        
        if (diffType === 'words') {
            return segType === 'add' ? 'diff-word-add' : 'diff-word-remove';
        }
        
        // Default for Smart and Line modes (standard highlight)
        return segType === 'add' ? 'diff-segment-add' : 'diff-segment-remove';
    }, [diffType]);

    const calculateSegmentMatches = useCallback((): ReactNode[] => {
        if (!Array.isArray(data.segments)) return [];
        
        let globalMatchCounter = 0;
        
        return data.segments.map((seg, i) => {
            let localActiveMatchIndex = -1;
            
            if (searchRegex && isString(seg.text)) {
                const matches = seg.text.match(searchRegex);
                const matchCount = Array.isArray(matches) ? matches.length : 0;
                
                if (isTargetLine && matchCount > 0) {
                    if (
                        targetMatchIndexInLine >= globalMatchCounter && 
                        targetMatchIndexInLine < globalMatchCounter + matchCount
                    ) {
                        localActiveMatchIndex = targetMatchIndexInLine - globalMatchCounter;
                    }
                }
                globalMatchCounter += matchCount;
            }

            const shouldRender = displayMode === 'unified' || 
                                 (displayMode === 'left' && seg.type !== 'add') || 
                                 (displayMode === 'right' && seg.type !== 'remove');
            
            if (!shouldRender) return null;

            return (
                <span 
                    key={`segment-${i}`}
                    className={clsx(getSegmentClass(seg.type), {
                        'diff-segment-modified': data.isModified && seg.type !== 'unchanged',
                    })}
                >
                    <HighlightedText 
                        text={seg.text} 
                        query={searchQuery ?? ''}
                        caseSensitive={isCaseSensitive}
                        activeMatchIndex={localActiveMatchIndex}
                        ariaLabel={`${seg.type} text segment`}
                    />
                </span>
            );
        }).filter(isNotNil) as ReactNode[];
    }, [
        data.segments,
        data.isModified,
        searchRegex,
        searchQuery,
        isCaseSensitive,
        isTargetLine,
        targetMatchIndexInLine,
        displayMode,
        getSegmentClass
    ]);

    if (data.type === 'collapsed') {
        return (
            <div 
                className={clsx(
                    'diff-line diff-collapsed',
                    className
                )}
                role="row"
                aria-label="Collapsed context lines"
                data-display-mode={displayMode}
            >
                <div className="diff-line-gutter" aria-hidden="true" />
                <div className="diff-line-content">
                    <span className="diff-collapsed-marker">⋯</span>
                </div>
            </div>
        );
    }

    const segmentElements = Array.isArray(data.segments) ? calculateSegmentMatches() : null;
    
    const oldLineNum = typeof data.oldLineNum === 'number' ? data.oldLineNum.toString() : '';
    const newLineNum = typeof data.newLineNum === 'number' ? data.newLineNum.toString() : '';
    
    const lineMarker = data.type === 'add' ? '+' : 
                        data.type === 'remove' ? '-' : 
                        '';

    return (
        <div
            className={clsx(
                'diff-line',
                LINE_TYPE_CLASSES[data.type],
                className,
                {
                    'is-scrolled-to': isHighlighted,
                    'is-clickable': isNotNil(onClick),
                    'is-modified-line': data.isModified,
                }
            )}
            onClick={handleClick}
            role="row"
            aria-label={`${data.type} line${oldLineNum ? `, old line ${oldLineNum}` : ''}${newLineNum ? `, new line ${newLineNum}` : ''}`}
            data-display-mode={displayMode}
        >
            <div className="diff-line-gutter" aria-hidden="true">
                <span className="diff-line-num old" aria-label={`Old line number: ${oldLineNum || 'Not applicable'}`}>
                    {oldLineNum}
                </span>
                <span className="diff-line-num new" aria-label={`New line number: ${newLineNum || 'Not applicable'}`}>
                    {newLineNum}
                </span>
            </div>
            <div className="diff-line-content">
                <span className="diff-line-marker" aria-hidden="true">
                    {lineMarker}
                </span>
                <span className="diff-line-text">
                    {segmentElements ? (
                        segmentElements
                    ) : (
                        <HighlightedText 
                            text={data.content || '\u00A0'} 
                            query={searchQuery ?? ''}
                            caseSensitive={isCaseSensitive}
                            activeMatchIndex={isTargetLine ? targetMatchIndexInLine : -1}
                        />
                    )}
                </span>
            </div>
        </div>
    );
};

export const DiffLine = memo(DiffLineComponent);
DiffLine.displayName = 'DiffLine';
