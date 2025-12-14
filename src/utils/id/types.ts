/**
 * Type definitions and type guards for ID generation utilities
 *
 * @module id-utils/types
 */

import type { TFile } from 'obsidian';
import type { VersionControlSettings } from '@/types';

/**
 * Type guard for VersionControlSettings
 */
export function isVersionControlSettings(settings: unknown): settings is VersionControlSettings {
    return settings !== null &&
           typeof settings === 'object' &&
           (settings as VersionControlSettings).noteIdFormat !== undefined;
}

/**
 * Type guard for TFile
 */
export function isTFile(file: unknown): file is TFile {
    return file !== null &&
           typeof file === 'object' &&
           typeof (file as TFile).path === 'string' &&
           typeof (file as TFile).basename === 'string';
}

/**
 * Type guard for crypto object
 */
export function isCryptoAvailable(cryptoObj: unknown): cryptoObj is Crypto {
    return typeof cryptoObj === 'object' &&
           cryptoObj !== null &&
           'randomUUID' in cryptoObj &&
           typeof (cryptoObj as Crypto).randomUUID === 'function';
}
