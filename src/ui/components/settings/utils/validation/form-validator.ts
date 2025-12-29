import * as v from 'valibot';
import { validatePathSegments } from '@/ui/components/settings/utils/validation/path-validator';
import { createIdFormatSchema } from '@/ui/components/settings/utils/factories/id-format-factory';
import {
    RESERVED_FRONTMATTER_KEYS_SET,
    REGEX_PATTERNS
} from '@/ui/components/settings/utils/helpers/constants';

/**
 * Schema for validating the database folder path.
 * Enforces strict security rules: no traversal, no reserved names, valid characters for all OSs.
 */
export const DatabasePathSchema = v.pipe(
    v.string(),
    v.transform((val: string): string => val.trim()),
    v.check((val) => val.length > 0, "Database path cannot be empty"),
    v.check((val) => val.length <= 255, "Path is too long (max 255 chars)"),
    v.check((val) => !val.startsWith('/'), "Path must be relative (cannot start with /)"),
    v.check((val) => !val.endsWith('/'), "Path cannot end with a slash"),
    v.check((val) => !REGEX_PATTERNS.PATH_TRAVERSAL.test(val), "Path traversal (..) is not allowed"),
    v.check((val) => {
        // Strict character check for the entire path string first (excluding separators)
        // We allow forward slashes as separators, but no other restricted chars
        const charsToCheck = val.replace(/\//g, '');
        return !REGEX_PATTERNS.INVALID_FILENAME_CHARS.test(charsToCheck);
    }, "Path contains invalid characters (<>:\"|?*\\)"),
    v.check((val) => {
        const segmentValidation = validatePathSegments(val);
        return segmentValidation.isValid;
    }, "Path contains invalid segments or reserved names")
);

/**
 * Schema for validating the frontmatter key.
 * Enforces strict YAML-safe key format and avoids Obsidian reserved keys.
 */
export const FrontmatterKeySchema = v.pipe(
    v.string(),
    v.transform((val: string): string => val.trim()),
    v.check((val) => val.length > 0, "Key cannot be empty"),
    v.check((val) => val.length <= 50, "Key is too long (max 50 chars)"),
    v.check((val) => REGEX_PATTERNS.SAFE_KEY.test(val), "Key can only contain letters, numbers, underscores, and hyphens"),
    v.check((val) => !RESERVED_FRONTMATTER_KEYS_SET.has(val.toLowerCase()), "This is a reserved Obsidian frontmatter key")
);

/**
 * Schema for validating a list of Regex patterns (one per line).
 * Checks for syntax errors and potential ReDoS complexity (via length).
 */
export const RegexListSchema = v.pipe(
    v.string(),
    v.check((val) => {
        const lines = val.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim() ?? '';
            if (line.length === 0) continue;

            // Security: Limit pattern length to prevent massive backtracking potential
            if (line.length > 500) {
                return false;
            }

            // Additional security: Check for exponential backtracking patterns
            if (/(?:.*){2,}\?/.test(line) || /\|.*\|/.test(line)) {
                return false;
            }

            try {
                // Use RegExp constructor with validation
                new RegExp(line);
            } catch {
                return false;
            }
        }
        return true;
    }, "Contains invalid or potentially unsafe regex patterns")
);

export const NoteIdFormatSchema = createIdFormatSchema(['path', 'uuid', 'timestamp'] as const, 'Note ID');
export const VersionIdFormatSchema = createIdFormatSchema(['timestamp', 'version', 'name'] as const, 'Version ID');
