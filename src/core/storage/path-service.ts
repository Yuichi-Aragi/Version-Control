import { normalizePath } from "obsidian";
import { injectable, inject } from 'inversify';
import { DEFAULT_DB_PATH } from "../../constants";
import { TYPES } from "../../types/inversify.types";
import type VersionControlPlugin from "../../main";

/**
 * A centralized service for generating all database-related file and folder paths.
 * This ensures consistency and makes it easy to change the DB structure in one place.
 */
@injectable()
export class PathService {
    constructor(@inject(TYPES.Plugin) private plugin: VersionControlPlugin) {}

    public getDbRoot(): string {
        // Provide a fallback for early initializations before settings are fully loaded.
        return this.plugin.settings?.databasePath || DEFAULT_DB_PATH;
    }

    public getNoteDbPath(noteId: string): string {
        // Note folders are now directly under the DB_PATH root.
        return normalizePath(`${this.getDbRoot()}/${noteId}`);
    }

    public getNoteManifestPath(noteId: string): string {
        return normalizePath(`${this.getNoteDbPath(noteId)}/manifest.json`);
    }

    public getNoteVersionsPath(noteId: string): string {
        return normalizePath(`${this.getNoteDbPath(noteId)}/versions`);
    }

    public getNoteVersionPath(noteId: string, versionId: string): string {
        return normalizePath(`${this.getNoteVersionsPath(noteId)}/${versionId}.md`);
    }
}