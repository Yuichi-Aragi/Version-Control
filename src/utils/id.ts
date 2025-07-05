/**
 * **FIX M-02:** Generates a cryptographically secure unique identifier using the Web Crypto API.
 * The insecure fallback to Math.random() has been removed. The Obsidian environment
 * guarantees the availability of `crypto.randomUUID`, so the fallback was unnecessary
 * complexity and a potential security risk. This version is simpler and more secure.
 * It will now throw an error if the required API is missing, which is safer than
 * silently generating insecure IDs.
 */
export function generateUniqueId(): string {
    if (typeof crypto === 'undefined' || !crypto.randomUUID) {
        // This should be an exceptional, unrecoverable case in the Obsidian environment.
        const errorMessage = "Version Control: `crypto.randomUUID` is not available. Cannot generate secure unique IDs.";
        console.error(errorMessage);
        throw new Error(errorMessage);
    }
    return crypto.randomUUID();
}
