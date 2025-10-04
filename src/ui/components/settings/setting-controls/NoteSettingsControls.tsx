import { memo } from 'react';
import { AutoCleanupSettings } from './AutoCleanupSettings';
import { AutoSaveSettings } from './AutoSaveSettings';
import { MaxVersionsSetting } from './MaxVersionsSetting';
import { EnableNamingSetting, ListViewSetting, RelativeTimestampSetting, RenderMarkdownSetting } from './ToggleSettingFactory';
import { WatchModeSettings } from './WatchModeSettings';

export const NoteSettingsControls: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    return (
        <>
            <EnableNamingSetting disabled={disabled} />
            <ListViewSetting disabled={disabled} />
            <RelativeTimestampSetting disabled={disabled} />
            <RenderMarkdownSetting disabled={disabled} />
            <AutoSaveSettings disabled={disabled} />
            <WatchModeSettings disabled={disabled} />
            <AutoCleanupSettings disabled={disabled} />
            <MaxVersionsSetting disabled={disabled} />
        </>
    );
});
NoteSettingsControls.displayName = 'NoteSettingsControls';
