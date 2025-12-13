export interface RetentionSettings {
  maxVersionsPerNote: number;
  autoCleanupOldVersions: boolean;
  autoCleanupDays: number;
}

export function extractRetentionSettings(settings: Record<string, any>): RetentionSettings {
  const {
    maxVersionsPerNote = 0,
    autoCleanupOldVersions = false,
    autoCleanupDays = 0
  } = settings;

  return {
    maxVersionsPerNote,
    autoCleanupOldVersions,
    autoCleanupDays
  };
}

export function isRetentionEnabled(settings: RetentionSettings): boolean {
  const isMaxVersionsCleanupEnabled = settings.maxVersionsPerNote > 0;
  const isAgeCleanupEnabled = settings.autoCleanupOldVersions && settings.autoCleanupDays > 0;

  return isMaxVersionsCleanupEnabled || isAgeCleanupEnabled;
}
