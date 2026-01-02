import { moment, MarkdownView, WorkspaceLeaf, FileView } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice } from '@/state/appSlice';
import type { VersionHistoryEntry, DiffTarget, DiffType } from '@/types';
import { AppStatus, type ActionItem } from '@/state';
import { shouldAbort } from '@/state/utils/guards';
import { historyApi } from '@/state/apis/history.api';

/**
 * Thunks for generating and displaying diffs between versions.
 */

export const requestDiff = (version1: VersionHistoryEntry): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const uiService = services.uiService;
    const rootState = getState();
    const state = rootState.app;

    if (state.status !== AppStatus.READY || !state.noteId || !state.file) {
        uiService.showNotice("Cannot start diff: view context has changed.", 3000);
        return;
    }

    const { viewMode, noteId } = state;
    
    // Retrieve history from RTK Query cache selectors
    let history: VersionHistoryEntry[] = [];
    
    if (viewMode === 'versions') {
        const result = historyApi.endpoints.getVersionHistory.select(noteId)(rootState);
        history = result.data || [];
    } else {
        const result = historyApi.endpoints.getEditHistory.select(noteId)(rootState);
        history = result.data || [];
    }
    
    const otherVersions = history.filter((v: VersionHistoryEntry) => v.id !== version1.id);
    
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
        dispatch(generateDiffBackground(version1, selectedTarget));
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Compare with...',
        items,
        onChooseAction,
        showFilter: true,
    }));
};

/**
 * Initiates diff generation in the background.
 * Updates the state to 'generating' and then 'ready' without opening the panel.
 * The UI (ActionBar) will show an indicator when ready.
 */
export const generateDiffBackground = (version1: VersionHistoryEntry, version2: DiffTarget): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;

    dispatch(appSlice.actions.closePanel());
    
    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId) return;

    const { noteId, viewMode } = state;

    // 1. Set state to generating
    dispatch(appSlice.actions.updateDiffPanelParams({
        version1,
        version2,
        diffType: 'lines' // Default
    }));
    
    const diffRequest = {
        status: 'generating' as const,
        version1,
        version2,
        diffType: 'lines' as const,
        diffChanges: null,
        content1: '',
        content2: ''
    };
    
    dispatch(appSlice.actions.setDiffRequest(diffRequest));

    try {
        // Trigger the fetch
        const result = await dispatch(historyApi.endpoints.getDiff.initiate({
            noteId,
            v1: version1,
            v2: version2,
            diffType: 'lines',
            viewMode
        })).unwrap();

        if (shouldAbort(services, getState, { noteId })) return;

        // Update state to ready
        dispatch(appSlice.actions.setDiffRequest({
            ...diffRequest,
            status: 'ready',
            diffChanges: result
        }));
        
        services.uiService.showNotice("Diff generated. Click the icon in the action bar to view.", 3000);

    } catch (error) {
        console.error("Diff generation failed", error);
        services.uiService.showNotice("Failed to generate diff.", 4000);
        dispatch(appSlice.actions.clearDiffRequest());
    }
};

export const viewReadyDiff = (renderMode: 'panel' | 'window' = 'panel'): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;

    if (state.status !== AppStatus.READY || !state.diffRequest || state.diffRequest.status !== 'ready') return;
    
    const { version1, version2, diffType } = state.diffRequest;

    dispatch(appSlice.actions.openPanel({ 
        type: 'diff', 
        version1, 
        version2, 
        diffType, 
        renderMode 
    }));
};

export const recomputeDiff = (newDiffType: DiffType): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    // Update the panel params. The component will react.
    dispatch(appSlice.actions.updateDiffPanelParams({ diffType: newDiffType }));
    
    // Also update the background request state if it exists, to keep them in sync
    const state = getState().app;
    if (state.diffRequest) {
        dispatch(appSlice.actions.setDiffRequest({
            ...state.diffRequest,
            diffType: newDiffType
        }));
    }
};

/**
 * Scrolls the editor of the active note to a specific line.
 * This is primarily used for navigating from the diff view to the editor.
 * @param line The 1-based line number to scroll to.
 */
export const scrollToLineInEditor = (line: number): AppThunk => (_dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    const uiService = services.uiService;
    const app = services.app;

    if (state.status !== AppStatus.READY || !state.file) {
        uiService.showNotice("Cannot scroll: no active note in version control view.", 4000);
        return;
    }

    if (state.file.extension === 'base') {
        // Disable scroll for .base files as they may not be open in a compatible editor
        return;
    }
    
    const panelState = state.panel;
    if (panelState?.type !== 'diff') {
        // This is a defensive check. This thunk should only be called from the diff panel.
        return;
    }

    const filePath = state.file.path;

    // Robustly find the target leaf.
    // 1. Try getMostRecentLeaf() first as it handles sidebar focus correctly.
    let targetLeaf: WorkspaceLeaf | null = null;
    const recentLeaf = (app.workspace as any).getMostRecentLeaf?.() as WorkspaceLeaf | null;
    
    if (recentLeaf?.view instanceof FileView && recentLeaf.view.file?.path === filePath) {
        targetLeaf = recentLeaf;
    } else {
        // 2. Fallback to searching all leaves if the most recent one isn't the right file
        const markdownLeaves = app.workspace.getLeavesOfType('markdown');
        targetLeaf = markdownLeaves.find(leaf => {
            return leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath;
        }) || null;
    }

    if (!targetLeaf) {
        const fileName = filePath.split('/').pop() ?? filePath;
        uiService.showNotice(`Note "${fileName}" is not currently open. Cannot scroll.`, 4000);
        return;
    }

    // Since we verified it's a MarkdownView (or FileView with path match), we cast safely.
    const view = targetLeaf.view as MarkdownView;

    // Check if view supports editor (it might be a different type of FileView in rare cases, but we checked extension)
    if (!view.editor) {
         uiService.showNotice("Cannot scroll: active view is not an editor.", 3000);
         return;
    }

    if (view.getMode() !== 'source') {
        uiService.showNotice("Cannot scroll to line: note is in Reading view.", 3000);
        return;
    }

    const editor = view.editor;

    // Bring the editor into focus for better user experience.
    app.workspace.setActiveLeaf(targetLeaf, { focus: true });

    // Editor line numbers are 0-indexed.
    const requestedLine = Math.max(0, line - 1);

    // Clamp the target line to be within the valid range of the editor.
    const targetLine = Math.min(requestedLine, Math.max(0, editor.lineCount() - 1));

    const lineContent = editor.getLine(targetLine) ?? '';
    const endOfLineCh = lineContent.length;

    // Set cursor and scroll. The API handles both.
    // Setting the cursor first and then scrolling provides a more reliable experience.
    editor.setCursor({ line: targetLine, ch: endOfLineCh });
    editor.scrollIntoView({
        from: { line: targetLine, ch: 0 },
        to: { line: targetLine, ch: 0 }
    }, true); // `true` centers the line in the viewport.
};
