import clsx from 'clsx';
import { type FC, memo, useState, useEffect, type SyntheticEvent } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { GlobalSettings } from './settings/GlobalSettings';
import { NoteSpecificSettings } from './settings/NoteSpecificSettings';
import { Icon } from '@/ui/components';
import { appSlice } from '@/state';
import { useNoteActions } from '@/ui/hooks/useNoteActions';

// Helper to aggressively stop event propagation to prevent "click-through" issues
const stopPropagation = (e: SyntheticEvent) => {
    e.stopPropagation();
    e.nativeEvent?.stopImmediatePropagation?.();
};

const SettingsPanelComponent: FC = () => {
    const dispatch = useAppDispatch();
    const isActive = useAppSelector(state => state.app.panel?.type === 'settings');
    const viewMode = useAppSelector(state => state.app.viewMode);
    
    const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
    const [isAdvancedMode, setIsAdvancedMode] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    const {
        handleRefresh,
        handleExport,
        handleDeleteAll,
        handleViewChangelog,
        handleReportIssue,
        hasItems,
        deleteLabel,
        noteId
    } = useNoteActions();

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        if (!isActive) {
            setIsMenuOpen(false);
        }
    }, [isActive]);

    const settingsMenu = (
        <DropdownMenu.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenu.Trigger asChild>
                <button 
                    className="clickable-icon" 
                    aria-label="Settings options"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <Icon name="more-horizontal" />
                </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
                <DropdownMenu.Content 
                    className="v-dropdown-content" 
                    align="end" 
                    sideOffset={5}
                    collisionBoundary={rootElement}
                    collisionPadding={8}
                    onPointerDown={stopPropagation}
                    onMouseDown={stopPropagation}
                    onClick={stopPropagation}
                    style={{ zIndex: 100 }}
                >
                    <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className="v-dropdown-item v-dropdown-sub-trigger">
                            <span>Actions</span>
                            <div className="v-dropdown-right-slot">
                                <Icon name="chevron-right" />
                            </div>
                        </DropdownMenu.SubTrigger>
                        
                        <DropdownMenu.Portal>
                            <DropdownMenu.SubContent 
                                className="v-dropdown-content" 
                                sideOffset={2}
                                alignOffset={-5}
                                collisionPadding={8}
                                style={{ zIndex: 105 }}
                                onPointerDown={stopPropagation}
                                onMouseDown={stopPropagation}
                                onClick={stopPropagation}
                            >
                                <DropdownMenu.Item className="v-dropdown-item" onSelect={handleRefresh}>
                                    <Icon name="refresh-cw" className="v-dropdown-item-icon" />
                                    Refresh history
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="v-dropdown-item" onSelect={handleExport} disabled={!noteId}>
                                    <Icon name="download-cloud" className="v-dropdown-item-icon" />
                                    Export history
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator className="v-dropdown-separator" />
                                <DropdownMenu.Item className="v-dropdown-item" onSelect={handleViewChangelog}>
                                    <Icon name="file-text" className="v-dropdown-item-icon" />
                                    View changelog
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="v-dropdown-item" onSelect={handleReportIssue}>
                                    <Icon name="bug" className="v-dropdown-item-icon" />
                                    Report issue
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator className="v-dropdown-separator" />
                                <DropdownMenu.Item 
                                    className="v-dropdown-item mod-warning" 
                                    onSelect={handleDeleteAll} 
                                    disabled={!noteId || !hasItems}
                                >
                                    <Icon name="trash-2" className="v-dropdown-item-icon" />
                                    {deleteLabel}
                                </DropdownMenu.Item>
                            </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Sub>

                    <DropdownMenu.Item className="v-dropdown-item" onSelect={() => setIsAdvancedMode(!isAdvancedMode)}>
                        {isAdvancedMode ? 'Basic settings' : 'Advanced settings'}
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );

    return (
        <div 
            ref={setRootElement}
            className={clsx("v-settings-panel", { "is-active": isActive })}
            role="dialog"
            aria-modal={isActive}
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
            onMouseUp={stopPropagation}
            onClick={stopPropagation}
        >
            <div 
                className="v-settings-panel-header"
                onPointerDown={stopPropagation}
                onMouseDown={stopPropagation}
                onClick={stopPropagation}
            >
                <div className="v-settings-header-title-group">
                    <h3>Settings</h3>
                    {isOnline && (
                        <img 
                            src="https://img.shields.io/github/v/release/Yuichi-Aragi/Version-Control" 
                            alt="GitHub Release" 
                            className="v-settings-badge"
                        />
                    )}
                </div>
                <div className="v-panel-header-actions">
                    <button 
                        className="clickable-icon v-panel-close" 
                        aria-label="Close settings" 
                        onClick={(e) => {
                            stopPropagation(e);
                            setIsMenuOpen(false);
                            dispatch(appSlice.actions.closePanel());
                        }}
                        onMouseDown={stopPropagation}
                    >
                        <Icon name="x" />
                    </button>
                </div>
            </div>
            <div className="v-settings-panel-content-wrapper">
                {isAdvancedMode ? (
                    <GlobalSettings 
                        showTitle={true} 
                        showPluginSettings={true} 
                        showDefaults={false}
                        headerAction={settingsMenu}
                    />
                ) : (
                    <>
                        <NoteSpecificSettings headerAction={settingsMenu} />
                        <GlobalSettings 
                            showTitle={false} 
                            showPluginSettings={false} 
                            showDefaults={true}
                            activeViewMode={viewMode}
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export const SettingsPanel = memo(SettingsPanelComponent);
SettingsPanel.displayName = 'SettingsPanel';
