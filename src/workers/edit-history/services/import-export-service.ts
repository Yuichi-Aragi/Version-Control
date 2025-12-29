import { zip, unzip, strToU8, strFromU8, type Zippable } from 'fflate';
import { produce } from 'immer';
import { db } from '@/workers/edit-history/database';
import { ManifestService } from '@/workers/edit-history/services/manifest-service';
import { StateConsistencyError, ValidationError } from '@/workers/edit-history/errors';
import type { StoredEdit } from '@/workers/edit-history/types';

export class ImportExportService {
    private static readonly MAX_ZIP_SIZE = 100 * 1024 * 1024;
    private static readonly MAX_FILE_COUNT = 10000;

    static async exportBranchData(
        noteId: string,
        branchName: string
    ): Promise<ArrayBuffer> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .toArray();

        // NOTE: We do NOT return early if edits.length === 0.
        // We must generate a valid ZIP file representing the empty state to persist deletions.

        if (edits.length > this.MAX_FILE_COUNT) {
            throw new ValidationError(
                `Too many edits to export: ${edits.length}`,
                'editCount'
            );
        }

        const metadataList: Omit<StoredEdit, 'content'>[] = [];
        const files: Zippable = {};

        let totalSize = 0;
        
        for (const edit of edits) {
            const { content, ...metadata } = edit;
            metadataList.push(metadata);

            const fileName = `blobs/${edit.editId}.bin`;
            files[fileName] = [new Uint8Array(content), { level: 0 }];
            
            totalSize += content.byteLength;
            
            if (totalSize > this.MAX_ZIP_SIZE) {
                throw new ValidationError(
                    `Export size exceeds maximum ${this.MAX_ZIP_SIZE} bytes`,
                    'exportSize'
                );
            }
        }

        // Get current manifest for this branch to preserve version metadata AND settings
        const manifestRecord = await db.manifests.get(noteId);
        const branchManifest = manifestRecord?.manifest.branches[branchName];
        
        // Use the manifest's lastModified as the export timestamp to ensure consistency
        const exportedAt = manifestRecord?.manifest.lastModified || new Date().toISOString();

        const metadataJson = JSON.stringify(metadataList);
        files['data.json'] = [strToU8(metadataJson), { level: 9 }];
        
        // Export Metadata
        files['manifest.json'] = [strToU8(JSON.stringify({
            noteId,
            branchName,
            editCount: edits.length,
            totalSize,
            version: '1.0',
            exportedAt: exportedAt,
            branchMetadata: branchManifest // Include full branch manifest info (settings, versions, etc.)
        })), { level: 9 }];

