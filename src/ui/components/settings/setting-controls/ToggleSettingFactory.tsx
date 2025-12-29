import { memo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';
import type { HistorySettings, ViewMode } from '@/types';
import { SettingComponent } from '@/ui/components';

type TextResolver = string | ((mode: ViewMode) => string);

const resolveText = (text: TextResolver, mode: ViewMode) => 
    typeof text === 'function' ? text(mode) : text;

export const createToggleSetting = (name: TextResolver, desc: TextResolver, settingKey: keyof HistorySettings) => 
    memo(({ disabled }: { disabled: boolean }) => {
        const dispatch = useAppDispatch();
        const { isEnabled, viewMode } = useAppSelector(state => ({
            isEnabled: !!state.app.effectiveSettings[settingKey],
            viewMode: state.app.viewMode
        }));
        
        const handleToggle = useCallback((val: boolean) => {
            dispatch(thunks.updateSettings({ [settingKey]: val } as Partial<HistorySettings>));
        }, [dispatch, settingKey]);
        
        const resolvedName = resolveText(name, viewMode);
        const resolvedDesc = resolveText(desc, viewMode);
        
        return (
            <SettingComponent name={resolvedName} desc={resolvedDesc}>
                <input 
                    type="checkbox" 
                    checked={isEnabled} 
                    onChange={e => handleToggle(e.target.checked)} 
                    disabled={disabled}
                    aria-label={`Toggle ${resolvedName.toLowerCase()}`}
                />
            </SettingComponent>
        );
    });

export const EnableNamingSetting = createToggleSetting(
    (mode) => `Enable ${mode === 'versions' ? 'version' : 'edit'} naming`,
    (mode) => `If enabled, prompts for a ${mode === 'versions' ? 'version' : 'edit'} name when saving a new ${mode === 'versions' ? 'version' : 'edit'}.`,
    'enableVersionNaming'
);
EnableNamingSetting.displayName = 'EnableNamingSetting';

export const EnableDescriptionSetting = createToggleSetting(
    (mode) => `Enable ${mode === 'versions' ? 'version' : 'edit'} description`,
    (mode) => `If enabled, prompts for a description when saving a new ${mode === 'versions' ? 'version' : 'edit'}.`,
    'enableVersionDescription'
);
EnableDescriptionSetting.displayName = 'EnableDescriptionSetting';

export const ShowDescriptionInListSetting = createToggleSetting(
    'Show description in list',
    (mode) => `If enabled, displays the ${mode === 'versions' ? 'version' : 'edit'} description in the history list instead of action buttons.`,
    'showDescriptionInList'
);
ShowDescriptionInListSetting.displayName = 'ShowDescriptionInListSetting';

export const ListViewSetting = createToggleSetting(
    'Compact list view', 
    (mode) => `Display ${mode === 'versions' ? 'version' : 'edit'} history as a compact list. Otherwise, shows as cards.`, 
    'isListView'
);
ListViewSetting.displayName = 'ListViewSetting';

export const RelativeTimestampSetting = createToggleSetting(
    'Use relative timestamps', 
    "On: show relative times (e.g., '2 hours ago'). Off: show full date and time.", 
    'useRelativeTimestamps'
);
RelativeTimestampSetting.displayName = 'RelativeTimestampSetting';

export const RenderMarkdownSetting = createToggleSetting(
    'Render markdown in preview', 
    (mode) => `If enabled, ${mode === 'versions' ? 'version' : 'edit'} previews will render markdown. Otherwise, plain text.`, 
    'renderMarkdownInPreview'
);
RenderMarkdownSetting.displayName = 'RenderMarkdownSetting';