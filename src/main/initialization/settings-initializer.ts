import * as v from 'valibot';
import { Notice } from 'obsidian';
import { DEFAULT_SETTINGS } from '@/constants';
import type { VersionControlSettings, NoteEntry } from '@/types';
import { CentralManifestSchema, VersionControlSettingsSchema } from '@/schemas';
import type VersionControlPlugin from '@/main/VersionControlPlugin';

/**
 * Handles settings initialization, migration, and persistence.
 */
export class SettingsInitializer {
    constructor(private plugin: VersionControlPlugin) {}

    /**
     * Loads settings from disk with migration support for legacy formats.
     */
    async loadSettings(): Promise<void> {
        try {
            const loadedData: any = await this.plugin.loadData() || {};
            let settingsData: Partial<VersionControlSettings>;

            // --- Migration Logic: Flat to Nested Structure ---
            if ('maxVersionsPerNote' in loadedData && !('versionHistorySettings' in loadedData)) {
                this.migrateFlatSettings(loadedData);
            }

            // --- Migration Logic: Merge Separate Edit Manifest into Central Manifest ---
            if (loadedData.editHistoryManifest) {
                this.migrateEditHistoryManifest(loadedData);
            }

            // Try parsing as the new full settings format first
            const settingsParseResult = v.safeParse(VersionControlSettingsSchema, loadedData);
            if (settingsParseResult.success) {
                settingsData = settingsParseResult.output;
            } else {
                // If that fails, try parsing as the old central manifest format for migration
                const manifestParseResult = v.safeParse(CentralManifestSchema, loadedData);
                if (manifestParseResult.success) {
                    console.log("Version Control: Migrating settings from old central manifest format.");
                    settingsData = { centralManifest: manifestParseResult.output };
                } else {
                    console.warn("Version Control: Unknown or invalid settings format detected, using defaults. Validation errors:", settingsParseResult.issues);
                    settingsData = {};
                }
            }

            // Merge defaults with loaded data
            const mergedSettings = {
                ...DEFAULT_SETTINGS,
                ...settingsData,
                centralManifest: {
                    ...DEFAULT_SETTINGS.centralManifest,
                    ...(settingsData.centralManifest || {}),
                },
                versionHistorySettings: {
                    ...DEFAULT_SETTINGS.versionHistorySettings,
                    ...(settingsData.versionHistorySettings || {}),
                },
                editHistorySettings: {
                    ...DEFAULT_SETTINGS.editHistorySettings,
                    ...(settingsData.editHistorySettings || {}),
                }
            };

            this.plugin.settings = v.parse(VersionControlSettingsSchema, mergedSettings);
            await this.saveSettings();
        } catch (error) {
            console.error("Version Control: Failed to load and validate settings", error);
            this.plugin.settings = { ...DEFAULT_SETTINGS };
            await this.saveSettings();
        }
    }

    private migrateFlatSettings(loadedData: any) {
        console.log("Version Control: Migrating settings from legacy flat format.");
        try {
            const historyKeys = [
                'maxVersionsPerNote', 'autoCleanupOldVersions', 'autoCleanupDays',
                'useRelativeTimestamps', 'enableVersionNaming', 'enableVersionDescription',
                'showDescriptionInList', 'isListView', 'renderMarkdownInPreview',
                'enableWatchMode', 'watchModeInterval', 'autoSaveOnSave',
                'autoSaveOnSaveInterval', 'enableMinLinesChangedCheck', 'minLinesChanged',
                'enableWordCount', 'includeMdSyntaxInWordCount', 'enableCharacterCount',
                'includeMdSyntaxInCharacterCount', 'enableLineCount', 'includeMdSyntaxInLineCount',
                'isGlobal', 'autoRegisterNotes', 'pathFilters'
            ];

            const migratedVersionSettings: any = {};
            for (const key of historyKeys) {
                if (key in loadedData) {
                    migratedVersionSettings[key] = loadedData[key];
                    // Clean up old key to avoid confusion, though not strictly necessary as schema validation drops them
                    delete loadedData[key];
                }
            }

            loadedData.versionHistorySettings = {
                ...DEFAULT_SETTINGS.versionHistorySettings,
                ...migratedVersionSettings
            };
            loadedData.editHistorySettings = {
                ...DEFAULT_SETTINGS.editHistorySettings
            };
        } catch (migrationError) {
            console.error("Version Control: Settings migration failed.", migrationError);
        }
    }

