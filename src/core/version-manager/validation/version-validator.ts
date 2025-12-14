import type { TFile } from 'obsidian';

/**
 * Validates parameters for version operations
 */
export class VersionValidator {
  /**
   * Validates file for save operation
   */
  static validateFile(file: TFile | null | undefined): void {
    if (!file) {
      throw new Error('Invalid file provided to saveNewVersionForFile.');
    }
  }

  /**
   * Validates note ID
   */
  static validateNoteId(noteId: string | null | undefined, operation: string): void {
    if (!noteId) {
      throw new Error(`Invalid noteId for ${operation}.`);
    }
  }

  /**
   * Validates version ID
   */
  static validateVersionId(versionId: string | null | undefined, operation: string): void {
    if (!versionId) {
      throw new Error(`Invalid versionId for ${operation}.`);
    }
  }

  /**
   * Validates both note ID and version ID
   */
  static validateNoteAndVersionId(
    noteId: string | null | undefined,
    versionId: string | null | undefined,
    operation: string
  ): void {
    if (!noteId || !versionId) {
      throw new Error(`Invalid noteId or versionId for ${operation}.`);
    }
  }

  /**
   * Validates restore operation parameters
   */
  static validateRestoreParams(
    liveFile: TFile | null | undefined,
    noteId: string | null | undefined,
    versionId: string | null | undefined
  ): void {
    if (!liveFile || !noteId || !versionId) {
      throw new Error('Invalid parameters for version restoration.');
    }
  }

  /**
   * Validates deviation creation parameters
   */
  static validateDeviationParams(
    noteId: string | null | undefined,
    versionId?: string | null
  ): void {
    if (!noteId || (versionId !== undefined && !versionId)) {
      throw new Error('Invalid parameters for creating deviation.');
    }
  }

  /**
   * Validates branch deletion parameters
   */
  static validateBranchDeletion(
    noteId: string | null | undefined,
    branchName: string | null | undefined
  ): void {
    if (!noteId || !branchName) {
      throw new Error('Invalid noteId or branchName for deleteBranch.');
    }
  }
}
