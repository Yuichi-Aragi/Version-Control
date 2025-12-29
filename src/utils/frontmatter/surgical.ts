import { Document } from 'yaml';
import type { FrontmatterUpdates, FrontmatterOptions, FrontmatterValue } from './types';
import { DELETE } from './constants';
import { needsQuoting } from './common';

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get existing top-level keys from YAML content using regex.
 * 
 * CRITICAL: Uses regex-only approach to avoid parsing YAML that may contain
 * special syntax like {{VALUE}} which would trigger warnings about complex keys.
 * 
 * This is safe for surgical operations because we only need key names, not values.
 */
export function getExistingKeys(yamlContent: string): Set<string> {
  if (!yamlContent.trim()) {
    return new Set();
  }

  const keys = new Set<string>();
  const lines = yamlContent.split('\n');
  
  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    
    // Match top-level keys (no leading whitespace, followed by colon)
    // Handles both simple keys and quoted keys
    const unquotedMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
    if (unquotedMatch && unquotedMatch[1]) {
      keys.add(unquotedMatch[1]);
      continue;
    }
    
    // Match single-quoted keys
    const singleQuotedMatch = line.match(/^'([^']+)'\s*:/);
    if (singleQuotedMatch && singleQuotedMatch[1]) {
      keys.add(singleQuotedMatch[1]);
      continue;
    }
    
    // Match double-quoted keys
    const doubleQuotedMatch = line.match(/^"([^"]+)"\s*:/);
    if (doubleQuotedMatch && doubleQuotedMatch[1]) {
      keys.add(doubleQuotedMatch[1]);
      continue;
    }
  }
  
  return keys;
}

/**
 * Check if a value is simple enough for surgical insertion.
 * Only primitives are considered simple to avoid formatting issues with complex values.
 */
export function isSimpleValue(value: FrontmatterValue): boolean {
  if (value === null) return true;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return true;
  // Arrays and objects require proper YAML formatting, so not simple
  return false;
}

/**
 * Check if updates can be applied surgically (add-only with simple values).
 * Returns true if all updates are additions of new keys with simple primitive values.
 */
export function canUseSurgicalInsertion(
  updates: FrontmatterUpdates,
  existingKeys: Set<string>
): boolean {
  for (const [key, value] of Object.entries(updates)) {
    // If key exists, we need full update for proper handling
    if (existingKeys.has(key)) {
      return false;
    }

    // Skip deletions of non-existent keys
    if (value === DELETE || value === undefined) {
      continue;
    }

    // Only allow simple values for surgical insertion
    if (!isSimpleValue(value as FrontmatterValue)) {
      return false;
    }
  }
  return true;
}

// Keep the old name as an alias for backwards compatibility
export const canUseSurgicalUpdate = canUseSurgicalInsertion;

/**
 * Serialize a simple primitive value for YAML.
 * Only handles primitives - complex values should use full serialization.
 */
function serializeSimpleValue(
  value: FrontmatterValue,
  options: Required<FrontmatterOptions>
): string {
  if (value === null) {
    return options.nullStr;
  }
  if (typeof value === 'boolean') {
    return value ? options.trueStr : options.falseStr;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    if (needsQuoting(value)) {
      // Use double quotes with proper JSON escaping for safety
      return JSON.stringify(value);
    }
    return value;
  }

  // For complex values, fall back to yaml library
  // This shouldn't happen if canUseSurgicalInsertion is called first
  const doc = new Document(value);
  return doc.toString({ indent: options.indent }).trim();
}

/**
 * Result of a surgical insertion operation.
 */
export interface SurgicalInsertResult {
  readonly content: string;
  readonly changed: boolean;
  readonly added: readonly string[];
}

/**
 * Surgically insert new keys into YAML content without reparsing/reformatting existing content.
 * This preserves the exact original formatting of all existing keys.
 *
 * CRITICAL: This function appends new key-value pairs to the end of the YAML content
 * without modifying any existing content, ensuring placeholders like {{VALUE}} are preserved.
 */
