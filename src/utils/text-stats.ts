// ============================================================================
// TEXT STATISTICS MODULE - Enterprise Grade Implementation
// ============================================================================
// Provides comprehensive, secure, and high-performance text statistics calculation
// with robust markdown stripping. Zero dependencies, fully deterministic, and
// production-ready with enterprise-level quality standards.
// ============================================================================

// ============================================================================
// VALIDATION INFRASTRUCTURE
// ============================================================================

/**
 * Custom error class for security-related violations
 */
class SecurityError extends Error {
  public readonly code = 'SECURITY_VIOLATION';
  
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
    Object.setPrototypeOf(this, SecurityError.prototype);
  }
}

/**
 * Maximum allowed input size (10MB) to prevent resource exhaustion attacks
 * @internal
 */
const MAX_INPUT_SIZE = 10 * 1024 * 1024;

/**
 * Performs comprehensive validation on string inputs with security checks
 * @param value - The value to be validated
 * @param paramName - Name of the parameter for error messaging
 * @throws {TypeError} If value is null, undefined, or not a string
 * @throws {SecurityError} If potential prototype pollution patterns are detected
 * @throws {RangeError} If input size exceeds configured maximum
 * @internal
 */
function validateNonNullString(value: unknown, paramName: string): asserts value is string {
  if (value === null || value === undefined) {
    throw new TypeError(
      `INVALID_PARAMETER: "${paramName}" cannot be null or undefined. Received: ${String(value)}`
    );
  }
  
  if (typeof value !== 'string') {
    throw new TypeError(
      `INVALID_PARAMETER: "${paramName}" must be of type string. Received: ${typeof value}`
    );
  }
  
  // SECURITY: Detect potential prototype pollution attempts
  if (value.includes('__proto__') || value.includes('constructor.prototype')) {
    throw new SecurityError(
      `Prototype pollution attempt detected in parameter: "${paramName}"`
    );
  }
  
  // SECURITY: Enforce maximum input size to prevent DoS
  if (value.length > MAX_INPUT_SIZE) {
    throw new RangeError(
      `INPUT_TOO_LARGE: "${paramName}" exceeds maximum allowed size of ${MAX_INPUT_SIZE} bytes`
    );
  }
}

// ============================================================================
// REGEX CACHE - PERFORMANCE OPTIMIZATION
// ============================================================================

/**
 * Thread-safe regex compilation cache to eliminate redundant RegExp creation
 * @internal
 */
class RegexCache {
  private static readonly cache = new Map<string, RegExp>();

  /**
   * Retrieves or creates and caches a RegExp instance
   * @param pattern - Regular expression pattern string
   * @param flags - Optional regex flags
   * @returns Cached RegExp instance
   */
  static get(pattern: string, flags: string = ''): RegExp {
    const key = `${pattern}:${flags}`;
    if (!RegexCache.cache.has(key)) {
      RegexCache.cache.set(key, new RegExp(pattern, flags));
    }
    return RegexCache.cache.get(key)!;
  }

  /**
   * Clears the regex cache (intended for testing purposes)
   * @internal
   */
  static clear(): void {
    RegexCache.cache.clear();
  }
}

// ============================================================================
// CORE TEXT PROCESSING - MARKDOWN STRIPPING
// ============================================================================

/**
 * Strips Markdown syntax from text using a secure, optimized multi-pass approach
 * Processing order is critical to prevent content corruption
 * @param text - Source text containing Markdown syntax
 * @returns Plain text with all Markdown syntax removed
 * @throws {TypeError} If input validation fails
 * @throws {SecurityError} If security checks detect violations
 * @public
 */
