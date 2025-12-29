import type { TFile } from 'obsidian';
import type { Document } from 'yaml';

// ============================================================================
// PRIMITIVE TYPES
// ============================================================================

/** Primitive frontmatter value types - immutable */
export type FrontmatterPrimitive = string | number | boolean | null;

/** Array frontmatter value - recursive type with readonly for immutability */
export type FrontmatterArray = ReadonlyArray<FrontmatterValue>;

/** Object frontmatter value - recursive type with readonly for immutability */
export type FrontmatterObject = Readonly<{ readonly [key: string]: FrontmatterValue }>;

/** Union type for any valid frontmatter value */
export type FrontmatterValue =
  | FrontmatterPrimitive
  | FrontmatterArray
  | FrontmatterObject;

/** Type alias for the delete marker */
export type DeleteMarker = symbol;

/** Value type for updates - includes primitives, complex types, and delete marker */
export type FrontmatterUpdateValue = FrontmatterValue | DeleteMarker | undefined;

/** Type-safe updates object with string keys and update values */
export type FrontmatterUpdates = Readonly<{
  readonly [key: string]: FrontmatterUpdateValue;
}>;

/** Nested path for deep access operations */
export type FrontmatterPath = string | readonly string[];

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/** Array merge strategy options */
export type ArrayMergeStrategy =
  | 'replace'
  | 'append'
  | 'prepend'
  | 'unique'
  | 'merge-by-index';

/** Line ending options */
export type LineEndingOption = 'lf' | 'crlf' | 'auto' | 'preserve';

/** String quote style options */
export type QuoteStyle = 'plain' | 'single' | 'double' | 'literal' | 'folded';

/** Scalar node type for YAML */
export type ScalarType =
  | 'PLAIN'
  | 'QUOTE_SINGLE'
  | 'QUOTE_DOUBLE'
  | 'BLOCK_LITERAL'
  | 'BLOCK_FOLDED';

/** Collection style for YAML */
export type CollectionStyle = 'block' | 'flow';

/** Frontmatter delimiter type */
export type DelimiterType = 'dashes' | 'dots';

/** Comprehensive options for frontmatter operations */
export interface FrontmatterOptions {
  /** Preserve YAML comments in output (default: true) */
  readonly preserveComments?: boolean;

  /** Preserve blank lines in YAML (default: true) */
  readonly preserveBlankLines?: boolean;

  /** Preserve original quote style for strings (default: true) */
  readonly preserveQuoteStyle?: boolean;

  /** Preserve original key ordering (default: true) */
  readonly preserveKeyOrder?: boolean;

  /** Preserve anchors and aliases (default: true) */
  readonly preserveAnchors?: boolean;

  /** Preserve collection styles (block vs flow) (default: true) */
  readonly preserveCollectionStyle?: boolean;

  /** Deep merge nested objects instead of replacing (default: true) */
  readonly deepMerge?: boolean;

  /** Strategy for merging arrays (default: 'replace') */
  readonly arrayMergeStrategy?: ArrayMergeStrategy;

  /** Number of spaces for indentation (default: 2) */
  readonly indent?: number;

  /** Maximum line width before wrapping (default: 0 for no limit) */
  readonly lineWidth?: number;

  /** Preferred quote style for new strings (default: 'plain') */
  readonly defaultQuoteStyle?: QuoteStyle;

  /** Line ending style (default: 'preserve') */
  readonly lineEnding?: LineEndingOption;

  /** Validate key names are YAML-safe (default: true) */
  readonly validateKeys?: boolean;

  /** Maximum nesting depth to prevent stack overflow (default: 100) */
  readonly maxDepth?: number;

  /** Sort keys alphabetically (default: false) */
  readonly sortKeys?: boolean | ((a: string, b: string) => number);

  /** Create frontmatter if it doesn't exist (default: true) */
  readonly createIfMissing?: boolean;

  /** Remove frontmatter if it becomes empty (default: false) */
  readonly removeIfEmpty?: boolean;

  /** Null string representation (default: 'null') */
  readonly nullStr?: string;

  /** Boolean true string representation (default: 'true') */
  readonly trueStr?: string;

  /** Boolean false string representation (default: 'false') */
  readonly falseStr?: string;

  /** Force flow style for collections (default: false) */
  readonly flowStyle?: boolean;

  /** Minimum line length for multiline strings (default: 40) */
  readonly multilineThreshold?: number;

  /** Use strict YAML 1.2 parsing (default: false) */
  readonly strictMode?: boolean;

  /** Preserve exact scalar formatting (default: true) */
  readonly preserveScalarStyle?: boolean;
}

// ============================================================================
// METADATA & RESULT TYPES
// ============================================================================

/** Frontmatter extraction metadata - comprehensive and immutable */
export interface FrontmatterMetadata {
  readonly exists: boolean;
  readonly raw: string;
  readonly yamlContent: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startDelimiter: string;
  readonly endDelimiter: string;
  readonly endDelimiterType: DelimiterType;
  readonly beforeContent: string;
  readonly afterContent: string;
  readonly lineEnding: '\n' | '\r\n';
  readonly isEmpty: boolean;
  readonly hasComments: boolean;
  readonly hasAnchors: boolean;
  readonly hasAliases: boolean;
  readonly keyCount: number;
  readonly rawLineCount: number;
  readonly hasBom: boolean;
  readonly indentSize: number;
}

/** Result of a frontmatter operation - exhaustive */
export interface FrontmatterOperationResult<T = void> {
  readonly success: boolean;
  readonly changed: boolean;
  readonly data?: T | undefined;
  readonly error?: Error | undefined;
  readonly metadata?: FrontmatterMetadata | undefined;
  readonly diagnostics?: readonly string[] | undefined;
}

/** Batch operation result for multiple files */
export interface BatchOperationResult {
  readonly totalFiles: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly unchangedCount: number;
  readonly results: readonly FrontmatterFileResult[];
}

/** Individual file result in batch operations */
export interface FrontmatterFileResult {
  readonly file: TFile;
  readonly success: boolean;
  readonly changed: boolean;
  readonly error?: Error | undefined;
}

/** Parsed frontmatter structure with document reference */
export interface ParsedFrontmatter {
  readonly data: FrontmatterObject;
  readonly document: Document;
  readonly metadata: FrontmatterMetadata;
}

/** Style information preserved from original nodes */
export interface NodeStyleInfo {
  readonly type: ScalarType | null;
  readonly flow: boolean;
  readonly spaceBefore: boolean;
  readonly commentBefore: string | null;
  readonly comment: string | null;
  readonly anchor: string | null;
}
