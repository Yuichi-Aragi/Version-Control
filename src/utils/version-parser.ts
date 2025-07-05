/**
 * Parses a string to extract a name and up to 5 unique tags.
 * Tags are identified by a `#` prefix.
 * @param input The raw string from the user, e.g., "My changes #important #refactor"
 * @returns An object with `name` and `tags` properties.
 */
export function parseNameAndTags(input: string): { name: string, tags: string[] } {
    const tagRegex = /(?:^|\s)#([^\s#]+)/g;
    const tags = new Set<string>();
    
    // Use matchAll for a more idiomatic and readable way to find all matches.
    for (const match of input.matchAll(tagRegex)) {
        if (match[1]) { // Ensure tag is not empty (group 1)
            tags.add(match[1]);
        }
    }

    // Replace tags with a space to isolate the name part of the string.
    const name = input.replace(tagRegex, ' ').replace(/\s+/g, ' ').trim();
    
    // Convert set to array and limit to 5 tags for uniqueness and constraint.
    const finalTags = Array.from(tags).slice(0, 5);
    return { name, tags: finalTags };
}