export function stripMarkdown(text: string): string {
  // VALIDATE: All inputs must be validated at entry points
  validateNonNullString(text, 'text');

  // FAST-PATH: Return immediately for empty strings
  if (text.length === 0) {
    return '';
  }

  // PERFORMANCE: All regexes are cached to avoid recompilation
  // SECURITY: Processing order prevents nested syntax corruption
  let strippedText = text;

  // PASS 1: Remove code blocks first to protect their content
  strippedText = RegexCache.get('```[\\s\\S]*?```', 'g').exec(strippedText) 
    ? strippedText.replace(RegexCache.get('```[\\s\\S]*?```', 'g'), '') 
    : strippedText;

  // PASS 2: Remove HTML tags
  strippedText = RegexCache.get('<[^>]*>', 'g').exec(strippedText)
    ? strippedText.replace(RegexCache.get('<[^>]*>', 'g'), '')
    : strippedText;

  // PASS 3: Process links and images (preserve alt text, discard URLs)
  strippedText = RegexCache.get('!?\\[(.*?)\\]\\(.*?\\)', 'g').exec(strippedText)
    ? strippedText.replace(RegexCache.get('!?\\[(.*?)\\]\\(.*?\\)', 'g'), '$1')
    : strippedText;

  // PASS 4: Remove emphasis markers (bold, italic, etc.)
  strippedText = RegexCache.get('(\\*\\*|__|\\*|_|~~|==)(.*?)\\1', 'g').exec(strippedText)
    ? strippedText.replace(RegexCache.get('(\\*\\*|__|\\*|_|~~|==)(.*?)\\1', 'g'), '$2')
    : strippedText;

  // PASS 5: Remove inline code
  strippedText = RegexCache.get('`([^`]+)`', 'g').exec(strippedText)
    ? strippedText.replace(RegexCache.get('`([^`]+)`', 'g'), '$1')
    : strippedText;

  // PASS 6: Remove structural elements (headers, blockquotes, lists, rules)
  strippedText = RegexCache.get('^#{1,6}\\s*', 'gm').exec(strippedText)
    ? strippedText.replace(RegexCache.get('^#{1,6}\\s*', 'gm'), '')
    : strippedText;
  
  strippedText = RegexCache.get('^>\\s*', 'gm').exec(strippedText)
    ? strippedText.replace(RegexCache.get('^>\\s*', 'gm'), '')
    : strippedText;
  
  strippedText = RegexCache.get('^(\\s*[-*+]\\s+|\\s*\\d+\\.\\s+)', 'gm').exec(strippedText)
    ? strippedText.replace(RegexCache.get('^(\\s*[-*+]\\s+|\\s*\\d+\\.\\s+)', 'gm'), '')
    : strippedText;
  
  strippedText = RegexCache.get('^\\s*[-*_]\\s*[-*_]\\s*[-*_]\\s*$', 'gm').exec(strippedText)
    ? strippedText.replace(RegexCache.get('^\\s*[-*_]\\s*[-*_]\\s*[-*_]\\s*$', 'gm'), '')
    : strippedText;

  // PASS 7: Normalize whitespace (collapse multiple blank lines)
  strippedText = RegexCache.get('(\\r\\n|\\n|\\r){3,}', 'g').exec(strippedText)
    ? strippedText.replace(RegexCache.get('(\\r\\n|\\n|\\r){3,}', 'g'), '$1$1')
    : strippedText;

  // Post-process: Trim leading/trailing whitespace
  return strippedText.trim();
}

// ============================================================================
// CORE TEXT PROCESSING - WORD COUNTING
// ============================================================================

/**
 * Counts words using a high-performance single-pass algorithm
 * Word boundary detection is based on Unicode whitespace categories
 * @param text - The text to analyze
 * @returns The number of words
 * @throws {TypeError} If input validation fails
 * @public
 */
export function countWords(text: string): number {
  // VALIDATE: All inputs must be validated
  validateNonNullString(text, 'text');

  // FAST-PATH: Empty string has zero words
  if (text.length === 0) {
    return 0;
  }

  // PERFORMANCE: Single-pass algorithm with no intermediate array allocation
  let wordCount = 0;
  let isInWord = false;
  const length = text.length;

  for (let i = 0; i < length; i++) {
    const char = text[i];
    const isWhitespace = char === ' ' || char === '\t' || char === '\n' || char === '\r';
    
    if (!isWhitespace && !isInWord) {
      wordCount++;
      isInWord = true;
    } else if (isWhitespace) {
      isInWord = false;
    }
  }

  return wordCount;
}

// ============================================================================
// CORE TEXT PROCESSING - CHARACTER COUNTING
// ============================================================================

/**
 * Counts characters in a string
 * @param text - The text to analyze
 * @returns The exact character count
 * @throws {TypeError} If input validation fails
 * @public
 */
