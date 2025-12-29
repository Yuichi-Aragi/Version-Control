import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile, type WorkspaceLeaf, FileView } from 'obsidian';
import * as v from 'valibot';
import { appSlice } from '@/state/appSlice';
import type { AppError, HistorySettings, VersionHistoryEntry } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';
import { resolveSettings } from '@/state/utils/settingsUtils';
import { saveNewEdit } from '@/state/thunks/edit-history/thunks/save-edit.thunk';
import { isPathAllowed } from '@/utils/path-filter';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import { saveNewVersion } from '@/state/thunks/version/thunks/save-version.thunk';
import { NoteIdSchema } from '@/state/thunks/schemas';

/**
 * Thunks related to the core application lifecycle, such as view initialization and history loading.
 */

export const loadEffectiveSettingsForNote = createAsyncThunk<
    HistorySettings,
    string | null,
    ThunkConfig
>(
    'core/loadEffectiveSettingsForNote',
    async (noteId, { getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        // Validation
        if (noteId) {
            try {
                v.parse(NoteIdSchema, noteId);
            } catch (e) {
                console.error("Invalid Note ID", e);
                return rejectWithValue("Invalid Note ID");
            }
        }

        // Defensive check for settings availability
        if (!services.plugin?.settings) {
            console.warn("Version Control: Plugin settings not available in loadEffectiveSettingsForNote");
            return rejectWithValue("Settings unavailable");
        }

        const plugin = services.plugin;
        const state = getState().app;
        const viewMode = state.viewMode;

        // Determine type based on viewMode
        const type = viewMode === 'versions' ? 'version' : 'edit';

        let effectiveSettings: HistorySettings;

        if (noteId) {
            effectiveSettings = await resolveSettings(noteId, type, services);
        } else {
            // No note context, use global defaults directly
            const versionSettings = plugin.settings?.versionHistorySettings;
            const editSettings = plugin.settings?.editHistorySettings;
            effectiveSettings = type === 'version'
                ? { ...(versionSettings || DEFAULT_SETTINGS.versionHistorySettings), isGlobal: true }
                : { ...(editSettings || DEFAULT_SETTINGS.editHistorySettings), isGlobal: true };
        }

        // Race Check
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

        // Set a loading state for the file
        dispatch(appSlice.actions.initializeView({ file, noteId: null, source: 'none' }));

        try {
            // We use the thunk here to ensure consistency
            const resultAction = await dispatch(saveNewVersion({
                name: 'Initial Version',
                isAuto: true,
                force: true, // Save even if empty
                settings: getState().app.settings,
            }));

            if (saveNewVersion.rejected.match(resultAction)) {
                 throw new Error(resultAction.payload || 'Auto-registration failed');
            }
            
            const result = resultAction.payload;

            // Race Check
            if (shouldAbort(services, getState, { filePath: file.path })) return rejectWithValue('Context changed');

            if (result && result.status === 'saved' && result.newNoteId) {
                uiService.showNotice(`"${file.basename}" is now under version control.`);
                // After saving, we have a noteId and history, so we can load it directly.
                // STRICT: Await the load so the finally block runs after state is READY
                await dispatch(loadHistoryForNoteId({ file, noteId: result.newNoteId }));
            } else {
                // Fallback normal load
                await dispatch(loadHistory(file));
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
            let targetLeaf: WorkspaceLeaf | null;
            if (leaf !== undefined) {
                targetLeaf = leaf;
            } else {
                const activeView = app.workspace.getActiveViewOfType(FileView);
                targetLeaf = activeView ? activeView.leaf : null;
            }

            // --- IMMEDIATE FEEDBACK: Set Loading State Synchronously ---
            // We extract the file immediately to trigger the UI loading state.
            let initialFile: TFile | null = null;
            if (targetLeaf?.view instanceof FileView && targetLeaf.view.file) {
                initialFile = targetLeaf.view.file;
            }

            if (initialFile) {
                dispatch(appSlice.actions.initializeView({ 
                    file: initialFile, 
                    noteId: null, 
                    source: 'none' 
                }));
            } else {
                // If no file is active, clear immediately
                dispatch(appSlice.actions.clearActiveNote());
            }
            
            // Capture context version AFTER the initial synchronous dispatch
            // This is the version we must respect throughout the rest of this thunk
            const contextVersion = getState().app.contextVersion;

            // --- Async State Resolution ---
            const activeNoteInfo = await noteManager.getActiveNoteState(targetLeaf);
            
            // GUARD: Check for pending deviation to prevent race conditions during file creation
            if (activeNoteInfo.file && noteManager.isPendingDeviation(activeNoteInfo.file.path)) {
                return rejectWithValue('Pending deviation creation');
            }
            
            // Race Check: Ensure we are still in the same context version
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            // --- Context Change Check: Verify ID matches Path if required ---
            if (activeNoteInfo.file && activeNoteInfo.noteId) {
                await noteManager.verifyNoteIdMatchesPath(activeNoteInfo.file, activeNoteInfo.noteId);
                // Re-fetch state in case ID was updated
                const updatedInfo = await noteManager.getActiveNoteState(targetLeaf);
                if (updatedInfo.noteId) activeNoteInfo.noteId = updatedInfo.noteId;
            }

            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            // --- Auto Registration Logic ---
            if (activeNoteInfo.file && !activeNoteInfo.noteId) {
                const versionSettings = plugin.settings?.versionHistorySettings || DEFAULT_SETTINGS.versionHistorySettings;
                const editSettings = plugin.settings?.editHistorySettings || DEFAULT_SETTINGS.editHistorySettings;

                // Check Version History Auto-Reg
                if (versionSettings.autoRegisterNotes && isPathAllowed(activeNoteInfo.file.path, { pathFilters: versionSettings.pathFilters })) {
                    dispatch(appSlice.actions.setViewMode('versions'));
                    dispatch(autoRegisterNote(activeNoteInfo.file));
                    return;
                }

                // Check Edit History Auto-Reg
                if (editSettings.autoRegisterNotes && isPathAllowed(activeNoteInfo.file.path, { pathFilters: editSettings.pathFilters })) {
                    dispatch(appSlice.actions.setViewMode('edits'));
                    dispatch(saveNewEdit(true)); // Auto-save first edit
                    return;
                }
            }

            // Sync Dispatch to update state with resolved ID
            // NOTE: This dispatch might increment contextVersion if noteId changed.
            // But since we are inside the flow that owns this change, it is acceptable.
            // However, to be strictly safe, we should check guards before dispatching.
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');
            
            dispatch(appSlice.actions.initializeView(activeNoteInfo));

            if (activeNoteInfo.source === 'manifest' && activeNoteInfo.file && activeNoteInfo.noteId) {
                dispatch(reconcileNoteId({ file: activeNoteInfo.file, noteId: activeNoteInfo.noteId }));
            }

            // STRICT: Wait for settings before loading history
            if (activeNoteInfo.noteId) {
                await dispatch(loadEffectiveSettingsForNote(activeNoteInfo.noteId));
            }

            // Race Check: Use file path + context version
            // Note: contextVersion might have incremented if initializeView(activeNoteInfo) changed the ID.
            // We should use the *latest* context version for the loadHistory call.
            const currentContextVersion = getState().app.contextVersion;
            
            // Verify file path matches
            if (activeNoteInfo.file && getState().app.file?.path !== activeNoteInfo.file.path) {
                return rejectWithValue('Context changed');
            }

            if (activeNoteInfo.file) {
                // Default to loading versions history since viewMode is reset to 'versions' in initializeView reducer
                await dispatch(loadHistory(activeNoteInfo.file));
            }
            
            // CRITICAL: Sync watch mode AFTER history is loaded and state is READY.
            // This ensures the timer reappears correctly after a context switch.
            // We check the context version one last time to ensure we don't sync for a stale context.
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
            
            // Only report error if context hasn't changed
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

        // Skip for .base files as they don't support frontmatter
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

export const loadHistory = createAsyncThunk<
    { file: TFile; noteId: string | null; history: VersionHistoryEntry[]; currentBranch: string | null; availableBranches: string[]; contextVersion: number },
    TFile,
    ThunkConfig
>(
    'core/loadHistory',
    async (file, { dispatch, getState, extra: services, rejectWithValue }) => {
        // Capture context version immediately
        const contextVersion = getState().app.contextVersion;
        
        if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

        const noteManager = services.noteManager;
        const manifestManager = services.manifestManager;
        const versionManager = services.versionManager;

        try {
            let noteId = await noteManager.getNoteId(file);
            if (!noteId) {
                noteId = await manifestManager.getNoteIdByPath(file.path);
            }

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            const history = noteId ? await versionManager.getVersionHistory(noteId) : [];
            const noteManifest = noteId ? await manifestManager.loadNoteManifest(noteId) : null;
            const currentBranch = noteManifest?.currentBranch ?? '';
            const availableBranches = noteManifest ? Object.keys(noteManifest.branches) : [];

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            return { file, noteId, history, currentBranch, availableBranches, contextVersion };

        } catch (error) {
            // Check context before reporting error
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            console.error(`Version Control: Failed to load version history for "${file.path}".`, error);
            const appError: AppError = {
                title: "History load failed",
                message: `Could not load version history for "${file.basename}".`,
                details: error instanceof Error ? error.message : String(error),
            };
            dispatch(appSlice.actions.reportError(appError));
            return rejectWithValue(appError.message);
        }
    }
);

export const loadHistoryForNoteId = createAsyncThunk<
    { file: TFile; noteId: string | null; history: VersionHistoryEntry[]; currentBranch: string | null; availableBranches: string[]; contextVersion: number },
    { file: TFile; noteId: string },
    ThunkConfig
>(
    'core/loadHistoryForNoteId',
    async ({ file, noteId }, { dispatch, getState, extra: services, rejectWithValue }) => {
        // Capture context version immediately
        const contextVersion = getState().app.contextVersion;
        
        if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');
        
        const versionManager = services.versionManager;
        const manifestManager = services.manifestManager;

        try {
            // Validation
            v.parse(NoteIdSchema, noteId);

            // Ensure settings are loaded before history
            await dispatch(loadEffectiveSettingsForNote(noteId));

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            const history = await versionManager.getVersionHistory(noteId);
            const noteManifest = await manifestManager.loadNoteManifest(noteId);
            const currentBranch = noteManifest?.currentBranch ?? '';
            const availableBranches = noteManifest ? Object.keys(noteManifest.branches) : [];

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            return { file, noteId, history, currentBranch, availableBranches, contextVersion };
        } catch (error) {
            // Check context before reporting error
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            console.error(`Version Control: Failed to load version history for note ID "${noteId}" ("${file.path}").`, error);
            const appError: AppError = {
                title: "History load failed",
                message: `Could not load version history for "${file.basename}".`,
                details: error instanceof Error ? error.message : String(error),
            };
            dispatch(appSlice.actions.reportError(appError));
            return rejectWithValue(appError.message);
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
            const result = await cleanupManager.cleanupOrphanedVersions();

            if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

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
            return;
        } catch (err) {
            console.error("Version Control: Error during orphan cleanup thunk:", err);
            uiService.showNotice("An unexpected error occurred during orphan cleanup. Check the console for details.", 7000);
            return rejectWithValue(String(err));
        }
    }
);
