import { App, TFile } from 'obsidian';
import { parse, Document, isMap, YAMLMap } from 'yaml';
import {
  DEFAULT_OPTIONS,
  DELETE,
  BOM
} from './constants';
import type {
  FrontmatterOptions,
  FrontmatterUpdates,
  FrontmatterOperationResult,
  FrontmatterObject,
  FrontmatterValue,
  FrontmatterUpdateValue,
  BatchOperationResult,
  FrontmatterFileResult,
  FrontmatterPath
} from './types';
import {
  readFile,
  writeFile,
  reconstructContent,
  createNewFrontmatter
} from './io';
import { extractFrontmatter } from './parser';
import {
  parseYamlWithPreservation,
  createEmptyDocument,
  serializeDocument
} from './document';
import { applyUpdates } from './updates';
import { deepMergeObjects } from './merger';
import {
  detectLineEnding,
  normalizeToLF,
  toLineEnding,
  deepFreeze,
  validateYamlKey
} from './common';
import {
  getExistingKeys,
  isNoOpUpdate,
  analyzeSurgicalCapability,
  batchSurgicalUpdate
} from './surgical';

// Re-export types and constants
export * from './types';
export * from './constants';

// Helper type for mutable options to allow local updates
type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Parse YAML content safely, suppressing all warnings.
 * Used for reading frontmatter where the user wants actual parsed data.
 */
function parseYamlSafe(content: string): unknown {
  return parse(content, {
    logLevel: 'silent', // Completely suppress all warnings
  });
}

/**
 * Update frontmatter with complete integrity preservation and guaranteed idempotency.
 *
 * CRITICAL FIX: This function now uses surgical insertion/deletion for simple operations
 * to prevent reformatting of existing YAML content. This preserves special syntax
 * like QuickAdd placeholders ({{VALUE}}) that would otherwise be corrupted by
 * YAML reparsing.
 * 
 * For newly created frontmatter (files without any), uses Obsidian's processFrontMatter
 * API for proper integration.
 */
