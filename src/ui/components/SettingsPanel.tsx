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
    // Stop native propagation to ensure no other listeners on parents or document fire
    e.nativeEvent?.stopImmediatePropagation?.();
};

const SettingsPanelComponent: FC = () => {
    const dispatch = useAppDispatch();
    const isActive = useAppSelector(state => state.panel?.type === 'settings');
    const viewMode = useAppSelector(state => state.viewMode);
    
    // Use state for ref to ensure re-render when element is available for collision boundary
    const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
    
    const [isAdvancedMode, setIsAdvancedMode] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

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

    // Ensure menu closes when the panel is deactivated
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
                    // Stop propagation at the button level to prevent leaks during interaction
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
                    // Ensure menu interactions don't leak
                    onPointerDown={stopPropagation}
                    onMouseDown={stopPropagation}
                    onClick={stopPropagation}
                    style={{ zIndex: 100 }}
                >
                    {/* Use Sub component to ensure proper closing behavior for nested menus */}
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
                                // Removed collisionBoundary to allow the sub-menu to use the full viewport
                                // This ensures it won't be clipped by the panel and can flip correctly
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
                                    View Changelog
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="v-dropdown-item" onSelect={handleReportIssue}>
                                    <Icon name="bug" className="v-dropdown-item-icon" />
                                    Report Issue
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
                        {isAdvancedMode ? 'Basic Settings' : 'Advanced Settings'}
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
            // Aggressively stop all pointer events from bubbling through the panel.
            // onPointerDown is crucial as it fires before click/mousedown in modern browsers.
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
            onMouseUp={stopPropagation}
            onClick={stopPropagation}
        >
            <div 
                className="v-settings-panel-header"
                // Ensure header specifically captures interactions
                onPointerDown={stopPropagation}
                onMouseDown={stopPropagation}
                onClick={stopPropagation}
            >
                <h3>Settings</h3>
                <div className="v-panel-header-actions">
                    <button 
                        className="clickable-icon v-panel-close" 
                        aria-label="Close settings" 
                        onClick={(e) => {
                            stopPropagation(e);
                            // Explicitly close menu when closing panel
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
