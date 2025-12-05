import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import { AppStatus } from '../state';
import { TimelineManager } from '../../core/timeline-manager';
import { ManifestManager } from '../../core/manifest-manager';
import { UIService } from '../../services/ui-service';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';
import type { TimelineSettings } from '../../types';
import { TimelineSettingsSchema } from '../../schemas';

/**
 * Thunks related to the Timeline feature.
 */

export const openTimeline = (): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);

    if (state.status !== AppStatus.READY || !state.noteId || !state.currentBranch) {
        uiService.showNotice("Cannot open timeline: view context is not ready.");
        return;
    }

    // Load settings from manifest
    let settings: TimelineSettings = TimelineSettingsSchema.parse({});
    try {
        const manifest = await manifestManager.loadNoteManifest(state.noteId);
        if (manifest) {
            const branch = manifest.branches[state.currentBranch];
            if (branch && branch.timelineSettings) {
                settings = branch.timelineSettings;
            }
        }
    } catch (error) {
        console.error("VC: Failed to load timeline settings", error);
    }

    // Open the panel in loading state with settings
    dispatch(actions.openPanel({ type: 'timeline', events: null, settings }));

    const timelineManager = container.get<TimelineManager>(TYPES.TimelineManager);
    const { noteId, currentBranch } = state;

    try {
        const events = await timelineManager.getOrGenerateTimeline(noteId, currentBranch);
        
        // Verify state hasn't changed while we were awaiting
        const currentState = getState();
        if (currentState.status !== AppStatus.READY || currentState.noteId !== noteId || currentState.panel?.type !== 'timeline') {
            return;
        }

        dispatch(actions.setTimelineData(events));
    } catch (error) {
        console.error("VC: Failed to load timeline.", error);
        uiService.showNotice("Failed to load timeline. Check console.");
        dispatch(actions.closePanel());
    }
};

export const updateTimelineSettings = (newSettings: Partial<TimelineSettings>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);

    if (state.status !== AppStatus.READY || !state.noteId || !state.currentBranch || state.panel?.type !== 'timeline') {
        return;
    }

    const currentSettings = state.panel.settings;
    const updatedSettings = { ...currentSettings, ...newSettings };

    // Update UI immediately
    dispatch(actions.setTimelineSettings(updatedSettings));

    // Persist to manifest
    try {
        await manifestManager.updateNoteManifest(state.noteId, (manifest) => {
            const branch = manifest.branches[state.currentBranch!];
            if (branch) {
                branch.timelineSettings = updatedSettings;
            }
        });
    } catch (error) {
        console.error("VC: Failed to save timeline settings", error);
        // Revert UI if failed? Or just log.
    }
};
