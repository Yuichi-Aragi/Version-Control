import type { FC, ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import type { VirtuosoHandle, ListRange } from 'react-virtuoso';
import clsx from 'clsx';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks, appSlice } from '@/state';
import type { DiffPanel as DiffPanelState } from '@/state';
import type { Change, DiffType } from '@/types';
import { Icon } from '@/ui/components';
import { VirtualizedDiff } from '@/ui/components/shared';
import { processLineChanges, processSideBySideChanges, type DiffLineData } from '@/ui/components/shared/diff';
import { escapeRegExp } from '@/ui/utils/strings';
import { usePanelClose } from '@/ui/hooks';
import { usePanelSearch } from '@/ui/hooks';
import { useGetDiffQuery } from '@/state/apis/history.api';

interface DiffPanelProps {
    panelState: DiffPanelState;
}

type ViewLayout = 'split' | 'unified';

const DiffOptionsDropdown: FC<{ 
    currentType: DiffType; 
    currentLayout: ViewLayout;
    onSelectType: (type: DiffType) => void; 
    onSelectLayout: (layout: ViewLayout) => void;
    children: ReactNode 
}> = ({ currentType, currentLayout, onSelectType, onSelectLayout, children }) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
            <DropdownMenu.Content className="v-diff-dropdown-content" sideOffset={5} collisionPadding={10}>
                
                <DropdownMenu.Item className="v-diff-dropdown-item" onSelect={() => onSelectLayout('unified')}>
                    <span>Unified View</span>
                    {currentLayout === 'unified' && <Icon name="check" />}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="v-diff-dropdown-item" onSelect={() => onSelectLayout('split')}>
                    <span>Side-by-Side View</span>
                    {currentLayout === 'split' && <Icon name="check" />}
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="v-diff-separator" />

                <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className="v-diff-dropdown-sub-trigger">
                        <span>Diff Mode</span>
                        <Icon name="chevron-right" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.SubContent className="v-diff-dropdown-sub-content" sideOffset={2} alignOffset={-5}>
                            <DropdownMenu.Item className="v-diff-dropdown-item" onSelect={() => onSelectType('smart')}>
                                <span>Smart Diff</span>
                                {currentType === 'smart' && <Icon name="check" />}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="v-diff-dropdown-item" onSelect={() => onSelectType('lines')}>
                                <span>Line Diff</span>
                                {currentType === 'lines' && <Icon name="check" />}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="v-diff-dropdown-item" onSelect={() => onSelectType('words')}>
                                <span>Word Diff</span>
                                {currentType === 'words' && <Icon name="check" />}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="v-diff-dropdown-item" onSelect={() => onSelectType('chars')}>
                                <span>Character Diff</span>
                                {currentType === 'chars' && <Icon name="check" />}
                            </DropdownMenu.Item>
                        </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                </DropdownMenu.Sub>

            </DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
);

const transformDiffChanges = (changes: any[]): Change[] => {
    return changes.map(change => ({
        value: change.value,
        added: change.added,
        removed: change.removed,
        count: change.count,
        parts: change.parts
    }));
};

