import type { AppThunk } from '@/state';
import * as v from 'valibot';
import { appSlice } from '@/state';
import { AppStatus } from '@/state';
import { TimelineManager } from '@/core';
import { ManifestManager } from '@/core';
import { EditHistoryManager } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import type { TimelineSettings } from '@/types';
import { TimelineSettingsSchema } from '@/schemas';

/**
 * Thunks related to the Timeline feature.
 */

export const openTimeline = (): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);

    if (state.status !== AppStatus.READY || !state.noteId || !state.currentBranch) {
        uiService.showNotice("Cannot open timeline: view context is not ready.");
        return;
    }

    const { noteId, currentBranch, viewMode } = state;
    const source = viewMode === 'versions' ? 'version' : 'edit';

    // Load settings from correct manifest based on view mode
    let settings: TimelineSettings = v.parse(TimelineSettingsSchema, {});
    try {
        if (source === 'version') {
            const manifest = await manifestManager.loadNoteManifest(noteId);
            if (manifest) {
                const branch = manifest.branches[currentBranch];
                if (branch && branch.timelineSettings) {
                    settings = branch.timelineSettings;
                }
            }
        } else {
            const manifest = await editHistoryManager.getEditManifest(noteId);
            if (manifest) {
                const branch = manifest.branches[currentBranch];
                if (branch && branch.timelineSettings) {
                    settings = branch.timelineSettings;
                }
            }
        }
    } catch (error) {
        console.error("VC: Failed to load timeline settings", error);
    }

    // Open the panel in loading state with settings
    dispatch(appSlice.actions.openPanel({ type: 'timeline', events: null, settings }));

    const timelineManager = container.get<TimelineManager>(TYPES.TimelineManager);

    try {
        const events = await timelineManager.getOrGenerateTimeline(noteId, currentBranch, source);
        
        // Verify state hasn't changed while we were awaiting
        const currentState = getState();
        if (currentState.status !== AppStatus.READY || currentState.noteId !== noteId || currentState.panel?.type !== 'timeline') {
            return;
        }

        dispatch(appSlice.actions.setTimelineData(events));
    } catch (error) {
        console.error("VC: Failed to load timeline.", error);
        uiService.showNotice("Failed to load timeline. Check console.");
        dispatch(appSlice.actions.closePanel());
    }
};

export const updateTimelineSettings = (newSettings: Partial<TimelineSettings>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);

    if (state.status !== AppStatus.READY || !state.noteId || !state.currentBranch || state.panel?.type !== 'timeline') {
        return;
    }

    const { noteId, currentBranch, viewMode } = state;
    const source = viewMode === 'versions' ? 'version' : 'edit';
    const currentSettings = state.panel.settings;
    const updatedSettings = { ...currentSettings, ...newSettings };

    // Update UI immediately
    dispatch(appSlice.actions.setTimelineSettings(updatedSettings));

    // Persist to manifest based on source
    try {
        if (source === 'version') {
            await manifestManager.updateNoteManifest(noteId, (manifest) => {
                const branch = manifest.branches[currentBranch];
                if (branch) {
                    branch.timelineSettings = updatedSettings;
                }
            });
        } else {
            const manifest = await editHistoryManager.getEditManifest(noteId);
            if (manifest) {
                const branch = manifest.branches[currentBranch];
                if (branch) {
                    branch.timelineSettings = updatedSettings;
                    await editHistoryManager.saveEditManifest(noteId, manifest);
                }
            }
        }
    } catch (error) {
        console.error("VC: Failed to save timeline settings", error);
        // Revert UI if failed? Or just log.
    }
};
