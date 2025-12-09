import { TFile, type CachedMetadata, debounce } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import { AppStatus } from '../state';
import { NoteManager } from '../../core/note-manager';
import { ManifestManager } from '../../core/manifest-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading, resolveSettings } from '../utils/settingsUtils';
import type VersionControlPlugin from '../../main';
import { initializeView } from './core.thunks';
import { performAutoSave } from './version.thunks';
import { saveNewEdit } from './edit-history.thunks';

/**
 * Thunks related to handling application and vault events.
 */

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
    const legacyKeys = plugin.settings.legacyNoteIdFrontmatterKeys;

    const fileCache = cache;
    const newNoteIdFromFrontmatter = fileCache?.frontmatter?.[noteIdKey] ?? null;
    const oldNoteIdInManifest = await manifestManager.getNoteIdByPath(file.path);

    let idChanged = false;
    
    if (typeof newNoteIdFromFrontmatter === 'string' && newNoteIdFromFrontmatter.trim() !== '') {
        // ID is present and valid
        idChanged = newNoteIdFromFrontmatter !== oldNoteIdInManifest;
    } else {
        // Primary ID missing. Check legacy keys.
        let foundLegacyId = false;
        if (legacyKeys && legacyKeys.length > 0) {
            for (const legacyKey of legacyKeys) {
                const legacyId = fileCache?.frontmatter?.[legacyKey];
                if (typeof legacyId === 'string' && legacyId.trim() !== '') {
                    // Found a valid legacy ID. Treat as if ID exists.
                    // If it matches manifest, then ID hasn't changed (just key).
                    if (legacyId === oldNoteIdInManifest) {
                        foundLegacyId = true;
                        break;
                    }
                }
            }
        }

        if (foundLegacyId) {
            idChanged = false;
        } else {
            // ID is truly missing (neither primary nor legacy found)
            idChanged = null !== oldNoteIdInManifest;
        }
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
    if (file.extension !== 'md' && file.extension !== 'base') return;

    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    
    const debouncerInfo = plugin.autoSaveDebouncers.get(oldPath);
    if (debouncerInfo) {
        debouncerInfo.debouncer.cancel();
        plugin.autoSaveDebouncers.delete(oldPath);
    }

    const oldNoteId = await manifestManager.getNoteIdByPath(oldPath);
    
    // Handle the rename, which may involve updating the ID if it depends on the path
    await noteManager.handleNoteRename(file, oldPath);
    
    const state = getState();
    // Re-initialize view if the active file was the one renamed
    if (state.file?.path === oldPath || (oldNoteId && state.noteId === oldNoteId)) {
        dispatch(initializeView());
    }
};

export const handleFileDelete = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    if (file.extension !== 'md' && file.extension !== 'base') return;
    
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

export const handleVaultSave = (file: TFile): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;

    // Filter: Only allow .md and .base files
    if (file.extension !== 'md' && file.extension !== 'base') return;

    // Filter: Ignore files in hidden folders (starting with .)
    if (file.path.split('/').some(part => part.startsWith('.'))) return;

    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
  
    const noteId = await noteManager.getNoteId(file) ?? await manifestManager.getNoteIdByPath(file.path);
    if (!noteId) return;
  
    // Check Version Settings
    const versionSettings = await resolveSettings(noteId, 'version', container);
    // Check Edit Settings
    const editSettings = await resolveSettings(noteId, 'edit', container);
    
    const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);

    // If neither wants auto-save, cancel and return
    if (!versionSettings.autoSaveOnSave && !editSettings.autoSaveOnSave) {
        if (debouncerInfo) {
            debouncerInfo.debouncer.cancel();
            plugin.autoSaveDebouncers.delete(file.path);
        }
        return;
    }
    
    // We use the shorter interval if both are enabled, or the enabled one.
    let intervalMs = 2000;
    if (versionSettings.autoSaveOnSave && editSettings.autoSaveOnSave) {
        intervalMs = Math.min(versionSettings.autoSaveOnSaveInterval, editSettings.autoSaveOnSaveInterval) * 1000;
    } else if (versionSettings.autoSaveOnSave) {
        intervalMs = versionSettings.autoSaveOnSaveInterval * 1000;
    } else {
        intervalMs = editSettings.autoSaveOnSaveInterval * 1000;
    }

    if (debouncerInfo && debouncerInfo.interval === intervalMs) {
        debouncerInfo.debouncer(file);
    } else {
        debouncerInfo?.debouncer.cancel();

        const newDebouncerFunc = debounce(
            (f: TFile) => {
                // Trigger saves based on settings
                if (versionSettings.autoSaveOnSave) {
                    dispatch(performAutoSave(f));
                }
                if (editSettings.autoSaveOnSave) {
                    dispatch(saveNewEdit(true)); // Pass true for isAuto
                }
            },
            intervalMs
        );

        plugin.autoSaveDebouncers.set(file.path, { debouncer: newDebouncerFunc, interval: intervalMs });
        
        newDebouncerFunc(file);
    }
};
