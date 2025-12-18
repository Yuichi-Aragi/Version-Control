import { memo } from 'react';
import { isEqual } from 'es-toolkit';
import { useAppSelector } from '@/ui/hooks';
import { AppStatus } from '@/state';
import { IsGlobalSetting } from './setting-controls/IsGlobalSetting';
import { NoteSettingsControls } from './setting-controls/NoteSettingsControls';

interface NoteSpecificSettingsProps {
    headerAction?: React.ReactNode;
}

export const NoteSpecificSettings: React.FC<NoteSpecificSettingsProps> = memo(({ headerAction }) => {
    const { status, file, noteId, isGlobal, viewMode } = useAppSelector(state => ({
        status: state.status,
        file: state.file,
        noteId: state.noteId,
        isGlobal: state.effectiveSettings.isGlobal,
        viewMode: state.viewMode,
    }), isEqual);

    if (status !== AppStatus.READY || !file) return null;
    const areControlsDisabled = !noteId;
    const modeLabel = viewMode === 'versions' ? 'Version History' : 'Edit History';

    return (
        <div className="v-settings-section" role="region" aria-labelledby="note-settings-title">
            <div className="v-settings-section-header-row">
                <h4 id="note-settings-title">
                    {noteId ? `${modeLabel} Settings (Current Branch)` : 'Default settings'}
                </h4>
                {headerAction}
            </div>
            {noteId && <IsGlobalSetting disabled={areControlsDisabled} />}
            <p className="v-settings-info">
                {noteId ? (
                    isGlobal ? 
                        `This note follows the global ${modeLabel.toLowerCase()} settings. Changes made here will affect all other notes that follow global settings.` : 
                        `This note has its own ${modeLabel.toLowerCase()} settings for the current branch. Changes made here only affect this note.`
                ) : 
                    'This note is not under version control. These are the default settings that will be applied.'
                }
            </p>
            <NoteSettingsControls disabled={areControlsDisabled} />
        </div>
    );
});
NoteSpecificSettings.displayName = 'NoteSpecificSettings';
