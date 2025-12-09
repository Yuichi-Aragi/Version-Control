/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

/**
 * Compression Worker
 * Handles GZIP compression and decompression using fflate.
 * Designed to be used via Comlink.
 */

const api = {
    /**
     * Compresses content using GZIP.
     * @param content String or ArrayBuffer to compress.
     * @returns ArrayBuffer containing GZIP compressed data.
     */
    compress(content: string | ArrayBuffer): ArrayBuffer {
        try {
            const data = typeof content === 'string' ? strToU8(content) : new Uint8Array(content);
            // Use mtime: 0 for deterministic output (reproducible builds/hashes)
            const compressed = gzipSync(data, { mtime: 0 });
            const buffer = compressed.buffer.slice(0) as ArrayBuffer;
            return transfer(buffer, [buffer]);
        } catch (error) {
            console.error("Compression Worker: Failed to compress", error);
            throw new Error(`Compression failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    /**
     * Decompresses GZIP content.
     * @param content ArrayBuffer containing GZIP compressed data.
     * @returns Decompressed string.
     */
    decompress(content: ArrayBuffer): string {
        try {
            const data = new Uint8Array(content);
            const decompressed = gunzipSync(data);
            return strFromU8(decompressed);
        } catch (error) {
            console.error("Compression Worker: Failed to decompress", error);
            throw new Error(`Decompression failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

expose(api);