    private migrateEditHistoryManifest(loadedData: any) {
        console.log("Version Control: Migrating edit history manifest to central manifest.");
        try {
            const centralNotes = loadedData.centralManifest?.notes || {};
            const editNotes = loadedData.editHistoryManifest?.notes || {};

            // 1. Unified Map Strategy
            // We create a unified map of ID -> NoteEntry to handle merges.
            // We use an extended type to track the source for conflict resolution.
            const unifiedNotes = new Map<string, NoteEntry & { _source: 'version' | 'edit' | 'both' }>();

            // Load Version History (Primary Source of Truth)
            for (const [id, entry] of Object.entries(centralNotes)) {
                // @ts-ignore
                unifiedNotes.set(id, { ...entry, hasEditHistory: false, _source: 'version' });
            }

            // Merge Edit History
            for (const [id, entry] of Object.entries(editNotes)) {
                if (unifiedNotes.has(id)) {
                    // ID exists in both. Merge.
                    const existing = unifiedNotes.get(id)!;
                    existing.hasEditHistory = true;
                    existing._source = 'both';
                    // We implicitly keep the Version History's path/metadata as primary.
                } else {
                    // Only in edit history. Add it.
                    // @ts-ignore
                    unifiedNotes.set(id, { ...entry, hasEditHistory: true, _source: 'edit' });
                }
            }

            // 2. Path Deduplication Strategy
            // Ensure one Path has only one ID.
            const pathToCandidates = new Map<string, Array<{ id: string, entry: any }>>();

            for (const [id, entry] of unifiedNotes.entries()) {
                const path = entry.notePath;
                if (!pathToCandidates.has(path)) {
                    pathToCandidates.set(path, []);
                }
                pathToCandidates.get(path)!.push({ id, entry });
            }

            const finalNotes: Record<string, NoteEntry> = {};

            for (const [path, candidates] of pathToCandidates.entries()) {
                const firstCandidate = candidates[0];
                if (!firstCandidate) continue;

                if (candidates.length === 1) {
                    const { id, entry } = firstCandidate;
                    delete entry._source;
                    finalNotes[id] = entry;
                    continue;
                }

                // Conflict: Multiple IDs for same path.
                // Resolution:
                // 1. Sort by createdAt (Ascending/Oldest first).
                // 2. Tie-breaker: Prefer 'version' or 'both' source over 'edit'.
                candidates.sort((a, b) => {
                    const timeA = a.entry.createdAt ? new Date(a.entry.createdAt).getTime() : Date.now();
                    const timeB = b.entry.createdAt ? new Date(b.entry.createdAt).getTime() : Date.now();
                    
                    if (timeA !== timeB) {
                        return timeA - timeB; // Keep oldest
                    }
                    
                    // Tie-breaker: Prefer Version history (0) over Edit history (1)
                    const score = (s: string) => (s === 'version' || s === 'both' ? 0 : 1);
                    return score(a.entry._source) - score(b.entry._source);
                });

                // Winner is the first element
                const winner = candidates[0];
                
                if (winner) {
                    console.log(`VC: Migration conflict for path "${path}". Keeping ID ${winner.id} (Created: ${winner.entry.createdAt}). Discarding ${candidates.length - 1} others.`);
                    delete winner.entry._source;
                    finalNotes[winner.id] = winner.entry;
                }
            }

            // Update loadedData
            if (!loadedData.centralManifest) {
                loadedData.centralManifest = { version: "1.0.0", notes: {} };
            }
            loadedData.centralManifest.notes = finalNotes;
            
            // Remove legacy manifest
            delete loadedData.editHistoryManifest;

        } catch (e) {
            console.error("Version Control: Failed to migrate edit history manifest.", e);
        }
    }

    /**
     * Saves current settings to disk with validation.
     */
    async saveSettings(): Promise<void> {
        try {
            const validatedSettings = v.parse(VersionControlSettingsSchema, this.plugin.settings);
            await this.plugin.saveData(validatedSettings);
        } catch (error) {
            console.error("Version Control: Failed to save settings due to validation error", error);
            new Notice("Failed to save settings. Please check the console for details.");
        }
    }
}
