import { App, moment } from 'obsidian';
import type { Change } from 'diff';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry, DiffTarget, DiffType } from '../../types';
import { AppStatus, type ActionItem } from '../state';
import { VIEW_TYPE_VERSION_DIFF } from '../../constants';
import { UIService } from '../../services/ui-service';
import { DiffManager } from '../../services/diff-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';

/**
 * Thunks for generating and displaying diffs between versions.
 */

/**
 * Handles the second step of the diff workflow: choosing the display mode.
 * @param version1 The base version for comparison.
 * @param version2 The target version for comparison.
 */
const _handleDiffVersionSelected = (version1: VersionHistoryEntry, version2: DiffTarget): AppThunk => (dispatch) => {
    const items: ActionItem<'panel' | 'tab'>[] = [
        { id: 'panel', data: 'panel', text: 'Show diff in panel', icon: 'sidebar-right' },
        { id: 'tab', data: 'tab', text: 'Show diff in new tab', icon: 'file-diff' },
    ];

    const onChooseAction = (mode: 'panel' | 'tab'): AppThunk => (dispatch) => {
        dispatch(generateAndShowDiff(version1, version2, mode));
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'How to display diff?',
        items,
        onChooseAction,
        showFilter: false,
    }));
};


export const requestDiff = (version1: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId || !state.file) {
        uiService.showNotice("Cannot start diff: view context has changed.", 3000);
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

    const items: ActionItem<DiffTarget>[] = targets.map(target => {
        if ('versionNumber' in target) {
            const version = target as VersionHistoryEntry;
            const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;
            return {
                id: version.id,
                data: version,
                text: versionLabel,
                subtext: (moment as any)(version.timestamp).format('LLLL'),
            };
        } else {
            return {
                id: target.id,
                data: target,
                text: target.name,
                subtext: 'The current, unsaved content of the note.',
            };
        }
    });

    const onChooseAction = (selectedTarget: DiffTarget): AppThunk => (dispatch) => {
        dispatch(_handleDiffVersionSelected(version1, selectedTarget));
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'Compare with...',
        items,
        onChooseAction,
        showFilter: true,
    }));
};

export const generateAndShowDiff = (version1: VersionHistoryEntry, version2: DiffTarget, mode: 'panel' | 'tab'): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;

    dispatch(actions.closePanel());

    const uiService = container.get<UIService>(TYPES.UIService);
    const diffManager = container.get<DiffManager>(TYPES.DiffManager);
    const app = container.get<App>(TYPES.App);
    
    const initialState = getState();
    if (initialState.status !== AppStatus.READY || !initialState.noteId || !initialState.file) return;
    const { noteId } = initialState;

    uiService.showNotice("Generating diff...", 2000);

    try {
        const content1 = await diffManager.getContent(noteId, version1);
        const content2 = await diffManager.getContent(noteId, version2);
        
        const stateAfterContentFetch = getState();
        if (isPluginUnloading(container) || stateAfterContentFetch.status !== AppStatus.READY || stateAfterContentFetch.noteId !== noteId || !stateAfterContentFetch.file) {
            uiService.showNotice("View context changed while fetching content. Diff cancelled.", 4000);
            return;
        }

        if (mode === 'tab') {
            const diffChanges = await diffManager.computeDiff(noteId, version1.id, version2.id, content1, content2, 'lines');
            const leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_VERSION_DIFF,
                active: true,
                state: {
                    version1,
                    version2,
                    diffChanges,
                    noteName: stateAfterContentFetch.file.basename,
                    notePath: stateAfterContentFetch.file.path,
                    content1,
                    content2,
                }
            });
            app.workspace.revealLeaf(leaf);
            return;
        }

        // --- Panel Mode Logic ---
        dispatch(actions.startDiffGeneration({ version1, version2, content1, content2 }));
        const diffChanges = await diffManager.computeDiff(noteId, version1.id, version2.id, content1, content2, 'lines');
        
        const finalState = getState();
        if (isPluginUnloading(container) || finalState.status !== AppStatus.READY || finalState.noteId !== noteId) {
            uiService.showNotice("View context changed, diff cancelled.", 3000);
            dispatch(actions.clearDiffRequest());
            return;
        }
        
        dispatch(actions.diffGenerationSucceeded({ version1Id: version1.id, version2Id: version2.id, diffChanges }));
        uiService.showNotice("Diff is ready. Click the indicator to view.", 4000);

    } catch (error) {
        console.error("Version Control: Error generating diff.", error);
        uiService.showNotice("Failed to generate diff. Check the console for details.");
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

    if (diffRequest.status === 'generating' || diffRequest.status === 're-diffing') {
        uiService.showNotice(`A diff is currently being generated.`, 4000);
        return;
    }
    
    if (diffRequest.status !== 'ready' || !diffRequest.diffChanges) return;

    const { version1, version2, diffChanges, diffType, content1, content2 } = diffRequest;

    dispatch(actions.clearDiffRequest());
    dispatch(actions.openPanel({ type: 'diff', version1, version2, diffChanges, diffType, content1, content2, isReDiffing: false }));
};

export const recomputeDiff = (newDiffType: DiffType): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const diffManager = container.get<DiffManager>(TYPES.DiffManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.panel?.type !== 'diff') return;
    const { version1, version2, content1, content2 } = state.panel;
    const noteId = state.noteId;
    if (!noteId) return;

    dispatch(actions.startReDiffing({ newDiffType }));
    try {
        const diffChanges = await diffManager.computeDiff(noteId, version1.id, version2.id, content1, content2, newDiffType);
        dispatch(actions.reDiffingSucceeded({ diffChanges }));
    } catch (error) {
        console.error("Version Control: Failed to re-compute diff.", error);
        uiService.showNotice("Failed to re-compute diff. Check console.", 4000);
        dispatch(actions.reDiffingFailed());
    }
};

export const computeDiffOnly = (diffType: DiffType, noteId: string, version1: VersionHistoryEntry, version2: DiffTarget, content1: string, content2: string): AppThunk<Promise<Change[]>> => async (_dispatch, _getState, container) => {
    const diffManager = container.get<DiffManager>(TYPES.DiffManager);
    return await diffManager.computeDiff(noteId, version1.id, version2.id, content1, content2, diffType);
};
