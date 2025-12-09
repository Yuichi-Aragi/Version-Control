import { memo } from 'react';
import { AutoCleanupSettings } from './AutoCleanupSettings';
import { AutoSaveSettings } from './AutoSaveSettings';
import { MaxVersionsSetting } from './MaxVersionsSetting';
import { EnableNamingSetting, ListViewSetting, RelativeTimestampSetting, RenderMarkdownSetting, EnableDescriptionSetting, ShowDescriptionInListSetting } from './ToggleSettingFactory';
import { WatchModeSettings } from './WatchModeSettings';
import { CharacterCountSettings, LineCountSettings, WordCountSettings } from './TextStatSettings';


export const NoteSettingsControls: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    // Determine which key to update in global state if we are editing global defaults
    // Note: NoteSettingsControls is reused for both Local and Global context in SettingsTabRoot?
    // Actually, NoteSettingsControls is designed to operate on `effectiveSettings` via `thunks.updateSettings`.
    // `thunks.updateSettings` handles dispatching to the correct store location (global vs local) based on `isGlobal` flag and `viewMode`.
    // However, AutoRegisterSettings requires a specific key ('versionHistorySettings' or 'editHistorySettings') to update global state directly.
    // Since `NoteSettingsControls` is primarily for the *active note context*, and AutoRegister is a *global* preference for *new* notes,
    // it makes sense to only show AutoRegister settings in the Global Settings panel (which we did), 
    // OR allow overriding it per note?
    // The schema allows it per note (in HistorySettingsSchema).
    // If we want to support per-note override of auto-register (e.g. "Auto register THIS note if I delete its ID?"), 
    // it's a bit edge case.
    // The prompt asked to add it to HistorySettingsSchema, which implies it CAN be per note.
    // But `AutoRegisterSettings` component is currently hardcoded to update global settings via `settingKey`.
    // Let's keep it simple: AutoRegister is primarily a global discovery feature. 
    // We won't add it to the per-note controls to avoid confusion, as it only applies when a note is NOT registered.
    
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
