import { normalizePath } from "obsidian";
import { injectable } from 'inversify';
import { DB_PATH } from "../../constants";

/**
 * A centralized service for generating all database-related file and folder paths.
 * This ensures consistency and makes it easy to change the DB structure in one place.
 */
@injectable()
export class PathService {
    public getDbRoot(): string {
        return DB_PATH;
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
