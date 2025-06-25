import { TFile, WorkspaceLeaf, MetadataCache, App } from 'obsidian';
import { Thunk } from '../store';
import { actions } from '../actions';
import { AppError } from '../../types';
import { AppStatus } from '../state';
import { NOTE_FRONTMATTER_KEY, SERVICE_NAMES } from '../../constants';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { ManifestManager } from '../../core/manifest-manager';
import { CleanupManager } from '../../core/cleanup-manager';

/**
 * Thunks related to the core application lifecycle, such as view initialization and history loading.
 */

export const initializeView = (leaf?: WorkspaceLeaf | null): Thunk => async (dispatch, _getState, container) => {
    const app = container.resolve<App>(SERVICE_NAMES.APP);
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);

    try {
        const targetLeaf = leaf ?? app.workspace.activeLeaf;
        const activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
        
        dispatch(actions.initializeView(activeNoteInfo));

        if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
            dispatch(reconcileNoteId(activeNoteInfo.file, activeNoteInfo.noteId));
        }
        
        if (activeNoteInfo.file) {
            dispatch(loadHistory(activeNoteInfo.file));
        }
    } catch (error) {
        console.error("Version Control: CRITICAL: Failed to initialize view.", error);
        const appError: AppError = {
            title: "Initialization Failed",
            message: "Could not initialize the Version Control view.",
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    }
};

export const reconcileNoteId = (file: TFile, noteId: string): Thunk => async (_dispatch, _getState, container) => {
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);

    try {
        console.log(`Version Control: Reconciling missing vc-id. Writing "${noteId}" to note "${file.path}".`);
        const success = await noteManager.writeNoteIdToFrontmatter(file, noteId);
        if (success) {
            uiService.showNotice(`Version Control: Restored missing vc-id for "${file.basename}".`, 3000);
        }
    } catch (error) {
        console.error(`Version Control: Error during vc-id reconciliation for "${file.path}".`, error);
        uiService.showNotice(`VC: Failed to restore vc-id for "${file.basename}". Check console.`, 5000);
    }
};

export const loadHistory = (file: TFile): Thunk => async (dispatch, _getState, container) => {
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);
    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);

    try {
        let noteId = await noteManager.getNoteId(file); 
        if (!noteId) {
            noteId = await manifestManager.getNoteIdByPath(file.path);
        }
        
        const history = noteId ? await versionManager.getVersionHistory(noteId) : [];
        dispatch(actions.historyLoadedSuccess({ file, noteId, history }));

    } catch (error) {
        console.error(`Version Control: Failed to load version history for "${file.path}".`, error);
        const appError: AppError = {
            title: "History Load Failed",
            message: `Could not load version history for "${file.basename}".`,
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    }
};

export const loadHistoryForNoteId = (file: TFile, noteId: string): Thunk => async (dispatch, _getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    try {
        const history = await versionManager.getVersionHistory(noteId);
        dispatch(actions.historyLoadedSuccess({ file, noteId, history }));
    } catch (error) {
        console.error(`Version Control: Failed to load version history for note ID "${noteId}" ("${file.path}").`, error);
        const appError: AppError = {
            title: "History Load Failed",
            message: `Could not load version history for "${file.basename}".`,
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    }
};

export const handleMetadataChange = (file: TFile, cache: MetadataCache): Thunk => async (dispatch, getState, container) => {
    if (file.extension !== 'md') return;

    const state = getState();
    if (state.status === AppStatus.READY && state.isProcessing && state.file?.path === file.path) {
        console.log(`Version Control: Metadata changed for ${file.path} while processing. Operation will self-validate.`);
        return;
    }
    if (state.status === AppStatus.LOADING && state.file.path === file.path) {
        console.log(`Version Control: Metadata changed for ${file.path} while loading its history. Load will use latest data.`);
        return;
    }

    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
    const app = container.resolve<App>(SERVICE_NAMES.APP);

    const newNoteIdFromFrontmatter = cache.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;
    const oldNoteIdInManifest = await manifestManager.getNoteIdByPath(file.path);

    let idChanged = false;
    if (typeof newNoteIdFromFrontmatter === 'string' && newNoteIdFromFrontmatter.trim() === '') {
        idChanged = null !== oldNoteIdInManifest;
    } else {
        idChanged = newNoteIdFromFrontmatter !== oldNoteIdInManifest;
    }

    if (idChanged) {
        console.log(`Version Control: Detected vc-id change for "${file.path}". New FM: ${newNoteIdFromFrontmatter}, Old Manifest: ${oldNoteIdInManifest}.`);
        manifestManager.invalidateCentralManifestCache();
        // Diff cache is now invalidated automatically by events, no direct call needed.

        const currentState = getState();
        if ((currentState.status === AppStatus.READY || currentState.status === AppStatus.LOADING) && currentState.file?.path === file.path) {
            console.log(`Version Control: Active note's vc-id potentially changed externally. Re-initializing view for ${file.path}.`);
            dispatch(initializeView(app.workspace.activeLeaf));
        }
    }
};

export const handleFileRename = (file: TFile, oldPath: string): Thunk => async (dispatch, getState, container) => {
    if (file.extension !== 'md') return;

    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);
    const app = container.resolve<App>(SERVICE_NAMES.APP);

    const oldNoteId = await manifestManager.getNoteIdByPath(oldPath);
    await noteManager.handleNoteRename(file, oldPath);
    
    const state = getState();
    if ((state.status === AppStatus.READY || state.status === AppStatus.LOADING) && 
        (state.file?.path === oldPath || (oldNoteId && state.noteId === oldNoteId))) {
        dispatch(initializeView(app.workspace.activeLeaf));
    }
};

export const handleFileDelete = (file: TFile): Thunk => async (dispatch, getState, container) => {
    if (file.extension !== 'md') return;

    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);

    const deletedNoteId = await manifestManager.getNoteIdByPath(file.path); 
    
    noteManager.invalidateCentralManifestCache();
    manifestManager.invalidateCentralManifestCache();
    // Diff cache is now invalidated automatically by the 'history-deleted' event,
    // which will be fired by the orphan cleanup process. No direct call is needed here.

    const state = getState();
    if ((state.status === AppStatus.READY || state.status === AppStatus.LOADING) && 
        (state.file?.path === file.path || (deletedNoteId && state.noteId === deletedNoteId))) {
        dispatch(actions.clearActiveNote()); 
    }
};

export const cleanupOrphanedVersions = (manualTrigger: boolean): Thunk => async (_dispatch, _getState, container) => {
    const cleanupManager = container.resolve<CleanupManager>(SERVICE_NAMES.CLEANUP_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);

    try {
        const result = await cleanupManager.cleanupOrphanedVersions(manualTrigger);
        if (manualTrigger) {
            if (result.success) {
                const message = result.count > 0
                    ? `Successfully cleaned up ${result.count} orphaned version histor${result.count > 1 ? 'ies' : 'y'}.`
                    : "No orphaned version histories found to clean up.";
                uiService.showNotice(message, 5000);
            } else {
                uiService.showNotice("Orphan cleanup failed. Check console for details.", 7000);
            }
        }
    } catch (err) {
        console.error("Version Control: Error during orphan cleanup thunk:", err);
        if (manualTrigger) {
            uiService.showNotice("An unexpected error occurred during orphan cleanup. Check console.", 7000);
        }
    }
};
