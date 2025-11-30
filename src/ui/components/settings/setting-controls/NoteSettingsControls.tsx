import { memo } from 'react';
import { AutoCleanupSettings } from './AutoCleanupSettings';
import { AutoSaveSettings } from './AutoSaveSettings';
import { MaxVersionsSetting } from './MaxVersionsSetting';
import { EnableNamingSetting, ListViewSetting, RelativeTimestampSetting, RenderMarkdownSetting, EnableDescriptionSetting, ShowDescriptionInListSetting } from './ToggleSettingFactory';
import { WatchModeSettings } from './WatchModeSettings';
import { CharacterCountSettings, LineCountSettings, WordCountSettings } from './TextStatSettings';

export const NoteSettingsControls: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    return (
        <>
            <EnableNamingSetting disabled={disabled} />
            <EnableDescriptionSetting disabled={disabled} />
            <ShowDescriptionInListSetting disabled={disabled} />
            <ListViewSetting disabled={disabled} />
            <RelativeTimestampSetting disabled={disabled} />
            <RenderMarkdownSetting disabled={disabled} />
            <WordCountSettings disabled={disabled} />
            <CharacterCountSettings disabled={disabled} />
            <LineCountSettings disabled={disabled} />
            <AutoSaveSettings disabled={disabled} />
            <WatchModeSettings disabled={disabled} />
            <AutoCleanupSettings disabled={disabled} />
            <MaxVersionsSetting disabled={disabled} />
        </>
    );
});
NoteSettingsControls.displayName = 'NoteSettingsControls';
