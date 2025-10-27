// src/ui/components/panels/PreviewPanel.tsx
import { MarkdownRenderer, moment, Component, debounce } from 'obsidian';
import { type FC, useCallback, useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { actions } from '../../../state/appSlice';
import type { PreviewPanel as PreviewPanelState } from '../../../state/state';
import { Icon } from '../Icon';
import { VirtualizedPlaintext } from '../shared/VirtualizedPlaintext';
import { useApp } from '../../AppContext';
import clsx from 'clsx';
import { escapeRegExp } from '../../utils/strings';

interface PreviewPanelProps {
    panelState: PreviewPanelState;
}

export const PreviewPanel: FC<PreviewPanelProps> = ({ panelState }) => {
    const app = useApp();
    const dispatch = useAppDispatch();
    const { settings, notePath } = useAppSelector(state => ({
        settings: state.settings,
        notePath: state.file?.path ?? '',
    }));
    const [localRenderMarkdown, setLocalRenderMarkdown] = useState(false);
    const markdownRef = useRef<HTMLDivElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Search and navigation state
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [isCaseSensitive, setIsCaseSensitive] = useState(false);
    const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const debouncedSetSearchQuery = useCallback(debounce(setSearchQuery, 300, true), []);
    
    const { version, content } = panelState;

    const matches = useMemo(() => {
        if (!searchQuery || !content) return [];
        const regex = new RegExp(escapeRegExp(searchQuery), isCaseSensitive ? 'g' : 'gi');
        const lines = content.split('\n');
        const allMatches: { lineIndex: number; matchIndexInLine: number }[] = [];
        lines.forEach((line, lineIndex) => {
            const lineMatches = [...line.matchAll(regex)];
            lineMatches.forEach((_, matchIndexInLine) => {
                allMatches.push({ lineIndex, matchIndexInLine });
            });
        });
        return allMatches;
    }, [searchQuery, isCaseSensitive, content]);

    const goToMatch = useCallback((direction: 'next' | 'prev') => {
        if (matches.length === 0) return;
        const nextIndex = direction === 'next'
            ? (activeMatchIndex + 1) % matches.length
            : (activeMatchIndex - 1 + matches.length) % matches.length;
        setActiveMatchIndex(nextIndex);
    }, [activeMatchIndex, matches.length]);

    useEffect(() => {
        setActiveMatchIndex(-1);
    }, [searchQuery, isCaseSensitive]);

    useEffect(() => {
        if (activeMatchIndex > -1 && virtuosoRef.current) {
            const match = matches[activeMatchIndex];
            if (match) {
                virtuosoRef.current.scrollToIndex({
                    index: match.lineIndex,
                    align: 'center',
                    behavior: 'smooth',
                });
            }
        }
    }, [activeMatchIndex, matches]);

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

    const shouldRenderMarkdown = notePath.endsWith('.md') && (settings.renderMarkdownInPreview || localRenderMarkdown) && !isSearchActive;

    const handleClose = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        dispatch(actions.closePanel());
    }, [dispatch]);

    const toggleRenderMode = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setLocalRenderMarkdown(v => !v);
    }, []);

    useLayoutEffect(() => {
        if (shouldRenderMarkdown && markdownRef.current) {
            const container = markdownRef.current;
            container.empty();
            try {
                MarkdownRenderer.render(app, content, container, notePath, new Component());
            } catch (error) {
                console.error("VC: Failed to render Markdown preview in panel.", error);
                container.setText(content);
            }
        }
    }, [shouldRenderMarkdown, content, notePath, app]);
    
    const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;

    return (
        <div className="v-panel-container is-active">
            <div className="v-inline-panel v-preview-panel">
                <div className="v-preview-panel-content">
                    <div className={clsx("v-panel-header", { 'is-searching': isSearchActive })}>
                        <div className="v-panel-header-content">
                            <h3 title={`Timestamp: ${(moment as any)(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`}>
                                {versionLabel}
                            </h3>
                            <div className="v-panel-header-actions">
                                <button className="clickable-icon" aria-label="Search content" onClick={handleToggleSearch}>
                                    <Icon name="search" />
                                </button>
                                {notePath.endsWith('.md') && !settings.renderMarkdownInPreview && (
                                    <button className="v-action-btn v-preview-toggle-btn" aria-label="Toggle markdown rendering" onClick={toggleRenderMode}>
                                        <Icon name={localRenderMarkdown ? "code" : "book-open"} />
                                    </button>
                                )}
                                <button className="clickable-icon v-panel-close" aria-label="Close preview" onClick={handleClose}>
                                    <Icon name="x" />
                                </button>
                            </div>
                        </div>
                        <div className="v-panel-search-bar-container">
                            <div className="v-search-input-wrapper">
                                <div className="v-search-icon" role="button" aria-label="Close search" onClick={handleToggleSearch}>
                                    <Icon name="x-circle" />
                                </div>
                                <input
                                    ref={searchInputRef}
                                    type="search"
                                    placeholder="Search content..."
                                    value={localSearchQuery}
                                    onChange={handleSearchInputChange}
                                    onKeyDown={handleSearchKeyDown}
                                />
                                <div className="v-search-input-buttons">
                                    {searchQuery && matches.length > 0 && (
                                        <span className="v-search-match-count">{activeMatchIndex + 1} / {matches.length}</span>
                                    )}
                                    <button className="clickable-icon v-search-nav-button" aria-label="Previous match" disabled={matches.length === 0} onClick={() => goToMatch('prev')}>
                                        <Icon name="chevron-up" />
                                    </button>
                                    <button className="clickable-icon v-search-nav-button" aria-label="Next match" disabled={matches.length === 0} onClick={() => goToMatch('next')}>
                                        <Icon name="chevron-down" />
                                    </button>
                                    <button className={clsx('clickable-icon', { 'is-active': isCaseSensitive })} aria-label="Toggle case sensitivity" onClick={() => setIsCaseSensitive(v => !v)}>
                                        <Icon name="case-sensitive" />
                                    </button>
                                    <button className={clsx('clickable-icon', { 'is-hidden': !localSearchQuery })} aria-label="Clear search" onClick={handleClearSearch}>
                                        <Icon name="x" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className={clsx("v-version-content-preview", { 'is-plaintext': !shouldRenderMarkdown })}>
                        {shouldRenderMarkdown ? (
                            <div ref={markdownRef} />
                        ) : (
                            <VirtualizedPlaintext 
                                content={content} 
                                searchQuery={searchQuery} 
                                isCaseSensitive={isCaseSensitive}
                                scrollerRef={virtuosoRef}
                                activeMatchInfo={matches[activeMatchIndex] ?? null}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};