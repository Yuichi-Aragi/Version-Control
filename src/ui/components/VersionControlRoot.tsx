import clsx from 'clsx';
import { type FC, useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { AppStatus } from '@/state';
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

export const VersionControlRoot: FC = () => {
    const dispatch = useAppDispatch();
    const { status, error, panel, isProcessing, isRenaming, viewMode } = useAppSelector(state => ({
        status: state.app.status,
        error: state.app.error,
        panel: state.app.panel,
        isProcessing: state.app.isProcessing,
        isRenaming: state.app.isRenaming,
        viewMode: state.app.viewMode,
    }));

    const [historyCounts, setHistoryCounts] = useState({ filtered: 0, total: 0 });

    const headerRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement>(null);

    const handleSaveClick = useCallback(() => {
        if (status !== AppStatus.READY || isProcessing || isRenaming) return;
        if (viewMode === 'versions') {
            dispatch(thunks.saveNewVersion({}));
        } else {
            dispatch(thunks.saveNewEdit());
        }
    }, [dispatch, status, isProcessing, isRenaming, viewMode]);

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
    }, [status]);

    // Determine if an overlay is active to disable background interactions.
    // Note: Settings panel is treated as an overlay here to prevent click-through issues
    // to the ActionBar underneath it.
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
                        {/* 
                            MOVED: SettingsPanel is now a direct child of the content wrapper, 
                            placing it later in the DOM than the header. This ensures its z-index (40) 
                            correctly stacks above the header (10), preventing click-through issues 
                            regardless of the stacking context of .v-main.
                        */}
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