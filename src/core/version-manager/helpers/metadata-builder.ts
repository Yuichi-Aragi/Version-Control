import type { VersionMetadata } from '@/core/version-manager/types';
import type { TextStats } from '@/utils/text-stats';

/**
 * Builds version metadata objects for manifest updates
 */
export class MetadataBuilder {
  /**
   * Creates version metadata from save operation data
   */
  static buildVersionMetadata(
    versionNumber: number,
    timestamp: string,
    size: number,
    textStats: TextStats,
    name?: string
  ): VersionMetadata {
    const metadata: VersionMetadata = {
      versionNumber,
      timestamp,
      size,
      wordCount: textStats.wordCount,
      wordCountWithMd: textStats.wordCountWithMd,
      charCount: textStats.charCount,
      charCountWithMd: textStats.charCountWithMd,
      lineCount: textStats.lineCount,
      lineCountWithoutMd: textStats.lineCountWithoutMd,
    };

    if (name) {
      metadata.name = name;
    }

    return metadata;
  }

  /**
   * Calculates the next version number from existing versions
   */
  static calculateNextVersionNumber(existingVersionNumbers: number[]): number {
    if (existingVersionNumbers.length === 0) {
      return 1;
    }
    const maxVersion = Math.max(...existingVersionNumbers);
    return maxVersion + 1;
  }

  /**
   * Generates a display name for a version
   */
  static generateDisplayName(versionNumber: number, name?: string): string {
    if (name) {
      return `"${name}" (V${versionNumber})`;
    }
    return `Version ${versionNumber}`;
  }
}
