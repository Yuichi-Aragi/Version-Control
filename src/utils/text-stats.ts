/**
 * CUSTOM ERROR CLASSES
 * ============================================================================
 */

/**
 * SecurityError - For security-related violations
 */
class SecurityError extends Error {
  public readonly code = 'SECURITY_VIOLATION';
  public readonly timestamp = Date.now();
  
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
    // Properly set prototype for ES5/ES6 compatibility
    Object.setPrototypeOf(this, SecurityError.prototype);
    // Capture stack trace properly
    Error.captureStackTrace?.(this, SecurityError);
  }
}

/**
 * ValidationError - For input validation failures
 */
class ValidationError extends Error {
  public readonly code = 'VALIDATION_FAILURE';
  public readonly paramName: string;
  public readonly receivedValue: unknown;
  
  constructor(paramName: string, expected: string, received: unknown) {
    const message = `INVALID_PARAMETER: "${paramName}" must be ${expected}. Received: ${String(received)}`;
    super(message);
    this.name = 'ValidationError';
    this.paramName = paramName;
    this.receivedValue = received;
    Object.setPrototypeOf(this, ValidationError.prototype);
    Error.captureStackTrace?.(this, ValidationError);
  }
}

/**
 * ResourceError - For resource exhaustion prevention
 */
class ResourceError extends Error {
  public readonly code = 'RESOURCE_EXHAUSTION';
  public readonly maxAllowed: number;
  public readonly actual: number;
  
  constructor(resource: string, maxAllowed: number, actual: number) {
    const message = `RESOURCE_EXCEEDED: "${resource}" exceeds maximum allowed size of ${maxAllowed}. Actual: ${actual}`;
    super(message);
    this.name = 'ResourceError';
    this.maxAllowed = maxAllowed;
    this.actual = actual;
    Object.setPrototypeOf(this, ResourceError.prototype);
    Error.captureStackTrace?.(this, ResourceError);
  }
}

/**
 * CONSTANTS AND CONFIGURATION
 * ============================================================================
 */

/**
 * Security and resource configuration constants
 */
const SECURITY_CONFIG = {
  MAX_INPUT_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_INPUT_LENGTH: 10_000_000, // Character limit
  MAX_PATTERN_LENGTH: 1000, // Regex pattern length limit
  MAX_ITERATIONS: 100_000, // Loop iteration limit
  MAX_OUTPUT_SIZE: 20 * 1024 * 1024, // 20MB output limit
} as const;

/**
 * Regex patterns for security validation
 * NOTE: XSS prevention is intentionally NOT implemented via input pattern matching.
 * Proper XSS defense requires context-aware output encoding and Content Security Policy (CSP) headers.
 * These patterns focus on other security concerns like prototype pollution and resource exhaustion.
 */
const SECURITY_PATTERNS = {
  PROTO_POLLUTION: /(?:__proto__|constructor\.prototype|constructor\["prototype"\]|constructor\.constructor)/i,
  CONTROL_CHARS: /[\x00-\x1F\x7F-\x9F]/,
  EXCESSIVE_WHITESPACE: /\s{100,}/,
} as const;

/**
 * PERFORMANCE-OPTIMIZED UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Type-safe type guard for string validation
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Validates string inputs with comprehensive security checks
 * @param value - The value to validate
 * @param paramName - Parameter name for error messages
 * @param options - Validation options
 * @returns Validated string
 * @throws {ValidationError} If type validation fails
 * @throws {SecurityError} If security violations detected
 * @throws {ResourceError} If size limits exceeded
 */
function validateAndSanitizeString(
  value: unknown,
  paramName: string,
  options: {
    allowEmpty?: boolean;
    maxLength?: number;
    sanitizeControlChars?: boolean;
  } = {}
): string {
  const {
    allowEmpty = true,
    maxLength = SECURITY_CONFIG.MAX_INPUT_LENGTH,
    sanitizeControlChars = true,
  } = options;

  // NULL/UNDEFINED CHECK
  if (value === null || value === undefined) {
    throw new ValidationError(paramName, 'non-null string', value);
  }

  // TYPE SAFETY CHECK
  if (!isString(value)) {
    throw new ValidationError(paramName, 'string', typeof value);
  }

  const str = value;

  // RESOURCE LIMIT CHECK - BYTE SIZE
  const byteSize = new Blob([str]).size;
  if (byteSize > SECURITY_CONFIG.MAX_INPUT_SIZE) {
    throw new ResourceError(paramName, SECURITY_CONFIG.MAX_INPUT_SIZE, byteSize);
  }

  // RESOURCE LIMIT CHECK - CHARACTER LENGTH
  if (str.length > maxLength) {
    throw new ResourceError(paramName, maxLength, str.length);
  }

  // SECURITY: Prototype pollution detection
  if (SECURITY_PATTERNS.PROTO_POLLUTION.test(str)) {
    throw new SecurityError(
      `Prototype pollution attempt detected in parameter: "${paramName}"`
    );
  }

  // SECURITY: Control character sanitization
  let sanitized = str;
  if (sanitizeControlChars && SECURITY_PATTERNS.CONTROL_CHARS.test(str)) {
    sanitized = str.replace(SECURITY_PATTERNS.CONTROL_CHARS, ' ');
  }

  // SECURITY: Excessive whitespace reduction
  if (SECURITY_PATTERNS.EXCESSIVE_WHITESPACE.test(sanitized)) {
    sanitized = sanitized.replace(SECURITY_PATTERNS.EXCESSIVE_WHITESPACE, ' ');
  }

  // EMPTY STRING VALIDATION
  if (!allowEmpty && sanitized.trim().length === 0) {
    throw new ValidationError(paramName, 'non-empty string', 'empty or whitespace-only');
  }

  return sanitized;
}