        return new Promise<ArrayBuffer>((resolve, reject) => {
            zip(files, { level: 9 }, (err, data) => {
                if (err) {
                    reject(new StateConsistencyError('ZIP creation failed', { originalError: err }));
                } else if (data.length > this.MAX_ZIP_SIZE) {
                    reject(new ValidationError(
                        `Generated ZIP exceeds maximum size: ${data.length} bytes`,
                        'zipSize'
                    ));
                } else {
                    resolve(data.buffer as ArrayBuffer);
                }
            });
        });
    }

    static async importBranchData(
        noteId: string,
        branchName: string,
        zipData: ArrayBuffer
    ): Promise<void> {
        if (zipData.byteLength === 0) {
            throw new ValidationError('Empty ZIP data', 'zipData');
        }

        if (zipData.byteLength > this.MAX_ZIP_SIZE) {
            throw new ValidationError(
                `ZIP size ${zipData.byteLength} exceeds maximum ${this.MAX_ZIP_SIZE}`,
                'zipSize'
            );
        }

        const unzipped = await new Promise<Zippable>((resolve, reject) => {
            unzip(new Uint8Array(zipData), (err, data) => {
                if (err) {
                    reject(new StateConsistencyError('ZIP extraction failed', { originalError: err }));
                } else if (Object.keys(data).length > this.MAX_FILE_COUNT) {
                    reject(new ValidationError('Too many files in ZIP', 'fileCount'));
                } else {
                    resolve(data);
                }
            });
        });

        const metadataFile = unzipped['data.json'];
        const manifestFile = unzipped['manifest.json'];

        if (!metadataFile) {
            throw new StateConsistencyError('Invalid vctrl file: missing data.json');
        }

        const metadataJson = strFromU8(metadataFile as Uint8Array);
        const metadataList: Omit<StoredEdit, 'content'>[] = JSON.parse(metadataJson);

        if (metadataList.length > this.MAX_FILE_COUNT) {
            throw new ValidationError(
                `Too many edits in import: ${metadataList.length}`,
                'editCount'
            );
        }

        const edits: StoredEdit[] = [];
        let totalSize = 0;

        for (const meta of metadataList) {
            if (meta.noteId !== noteId || meta.branchName !== branchName) {
                throw new StateConsistencyError(
                    'Import data does not match target branch',
                    { expected: { noteId, branchName }, actual: meta }
                );
            }

            const blobFile = unzipped[`blobs/${meta.editId}.bin`];
            if (!blobFile) {
                throw new StateConsistencyError(`Missing blob for edit ${meta.editId}`);
            }

            const blobData = blobFile as Uint8Array;
            totalSize += blobData.byteLength;

            if (totalSize > this.MAX_ZIP_SIZE) {
                throw new ValidationError('Import exceeds maximum size', 'importSize');
            }

            const edit: StoredEdit = {
                ...meta,
                storageType: meta.storageType || 'full', // Default to full for robustness
                content: blobData.buffer as ArrayBuffer
            };

            // Enforce invariant: Full edits must have chainLength 0
            // This sanitizes potential corruption from imported data
            if (edit.storageType === 'full' && edit.chainLength > 0) {
                // @ts-ignore - modifying readonly for import sanitization
                edit.chainLength = 0;
            }

            edits.push(edit);
        }

        // Transaction: Update Edits AND Manifest
        await db.transaction('rw', db.edits, db.manifests, async () => {
            // 1. Clear existing edits for branch
            await db.edits
                .where('[noteId+branchName]')
                .equals([noteId, branchName])
                .delete();
            
            // 2. Insert new edits
            if (edits.length > 0) {
                await db.edits.bulkPut(edits);
            }

            // 3. Reconstruct/Update Manifest
            let currentManifestRecord = await db.manifests.get(noteId);
            let manifest = currentManifestRecord?.manifest;

            if (!manifest) {
                 manifest = {
                     noteId,
                     notePath: '', // Cannot determine path from import alone if new
                     currentBranch: branchName,
                     branches: {},
                     createdAt: new Date().toISOString(),
                     lastModified: new Date().toISOString()
                 };
            }

            // Try to get branch metadata from manifest.json
            let branchManifest: any = null;
            let exportedAt = new Date().toISOString();

            if (manifestFile) {
                try {
                    const manifestJson = strFromU8(manifestFile as Uint8Array);
                    const parsed = JSON.parse(manifestJson);
                    if (parsed.branchMetadata) {
                        branchManifest = parsed.branchMetadata;
                    }
                    if (parsed.exportedAt) {
                        exportedAt = parsed.exportedAt;
                    }
                } catch (e) {
                    console.warn('Failed to parse manifest.json during import', e);
                }
            }

            // Fallback: Reconstruct branch manifest from edits if missing
            if (!branchManifest) {
                const versions: Record<string, any> = {};
                const sortedEdits = [...edits].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                
                sortedEdits.forEach((edit, index) => {
                    versions[edit.editId] = {
                        versionNumber: index + 1,
                        timestamp: new Date(edit.createdAt || Date.now()).toISOString(),
                        size: edit.size || 0,
                        uncompressedSize: edit.uncompressedSize || 0,
                        contentHash: edit.contentHash || ''
                    };
                });

                branchManifest = {
                    versions,
                    totalVersions: edits.length
                };
            }

            // Update manifest with imported branch data
            manifest = ManifestService.setBranchData(manifest, branchName, branchManifest);

            // CRITICAL: Override lastModified to match the export timestamp.
            // This prevents the "Import -> Update DB -> DB Newer -> Export -> Loop" cycle.
            // We set the DB state to exactly match the file state.
            manifest = produce(manifest, (draft) => {
                draft.lastModified = exportedAt;
            });

            await db.manifests.put({
                noteId,
                manifest,
                updatedAt: Date.now()
            });
        });
    }

    static async readManifestFromZip(zipData: ArrayBuffer): Promise<any> {
        return new Promise((resolve, reject) => {
            unzip(
                new Uint8Array(zipData),
                { filter: (file) => file.name === 'manifest.json' || file.name === 'data.json' },
                (err, unzipped) => {
                    if (err) {
                        reject(new StateConsistencyError('ZIP reading failed', { originalError: err }));
                        return;
                    }
                    
                    // 1. Try manifest.json
                    const manifestFile = unzipped['manifest.json'];
                    if (manifestFile) {
                        try {
                            const json = strFromU8(manifestFile as Uint8Array);
                            resolve(JSON.parse(json));
                            return;
                        } catch (e) {
                            // Fallthrough if corrupt
                        }
                    }

                    // 2. Fallback to data.json
                    const dataFile = unzipped['data.json'];
                    if (dataFile) {
                        try {
                            const json = strFromU8(dataFile as Uint8Array);
                            const edits = JSON.parse(json);
                            
                            if (Array.isArray(edits) && edits.length > 0) {
                                // Find latest timestamp to mimic manifest.exportedAt
                                const latest = edits.reduce((max, curr) => 
                                    (curr.createdAt || 0) > max ? (curr.createdAt || 0) : max, 0);
                                
                                // Return synthetic manifest
                                resolve({
                                    noteId: edits[0].noteId,
                                    branchName: edits[0].branchName,
                                    editCount: edits.length,
                                    version: '1.0',
                                    exportedAt: new Date(latest).toISOString(),
                                    generatedFromData: true
                                });
                                return;
                            } else if (Array.isArray(edits) && edits.length === 0) {
                                // Handle empty data.json case
                                resolve({
                                    noteId: 'unknown',
                                    branchName: 'unknown',
                                    editCount: 0,
                                    version: '1.0',
                                    exportedAt: new Date().toISOString(),
                                    generatedFromData: true
                                });
                                return;
                            }
                        } catch (e) {
                            reject(new ValidationError('Invalid data.json in ZIP', 'data'));
                            return;
                        }
                    }

                    reject(new StateConsistencyError('No manifest.json or valid data.json found in ZIP'));
                }
            );
        });
    }

    static async validateZipData(zipData: ArrayBuffer): Promise<boolean> {
        try {
            await new Promise<void>((resolve, reject) => {
                unzip(new Uint8Array(zipData), (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            return true;
        } catch {
            return false;
        }
    }

    static getZipStats(zipData: ArrayBuffer): {
        size: number;
        compressed: boolean;
    } {
        const size = zipData.byteLength;
        const compressed = size > 0;
        
        return { size, compressed };
    }
}
