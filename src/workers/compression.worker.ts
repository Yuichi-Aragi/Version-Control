/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { gzipSync, gunzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

/**
 * Compression Worker
 * Handles GZIP compression and decompression using fflate.
 * Designed to be used via Comlink.
 */

// Fixed date for deterministic ZIP creation (must be >= 1980 for ZIP format)
const ZIP_EPOCH = new Date('2000-01-01T00:00:00Z');

// Fixed date for GZIP (Unix epoch is fine, 0 ensures determinism)
const GZIP_EPOCH = new Date(0);

const api = {
    /**
     * Compresses content using GZIP.
     * @param content String or ArrayBuffer to compress.
     * @param level Compression level (0-9). Default is 9 (maximum).
     * @returns ArrayBuffer containing GZIP compressed data.
     */
    compress(content: string | ArrayBuffer, level = 9): ArrayBuffer {
        try {
            const data = typeof content === 'string' ? strToU8(content) : new Uint8Array(content);
            
            // Ensure level is within valid range (0-9) and cast to any to satisfy strict fflate types
            const validLevel = (level >= 0 && level <= 9) ? level : 9;
            
            // Use mtime: 0 (or fixed date) for deterministic output
            const compressed = gzipSync(data, { 
                mtime: GZIP_EPOCH, 
                level: validLevel as any 
            });
            
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
    },

    /**
     * Creates a ZIP archive from multiple files.
     * @param files Map of filename to content (string or ArrayBuffer).
     * @param level Compression level (0-9). Default is 9 (maximum).
     * @returns ArrayBuffer containing ZIP data.
     */
    createZip(files: Record<string, string | ArrayBuffer>, level = 9): ArrayBuffer {
        try {
            const zipData: Record<string, Uint8Array> = {};
            for (const [name, content] of Object.entries(files)) {
                zipData[name] = typeof content === 'string' ? strToU8(content) : new Uint8Array(content);
            }
            
            // Ensure level is within valid range (0-9) and cast to any
            const validLevel = (level >= 0 && level <= 9) ? level : 9;

            // ZIP format requires dates >= 1980. Passing 0 (1970) causes errors.
            const zipped = zipSync(zipData, { 
                level: validLevel as any, 
                mtime: ZIP_EPOCH 
            });
            
            const buffer = zipped.buffer.slice(0) as ArrayBuffer;
            return transfer(buffer, [buffer]);
        } catch (error) {
            console.error("Compression Worker: Failed to create ZIP", error);
            throw new Error(`ZIP creation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

expose(api);