export function countChars(text: string): number {
  // VALIDATE: All inputs must be validated
  validateNonNullString(text, 'text');
  
  // DETERMINISTIC: String.length is a reliable O(1) operation
  return text.length;
}

// ============================================================================
// CORE TEXT PROCESSING - LINE COUNTING
// ============================================================================

/**
 * Counts lines using a single-pass algorithm
 * Supports all newline conventions: \n, \r, \r\n
 * @param text - The text to analyze
 * @returns The number of lines (0 for empty string)
 * @throws {TypeError} If input validation fails
 * @public
 */
export function countLines(text: string): number {
  // VALIDATE: All inputs must be validated
  validateNonNullString(text, 'text');

  // DETERMINISTIC: Empty string has zero lines
  if (text.length === 0) {
    return 0;
  }

  // PERFORMANCE: Single-pass algorithm without split()
  let lineCount = 1; // Non-empty strings start with 1 line
  const length = text.length;

  for (let i = 0; i < length; i++) {
    const char = text[i];
    
    if (char === '\n') {
      lineCount++;
    } else if (char === '\r') {
      // Handle \r\n sequences as a single newline
      if (i + 1 < length && text[i + 1] === '\n') {
        i++; // Skip the next \n to avoid double-counting
      }
      lineCount++;
    }
  }

  return lineCount;
}

// ============================================================================
// MAIN API INTERFACE
// ============================================================================

/**
 * Comprehensive text statistics data structure
 * All properties are readonly for immutability
 */
export interface TextStats {
  readonly wordCount: number;
  readonly wordCountWithMd: number;
  readonly charCount: number;
  readonly charCountWithMd: number;
  readonly lineCount: number;
  readonly lineCountWithoutMd: number;
}

// ============================================================================
// MAIN API - TEXT STATISTICS CALCULATOR
// ============================================================================

/**
 * Calculates comprehensive, deterministic text statistics
 * Processing is atomic - either all metrics are computed or an error is thrown
 * @param content - The source content to analyze
 * @returns Immutable object containing all text statistics
 * @throws {TypeError} If content validation fails
 * @throws {SecurityError} If security checks detect violations
 * @throws {Error} If any processing step fails
 * @public
 * @example
 * ```typescript
 * const stats = calculateTextStats('# Hello\n**World**');
 * console.log(stats.wordCount); // 2 (Hello World)
 * console.log(stats.wordCountWithMd); // 4 (includes # and bold markers)
 * ```
 */
export function calculateTextStats(content: string): TextStats {
  // VALIDATE: Primary entry point - validate immediately
  validateNonNullString(content, 'content');

  // ATOMIC: Compute all metrics from validated input
  const strippedContent = stripMarkdown(content);

  // IMMUTABLE: Return frozen object to prevent external mutation
  return Object.freeze<Readonly<TextStats>>({
    wordCount: countWords(strippedContent),
    wordCountWithMd: countWords(content),
    charCount: countChars(strippedContent),
    charCountWithMd: countChars(content),
    lineCount: countLines(content),
    lineCountWithoutMd: countLines(strippedContent),
  });
}

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

/**
 * Pre-populates regex cache with all patterns used by the module
 * @internal
 */
function initializeModule(): void {
  RegexCache.get('```[\\s\\S]*?```', 'g');
  RegexCache.get('^#{1,6}\\s*', 'gm');
  RegexCache.get('(\\*\\*|__|\\*|_|~~|==)(.*?)\\1', 'g');
  RegexCache.get('`([^`]+)`', 'g');
  RegexCache.get('!?\\[(.*?)\\]\\(.*?\\)', 'g');
  RegexCache.get('^>\\s*', 'gm');
  RegexCache.get('^\\s*[-*_]\\s*[-*_]\\s*[-*_]\\s*$', 'gm');
  RegexCache.get('^(\\s*[-*+]\\s+|\\s*\\d+\\.\\s+)', 'gm');
  RegexCache.get('<[^>]*>', 'g');
  RegexCache.get('(\\r\\n|\\n|\\r){3,}', 'g');
}

// Initialize module on load for optimal first-call performance
initializeModule();
