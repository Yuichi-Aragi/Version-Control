import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile, type WorkspaceLeaf, FileView } from 'obsidian';
import * as v from 'valibot';
import { appSlice } from '@/state/appSlice';
import type { AppError, HistorySettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';
import { resolveSettings } from '@/state/utils/settingsUtils';
import { saveNewEdit } from '@/state/thunks/edit-history/thunks/save-edit.thunk';
import { isPathAllowed } from '@/utils/path-filter';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import { saveNewVersion } from '@/state/thunks/version/thunks/save-version.thunk';
import { NoteIdSchema } from '@/state/thunks/schemas';
import { historyApi } from '@/state/apis/history.api';

/**
 * Thunks related to the core application lifecycle, such as view initialization.
 */

export const loadEffectiveSettingsForNote = createAsyncThunk<
    HistorySettings,
    string | null,
    ThunkConfig
>(
    'core/loadEffectiveSettingsForNote',
    async (noteId, { getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        if (noteId) {
            try {
                v.parse(NoteIdSchema, noteId);
            } catch (e) {
                console.error("Invalid Note ID", e);
                return rejectWithValue("Invalid Note ID");
            }
        }

        if (!services.plugin?.settings) {
            console.warn("Version Control: Plugin settings not available in loadEffectiveSettingsForNote");
            return rejectWithValue("Settings unavailable");
        }

        const plugin = services.plugin;
        const state = getState().app;
        const viewMode = state.viewMode;

        const type = viewMode === 'versions' ? 'version' : 'edit';

        let effectiveSettings: HistorySettings;

        if (noteId) {
            effectiveSettings = await resolveSettings(noteId, type, services);
        } else {
            const versionSettings = plugin.settings?.versionHistorySettings;
            const editSettings = plugin.settings?.editHistorySettings;
            effectiveSettings = type === 'version'
                ? { ...(versionSettings || DEFAULT_SETTINGS.versionHistorySettings), isGlobal: true }
                : { ...(editSettings || DEFAULT_SETTINGS.editHistorySettings), isGlobal: true };
        }

        if (shouldAbort(services, getState, noteId ? { noteId } : undefined)) return rejectWithValue('Context changed');

        return effectiveSettings;
    }
);

export const autoRegisterNote = createAsyncThunk<
    void,
    TFile,
    ThunkConfig
>(
    'core/autoRegisterNote',
    async (file, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const uiService = services.uiService;
        const backgroundTaskManager = services.backgroundTaskManager;

        dispatch(appSlice.actions.initializeView({ file, noteId: null, source: 'none' }));

        try {
            // Explicitly allow initialization for auto-register
            const resultAction = await dispatch(saveNewVersion({
                name: 'Initial Version',
                isAuto: true,
                allowInit: true,
                force: true,
                settings: getState().app.settings,
            }));

            if (saveNewVersion.rejected.match(resultAction)) {
                 throw new Error(resultAction.payload || 'Auto-registration failed');
            }
            
            const result = resultAction.payload;

            if (shouldAbort(services, getState, { filePath: file.path })) return rejectWithValue('Context changed');

            if (result && result.status === 'saved' && result.newNoteId) {
                uiService.showNotice(`"${file.basename}" is now under version control.`);
                // Invalidate tags to force reload of history and branches
                dispatch(historyApi.util.invalidateTags([
                    { type: 'VersionHistory', id: result.newNoteId },
                    { type: 'Branches', id: result.newNoteId },
                    'Settings' // Invalidate settings as well since we have a new note context
                ]));
            }
            return;
        } catch (error) {
            console.error(`Version Control: Failed to auto-register note "${file.path}".`, error);
            const appError: AppError = {
                title: "Auto-registration failed",
                message: `Could not automatically start version control for "${file.basename}".`,
                details: error instanceof Error ? error.message : String(error),
            };
            dispatch(appSlice.actions.reportError(appError));
            return rejectWithValue(appError.message);
        } finally {
            if (!shouldAbort(services, getState)) {
                backgroundTaskManager.syncWatchMode();
            }
        }
    }
);

export const initializeView = createAsyncThunk<
    void,
    WorkspaceLeaf | null | undefined,
    ThunkConfig
>(
    'core/initializeView',
    async (leaf, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');
        const app = services.app;
        const noteManager = services.noteManager;
        const plugin = services.plugin;
        const backgroundTaskManager = services.backgroundTaskManager;

        try {
            let targetLeaf: WorkspaceLeaf | null = null;
            
            if (leaf !== undefined) {
                targetLeaf = leaf;
            } else {
                // Strategy 1: The most recent leaf (if sidebar is focused)
                // This is critical for sidebar plugins to maintain context of the last active note
                const recentLeaf = app.workspace.getMostRecentLeaf();
                if (recentLeaf?.view instanceof FileView) {
                    targetLeaf = recentLeaf;
                } else {
                    // Strategy 2: The leaf of the currently active FileView (if focused)
                    const activeView = app.workspace.getActiveViewOfType(FileView);
                    if (activeView) {
                        targetLeaf = activeView.leaf;
                    } else {
                        // Strategy 3: Generic active leaf check (fallback for edge cases)
                        const genericLeaf = app.workspace.activeLeaf;
                        if (genericLeaf?.view instanceof FileView) {
                            targetLeaf = genericLeaf;
                        }
                    }
                }
            }

            let initialFile: TFile | null = null;
            if (targetLeaf?.view instanceof FileView && targetLeaf.view.file) {
                initialFile = targetLeaf.view.file;
            }

            // Fallback: If leaf resolution failed to yield a file, try getting active file directly
            if (!initialFile) {
                initialFile = app.workspace.getActiveFile();
            }

            if (initialFile) {
                dispatch(appSlice.actions.initializeView({ 
                    file: initialFile, 
                    noteId: null, 
                    source: 'none' 
                }));
            } else {
                // Silent fallback: If no file is open, just clear the view.
                dispatch(appSlice.actions.clearActiveNote());
                return;
            }
            
            const contextVersion = getState().app.contextVersion;

            // Defensive: noteManager might throw if file system is weird
            let activeNoteInfo;
            try {
                activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
            } catch (e) {
                console.warn("Version Control: Failed to get active note state", e);
                // Fallback to basic file info
                if (initialFile) {
                    activeNoteInfo = { file: initialFile, noteId: null, source: 'none' as const };
                } else {
                    dispatch(appSlice.actions.clearActiveNote());
                    return;
                }
            }
            
            if (activeNoteInfo.file && noteManager.isPendingDeviation(activeNoteInfo.file.path)) {
                return rejectWithValue('Pending deviation creation');
            }
            
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            if (activeNoteInfo.file && activeNoteInfo.noteId) {
                await noteManager.verifyNoteIdMatchesPath(activeNoteInfo.file, activeNoteInfo.noteId);
                const updatedInfo = await noteManager.getActiveNoteState(targetLeaf);
                if (updatedInfo.noteId) activeNoteInfo.noteId = updatedInfo.noteId;
            }

            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            if (activeNoteInfo.file && !activeNoteInfo.noteId) {
                const versionSettings = plugin.settings?.versionHistorySettings || DEFAULT_SETTINGS.versionHistorySettings;
                const editSettings = plugin.settings?.editHistorySettings || DEFAULT_SETTINGS.editHistorySettings;

                if (versionSettings.autoRegisterNotes && isPathAllowed(activeNoteInfo.file.path, { pathFilters: versionSettings.pathFilters })) {
                    dispatch(appSlice.actions.setViewMode('versions'));
                    dispatch(autoRegisterNote(activeNoteInfo.file));
                    return;
                }

                if (editSettings.autoRegisterNotes && isPathAllowed(activeNoteInfo.file.path, { pathFilters: editSettings.pathFilters })) {
                    dispatch(appSlice.actions.setViewMode('edits'));
                    // Explicitly allow initialization for auto-register
                    dispatch(saveNewEdit({ isAuto: true, allowInit: true }));
                    return;
                }
            }

            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');
            
            dispatch(appSlice.actions.initializeView(activeNoteInfo));

            if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
                dispatch(reconcileNoteId({ file: activeNoteInfo.file, noteId: activeNoteInfo.noteId }));
            }

            const currentContextVersion = getState().app.contextVersion;
            
            if (activeNoteInfo.file && getState().app.file?.path !== activeNoteInfo.file.path) {
                return rejectWithValue('Context changed');
            }

            if (!shouldAbort(services, getState, { contextVersion: currentContextVersion })) {
                backgroundTaskManager.syncWatchMode();
            }
            
            return;
        } catch (error) {
            console.error("Version Control: CRITICAL: Failed to initialize view.", error);
            const appError: AppError = {
                title: "Initialization failed",
                message: "Could not initialize the version control view.",
                details: error instanceof Error ? error.message : String(error),
            };
            
            if (!shouldAbort(services, getState)) {
                dispatch(appSlice.actions.reportError(appError));
            }
            return rejectWithValue(appError.message);
        }
    }
);

export const reconcileNoteId = createAsyncThunk<
    void,
    { file: TFile; noteId: string },
    ThunkConfig
>(
    'core/reconcileNoteId',
    async ({ file, noteId }, { getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        if (file.extension === 'base') return;

        const noteManager = services.noteManager;
        const uiService = services.uiService;

        try {
            const success = await noteManager.writeNoteIdToFrontmatter(file, noteId);
            if (success) {
                uiService.showNotice(`Version control: Restored missing vc-id for "${file.basename}".`, 3000);
            }
            return;
        } catch (error) {
            console.error(`Version Control: Error during vc-id reconciliation for "${file.path}".`, error);
            uiService.showNotice(`VC: Failed to restore vc-id for "${file.basename}". Check the console for details.`, 5000);
            return;
        }
    }
);

export const cleanupOrphanedVersions = createAsyncThunk<
    void,
    void,
    ThunkConfig
>(
    'core/cleanupOrphanedVersions',
    async (_, { getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');
        const state = getState().app;
        const uiService = services.uiService;
        if (state.isRenaming) {
            uiService.showNotice("Cannot clean up orphans while database is being renamed.");
            return rejectWithValue('Renaming in progress');
        }

        const cleanupManager = services.cleanupManager;

        try {
            uiService.showNotice("Starting deep cleanup... this may take a moment.");
            const result = await cleanupManager.cleanupOrphanedVersions();

            if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

            if (result.success) {
                const { deletedNoteDirs, deletedVersionFiles, deletedDuplicates, deletedOrphans, recoveredNotes } = result;
                const totalCleaned = deletedNoteDirs + deletedVersionFiles + deletedDuplicates + deletedOrphans;

                const messages: string[] = [];
                if (deletedDuplicates > 0) messages.push(`${deletedDuplicates} duplicate IDs resolved`);
                if (recoveredNotes > 0) messages.push(`${recoveredNotes} missing notes recovered`);
                if (deletedOrphans > 0) messages.push(`${deletedOrphans} orphaned notes deleted`);
                if (deletedNoteDirs > 0) messages.push(`${deletedNoteDirs} orphaned folders removed`);
                if (deletedVersionFiles > 0) messages.push(`${deletedVersionFiles} orphaned version files removed`);

                if (totalCleaned > 0 || recoveredNotes > 0) {
                    uiService.showNotice(`Cleanup complete: ${messages.join(', ')}.`, 10000);
                } else {
                    uiService.showNotice("Cleanup complete. No issues found.", 5000);
                }
            } else {
                uiService.showNotice("Cleanup finished with errors. Check console.", 7000);
            }
            return;
        } catch (err) {
            console.error("Version Control: Error during orphan cleanup thunk:", err);
            uiService.showNotice("An unexpected error occurred during cleanup. Check the console for details.", 7000);
            return rejectWithValue(String(err));
        }
    }
);

export const loadHistory = createAsyncThunk<
    void,
    TFile,
    ThunkConfig
>(
    'core/loadHistory',
    async (file, { dispatch, extra: services, rejectWithValue }) => {
        try {
            const noteManager = services.noteManager;
            const noteId = await noteManager.getNoteId(file);
            
            if (noteId) {
                dispatch(historyApi.util.invalidateTags([
                    { type: 'VersionHistory', id: noteId },
                    { type: 'EditHistory', id: noteId },
                    { type: 'Branches', id: noteId },
                    'Settings'
                ]));
            }
            return;
        } catch (e) {
            console.error("Failed to reload history", e);
            return rejectWithValue(String(e));
        }
    }
);
