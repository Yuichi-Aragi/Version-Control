import { App } from "obsidian";
import { injectable, inject } from "inversify";
import { PathService } from "./path-service";
import type { NoteManifest } from "../../types";
import { TYPES } from "../../types/inversify.types";
import { QueueService } from "../../services/queue-service";

/**
 * Repository for managing the content of individual versions.
 * Handles reading, writing, and deleting the actual version files,
 * and encapsulates concurrency control for write/delete operations.
 */
@injectable()
export class VersionContentRepository {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private readonly FILE_OPERATION_TIMEOUT_MS = 5000;

  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.PathService) private readonly pathService: PathService,
    @inject(TYPES.QueueService) private readonly queueService: QueueService
  ) {
    // Defensive: Validate critical dependencies at construction time
    if (!this.app?.vault?.adapter) {
      throw new Error('VersionContentRepository: Invalid or missing App/vault/adapter dependency');
    }
    if (!this.pathService) {
      throw new Error('VersionContentRepository: Missing PathService dependency');
    }
    if (!this.queueService) {
      throw new Error('VersionContentRepository: Missing QueueService dependency');
    }
  }

  /**
   * Reads version content with enhanced error handling, retries, and strict validation.
   * @param noteId - The unique identifier of the note
   * @param versionId - The unique identifier of the version
   * @returns Promise resolving to content string or null if not found
   */
  public async read(
    noteId: string,
    versionId: string
  ): Promise<string | null> {
    // Strict input validation
    if (typeof noteId !== 'string' || noteId.trim() === '') {
      console.warn(`VC: Invalid noteId provided for read operation:`, { noteId });
      return null;
    }
    if (typeof versionId !== 'string' || versionId.trim() === '') {
      console.warn(`VC: Invalid versionId provided for read operation:`, { versionId });
      return null;
    }

    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
    
    // Validate file path
    if (typeof versionFilePath !== 'string' || versionFilePath.trim() === '') {
      console.error(`VC: Generated invalid file path for note ${noteId}, version ${versionId}`);
      return null;
    }

    // Execute with retry logic and timeout protection
    return this.executeWithRetryAndTimeout(
      async () => {
        try {
          const exists = await this.app.vault.adapter.exists(versionFilePath);
          if (!exists) {
            console.warn(`VC: Version file not found on read: ${versionFilePath}`);
            return null;
          }
          
          const content = await this.app.vault.adapter.read(versionFilePath);
          
          // Defensive: Validate content type
          if (typeof content !== 'string') {
            console.error(`VC: Unexpected content type for ${versionFilePath}:`, typeof content);
            return null;
          }
          
          return content;
        } catch (error) {
          console.error(
            `VC: Failed to read content for note ${noteId}, version ${versionId} using adapter.`,
            error instanceof Error ? error.message : String(error)
          );
          throw error; // Re-throw for retry logic
        }
      },
      `read_${noteId}_${versionId}`,
      this.MAX_RETRIES,
      this.RETRY_DELAY_MS
    ).catch((error) => {
      console.error(`VC: Final failure reading version ${versionId} for note ${noteId}:`, error);
      return null;
    });
  }

  /**
   * Writes version content with strict validation, atomic operations, and resource efficiency.
   * @param noteId - The unique identifier of the note
   * @param versionId - The unique identifier of the version
   * @param content - The content to write
   * @returns Promise resolving to object containing file size
   */
  public async write(
    noteId: string,
    versionId: string,
    content: string
  ): Promise<{ size: number }> {
    // Strict input validation
    if (typeof noteId !== 'string' || noteId.trim() === '') {
      throw new Error(`VC: Invalid noteId provided for write operation: ${String(noteId)}`);
    }
    if (typeof versionId !== 'string' || versionId.trim() === '') {
      throw new Error(`VC: Invalid versionId provided for write operation: ${String(versionId)}`);
    }
    if (typeof content !== 'string') {
      throw new Error(`VC: Invalid content type provided for write operation: ${typeof content}`);
    }

    return this.queueService.enqueue(noteId, async () => {
      const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
      
      // Validate file path
      if (typeof versionFilePath !== 'string' || versionFilePath.trim() === '') {
        throw new Error(`VC: Generated invalid file path for note ${noteId}, version ${versionId}`);
      }

      // Execute with retry logic and timeout protection
      await this.executeWithRetryAndTimeout(
        async () => {
          try {
            await this.app.vault.adapter.write(versionFilePath, content);
          } catch (error) {
            console.error(
              `VC: Failed to write content for note ${noteId}, version ${versionId}.`,
              error instanceof Error ? error.message : String(error)
            );
            throw error; // Re-throw for retry logic
          }
        },
        `write_${noteId}_${versionId}`,
        this.MAX_RETRIES,
        this.RETRY_DELAY_MS
      );

      // Calculate file size directly from content (most reliable method)
      // Using Blob for accurate UTF-8 byte length calculation
      let fileSize: number;
      try {
        fileSize = new Blob([content]).size;
        
        // Defensive: Validate calculated size
        if (typeof fileSize !== 'number' || isNaN(fileSize) || fileSize < 0) {
          console.warn(`VC: Invalid file size calculated for ${versionFilePath}:`, fileSize);
          fileSize = content.length; // Fallback to character count
        }
      } catch (error) {
        console.warn(`VC: Failed to calculate Blob size, falling back to string length:`, error);
        fileSize = content.length;
      }

      return { size: fileSize };
    });
  }

  /**
   * Deletes a version file with enhanced error handling and optional queue bypass.
   * @param noteId - The unique identifier of the note
   * @param versionId - The unique identifier of the version
   * @param options - Deletion options including bypassQueue flag
   * @returns Promise resolving when deletion is complete
   */
  public async delete(
    noteId: string,
    versionId: string,
    options: { bypassQueue?: boolean } = {}
  ): Promise<void> {
    // Strict input validation
    if (typeof noteId !== 'string' || noteId.trim() === '') {
      console.warn(`VC: Invalid noteId provided for delete operation:`, { noteId });
      return;
    }
    if (typeof versionId !== 'string' || versionId.trim() === '') {
      console.warn(`VC: Invalid versionId provided for delete operation:`, { versionId });
      return;
    }
    if (options && typeof options !== 'object') {
      console.warn(`VC: Invalid options provided for delete operation:`, { options });
      options = {};
    }

    const task = async (): Promise<void> => {
      const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
      
      // Validate file path
      if (typeof versionFilePath !== 'string' || versionFilePath.trim() === '') {
        console.error(`VC: Generated invalid file path for note ${noteId}, version ${versionId}`);
        return;
      }

      // Execute with retry logic and timeout protection
      await this.executeWithRetryAndTimeout(
        async () => {
          try {
            const exists = await this.app.vault.adapter.exists(versionFilePath);
            if (exists) {
              await this.app.vault.adapter.remove(versionFilePath);
              console.debug(`VC: Successfully deleted version file: ${versionFilePath}`);
            } else {
              console.warn(`VC: Version file to delete was already missing: ${versionFilePath}`);
            }
          } catch (error) {
            console.error(
              `VC: Failed to delete content for note ${noteId}, version ${versionId}.`,
              error instanceof Error ? error.message : String(error)
            );
            throw error; // Re-throw for retry logic
          }
        },
        `delete_${noteId}_${versionId}`,
        this.MAX_RETRIES,
        this.RETRY_DELAY_MS
      );
    };

    if (options.bypassQueue) {
      return task();
    }
    
    return this.queueService.enqueue(noteId, task);
  }

  /**
   * Retrieves the content of the latest version based on version number.
   * @param noteId - The unique identifier of the note
   * @param noteManifest - The manifest containing version metadata
   * @returns Promise resolving to content string or null if not found
   */
  public async getLatestVersionContent(
    noteId: string,
    noteManifest: NoteManifest
  ): Promise<string | null> {
    // Strict input validation
    if (typeof noteId !== 'string' || noteId.trim() === '') {
      console.warn(`VC: Invalid noteId provided for getLatestVersionContent:`, { noteId });
      return null;
    }
    if (!noteManifest || typeof noteManifest !== 'object') {
      console.warn(`VC: Invalid noteManifest provided:`, { noteManifest });
      return null;
    }

    // Defensive: Check for versions property
    if (!noteManifest.versions || typeof noteManifest.versions !== 'object') {
      console.debug(`VC: No versions found in manifest for note ${noteId}`);
      return null;
    }

    try {
      // Convert to array and sort by version number (descending)
      const versions = Object.entries(noteManifest.versions).sort(
        ([, a], [, b]) => {
          // Defensive: Validate version metadata
          if (!a || typeof a !== 'object' || !b || typeof b !== 'object') {
            return 0;
          }
          
          const aVersionNumber = typeof a.versionNumber === 'number' ? a.versionNumber : 0;
          const bVersionNumber = typeof b.versionNumber === 'number' ? b.versionNumber : 0;
          
          return bVersionNumber - aVersionNumber;
        }
      );

      // Check if we have any versions
      if (versions.length === 0) {
        console.debug(`VC: No versions available for note ${noteId}`);
        return null;
      }

      // Get the latest version
      const latestVersionEntry = versions[0];
      if (!latestVersionEntry || !Array.isArray(latestVersionEntry) || latestVersionEntry.length < 1) {
        console.error(`VC: Invalid latest version entry for note ${noteId}`);
        return null;
      }

      const [latestVersionId] = latestVersionEntry;
      
      // Validate version ID
      if (typeof latestVersionId !== 'string' || latestVersionId.trim() === '') {
        console.error(`VC: Invalid latest version ID for note ${noteId}:`, { latestVersionId });
        return null;
      }

      // Read and return the content
      return await this.read(noteId, latestVersionId);
    } catch (error) {
      console.error(
        `VC: Failed to get latest version content for note ${noteId}.`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Executes an operation with retry logic and timeout protection.
   * @param operation - The async operation to execute
   * @param operationId - Unique identifier for logging and debugging
   * @param maxRetries - Maximum number of retry attempts
   * @param retryDelay - Delay between retries in milliseconds
   * @returns Promise resolving to the operation result
   */
  private async executeWithRetryAndTimeout<T>(
    operation: () => Promise<T>,
    operationId: string,
    maxRetries: number,
    retryDelay: number
  ): Promise<T> {
    let lastError: Error | unknown;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Wrap operation in timeout
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Operation timeout: ${operationId}`)), this.FILE_OPERATION_TIMEOUT_MS)
          )
        ]);
        return result;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.warn(
            `VC: Attempt ${attempt + 1} failed for ${operationId}, retrying in ${retryDelay}ms...`,
            error instanceof Error ? error.message : String(error)
          );
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          // Exponential backoff for subsequent retries
          retryDelay *= 2;
        }
      }
    }
    
    // If we've exhausted all retries, throw the last error
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
