import { compressSync, decompressSync, strToU8, strFromU8 } from 'fflate';
import { Dexie } from 'dexie';
import { CONFIG } from '@/workers/edit-history/config';
import { SecurityError } from '@/workers/edit-history/errors';
import type { StoredEdit } from '@/workers/edit-history/types';

export class CompressionService {
    static readonly textEncoder = new TextEncoder();
    static readonly textDecoder = new TextDecoder('utf-8');

    static compressContent(content: string): ArrayBuffer {
        if (content.length === 0) {
            return new ArrayBuffer(0);
        }
        try {
            const data = strToU8(content);
            const compressed = compressSync(data, { level: CONFIG.COMPRESSION_LEVEL });
            return compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength
            ) as ArrayBuffer;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown compression error';
            throw new SecurityError(`Compression failed: ${message}`);
        }
    }

    static decompressContent(buffer: ArrayBuffer): string {
        if (buffer.byteLength === 0) {
            return '';
        }
        try {
            const compressed = new Uint8Array(buffer);
            const decompressed = decompressSync(compressed);
            return strFromU8(decompressed);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown decompression error';
            throw new SecurityError(`Decompression failed: ${message}`);
        }
    }

    static async decompressLegacy(buffer: ArrayBuffer): Promise<string> {
        if (buffer.byteLength === 0) {
            return '';
        }
        try {
            const stream = new Blob([buffer]).stream();
            const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
            const resultBuffer = await new Response(decompressed).arrayBuffer();
            return this.textDecoder.decode(resultBuffer);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown legacy decompression error';
            throw new SecurityError(`Legacy decompression failed: ${message}`);
        }
    }

    static async decompress(record: StoredEdit): Promise<string> {
        if (!record.storageType) {
            return Dexie.waitFor(this.decompressLegacy(record.content));
        }
        return this.decompressContent(record.content);
    }

    static getUncompressedSize(content: string): number {
        return strToU8(content).length;
    }
}
