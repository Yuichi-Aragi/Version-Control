import { pickBy, isUndefined } from 'es-toolkit';
import type { ManifestManager, PluginEvents, VersionContentRepository, EditHistoryManager } from '@/core';
import type { NoteManifest, VersionMap } from '@/core/tasks/cleanup-manager/types';
import type VersionControlPlugin from '@/main';
import type { HistorySettings, Branch } from '@/types';
import { extractRetentionSettings, isRetentionEnabled, evaluateRetentionPolicy } from '@/core/tasks/cleanup-manager/policies';

/**
 * Handles policy-based cleanup for both Version History and Edit History.
 * Ensures isolation between branches and view modes.
 */
export class PolicyCleanupOperation {
  constructor(
    private readonly manifestManager: ManifestManager,
    private readonly editHistoryManager: EditHistoryManager,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly eventBus: PluginEvents,
    private readonly plugin: VersionControlPlugin
  ) {}

  /**
   * Executes cleanup for the specified note and mode.
   * 
   * @param noteId The ID of the note to clean.
   * @param mode 'version' for standard versions, 'edit' for edit history.
   */
  public async cleanup(noteId: string, mode: 'version' | 'edit'): Promise<void> {
    if (mode === 'version') {
      await this.cleanupVersions(noteId);
    } else {
      await this.cleanupEdits(noteId);
    }
  }

  private async cleanupVersions(noteId: string): Promise<void> {
    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest) return;

    const currentBranchName = noteManifest.currentBranch;
    const currentBranch = noteManifest.branches[currentBranchName];
    if (!currentBranch?.versions) return;

    // Resolve Settings for this specific branch
    const globalSettings = this.plugin.settings.versionHistorySettings;
    const branchSettings = currentBranch.settings;
    const effectiveSettings = this.resolveEffectiveSettings(globalSettings, branchSettings);

    const retentionSettings = extractRetentionSettings(effectiveSettings);
    
    // Check if cleanup is enabled for this specific context
    if (!isRetentionEnabled(retentionSettings)) return;

    const versionsToDelete = evaluateRetentionPolicy(currentBranch.versions as VersionMap, retentionSettings);

    if (versionsToDelete.size === 0) return;

    await this.deleteVersions(noteId, currentBranchName, versionsToDelete);
    
    // Notify UI to refresh if needed
    this.eventBus.trigger('version-deleted', noteId);
  }

  private async cleanupEdits(noteId: string): Promise<void> {
    const editManifest = await this.editHistoryManager.getEditManifest(noteId);
    if (!editManifest) return;

    const currentBranchName = editManifest.currentBranch;
    const currentBranch = editManifest.branches[currentBranchName];
    if (!currentBranch?.versions) return;

    // Resolve Settings for this specific branch
    const globalSettings = this.plugin.settings.editHistorySettings;
    const branchSettings = currentBranch.settings;
    const effectiveSettings = this.resolveEffectiveSettings(globalSettings, branchSettings);

    const retentionSettings = extractRetentionSettings(effectiveSettings);

    if (!isRetentionEnabled(retentionSettings)) return;

    const versionsToDelete = evaluateRetentionPolicy(currentBranch.versions as VersionMap, retentionSettings);

    if (versionsToDelete.size === 0) return;

    await this.deleteEdits(noteId, currentBranchName, versionsToDelete, editManifest);
    
    // Notify UI (Edit history view reloads on 'version-deleted' or similar triggers if implemented, 
    // but typically we might need a specific event or just rely on the fact that the view reloads on focus/open)
    // We trigger version-deleted as a generic signal that history changed.
    this.eventBus.trigger('version-deleted', noteId);
  }

  private async deleteVersions(noteId: string, branchName: string, versionIds: Set<string>): Promise<void> {
    // 1. Update Manifest (Atomic-like operation via Immer in Manager)
    const updateManifestPromise = this.manifestManager.updateNoteManifest(
      noteId,
      (manifest: NoteManifest) => {
        const branch = manifest.branches[branchName];
        if (branch) {
          for (const id of versionIds) {
            if (branch.versions[id]) {
              delete branch.versions[id];
            }
          }
        }
        manifest.lastModified = new Date().toISOString();
      }
    );

    // 2. Delete Files (Idempotent)
    const deleteFilesPromises = [...versionIds].map((id) =>
      this.versionContentRepo
        .delete(noteId, id)
        .catch((e) => console.error(`VC: Failed to delete version file for id ${id}`, e))
    );

    await Promise.all([updateManifestPromise, ...deleteFilesPromises]);
  }

  private async deleteEdits(
      noteId: string, 
      branchName: string, 
      versionIds: Set<string>, 
      manifest: NoteManifest
  ): Promise<void> {
      // 1. Update Manifest Object locally
      const branch = manifest.branches[branchName];
      if (!branch) return;

      for (const id of versionIds) {
          delete branch.versions[id];
      }
      manifest.lastModified = new Date().toISOString();

      // 2. Save Manifest
      await this.editHistoryManager.saveEditManifest(noteId, manifest);

      // 3. Delete from IndexedDB
      // We process these sequentially or parallel depending on IDB constraints, 
      // but parallel is usually fine for independent keys.
      const deletePromises = [...versionIds].map(id => 
          this.editHistoryManager.deleteEdit(noteId, branchName, id)
              .catch(e => console.error(`VC: Failed to delete edit ${id}`, e))
      );

      await Promise.all(deletePromises);
  }

  /**
   * Resolves effective settings by merging global defaults with branch overrides.
   * Mirrors logic in settingsUtils but decoupled for background operation.
   */
  private resolveEffectiveSettings(
      globalDefaults: HistorySettings,
      branchSettings: Branch['settings']
  ): HistorySettings {
      if (!branchSettings) {
          return { ...globalDefaults, isGlobal: true };
      }

      const isUnderGlobalInfluence = branchSettings.isGlobal !== false;

      if (isUnderGlobalInfluence) {
          return { ...globalDefaults, isGlobal: true };
      } else {
          // Filter undefineds to ensure clean merge and cast to Partial<HistorySettings>
          // to satisfy exactOptionalPropertyTypes
          const definedBranchSettings = pickBy(
              branchSettings,
              (value) => !isUndefined(value)
          ) as Partial<HistorySettings>;
          
          return { ...globalDefaults, ...definedBranchSettings, isGlobal: false };
      }
  }
}
