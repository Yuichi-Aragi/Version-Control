import type { FrontmatterOptions, ArrayMergeStrategy, QuoteStyle, LineEndingOption } from './types';

/** Symbol to mark a key for deletion - globally unique */
export const DELETE: unique symbol = Symbol.for('obsidian.frontmatter.delete.v1');

/** Default configuration options */
export const DEFAULT_OPTIONS: Readonly<Required<FrontmatterOptions>> = Object.freeze({
  preserveComments: true,
  preserveBlankLines: true,
  preserveQuoteStyle: true,
  preserveKeyOrder: true,
  preserveAnchors: true,
  preserveCollectionStyle: true,
  preserveScalarStyle: true,
  deepMerge: true,
  arrayMergeStrategy: 'replace' as ArrayMergeStrategy,
  indent: 2,
  // CRITICAL: Default to 0 (no wrapping) to preserve integrity of long lines and complex structures
  lineWidth: 0,
  defaultQuoteStyle: 'plain' as QuoteStyle,
  lineEnding: 'preserve' as LineEndingOption,
  validateKeys: true,
  maxDepth: 100,
  sortKeys: false,
  createIfMissing: true,
  removeIfEmpty: false,
  nullStr: 'null',
  trueStr: 'true',
  falseStr: 'false',
  flowStyle: false,
  multilineThreshold: 40,
  strictMode: false,
});

export const FRONTMATTER_START = '---';
export const FRONTMATTER_END_DASHES = '---';
export const FRONTMATTER_END_DOTS = '...';

// BOM character
export const BOM = '\uFEFF';

// Frontmatter regex patterns
export const FRONTMATTER_REGEX_DASHES = /^(\uFEFF)?---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)---[ \t]*(?:\r?\n|$)/;
export const FRONTMATTER_REGEX_DOTS = /^(\uFEFF)?---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)\.\.\.[ \t]*(?:\r?\n|$)/;
export const FRONTMATTER_EMPTY_DASHES = /^(\uFEFF)?---[ \t]*(?:\r?\n)---[ \t]*(?:\r?\n|$)/;
export const FRONTMATTER_EMPTY_DOTS = /^(\uFEFF)?---[ \t]*(?:\r?\n)\.\.\.[ \t]*(?:\r?\n|$)/;
export const FRONTMATTER_ONLY_COMMENTS = /^(\uFEFF)?---[ \t]*(?:\r?\n)((?:[ \t]*#[^\n]*(?:\r?\n)?)+)---[ \t]*(?:\r?\n|$)/;

// YAML reserved words that need quoting
export const YAML_RESERVED: ReadonlySet<string> = Object.freeze(new Set([
  'true', 'false', 'yes', 'no', 'on', 'off',
  'null', 'nil', '~',
  'TRUE', 'FALSE', 'YES', 'NO', 'ON', 'OFF',
  'NULL', 'NIL',
  'True', 'False', 'Yes', 'No', 'On', 'Off',
  'Null', 'Nil',
  '.nan', '.NaN', '.NAN',
  '.inf', '.Inf', '.INF',
  '-.inf', '-.Inf', '-.INF',
]));

// Characters requiring quoting at string start
export const YAML_SPECIAL_CHARS: ReadonlySet<string> = Object.freeze(new Set([
  '-', '?', ':', ',', '[', ']', '{', '}',
  '#', '&', '*', '!', '|', '>', '\'', '"',
  '%', '@', '`', ' ', '\t',
]));