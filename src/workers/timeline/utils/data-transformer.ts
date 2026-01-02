/// <reference lib="webworker" />

import { transfer } from 'comlink';
import { compressSync, decompressSync } from 'fflate';
import { CONTENT_IDENTITY_THRESHOLD, COMPRESSION_LEVEL } from '@/workers/timeline/config';
import { WorkerError } from '@/workers/timeline/types';
import type { Change, StoredTimelineEvent } from '@/workers/timeline/types';

/**
 * Data Transformation Utilities
 *
 * This module provides utilities for encoding, decoding, compression,
 * and data transformation operations.
 */

// --- Text Encoding/Decoding ---

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

// --- Binary JSON Constants ---
// Pre-computed byte sequences for high-performance binary stitching
const JSON_START = new Uint8Array([91]); // [
const JSON_END = new Uint8Array([93]);   // ]
const COMMA = new Uint8Array([44]);      // ,
const DIFF_PROP = new Uint8Array([44, 34, 100, 105, 102, 102, 68, 97, 116, 97, 34, 58]); // ,"diffData":
const OBJ_CLOSE = new Uint8Array([125]); // }
const EMPTY_LIST = new Uint8Array([91, 93]); // []

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
 * Optimized to use native TextEncoder for string-to-bytes conversion.
 *
 * @param changes - The diff changes to compress
 * @returns Compressed ArrayBuffer
 * @throws {WorkerError} If compression fails
 */
export function compressDiffData(changes: Change[]): ArrayBuffer {
    try {
        const json = JSON.stringify(changes);
        // Optimization: Use native TextEncoder instead of fflate's strToU8
        const u8 = encoder.encode(json);
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
 * Optimized to use native TextDecoder for bytes-to-string conversion.
 *
 * @param buffer - The compressed ArrayBuffer
 * @returns Decompressed diff changes
 */
export function decompressDiffData(buffer: ArrayBuffer): Change[] {
    try {
        const u8 = new Uint8Array(buffer);
        const decompressed = decompressSync(u8);
        // Optimization: Use native TextDecoder instead of fflate's strFromU8
        const json = decoder.decode(decompressed);
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

/**
 * Optimized serialization for timeline events using Binary Stitching.
 *
 * This method avoids the "Bytes -> String -> Bytes" roundtrip by:
 * 1. Decompressing diffs directly to JSON bytes
 * 2. Serializing metadata to JSON bytes
 * 3. Stitching them together in a single pre-allocated Uint8Array
 *
 * This eliminates the massive string allocation and encoding overhead
 * associated with standard JSON serialization of large datasets.
 *
 * @param events - The stored timeline events
 * @returns Transferable ArrayBuffer containing serialized TimelineEvent[]
 */
export function fastSerializeTimelineEvents(events: StoredTimelineEvent[]): ArrayBuffer {
    // 1. Pre-calculation Phase
    // We need to know the exact size to allocate the buffer once.
    // We also prepare the parts to avoid re-doing work.
    
    interface EventPart {
        metaBytes: Uint8Array;
        diffBytes: Uint8Array;
    }

    const parts: EventPart[] = new Array(events.length);
    let totalLength = JSON_START.length + JSON_END.length;

    // Add comma separators length
    if (events.length > 1) {
        totalLength += (events.length - 1) * COMMA.length;
    }

    for (let i = 0; i < events.length; i++) {
        // Use non-null assertion as we are iterating within bounds
        const event = events[i]!;
        
        // A. Prepare Diff Bytes (Decompress directly to bytes)
        let diffBytes: Uint8Array;
        try {
            const u8 = new Uint8Array(event.diffData);
            diffBytes = decompressSync(u8);
        } catch (error) {
            console.error("VC Worker: Serialization failed for event", event.id, error);
            diffBytes = EMPTY_LIST;
        }

        // B. Prepare Metadata Bytes
        // Extract metadata (everything except diffData)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { diffData, ...meta } = event;
        const metaJson = JSON.stringify(meta);
        const metaBytes = encoder.encode(metaJson);

        // C. Calculate Size contribution
        // Structure: { ...meta (minus }) + ,"diffData": + [diffs] + }
        // Length = (metaBytes - 1) + DIFF_PROP + diffBytes + OBJ_CLOSE
        const partLength = (metaBytes.length - 1) + DIFF_PROP.length + diffBytes.length + OBJ_CLOSE.length;
        
        totalLength += partLength;
        parts[i] = { metaBytes, diffBytes };
    }

    // 2. Allocation Phase
    const result = new Uint8Array(totalLength);
    let offset = 0;

    // 3. Stitching Phase
    // Write Start '['
    result.set(JSON_START, offset);
    offset += JSON_START.length;

    for (let i = 0; i < events.length; i++) {
        // Use non-null assertion as we populated this array in the previous loop
        const { metaBytes, diffBytes } = parts[i]!;

        // Write Separator ',' (if not first)
        if (i > 0) {
            result.set(COMMA, offset);
            offset += COMMA.length;
        }

        // Write Metadata (minus closing brace)
        // We slice off the last byte which is '}' (125)
        result.set(metaBytes.subarray(0, metaBytes.length - 1), offset);
        offset += metaBytes.length - 1;

        // Write ',"diffData":'
        result.set(DIFF_PROP, offset);
        offset += DIFF_PROP.length;

        // Write Diff Bytes
        result.set(diffBytes, offset);
        offset += diffBytes.length;

        // Write Closing Brace '}'
        result.set(OBJ_CLOSE, offset);
        offset += OBJ_CLOSE.length;
    }

    // Write End ']'
    result.set(JSON_END, offset);
    
    // 4. Transfer Phase
    return transfer(result.buffer, [result.buffer]);
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
