/**
 * Manifest Sync Helper
 *
 * Utilities for synchronizing edit manifests with note manifests
 */

import type { NoteManifest } from '@/types';
import type { ManifestSyncResult } from '../types';

/**
 * Syncs edit manifest with note manifest active branch
 *
 * @param manifest - The edit manifest to sync
 * @param activeBranch - The active branch from note manifest
 * @returns Sync result with dirty flag and active branch
 */
export function syncEditManifest(
    manifest: NoteManifest,
    activeBranch: string
): ManifestSyncResult {
    let dirty = false;

    // Sync current branch pointer to match Note Manifest
    if (manifest.currentBranch !== activeBranch) {
        manifest.currentBranch = activeBranch;
        dirty = true;
    }

    // Ensure the active branch exists in edit manifest
    if (!manifest.branches[activeBranch]) {
        manifest.branches[activeBranch] = {
            versions: {},
            totalVersions: 0,
        };
        dirty = true;
    }

    return {
        dirty,
        activeBranch,
    };
}

/**
 * Creates a new edit manifest structure
 *
 * @param noteId - The note ID
 * @param notePath - The note file path
 * @param activeBranch - The active branch name
 * @returns New note manifest
 */
export function createEditManifest(
    noteId: string,
    notePath: string,
    activeBranch: string
): NoteManifest {
    const now = new Date().toISOString();
    return {
        noteId,
        notePath,
        currentBranch: activeBranch,
        branches: {
            [activeBranch]: {
                versions: {},
                totalVersions: 0,
            },
        },
        createdAt: now,
        lastModified: now,
    };
}

/**
 * Ensures a branch exists in the manifest
 *
 * @param manifest - The manifest to update
 * @param branchName - The branch name to ensure exists
 * @returns The branch data
 */
export function ensureBranchExists(
    manifest: NoteManifest,
    branchName: string
): NoteManifest['branches'][string] {
    let branch = manifest.branches[branchName];
    if (!branch) {
        branch = {
            versions: {},
            totalVersions: 0,
        };
        manifest.branches[branchName] = branch;
    }
    return branch;
}
