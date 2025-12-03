import clsx from 'clsx';
import { type FC, useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import { Placeholder } from './Placeholder';
import { ErrorDisplay } from './ErrorDisplay';
import { ActionBar } from './ActionBar';
import { HistoryList } from './HistoryList';
import { PanelContainer } from './panels/PanelContainer';
import { SettingsPanel } from './SettingsPanel';
import { KeyUpdateOverlay } from './KeyUpdateOverlay';
import { DiffWindow } from './panels/DiffWindow';
import { thunks } from '../../state/thunks';
import { Icon } from './Icon';
import { HistoryListHeader } from './HistoryListHeader';

export const VersionControlRoot: FC = () => {
    const dispatch = useAppDispatch();
    const { status, error, panel, isProcessing, isRenaming, keyUpdateActive } = useAppSelector(state => ({
        status: state.status,
        error: state.error,
        panel: state.panel,
        isProcessing: state.isProcessing,
        isRenaming: state.isRenaming,
        keyUpdateActive: state.keyUpdateProgress?.active ?? false,
    }));

    const [historyCounts, setHistoryCounts] = useState({ filtered: 0, total: 0 });

    const headerRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement>(null);

    const handleSaveVersionClick = useCallback(() => {
        if (status !== AppStatus.READY || isProcessing || isRenaming) return;
        dispatch(thunks.saveNewVersion());
    }, [dispatch, status, isProcessing, isRenaming]);

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

    const isOverlayActive = panel !== null && panel.type !== 'settings' && !(panel.type === 'diff' && panel.renderMode === 'window');
    
    const rootClassName = clsx(
        'version-control-content',
        { 'is-overlay-active': isOverlayActive },
        { 'is-processing': isProcessing || isRenaming }
    );

    const renderContent = () => {
        if (keyUpdateActive) {
            return <KeyUpdateOverlay />;
        }

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
                            <SettingsPanel />
                            <button
                                className="v-fab-save-button"
                                aria-label="Save a new version of the current note"
                                onClick={handleSaveVersionClick}
                                disabled={isProcessing || isRenaming}
                            >
                                <Icon name="plus" />
                            </button>
                        </div>
                    </>
                );
            default:
                return <Placeholder title="An unexpected error occurred in the view." iconName="alert-circle" />;
        }
    };

    return (
        <div className={rootClassName}>
            {renderContent()}
            { !keyUpdateActive && <PanelContainer /> }
            { panel?.type === 'diff' && panel.renderMode === 'window' && <DiffWindow panelState={panel} /> }
        </div>
    );
};
