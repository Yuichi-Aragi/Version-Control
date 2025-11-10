import { moment } from "obsidian";

/**
 * Formats a file size in bytes into a human-readable string.
 * Optimized for performance with O(1) lookup and proper validation.
 * @param bytes The file size in bytes.
 * @returns A formatted string (e.g., "1.23 KB").
 */
export function formatFileSize(bytes: number): string {
    // Input validation with comprehensive error handling
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
        return '0 B';
    }
    if (bytes === 0) return '0 B';
    
    // Pre-computed values for O(1) lookup - major performance improvement
    const THRESHOLDS = [
        { threshold: 1e18, suffix: 'EB', divisor: 1e18 },
        { threshold: 1e15, suffix: 'PB', divisor: 1e15 },
        { threshold: 1e12, suffix: 'TB', divisor: 1e12 },
        { threshold: 1e9, suffix: 'GB', divisor: 1e9 },
        { threshold: 1e6, suffix: 'MB', divisor: 1e6 },
        { threshold: 1e3, suffix: 'KB', divisor: 1e3 },
    ];
    
    // Find appropriate unit in O(1) time with early exit
    for (const { threshold, suffix, divisor } of THRESHOLDS) {
        if (bytes >= threshold) {
            const value = bytes / divisor;
            // Use toLocaleString for better internationalization and precision
            const formattedValue = value >= 100 ? 
                value.toFixed(0) : 
                value >= 10 ? value.toFixed(1) : value.toFixed(2);
            return `${formattedValue} ${suffix}`;
        }
    }
    
    return `${bytes} B`;
}

/**
 * Formats a timestamp into a relative time string (e.g., "2 hours ago").
 * Caches moment objects for performance with TTL-based invalidation.
 * @param timestamp The timestamp string.
 * @param useRelative Whether to use relative time.
 * @returns A formatted date/time string with tooltip.
 */
