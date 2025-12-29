import type {
  FrontmatterValue,
  FrontmatterObject,
  FrontmatterArray,
  ArrayMergeStrategy,
  FrontmatterOptions
} from './types';
import { deepEquals } from './common';

/**
 * Merge arrays based on strategy
 */
export function mergeArrays(
  target: readonly FrontmatterValue[],
  source: readonly FrontmatterValue[],
  strategy: ArrayMergeStrategy,
  options: Required<FrontmatterOptions>,
  depth: number
): FrontmatterValue[] {
  if (depth > options.maxDepth) {
    throw new Error(`Maximum nesting depth (${options.maxDepth}) exceeded`);
  }

  switch (strategy) {
    case 'append':
      return [...target, ...source];

    case 'prepend':
      return [...source, ...target];

    case 'unique': {
      const result = [...target];
      for (const item of source) {
        const exists = result.some(existing => deepEquals(existing, item));
        if (!exists) {
          result.push(item);
        }
      }
      return result;
    }

    case 'merge-by-index': {
      const result = [...target];
      for (let i = 0; i < source.length; i++) {
        if (i < result.length) {
          const targetItem = result[i];
          const sourceItem = source[i]!; // Safe because i < source.length

          if (
            typeof targetItem === 'object' &&
            targetItem !== null &&
            !Array.isArray(targetItem) &&
            typeof sourceItem === 'object' &&
            sourceItem !== null &&
            !Array.isArray(sourceItem)
          ) {
            result[i] = deepMergeObjects(
              targetItem as FrontmatterObject,
              sourceItem as FrontmatterObject,
              options,
              depth + 1
            );
          } else {
            result[i] = sourceItem;
          }
        } else {
          result.push(source[i]!); // Safe because i < source.length
        }
      }
      return result;
    }

    case 'replace':
    default:
      return [...source];
  }
}

/**
 * Deep merge two objects
 */
export function deepMergeObjects(
  target: FrontmatterObject,
  source: FrontmatterObject,
  options: Required<FrontmatterOptions>,
  depth: number = 0
): FrontmatterObject {
  if (depth > options.maxDepth) {
    throw new Error(`Maximum nesting depth (${options.maxDepth}) exceeded`);
  }

  const result: Record<string, FrontmatterValue | null> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (sourceValue === null) {
      result[key] = null;
      continue;
    }

    if (Array.isArray(sourceValue)) {
      if (Array.isArray(targetValue)) {
        result[key] = mergeArrays(
          targetValue as FrontmatterArray,
          sourceValue as FrontmatterArray,
          options.arrayMergeStrategy,
          options,
          depth + 1
        );
      } else {
        result[key] = [...sourceValue];
      }
      continue;
    }

    if (
      typeof sourceValue === 'object' &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMergeObjects(
        targetValue as FrontmatterObject,
        sourceValue as FrontmatterObject,
        options,
        depth + 1
      );
      continue;
    }

    result[key] = sourceValue;
  }

  return result;
}

/**
 * Merge a value into an existing value based on options
 */
export function mergeValues(
  target: FrontmatterValue | undefined,
  source: FrontmatterValue,
  options: Required<FrontmatterOptions>,
  depth: number = 0
): FrontmatterValue {
  if (!options.deepMerge) {
    return source;
  }

  if (target === undefined || target === null) {
    return source;
  }

  if (source === null) {
    return null;
  }

  if (Array.isArray(source)) {
    if (Array.isArray(target)) {
      return mergeArrays(
        target as FrontmatterArray,
        source as FrontmatterArray,
        options.arrayMergeStrategy,
        options,
        depth
      );
    }
    return source;
  }

  if (
    typeof source === 'object' &&
    typeof target === 'object' &&
    !Array.isArray(target)
  ) {
    return deepMergeObjects(
      target as FrontmatterObject,
      source as FrontmatterObject,
      options,
      depth
    );
  }

  return source;
}