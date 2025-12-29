/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { gzipSync, gunzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

/**
 * Compression Worker
 * 
 * Performance optimizations:
 * 1. Pre-allocated constants for deterministic output
 * 2. Transferable objects for zero-copy buffer transfer
 * 3. Efficient fflate usage with proper type handling
 * 4. Consistent error handling with informative messages
 */

// Fixed date for deterministic ZIP creation (must be >= 1980 for ZIP format)
const ZIP_EPOCH = new Date('2000-01-01T00:00:00Z');

/**
 * Converts content to Uint8Array efficiently.
 * Handles both string and ArrayBuffer inputs.
 */
function toUint8Array(content: string | ArrayBuffer): Uint8Array {
    if (typeof content === 'string') {
        return strToU8(content);
    }
    return new Uint8Array(content);
}

/**
 * Creates a transferable ArrayBuffer from Uint8Array.
 * Uses .slice(0) to create a copy that can be transferred.
 */
function createTransferableBuffer(uint8Array: Uint8Array): ArrayBuffer {
    return transfer(uint8Array.buffer.slice(0) as ArrayBuffer, [uint8Array.buffer.slice(0) as ArrayBuffer]);
}

const api = {
    /**
     * Compresses content using GZIP.
     * Uses transfer() for zero-copy return of ArrayBuffer.
     * 
     * @param content String or ArrayBuffer to compress.
     * @param level Compression level (0-9). Default is 9 (maximum).
     * @returns ArrayBuffer containing GZIP compressed data.
     */
    compress(content: string | ArrayBuffer, level = 9): ArrayBuffer {
        try {
            const data = toUint8Array(content);
            
            // Ensure level is within valid range (0-9)
            // fflate expects specific literal types for level
            const validLevel = Math.min(9, Math.max(0, level)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
            
            // Use mtime: 0 (or fixed date) for deterministic output
            const compressed = gzipSync(data, { 
                mtime: 0, 
                level: validLevel 
            });
            
            return createTransferableBuffer(compressed);
        } catch (error) {
            console.error("Compression Worker: Failed to compress", error);
            throw new Error(`Compression failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    /**
     * Decompresses GZIP content.
     * 
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
    },

    /**
     * Creates a ZIP archive from multiple files.
     * Uses transfer() for efficient buffer return.
     * 
     * @param files Record of filename to content (string or ArrayBuffer).
     * @param level Compression level (0-9). Default is 9 (maximum).
     * @returns ArrayBuffer containing ZIP data.
     */
    createZip(files: Record<string, string | ArrayBuffer>, level = 9): ArrayBuffer {
        try {
            const zipData: Record<string, Uint8Array> = {};
            for (const [name, content] of Object.entries(files)) {
                zipData[name] = toUint8Array(content);
            }
            
            // Ensure level is within valid range (0-9)
            // fflate expects specific literal types for level
            const validLevel = Math.min(9, Math.max(0, level)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

            // ZIP format requires dates >= 1980
            const zipped = zipSync(zipData, { 
                level: validLevel, 
                mtime: ZIP_EPOCH.getTime() 
            });
            
            return createTransferableBuffer(zipped);
        } catch (error) {
            console.error("Compression Worker: Failed to create ZIP", error);
            throw new Error(`ZIP creation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

expose(api);
