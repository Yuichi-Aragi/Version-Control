/// <reference lib="webworker" />

import { transfer } from 'comlink';
import { WorkerError } from '@/workers/timeline/types';

/**
 * Data Transformation Utilities
 *
 * This module provides utilities for encoding, decoding,
 * and data transformation operations.
 */

// --- Text Encoding/Decoding ---

// Use fatal: false to be robust against minor encoding errors in user content
const decoder = new TextDecoder('utf-8', { fatal: false });
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
            'Failed to decode content',
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
 * Strict string comparison.
 * 
 * DATA INTEGRITY NOTE:
 * Previous versions used sampling for large strings (>100KB).
 * This has been REMOVED to guarantee that even minor changes (e.g., a single character
 * change in a 10MB file) are correctly detected as a diff.
 * 
 * @param str1 - First string to compare
 * @param str2 - Second string to compare
 * @returns True if strings are exactly equal
 */
export function areStringsEqual(str1: string, str2: string): boolean {
    // Strict equality check is required for data integrity
    return str1 === str2;
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
