import { compressSync, decompressSync, strToU8, strFromU8 } from 'fflate';
import { Dexie } from 'dexie';
import { CONFIG } from '@/workers/edit-history/config';
import { SecurityError, StateConsistencyError } from '@/workers/edit-history/errors';
import type { StoredEdit } from '@/workers/edit-history/types';

export class CompressionService {
    static readonly textEncoder = new TextEncoder();
    static readonly textDecoder = new TextDecoder('utf-8', { fatal: true });
    
    private static readonly MAX_COMPRESSION_RATIO = 1000;
    private static readonly MIN_VALID_SIZE = 1;

    static compressContent(content: string): ArrayBuffer {
        if (content.length === 0) {
            return new ArrayBuffer(0);
        }

        try {
            const data = strToU8(content);
            
            if (data.length > CONFIG.MAX_CONTENT_SIZE) {
                throw new SecurityError(
                    `Content size ${data.length} exceeds maximum ${CONFIG.MAX_CONTENT_SIZE}`,
                    'compressContent',
                    'medium'
                );
            }

            const compressed = compressSync(data, {
                level: CONFIG.COMPRESSION_LEVEL as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
                mem: 12
            });

            if (compressed.length > data.length * this.MAX_COMPRESSION_RATIO) {
                throw new SecurityError('Suspicious compression ratio detected', 'compressContent', 'high');
            }

            return compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength
            ) as ArrayBuffer;
        } catch (error) {
            if (error instanceof SecurityError) throw error;
            
            const message = error instanceof Error ? error.message : 'Unknown compression error';
            throw new SecurityError(`Compression failed: ${message}`, 'compressContent', 'medium');
        }
    }

    static decompressContent(buffer: ArrayBuffer): string {
        if (buffer.byteLength === 0) {
            return '';
        }

        if (buffer.byteLength < this.MIN_VALID_SIZE) {
            throw new SecurityError('Invalid compressed data size', 'decompressContent', 'low');
        }

        try {
            const compressed = new Uint8Array(buffer);
            
            if (compressed.length > CONFIG.MAX_CONTENT_SIZE * this.MAX_COMPRESSION_RATIO) {
                throw new SecurityError('Suspicious decompression input size', 'decompressContent', 'high');
            }

            const decompressed = decompressSync(compressed);
            
            if (decompressed.length > CONFIG.MAX_CONTENT_SIZE) {
                throw new SecurityError(
                    `Decompressed size ${decompressed.length} exceeds maximum ${CONFIG.MAX_CONTENT_SIZE}`,
                    'decompressContent',
                    'medium'
                );
            }

            return strFromU8(decompressed);
        } catch (error) {
            if (error instanceof SecurityError) throw error;
            
            const message = error instanceof Error ? error.message : 'Unknown decompression error';
            throw new SecurityError(`Decompression failed: ${message}`, 'decompressContent', 'medium');
        }
    }

    static async decompressLegacy(buffer: ArrayBuffer): Promise<string> {
        if (buffer.byteLength === 0) {
            return '';
        }

        try {
            const stream = new Blob([buffer]).stream();
            const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
            
            // Wrap native promise in Dexie.waitFor to prevent transaction loss
            const resultBuffer = await Dexie.waitFor(new Response(decompressed).arrayBuffer());
            
            if (resultBuffer.byteLength > CONFIG.MAX_CONTENT_SIZE) {
                throw new SecurityError('Legacy decompression exceeded size limit', 'decompressLegacy', 'medium');
            }

            return this.textDecoder.decode(resultBuffer);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown legacy decompression error';
            throw new SecurityError(`Legacy decompression failed: ${message}`, 'decompressLegacy', 'medium');
        }
    }

    static async decompress(record: StoredEdit): Promise<string> {
        if (record.content.byteLength === 0) {
            return '';
        }

        try {
            if (!record.storageType) {
                // Legacy records need async decompression.
                // decompressLegacy now handles Dexie.waitFor internally.
                return this.decompressLegacy(record.content);
            }
            
            return this.decompressContent(record.content);
        } catch (error) {
            throw new StateConsistencyError(
                `Failed to decompress edit ${record.editId}`,
                { noteId: record.noteId, branchName: record.branchName }
            );
        }
    }

    static getUncompressedSize(content: string): number {
        try {
            return strToU8(content).length;
        } catch (error) {
            throw new SecurityError('Failed to calculate content size', 'getUncompressedSize', 'low');
        }
    }

    static verifyCompressionIntegrity(content: string): boolean {
        try {
            const compressed = this.compressContent(content);
            const decompressed = this.decompressContent(compressed);
            return decompressed === content;
        } catch {
            return false;
        }
    }
}
