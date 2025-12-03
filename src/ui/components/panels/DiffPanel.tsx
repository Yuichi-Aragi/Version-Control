import { moment, debounce } from 'obsidian';
import type { FC, ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Progress from '@radix-ui/react-progress';
import type { VirtuosoHandle, ListRange } from 'react-virtuoso';
import clsx from 'clsx';
import { useAppDispatch } from '../../hooks/useRedux';
import { thunks } from '../../../state/thunks';
import type { DiffPanel as DiffPanelState } from '../../../state/state';
import type { Change, DiffType } from '../../../types';
import { Icon } from '../Icon';
import { VirtualizedDiff, processLineChanges, type DiffLineData } from '../shared/VirtualizedDiff';
import { escapeRegExp } from '../../utils/strings';
import { usePanelClose } from '../../hooks/usePanelClose';
import { useDelayedFocus } from '../../hooks/useDelayedFocus';

interface DiffPanelProps {
    panelState: DiffPanelState;
}

const getDiffOptions = () => {
    const options = [
        { type: 'smart' as DiffType, label: 'Smart Diff' },
        { type: 'lines' as DiffType, label: 'Line Diff' },
        { type: 'words' as DiffType, label: 'Word Diff' },
        { type: 'chars' as DiffType, label: 'Character Diff' },
    ];
    return options;
};

const DiffDropdown: FC<{
    currentType: DiffType;
    onSelect: (type: DiffType) => void;
    children: ReactNode;
}> = ({ currentType, onSelect, children }) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
            <DropdownMenu.Content className="v-diff-dropdown-content" sideOffset={5} collisionPadding={10}>
                {getDiffOptions().map(({ type, label }) => (
                    <DropdownMenu.Item key={type} className="v-diff-dropdown-item" onSelect={() => onSelect(type)}>
                        {label}
                        {currentType === type && <Icon name="check" />}
                    </DropdownMenu.Item>
                ))}
            </DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
);

// Helper function to transform diff changes to properly typed Change objects
const transformDiffChanges = (changes: any[]): Change[] => {
    return changes.map(change => {
        const changeObj = {
            value: change.value,
        } as Change;
        
        // Only add properties that have meaningful values
        if (typeof change.added === 'boolean') {
            changeObj.added = change.added;
        }
        if (typeof change.removed === 'boolean') {
            changeObj.removed = change.removed;
        }
        if (typeof change.count === 'number') {
            changeObj.count = change.count;
        }
        if (Array.isArray(change.parts)) {
            changeObj.parts = change.parts;
        }
        
        return changeObj;
    });
};

