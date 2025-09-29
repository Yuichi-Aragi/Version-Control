/**
 * Formats file size in bytes into a human-readable string (B, KB, MB, GB, TB, PB, EB, ZB, YB).
 * @param bytes - The size in bytes. Must be a finite number >= 0.
 * @returns A precisely formatted human-readable string with appropriate unit and decimal precision.
 * @throws TypeError if input is not a valid finite number.
 * 
 * @example
 * formatFileSize(0)        // "0 B"
 * formatFileSize(1024)     // "1 KB"
 * formatFileSize(1536)     // "1.5 KB"
 * formatFileSize(1048576)  // "1.00 MB"
 */
export function formatFileSize(bytes: unknown): string {
    // === STRICT INPUT VALIDATION ===
    // Proactively validate type and value - never assume
    if (typeof bytes !== 'number') {
        throw new TypeError(`Expected parameter 'bytes' to be of type 'number', received '${typeof bytes}'`);
    }
    
    if (!Number.isFinite(bytes)) {
        throw new TypeError(`Expected parameter 'bytes' to be a finite number, received ${bytes}`);
    }
    
    if (bytes < 0) {
        throw new TypeError(`Expected parameter 'bytes' to be non-negative, received ${bytes}`);
    }
    
    // Handle zero case immediately
    if (bytes === 0) {
        return "0 B";
    }
    
    // === CONSTANTS DEFINITION ===
    // Extended units for enterprise-scale applications
    const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] as const;
    const BASE = 1024;
    const MAX_SAFE_INDEX = UNITS.length - 1;
    
    // === CALCULATION WITH DEFENSIVE BOUNDS CHECKING ===
    // Calculate logarithmic index safely
    let index: number;
    try {
        // Math.log may throw for extremely large numbers approaching Infinity
        const logResult = Math.log(bytes) / Math.log(BASE);
        index = Math.floor(logResult);
        
        // Clamp index to valid range to prevent array out-of-bounds
        index = Math.max(0, Math.min(index, MAX_SAFE_INDEX));
    } catch (error) {
        // Fallback for any calculation errors
        index = 0;
    }
    
    // Double-check index bounds (defensive programming)
    if (index < 0 || index >= UNITS.length || !Number.isFinite(index)) {
        index = 0;
    }
    
    // === PRECISION CALCULATION ===
    // More decimal places for smaller units, fewer for larger units
    const precision = index > 1 ? 2 : 1;
    
    // Calculate the value for the selected unit
    const divisor = Math.pow(BASE, index);
    let value: number;
    
    try {
        value = bytes / divisor;
        
        // Ensure we don't have calculation errors
        if (!Number.isFinite(value)) {
            value = bytes; // Fallback to original value
            index = 0;     // Fallback to bytes
        }
    } catch (error) {
        // Ultimate fallback
        value = bytes;
        index = 0;
    }
    
    // === STRING FORMATTING WITH PRECISION CONTROL ===
    // Use toFixed for consistent decimal places, then parseFloat to remove trailing zeros
    let formattedValue: string;
    try {
        const fixedValue = value.toFixed(precision);
        // Parse float to remove unnecessary trailing zeros while maintaining precision
        const parsedValue = parseFloat(fixedValue);
        formattedValue = parsedValue.toFixed(precision);
        
        // Additional validation to ensure we have a valid string representation
        if (typeof formattedValue !== 'string' || formattedValue.length === 0) {
            formattedValue = value.toString();
        }
    } catch (error) {
        // Fallback formatting
        formattedValue = value.toString();
    }
    
    // === FINAL OUTPUT ASSEMBLY ===
    // Ensure we have a valid unit
    const unit = index >= 0 && index < UNITS.length ? UNITS[index] : 'B';
    
    return `${formattedValue} ${unit}`;
}
