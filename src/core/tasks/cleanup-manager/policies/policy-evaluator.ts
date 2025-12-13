import { moment } from 'obsidian';
import { orderBy } from 'es-toolkit';
import type { RetentionSettings } from './retention-policy';
import type { VersionMap } from '@/core/tasks/cleanup-manager/types';

/**
 * Evaluates retention policies against a set of versions.
 * Returns a Set of version IDs that should be deleted.
 * 
 * @param versions - Map of version ID to version metadata
 * @param settings - Retention settings to apply
 * @returns Set of version IDs to delete
 */
export function evaluateRetentionPolicy(
  versions: VersionMap,
  settings: RetentionSettings
): Set<string> {
  const versionEntries = Object.entries(versions);
  
  // Sort by version number descending (newest first)
  const sortedVersions = orderBy(
    versionEntries,
    [(entry) => entry[1].versionNumber],
    ['desc']
  );

  // Never delete if there's only 1 or 0 versions
  if (sortedVersions.length <= 1) {
    return new Set();
  }

  if (typeof (moment as any) !== 'function') {
    console.error("VC: moment.js is not available. Cannot perform age-based cleanup.");
    return new Set();
  }

  const versionsToDelete = new Set<string>();
  const cutoffDate = (moment as any)().subtract(settings.autoCleanupDays, 'days');

  const isMaxVersionsCleanupEnabled = settings.maxVersionsPerNote > 0;
  const isAgeCleanupEnabled = settings.autoCleanupOldVersions && settings.autoCleanupDays > 0;

  sortedVersions.forEach(([id, versionData], index) => {
    // 1. Max Versions Policy
    if (isMaxVersionsCleanupEnabled && index >= settings.maxVersionsPerNote) {
      versionsToDelete.add(id);
    }
    
    // 2. Age Policy (Auto Cleanup Old Versions)
    // Only applies if explicitly enabled
    if (isAgeCleanupEnabled && (moment as any)(versionData.timestamp).isBefore(cutoffDate)) {
      versionsToDelete.add(id);
    }
  });

  // Safety Guard: Ensure we never delete the absolute newest version,
  // even if policy dictates it (e.g. max versions = 0 or very old timestamp on newest)
  if (versionsToDelete.size === sortedVersions.length) {
    const newestVersionId = sortedVersions[0]?.[0];
    if (newestVersionId) {
      versionsToDelete.delete(newestVersionId);
    }
  }

  return versionsToDelete;
}
