import { debounce } from 'obsidian';
import clsx from 'clsx';
import { type FC, type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import { actions } from '../../state/appSlice';
import { thunks } from '../../state/thunks';
import { Icon } from './Icon';

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
        settings, 
        watchModeCountdown, 
        history, 
        panel 
    } = useAppSelector(state => ({
        status: state.status,
        isSearchActive: state.isSearchActive,
        searchQuery: state.searchQuery,
        isSearchCaseSensitive: state.isSearchCaseSensitive,
        isProcessing: state.isProcessing,
        isRenaming: state.isRenaming,
        diffRequest: state.diffRequest,
        settings: state.settings,
        watchModeCountdown: state.watchModeCountdown,
        history: state.history,
        panel: state.panel,
    }));

    const [localQuery, setLocalQuery] = useState(globalSearchQuery);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setLocalQuery(globalSearchQuery);
    }, [globalSearchQuery]);

    const isBusy = isProcessing || isRenaming;

    const handleSaveVersionClick = useCallback(() => {
        if (status !== AppStatus.READY || isBusy) return;
        dispatch(thunks.saveNewVersion());
    }, [dispatch, status, isBusy]);

    const handleDiffIndicatorClick = useCallback(() => {
        if (diffRequest?.status === 'ready') {
            dispatch(thunks.viewReadyDiff());
        }
    }, [dispatch, diffRequest]);

    const handleToggleSearch = useCallback(() => {
        if (status !== AppStatus.READY) return;
        dispatch(actions.toggleSearch(!isSearchActive));
    }, [dispatch, status, isSearchActive]);

    const handleToggleSettings = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        if (status !== AppStatus.READY) return;
        if (panel?.type === 'settings') {
            dispatch(actions.closePanel());
        } else {
            dispatch(actions.openPanel({ type: 'settings' }));
        }
    }, [dispatch, status, panel]);

    const debouncedSearch = useCallback(debounce((value: string) => {
        dispatch(actions.setSearchQuery(value));
    }, 300), [dispatch]);

    const handleSearchInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalQuery(value);
        debouncedSearch(value);
    }, [debouncedSearch]);

    const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setLocalQuery('');
            dispatch(actions.setSearchQuery(''));
            dispatch(actions.toggleSearch(false));
        }
    }, [dispatch]);

    const handleCaseToggle = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        dispatch(actions.setSearchCaseSensitivity(!isSearchCaseSensitive));
    }, [dispatch, isSearchCaseSensitive]);

    const handleClearSearch = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        setLocalQuery('');
        dispatch(actions.setSearchQuery(''));
        searchInputRef.current?.focus();
    }, [dispatch]);

    const handleShowSortMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        dispatch(thunks.showSortMenu());
    }, [dispatch]);

    useEffect(() => {
        if (isSearchActive && document.activeElement !== searchInputRef.current) {
            const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
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

    return (
        <div className={clsx('v-actions-container', { 'is-searching': isSearchActive })}>
            <div className="v-top-actions">
                <div className="v-top-actions-left-group">
                    <button 
                        className="v-save-button" 
                        aria-label="Save a new version of the current note"
                        onClick={handleSaveVersionClick}
                        disabled={isBusy}
                    >
                        Save new version
                    </button>
                    {settings.enableWatchMode && watchModeCountdown !== null && !isProcessing && (
                        <div className="v-watch-mode-timer">({watchModeCountdown}s)</div>
                    )}
                </div>
                <div className="v-top-actions-right-group">
                    <button 
                        className={diffIndicatorClasses} 
                        aria-label={diffIndicatorAriaLabel}
                        onClick={handleDiffIndicatorClick}
                        disabled={isDiffGenerating || (diffRequest?.status === 'ready' && isBusy)}
                    >
                        <Icon name={diffIndicatorIcon} />
                    </button>
                    {history.length > 0 && (
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
