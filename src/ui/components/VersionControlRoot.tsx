import clsx from 'clsx';
import type { FC } from 'react';
import { useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import { Placeholder } from './Placeholder';
import { ErrorDisplay } from './ErrorDisplay';
import { ActionBar } from './ActionBar';
import { HistoryList } from './HistoryList';
import { PanelContainer } from './panels/PanelContainer';
import { SettingsPanel } from './SettingsPanel';
import { KeyUpdateOverlay } from './KeyUpdateOverlay';

export const VersionControlRoot: FC = () => {
    const { status, error, panel, isProcessing, isRenaming, keyUpdateActive } = useAppSelector(state => ({
        status: state.status,
        error: state.error,
        panel: state.panel,
        isProcessing: state.isProcessing,
        isRenaming: state.isRenaming,
        keyUpdateActive: state.keyUpdateProgress?.active ?? false,
    }));

    const isOverlayActive = panel !== null && panel.type !== 'settings';
    
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
                        <div className="v-top-container">
                            <ActionBar />
                        </div>
                        <div className="v-main">
                            <div className="v-ready-state-container">
                                <HistoryList />
                            </div>
                            <SettingsPanel />
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
        </div>
    );
};