export async function updateFrontmatter(
  app: App,
  file: TFile,
  updates: FrontmatterUpdates,
  options: FrontmatterOptions = {}
): Promise<FrontmatterOperationResult> {
  // Input validation
  if (!app || typeof app !== 'object' || !app.vault) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid app: must be a valid Obsidian App instance'),
    };
  }

  if (!file || !(file instanceof TFile)) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid file: must be a TFile instance'),
    };
  }

  if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid updates: must be a plain object'),
    };
  }

  // Capture user intent for indent before merging defaults
  const userIndent = options.indent;

  // Merge options with defaults - use Mutable type to allow updates to indent
  const opts: Mutable<Required<FrontmatterOptions>> = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Read original content
    const originalContent = await readFile(app, file);

    // Determine line ending
    const detectedLineEnding = detectLineEnding(originalContent);
    const targetLineEnding: '\n' | '\r\n' =
      opts.lineEnding === 'crlf' ? '\r\n' :
        opts.lineEnding === 'lf' ? '\n' :
          detectedLineEnding;

    // Extract frontmatter
    const metadata = extractFrontmatter(originalContent);

    // CRITICAL FIX: Use detected indent if not explicitly overridden by user.
    if (metadata.exists && userIndent === undefined && metadata.indentSize > 0) {
      opts.indent = metadata.indentSize;
    }

    let finalContent: string;

    if (metadata.exists) {
      // Get existing keys to determine update strategy
      const existingKeys = getExistingKeys(metadata.yamlContent);

      // Check for no-op updates first
      if (isNoOpUpdate(updates, existingKeys)) {
        return {
          success: true,
          changed: false,
          metadata,
        };
      }

      // Analyze if we can use surgical operations
      const analysis = analyzeSurgicalCapability(updates, metadata.yamlContent, existingKeys);

      // CRITICAL FIX: Use surgical operations for simple add/delete operations.
      // This prevents the YAML parser from reformatting existing content that contains
      // special syntax like {{VALUE}} which would be interpreted as flow mappings.
      if (!metadata.isEmpty && analysis.canUseSurgical && (analysis.hasAdditions || analysis.hasDeletions)) {
        const surgicalResult = batchSurgicalUpdate(
          metadata.yamlContent,
          updates,
          existingKeys,
          opts
        );

        if (!surgicalResult.changed) {
          return {
            success: true,
            changed: false,
            metadata,
          };
        }

        // Check if frontmatter became empty after deletions
        const remainingContent = surgicalResult.content.trim();
        if (remainingContent.length === 0 && opts.removeIfEmpty) {
          // Remove frontmatter entirely
          const afterContent = metadata.afterContent.replace(/^\n+/, '');
          finalContent = metadata.hasBom ? BOM + afterContent : afterContent;
          finalContent = toLineEnding(finalContent, targetLineEnding);
        } else {
          // Reconstruct file with surgically updated YAML
          finalContent = reconstructContent(
            surgicalResult.content,
            metadata,
            targetLineEnding
          );
        }

        // Final idempotency check
        if (finalContent === originalContent) {
          return {
            success: true,
            changed: false,
            metadata,
          };
        }

        // Write file
        await writeFile(app, file, finalContent, originalContent);

        // Get updated metadata
        const updatedMetadata = extractFrontmatter(finalContent);

        return {
          success: true,
          changed: true,
          metadata: updatedMetadata,
        };
      }

      // Full parse/serialize path for complex updates (modifications, complex values)
      const doc = metadata.isEmpty
        ? createEmptyDocument()
        : parseYamlWithPreservation(metadata.yamlContent, opts);

      // Apply updates
      const updateStats = applyUpdates(doc, updates, opts);

      if (!updateStats.changed) {
        // No changes - idempotency
        return {
          success: true,
          changed: false,
          metadata,
        };
      }

      // Check if frontmatter should be removed
      const isEmpty = !isMap(doc.contents) || (doc.contents as YAMLMap).items.length === 0;

      if (isEmpty && opts.removeIfEmpty) {
        // Remove frontmatter entirely
        const afterContent = metadata.afterContent.replace(/^\n+/, '');
        finalContent = metadata.hasBom ? BOM + afterContent : afterContent;
        finalContent = toLineEnding(finalContent, targetLineEnding);
      } else {
        // Serialize updated document
        const yamlContent = serializeDocument(doc, opts);
        finalContent = reconstructContent(yamlContent, metadata, targetLineEnding);
      }
    } else {
      // No existing frontmatter
      if (!opts.createIfMissing) {
        return {
          success: true,
          changed: false,
          metadata,
        };
      }

      // Filter out deletions
      const createEntries = Object.entries(updates).filter(
        ([_, value]) => value !== DELETE && value !== undefined
      );

      if (createEntries.length === 0) {
        return {
          success: true,
          changed: false,
          metadata,
        };
      }

      // Use Obsidian's processFrontMatter for creating new frontmatter
      // This ensures proper integration with Obsidian's internal handling
      try {
        await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          for (const [key, value] of createEntries) {
            fm[key] = value;
          }
        });

        // Read the updated content to get metadata
        const newContent = await readFile(app, file);
        const updatedMetadata = extractFrontmatter(newContent);

        return {
          success: true,
          changed: true,
          metadata: updatedMetadata,
        };
      } catch (processFmError) {
        // Fallback to manual creation if processFrontMatter fails
        const doc = createEmptyDocument();
        const createUpdates: FrontmatterUpdates = Object.fromEntries(createEntries);
        applyUpdates(doc, createUpdates, opts);

        const yamlContent = serializeDocument(doc, opts);
        const normalizedOriginal = normalizeToLF(originalContent);
        const hasBom = originalContent.startsWith(BOM);
        const bodyContent = hasBom ? normalizedOriginal.slice(1) : normalizedOriginal;

        finalContent = createNewFrontmatter(yamlContent, bodyContent, hasBom, targetLineEnding);
      }
    }

    // Final idempotency check
    if (finalContent === originalContent) {
      return {
        success: true,
        changed: false,
        metadata,
      };
    }

    // Write file
    await writeFile(app, file, finalContent, originalContent);

    // Get updated metadata
    const updatedMetadata = extractFrontmatter(finalContent);

    return {
      success: true,
      changed: true,
      metadata: updatedMetadata,
    };
  } catch (error) {
    return {
      success: false,
      changed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Read frontmatter from a file without modification.
 */
export async function getFrontmatter(
  app: App,
  file: TFile
): Promise<FrontmatterOperationResult<FrontmatterObject | null>> {
  if (!app || !file) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid parameters'),
    };
  }

  try {
    const content = await readFile(app, file);
    const metadata = extractFrontmatter(content);

    if (!metadata.exists || metadata.isEmpty) {
      return {
        success: true,
        changed: false,
        data: null,
        metadata,
      };
    }

    // Use safe parsing to suppress warnings about complex keys
    const parsed = parseYamlSafe(metadata.yamlContent) as FrontmatterObject | null;
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? deepFreeze(parsed)
      : null;

    return {
      success: true,
      changed: false,
      data,
      metadata,
    };
  } catch (error) {
    return {
      success: false,
      changed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Replace entire frontmatter with new content.
 * Uses Obsidian's processFrontMatter for creating new frontmatter.
 */
export async function setFrontmatter(
  app: App,
  file: TFile,
  frontmatter: FrontmatterObject | null,
  options: FrontmatterOptions = {}
): Promise<FrontmatterOperationResult> {
  if (!app || !file) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid parameters'),
    };
  }

  const opts: Required<FrontmatterOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    deepMerge: false, // Override: we're replacing
  };

  try {
    const originalContent = await readFile(app, file);
    const detectedLineEnding = detectLineEnding(originalContent);
    const targetLineEnding: '\n' | '\r\n' =
      opts.lineEnding === 'crlf' ? '\r\n' :
        opts.lineEnding === 'lf' ? '\n' :
          detectedLineEnding;

    const metadata = extractFrontmatter(originalContent);

    let finalContent: string;

    if (frontmatter === null) {
      // Remove frontmatter - delegate to removeFrontmatter
      return removeFrontmatter(app, file);
    } else {
      if (!metadata.exists) {
        // No existing frontmatter - use processFrontMatter to create new
        try {
          await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            // Clear any existing keys and set new ones
            for (const key of Object.keys(fm)) {
              delete fm[key];
            }
            for (const [key, value] of Object.entries(frontmatter)) {
              fm[key] = value;
            }
          });

          const newContent = await readFile(app, file);
          const updatedMetadata = extractFrontmatter(newContent);

          return {
            success: true,
            changed: true,
            metadata: updatedMetadata,
          };
        } catch {
          // Fallback to manual creation
          const doc = new Document(frontmatter);
          const yamlContent = serializeDocument(doc, opts);
          const normalizedOriginal = normalizeToLF(originalContent);
          const hasBom = originalContent.startsWith(BOM);
          const bodyContent = hasBom ? normalizedOriginal.slice(1) : normalizedOriginal;
          finalContent = createNewFrontmatter(yamlContent, bodyContent, hasBom, targetLineEnding);
        }
      } else {
        // Existing frontmatter - replace with new
        const doc = new Document(frontmatter);
        const yamlContent = serializeDocument(doc, opts);
        finalContent = reconstructContent(yamlContent, metadata, targetLineEnding);
      }
    }

    if (finalContent === originalContent) {
      return {
        success: true,
        changed: false,
        metadata,
      };
    }

    await writeFile(app, file, finalContent, originalContent);
    const updatedMetadata = extractFrontmatter(finalContent);

    return {
      success: true,
      changed: true,
      metadata: updatedMetadata,
    };
  } catch (error) {
    return {
      success: false,
      changed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Remove frontmatter from a file entirely.
 * Uses Obsidian's processFrontMatter API to properly handle the deletion.
 */
export async function removeFrontmatter(
  app: App,
  file: TFile
): Promise<FrontmatterOperationResult> {
  if (!app || !file) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid parameters'),
    };
  }

  try {
    const originalContent = await readFile(app, file);
    const metadata = extractFrontmatter(originalContent);

    if (!metadata.exists) {
      return {
        success: true,
        changed: false,
        metadata,
      };
    }

    // Use processFrontMatter to clear all keys
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const key of Object.keys(fm)) {
        delete fm[key];
      }
    });

    // Check if Obsidian left an empty frontmatter block
    const contentAfterProcess = await readFile(app, file);
    const metadataAfterProcess = extractFrontmatter(contentAfterProcess);

    // If there's still an empty frontmatter block, remove it manually
    if (metadataAfterProcess.exists && metadataAfterProcess.isEmpty) {
      const detectedLineEnding = detectLineEnding(contentAfterProcess);
      let afterContent = metadataAfterProcess.afterContent;
      
      // Clean up leading newlines
      afterContent = afterContent.replace(/^\n+/, '');
      
      let finalContent = metadataAfterProcess.hasBom ? BOM + afterContent : afterContent;
      finalContent = toLineEnding(finalContent, detectedLineEnding);

      await writeFile(app, file, finalContent, contentAfterProcess);
    }

    const finalContent = await readFile(app, file);
    const finalMetadata = extractFrontmatter(finalContent);

    return {
      success: true,
      changed: true,
      metadata: finalMetadata,
    };
  } catch (error) {
    return {
      success: false,
      changed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Check if a file has frontmatter.
 */
export async function hasFrontmatter(
  app: App,
  file: TFile
): Promise<FrontmatterOperationResult<boolean>> {
  if (!app || !file) {
    return {
      success: false,
      changed: false,
      error: new Error('Invalid parameters'),
    };
  }

  try {
    const content = await readFile(app, file);
    const metadata = extractFrontmatter(content);

    return {
      success: true,
      changed: false,
      data: metadata.exists && !metadata.isEmpty,
      metadata,
    };
  } catch (error) {
    return {
      success: false,
      changed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Get a specific key from frontmatter.
 */
export async function getFrontmatterKey<T extends FrontmatterValue = FrontmatterValue>(
  app: App,
  file: TFile,
  key: string
): Promise<FrontmatterOperationResult<T | undefined>> {
  const result = await getFrontmatter(app, file);

  if (!result.success || !result.data) {
    return {
      success: result.success,
      changed: false,
      data: undefined,
      error: result.error,
      metadata: result.metadata,
    };
  }

  const value = result.data[key] as T | undefined;

  return {
    success: true,
    changed: false,
    data: value,
    metadata: result.metadata,
  };
}

/**
 * Set a specific key in frontmatter.
 */
export async function setFrontmatterKey(
  app: App,
  file: TFile,
  key: string,
  value: FrontmatterUpdateValue,
  options: FrontmatterOptions = {}
): Promise<FrontmatterOperationResult> {
  return updateFrontmatter(app, file, { [key]: value }, options);
}

/**
 * Delete a specific key from frontmatter.
 * Uses surgical deletion when possible to preserve formatting.
 */
export async function deleteFrontmatterKey(
  app: App,
  file: TFile,
  key: string
): Promise<FrontmatterOperationResult> {
  return updateFrontmatter(app, file, { [key]: DELETE });
}

/**
 * Delete multiple keys from frontmatter in a single operation.
 * Uses surgical batch deletion when possible to preserve formatting.
 */
export async function deleteFrontmatterKeys(
  app: App,
  file: TFile,
  keys: readonly string[]
): Promise<FrontmatterOperationResult> {
  const updates: Record<string, typeof DELETE> = {};
  for (const key of keys) {
    updates[key] = DELETE;
  }
  return updateFrontmatter(app, file, updates);
}

/**
 * Batch update frontmatter across multiple files.
 */
export async function batchUpdateFrontmatter(
  app: App,
  files: readonly TFile[],
  updates: FrontmatterUpdates,
  options: FrontmatterOptions = {}
): Promise<BatchOperationResult> {
  if (!app || !Array.isArray(files)) {
    return {
      totalFiles: 0,
      successCount: 0,
      failureCount: 1,
      unchangedCount: 0,
      results: [],
    };
  }

  const results: FrontmatterFileResult[] = [];
  let successCount = 0;
  let failureCount = 0;
  let unchangedCount = 0;

  for (const file of files) {
    const result = await updateFrontmatter(app, file, updates, options);

    results.push({
      file,
      success: result.success,
      changed: result.changed,
      error: result.error,
    });

    if (result.success) {
      successCount++;
      if (!result.changed) {
        unchangedCount++;
      }
    } else {
      failureCount++;
    }
  }

  return deepFreeze({
    totalFiles: files.length,
    successCount,
    failureCount,
    unchangedCount,
    results,
  });
}

/**
 * Batch delete keys from frontmatter across multiple files.
 * Uses surgical deletion when possible to preserve formatting.
 */
export async function batchDeleteFrontmatterKeys(
  app: App,
  files: readonly TFile[],
  keys: readonly string[]
): Promise<BatchOperationResult> {
  const updates: Record<string, typeof DELETE> = {};
  for (const key of keys) {
    updates[key] = DELETE;
  }
  return batchUpdateFrontmatter(app, files, updates);
}

/**
 * Merge frontmatter from multiple sources into a file.
 */
export async function mergeFrontmatter(
  app: App,
  file: TFile,
  sources: readonly FrontmatterObject[],
  options: FrontmatterOptions = {}
): Promise<FrontmatterOperationResult> {
  if (!sources || sources.length === 0) {
    return {
      success: true,
      changed: false,
    };
  }

  const opts: Required<FrontmatterOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    deepMerge: true, // Force deep merge
  };

  // Combine all sources into single updates object
  let combined: Record<string, FrontmatterValue | null> = {};

  for (const source of sources) {
    combined = deepMergeObjects(combined, source, opts) as Record<string, FrontmatterValue | null>;
  }

  return updateFrontmatter(app, file, combined, opts);
}

/**
 * Validate frontmatter structure and content.
 */
export function validateFrontmatter(
  frontmatter: unknown,
  schema?: Readonly<Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any'>>
): { valid: boolean; errors: readonly string[] } {
  const errors: string[] = [];

  if (frontmatter === null || frontmatter === undefined) {
    return { valid: true, errors: [] };
  }

  if (typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    errors.push('Frontmatter must be an object');
    return { valid: false, errors: deepFreeze(errors) };
  }

  const fm = frontmatter as Record<string, unknown>;

  // Validate keys
  for (const key of Object.keys(fm)) {
    const validation = validateYamlKey(key);
    if (!validation.valid) {
      errors.push(`Invalid key "${key}": ${validation.reason}`);
    }
  }

  // Validate against schema
  if (schema) {
    for (const [key, expectedType] of Object.entries(schema)) {
      const value = fm[key];

      if (value === undefined) continue;
      if (expectedType === 'any') continue;

      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (actualType !== expectedType && value !== null) {
        errors.push(`Key "${key}" expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: deepFreeze(errors),
  };
}

/**
 * Create a fluent frontmatter builder for constructing updates.
 */
export function createFrontmatterBuilder(): {
  set: (key: string, value: FrontmatterValue) => ReturnType<typeof createFrontmatterBuilder>;
  delete: (key: string) => ReturnType<typeof createFrontmatterBuilder>;
  merge: (obj: FrontmatterObject) => ReturnType<typeof createFrontmatterBuilder>;
  build: () => FrontmatterUpdates;
} {
  const updates: Record<string, FrontmatterUpdateValue> = {};

  const builder = {
    set(key: string, value: FrontmatterValue) {
      updates[key] = value;
      return builder;
    },
    delete(key: string) {
      updates[key] = DELETE;
      return builder;
    },
    merge(obj: FrontmatterObject) {
      for (const [key, value] of Object.entries(obj)) {
        updates[key] = value;
      }
      return builder;
    },
    build(): FrontmatterUpdates {
      return deepFreeze({ ...updates });
    },
  };

  return builder;
}

/**
 * Get nested value from frontmatter using dot notation or array path.
 */
export async function getFrontmatterPath<T extends FrontmatterValue = FrontmatterValue>(
  app: App,
  file: TFile,
  path: FrontmatterPath
): Promise<FrontmatterOperationResult<T | undefined>> {
  const result = await getFrontmatter(app, file);

  if (!result.success || !result.data) {
    return {
      success: result.success,
      changed: false,
      data: undefined,
      error: result.error,
      metadata: result.metadata,
    };
  }

  const segments = typeof path === 'string'
    ? path.split('.').filter(s => s.length > 0)
    : [...path];

  let current: unknown = result.data;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return {
        success: true,
        changed: false,
        data: undefined,
        metadata: result.metadata,
      };
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return {
    success: true,
    changed: false,
    data: current as T | undefined,
    metadata: result.metadata,
  };
}

/**
 * Set nested value in frontmatter using dot notation or array path.
 */
export async function setFrontmatterPath(
  app: App,
  file: TFile,
  path: FrontmatterPath,
  value: FrontmatterUpdateValue,
  options: FrontmatterOptions = {}
): Promise<FrontmatterOperationResult> {
  const segments = typeof path === 'string'
    ? path.split('.').filter(s => s.length > 0)
    : [...path];

  if (segments.length === 0) {
    return {
      success: false,
      changed: false,
      error: new Error('Path cannot be empty'),
    };
  }

  if (segments.length === 1) {
    const key = segments[0] as string;
    return updateFrontmatter(app, file, { [key]: value }, options);
  }

  // Build nested object
  const rootKey = segments[0] as string;
  let nested: Record<string, unknown> = {};
  let current = nested;

  for (let i = 1; i < segments.length - 1; i++) {
    const child: Record<string, unknown> = {};
    const key = segments[i] as string;
    current[key] = child;
    current = child;
  }

  const lastKey = segments[segments.length - 1] as string;
  current[lastKey] = value === DELETE ? DELETE : value;

  const updates: FrontmatterUpdates = {
    [rootKey]: nested as FrontmatterObject,
  };

  return updateFrontmatter(app, file, updates, { ...options, deepMerge: true });
}

/**
 * Delete nested value from frontmatter using dot notation or array path.
 */
export async function deleteFrontmatterPath(
  app: App,
  file: TFile,
  path: FrontmatterPath
): Promise<FrontmatterOperationResult> {
  return setFrontmatterPath(app, file, path, DELETE);
}
