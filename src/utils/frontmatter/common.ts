import { YAML_RESERVED, YAML_SPECIAL_CHARS } from './constants';

// ============================================================================
// IMMUTABILITY UTILITIES
// ============================================================================

/**
 * Deep freeze an object recursively - ensures complete immutability
 */
export function deepFreeze<T>(obj: T, visited = new WeakSet<object>()): Readonly<T> {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  // Safe cast because we checked typeof object and null
  const ref = obj as object;

  if (visited.has(ref)) {
    return obj as Readonly<T>;
  }

  visited.add(ref);

  if (Object.isFrozen(obj)) {
    return obj as Readonly<T>;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i], visited);
    }
  } else {
    // Use Object.keys to avoid iterating over prototype chain
    for (const key of Object.keys(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key], visited);
    }
  }

  return Object.freeze(obj) as Readonly<T>;
}

/**
 * Deep clone with cycle detection
 */
export function deepClone<T>(value: T, visited = new Map<object, object>()): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  const ref = value as object;

  if (visited.has(ref)) {
    return visited.get(ref) as T;
  }

  if (Array.isArray(value)) {
    const cloned: unknown[] = [];
    visited.set(ref, cloned);
    for (let i = 0; i < value.length; i++) {
      cloned[i] = deepClone(value[i], visited);
    }
    return cloned as T;
  }

  const cloned: Record<string, unknown> = {};
  visited.set(ref, cloned);
  const keys = Object.keys(value);
  for (const key of keys) {
    cloned[key] = deepClone((value as Record<string, unknown>)[key], visited);
  }
  return cloned as T;
}

// ============================================================================
// STRING UTILITIES
// ============================================================================

/**
 * Detect line ending with statistical analysis
 */
export function detectLineEnding(content: string): '\n' | '\r\n' {
  let crlfCount = 0;
  let lfCount = 0;
  const len = content.length;

  for (let i = 0; i < len; i++) {
    const char = content[i];
    if (char === '\n') {
      if (i > 0 && content[i - 1] === '\r') {
        crlfCount++;
      } else {
        lfCount++;
      }
    }
  }

  return crlfCount > lfCount ? '\r\n' : '\n';
}

/**
 * Normalize to LF for consistent processing
 */
