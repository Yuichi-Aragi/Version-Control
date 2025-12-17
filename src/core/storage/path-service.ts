import { normalizePath } from "obsidian";
import { injectable, inject } from 'inversify';
import * as v from 'valibot';
import { DEFAULT_DB_PATH } from "@/constants";
import { TYPES } from '@/types/inversify.types';
import type VersionControlPlugin from "@/main";

/**
 * Valibot schema for validating noteId inputs.
 * Ensures the noteId is a non-empty string with reasonable length constraints.
 */
const NoteIdSchema = v.pipe(
    v.string('noteId must be a string'),
    v.nonEmpty('noteId cannot be empty'),
    v.maxLength(500, 'noteId cannot exceed 500 characters'),
    v.transform((s: string): string => s.trim())
);

/**
 * Valibot schema for validating versionId inputs.
 * Ensures the versionId is a non-empty string with reasonable length constraints.
 */
const VersionIdSchema = v.pipe(
    v.string('versionId must be a string'),
    v.nonEmpty('versionId cannot be empty'),
    v.maxLength(500, 'versionId cannot exceed 500 characters'),
    v.transform((s: string): string => s.trim())
);

/**
 * Valibot schema for validating branchName inputs.
 */
const BranchNameSchema = v.pipe(
    v.string('branchName must be a string'),
    v.nonEmpty('branchName cannot be empty'),
    v.maxLength(255, 'branchName cannot exceed 255 characters'),
    v.transform((s: string): string => s.trim())
);

/**
 * A centralized, robust, and defensively programmed service for generating all database-related file and folder paths.
 * Ensures consistency, type safety, error resilience, and backward compatibility.
 * All methods are strictly guarded against invalid inputs and edge cases using valibot validation.
 */
@injectable()
export class PathService {
    private readonly FALLBACK_DB_ROOT: string = DEFAULT_DB_PATH;

    constructor(@inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin) {
        // Defensive: Ensure plugin reference is valid at construction time
        if (!plugin) {
            throw new Error('PathService: Plugin dependency is required and cannot be null or undefined.');
        }
    }