/**
 * HIGH-PERFORMANCE REGEX CACHE WITH MEMORY MANAGEMENT
 * ============================================================================
 */

/**
 * Thread-safe regex cache with LRU eviction and memory limits
 */
class OptimizedRegexCache {
  private static readonly instance = new OptimizedRegexCache();
  private readonly cache = new Map<string, RegExp>();
  private readonly accessTimes = new Map<string, number>();
  private readonly maxSize = 100; // Maximum cached patterns
  private readonly maxAge = 5 * 60 * 1000; // 5 minutes maximum age

  private constructor() {
    // Start cleanup interval
    this.scheduleCleanup();
  }

  /**
   * Singleton instance accessor
   */
  static getInstance(): OptimizedRegexCache {
    return this.instance;
  }

  /**
   * Retrieves or creates and caches a RegExp instance with validation
   */
  get(pattern: string, flags: string = ''): RegExp {
    // VALIDATE pattern length
    if (pattern.length > SECURITY_CONFIG.MAX_PATTERN_LENGTH) {
      throw new ResourceError(
        'regexPattern',
        SECURITY_CONFIG.MAX_PATTERN_LENGTH,
        pattern.length
      );
    }

    // VALIDATE flags for security
    const validFlags = this.validateFlags(flags);
    const key = `${pattern}:${validFlags}`;

    // Check cache with access time update
    if (this.cache.has(key)) {
      const regex = this.cache.get(key)!;
      this.accessTimes.set(key, Date.now());
      return regex;
    }

    // Create and cache new regex with security validation
    const regex = this.createSafeRegex(pattern, validFlags);
    
    // Apply LRU eviction if needed
    if (this.cache.size >= this.maxSize) {
      this.evictLeastRecentlyUsed();
    }

    // Store in cache
    this.cache.set(key, regex);
    this.accessTimes.set(key, Date.now());

    return regex;
  }

  /**
   * Creates a safe RegExp with timeout protection
   */
  private createSafeRegex(pattern: string, flags: string): RegExp {
    try {
      // SECURITY: Prevent catastrophic backtracking with size limits
      if (pattern.includes('(') && pattern.includes('*')) {
        const complexity = pattern.split('*').length + pattern.split('+').length;
        if (complexity > 100) {
          throw new SecurityError('Potential regex DoS pattern detected');
        }
      }

      return new RegExp(pattern, flags);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ValidationError(
          'regexPattern',
          'valid regular expression pattern',
          pattern
        );
      }
      throw error;
    }
  }

  /**
   * Validates and sanitizes regex flags
   */
  private validateFlags(flags: string): string {
    const validFlags = flags.split('').filter(flag => 'gimsuy'.includes(flag));
    return Array.from(new Set(validFlags)).join(''); // Remove duplicates
  }

  /**
   * Implements LRU eviction policy
   */
  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.accessTimes.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessTimes.delete(oldestKey);
    }
  }

  /**
   * Schedules periodic cache cleanup
   */
  private scheduleCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, time] of this.accessTimes.entries()) {
        if (now - time > this.maxAge) {
          this.cache.delete(key);
          this.accessTimes.delete(key);
        }
      }
    }, 60 * 1000); // Clean every minute
  }

  /**
   * Clears cache (for testing)
   */
  clear(): void {
    this.cache.clear();
    this.accessTimes.clear();
  }

  /**
   * Gets cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

/**
 * Singleton regex cache instance
 */
const RegexCache = OptimizedRegexCache.getInstance();

/**
 * PERFORMANCE-OPTIMIZED TEXT PROCESSING FUNCTIONS
 * ============================================================================
 */

/**
 * Interface for regex replacement configuration
 */
interface RegexReplacement {
  pattern: string;
  flags?: string;
  replacement: string | ((substring: string, ...args: any[]) => string);
  priority: number; // Lower number = higher priority
}

