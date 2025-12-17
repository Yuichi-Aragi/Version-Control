import { produce } from 'immer';
import type { NoteManifest } from '@/types';

export class ManifestService {
    static updateManifestWithEditInfo(
        manifest: NoteManifest,
        branchName: string,
        editId: string,
        compressedSize: number,
        uncompressedSize: number,
        contentHash: string
    ): NoteManifest {
        return produce(manifest, (draft) => {
            const branch = draft.branches[branchName];
            if (branch) {
                const version = branch.versions[editId];
                if (version) {
                    version.compressedSize = compressedSize;
                    version.uncompressedSize = uncompressedSize;
                    version.contentHash = contentHash;
                }
            }
            draft.lastModified = new Date().toISOString();
        });
    }

    static updateManifestPath(manifest: NoteManifest, newPath: string): NoteManifest {
        return produce(manifest, (draft) => {
            draft.notePath = newPath;
            draft.lastModified = new Date().toISOString();
        });
    }

    static updateManifestNoteId(manifest: NoteManifest, newNoteId: string, newPath: string): NoteManifest {
        return produce(manifest, (draft) => {
            draft.noteId = newNoteId;
            draft.notePath = newPath;
            draft.lastModified = new Date().toISOString();
        });
    }

    static createBranch(
        manifest: NoteManifest,
        branchName: string,
        sourceBranchName?: string
    ): NoteManifest {
        return produce(manifest, (draft) => {
            if (draft.branches[branchName]) {
                return;
            }

            if (sourceBranchName && draft.branches[sourceBranchName]) {
                draft.branches[branchName] = {
                    versions: { ...draft.branches[sourceBranchName].versions },
                    totalVersions: draft.branches[sourceBranchName].totalVersions,
                    settings: draft.branches[sourceBranchName].settings
                        ? { ...draft.branches[sourceBranchName].settings }
                        : undefined,
                    timelineSettings: draft.branches[sourceBranchName].timelineSettings
                        ? { ...draft.branches[sourceBranchName].timelineSettings }
                        : undefined
                };
            } else {
                draft.branches[branchName] = {
                    versions: {},
                    totalVersions: 0
                };
            }

            draft.lastModified = new Date().toISOString();
        });
    }

    static setBranchData(
        manifest: NoteManifest,
        branchName: string,
        branchData: any
    ): NoteManifest {
        return produce(manifest, (draft) => {
            if (!draft.branches) {
                draft.branches = {};
            }
            draft.branches[branchName] = branchData;
            draft.lastModified = new Date().toISOString();
        });
    }

    static switchBranch(manifest: NoteManifest, branchName: string): NoteManifest {
        return produce(manifest, (draft) => {
            if (draft.branches[branchName]) {
                draft.currentBranch = branchName;
                draft.lastModified = new Date().toISOString();
            }
        });
    }

    static removeEditFromManifest(
        manifest: NoteManifest,
        branchName: string,
        editId: string
    ): NoteManifest {
        return produce(manifest, (draft) => {
            const branch = draft.branches[branchName];
            if (branch) {
                delete branch.versions[editId];
                branch.totalVersions = Math.max(0, branch.totalVersions - 1);
                draft.lastModified = new Date().toISOString();
            }
        });
    }

    static addEditToManifest(
        manifest: NoteManifest,
        branchName: string,
        editId: string,
        versionInfo: any
    ): NoteManifest {
        return produce(manifest, (draft) => {
            const branch = draft.branches[branchName];
            if (branch) {
                branch.versions[editId] = versionInfo;
                branch.totalVersions = Object.keys(branch.versions).length;
                draft.lastModified = new Date().toISOString();
            }
        });
    }

    static validateManifest(manifest: NoteManifest): boolean {
        if (!manifest.noteId || !manifest.notePath || !manifest.currentBranch) {
            return false;
        }

        if (!manifest.branches || typeof manifest.branches !== 'object') {
            return false;
        }

        if (!manifest.branches[manifest.currentBranch]) {
            return false;
        }

        for (const [_branchName, branch] of Object.entries(manifest.branches)) {
            if (!branch.versions || typeof branch.versions !== 'object') {
                return false;
            }

            if (typeof branch.totalVersions !== 'number' || branch.totalVersions < 0) {
                return false;
            }

            if (branch.totalVersions !== Object.keys(branch.versions).length) {
                return false;
            }
        }

        return true;
    }

    static sanitizeManifest(manifest: NoteManifest): NoteManifest {
        return produce(manifest, (draft) => {
            if (!draft.branches) {
                draft.branches = {};
            }

            if (!draft.branches[draft.currentBranch]) {
                const firstBranch = Object.keys(draft.branches)[0];
                if (firstBranch) {
                    draft.currentBranch = firstBranch;
                } else {
                    draft.currentBranch = 'main';
                    draft.branches['main'] = { versions: {}, totalVersions: 0 };
                }
            }

            for (const [_branchName, branch] of Object.entries(draft.branches)) {
                if (!branch.versions) {
                    branch.versions = {};
                }

                if (typeof branch.totalVersions !== 'number' || branch.totalVersions < 0) {
                    branch.totalVersions = Object.keys(branch.versions).length;
                }

                for (const [editId, version] of Object.entries(branch.versions)) {
                    if (!version || typeof version !== 'object') {
                        delete branch.versions[editId];
                    }
                }
            }

            draft.lastModified = new Date().toISOString();
        });
    }
}
