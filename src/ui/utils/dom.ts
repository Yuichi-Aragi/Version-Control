/**
 * Formats file size in bytes into a human-readable string (B, KB, MB, GB).
 * @param bytes The size in bytes.
 * @returns A formatted string.
 */
export function formatFileSize(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 1))} ${sizes[i]}`;
}