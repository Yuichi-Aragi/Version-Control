/**
 * Generates a cryptographically secure unique identifier using the Web Crypto API.
 * 
 * This function strictly relies on `crypto.randomUUID()` and throws a descriptive,
 * unrecoverable error if the API is unavailable — ensuring no fallback to insecure
 * random sources. Designed for Obsidian environment where `crypto.randomUUID` is
 * guaranteed to be present, this implementation prioritizes security, explicit failure,
 * and strict type safety.
 */

export function generateUniqueId(): string {
    // Proactive validation: ensure global `crypto` exists and is an object
    if (typeof crypto === 'undefined' || crypto === null || typeof crypto !== 'object') {
        const errorMessage = "Version Control: Global 'crypto' object is not available or malformed. Cannot generate secure unique IDs.";
        console.error(`[CRITICAL FAILURE] ${errorMessage}`);
        throw new Error(errorMessage);
    }

    // Validate that `randomUUID` exists and is a function
    if (typeof (crypto as Crypto).randomUUID !== 'function') {
        const errorMessage = "Version Control: 'crypto.randomUUID' is not a function. Cannot generate secure unique IDs.";
        console.error(`[CRITICAL FAILURE] ${errorMessage}`);
        throw new Error(errorMessage);
    }

    let generatedId: string;

    try {
        // Invoke the crypto API — wrapped in try-catch for unexpected runtime failures
        generatedId = (crypto as Crypto).randomUUID();
    } catch (innerError) {
        const errorMessage = `Version Control: Invocation of 'crypto.randomUUID()' failed: ${innerError instanceof Error ? innerError.message : String(innerError)}`;
        console.error(`[CRITICAL FAILURE] ${errorMessage}`);
        throw new Error(errorMessage);
    }

    // Post-generation validation: ensure output is a non-empty string
    if (typeof generatedId !== 'string' || generatedId.trim().length === 0) {
        const errorMessage = "Version Control: 'crypto.randomUUID()' returned invalid or empty result.";
        console.error(`[CRITICAL FAILURE] ${errorMessage}`);
        throw new Error(errorMessage);
    }

    // Validate UUID format (basic structure: 8-4-4-4-12 hex digits)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(generatedId)) {
        const errorMessage = "Version Control: Generated ID does not conform to UUID v4 format.";
        console.error(`[CRITICAL FAILURE] ${errorMessage}`);
        throw new Error(errorMessage);
    }

    // Return validated, cryptographically secure UUID
    return generatedId;
}
