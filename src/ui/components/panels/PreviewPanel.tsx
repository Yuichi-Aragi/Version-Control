import { MarkdownRenderer, moment, Component } from 'obsidian';
import { type FC, useCallback, useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { useAppSelector } from '@/ui/hooks';
import type { PreviewPanel as PreviewPanelState } from '@/state';
import { Icon } from '@/ui/components';
import { VirtualizedPlaintext } from '@/ui/components/shared';
import { useApp } from '@/ui/AppContext';
import clsx from 'clsx';
import { escapeRegExp } from '@/ui/utils/strings';
import { usePanelClose } from '@/ui/hooks';
import { usePanelSearch } from '@/ui/hooks';

interface PreviewPanelProps {
    panelState: PreviewPanelState;
}

export const PreviewPanel: FC<PreviewPanelProps> = ({ panelState }) => {
    const app = useApp();
    const { settings, notePath } = useAppSelector(state => ({
        settings: state.effectiveSettings,
        notePath: state.file?.path ?? '',
    }));
    const [localRenderMarkdown, setLocalRenderMarkdown] = useState(false);
    const markdownRef = useRef<HTMLDivElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const { version, content } = panelState;

    // Initialize search hook
    const search = usePanelSearch();

    // Calculate matches based on hook state
    const matches = useMemo(() => {
        if (!search.searchQuery || !content) return [];
        const regex = new RegExp(escapeRegExp(search.searchQuery), search.isCaseSensitive ? 'g' : 'gi');
        const lines = content.split('\n');
        const allMatches: { lineIndex: number; matchIndexInLine: number }[] = [];
        lines.forEach((line, lineIndex) => {
            const lineMatches = [...line.matchAll(regex)];
            lineMatches.forEach((_, matchIndexInLine) => {
                allMatches.push({ lineIndex, matchIndexInLine });
            });
        });
        return allMatches;
    }, [search.searchQuery, search.isCaseSensitive, content]);

    // Handle navigation locally since totalMatches depends on query
    const handleGoToMatch = useCallback((direction: 'next' | 'prev') => {
        if (matches.length === 0) return;
        search.setActiveMatchIndex(current => {
            if (direction === 'next') {
                return (current + 1) % matches.length;
            } else {
                return (current - 1 + matches.length) % matches.length;
            }
        });
    }, [matches.length, search.setActiveMatchIndex]);

    // Scroll effect
    useEffect(() => {
        if (search.activeMatchIndex > -1 && virtuosoRef.current) {
            const match = matches[search.activeMatchIndex];
            if (match) {
                virtuosoRef.current.scrollToIndex({
                    index: match.lineIndex,
                    align: 'center',
                    behavior: 'smooth',
                });
            }
        }
    }, [search.activeMatchIndex, matches]);

    const shouldRenderMarkdown = notePath.endsWith('.md') && (settings.renderMarkdownInPreview || localRenderMarkdown) && !search.isSearchActive;
    const panelClose = usePanelClose();
    const handleClose = useCallback((e: React.MouseEvent) => { e.stopPropagation(); panelClose(); }, [panelClose]);
    const toggleRenderMode = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setLocalRenderMarkdown(v => !v); }, []);

    useLayoutEffect(() => {
        if (shouldRenderMarkdown && markdownRef.current) {
            const container = markdownRef.current;
            container.empty();
            try {
                MarkdownRenderer.render(app, content, container, notePath, new Component());
            } catch (error) {
                console.error("VC: Failed to render Markdown preview.", error);
                container.setText(content);
            }
        }
    }, [shouldRenderMarkdown, content, notePath, app]);
    
    const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;

    return (
        <div className="v-panel-container is-active">
            <div className="v-inline-panel v-preview-panel">
                <div className="v-preview-panel-content">
                    <div className={clsx("v-panel-header", { 'is-searching': search.isSearchActive })}>
                        <div className="v-panel-header-content">
                            <h3 title={`Timestamp: ${(moment as any)(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`}>
                                {versionLabel}
                            </h3>
                            <div className="v-panel-header-actions">
                                <button className="clickable-icon" aria-label="Search content" onClick={search.handleToggleSearch}>
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
                                <div className="v-search-icon" role="button" aria-label="Close search" onClick={search.handleToggleSearch}>
                                    <Icon name="x-circle" />
                                </div>
                                <input
                                    ref={search.searchInputRef}
                                    type="search"
                                    placeholder="Search content..."
                                    value={search.localSearchQuery}
                                    onChange={search.handleSearchInputChange}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') { 
                                            e.preventDefault(); 
                                            handleGoToMatch(e.shiftKey ? 'prev' : 'next'); 
                                        }
                                        if (e.key === 'Escape') {
                                            search.handleToggleSearch();
                                        }
                                    }}
                                />
                                <div className="v-search-input-buttons">
                                    {search.searchQuery && matches.length > 0 && (
                                        <span className="v-search-match-count">{search.activeMatchIndex + 1} / {matches.length}</span>
                                    )}
                                    <button className="clickable-icon v-search-nav-button" aria-label="Previous match" disabled={matches.length === 0} onClick={() => handleGoToMatch('prev')}>
                                        <Icon name="chevron-up" />
                                    </button>
                                    <button className="clickable-icon v-search-nav-button" aria-label="Next match" disabled={matches.length === 0} onClick={() => handleGoToMatch('next')}>
                                        <Icon name="chevron-down" />
                                    </button>
                                    <button className={clsx('clickable-icon', { 'is-active': search.isCaseSensitive })} aria-label="Toggle case sensitivity" onClick={search.toggleCaseSensitivity}>
                                        <Icon name="case-sensitive" />
                                    </button>
                                    <button className={clsx('clickable-icon', { 'is-hidden': !search.localSearchQuery })} aria-label="Clear search" onClick={search.handleClearSearch}>
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
                                searchQuery={search.searchQuery} 
                                isCaseSensitive={search.isCaseSensitive}
                                scrollerRef={virtuosoRef}
                                activeMatchInfo={matches[search.activeMatchIndex] ?? null}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
