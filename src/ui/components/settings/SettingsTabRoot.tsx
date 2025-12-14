import { type FC, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { appSlice } from '@/state';
import { GlobalSettings } from './GlobalSettings';
import { NoteSettingsControls } from './setting-controls/NoteSettingsControls';
import { AutoRegisterSettings } from './setting-controls/AutoRegisterSettings';
import { SettingsTabBar, type SettingsTabId } from './SettingsTabBar';

export const SettingsTabRoot: FC = () => {
    const dispatch = useAppDispatch();
    const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
    
    // Read global settings to populate effectiveSettings when switching tabs
    const versionDefaults = useAppSelector(state => state.settings.versionHistorySettings);
    const editDefaults = useAppSelector(state => state.settings.editHistorySettings);

    const handleTabChange = useCallback((tabId: SettingsTabId) => {
        setActiveTab(tabId);
        
        if (tabId === 'versions') {
            dispatch(appSlice.actions.setViewMode('versions'));
            // Manually force effective settings to global version defaults for editing
            dispatch(appSlice.actions.updateEffectiveSettings({ ...versionDefaults, isGlobal: true }));
        } else if (tabId === 'edits') {
            dispatch(appSlice.actions.setViewMode('edits'));
            // Manually force effective settings to global edit defaults for editing
            dispatch(appSlice.actions.updateEffectiveSettings({ ...editDefaults, isGlobal: true }));
        }
    }, [dispatch, versionDefaults, editDefaults]);

    return (
        <div className="v-settings-tab-content">
            <SettingsTabBar activeTab={activeTab} onTabChange={handleTabChange} />

            {activeTab === 'general' && (
                <div role="tabpanel" id="tab-panel-general">
                    <GlobalSettings showTitle={false} includeDefaults={false} />
                </div>
            )}

            {activeTab === 'versions' && (
                <div role="tabpanel" id="tab-panel-versions" className="v-settings-section">
                    <h2>Global Version History Defaults</h2>
                    <p className="setting-item-description">
                        These settings apply to all notes using Version History unless overridden by specific note settings.
                    </p>
                    
                    <div style={{ marginBottom: 'var(--size-4-4)' }}>
                         <AutoRegisterSettings settingKey="versionHistorySettings" />
                    </div>
                    
                    <NoteSettingsControls disabled={false} />
                </div>
            )}

            {activeTab === 'edits' && (
                <div role="tabpanel" id="tab-panel-edits" className="v-settings-section">
                    <h2>Global Edit History Defaults</h2>
                    <p className="setting-item-description">
                        These settings apply to all notes using Edit History unless overridden by specific note settings.
                    </p>
                    
                    <div style={{ marginBottom: 'var(--size-4-4)' }}>
                        <AutoRegisterSettings settingKey="editHistorySettings" />
                    </div>

                    <NoteSettingsControls disabled={false} />
                </div>
            )}
        </div>
    );
};
