import { map, uniq, take, trim } from 'lodash-es';

/**
 * Parses a string to extract a name and up to 5 unique tags.
 * Tags are identified by a `#` prefix.
 * @param input The raw string from the user, e.g., "My changes #important #refactor"
 * @returns An object with `name` and `tags` properties.
 */
export function parseNameAndTags(input: string): { name: string, tags: string[] } {
    const tagRegex = /(?:^|\s)#([^\s#]+)/g;
    
    // Use lodash to extract, unique-ify, and limit tags
    const allMatches = Array.from(input.matchAll(tagRegex));
    const extractedTags = map(allMatches, match => match[1]).filter(Boolean); // filter(Boolean) removes any empty tags
    const uniqueTags = uniq(extractedTags);
    const finalTags = take(uniqueTags, 5);

    // Use lodash to clean up the name
    const nameWithExtraSpaces = input.replace(tagRegex, ' ');
    const name = trim(nameWithExtraSpaces.replace(/\s+/g, ' '));
    
    return { name, tags: finalTags };
}