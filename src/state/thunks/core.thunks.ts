import { TFile, type WorkspaceLeaf, App, FileView } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { AppError, HistorySettings } from '../../types';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { ManifestManager } from '../../core/manifest-manager';
import { CleanupManager } from '../../core/tasks/cleanup-manager';
import { BackgroundTaskManager } from '../../core/tasks/BackgroundTaskManager';
import { TYPES } from '../../types/inversify.types';
import { resolveSettings, isPluginUnloading } from '../utils/settingsUtils';
import type VersionControlPlugin from '../../main';
import { saveNewEdit } from './edit-history.thunks';
import { isPathAllowed } from '../../utils/path-filter';

/**
 * Thunks related to the core application lifecycle, such as view initialization and history loading.
 */

export const loadEffectiveSettingsForNote = (noteId: string | null): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const state = getState();
    const viewMode = state.viewMode;

    // Determine type based on viewMode
    const type = viewMode === 'versions' ? 'version' : 'edit';
    
    let effectiveSettings: HistorySettings;

    if (noteId) {
        effectiveSettings = await resolveSettings(noteId, type, container);
    } else {
        // No note context, use global defaults directly
        effectiveSettings = type === 'version' 
            ? { ...plugin.settings.versionHistorySettings, isGlobal: true }
            : { ...plugin.settings.editHistorySettings, isGlobal: true };
    }

    // Only dispatch if changed to prevent render loops
    if (JSON.stringify(getState().effectiveSettings) !== JSON.stringify(effectiveSettings)) {
        dispatch(actions.updateEffectiveSettings(effectiveSettings));
    }
};

export const autoRegisterNote = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    // Set a loading state for the file
    dispatch(actions.initializeView({ file, noteId: null, source: 'none' }));
    
    try {
        const result = await versionManager.saveNewVersionForFile(file, {
            name: 'Initial Version',
            isAuto: true,
            force: true, // Save even if empty
            settings: getState().settings,
        });

        if (result.status === 'saved') {
            uiService.showNotice(`"${file.basename}" is now under version control.`);
            // After saving, we have a noteId and history, so we can load it directly.
            dispatch(loadHistoryForNoteId(file, result.newNoteId));
        } else {
            // This could happen if another process registered it, or if content is identical to a deleted note's last version.
            // In this case, just proceed with a normal history load.
            dispatch(loadHistory(file));
        }
    } catch (error) {
        console.error(`Version Control: Failed to auto-register note "${file.path}".`, error);
        const appError: AppError = {
            title: "Auto-registration failed",
            message: `Could not automatically start version control for "${file.basename}".`,
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    } finally {
        if (!isPluginUnloading(container)) {
            backgroundTaskManager.syncWatchMode();
        }
    }
};

export const initializeView = (leaf?: WorkspaceLeaf | null): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const app = container.get<App>(TYPES.App);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    
    try {
        let targetLeaf: WorkspaceLeaf | null;
        if (leaf !== undefined) {
            targetLeaf = leaf;
        } else {
            // Use FileView to support .base files and other non-markdown files that implement FileView
            const activeView = app.workspace.getActiveViewOfType(FileView);
            targetLeaf = activeView ? activeView.leaf : null;
        }

        const activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
        
        // --- Context Change Check: Verify ID matches Path if required ---
        if (activeNoteInfo.file && activeNoteInfo.noteId) {
             await noteManager.verifyNoteIdMatchesPath(activeNoteInfo.file, activeNoteInfo.noteId);
             // Re-fetch state in case ID was updated
             const updatedInfo = await noteManager.getActiveNoteState(targetLeaf);
             if (updatedInfo.noteId) activeNoteInfo.noteId = updatedInfo.noteId;
        }
        // ----------------------------------------------------------------

        // --- Auto Registration Logic ---
        if (activeNoteInfo.file && !activeNoteInfo.noteId) {
            const versionSettings = plugin.settings.versionHistorySettings;
            const editSettings = plugin.settings.editHistorySettings;

            // Check Version History Auto-Reg
            if (versionSettings.autoRegisterNotes && isPathAllowed(activeNoteInfo.file.path, { pathFilters: versionSettings.pathFilters })) {
                dispatch(actions.setViewMode('versions'));
                dispatch(autoRegisterNote(activeNoteInfo.file));
                return;
            }

            // Check Edit History Auto-Reg
            if (editSettings.autoRegisterNotes && isPathAllowed(activeNoteInfo.file.path, { pathFilters: editSettings.pathFilters })) {
                dispatch(actions.setViewMode('edits'));
                dispatch(saveNewEdit(true)); // Auto-save first edit
                return;
            }
        }

        dispatch(actions.initializeView(activeNoteInfo));

        if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
            dispatch(reconcileNoteId(activeNoteInfo.file, activeNoteInfo.noteId));
        }
        
        dispatch(loadEffectiveSettingsForNote(activeNoteInfo.noteId));

        if (activeNoteInfo.file) {
            // Default to loading versions history since viewMode is reset to 'versions' in initializeView reducer
            dispatch(loadHistory(activeNoteInfo.file));
        } else {
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
    
    // Skip for .base files as they don't support frontmatter
    if (file.extension === 'base') return;

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
        const noteManifest = noteId ? await manifestManager.loadNoteManifest(noteId) : null;
        const currentBranch = noteManifest?.currentBranch ?? '';
        const availableBranches = noteManifest ? Object.keys(noteManifest.branches) : [];

        dispatch(actions.historyLoadedSuccess({ file, noteId, history, currentBranch, availableBranches }));

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
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    try {
        // Ensure settings are loaded before history to prevent race conditions or UI glitches
        await dispatch(loadEffectiveSettingsForNote(noteId));
        
        const history = await versionManager.getVersionHistory(noteId);
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        const currentBranch = noteManifest?.currentBranch ?? '';
        const availableBranches = noteManifest ? Object.keys(noteManifest.branches) : [];
        
        dispatch(actions.historyLoadedSuccess({ file, noteId, history, currentBranch, availableBranches }));

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

export const cleanupOrphanedVersions = (): AppThunk => async (_dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (state.isRenaming) {
        uiService.showNotice("Cannot clean up orphans while database is being renamed.");
        return;
    }

    const cleanupManager = container.get<CleanupManager>(TYPES.CleanupManager);

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
