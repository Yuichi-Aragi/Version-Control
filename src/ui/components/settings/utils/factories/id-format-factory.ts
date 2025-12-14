import * as v from 'valibot';
import { REGEX_PATTERNS } from '@/ui/components/settings/utils/helpers/constants';

/**
 * Factory to create a schema for ID formats with specific allowed variables.
 */
export const createIdFormatSchema = (allowedVariables: readonly string[], contextName: string) => {
    const allowedSet = new Set(allowedVariables);

    return v.pipe(
        v.string(),
        v.transform((val: string): string => val.trim()),
        v.check((val) => val.length > 0, `${contextName} format cannot be empty`),
        v.check((val) => val.length <= 100, `${contextName} format is too long (max 100 chars)`),
        v.check((val) => !REGEX_PATTERNS.CONTROL_CHARS.test(val), `${contextName} format contains control characters`),
        v.check((val) => {
            // Check balanced braces and extract variables
            let depth = 0;
            let braceStart = -1;
            const foundVariables = new Set<string>();

            for (let i = 0; i < val.length; i++) {
                const char = val[i];

                if (char === '{') {
                    if (depth > 0) {
                        return false; // nested braces
                    }
                    depth++;
                    braceStart = i;
                } else if (char === '}') {
                    if (depth === 0) {
                        return false; // unmatched closing brace
                    }
                    depth--;

                    // Extract variable name
                    const varName = val.slice(braceStart + 1, i);
                    if (varName.length === 0) {
                        return false; // empty variable
                    }
                    foundVariables.add(varName);
                }
            }

            if (depth !== 0) {
                return false; // unmatched opening brace
            }

            // Check all found variables are allowed
            for (const varName of foundVariables) {
                if (!allowedSet.has(varName)) {
                    return false;
                }
            }

            // Check for invalid filename chars in static parts
            const staticParts = val.replace(REGEX_PATTERNS.VARIABLE_EXTRACTION, '');
            if (REGEX_PATTERNS.INVALID_FILENAME_CHARS.test(staticParts)) {
                return false;
            }

            return true;
        }, `${contextName} format contains invalid variables or characters`)
    );
};