export function surgicallyInsertKeys(
  yamlContent: string,
  updates: FrontmatterUpdates,
  options: Required<FrontmatterOptions>
): SurgicalInsertResult {
  const added: string[] = [];
  const newLines: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    // Skip deletions
    if (value === DELETE || value === undefined) {
      continue;
    }

    const serializedValue = serializeSimpleValue(value as FrontmatterValue, options);
    newLines.push(`${key}: ${serializedValue}`);
    added.push(key);
  }

  if (newLines.length === 0) {
    return { content: yamlContent, changed: false, added: [] };
  }

  let result = yamlContent;

  // Ensure content ends with a newline before appending
  result = result.trimEnd();
  if (result.length > 0) {
    result += '\n';
  }

  // Append new key-value pairs
  result += newLines.join('\n') + '\n';

  return {
    content: result,
    changed: true,
    added: added,
  };
}

/**
 * Check if the update operation is effectively a no-op.
 * Returns true if all updates are deletions of keys that don't exist.
 */
export function isNoOpUpdate(
  updates: FrontmatterUpdates,
  existingKeys: Set<string>
): boolean {
  for (const [key, value] of Object.entries(updates)) {
    if (value === DELETE || value === undefined) {
      // Deletion - only a no-op if key doesn't exist
      if (existingKeys.has(key)) {
        return false;
      }
    } else {
      // Addition or modification - not a no-op
      return false;
    }
  }
  return true;
}

// ============================================================================
// SURGICAL DELETION SUPPORT
// ============================================================================

/**
 * Result of a surgical deletion operation.
 */
export interface SurgicalDeleteResult {
  readonly content: string;
  readonly changed: boolean;
  readonly deleted: readonly string[];
}

/**
 * Information about a key's location in YAML content.
 */
export interface KeyLineRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly isSimple: boolean;
}

/**
 * Find the line range for a key in YAML content.
 * Returns null if the key is not found.
 * 
 * @param yamlContent - The YAML content to search
 * @param key - The key to find
 * @returns Line range information or null if not found
 */
export function findKeyLineRange(
  yamlContent: string,
  key: string
): KeyLineRange | null {
  const lines = yamlContent.split('\n');
  
  // Build pattern that matches the key at the start of a line
  // Handle both unquoted and quoted keys
  const escapedKey = escapeRegex(key);
  const unquotedPattern = new RegExp(`^${escapedKey}\\s*:`);
  const singleQuotedPattern = new RegExp(`^'${escapedKey}'\\s*:`);
  const doubleQuotedPattern = new RegExp(`^"${escapedKey}"\\s*:`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    
    const matchesKey = unquotedPattern.test(line) || 
                       singleQuotedPattern.test(line) || 
                       doubleQuotedPattern.test(line);
    
    if (matchesKey) {
      // Found the key, now determine the extent of its value
      let endLine = i;
      let isSimple = true;
      
      // Get the value part after the colon
      const colonIndex = line.indexOf(':');
      const valueAfterColon = line.slice(colonIndex + 1).trim();
      
      // Check if value starts on same line or is a block/flow indicator
      const isBlockScalar = valueAfterColon === '|' || valueAfterColon === '>' || 
                           valueAfterColon === '|-' || valueAfterColon === '>-' ||
                           valueAfterColon === '|+' || valueAfterColon === '>+';
      const isFlowSequence = valueAfterColon.startsWith('[');
      const isFlowMapping = valueAfterColon.startsWith('{');
      const isEmpty = valueAfterColon === '';
      
      // Check for incomplete flow constructs (multi-line)
      const hasUnclosedBracket = isFlowSequence && !valueAfterColon.includes(']');
      const hasUnclosedBrace = isFlowMapping && !valueAfterColon.includes('}');
      
      // Determine if this is a simple single-line value
      if (isBlockScalar || isEmpty || hasUnclosedBracket || hasUnclosedBrace) {
        isSimple = false;
      }
      
      // Check for multi-line continuation
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine === undefined) break;
        
        // Empty line handling
        if (nextLine.trim() === '') {
          // Empty lines can be part of block scalars
          if (isBlockScalar) {
            endLine = j;
            continue;
          }
          // For other cases, empty line might end the value
          // Check if next non-empty line is indented
          let foundIndented = false;
          for (let k = j + 1; k < lines.length; k++) {
            const futureLineCheck = lines[k];
            if (futureLineCheck === undefined) break;
            if (futureLineCheck.trim() !== '') {
              if (futureLineCheck.match(/^[ \t]+\S/)) {
                foundIndented = true;
              }
              break;
            }
          }
          if (foundIndented) {
            endLine = j;
            isSimple = false;
            continue;
          }
          break;
        }
        
        // Check if this line is indented (continuation of value)
        if (nextLine.match(/^[ \t]+/)) {
          endLine = j;
          isSimple = false;
        } else {
          // Not indented - this is a new top-level key or something else
          break;
        }
      }
      
      return {
        startLine: i,
        endLine,
        isSimple
      };
    }
  }
  return null;
}