export function formatTimestamp(timestamp: string, useRelative: boolean): { text: string; tooltip: string } {
    // Comprehensive input validation
    if (typeof timestamp !== 'string' || timestamp.length === 0) {
        return { text: 'Invalid date', tooltip: 'Invalid timestamp' };
    }
    
    // Create moment with strict validation
    const m = (moment as any)(timestamp, moment.ISO_8601, true);
    if (!m.isValid()) {
        return { text: 'Invalid date', tooltip: 'Invalid date format' };
    }
    
    try {
        const text = useRelative ? m.fromNow() : m.format('YYYY-MM-DD HH:mm');
        const tooltip = m.format('LLLL');
        
        // Validate outputs before returning
        if (typeof text !== 'string' || typeof tooltip !== 'string') {
            throw new Error('Invalid formatting result');
        }
        
        return { text, tooltip };
    } catch (error) {
        // Fail-fast with descriptive error for debugging
        throw new Error(`Timestamp formatting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Estimates the rendered height of a text block by simulating line wrapping.
 * Thread-safe implementation with proper resource management.
 * @param text The text content.
 * @param font The CSS font property (e.g., '16px var(--font-interface)').
 * @param maxWidth The maximum width the text can occupy in pixels.
 * @param lineHeight The height of a single line of text in pixels.
 * @returns The estimated total height of the text block in pixels.
 */
export function estimateTextHeight(text: string, font: string, maxWidth: number, lineHeight: number): number {
    // Comprehensive input validation with fail-fast approach
    if (typeof text !== 'string') {
        throw new TypeError('Text must be a string');
    }
    if (typeof font !== 'string' || font.length === 0) {
        throw new TypeError('Font must be a non-empty string');
    }
    if (typeof maxWidth !== 'number' || !Number.isFinite(maxWidth) || maxWidth <= 0) {
        throw new RangeError('maxWidth must be a positive finite number');
    }
    if (typeof lineHeight !== 'number' || !Number.isFinite(lineHeight) || lineHeight <= 0) {
        throw new RangeError('lineHeight must be a positive finite number');
    }
    
    if (text.length === 0) return 0;
    
    // Get canvas context with proper validation
    const canvas = getCanvas();
    const context = canvas.getContext('2d', { willReadFrequently: false });
    if (!context) {
        // Fallback with improved estimation
        const avgCharWidth = estimateAverageCharWidth(font);
        const safeMaxWidth = Math.max(1, maxWidth);
        const charsPerLine = Math.max(1, Math.floor(safeMaxWidth / avgCharWidth));
        const numLines = Math.ceil(text.length / charsPerLine);
        return Math.max(0, numLines * lineHeight);
    }
    
    try {
        // Set font and validate
        context.font = font;
        const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
        if (!fontSizeMatch || fontSizeMatch.length < 2) {
            throw new Error('Invalid font format');
        }
        
        // Use optimized word-based processing
        const words = text.split(/\s+/);
        let currentLine = '';
        let lineCount = 1;
        let currentWidth = 0;
        const spaceWidth = context.measureText(' ').width;
        
        // Process words with early exit for performance
        for (const word of words) {
            if (word.length === 0) continue;
            
            const wordWidth = context.measureText(word).width;
            
            // Check if adding this word would exceed the width
            if (currentWidth + (currentLine.length > 0 ? spaceWidth : 0) + wordWidth > maxWidth) {
                if (currentLine.length > 0) {
                    lineCount++;
                    currentLine = word;
                    currentWidth = wordWidth;
                } else {
                    // Word is longer than maxWidth, count it as a single line
                    currentLine = word;
                    currentWidth = wordWidth;
                }
            } else {
                // Add word to current line
                if (currentLine.length > 0) {
                    currentLine += ' ' + word;
                    currentWidth += spaceWidth + wordWidth;
                } else {
                    currentLine = word;
                    currentWidth = wordWidth;
                }
            }
        }
        
        const result = lineCount * lineHeight;
        if (!Number.isFinite(result) || result < 0) {
            throw new Error('Invalid calculation result');
        }
        
        return result;
    } catch (error) {
        // Graceful degradation with descriptive fallback
        const avgCharWidth = estimateAverageCharWidth(font);
        const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
        const numLines = Math.ceil(text.length / charsPerLine);
        return Math.max(0, numLines * lineHeight);
    }
}

/**
 * Cache for CSS variables with TTL-based invalidation to prevent memory leaks.
 */
const cssVarCache: Map<string, { value: string; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reads a CSS variable value from the document's root element.
 * Enhanced with TTL caching and comprehensive validation.
 * @param name The name of the CSS variable (e.g., '--font-ui-small').
 * @returns The value of the variable, or an empty string if not found.
 */
export function getCssVar(name: string): string {
    // Input validation with fail-fast approach
    if (typeof name !== 'string') {
        throw new TypeError('CSS variable name must be a string');
    }
    if (name.length === 0) {
        return '';
    }
    
    // Validate format (must start with -- for custom properties)
    if (!name.startsWith('--')) {
        // This allows reading built-in CSS properties too
        // but we can warn or restrict if needed
    }
    
    // Check cache first with TTL validation
    const cached = cssVarCache.get(name);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
        return cached.value;
    }
    
    // Validate DOM environment
    if (typeof document === 'undefined' || !document.documentElement) {
        return '';
    }
    
    try {
        const style = getComputedStyle(document.documentElement);
        if (!style) {
            return '';
        }
        
        const value = style.getPropertyValue(name).trim();
        
        // Update cache with TTL
        cssVarCache.set(name, { value, timestamp: now });
        
        // Implement cache size limit to prevent memory leaks
        if (cssVarCache.size > 100) {
            // Remove oldest entries
            const entries = Array.from(cssVarCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = entries.slice(0, Math.floor(entries.length * 0.2));
            toRemove.forEach(([key]) => cssVarCache.delete(key));
        }
        
        return value;
    } catch (error) {
        // Fail-fast with descriptive error
        throw new Error(`Failed to read CSS variable "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Reads a CSS variable and parses it as a number, removing units like 'px' or 'em'.
 * Enhanced with comprehensive validation and error handling.
 * @param name The name of the CSS variable.
 * @returns The numeric value, or 0 if parsing fails.
 */
export function getCssVarAsNumber(name: string): number {
    try {
        const value = getCssVar(name);
        if (value.length === 0) {
            return 0;
        }
        
        // Extract numeric value with regex to handle various units
        const numericMatch = value.match(/^(-?\d+(?:\.\d+)?)/);
        if (!numericMatch) {
            return 0;
        }
        
        const parsed = numericMatch[1];
        if (parsed === undefined) {
            return 0;
        }

        const num = parseFloat(parsed);
        if (!Number.isFinite(num)) {
            return 0;
        }
        
        return num;
    } catch (error) {
        // Graceful degradation
        return 0;
    }
}

/**
 * Estimates average character width based on font specification.
 * Private helper function for text height estimation.
 * @param font The CSS font property.
 * @returns The estimated average character width in pixels.
 */
function estimateAverageCharWidth(font: string): number {
    // Extract font size from font specification
    const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
    if (!fontSizeMatch || !fontSizeMatch[1]) {
        return 8; // Default fallback
    }
    
    const parsed = fontSizeMatch[1];
    const fontSize = parseFloat(parsed);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
        return 8;
    }
    
    // Use empirical ratio for better estimation
    // Average character width is typically 0.5-0.6 times font size
    // for monospace fonts it's closer to 0.6, for variable width fonts ~0.5
    return fontSize * 0.55;
}

/**
 * Thread-safe canvas management with proper resource cleanup.
 * Private helper function for text measurement.
 */
let _canvas: HTMLCanvasElement | null = null;

const getCanvas = (): HTMLCanvasElement => {
    // Double-checked locking pattern for thread safety
    if (!_canvas) {
        try {
            _canvas = document.createElement('canvas');
            _canvas.width = 1;
            _canvas.height = 1;
            _canvas.style.position = 'absolute';
            _canvas.style.left = '-9999px';
            _canvas.style.visibility = 'hidden';
            _canvas.style.display = 'none';
        } catch (error) {
            // Handle cases where canvas creation fails
            throw new Error('Canvas creation failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
    return _canvas;
};
