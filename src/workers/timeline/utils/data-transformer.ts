/// <reference lib="webworker" />

import { transfer } from 'comlink';
import { compressSync, decompressSync, strToU8, strFromU8 } from 'fflate';
import { CONTENT_IDENTITY_THRESHOLD, COMPRESSION_LEVEL } from '@/workers/timeline/config';
import { WorkerError } from '@/workers/timeline/types';
import type { Change } from '@/workers/timeline/types';

/**
 * Data Transformation Utilities
 *
 * This module provides utilities for encoding, decoding, compression,
 * and data transformation operations.
 */

// --- Text Encoding/Decoding ---

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

/**
 * Safe decoding of content with optimization for small content.
 *
 * @param content - The content to decode (string or ArrayBuffer)
 * @returns The decoded string
 * @throws {WorkerError} If decoding fails
 */
export function decodeContent(content: string | ArrayBuffer): string {
    if (typeof content === 'string') return content;

    try {
        // Use direct decoding for optimal performance
        return decoder.decode(content);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Failed to decode content: Invalid UTF-8',
            'DECODING_FAILED',
            { originalError: message }
        );
    }
}

/**
 * Sanitizes string content to remove control characters while preserving layout.
 *
 * @param str - The string to sanitize
 * @returns The sanitized string
 */
export function sanitizeString(str: string): string {
    // Preserve \n (10), \r (13), \t (9)
    // Remove other control characters (0-8, 11-12, 14-31, 127)
    // Use regex with explicit character codes for performance
    return str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// --- String Comparison ---

/**
 * Fast string comparison with early bailout optimization.
 *
 * @param str1 - First string to compare
 * @param str2 - Second string to compare
 * @returns True if strings are equal
 */
export function areStringsEqual(str1: string, str2: string): boolean {
    if (str1.length !== str2.length) return false;
    if (str1 === str2) return true;

    // For large strings, do quick length check first
    if (str1.length > CONTENT_IDENTITY_THRESHOLD) {
        // Compare first, middle, and last segments
        const segmentLength = Math.min(1000, str1.length);
        if (str1.slice(0, segmentLength) !== str2.slice(0, segmentLength)) return false;
        const midStart = Math.floor(str1.length / 2) - Math.floor(segmentLength / 2);
        if (str1.slice(midStart, midStart + segmentLength) !==
            str2.slice(midStart, midStart + segmentLength)) return false;
        if (str1.slice(-segmentLength) !== str2.slice(-segmentLength)) return false;
    }

    return str1 === str2;
}

// --- Compression/Decompression ---

/**
 * Compresses diff data using fflate.
 *
 * @param changes - The diff changes to compress
 * @returns Compressed ArrayBuffer
 * @throws {WorkerError} If compression fails
 */
export function compressDiffData(changes: Change[]): ArrayBuffer {
    try {
        const json = JSON.stringify(changes);
        const u8 = strToU8(json);
        const compressed = compressSync(u8, { level: COMPRESSION_LEVEL });
        // Ensure we get a clean ArrayBuffer of the exact size
        return compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength
        ) as ArrayBuffer;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError('Compression failed', 'COMPRESSION_FAILED', { originalError: message });
    }
}

/**
 * Decompresses diff data using fflate.
 *
 * @param buffer - The compressed ArrayBuffer
 * @returns Decompressed diff changes
 */
export function decompressDiffData(buffer: ArrayBuffer): Change[] {
    try {
        const u8 = new Uint8Array(buffer);
        const decompressed = decompressSync(u8);
        const json = strFromU8(decompressed);
        return JSON.parse(json);
    } catch (error) {
        console.error("VC Worker: Decompression failed", error);
        return []; // Return empty diff on failure to prevent crash
    }
}

// --- Serialization & Transfer ---

/**
 * Serializes data for zero-copy transfer with size optimization.
 *
 * @param data - The data to serialize
 * @returns Transferable ArrayBuffer
 * @throws {WorkerError} If serialization fails
 */
export function serializeAndTransfer<T>(data: T): ArrayBuffer {
    try {
        const json = JSON.stringify(data);
        const uint8Array = encoder.encode(json);
        const buffer = uint8Array.buffer;
        return transfer(buffer, [buffer]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Failed to serialize worker response',
            'SERIALIZATION_FAILED',
            { originalError: message }
        );
    }
}

// --- Lock Key Generation ---

/**
 * Generates a precise lock key for concurrency control.
 *
 * @param noteId - The note identifier
 * @param branchName - The branch name
 * @param source - The source type
 * @param versionId - The version identifier
 * @returns The lock key
 */
export function getLockKey(noteId: string, branchName: string, source: string, versionId: string): string {
    // Use deterministic key generation for lock consistency
    return `vc:timeline:${noteId}:${branchName}:${source}:${versionId}`;
}