export const DiffPanel: FC<DiffPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const { version1, version2, diffChanges, diffType, isReDiffing, renderMode } = panelState;

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const virtuosoRangeRef = useRef<ListRange | null>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const unifiedViewContainerRef = useRef<HTMLPreElement>(null);
    const containerScrollerRef = useRef<HTMLDivElement>(null);
    const isInitialLoadRef = useRef(true);
    const scrollAnchorRef = useRef<{ type: 'line' | 'change'; index: number } | null>(null);

    const [isMetaCollapsed, setIsMetaCollapsed] = useState(true);

    // Search and navigation state
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [isCaseSensitive, setIsCaseSensitive] = useState(false);
    const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [unifiedMatches, setUnifiedMatches] = useState<Element[]>([]);

    const [lines, setLines] = useState<DiffLineData[]>([]);
    useEffect(() => {
        if (diffChanges) {
            // Transform diff changes to match Change type (remove undefined properties)
            const transformedChanges = transformDiffChanges(diffChanges) as any;
            
            // processLineChanges handles 'smart' diff logic internally
            setLines(processLineChanges(transformedChanges, diffType));
        } else {
            setLines([]);
        }
    }, [diffChanges, diffType]);

    // When the versions being compared change, reset initial load flag.
    useEffect(() => {
        isInitialLoadRef.current = true;
        scrollAnchorRef.current = null;
    }, [version1.id, version2.id]);

    const handleLineClick = useCallback((clickedLineData: DiffLineData) => {
        let targetLineNum: number | undefined;

        if (clickedLineData.newLineNum !== undefined) {
            targetLineNum = clickedLineData.newLineNum;
        } else if (clickedLineData.type === 'remove') {
            const clickedLineIndex = lines.findIndex(l => l.key === clickedLineData.key);
            if (clickedLineIndex !== -1) {
                for (let i = clickedLineIndex - 1; i >= 0; i--) {
                    const prevLine = lines[i];
                    if (prevLine?.newLineNum !== undefined) {
                        targetLineNum = prevLine.newLineNum + 1;
                        break;
                    }
                }
            }
            if (targetLineNum === undefined) {
                targetLineNum = 1;
            }
        }

        if (targetLineNum !== undefined) {
            dispatch(thunks.scrollToLineInEditor(targetLineNum));
        }
    }, [dispatch, lines]);

    const debouncedSetSearchQuery = useCallback(debounce(setSearchQuery, 300, true), []);

    const isLineBasedDiff = diffType === 'lines' || diffType === 'smart';

    const lineMatches = useMemo(() => {
        if (!isLineBasedDiff || !searchQuery || !diffChanges) return [];
        const regex = new RegExp(escapeRegExp(searchQuery), isCaseSensitive ? 'g' : 'gi');
        const allMatches: { lineIndex: number; matchIndexInLine: number }[] = [];
        lines.forEach((line, lineIndex) => {
            if (line.type === 'collapsed') return;
            const lineContentMatches = [...line.content.matchAll(regex)];
            lineContentMatches.forEach((_, matchIndexInLine) => {
                allMatches.push({ lineIndex, matchIndexInLine });
            });
        });
        return allMatches;
    }, [searchQuery, isCaseSensitive, diffChanges, isLineBasedDiff, lines]);

    useEffect(() => {
        if (!isLineBasedDiff && searchQuery && unifiedViewContainerRef.current) {
            const marks = Array.from(unifiedViewContainerRef.current.querySelectorAll('mark'));
            setUnifiedMatches(marks);
        } else {
            setUnifiedMatches([]);
        }
    }, [searchQuery, isCaseSensitive, isLineBasedDiff, diffChanges]);

    const totalMatches = isLineBasedDiff ? lineMatches.length : unifiedMatches.length;

    const goToMatch = useCallback((direction: 'next' | 'prev') => {
        if (totalMatches === 0) return;
        const nextIndex = direction === 'next'
            ? (activeMatchIndex + 1) % totalMatches
            : (activeMatchIndex - 1 + totalMatches) % totalMatches;
        setActiveMatchIndex(nextIndex);
    }, [activeMatchIndex, totalMatches]);

    useEffect(() => {
        setActiveMatchIndex(-1);
    }, [searchQuery, isCaseSensitive, diffChanges]);

    useEffect(() => {
        if (activeMatchIndex === -1) return;

        if (isLineBasedDiff) {
            const match = lineMatches[activeMatchIndex];
            if (match && virtuosoRef.current) {
                virtuosoRef.current.scrollToIndex({
                    index: match.lineIndex,
                    align: 'center',
                    behavior: 'smooth',
                });
            }
        } else {
            const matchElement = unifiedMatches[activeMatchIndex];
            if (matchElement) {
                unifiedMatches.forEach((el, index) => {
                    el.classList.toggle('is-active-match', index === activeMatchIndex);
                });
                matchElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }
        }
    }, [activeMatchIndex, isLineBasedDiff, lineMatches, unifiedMatches]);

    const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalSearchQuery(e.target.value);
        debouncedSetSearchQuery(e.target.value);
    }, [debouncedSetSearchQuery]);

    const handleToggleSearch = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setIsSearchActive(v => !v);
    }, []);

    const handleClearSearch = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setLocalSearchQuery('');
        setSearchQuery('');
        searchInputRef.current?.focus();
    }, []);

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            handleToggleSearch();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            goToMatch(e.shiftKey ? 'prev' : 'next');
        }
    };

    useDelayedFocus(searchInputRef, 100, isSearchActive);

    const [activeChange, setActiveChange] = useState(-1);
    const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

    const changedLineIndices = useMemo(() => {
        if (!isLineBasedDiff || !diffChanges) return [];
        return lines.reduce((acc, line, index) => {
            if (line.type === 'add' || line.type === 'remove') {
                acc.push(index);
            }
            return acc;
        }, [] as number[]);
    }, [diffChanges, isLineBasedDiff, lines]);

    useEffect(() => {
        setActiveChange(-1);
        setHighlightedIndex(null);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        return () => {
            if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        };
    }, [diffChanges]);

    const scrollToChange = useCallback((direction: 'next' | 'prev') => {
        if (!virtuosoRef.current || changedLineIndices.length === 0) return;
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);

        const nextActiveChange = direction === 'next'
            ? (activeChange + 1) % changedLineIndices.length
            : (activeChange - 1 + changedLineIndices.length) % changedLineIndices.length;
        setActiveChange(nextActiveChange);

        const targetLineIndex = changedLineIndices[nextActiveChange];
        if (targetLineIndex === undefined) return;

        const headerHeight = headerRef.current?.offsetHeight ?? 60;
        const lineHeight = 20;
        const offset = -(headerHeight + (3 * lineHeight));

        virtuosoRef.current.scrollToIndex({
            index: targetLineIndex,
            align: 'start',
            behavior: 'smooth',
            offset: offset,
        });

        setHighlightedIndex(targetLineIndex);
        highlightTimeoutRef.current = window.setTimeout(() => setHighlightedIndex(null), 1500);
    }, [changedLineIndices, activeChange]);

    const handleNextChange = useCallback((e: React.MouseEvent) => { e.stopPropagation(); scrollToChange('next'); }, [scrollToChange]);
    const handlePrevChange = useCallback((e: React.MouseEvent) => { e.stopPropagation(); scrollToChange('prev'); }, [scrollToChange]);

    const panelClose = usePanelClose();
    const handleClose = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        panelClose();
    }, [panelClose]);

    const handleRangeChanged = useCallback((range: ListRange) => {
        virtuosoRangeRef.current = range;
    }, []);

    const handleDiffTypeChange = useCallback((newType: DiffType) => {
        if (newType === diffType) return;

        if (isLineBasedDiff) {
            if (virtuosoRangeRef.current) {
                const firstItemIndex = virtuosoRangeRef.current.startIndex;
                scrollAnchorRef.current = { type: 'line', index: firstItemIndex };
            }
        } else {
            const scroller = containerScrollerRef.current;
            if (scroller) {
                const nodes = scroller.querySelectorAll<HTMLElement>('[data-change-index]');
                let foundIndex = 0;
                for (const node of Array.from(nodes)) {
                    if (node.offsetTop <= scroller.scrollTop) {
                        foundIndex = parseInt(node.dataset['changeIndex'] || '0', 10);
                    } else {
                        break;
                    }
                }
                scrollAnchorRef.current = { type: 'change', index: foundIndex };
            }
        }

        isInitialLoadRef.current = false;
        dispatch(thunks.recomputeDiff(newType));
    }, [dispatch, diffType, isLineBasedDiff]);

    useEffect(() => {
        if (!diffChanges) return;

        const timer = setTimeout(() => {
            const anchor = scrollAnchorRef.current;
            if (anchor) {
                if (isLineBasedDiff) {
                    if (anchor.type === 'change' && virtuosoRef.current) {
                        const targetLineIndex = lines.findIndex(l => l.originalChangeIndex >= anchor.index);
                        if (targetLineIndex !== -1) {
                            virtuosoRef.current.scrollToIndex({ index: targetLineIndex, align: 'start', behavior: 'auto' });
                        }
                    }
                } else {
                    if (anchor.type === 'line' && containerScrollerRef.current) {
                        const lineData = lines[anchor.index];
                        if (lineData) {
                            const targetChangeIndex = lineData.originalChangeIndex;
                            const targetElement = containerScrollerRef.current.querySelector<HTMLElement>(`[data-change-index="${targetChangeIndex}"]`);
                            if (targetElement) {
                                targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
                            }
                        }
                    }
                }
                scrollAnchorRef.current = null;
            } else if (isInitialLoadRef.current) {
                if (isLineBasedDiff) {
                    if (virtuosoRef.current && changedLineIndices.length > 0) {
                        const firstChangeIndex = changedLineIndices[0];
                        if (firstChangeIndex !== undefined) {
                            virtuosoRef.current.scrollToIndex({ index: firstChangeIndex, align: 'start', behavior: 'auto' });
                            setHighlightedIndex(firstChangeIndex);
                            if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
                            highlightTimeoutRef.current = window.setTimeout(() => setHighlightedIndex(null), 1500);
                        }
                    }
                } else {
                    if (containerScrollerRef.current) {
                        const firstChangeEl = containerScrollerRef.current.querySelector('.diff-add, .diff-remove');
                        if (firstChangeEl) {
                            firstChangeEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                        }
                    }
                }
                isInitialLoadRef.current = false;
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [diffChanges, diffType, lines, changedLineIndices, isLineBasedDiff]);

    const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
    const v2Label = version2.id === 'current'
        ? 'Current note state'
        : 'versionNumber' in version2
            ? (version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`)
            : version2.name;

    const isWindowMode = renderMode === 'window';

    return (
        <div className={clsx("v-panel-container is-active", { "v-panel-window-mode": isWindowMode })}>
            <div className="v-inline-panel v-diff-panel">
                <div className={clsx("v-panel-header", { 'is-searching': isSearchActive })} ref={headerRef}>
                    <div className="v-panel-header-content">
                        <div className="v-diff-panel-title" onClick={() => setIsMetaCollapsed(v => !v)}>
                            <Icon name={isMetaCollapsed ? 'chevron-right' : 'chevron-down'} />
                            <h3>Comparing</h3>
                            {isLineBasedDiff && changedLineIndices.length > 0 && (
                                <div className="v-diff-nav-actions">
                                    <button className="clickable-icon" aria-label="Previous change" title="Previous change" onClick={handlePrevChange}>
                                        <Icon name="chevron-up" />
                                    </button>
                                    <button className="clickable-icon" aria-label="Next change" title="Next change" onClick={handleNextChange}>
                                        <Icon name="chevron-down" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="v-panel-header-actions">
                            <button className="clickable-icon" aria-label="Search diff" title="Search diff" onClick={handleToggleSearch}>
                                <Icon name="search" />
                            </button>
                            <DiffDropdown currentType={diffType} onSelect={handleDiffTypeChange}>
                                <button className="clickable-icon v-diff-dropdown-trigger" aria-label="Change diff type" title="Change diff type" onClick={e => e.stopPropagation()}>
                                    <Icon name="git-commit-horizontal" />
                                </button>
                            </DiffDropdown>
                            {!isWindowMode && (
                                <button className="clickable-icon v-panel-close" aria-label="Close diff" title="Close diff" onClick={handleClose}>
                                    <Icon name="x" />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="v-panel-search-bar-container" onClick={e => e.stopPropagation()}>
                        <div className="v-search-input-wrapper">
                            <div className="v-search-icon" role="button" aria-label="Close search" onClick={handleToggleSearch}>
                                <Icon name="x-circle" />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="search"
                                placeholder="Search diff..."
                                value={localSearchQuery}
                                onChange={handleSearchInputChange}
                                onKeyDown={handleSearchKeyDown}
                                onClick={e => e.stopPropagation()}
                            />
                            <div className="v-search-input-buttons">
                                {searchQuery && totalMatches > 0 && (
                                    <span className="v-search-match-count">{activeMatchIndex + 1} / {totalMatches}</span>
                                )}
                                <button className="clickable-icon v-search-nav-button" aria-label="Previous match" disabled={totalMatches === 0} onClick={() => goToMatch('prev')}>
                                    <Icon name="chevron-up" />
                                </button>
                                <button className="clickable-icon v-search-nav-button" aria-label="Next match" disabled={totalMatches === 0} onClick={() => goToMatch('next')}>
                                    <Icon name="chevron-down" />
                                </button>
                                <button className={clsx('clickable-icon', { 'is-active': isCaseSensitive })} aria-label="Toggle case sensitivity" onClick={(e) => { e.stopPropagation(); setIsCaseSensitive(v => !v); }}>
                                    <Icon name="case-sensitive" />
                                </button>
                                <button className={clsx('clickable-icon', { 'is-hidden': !localSearchQuery })} aria-label="Clear search" onClick={handleClearSearch}>
                                    <Icon name="x" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="v-diff-panel-content">
                    {diffChanges === null ? (
                        <div className="is-loading">
                            <div className="loading-spinner" />
                            <p>Loading diff...</p>
                        </div>
                    ) : (
                        <>
                            <div className={clsx("v-diff-meta-container", { 'is-open': !isMetaCollapsed })}>
                                <div className="v-diff-meta-content-wrapper">
                                    <div className="v-meta-label">Base (red, -): {v1Label} - {(moment as any)(version1.timestamp).format('LLL')}</div>
                                    <div className="v-meta-label">Compared (green, +): {v2Label} - {'versionNumber' in version2 ? (moment as any)(version2.timestamp).format('LLL') : 'Now'}</div>
                                </div>
                            </div>
                            <div className="v-diff-content-wrapper" ref={containerScrollerRef}>
                                {isReDiffing && (
                                    <div className="v-diff-progress-overlay">
                                        <p>Calculating {diffType} diff...</p>
                                        <Progress.Root className="v-diff-progress-bar" value={null}>
                                            <Progress.Indicator className="v-diff-progress-indicator" />
                                        </Progress.Root>
                                    </div>
                                )}
                                <VirtualizedDiff
                                    changes={(diffChanges ? transformDiffChanges(diffChanges) : []) as any}
                                    diffType={diffType}
                                    virtuosoHandleRef={virtuosoRef}
                                    setVirtuosoScrollerRef={(_scroller) => {
                                        // This prop is for Virtuoso to take control of a parent scroller,
                                        // which we are not doing. The containerScrollerRef is used for unified diffs.
                                    }}
                                    unifiedViewContainerRef={unifiedViewContainerRef}
                                    highlightedIndex={highlightedIndex}
                                    searchQuery={searchQuery}
                                    isCaseSensitive={isCaseSensitive}
                                    activeMatchInfo={isLineBasedDiff ? (lineMatches[activeMatchIndex] ?? null) : null}
                                    activeUnifiedMatchIndex={!isLineBasedDiff ? activeMatchIndex : -1}
                                    onLineClick={handleLineClick}
                                    onRangeChanged={handleRangeChanged}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
