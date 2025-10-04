import { TFile, type WorkspaceLeaf, type CachedMetadata, App, MarkdownView } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { AppError, VersionControlSettings } from '../../types';
import { AppStatus } from '../state';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { ManifestManager } from '../../core/manifest-manager';
import { CleanupManager } from '../../core/tasks/cleanup-manager';
import { BackgroundTaskManager } from '../../core/tasks/BackgroundTaskManager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';
import type VersionControlPlugin from '../../main';
import { autoRegisterNote } from './version.thunks';
import { isPathAllowed } from '../../utils/path-filter';

/**
 * Thunks related to the core application lifecycle, such as view initialization and history loading.
 */

export const loadEffectiveSettingsForNote = (noteId: string | null): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    const globalSettings = plugin.settings;
    let effectiveSettings: VersionControlSettings = { ...globalSettings };

    if (noteId) {
        try {
            const noteManifest = await manifestManager.loadNoteManifest(noteId);
            const currentBranchName = noteManifest?.currentBranch;
            const perBranchSettings = currentBranchName ? noteManifest?.branches[currentBranchName]?.settings : undefined;

            const isUnderGlobalInfluence = perBranchSettings?.isGlobal === true || perBranchSettings === undefined;

            if (isUnderGlobalInfluence) {
                effectiveSettings = { ...globalSettings, isGlobal: true };
            } else {
                effectiveSettings = { ...globalSettings, ...perBranchSettings, isGlobal: false };
            }
        } catch (error) {
            console.error(`VC: Could not load per-note settings for note ${noteId}. Using global settings.`, error);
            effectiveSettings = { ...globalSettings, isGlobal: true };
        }
    } else {
        effectiveSettings = { ...globalSettings, isGlobal: true };
    }

    effectiveSettings.autoRegisterNotes = globalSettings.autoRegisterNotes;
    effectiveSettings.databasePath = globalSettings.databasePath;
    effectiveSettings.pathFilters = globalSettings.pathFilters;
    effectiveSettings.noteIdFrontmatterKey = globalSettings.noteIdFrontmatterKey;

    if (JSON.stringify(getState().settings) !== JSON.stringify(effectiveSettings)) {
        dispatch(actions.updateSettings(effectiveSettings));
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
            const activeMarkdownView = app.workspace.getActiveViewOfType(MarkdownView);
            targetLeaf = activeMarkdownView ? activeMarkdownView.leaf : null;
        }

        const activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
        
        if (activeNoteInfo.file && !activeNoteInfo.noteId && plugin.settings.autoRegisterNotes) {
            if (isPathAllowed(activeNoteInfo.file.path, plugin.settings)) {
                dispatch(autoRegisterNote(activeNoteInfo.file));
                return;
            }
        }

        dispatch(actions.initializeView(activeNoteInfo));

        if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
            dispatch(reconcileNoteId(activeNoteInfo.file, activeNoteInfo.noteId));
        }
        
        dispatch(loadEffectiveSettingsForNote(activeNoteInfo.noteId));

        if (activeNoteInfo.file) {
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
        dispatch(loadEffectiveSettingsForNote(noteId));
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

export const handleMetadataChange = (file: TFile, cache: CachedMetadata): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    
    // Guard against processing files that are part of an in-progress deviation creation.
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    if (noteManager.isPendingDeviation(file.path)) {
        return;
    }

    if (file.extension !== 'md') return;

    const state = getState();
    if (state.status === AppStatus.READY && state.isProcessing && state.file?.path === file.path) {
        return;
    }
    if (state.status === AppStatus.LOADING && state.file?.path === file.path) {
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const noteIdKey = plugin.settings.noteIdFrontmatterKey;

    const fileCache = cache;
    const newNoteIdFromFrontmatter = fileCache?.frontmatter?.[noteIdKey] ?? null;
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