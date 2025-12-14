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
                const version = branch.versions[editId] as {
                    compressedSize?: number;
                    uncompressedSize?: number;
                    contentHash?: string;
                } | undefined;
                if (version) {
                    version.compressedSize = compressedSize;
                    version.uncompressedSize = uncompressedSize;
                    version.contentHash = contentHash;
                }
            }
        });
    }

    static updateManifestPath(manifest: NoteManifest, newPath: string): NoteManifest {
        return produce(manifest, (draft) => {
            draft.notePath = newPath;
        });
    }

    static updateManifestNoteId(manifest: NoteManifest, newNoteId: string, newPath: string): NoteManifest {
        return produce(manifest, (draft) => {
            draft.noteId = newNoteId;
            draft.notePath = newPath;
        });
    }
}