/**
 * Check if deletions can be applied surgically.
 * Returns true if all keys to delete have simple single-line values.
 * 
 * @param keysToDelete - Array of keys to delete
 * @param yamlContent - The YAML content
 * @param existingKeys - Set of existing keys in the YAML
 * @returns true if surgical deletion is safe
 */
export function canUseSurgicalDeletion(
  keysToDelete: readonly string[],
  yamlContent: string,
  existingKeys: Set<string>
): boolean {
  for (const key of keysToDelete) {
    // Key doesn't exist - that's fine, nothing to delete
    if (!existingKeys.has(key)) {
      continue;
    }
    
    const range = findKeyLineRange(yamlContent, key);
    if (!range) {
      // Can't find the key even though it should exist - unsafe
      return false;
    }
    
    if (!range.isSimple) {
      // Key has complex multi-line value - can't safely delete surgically
      return false;
    }
  }
  return true;
}

/**
 * Surgically delete keys from YAML content without reparsing/reformatting.
 * This preserves the exact original formatting of all remaining keys.
 * 
 * CRITICAL: Only deletes keys with simple single-line values.
 * For complex values, use full YAML parsing.
 * 
 * @param yamlContent - The YAML content to modify
 * @param keysToDelete - Array of keys to delete
 * @param existingKeys - Set of existing keys
 * @returns Result with updated content and list of deleted keys
 */
export function surgicallyDeleteKeys(
  yamlContent: string,
  keysToDelete: readonly string[],
  existingKeys: Set<string>
): SurgicalDeleteResult {
  const lines = yamlContent.split('\n');
  const deleted: string[] = [];
  const linesToRemove = new Set<number>();
  
  for (const key of keysToDelete) {
    // Skip if key doesn't exist
    if (!existingKeys.has(key)) {
      continue;
    }
    
    const range = findKeyLineRange(yamlContent, key);
    if (range && range.isSimple) {
      // Only delete simple single-line values
      linesToRemove.add(range.startLine);
      deleted.push(key);
    }
  }
  
  if (linesToRemove.size === 0) {
    return { content: yamlContent, changed: false, deleted: [] };
  }
  
  // Filter out the lines to remove
  const newLines = lines.filter((_, index) => !linesToRemove.has(index));
  
  // Reconstruct content
  let content = newLines.join('\n');
  
  // Clean up multiple consecutive empty lines (but preserve single empty lines)
  content = content.replace(/\n{3,}/g, '\n\n');
  
  // Ensure proper ending
  content = content.trimEnd();
  if (content.length > 0) {
    content += '\n';
  }
  
  return {
    content,
    changed: true,
    deleted,
  };
}

/**
 * Result of batch surgical operations.
 */
export interface BatchSurgicalResult {
  readonly content: string;
  readonly changed: boolean;
  readonly added: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * Perform batch surgical operations (insertions and deletions) in a single pass.
 * This is more efficient than calling surgicallyInsertKeys and surgicallyDeleteKeys separately.
 * 
 * @param yamlContent - The YAML content to modify
 * @param updates - The updates to apply
 * @param existingKeys - Set of existing keys
 * @param options - Frontmatter options
 * @returns Result with updated content and lists of added/deleted keys
 */
export function batchSurgicalUpdate(
  yamlContent: string,
  updates: FrontmatterUpdates,
  existingKeys: Set<string>,
  options: Required<FrontmatterOptions>
): BatchSurgicalResult {
  // Separate additions and deletions
  const additions: Array<[string, FrontmatterValue]> = [];
  const deletions: string[] = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (value === DELETE || value === undefined) {
      if (existingKeys.has(key)) {
        deletions.push(key);
      }
    } else if (!existingKeys.has(key)) {
      // Only add if key doesn't exist (to avoid modifications)
      additions.push([key, value as FrontmatterValue]);
    }
  }
  
