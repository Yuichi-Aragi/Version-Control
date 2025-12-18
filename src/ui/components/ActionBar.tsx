import { debounce } from 'obsidian';
import clsx from 'clsx';
import { type FC, type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { AppStatus } from '@/state';
import { appSlice } from '@/state';
import { thunks } from '@/state';
import { Icon } from '@/ui/components';

export const ActionBar: FC = () => {
    const dispatch = useAppDispatch();
    const { 
        status, 
        isSearchActive, 
        searchQuery: globalSearchQuery, 
        isSearchCaseSensitive, 
        isProcessing, 
        isRenaming,
        diffRequest, 
        settings, // Effective settings
        watchModeCountdown, 
        history, 
        editHistory,
        viewMode,
        panel,
        currentBranch,
        availableBranches,
    } = useAppSelector(state => ({
        status: state.status,
        isSearchActive: state.isSearchActive,
        searchQuery: state.searchQuery,
        isSearchCaseSensitive: state.isSearchCaseSensitive,
        isProcessing: state.isProcessing,
        isRenaming: state.isRenaming,
        diffRequest: state.diffRequest,
        settings: state.effectiveSettings,
        watchModeCountdown: state.watchModeCountdown,
        history: state.history,
        editHistory: state.editHistory,
        viewMode: state.viewMode,
        panel: state.panel,
        currentBranch: state.currentBranch,
        availableBranches: state.availableBranches,
    }));

    const [localQuery, setLocalQuery] = useState(globalSearchQuery);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setLocalQuery(globalSearchQuery);
    }, [globalSearchQuery]);

    const isBusy = isProcessing || isRenaming;

    const handleOpenDiffPanel = useCallback(() => {
        if (diffRequest?.status === 'ready') {
            dispatch(thunks.viewReadyDiff('panel'));
        }
    }, [dispatch, diffRequest]);

    const handleOpenDiffWindow = useCallback(() => {
        if (diffRequest?.status === 'ready') {
            dispatch(thunks.viewReadyDiff('window'));
        }
    }, [dispatch, diffRequest]);

    const handleToggleSearch = useCallback(() => {
        if (status !== AppStatus.READY) return;
        dispatch(appSlice.actions.toggleSearch(!isSearchActive));
    }, [dispatch, status, isSearchActive]);

    const handleToggleSettings = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        if (status !== AppStatus.READY) return;
        if (panel?.type === 'settings') {
            dispatch(appSlice.actions.closePanel());
        } else {
            dispatch(appSlice.actions.openPanel({ type: 'settings' }));
        }
    }, [dispatch, status, panel]);

    const debouncedSearch = useCallback(debounce((value: string) => {
        dispatch(appSlice.actions.setSearchQuery(value));
    }, 300), [dispatch]);

    const handleSearchInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalQuery(value);
        debouncedSearch(value);
    }, [debouncedSearch]);

    const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setLocalQuery('');
            dispatch(appSlice.actions.setSearchQuery(''));
            dispatch(appSlice.actions.toggleSearch(false));
        }
    }, [dispatch]);

    const handleCaseToggle = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        dispatch(appSlice.actions.setSearchCaseSensitivity(!isSearchCaseSensitive));
    }, [dispatch, isSearchCaseSensitive]);

    const handleClearSearch = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        setLocalQuery('');
        dispatch(appSlice.actions.setSearchQuery(''));
        searchInputRef.current?.focus();
    }, [dispatch]);

    const handleShowSortMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        dispatch(thunks.showSortMenu());
    }, [dispatch]);

    const handleOpenBranchDrawer = useCallback(() => {
        if (status !== AppStatus.READY || isBusy) return;
        dispatch(thunks.showBranchSwitcher());
    }, [dispatch, status, isBusy]);

    const handleOpenTimeline = useCallback(() => {
        if (status !== AppStatus.READY || isBusy) return;
        dispatch(thunks.openTimeline());
    }, [dispatch, status, isBusy]);

    const handleOpenDashboard = useCallback(() => {
        if (status !== AppStatus.READY || isBusy) return;
        dispatch(thunks.openDashboard());
    }, [dispatch, status, isBusy]);

    const handleToggleViewMode = useCallback(() => {
        if (status !== AppStatus.READY || isBusy) return;
        dispatch(thunks.toggleViewMode());
    }, [dispatch, status, isBusy]);

    useEffect(() => {
        if (isSearchActive) {
            if (document.activeElement !== searchInputRef.current) {
                const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
                return () => clearTimeout(timer);
            }
        } else {
            if (document.activeElement === searchInputRef.current) {
                searchInputRef.current?.blur();
            }
        }
        return; // Explicitly return for all code paths.
    }, [isSearchActive]);

    if (status !== AppStatus.READY && status !== AppStatus.LOADING) {
        return null;
    }
    
    const isDiffGenerating = diffRequest?.status === 'generating' || diffRequest?.status === 're-diffing';
    const diffIndicatorClasses = clsx('clickable-icon', 'v-diff-indicator', {
        'is-hidden': !diffRequest,
        'is-generating': isDiffGenerating,
        'is-ready': diffRequest?.status === 'ready',
    });

    const diffIndicatorIcon = isDiffGenerating ? 'loader' : 'diff';
    const diffIndicatorAriaLabel = isDiffGenerating ? 'Diff is being generated...' : 'Diff is ready. Click to view.';

    const hasHistory = viewMode === 'versions' ? history.length > 0 : editHistory.length > 0;
    const switchViewLabel = viewMode === 'versions' ? 'Switch to Edit History' : 'Switch to Version History';

    return (
        <div className={clsx('v-actions-container', { 'is-searching': isSearchActive })}>
            <div className="v-top-actions">
                <div className="v-top-actions-left-group">
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <button
                                className="clickable-icon"
                                aria-label="More options"
                                disabled={isBusy}
                            >
                                <Icon name="menu" />
                            </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                            <DropdownMenu.Content className="v-actionbar-dropdown-content" sideOffset={5} collisionPadding={10}>
                                <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={handleToggleViewMode}>
                                    <span>{switchViewLabel}</span>
                                    <Icon name={viewMode === 'versions' ? 'file-edit' : 'history'} />
                                </DropdownMenu.Item>
                                <div className="v-diff-separator" />
                                <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={handleOpenBranchDrawer}>
                                    <span>Branches</span>
                                    <Icon name="git-branch" />
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={handleOpenTimeline}>
                                    <span>Timeline</span>
                                    <Icon name="history" />
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={handleOpenDashboard}>
                                    <span>Dashboard</span>
                                    <Icon name="layout-dashboard" />
                                </DropdownMenu.Item>
                            </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                    
                    <div className="v-branch-switcher-container">
                        {availableBranches.length > 1 && (
                            <button className="v-branch-switcher-button" onClick={handleOpenBranchDrawer} disabled={isBusy}>
                                <Icon name="git-branch" />
                                <span>{currentBranch}</span>
                            </button>
                        )}
                        {settings.enableWatchMode && watchModeCountdown !== null && !isProcessing && (
                            <div className="v-watch-mode-timer" title="Time until next auto-save">({watchModeCountdown}s)</div>
                        )}
                    </div>
                </div>
                <div className="v-top-actions-right-group">
                    {diffRequest?.status === 'ready' ? (
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                                <button 
                                    className={diffIndicatorClasses} 
                                    aria-label={diffIndicatorAriaLabel}
                                    disabled={isBusy}
                                >
                                    <Icon name={diffIndicatorIcon} />
                                </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                                <DropdownMenu.Content className="v-actionbar-dropdown-content" sideOffset={5} collisionPadding={10}>
                                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={handleOpenDiffPanel}>
                                        <span>Open in panel</span>
                                        <Icon name="layout-sidebar-right" />
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={handleOpenDiffWindow}>
                                        <span>Open in window</span>
                                        <Icon name="app-window" />
                                    </DropdownMenu.Item>
                                </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                    ) : (
                        <button 
                            className={diffIndicatorClasses} 
                            aria-label={diffIndicatorAriaLabel}
                            disabled={true}
                        >
                            <Icon name={diffIndicatorIcon} />
                        </button>
                    )}
                    
                    {hasHistory && (
                        <>
                            <button 
                                className={clsx('clickable-icon', { 'is-active': isSearchActive })} 
                                aria-label="Search history"
                                onClick={handleToggleSearch}
                                disabled={isBusy}
                            >
                                <Icon name="search" />
                            </button>
                            <button 
                                className={clsx('clickable-icon', { 'is-active': panel?.type === 'settings' })} 
                                aria-label="Toggle settings"
                                onClick={handleToggleSettings}
                                disabled={isBusy}
                            >
                                <Icon name="settings-2" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className={clsx('v-search-bar-container', { 'is-query-active': localQuery.trim().length > 0 })}>
                <div className="v-search-input-wrapper">
                    <div 
                        className="v-search-icon" 
                        role="button" 
                        aria-label="Close search" 
                        onMouseDown={(e) => { e.preventDefault(); handleToggleSearch(); }}
                    >
                        <Icon name="x-circle" />
                    </div>
                    <input
                        ref={searchInputRef}
                        type="search"
                        placeholder="Search versions..."
                        aria-label="Search versions by name, date, or size"
                        value={localQuery}
                        onChange={handleSearchInputChange}
                        onKeyDown={handleSearchKeyDown}
                    />
                    <div className="v-search-input-buttons">
                        <button 
                            className={clsx('clickable-icon', { 'is-active': isSearchCaseSensitive })} 
                            aria-label="Toggle case sensitivity"
                            onMouseDown={handleCaseToggle}
                        >
                            <Icon name="case-sensitive" />
                        </button>
                        <button 
                            className={clsx('clickable-icon', { 'is-hidden': !localQuery })} 
                            aria-label="Clear search"
                            onMouseDown={handleClearSearch}
                        >
                            <Icon name="x" />
                        </button>
                    </div>
                </div>
                <button 
                    className="clickable-icon v-filter-button" 
                    aria-label="Sort options"
                    onMouseDown={handleShowSortMenu}
                >
                    <Icon name="filter" />
                </button>
            </div>
        </div>
    );
};
