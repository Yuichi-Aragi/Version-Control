/**
 * Diff formatting and validation utilities
 */

import * as v from 'valibot';
import type { DiffType } from '@/types';
import { DiffManagerError } from '@/services/diff-manager/types';
import { MAX_CONTENT_SIZE } from '@/services/diff-manager/config';

export class DiffValidator {
    static validateParams(
        noteId: string,
        version1Id: string,
        version2Id: string,
        diffType: DiffType
    ): void {
        const params = { noteId, version1Id, version2Id, diffType };
        v.parse(v.object({
            noteId: v.pipe(v.string(), v.minLength(1)),
            version1Id: v.pipe(v.string(), v.minLength(1)),
            version2Id: v.pipe(v.string(), v.minLength(1)),
            diffType: v.picklist(['lines', 'words', 'chars', 'smart']),
        }), params);
    }

    static validateContentSize(
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer
    ): void {
        const len1 = typeof content1 === 'string' ? content1.length : content1.byteLength;
        const len2 = typeof content2 === 'string' ? content2.length : content2.byteLength;

        if (len1 > MAX_CONTENT_SIZE || len2 > MAX_CONTENT_SIZE) {
            throw new DiffManagerError('Content size exceeds maximum allowed size', 'CONTENT_TOO_LARGE');
        }
    }
}
