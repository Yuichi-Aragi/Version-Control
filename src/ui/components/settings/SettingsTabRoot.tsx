import type { FC } from 'react';
import { GlobalSettings } from './GlobalSettings';
import { NoteSettingsControls } from './setting-controls/NoteSettingsControls';

export const SettingsTabRoot: FC = () => {
    return (
        <div className="v-settings-tab-content">
            <GlobalSettings showTitle={true} />
            <div className="v-settings-section" role="region" aria-labelledby="default-note-settings-title">
                <h2 id="default-note-settings-title">Default Note Settings</h2>
                <p className="setting-item-description">
                    These are the default settings for notes. Individual notes can override these settings from the version control view.
                </p>
                <NoteSettingsControls disabled={false} />
            </div>
        </div>
    );
};
