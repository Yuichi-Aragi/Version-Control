import { memo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import type { VersionControlSettings } from '../../../../types';
import { SettingComponent } from '../../SettingComponent';

const createToggleSetting = (name: string, desc: string, settingKey: keyof VersionControlSettings) => 
    memo(({ disabled }: { disabled: boolean }) => {
        const dispatch = useAppDispatch();
        const isEnabled = useAppSelector(state => !!state.settings[settingKey]);
        const handleToggle = useCallback((val: boolean) => {
            dispatch(thunks.updateSettings({ [settingKey]: val } as Partial<VersionControlSettings>));
        }, [dispatch, settingKey]);
        
        return (
            <SettingComponent name={name} desc={desc}>
                <input 
                    type="checkbox" 
                    checked={isEnabled} 
                    onChange={e => handleToggle(e.target.checked)} 
                    disabled={disabled}
                    aria-label={`Toggle ${name.toLowerCase()}`}
                />
            </SettingComponent>
        );
    });

export const EnableNamingSetting = createToggleSetting(
    'Enable version naming', 
    'If enabled, prompts for a version name when saving a new version.', 
    'enableVersionNaming'
);
EnableNamingSetting.displayName = 'EnableNamingSetting';

export const ListViewSetting = createToggleSetting(
    'Compact list view', 
    'Display version history as a compact list. Otherwise, shows as cards.', 
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
    'If enabled, version previews will render markdown. Otherwise, plain text.', 
    'renderMarkdownInPreview'
);
RenderMarkdownSetting.displayName = 'RenderMarkdownSetting';
