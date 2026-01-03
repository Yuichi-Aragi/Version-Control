import clsx from 'clsx';
import { type FC, useCallback, useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { AppStatus, appSlice } from '@/state';
import { Placeholder } from '@/ui/components';
import { ErrorDisplay } from './ErrorDisplay';
import { ActionBar } from './ActionBar';
import { HistoryList } from './HistoryList';
import { PanelContainer } from './panels/PanelContainer';
import { SettingsPanel } from './SettingsPanel';
import { DiffWindow } from './panels/DiffWindow';
import { thunks } from '@/state';
import { Icon } from '@/ui/components';
import { HistoryListHeader } from '@/ui/components';
import { useGetEffectiveSettingsQuery, useGetBranchesQuery } from '@/state/apis/history.api';

export const VersionControlRoot: FC = () => {
    const dispatch = useAppDispatch();
    const { status, error, panel, isProcessing, isRenaming, viewMode, noteId, currentBranch } = useAppSelector(state => ({
        status: state.app.status,
        error: state.app.error,
        panel: state.app.panel,
        isProcessing: state.app.isProcessing,
        isRenaming: state.app.isRenaming,
        viewMode: state.app.viewMode,
        noteId: state.app.noteId,
        currentBranch: state.app.currentBranch,
    }));

    const [historyCounts, setHistoryCounts] = useState({ filtered: 0, total: 0 });

    const headerRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement>(null);

    // --- RTK Query: Fetch Branches & Settings ---
    // We only fetch if we have a noteId and status suggests we are ready/loading
    const shouldFetch = !!noteId && (status === AppStatus.READY || status === AppStatus.LOADING);

    // 1. Fetch Branches to determine current branch
    const { data: queryBranchData, isLoading: isBranchesLoading } = useGetBranchesQuery(noteId!, { 
        skip: !shouldFetch 
    });
    // Defensive: If noteId is null, force undefined to prevent ghost data
    const branchData = noteId ? queryBranchData : undefined;

    // 2. Fetch Effective Settings based on resolved branch
    const branchToUse = (noteId && branchData?.currentBranch) || currentBranch || 'main'; // Fallback to main
    const { 
        data: settingsData, 
        isLoading: isSettingsLoading, 
        isError: isSettingsError 
    } = useGetEffectiveSettingsQuery({
        noteId: noteId,
        viewMode: viewMode,
        branchName: branchToUse
    }, {
        skip: !shouldFetch
    });

    // 3. Sync Settings to Redux Slice
    // This ensures legacy thunks and selectors that rely on state.app.effectiveSettings still work
    useEffect(() => {
        if (settingsData) {
            dispatch(appSlice.actions.updateEffectiveSettings(settingsData));
        } else if (isSettingsError) {
            // Fallback: If settings fetch fails, we still need to transition to READY to avoid getting stuck.
            dispatch(appSlice.actions.setStatus(AppStatus.READY));
        }
    }, [settingsData, isSettingsError, dispatch]);

    // 4. Determine if we are in a "Loading Settings" state
    // We block rendering of the main content until settings are applied to prevent UI jumps
    // CRITICAL FIX: If isSettingsError is true, we stop blocking to allow the UI to render (likely with defaults or error state)
    const isInitializingSettings = shouldFetch && (isBranchesLoading || isSettingsLoading || (!settingsData && !isSettingsError));

    const handleSaveClick = useCallback(() => {
        if (status !== AppStatus.READY || isProcessing || isRenaming || isInitializingSettings) return;
        if (viewMode === 'versions') {
            dispatch(thunks.saveNewVersion({}));
        } else {
            dispatch(thunks.saveNewEdit());
        }
    }, [dispatch, status, isProcessing, isRenaming, viewMode, isInitializingSettings]);

    const handleCountChange = useCallback((filteredCount: number, totalCount: number) => {
        setHistoryCounts({ filtered: filteredCount, total: totalCount });
    }, []);

    useLayoutEffect(() => {
        const headerEl = headerRef.current;
        const mainEl = mainRef.current;
        if (headerEl && mainEl) {
            const setPadding = () => {
                mainEl.style.paddingTop = `${headerEl.offsetHeight}px`;
            };
            const resizeObserver = new ResizeObserver(setPadding);
            resizeObserver.observe(headerEl);
            setPadding();
            return () => resizeObserver.disconnect();
        }
        return () => {};
    }, [status, isInitializingSettings]);

    const isOverlayActive = panel !== null && !(panel.type === 'diff' && panel.renderMode === 'window');
    
    const rootClassName = clsx(
        'version-control-content',
        { 'is-overlay-active': isOverlayActive },
        { 'is-processing': isProcessing || isRenaming }
    );

    const saveLabel = viewMode === 'versions' ? "Save a new version" : "Save a new edit";

    const renderContent = () => {
        switch (status) {
            case AppStatus.INITIALIZING:
                return <Placeholder title="Initializing version control..." iconName="sync" />;
            case AppStatus.PLACEHOLDER:
                return <Placeholder />;
            case AppStatus.ERROR:
                return error ? <ErrorDisplay error={error} /> : <Placeholder title="An unknown error occurred." iconName="alert-circle" />;
            case AppStatus.LOADING:
            case AppStatus.READY:
                if (isInitializingSettings) {
                    return <Placeholder title="Loading settings..." iconName="loader" />;
                }
                return (
                    <>
                        <div ref={headerRef} className="v-header-wrapper">
                            <ActionBar />
                            <HistoryListHeader
                                status={status}
                                filteredCount={historyCounts.filtered}
                                totalCount={historyCounts.total}
                            />
                        </div>
                        <div ref={mainRef} className="v-main">
                            <div className="v-ready-state-container">
                                <HistoryList 
                                    key={viewMode} // FIX: Force remount on view mode change to reset RTK Query hooks
                                    onCountChange={handleCountChange}
                                />
                            </div>
                            <button
                                className="v-fab-save-button"
                                aria-label={saveLabel}
                                onClick={handleSaveClick}
                                disabled={isProcessing || isRenaming}
                                title={saveLabel}
                            >
                                <Icon name="plus" />
                            </button>
                        </div>
                        <SettingsPanel />
                    </>
                );
            default:
                return <Placeholder title="An unexpected error occurred in the view." iconName="alert-circle" />;
        }
    };

    return (
        <div className={rootClassName}>
            {renderContent()}
            <PanelContainer />
            { panel?.type === 'diff' && panel.renderMode === 'window' && <DiffWindow panelState={panel} /> }
        </div>
    );
};
