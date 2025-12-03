import { moment, App, MarkdownView } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry, DiffTarget, DiffType } from '../../types';
import { AppStatus, type ActionItem } from '../state';
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
        dispatch(generateAndShowDiffInPanel(version1, selectedTarget));
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'Compare with...',
        items,
        onChooseAction,
        showFilter: true,
    }));
};

export const generateAndShowDiffInPanel = (version1: VersionHistoryEntry, version2: DiffTarget): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;

    dispatch(actions.closePanel());

    const uiService = container.get<UIService>(TYPES.UIService);
    const diffManager = container.get<DiffManager>(TYPES.DiffManager);
    
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

export const viewReadyDiff = (renderMode: 'panel' | 'window' = 'panel'): AppThunk => (dispatch, getState, container) => {
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
    dispatch(actions.openPanel({ 
        type: 'diff', 
        version1, 
        version2, 
        diffChanges, 
        diffType, 
        content1, 
        content2, 
        isReDiffing: false,
        renderMode // Pass the requested render mode
    }));
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

/**
 * Scrolls the editor of the active note to a specific line.
 * This is primarily used for navigating from the diff view to the editor.
 * @param line The 1-based line number to scroll to.
 */
export const scrollToLineInEditor = (line: number): AppThunk => (_dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);

    if (state.status !== AppStatus.READY || !state.file) {
        uiService.showNotice("Cannot scroll: no active note in version control view.", 4000);
        return;
    }
    
    const panelState = state.panel;
    if (panelState?.type !== 'diff') {
        // This is a defensive check. This thunk should only be called from the diff panel.
        return;
    }

    const filePath = state.file.path;

    const markdownLeaves = app.workspace.getLeavesOfType('markdown');
    const targetLeaf = markdownLeaves.find(leaf => {
        return leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath;
    });

    if (!targetLeaf) {
        const fileName = filePath.split('/').pop() ?? filePath;
        uiService.showNotice(`Note "${fileName}" is not currently open. Cannot scroll.`, 4000);
        return;
    }

    // Since we found it via getLeavesOfType('markdown') and checked instanceof, this cast is safe.
    const view = targetLeaf.view as MarkdownView;
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
