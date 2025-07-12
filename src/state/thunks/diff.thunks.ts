import { App } from 'obsidian';
import { AppThunk } from '../store';
import { actions } from '../appSlice';
import { VersionHistoryEntry, DiffTarget } from '../../types';
import { AppStatus } from '../state';
import { VIEW_TYPE_VERSION_DIFF } from '../../constants';
import { UIService } from '../../services/ui-service';
import { DiffManager } from '../../services/diff-manager';
import { TYPES } from '../../types/inversify.types';

/**
 * Thunks for generating and displaying diffs between versions.
 */

export const requestDiff = (version1: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId || !state.file || state.noteId !== version1.noteId) {
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
        name: 'Current Note State',
        timestamp: new Date().toISOString(),
        notePath: state.file.path,
    };
    const targets: DiffTarget[] = [currentStateTarget, ...otherVersions];

    const selectedTarget = await uiService.promptForVersion(targets);
    if (!selectedTarget) {
        return; // User cancelled
    }

    const menuOptions = [
        {
            title: "Show Diff in Panel",
            icon: "sidebar-right",
            callback: () => dispatch(generateAndShowDiff(version1, selectedTarget, 'panel'))
        },
        {
            title: "Show Diff in New Tab",
            icon: "file-diff",
            callback: () => dispatch(generateAndShowDiff(version1, selectedTarget, 'tab'))
        }
    ];
    uiService.showActionMenu(menuOptions);
};

export const generateAndShowDiff = (version1: VersionHistoryEntry, version2: DiffTarget, mode: 'panel' | 'tab'): AppThunk => async (dispatch, getState, container) => {
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
            const leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_VERSION_DIFF,
                active: true,
                state: {
                    version1,
                    version2,
                    diffChanges,
                    noteName: file.basename,
                    notePath: file.path,
                }
            });
            app.workspace.revealLeaf(leaf);
        } catch (error) {
            console.error("Version Control: Error generating diff for tab.", error);
            uiService.showNotice("Failed to generate diff. Check console for details.");
        }
        return;
    }

    // --- Panel Mode Logic ---
    dispatch(actions.startDiffGeneration({ version1, version2 }));
    uiService.showNotice("Generating diff in background...", 3000);

    try {
        const diffChanges = await diffManager.generateDiff(noteId, version1, version2);

        const finalState = getState();
        if (finalState.status !== AppStatus.READY || finalState.noteId !== noteId) {
            uiService.showNotice("View context changed, diff cancelled.", 3000);
            dispatch(actions.clearDiffRequest());
            return;
        }
        
        dispatch(actions.diffGenerationSucceeded({ version1Id: version1.id, version2Id: version2.id, diffChanges }));
        uiService.showNotice("Diff is ready. Click the indicator to view.", 4000);

    } catch (error) {
        console.error("Version Control: Error during background diff generation.", error);
        uiService.showNotice("Failed to generate diff. Check console.", 5000);
        dispatch(actions.diffGenerationFailed({ version1Id: version1.id, version2Id: version2.id }));
    }
};

export const viewReadyDiff = (): AppThunk => (dispatch, getState, container) => {
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