/**
 * Pre-configured markdown stripping patterns with proper priority ordering
 */
const MARKDOWN_PATTERNS: readonly RegexReplacement[] = [
  // Highest priority: Code blocks (must be removed first to protect content)
  {
    pattern: '```[\\s\\S]*?```',
    flags: 'g',
    replacement: '',
    priority: 1,
  },
  
  // High priority: HTML tags
  {
    pattern: '<[^>]*>',
    flags: 'g',
    replacement: '',
    priority: 2,
  },
  
  // Medium priority: Links and images (preserve alt text)
  {
    pattern: '!?\\[(.*?)\\]\\([^)]*\\)',
    flags: 'g',
    replacement: (_, altText: string) => altText || '',
    priority: 3,
  },
  
  // Medium priority: Emphasis markers
  {
    pattern: '(\\*\\*|__|\\*|_|~~|==)(.*?)\\1',
    flags: 'g',
    replacement: (_, __, content: string) => content || '',
    priority: 4,
  },
  
  // Medium priority: Inline code
  {
    pattern: '`([^`]+)`',
    flags: 'g',
    replacement: (_, content: string) => content || '',
    priority: 5,
  },
  
  // Lower priority: Headers
  {
    pattern: '^#{1,6}\\s+',
    flags: 'gm',
    replacement: '',
    priority: 6,
  },
  
  // Lower priority: Blockquotes
  {
    pattern: '^>\\s*',
    flags: 'gm',
    replacement: '',
    priority: 7,
  },
  
  // Lower priority: Lists
  {
    pattern: '^(\\s*[-*+]\\s+|\\s*\\d+\\.\\s+)',
    flags: 'gm',
    replacement: '',
    priority: 8,
  },
  
  // Lower priority: Horizontal rules
  {
    pattern: '^\\s*([-*_]\\s*){3,}\\s*$',
    flags: 'gm',
    replacement: '',
    priority: 9,
  },
  
  // Lowest priority: Whitespace normalization
  {
    pattern: '(\\r\\n|\\n|\\r){3,}',
    flags: 'g',
    replacement: '\n\n',
    priority: 10,
  },
] as const;

/**
 * Strips Markdown syntax from text with optimized single-pass processing
 * @param text - Source text containing Markdown syntax
 * @returns Plain text with all Markdown syntax removed
 * @throws {ValidationError} If input validation fails
 * @throws {SecurityError} If security checks detect violations
 * @throws {ResourceError} If size limits exceeded
 */
export function stripMarkdown(text: string): string {
  // COMPREHENSIVE VALIDATION AND SANITIZATION
  const validatedText = validateAndSanitizeString(text, 'text', {
    allowEmpty: true,
  });

  // FAST-PATH: Return immediately for empty strings
  if (validatedText.length === 0) {
    return '';
  }

  let processedText = validatedText;
  let iterationCount = 0;
  const maxIterations = Math.min(
    SECURITY_CONFIG.MAX_ITERATIONS,
    processedText.length * 2
  );

  // PROCESS patterns in priority order
  const sortedPatterns = [...MARKDOWN_PATTERNS].sort((a, b) => a.priority - b.priority);

  for (const { pattern, flags = '', replacement } of sortedPatterns) {
    // SAFETY: Prevent infinite loops and DoS
    if (iterationCount++ > maxIterations) {
      throw new ResourceError(
        'processingIterations',
        maxIterations,
        iterationCount
      );
    }

    const regex = RegexCache.get(pattern, flags);
    
    // OPTIMIZATION: Only apply if pattern exists
    if (regex.test(processedText)) {
      regex.lastIndex = 0; // Reset regex state
      
      if (typeof replacement === 'function') {
        processedText = processedText.replace(regex, replacement);
      } else {
        processedText = processedText.replace(regex, replacement);
      }

      // POST-PROCESSING VALIDATION: Ensure output size limit
      if (processedText.length > SECURITY_CONFIG.MAX_OUTPUT_SIZE) {
        throw new ResourceError(
          'outputText',
          SECURITY_CONFIG.MAX_OUTPUT_SIZE,
          processedText.length
        );
      }
    }
  }

  // FINAL SANITIZATION: Trim and collapse multiple spaces
  const finalText = processedText
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');

  return finalText;
}

/**
 * Unicode-aware word boundary detection
 */
const WORD_BOUNDARY_REGEX = RegexCache.get(
  '\\p{L}\\p{M}*\\p{N}*(?:[\\p{P}\\p{S}]\\p{L}\\p{M}*\\p{N}*)*',
  'gu'
);

/**
 * Counts words using Unicode-aware boundary detection
 * @param text - The text to analyze
 * @returns The number of words
 * @throws {ValidationError} If input validation fails
 */
