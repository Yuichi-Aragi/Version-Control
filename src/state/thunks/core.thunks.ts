import { TFile, WorkspaceLeaf, CachedMetadata, App } from 'obsidian';
import { AppThunk } from '../store';
import { actions } from '../appSlice';
import { AppError, VersionControlSettings } from '../../types';
import { AppStatus } from '../state';
import { NOTE_FRONTMATTER_KEY } from '../../constants';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { ManifestManager } from '../../core/manifest-manager';
import { CleanupManager } from '../../core/cleanup-manager';
import { BackgroundTaskManager } from '../../core/BackgroundTaskManager';
import { TYPES } from '../../types/inversify.types';
import { DEFAULT_SETTINGS } from '../../constants';
import { CentralManifestRepository } from '../../core/storage/central-manifest-repository';

/**
 * Thunks related to the core application lifecycle, such as view initialization and history loading.
 */

/**
 * Calculates the effective settings for a given note (or global if no note) and applies them to the state.
 * This is the core logic for the new settings model.
 * @param noteId The ID of the note, or null to apply global/default settings.
 */
const loadEffectiveSettingsForNote = (noteId: string | null): AppThunk => async (dispatch, getState, container) => {
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const centralManifestRepo = container.get<CentralManifestRepository>(TYPES.CentralManifestRepo);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    // 1. Start with the hardcoded defaults.
    let effectiveSettings: VersionControlSettings = { ...DEFAULT_SETTINGS };

    // 2. Layer on the global settings from the central manifest.
    try {
        const centralManifest = await centralManifestRepo.load();
        if (centralManifest.globalSettings) {
            effectiveSettings = { ...effectiveSettings, ...centralManifest.globalSettings };
        }
    } catch (error) {
        console.error("VC: Could not load global settings from central manifest.", error);
    }

    // 3. If a note is active, layer its per-note settings on top.
    if (noteId) {
        try {
            const noteManifest = await manifestManager.loadNoteManifest(noteId);
            if (noteManifest?.settings) {
                effectiveSettings = { ...effectiveSettings, ...noteManifest.settings };
            }
        } catch (error) {
            console.error(`VC: Could not load per-note settings for note ${noteId}.`, error);
        }
    }

    // 4. Only dispatch if settings have actually changed to avoid unnecessary re-renders.
    if (JSON.stringify(getState().settings) !== JSON.stringify(effectiveSettings)) {
        dispatch(actions.updateSettings(effectiveSettings));
    }

    // 5. After updating settings, some background tasks might need to be re-evaluated.
    backgroundTaskManager.managePeriodicOrphanCleanup();
    backgroundTaskManager.manageWatchModeInterval();
};


export const initializeView = (leaf?: WorkspaceLeaf | null): AppThunk => async (dispatch, _getState, container) => {
    const app = container.get<App>(TYPES.App);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);

    try {
        const targetLeaf = leaf ?? app.workspace.activeLeaf;
        const activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
        
        dispatch(actions.initializeView(activeNoteInfo));

        // If the note was identified by the manifest, it means it's missing the frontmatter key.
        // We should write it back to the file to self-heal.
        if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
            dispatch(reconcileNoteId(activeNoteInfo.file, activeNoteInfo.noteId));
        }
        
        // Load the correct settings for the current context (note or no note).
        dispatch(loadEffectiveSettingsForNote(activeNoteInfo.noteId));

        // If a file is active, proceed to load its history.
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

export const reconcileNoteId = (file: TFile, noteId: string): AppThunk => async (_dispatch, _getState, container) => {
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    try {
        const success = await noteManager.writeNoteIdToFrontmatter(file, noteId);
        if (success) {
            uiService.showNotice(`Version Control: Restored missing vc-id for "${file.basename}".`, 3000);
        }
    } catch (error) {
        console.error(`Version Control: Error during vc-id reconciliation for "${file.path}".`, error);
        uiService.showNotice(`VC: Failed to restore vc-id for "${file.basename}". Check console.`, 5000);
    }
};

export const loadHistory = (file: TFile): AppThunk => async (dispatch, _getState, container) => {
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    try {
        let noteId = await noteManager.getNoteId(file); 
        if (!noteId) {
            noteId = await manifestManager.getNoteIdByPath(file.path);
        }
        
        const history = noteId ? await versionManager.getVersionHistory(noteId) : [];
        dispatch(actions.historyLoadedSuccess({ file, noteId, history }));

        // After history is loaded and state is READY, manage the watch mode interval.
        // This is the correct place to call it, as the state is now fully ready for the new note.
        backgroundTaskManager.manageWatchModeInterval();

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

export const loadHistoryForNoteId = (file: TFile, noteId: string): AppThunk => async (dispatch, _getState, container) => {
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    try {
        dispatch(loadEffectiveSettingsForNote(noteId));
        const history = await versionManager.getVersionHistory(noteId);
        dispatch(actions.historyLoadedSuccess({ file, noteId, history }));

        // Also call it here for consistency.
        backgroundTaskManager.manageWatchModeInterval();
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

export const handleMetadataChange = (file: TFile, cache: CachedMetadata): AppThunk => async (dispatch, getState, container) => {
    if (file.extension !== 'md') return;

    const state = getState();
    if (state.status === AppStatus.READY && state.isProcessing && state.file?.path === file.path) {
        return;
    }
    if (state.status === AppStatus.LOADING && state.file?.path === file.path) {
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const app = container.get<App>(TYPES.App);

    const fileCache = cache;
    const newNoteIdFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;
    const oldNoteIdInManifest = await manifestManager.getNoteIdByPath(file.path);

    let idChanged = false;
    if (typeof newNoteIdFromFrontmatter === 'string' && newNoteIdFromFrontmatter.trim() === '') {
        idChanged = null !== oldNoteIdInManifest;
    } else {
        idChanged = newNoteIdFromFrontmatter !== oldNoteIdInManifest;
    }

    if (idChanged) {
        manifestManager.invalidateCentralManifestCache();

        const currentState = getState();
        if ((currentState.status === AppStatus.READY || currentState.status === AppStatus.LOADING) && currentState.file?.path === file.path) {
            dispatch(initializeView(app.workspace.activeLeaf));
        }
    }
};

export const handleFileRename = (file: TFile, oldPath: string): AppThunk => async (dispatch, getState, container) => {
    if (file.extension !== 'md') return;

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const app = container.get<App>(TYPES.App);

    const oldNoteId = await manifestManager.getNoteIdByPath(oldPath);
    await noteManager.handleNoteRename(file, oldPath);
    
    const state = getState();
    if (state.file?.path === oldPath || (oldNoteId && state.noteId === oldNoteId)) {
        dispatch(initializeView(app.workspace.activeLeaf));
    }
};

export const handleFileDelete = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (file.extension !== 'md') return;

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);

    const deletedNoteId = await manifestManager.getNoteIdByPath(file.path); 
    
    noteManager.invalidateCentralManifestCache();
    manifestManager.invalidateCentralManifestCache();

    const state = getState();
    if (state.file?.path === file.path || (deletedNoteId && state.noteId === deletedNoteId)) {
        dispatch(actions.clearActiveNote()); 
    }
};

export const cleanupOrphanedVersions = (manualTrigger: boolean): AppThunk => async (_dispatch, _getState, container) => {
    const cleanupManager = container.get<CleanupManager>(TYPES.CleanupManager);
    const uiService = container.get<UIService>(TYPES.UIService);

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
