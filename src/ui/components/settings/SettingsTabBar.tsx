import clsx from 'clsx';
import { type FC, memo } from 'react';

export type SettingsTabId = 'general' | 'versions' | 'edits';

interface SettingsTabBarProps {
    activeTab: SettingsTabId;
    onTabChange: (tabId: SettingsTabId) => void;
}

export const SettingsTabBar: FC<SettingsTabBarProps> = memo(({ activeTab, onTabChange }) => {
    return (
        <div className="v-settings-tabs" role="tablist">
            <button
                className={clsx('v-settings-tab', { 'is-active': activeTab === 'general' })}
                onClick={() => onTabChange('general')}
                role="tab"
                aria-selected={activeTab === 'general'}
                aria-controls="tab-panel-general"
            >
                General
            </button>
            <button
                className={clsx('v-settings-tab', { 'is-active': activeTab === 'versions' })}
                onClick={() => onTabChange('versions')}
                role="tab"
                aria-selected={activeTab === 'versions'}
                aria-controls="tab-panel-versions"
            >
                Version History
            </button>
            <button
                className={clsx('v-settings-tab', { 'is-active': activeTab === 'edits' })}
                onClick={() => onTabChange('edits')}
                role="tab"
                aria-selected={activeTab === 'edits'}
                aria-controls="tab-panel-edits"
            >
                Edit History
            </button>
        </div>
    );
});
SettingsTabBar.displayName = 'SettingsTabBar';