export const DiffPanel: FC<DiffPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const { version1, version2, diffType, renderMode } = panelState;
    const { noteId, viewMode } = useAppSelector(state => ({
        noteId: state.app.noteId,
        viewMode: state.app.viewMode,
    }));

    // Fetch diff using RTK Query
    const { data: diffChanges, isLoading, isFetching, isError } = useGetDiffQuery(
        { noteId: noteId!, v1: version1, v2: version2, diffType, viewMode },
        { skip: !noteId }
    );

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const virtuosoRangeRef = useRef<ListRange | null>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const containerScrollerRef = useRef<HTMLDivElement>(null);
    const isInitialLoadRef = useRef(true);

    const [isMetaCollapsed, setIsMetaCollapsed] = useState(true);
    const [viewLayout, setViewLayout] = useState<ViewLayout>('unified');
    
    // We compute lines locally for search and navigation logic
    const [lines, setLines] = useState<readonly DiffLineData[]>([]);

    useEffect(() => {
        if (diffChanges) {
            const transformedChanges = transformDiffChanges(diffChanges) as any;
            setLines(processLineChanges(transformedChanges, diffType));
        } else {
            setLines([]);
        }
    }, [diffChanges, diffType]);

    // Compute split rows locally if needed for scrolling logic
    const splitRows = useMemo(() => {
        if (viewLayout === 'split') {
            return processSideBySideChanges(lines);
        }
        return [];
    }, [lines, viewLayout]);

    // Helper to get the correct scroll index based on layout
    const getScrollIndex = useCallback((linearIndex: number) => {
        if (viewLayout === 'unified') return linearIndex;
        
        // In split view, find the row that contains the line with the given linear index
        return splitRows.findIndex(row => 
            (row.left && row.left.index === linearIndex) || 
            (row.right && row.right.index === linearIndex)
        );
    }, [viewLayout, splitRows]);

    useEffect(() => {
        isInitialLoadRef.current = true;
    }, [version1.id, version2.id]);

    const handleLineClick = useCallback((clickedLineData: DiffLineData) => {
        let targetLineNum: number | undefined;
        if (clickedLineData.newLineNum !== undefined) {
            targetLineNum = clickedLineData.newLineNum;
        } else if (clickedLineData.type === 'remove') {
            // Find preceding line in linear list
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
            if (targetLineNum === undefined) targetLineNum = 1;
        }
        if (targetLineNum !== undefined) dispatch(thunks.scrollToLineInEditor(targetLineNum));
    }, [dispatch, lines]);

    // Search Logic
    const search = usePanelSearch();

    const lineMatches = useMemo(() => {
        if (!search.searchQuery || !diffChanges) return [];
        const regex = new RegExp(escapeRegExp(search.searchQuery), search.isCaseSensitive ? 'g' : 'gi');
        const allMatches: { lineIndex: number; matchIndexInLine: number }[] = [];
        lines.forEach((line, lineIndex) => {
            if (line.type === 'collapsed') return;
            const lineContentMatches = [...line.content.matchAll(regex)];
            lineContentMatches.forEach((_, matchIndexInLine) => {
                allMatches.push({ lineIndex, matchIndexInLine });
            });
        });
        return allMatches;
    }, [search.searchQuery, search.isCaseSensitive, diffChanges, lines]);

    const totalMatches = lineMatches.length;

    // Local navigation logic to handle matches calculated in this component
    const goToMatch = useCallback((direction: 'next' | 'prev') => {
        if (totalMatches === 0) return;
        search.setActiveMatchIndex(current => {
            if (direction === 'next') {
                return (current + 1) % totalMatches;
            } else {
                return (current - 1 + totalMatches) % totalMatches;
            }
        });
    }, [totalMatches, search.setActiveMatchIndex]);

    // Scroll to match
    useEffect(() => {
        if (search.activeMatchIndex === -1) return;
        const match = lineMatches[search.activeMatchIndex];
        if (match && virtuosoRef.current) {
            const targetIndex = getScrollIndex(match.lineIndex);
            
            if (targetIndex !== -1) {
                virtuosoRef.current.scrollToIndex({
                    index: targetIndex,
                    align: 'center',
                    behavior: 'smooth',
                });
            }
        }
    }, [search.activeMatchIndex, lineMatches, getScrollIndex]);

    // Diff Navigation (Next/Prev Change)
    const [activeChange, setActiveChange] = useState(-1);
    const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

    const changedLineIndices = useMemo(() => {
        if (!diffChanges) return [];
        return lines.reduce((acc, line, index) => {
            if (line.type === 'add' || line.type === 'remove') acc.push(index);
            return acc;
        }, [] as number[]);
    }, [diffChanges, lines]);

    useEffect(() => {
        setActiveChange(-1);
        setHighlightedIndex(null);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
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

        const scrollIndex = getScrollIndex(targetLineIndex);
        if (scrollIndex === -1) return;

        const headerHeight = headerRef.current?.offsetHeight ?? 60;
        const lineHeight = 20;
        const offset = -(headerHeight + (3 * lineHeight));

        virtuosoRef.current.scrollToIndex({
            index: scrollIndex,
            align: 'start',
            behavior: 'smooth',
            offset: offset,
        });

        setHighlightedIndex(targetLineIndex);
        highlightTimeoutRef.current = window.setTimeout(() => setHighlightedIndex(null), 1500);
    }, [changedLineIndices, activeChange, getScrollIndex]);

    const panelClose = usePanelClose();
    const handleClose = useCallback((e: React.MouseEvent) => { e.stopPropagation(); panelClose(); }, [panelClose]);

    const handleDiffTypeChange = useCallback((newType: DiffType) => {
        if (newType === diffType) return;
        isInitialLoadRef.current = false;
        dispatch(appSlice.actions.updateDiffPanelParams({ diffType: newType }));
    }, [dispatch, diffType]);

    const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
    const v2Label = version2.id === 'current' ? 'Current note state' : `Version ${(version2 as any).versionNumber}`;
    const isWindowMode = renderMode === 'window';

    const isBusy = isLoading || isFetching;

    return (
        <div className={clsx("v-panel-container is-active", { "v-panel-window-mode": isWindowMode })}>
            <div className="v-inline-panel v-diff-panel">
                <div className={clsx("v-panel-header", { 'is-searching': search.isSearchActive })} ref={headerRef}>
                    <div className="v-panel-header-content">
                        <div className="v-diff-panel-title" onClick={() => setIsMetaCollapsed(v => !v)}>
                            <Icon name={isMetaCollapsed ? 'chevron-right' : 'chevron-down'} />
                            <h3>Comparing</h3>
                            {changedLineIndices.length > 0 && (
                                <div className="v-diff-nav-actions">
                                    <button className="clickable-icon" onClick={(e) => { e.stopPropagation(); scrollToChange('prev'); }}><Icon name="chevron-up" /></button>
                                    <button className="clickable-icon" onClick={(e) => { e.stopPropagation(); scrollToChange('next'); }}><Icon name="chevron-down" /></button>
                                </div>
                            )}
                        </div>
                        <div className="v-panel-header-actions">
                            <button className="clickable-icon" onClick={search.handleToggleSearch} disabled={isBusy}><Icon name="search" /></button>
                            
                            <DiffOptionsDropdown 
                                currentType={diffType} 
                                currentLayout={viewLayout}
                                onSelectType={handleDiffTypeChange}
                                onSelectLayout={setViewLayout}
                            >
                                <button className="clickable-icon v-diff-dropdown-trigger" onClick={e => e.stopPropagation()} disabled={isBusy}>
                                    <Icon name="git-commit-horizontal" />
                                </button>
                            </DiffOptionsDropdown>

                            {!isWindowMode && <button className="clickable-icon v-panel-close" onClick={handleClose}><Icon name="x" /></button>}
                        </div>
                    </div>
                    <div className="v-panel-search-bar-container" onClick={e => e.stopPropagation()}>
                        <div className="v-search-input-wrapper">
                            <div className="v-search-icon" role="button" onClick={search.handleToggleSearch}><Icon name="x-circle" /></div>
                            <input
                                ref={search.searchInputRef}
                                type="search"
                                placeholder="Search diff..."
                                value={search.localSearchQuery}
                                onChange={search.handleSearchInputChange}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { 
                                        e.preventDefault(); 
                                        goToMatch(e.shiftKey ? 'prev' : 'next'); 
                                    }
                                    if (e.key === 'Escape') search.handleToggleSearch();
                                }}
                            />
                            <div className="v-search-input-buttons">
                                {search.searchQuery && totalMatches > 0 && <span className="v-search-match-count">{search.activeMatchIndex + 1} / {totalMatches}</span>}
                                <button className="clickable-icon" disabled={totalMatches === 0} onClick={() => goToMatch('prev')}><Icon name="chevron-up" /></button>
                                <button className="clickable-icon" disabled={totalMatches === 0} onClick={() => goToMatch('next')}><Icon name="chevron-down" /></button>
                                <button className={clsx('clickable-icon', { 'is-active': search.isCaseSensitive })} onClick={search.toggleCaseSensitivity}><Icon name="case-sensitive" /></button>
                                <button className={clsx('clickable-icon', { 'is-hidden': !search.localSearchQuery })} onClick={search.handleClearSearch}><Icon name="x" /></button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="v-diff-panel-content">
                    {isBusy && !diffChanges ? (
                        <div className="is-loading"><div className="loading-spinner" /><p>Calculating diff...</p></div>
                    ) : isError ? (
                        <div className="v-error-message">Failed to compute diff.</div>
                    ) : (
                        <>
                            <div className={clsx("v-diff-meta-container", { 'is-open': !isMetaCollapsed })}>
                                <div className="v-diff-meta-content-wrapper">
                                    <div className="v-meta-label">Base: {v1Label}</div>
                                    <div className="v-meta-label">Compared: {v2Label}</div>
                                </div>
                            </div>
                            <div className="v-diff-content-wrapper" ref={containerScrollerRef}>
                                {isFetching && <div className="v-diff-progress-overlay"><p>Updating...</p></div>}
                                <VirtualizedDiff
                                    lines={lines}
                                    diffType={diffType}
                                    viewLayout={viewLayout}
                                    virtuosoHandleRef={virtuosoRef}
                                    highlightedIndex={highlightedIndex}
                                    searchQuery={search.searchQuery}
                                    isCaseSensitive={search.isCaseSensitive}
                                    activeMatchInfo={lineMatches[search.activeMatchIndex] ?? null}
                                    onLineClick={handleLineClick}
                                    onRangeChanged={(range) => { virtuosoRangeRef.current = range; }}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
