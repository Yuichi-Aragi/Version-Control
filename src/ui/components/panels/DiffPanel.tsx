import { moment, debounce } from 'obsidian';
import type { FC, ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Progress from '@radix-ui/react-progress';
import type { VirtuosoHandle } from 'react-virtuoso';
import clsx from 'clsx';
import { useAppDispatch } from '../../hooks/useRedux';
import { actions } from '../../../state/appSlice';
import { thunks } from '../../../state/thunks';
import type { DiffPanel as DiffPanelState } from '../../../state/state';
import type { DiffType } from '../../../types';
import { Icon } from '../Icon';
import { VirtualizedDiff, processLineChanges, type DiffLineData } from '../shared/VirtualizedDiff';
import { escapeRegExp } from '../../utils/strings';

interface DiffPanelProps {
    panelState: DiffPanelState;
}

const DIFF_OPTIONS: { type: DiffType; label: string }[] = [
    { type: 'lines', label: 'Line Diff' },
    { type: 'words', label: 'Word Diff' },
    { type: 'chars', label: 'Character Diff' },
    { type: 'json', label: 'JSON Diff' },
];

const DiffDropdown: FC<{
    currentType: DiffType;
    onSelect: (type: DiffType) => void;
    children: ReactNode;
}> = ({ currentType, onSelect, children }) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
            <DropdownMenu.Content className="v-diff-dropdown-content" sideOffset={5} collisionPadding={10}>
                {DIFF_OPTIONS.map(({ type, label }) => (
                    <DropdownMenu.Item key={type} className="v-diff-dropdown-item" onSelect={() => onSelect(type)}>
                        {label}
                        {currentType === type && <Icon name="check" />}
                    </DropdownMenu.Item>
                ))}
            </DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
);

export const DiffPanel: FC<DiffPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const { version1, version2, diffChanges, diffType, isReDiffing } = panelState;

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const unifiedViewRef = useRef<HTMLPreElement>(null);

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
            setLines(processLineChanges(diffChanges));
        } else {
            setLines([]);
        }
    }, [diffChanges]);

    const handleLineClick = useCallback((clickedLineData: DiffLineData) => {
        let targetLineNum: number | undefined;

        if (clickedLineData.newLineNum !== undefined) {
            targetLineNum = clickedLineData.newLineNum;
        } else if (clickedLineData.type === 'remove') {
            const clickedLineIndex = lines.findIndex(l => l.key === clickedLineData.key);
            if (clickedLineIndex !== -1) {
                // Find the line number of the last non-removed line *before* this one.
                for (let i = clickedLineIndex - 1; i >= 0; i--) {
                    const prevLine = lines[i];
                    if (prevLine?.newLineNum !== undefined) {
                        // The target is the line *after* the last known good line.
                        targetLineNum = prevLine.newLineNum + 1;
                        break;
                    }
                }
            }
            // If the removed block is at the very top, there's no preceding line.
            // In this case, we scroll to the first line of the document.
            if (targetLineNum === undefined) {
                targetLineNum = 1;
            }
        }

        if (targetLineNum !== undefined) {
            dispatch(thunks.scrollToLineInEditor(targetLineNum));
        }
    }, [dispatch, lines]);

    const debouncedSetSearchQuery = useCallback(debounce(setSearchQuery, 300, true), []);

    const lineMatches = useMemo(() => {
        if (diffType !== 'lines' || !searchQuery || !diffChanges) return [];
        const regex = new RegExp(escapeRegExp(searchQuery), isCaseSensitive ? 'g' : 'gi');
        const allMatches: { lineIndex: number; matchIndexInLine: number }[] = [];
        lines.forEach((line, lineIndex) => {
            const lineContentMatches = [...line.content.matchAll(regex)];
            lineContentMatches.forEach((_, matchIndexInLine) => {
                allMatches.push({ lineIndex, matchIndexInLine });
            });
        });
        return allMatches;
    }, [searchQuery, isCaseSensitive, diffChanges, diffType, lines]);

    useEffect(() => {
        if (diffType !== 'lines' && searchQuery && unifiedViewRef.current) {
            const marks = Array.from(unifiedViewRef.current.querySelectorAll('mark'));
            setUnifiedMatches(marks);
        } else {
            setUnifiedMatches([]);
        }
    }, [searchQuery, isCaseSensitive, diffType, diffChanges]);

    const totalMatches = diffType === 'lines' ? lineMatches.length : unifiedMatches.length;

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

        if (diffType === 'lines') {
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
    }, [activeMatchIndex, diffType, lineMatches, unifiedMatches]);

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

    useEffect(() => {
        if (isSearchActive && searchInputRef.current) {
            const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
        }
        return;
    }, [isSearchActive]);

    const [activeChange, setActiveChange] = useState(-1);
    const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

    const changedLineIndices = useMemo(() => {
        if (diffType !== 'lines' || !diffChanges) return [];
        return lines.reduce((acc, line, index) => {
            if (line.type === 'add' || line.type === 'remove') {
                acc.push(index);
            }
            return acc;
        }, [] as number[]);
    }, [diffChanges, diffType, lines]);

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

    const handleClose = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        dispatch(actions.closePanel());
    }, [dispatch]);

    const handleDiffTypeChange = useCallback((newType: DiffType) => {
        if (newType !== diffType) {
            dispatch(thunks.recomputeDiff(newType));
        }
    }, [dispatch, diffType]);

    const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
    const v2Label = version2.id === 'current'
        ? 'Current note state'
        : 'versionNumber' in version2
            ? (version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`)
            : version2.name;

    return (
        <div className="v-panel-container is-active">
            <div className="v-inline-panel v-diff-panel">
                <div className={clsx("v-panel-header", { 'is-searching': isSearchActive })} ref={headerRef}>
                    <div className="v-panel-header-content">
                        <div className="v-diff-panel-title" onClick={() => setIsMetaCollapsed(v => !v)}>
                            <Icon name={isMetaCollapsed ? 'chevron-right' : 'chevron-down'} />
                            <h3>Comparing</h3>
                            {diffType === 'lines' && changedLineIndices.length > 0 && (
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
                            <button className="clickable-icon v-panel-close" aria-label="Close diff" title="Close diff" onClick={handleClose}>
                                <Icon name="x" />
                            </button>
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
                            <div className="v-diff-content-wrapper">
                                {isReDiffing && (
                                    <div className="v-diff-progress-overlay">
                                        <p>Calculating {diffType} diff...</p>
                                        <Progress.Root className="v-diff-progress-bar" value={null}>
                                            <Progress.Indicator className="v-diff-progress-indicator" />
                                        </Progress.Root>
                                    </div>
                                )}
                                <VirtualizedDiff
                                    changes={diffChanges}
                                    diffType={diffType}
                                    scrollerRef={virtuosoRef}
                                    unifiedViewRef={unifiedViewRef}
                                    highlightedIndex={highlightedIndex}
                                    searchQuery={searchQuery}
                                    isCaseSensitive={isCaseSensitive}
                                    activeMatchInfo={diffType === 'lines' ? (lineMatches[activeMatchIndex] ?? null) : null}
                                    activeUnifiedMatchIndex={diffType !== 'lines' ? activeMatchIndex : -1}
                                    onLineClick={handleLineClick}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