    /**
     * Retrieves the root database path with strict fallback and validation.
     * Guarantees a safe, normalized, non-empty string path.
     * @returns {string} A normalized, valid database root path.
     */
    public getDbRoot(): string {
        try {
            // Defensive: Validate plugin and settings existence
            const settings = this.plugin?.settings;
            let rawPath = settings?.databasePath;

            // Fallback if settings or databasePath is missing/invalid
            if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
                rawPath = this.FALLBACK_DB_ROOT;
            }

            // Normalize and validate result
            const normalized = normalizePath(rawPath.trim());
            if (!normalized || typeof normalized !== 'string') {
                throw new Error('Normalization failed: result is not a valid string.');
            }

            return normalized;
        } catch (error) {
            console.warn(`PathService.getDbRoot: Fallback to default due to error:`, error);
            return normalizePath(this.FALLBACK_DB_ROOT);
        }
    }

    /**
     * Generates the path for a note's database folder.
     * Strictly validates noteId and ensures safe path construction.
     * @param {string} noteId - Unique identifier for the note. Must be non-empty string.
     * @returns {string} Normalized path to the note's database folder.
     * @throws {Error} If noteId is invalid.
     */
    public getNoteDbPath(noteId: string): string {
        this.validateNoteId(noteId, 'getNoteDbPath');

        try {
            const dbRoot = this.getDbRoot();
            const sanitizedNoteId = this.sanitizePathComponent(noteId);
            
            const rawPath = `${dbRoot}/${sanitizedNoteId}`;
            const normalized = normalizePath(rawPath);

            if (!normalized || typeof normalized !== 'string') {
                throw new Error('Path normalization failed for note database path.');
            }

            return normalized;
        } catch (error) {
            throw new Error(`PathService.getNoteDbPath: Failed to generate path for noteId "${noteId}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generates the path to a note's manifest file.
     * @param {string} noteId - Unique identifier for the note.
     * @returns {string} Normalized path to the manifest.json file.
     * @throws {Error} If noteId is invalid or path construction fails.
     */
    public getNoteManifestPath(noteId: string): string {
        this.validateNoteId(noteId, 'getNoteManifestPath');

        try {
            const noteDbPath = this.getNoteDbPath(noteId);
            const rawPath = `${noteDbPath}/manifest.json`;
            const normalized = normalizePath(rawPath);

            if (!normalized || typeof normalized !== 'string') {
                throw new Error('Path normalization failed for manifest path.');
            }

            return normalized;
        } catch (error) {
            throw new Error(`PathService.getNoteManifestPath: Failed to generate manifest path for noteId "${noteId}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generates the path to a note's versions directory.
     * @param {string} noteId - Unique identifier for the note.
     * @returns {string} Normalized path to the versions directory.
     * @throws {Error} If noteId is invalid or path construction fails.
     */
    public getNoteVersionsPath(noteId: string): string {
        this.validateNoteId(noteId, 'getNoteVersionsPath');

        try {
            const noteDbPath = this.getNoteDbPath(noteId);
            const rawPath = `${noteDbPath}/versions`;
            const normalized = normalizePath(rawPath);

            if (!normalized || typeof normalized !== 'string') {
                throw new Error('Path normalization failed for versions path.');
            }

            return normalized;
        } catch (error) {
            throw new Error(`PathService.getNoteVersionsPath: Failed to generate versions path for noteId "${noteId}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generates the path to a specific version of a note.
     * @param {string} noteId - Unique identifier for the note.
     * @param {string} versionId - Unique identifier for the version. Must be non-empty string.
     * @returns {string} Normalized path to the version markdown file.
     * @throws {Error} If noteId or versionId is invalid or path construction fails.
     */
    public getNoteVersionPath(noteId: string, versionId: string): string {
        this.validateNoteId(noteId, 'getNoteVersionPath');
        this.validateVersionId(versionId, 'getNoteVersionPath');

        try {
            const versionsPath = this.getNoteVersionsPath(noteId);
            const sanitizedVersionId = this.sanitizePathComponent(versionId);
            const rawPath = `${versionsPath}/${sanitizedVersionId}.md`;
            const normalized = normalizePath(rawPath);

            if (!normalized || typeof normalized !== 'string') {
                throw new Error('Path normalization failed for version path.');
            }

            return normalized;
        } catch (error) {
            throw new Error(`PathService.getNoteVersionPath: Failed to generate version path for noteId "${noteId}", versionId "${versionId}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generates the path to the branches directory for a note.
     * @param {string} noteId - Unique identifier for the note.
     * @returns {string} Normalized path to the branches directory.
     */
    public getBranchesPath(noteId: string): string {
        this.validateNoteId(noteId, 'getBranchesPath');
        try {
            const noteDbPath = this.getNoteDbPath(noteId);
            const rawPath = `${noteDbPath}/branches`;
            return normalizePath(rawPath);
        } catch (error) {
            throw new Error(`PathService.getBranchesPath: Failed to generate path for noteId "${noteId}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generates the path for a specific branch folder.
     * @param {string} noteId - Unique identifier for the note.
     * @param {string} branchName - Name of the branch.
     * @returns {string} Normalized path to the branch folder.
     */
    public getBranchPath(noteId: string, branchName: string): string {
        this.validateNoteId(noteId, 'getBranchPath');
        this.validateBranchName(branchName, 'getBranchPath');

        try {
            const branchesPath = this.getBranchesPath(noteId);
            const sanitizedBranchName = this.sanitizePathComponent(branchName);
            const rawPath = `${branchesPath}/${sanitizedBranchName}`;
            return normalizePath(rawPath);
        } catch (error) {
            throw new Error(`PathService.getBranchPath: Failed to generate path for noteId "${noteId}", branch "${branchName}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generates a filename for a vctrl file.
     * @param {string} timestamp - The timestamp string (usually Date.now().toString()).
     * @returns {string} The filename with extension.
     */
    public getVctrlFilename(timestamp: string): string {
        // Ensure timestamp only contains safe characters
        const safeTimestamp = timestamp.replace(/[^0-9]/g, '');
        return `${safeTimestamp}.vctrl`;
    }

    /**
     * Validates that a noteId is a non-empty, non-whitespace string using valibot.
     * @param {unknown} noteId - The note identifier to validate.
     * @param {string} methodName - Name of the calling method for error context.
     * @throws {Error} If validation fails.
     * @private
     */
    private validateNoteId(noteId: unknown, methodName: string): asserts noteId is string {
        const result = v.safeParse(NoteIdSchema, noteId);
        if (!result.success) {
            const messages = result.issues.map(issue => issue.message).join('; ');
            throw new Error(`PathService.${methodName}: Invalid noteId - ${messages}`);
        }
    }

    /**
     * Validates that a versionId is a non-empty, non-whitespace string using valibot.
     * @param {unknown} versionId - The version identifier to validate.
     * @param {string} methodName - Name of the calling method for error context.
     * @throws {Error} If validation fails.
     * @private
     */
    private validateVersionId(versionId: unknown, methodName: string): asserts versionId is string {
        const result = v.safeParse(VersionIdSchema, versionId);
        if (!result.success) {
            const messages = result.issues.map(issue => issue.message).join('; ');
            throw new Error(`PathService.${methodName}: Invalid versionId - ${messages}`);
        }
    }

    private validateBranchName(branchName: unknown, methodName: string): asserts branchName is string {
        const result = v.safeParse(BranchNameSchema, branchName);
        if (!result.success) {
            const messages = result.issues.map(issue => issue.message).join('; ');
            throw new Error(`PathService.${methodName}: Invalid branchName - ${messages}`);
        }
    }

    /**
     * Sanitizes a path component by removing/replacing dangerous characters.
     * Does NOT remove valid filesystem characters — only mitigates obvious path traversal or injection risks.
     * Preserves backward compatibility by not altering valid note/version IDs unnecessarily.
     * @param {string} component - The path component to sanitize.
     * @returns {string} Sanitized component safe for filesystem use.
     * @private
     */
    private sanitizePathComponent(component: string): string {
        if (typeof component !== 'string') {
            return '';
        }

        // Remove path traversal attempts and control characters
        // Does NOT encode — preserves backward compatibility with existing IDs
        return component
            .replace(/\.{2,}/g, '.')           // Defend against ".." directory traversal
            .replace(/[\\/]/g, '_')            // Replace forward/backward slashes with underscore
            .replace(/[\x00-\x1F\x7F]/g, '_'); // Replace control characters with underscore
    }
}