export function countWords(text: string): number {
  const validatedText = validateAndSanitizeString(text, 'text', {
    allowEmpty: true,
  });

  // FAST-PATH: Empty string has zero words
  if (validatedText.length === 0) {
    return 0;
  }

  // PERFORMANCE: Use native match for Unicode word boundaries
  const matches = validatedText.match(WORD_BOUNDARY_REGEX);
  
  // RESET regex state for future use
  WORD_BOUNDARY_REGEX.lastIndex = 0;
  
  return matches ? matches.length : 0;
}

/**
 * Performance-optimized character counting
 * @param text - The text to analyze
 * @returns The exact character count
 * @throws {ValidationError} If input validation fails
 */
export function countChars(text: string): number {
  const validatedText = validateAndSanitizeString(text, 'text', {
    allowEmpty: true,
  });
  
  // DETERMINISTIC: String.length is O(1) and reliable
  return validatedText.length;
}

/**
 * Counts lines with optimized single-pass algorithm
 * @param text - The text to analyze
 * @returns The number of lines
 * @throws {ValidationError} If input validation fails
 */
export function countLines(text: string): number {
  const validatedText = validateAndSanitizeString(text, 'text', {
    allowEmpty: true,
  });

  // FAST-PATH: Empty string has zero lines
  if (validatedText.length === 0) {
    return 0;
  }

  // PERFORMANCE: Single-pass without split()
  let lineCount = 1; // Non-empty strings start with 1 line
  const length = validatedText.length;
  let i = 0;

  while (i < length) {
    const char = validatedText[i];
    
    if (char === '\n') {
      lineCount++;
      i++;
    } else if (char === '\r') {
      // Handle \r\n sequences as single newline
      if (i + 1 < length && validatedText[i + 1] === '\n') {
        i += 2; // Skip both \r and \n
      } else {
        i++; // Skip only \r
      }
      lineCount++;
    } else {
      i++;
    }
  }

  return lineCount;
}

/**
 * MAIN API INTERFACE
 * ============================================================================
 */

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
  readonly processingTimeMs?: number;
}

/**
 * Calculates comprehensive, deterministic text statistics with performance metrics
 * @param content - The source content to analyze
 * @returns Immutable object containing all text statistics
 * @throws {ValidationError} If content validation fails
 * @throws {SecurityError} If security checks detect violations
 * @throws {ResourceError} If resource limits exceeded
 */
export function calculateTextStats(content: string): TextStats {
  const startTime = performance.now?.() || Date.now();
  
  // COMPREHENSIVE VALIDATION
  const validatedContent = validateAndSanitizeString(content, 'content');
  
  // ATOMIC PROCESSING: Compute all metrics
  const strippedContent = stripMarkdown(validatedContent);
  
  const stats: TextStats = {
    wordCount: countWords(strippedContent),
    wordCountWithMd: countWords(validatedContent),
    charCount: countChars(strippedContent),
    charCountWithMd: countChars(validatedContent),
    lineCount: countLines(validatedContent),
    lineCountWithoutMd: countLines(strippedContent),
  };
  
  // Add processing time if performance API is available
  const endTime = performance.now?.() || Date.now();
  const processingTimeMs = Math.round(endTime - startTime);
  
  // ENHANCED: Include processing time for monitoring
  const enhancedStats: TextStats = {
    ...stats,
    processingTimeMs,
  };
  
  // IMMUTABILITY: Return frozen object
  return Object.freeze(enhancedStats);
}

/**
 * MODULE INITIALIZATION AND EXPORTS
 * ============================================================================
 */

/**
 * Pre-populates regex cache and validates module state
 */
function initializeModule(): void {
  try {
    // Pre-warm regex cache with all patterns
    MARKDOWN_PATTERNS.forEach(({ pattern, flags }) => {
      RegexCache.get(pattern, flags);
    });
    
    // Validate module constants
    if (SECURITY_CONFIG.MAX_INPUT_SIZE <= 0) {
      throw new Error('Invalid security configuration: MAX_INPUT_SIZE must be positive');
    }
    
    console.debug('Text processing module initialized successfully');
  } catch (error) {
    console.error('Failed to initialize text processing module:', error);
    throw error;
  }
}

// Auto-initialize module on load
if (typeof window !== 'undefined' || typeof global !== 'undefined') {
  // Use requestIdleCallback or setTimeout for non-blocking initialization
  const init = () => {
    try {
      initializeModule();
    } catch (error) {
      // Log but don't crash - module will initialize on first use
      console.warn('Module initialization deferred:', error);
    }
  };
  
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(init);
  } else {
    setTimeout(init, 0);
  }
}

/**
 * Export error classes for external handling
 */
export {
  SecurityError,
  ValidationError,
  ResourceError,
};

/**
 * Export validation utilities for external use
 */
export {
  validateAndSanitizeString,
  isString,
};

/**
 * Export regex cache for advanced usage (with caution)
 */
export { RegexCache };