export function normalizeToLF(content: string): string {
  let result = '';
  const len = content.length;

  for (let i = 0; i < len; i++) {
    const char = content[i];
    if (char === '\r') {
      if (i + 1 < len && content[i + 1] === '\n') {
        continue; // Skip CR, the LF will be added
      }
      result += '\n'; // Convert lone CR to LF
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Convert to target line ending
 */
export function toLineEnding(content: string, target: '\n' | '\r\n'): string {
  const normalized = normalizeToLF(content);
  if (target === '\r\n') {
    return normalized.replace(/\n/g, '\r\n');
  }
  return normalized;
}

/**
 * Check if string needs YAML quoting
 */
export function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (YAML_RESERVED.has(value)) return true;

  // FIX: Added non-null assertion because value.length === 0 is checked above
  const firstChar = value[0]!;
  if (YAML_SPECIAL_CHARS.has(firstChar)) return true;

  // FIX: Added non-null assertion for consistency and safety
  const lastChar = value[value.length - 1]!;
  if (lastChar === ' ' || lastChar === '\t') return true;
  if (firstChar === ' ' || firstChar === '\t') return true;

  // Check for problematic patterns
  if (value.includes(': ') || value.includes(' #') || value.endsWith(':')) return true;
  if (value.includes('\n') || value.includes('\r')) return true;

  // Numeric-like strings
  if (/^[+-]?\.?\d/.test(value)) return true;
  if (/^0[xXoObB]/.test(value)) return true;

  // Scientific notation
  if (/^[+-]?\d+\.?\d*[eE][+-]?\d+$/.test(value)) return true;

  return false;
}

/**
 * Detect indent size from YAML content
 */
export function detectIndent(content: string): number {
  const lines = content.split('\n');
  const indentCounts = new Map<number, number>();

  for (const line of lines) {
    const match = line.match(/^( +)\S/);
    if (match && match[1]) {
      const indent = match[1].length;
      const currentCount = indentCounts.get(indent) ?? 0;
      indentCounts.set(indent, currentCount + 1);
    }
  }

  // Find most common non-zero indent
  let maxCount = 0;
  let detectedIndent = 2;

  for (const [indent, count] of indentCounts) {
    if (count > maxCount && indent > 0) {
      maxCount = count;
      detectedIndent = indent;
    }
  }

  // GCD of all indents for consistency
  if (indentCounts.size > 1) {
    const indents = [...indentCounts.keys()].filter(i => i > 0);
    if (indents.length > 0) {
      // Safe to access index 0 because length check passed
      let gcd: number = indents[0]!;
      for (let i = 1; i < indents.length; i++) {
        const val = indents[i];
        if (val !== undefined) {
          gcd = computeGCD(gcd, val);
        }
      }
      if (gcd > 0) detectedIndent = gcd;
    }
  }

  return detectedIndent;
}

/**
 * Compute GCD of two numbers
 */
export function computeGCD(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

// ============================================================================
// COMPARISON UTILITIES
// ============================================================================

/**
 * Deep equality with cycle detection and type precision
 */
export function deepEquals(a: unknown, b: unknown, visited = new WeakSet<object>()): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  // Check for same reference
  if (a === b) return true;

  const refA = a as object;
  const refB = b as object;

  if (visited.has(refA) || visited.has(refB)) {
    // Cycle detected - assume equality for this path to avoid infinite recursion
    return true;
  }

  visited.add(refA);
  visited.add(refB);

  try {
    const isArrayA = Array.isArray(a);
    const isArrayB = Array.isArray(b);

    if (isArrayA !== isArrayB) return false;

    if (isArrayA && isArrayB) {
      const arrA = a as unknown[];
      const arrB = b as unknown[];
      if (arrA.length !== arrB.length) return false;
      for (let i = 0; i < arrA.length; i++) {
        if (!deepEquals(arrA[i], arrB[i], visited)) return false;
      }
      return true;
    }

    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
      if (!deepEquals(objA[key], objB[key], visited)) return false;
    }

    return true;
  } finally {
    // We don't remove from visited because we want to catch cycles within the same traversal
    // However, for separate branches that reference the same object, we might want to revisit?
    // Standard deepEquals usually tracks pairs of compared objects.
    // For simplicity and performance in this context, simple cycle breaking is sufficient.
  }
}

/**
 * Create deterministic hash for value comparison
 */
export function computeHash(value: unknown): string {
  const stringify = (v: unknown, visited: WeakSet<object>): string => {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';

    const type = typeof v;
    if (type === 'string') return `s:${v}`;
    if (type === 'number') return `n:${v}`;
    if (type === 'boolean') return `b:${v}`;

    if (type !== 'object') return `?:${String(v)}`;

    const obj = v as object;
    if (visited.has(obj)) return '[Circular]';
    visited.add(obj);

    if (Array.isArray(v)) {
      return `[${v.map(item => stringify(item, visited)).join(',')}]`;
    }

    const record = v as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const pairs = keys.map(k => `${k}:${stringify(record[k], visited)}`);
    return `{${pairs.join(',')}}`;
  };

  return stringify(value, new WeakSet());
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate YAML key with comprehensive checks
 */
export function validateYamlKey(key: string): { valid: boolean; reason?: string } {
  if (typeof key !== 'string') {
    return { valid: false, reason: 'Key must be a string' };
  }

  if (key.length === 0) {
    return { valid: false, reason: 'Key cannot be empty' };
  }

  // Check for null bytes
  if (key.includes('\0')) {
    return { valid: false, reason: 'Key cannot contain null bytes' };
  }

  // Keys are valid in YAML even with special chars (they'll be quoted)
  return { valid: true };
}
