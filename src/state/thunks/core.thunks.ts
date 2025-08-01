import { TFile, type WorkspaceLeaf, type CachedMetadata, App, MarkdownView } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { AppError, VersionControlSettings } from '../../types';
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
import { isPluginUnloading } from './ThunkUtils';
import type VersionControlPlugin from '../../main';

/**
 * Thunks related to the core application lifecycle, such as view initialization and history loading.
 */

/**
 * Calculates the effective settings for a given note (or global if no note) and applies them to the state.
 * This thunk ONLY loads settings; it does not trigger side effects like syncing background tasks.
 * @param noteId The ID of the note, or null to apply global/default settings.
 */
const loadEffectiveSettingsForNote = (noteId: string | null): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);

    // 1. Start with the hardcoded defaults.
    let effectiveSettings: VersionControlSettings = { ...DEFAULT_SETTINGS };

    // 2. If a note is active, layer its per-note settings on top.
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

    // 3. Only dispatch if settings have actually changed to avoid unnecessary re-renders.
    if (JSON.stringify(getState().settings) !== JSON.stringify(effectiveSettings)) {
        dispatch(actions.updateSettings(effectiveSettings));
    }
};


export const initializeView = (leaf?: WorkspaceLeaf | null): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const app = container.get<App>(TYPES.App);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);

    try {
        let targetLeaf: WorkspaceLeaf | null;
        // If a leaf is explicitly provided (e.g., from an event), use it.
        // This is the source of truth when handling leaf-change events.
        if (leaf !== undefined) {
            targetLeaf = leaf;
        } else {
            // Otherwise, determine the active leaf using the recommended, safer API.
            // This is for calls that need to initialize based on the current app state.
            const activeMarkdownView = app.workspace.getActiveViewOfType(MarkdownView);
            targetLeaf = activeMarkdownView ? activeMarkdownView.leaf : null;
        }

        const activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
        
        dispatch(actions.initializeView(activeNoteInfo));

        // If the note was identified by the manifest, it means it's missing the frontmatter key.
        // We should write it back to the file to self-heal.
        if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
            dispatch(reconcileNoteId(activeNoteInfo.file, activeNoteInfo.noteId));
        }
        
        // Load the correct settings for the current context (note or no note).
        dispatch(loadEffectiveSettingsForNote(activeNoteInfo.noteId));

        // If a file is active, proceed to load its history. This will also trigger the watch mode sync.
        if (activeNoteInfo.file) {
            dispatch(loadHistory(activeNoteInfo.file));
        } else {
            // If no file is active, we still need to sync the watch mode to ensure it's off.
            const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
            backgroundTaskManager.syncWatchMode();
        }
    } catch (error) {
        console.error("Version Control: CRITICAL: Failed to initialize view.", error);
        const appError: AppError = {
            title: "Initialization failed",
            message: "Could not initialize the version control view.",
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    }
};

export const reconcileNoteId = (file: TFile, noteId: string): AppThunk => async (_dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    try {
        const success = await noteManager.writeNoteIdToFrontmatter(file, noteId);
        if (success) {
            uiService.showNotice(`Version control: Restored missing vc-id for "${file.basename}".`, 3000);
        }
    } catch (error) {
        console.error(`Version Control: Error during vc-id reconciliation for "${file.path}".`, error);
        uiService.showNotice(`VC: Failed to restore vc-id for "${file.basename}". Check the console for details.`, 5000);
    }
};

export const loadHistory = (file: TFile): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
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

        // After history is loaded and state is READY, sync the watch mode interval.
        // This is the correct place to call it.
        backgroundTaskManager.syncWatchMode();

    } catch (error) {
        console.error(`Version Control: Failed to load version history for "${file.path}".`, error);
        const appError: AppError = {
            title: "History load failed",
            message: `Could not load version history for "${file.basename}".`,
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    }
};

export const loadHistoryForNoteId = (file: TFile, noteId: string): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    try {
        dispatch(loadEffectiveSettingsForNote(noteId));
        const history = await versionManager.getVersionHistory(noteId);
        dispatch(actions.historyLoadedSuccess({ file, noteId, history }));

        // Also call it here for consistency after state becomes READY.
        backgroundTaskManager.syncWatchMode();
    } catch (error) {
        console.error(`Version Control: Failed to load version history for note ID "${noteId}" ("${file.path}").`, error);
        const appError: AppError = {
            title: "History load failed",
            message: `Could not load version history for "${file.basename}".`,
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    }
};

export const handleMetadataChange = (file: TFile, cache: CachedMetadata): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    if (file.extension !== 'md') return;

    const state = getState();
    if (state.status === AppStatus.READY && state.isProcessing && state.file?.path === file.path) {
        return;
    }
    if (state.status === AppStatus.LOADING && state.file?.path === file.path) {
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);

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
            dispatch(initializeView());
        }
    }
};

export const handleFileRename = (file: TFile, oldPath: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    if (file.extension !== 'md') return;

    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    
    // Clean up any debouncer associated with the old file path to prevent leaks.
    const debouncerInfo = plugin.autoSaveDebouncers.get(oldPath);
    if (debouncerInfo) {
        debouncerInfo.debouncer.cancel();
        plugin.autoSaveDebouncers.delete(oldPath);
    }

    const oldNoteId = await manifestManager.getNoteIdByPath(oldPath);
    await noteManager.handleNoteRename(file, oldPath);
    
    const state = getState();
    if (state.file?.path === oldPath || (oldNoteId && state.noteId === oldNoteId)) {
        dispatch(initializeView());
    }
};

export const handleFileDelete = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    if (file.extension !== 'md') return;
    
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);

    // Clean up any debouncer associated with the deleted file path to prevent leaks.
    const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);
    if (debouncerInfo) {
        debouncerInfo.debouncer.cancel();
        plugin.autoSaveDebouncers.delete(file.path);
    }

    const deletedNoteId = await manifestManager.getNoteIdByPath(file.path); 
    
    noteManager.invalidateCentralManifestCache();
    manifestManager.invalidateCentralManifestCache();

    const state = getState();
    if (state.file?.path === file.path || (deletedNoteId && state.noteId === deletedNoteId)) {
        dispatch(actions.clearActiveNote()); 
    }
};

export const cleanupOrphanedVersions = (): AppThunk => async (_dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const cleanupManager = container.get<CleanupManager>(TYPES.CleanupManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    try {
        const result = await cleanupManager.cleanupOrphanedVersions();
        if (result.success) {
            const { deletedNoteDirs, deletedVersionFiles } = result;
            const totalCleaned = deletedNoteDirs + deletedVersionFiles;

            if (totalCleaned > 0) {
                const messages: string[] = [];
                if (deletedNoteDirs > 0) {
                    messages.push(`${deletedNoteDirs} orphaned note director${deletedNoteDirs > 1 ? 'ies' : 'y'}`);
                }
                if (deletedVersionFiles > 0) {
                    messages.push(`${deletedVersionFiles} orphaned version file${deletedVersionFiles > 1 ? 's' : ''}`);
                }
                uiService.showNotice(`Cleanup complete. Removed ${messages.join(' and ')}.`, 7000);
            } else {
                uiService.showNotice("No orphaned version data found to clean up.", 5000);
            }
        } else {
            uiService.showNotice("Orphaned data cleanup failed. Check the console for details.", 7000);
        }
    } catch (err) {
        console.error("Version Control: Error during orphan cleanup thunk:", err);
        uiService.showNotice("An unexpected error occurred during orphan cleanup. Check the console for details.", 7000);
    }
};
