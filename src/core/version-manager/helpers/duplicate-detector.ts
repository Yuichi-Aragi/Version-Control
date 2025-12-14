import { diffLines } from 'diff';
import type { VersionControlSettings } from '@/types';

/**
 * Detects duplicate versions and minimal changes
 */
export class DuplicateDetector {
  /**
   * Checks if content is a duplicate of the latest version
   */
  static isDuplicate(latestContent: string | null, newContent: string): boolean {
    if (latestContent === null) {
      return false;
    }
    return latestContent === newContent;
  }

  /**
   * Checks if changes are below the minimum threshold for auto-save
   */
  static shouldSkipMinimalChanges(
    latestContent: string | null,
    newContent: string,
    isAuto: boolean,
    settings: VersionControlSettings
  ): boolean {
    if (!isAuto || latestContent === null) {
      return false;
    }

    const settingsWithMinLines = settings as any;
    if (!settingsWithMinLines.enableMinLinesChangedCheck) {
      return false;
    }

    const changes = diffLines(latestContent, newContent);
    let changedLines = 0;

    for (const part of changes) {
      if (part.added || part.removed) {
        changedLines += part.count!;
      }
    }

    return changedLines < settingsWithMinLines.minLinesChanged;
  }
}
