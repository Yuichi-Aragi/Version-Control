/**
 * Edit Aggregator Helper
 *
 * Utilities for aggregating and transforming edit history data
 */

import { orderBy } from 'es-toolkit';
import { map } from 'es-toolkit/compat';
import type { VersionHistoryEntry, NoteManifest } from '@/types';

/**
 * Builds sorted edit history entries from manifest data
 *
 * @param manifest - The note manifest containing version data
 * @param noteId - The note ID
 * @param activeBranch - The active branch name
 * @returns Sorted array of version history entries
 */
export function buildEditHistory(
    manifest: NoteManifest,
    noteId: string,
    activeBranch: string
): VersionHistoryEntry[] {
    const currentBranchData = manifest.branches[activeBranch];

    if (!currentBranchData || !currentBranchData.versions) {
        return [];
    }

    const history = map(currentBranchData.versions, (data: any, id: string) => ({
        id,
        noteId,
        notePath: manifest.notePath,
        branchName: activeBranch,
        versionNumber: data.versionNumber,
        timestamp: data.timestamp,
        size: data.size,
        compressedSize: data.compressedSize,
        uncompressedSize: data.uncompressedSize,
        ...(data.name && { name: data.name }),
        ...(data.description && { description: data.description }),
        wordCount: data.wordCount,
        wordCountWithMd: data.wordCountWithMd,
        charCount: data.charCount,
        charCountWithMd: data.charCountWithMd,
        lineCount: data.lineCount,
        lineCountWithoutMd: data.lineCountWithoutMd,
    }));

    return orderBy(history, ['versionNumber'], ['desc']);
}

/**
 * Calculates the next version number for a branch
 *
 * @param branchVersions - Versions object from branch manifest
 * @returns Next version number
 */
export function calculateNextVersionNumber(
    branchVersions: Record<string, any>
): number {
    const existingVersionNumbers = Object.values(branchVersions).map(
        (v: any) => v.versionNumber
    );
    const maxVersion =
        existingVersionNumbers.length > 0
            ? Math.max(...existingVersionNumbers)
            : 0;
    return maxVersion + 1;
}

/**
 * Checks if content is duplicate of the latest edit
 *
 * @param content - Current content to check
 * @param lastContent - Last saved content
 * @returns True if content is identical
 */
export function isDuplicateContent(
    content: string,
    lastContent: string | null
): boolean {
    return lastContent === content;
}
