import { App } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry, DiffTarget } from '../../types';
import { AppStatus } from '../state';
import { VIEW_TYPE_VERSION_DIFF } from '../../constants';
import { UIService } from '../../services/ui-service';
import { DiffManager } from '../../services/diff-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';

/**
 * Thunks for generating and displaying diffs between versions.
 */

export const requestDiff = (version1: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId || !state.file) {
        uiService.showNotice("Cannot start diff: view context has changed.", 3000);
        return;
    }
    if (state.diffRequest?.status === 'generating') {
        const v1Label = state.diffRequest.version1.name || `V${state.diffRequest.version1.versionNumber}`;
        const v2Label = state.diffRequest.version2.name;
        uiService.showNotice(`A diff between ${v1Label} and ${v2Label} is already being generated.`, 4000);
        return;
    }

    const otherVersions = state.history.filter(v => v.id !== version1.id);
    const currentStateTarget: DiffTarget = {
        id: 'current',
        name: 'Current note state',
        timestamp: new Date().toISOString(),
        notePath: state.file.path,
        // FIX: Add missing properties to satisfy the DiffTarget type, which expects
        // a structure similar to VersionHistoryEntry for all its variants.
        noteId: state.noteId,
        versionNumber: 0, // Placeholder for the current state, which has no version number.
        size: state.file.stat.size,
    };
    const targets: DiffTarget[] = [currentStateTarget, ...otherVersions];

    const result = await uiService.promptForVersion(targets);
    if (!result) {
        return; // User cancelled
    }
    const { target: selectedTarget, event } = result;

    // Immediately consume the event from the suggester modal to prevent it from
    // propagating and closing the context menu we are about to open. This is
    // a critical step for ensuring predictable UI behavior on desktop platforms.
    if (event instanceof MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    // Re-validate state after user interaction
    const stateAfterPrompt = getState();
    if (stateAfterPrompt.status !== AppStatus.READY || stateAfterPrompt.noteId !== state.noteId) {
        uiService.showNotice("Cannot start diff: view context has changed.", 3000);
        return;
    }

    const menuOptions = [
        {
            title: "Show diff in panel",
            icon: "sidebar-right",
            callback: () => dispatch(generateAndShowDiff(version1, selectedTarget, 'panel'))
        },
        {
            title: "Show diff in new tab",
            icon: "file-diff",
            callback: () => dispatch(generateAndShowDiff(version1, selectedTarget, 'tab'))
        }
    ];
    
    // Pass the original mouse event to position the menu correctly.
    // Even though we've stopped its propagation, the event object still
    // contains the necessary coordinate data for positioning. Obsidian's
    // menu handler is robust enough to handle an already-stopped event.
    const mouseEvent = event instanceof MouseEvent ? event : undefined;
    uiService.showActionMenu(menuOptions, mouseEvent);
};

export const generateAndShowDiff = (version1: VersionHistoryEntry, version2: DiffTarget, mode: 'panel' | 'tab'): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const diffManager = container.get<DiffManager>(TYPES.DiffManager);
    const app = container.get<App>(TYPES.App);
    
    const initialState = getState();
    if (initialState.status !== AppStatus.READY || !initialState.noteId || !initialState.file) return;
    const { noteId, file } = initialState;

    if (mode === 'tab') {
        uiService.showNotice("Generating diff for new tab...", 2000);
        try {
            const diffChanges = await diffManager.generateDiff(noteId, version1, version2);

            // Re-validate state after the potentially long diff generation
            const stateAfterGen = getState();
            if (isPluginUnloading(container) || stateAfterGen.status !== AppStatus.READY || stateAfterGen.noteId !== noteId || !stateAfterGen.file) {
                uiService.showNotice("View context changed while generating diff. Tab opening cancelled.", 4000);
                return;
            }

            const leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_VERSION_DIFF,
                active: true,
                state: {
                    version1,
                    version2,
                    diffChanges,
                    noteName: stateAfterGen.file.basename, // Use fresh data
                    notePath: stateAfterGen.file.path,     // Use fresh data
                }
            });
            app.workspace.revealLeaf(leaf);
        } catch (error) {
            console.error("Version Control: Error generating diff for tab.", error);
            uiService.showNotice("Failed to generate diff. Check the console for details.");
        }
        return;
    }

    // --- Panel Mode Logic ---
    dispatch(actions.startDiffGeneration({ version1, version2 }));
    uiService.showNotice("Generating diff in background...", 3000);

    try {
        const diffChanges = await diffManager.generateDiff(noteId, version1, version2);

        const finalState = getState();
        if (isPluginUnloading(container) || finalState.status !== AppStatus.READY || finalState.noteId !== noteId) {
            uiService.showNotice("View context changed, diff cancelled.", 3000);
            dispatch(actions.clearDiffRequest());
            return;
        }
        
        dispatch(actions.diffGenerationSucceeded({ version1Id: version1.id, version2Id: version2.id, diffChanges }));
        uiService.showNotice("Diff is ready. Click the indicator to view.", 4000);

    } catch (error) {
        console.error("Version Control: Error during background diff generation.", error);
        uiService.showNotice("Failed to generate diff. Check the console for details.", 5000);
        dispatch(actions.diffGenerationFailed({ version1Id: version1.id, version2Id: version2.id }));
    }
};

export const viewReadyDiff = (): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY) return;
    
    const diffRequest = state.diffRequest;
    if (!diffRequest) return;

    if (diffRequest.status === 'generating') {
        const v1Label = diffRequest.version1.name || `V${diffRequest.version1.versionNumber}`;
        const v2Label = diffRequest.version2.name;
        uiService.showNotice(`A diff between ${v1Label} and ${v2Label} is already being generated.`, 4000);
        return;
    }
    
    if (diffRequest.status !== 'ready' || !diffRequest.diffChanges) return;

    const { version1, version2, diffChanges } = diffRequest;

    // Directly open the panel, as this was the implied action for the indicator.
    dispatch(actions.openPanel({ type: 'diff', version1, version2, diffChanges }));
    dispatch(actions.clearDiffRequest());
};
