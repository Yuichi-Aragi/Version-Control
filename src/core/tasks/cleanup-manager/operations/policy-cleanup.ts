import type { ManifestManager, PluginEvents, VersionContentRepository, EditHistoryManager } from '@/core';
import type { NoteManifest, VersionMap } from '@/core/tasks/cleanup-manager/types';
import type VersionControlPlugin from '@/main';
import { extractRetentionSettings, isRetentionEnabled, evaluateRetentionPolicy } from '@/core/tasks/cleanup-manager/policies';
import { SettingsResolver, type LoosePartial } from '@/core/settings';
import type { HistorySettings } from '@/types';

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

  public async cleanup(noteId: string, mode: 'version' | 'edit'): Promise<void> {
    const isVersionMode = mode === 'version';
    
    // 1. Load Manifest
    const manifest = isVersionMode 
      ? await this.manifestManager.loadNoteManifest(noteId)
      : await this.editHistoryManager.getEditManifest(noteId);

    if (!manifest) return;

    const currentBranchName = manifest.currentBranch;
    const currentBranch = manifest.branches[currentBranchName];
    if (!currentBranch?.versions) return;

    // 2. Resolve Settings
    const globalSettings = isVersionMode 
      ? this.plugin.settings.versionHistorySettings 
      : this.plugin.settings.editHistorySettings;
      
    const effectiveSettings = SettingsResolver.resolve(
        globalSettings, 
        currentBranch.settings as LoosePartial<HistorySettings> | undefined
    );
    
    const retentionSettings = extractRetentionSettings(effectiveSettings);
    
    if (!isRetentionEnabled(retentionSettings)) return;

    // 3. Evaluate Policy
    const versionsToDelete = evaluateRetentionPolicy(currentBranch.versions as VersionMap, retentionSettings);

    if (versionsToDelete.size === 0) return;

    // 4. Execute Deletion
    if (isVersionMode) {
      await this.deleteVersions(noteId, currentBranchName, versionsToDelete);
    } else {
      await this.deleteEdits(noteId, currentBranchName, versionsToDelete);
    }
    
    this.eventBus.trigger('version-deleted', noteId);
  }

  private async deleteVersions(noteId: string, branchName: string, versionIds: Set<string>): Promise<void> {
    const updateManifestPromise = this.manifestManager.updateNoteManifest(
      noteId,
      (manifest: NoteManifest) => {
        const branch = manifest.branches[branchName];
        if (branch) {
          for (const id of versionIds) {
            delete branch.versions[id];
          }
        }
        manifest.lastModified = new Date().toISOString();
      }
    );

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
      versionIds: Set<string>
  ): Promise<void> {
      const manifest = await this.editHistoryManager.getEditManifest(noteId);
      if (!manifest) return;

      const branch = manifest.branches[branchName];
      if (!branch) return;

      for (const id of versionIds) {
          delete branch.versions[id];
      }
      manifest.lastModified = new Date().toISOString();

      await this.editHistoryManager.saveEditManifest(noteId, manifest);

      const deletePromises = [...versionIds].map(id => 
          this.editHistoryManager.deleteEdit(noteId, branchName, id)
              .catch(e => console.error(`VC: Failed to delete edit ${id}`, e))
      );

      await Promise.all(deletePromises);
  }
}
