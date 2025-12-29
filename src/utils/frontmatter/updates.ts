import { isMap, isNode, YAMLMap, Pair, Scalar, Document } from 'yaml';
import type { ParsedNode, Node } from 'yaml';
import type { FrontmatterUpdates, FrontmatterOptions, FrontmatterValue } from './types';
import { DELETE } from './constants';
import { validateYamlKey, deepEquals, deepFreeze } from './common';
import { findPairByKey, updateNodeWithPreservation, createStyledNode } from './document';
import { mergeValues } from './merger';

interface UpdateStats {
  changed: boolean;
  added: readonly string[];
  modified: readonly string[];
  deleted: readonly string[];
}

/**
 * Apply updates to document with complete integrity preservation
 */
export function applyUpdates(
  doc: Document,
  updates: FrontmatterUpdates,
  options: Required<FrontmatterOptions>
): UpdateStats {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  let changed = false;

  // Ensure document has a map
  if (!isMap(doc.contents)) {
    doc.contents = new YAMLMap();
  }

  const map = doc.contents as YAMLMap;

  // Process each update
  const updateEntries = Object.entries(updates);

  for (const [key, value] of updateEntries) {
    // Validate key
    if (options.validateKeys) {
      const validation = validateYamlKey(key);
      if (!validation.valid) {
        throw new Error(`Invalid key "${key}": ${validation.reason}`);
      }
    }

    const existingPair = findPairByKey(map, key);
    const exists = existingPair !== undefined;

    // Handle deletion
    if (value === DELETE || value === undefined) {
      if (exists) {
        const index = map.items.indexOf(existingPair!);
        if (index !== -1) {
          map.items.splice(index, 1);
          deleted.push(key);
          changed = true;
        }
      }
      continue;
    }

    // Narrow type: value is now guaranteed to be FrontmatterValue (not symbol or undefined)
    const validValue = value as FrontmatterValue;

    // Get current value for comparison
    let currentValue: FrontmatterValue | undefined;
    if (exists && existingPair && isNode(existingPair.value)) {
      currentValue = (existingPair.value as ParsedNode).toJSON() as FrontmatterValue;
    }

    // Calculate new value with potential merge
    const newValue = exists && options.deepMerge
      ? mergeValues(currentValue, validValue, options)
      : validValue;

    // Check if value actually changed
    if (deepEquals(currentValue, newValue)) {
      continue;
    }

    // Apply update
    if (exists && existingPair) {
      // Update existing value with style preservation
      if (isNode(existingPair.value)) {
        existingPair.value = updateNodeWithPreservation(
          doc,
          existingPair.value as Node,
          newValue,
          options
        );
      } else {
        existingPair.value = createStyledNode(doc, newValue, options);
      }
      modified.push(key);
    } else {
      // Add new key-value pair
      const keyNode = doc.createNode(key) as Scalar;
      const valueNode = createStyledNode(doc, newValue, options);
      map.items.push(new Pair(keyNode, valueNode));
      added.push(key);
    }

    changed = true;
  }

  return deepFreeze({
    changed,
    added,
    modified,
    deleted,
  });
}