  let content = yamlContent;
  const added: string[] = [];
  const deleted: string[] = [];
  let changed = false;
  
  // First, perform deletions
  if (deletions.length > 0) {
    const deleteResult = surgicallyDeleteKeys(content, deletions, existingKeys);
    if (deleteResult.changed) {
      content = deleteResult.content;
      deleted.push(...deleteResult.deleted);
      changed = true;
    }
  }
  
  // Then, perform additions
  if (additions.length > 0) {
    const insertUpdates: FrontmatterUpdates = Object.fromEntries(additions);
    const insertResult = surgicallyInsertKeys(content, insertUpdates, options);
    if (insertResult.changed) {
      content = insertResult.content;
      added.push(...insertResult.added);
      changed = true;
    }
  }
  
  return {
    content,
    changed,
    added,
    deleted,
  };
}

/**
 * Analyze updates to determine the best surgical strategy.
 */
export interface SurgicalAnalysis {
  readonly canUseSurgical: boolean;
  readonly hasAdditions: boolean;
  readonly hasDeletions: boolean;
  readonly hasModifications: boolean;
  readonly additionKeys: readonly string[];
  readonly deletionKeys: readonly string[];
  readonly modificationKeys: readonly string[];
  readonly reason?: string;
}

/**
 * Analyze updates to determine if surgical operations can be used.
 * 
 * @param updates - The updates to analyze
 * @param yamlContent - The YAML content
 * @param existingKeys - Set of existing keys
 * @returns Analysis result with detailed breakdown
 */
export function analyzeSurgicalCapability(
  updates: FrontmatterUpdates,
  yamlContent: string,
  existingKeys: Set<string>
): SurgicalAnalysis {
  const additionKeys: string[] = [];
  const deletionKeys: string[] = [];
  const modificationKeys: string[] = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (value === DELETE || value === undefined) {
      if (existingKeys.has(key)) {
        deletionKeys.push(key);
      }
    } else if (existingKeys.has(key)) {
      modificationKeys.push(key);
    } else {
      additionKeys.push(key);
    }
  }
  
  // Check if modifications exist - can't handle surgically
  if (modificationKeys.length > 0) {
    return {
      canUseSurgical: false,
      hasAdditions: additionKeys.length > 0,
      hasDeletions: deletionKeys.length > 0,
      hasModifications: true,
      additionKeys,
      deletionKeys,
      modificationKeys,
      reason: 'Modifications to existing keys require full YAML processing',
    };
  }
  
  // Check if additions are all simple values
  for (const key of additionKeys) {
    const value = updates[key];
    if (value !== undefined && value !== DELETE && !isSimpleValue(value as FrontmatterValue)) {
      return {
        canUseSurgical: false,
        hasAdditions: true,
        hasDeletions: deletionKeys.length > 0,
        hasModifications: false,
        additionKeys,
        deletionKeys,
        modificationKeys,
        reason: `Key "${key}" has complex value that requires full YAML processing`,
      };
    }
  }
  
  // Check if deletions are all simple values
  if (!canUseSurgicalDeletion(deletionKeys, yamlContent, existingKeys)) {
    return {
      canUseSurgical: false,
      hasAdditions: additionKeys.length > 0,
      hasDeletions: true,
      hasModifications: false,
      additionKeys,
      deletionKeys,
      modificationKeys,
      reason: 'Some keys to delete have complex values that require full YAML processing',
    };
  }
  
  return {
    canUseSurgical: true,
    hasAdditions: additionKeys.length > 0,
    hasDeletions: deletionKeys.length > 0,
    hasModifications: false,
    additionKeys,
    deletionKeys,
    modificationKeys,
  };
}
