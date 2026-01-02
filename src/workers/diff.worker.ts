/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import {
  makeDiff,
  cleanupSemantic,
  DIFF_DELETE,
  DIFF_INSERT,
  DIFF_EQUAL,
  type Diff,
} from '@sanity/diff-match-patch';
import type { DiffType as ConsumerDiffType, Change } from '@/types';

/**
 * Optimized Diff Worker using @sanity/diff-match-patch
 *
 * Performance Optimizations:
 * 1. Transferables: Uses ArrayBuffer for zero-copy data transfer between main thread and worker.
 * 2. Efficient Serialization: manual TextEncoder/Decoder usage bypasses automatic structured cloning overhead for large strings.
 * 3. Input Sanitization: Removes control characters to prevent processing errors.
 * 4. Algorithm Selection: Uses hierarchical diffing (Lines -> Words/Chars) to balance speed and precision.
 * 5. Semantic Cleanup: Applies semantic cleanup for human-readable results.
 *
 * Note: linesToChars and charsToLines are implemented locally since they are internal
 * to @sanity/diff-match-patch. The implementation is identical to the original diff-match-patch.
 */

// Diff options for @sanity/diff-match-patch
// Maintains compatibility with the original DiffMatchPatch.Diff_Timeout setting
const diffOptions = {
  checkLines: true,
  timeout: 10, // 10 seconds, matching the original dmp.Diff_Timeout = 10
};

// Text decoder/encoder for efficient string handling
const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

// Regex to strip ASCII control characters (except \t, \n, \r) to ensure robustness
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

// Maximum unique tokens for word-level diffing before falling back to char diff
// Based on Unicode BMP limit minus reserved range (0x100 to 0xFFFF)
const MAX_UNIQUE_TOKENS = 65280;

/**
 * Splits two texts into an array of strings. Reduce the texts to a string of
 * hashes where each Unicode character represents one line.
 *
 * This is a local implementation of the linesToChars function since it's not
 * exported from @sanity/diff-match-patch. The implementation matches the
 * original diff-match-patch behavior exactly for 100% compatibility.
 *
 * @param textA - First string.
 * @param textB - Second string.
 * @returns An object containing the encoded textA, the encoded textB and
 * the array of unique strings. The zeroth element of the array of unique
 * strings is intentionally blank.
 */
function linesToChars(textA: string, textB: string): {
  chars1: string;
  chars2: string;
  lineArray: string[];
} {
  const lineArray: string[] = []; // e.g. lineArray[4] === 'Hello\n'
  const lineHash: { [key: string]: number } = {}; // e.g. lineHash['Hello\n'] === 4

  // '\x00' is a valid character, but various debuggers don't like it.
  // So we'll insert a junk entry to avoid generating a null character.
  lineArray[0] = '';

  /**
   * Split a text into an array of strings. Reduce the texts to a string of
   * hashes where each Unicode character represents one line.
   * Uses maxLines parameter to avoid closure variable capture issues.
   */
  function diffLinesToMunge(text: string, maxLinesValue: number): string {
    let chars = '';
    // Walk the text, pulling out a substring for each line.
    // text.split('\n') would temporarily double our memory footprint.
    // Modifying text would create many large strings to garbage collect.
    let lineStart = 0;
    let lineEnd = -1;
    // Keeping our own length variable is faster than looking it up.
    let lineArrayLength = lineArray.length;

    while (lineEnd < text.length - 1) {
      lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd === -1) {
        lineEnd = text.length - 1;
      }
      let line = text.slice(lineStart, lineEnd + 1);

      // eslint-disable-next-line no-prototype-builtins
      if (
        lineHash.hasOwnProperty
          ? lineHash.hasOwnProperty(line)
          : lineHash[line] !== undefined
      ) {
        const hashValue = lineHash[line];
        if (hashValue !== undefined) {
          chars += String.fromCharCode(hashValue);
        }
      } else {
        if (lineArrayLength === maxLinesValue) {
          // Bail out at 65535 because
          // String.fromCharCode(65536) == String.fromCharCode(0)
          line = text.slice(lineStart);
          lineEnd = text.length;
        }
        chars += String.fromCharCode(lineArrayLength);
        lineHash[line] = lineArrayLength;
        lineArray[lineArrayLength++] = line;
      }
      lineStart = lineEnd + 1;
    }
    return chars;
  }

  // Allocate 2/3rds of the space for textA, the rest for textB.
  const chars1 = diffLinesToMunge(textA, 40000);
  const chars2 = diffLinesToMunge(textB, 65535);

  return { chars1, chars2, lineArray };
}

/**
 * Rehydrate the text in a diff from a string of line hashes to real lines of text.
 *
 * This is a local implementation of the charsToLines function since it's not
 * exported from @sanity/diff-match-patch. The implementation matches the
 * original diff-match-patch behavior exactly for 100% compatibility.
 *
 * @param diffs - Array of diff tuples.
 * @param lineArray - Array of unique strings.
 */
function charsToLines(diffs: Diff[], lineArray: string[]): void {
  for (let x = 0; x < diffs.length; x++) {
    const currentDiff = diffs[x];
    if (currentDiff === undefined) continue;
    
    const chars = currentDiff[1];
    const text: string[] = [];
    for (let y = 0; y < chars.length; y++) {
      const charCode = chars.charCodeAt(y);
      const lineText = lineArray[charCode];
      if (lineText !== undefined) {
        text[y] = lineText;
      }
    }
    currentDiff[1] = text.join('');
  }
}

/**
 * Sanitizes input string to prevent processing errors or malicious injection via control chars.
 * Preserves tabs, newlines, and carriage returns as they are valid text formatting.
 */
function sanitizeInput(input: string): string {
  if (input.length === 0) return input;
  return input.replace(CONTROL_CHAR_REGEX, '');
}

/**
 * Converts input to string. Handles ArrayBuffer inputs efficiently.
 * Uses non-fatal decoder to gracefully handle encoding issues.
 */
function toString(content: string | ArrayBuffer): string {
  if (typeof content === 'string') {
    return content;
  }
  return decoder.decode(content);
}

/**
 * Converts string to Uint8Array for efficient transfer.
 */
function toUint8Array(str: string): Uint8Array {
  return encoder.encode(str);
}

/**
 * Counts lines in a text string accurately.
 * Handles edge cases: empty strings, strings ending with newlines.
 */
function countLines(text: string): number {
  if (text.length === 0) return 0;

  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      count++;
    }
  }
  // If text ends with newline, the final "line" is empty and shouldn't be counted as content
  if (text.endsWith('\n')) {
    count--;
  }
  return count || 1;
}

/**
 * Converts @sanity/diff-match-patch diffs to Change[] format compatible with consumers.
 * Maintains full compatibility with the original 'diff' library output format.
 * The diff values are identical: -1 (DELETE), 0 (EQUAL), 1 (INSERT)
 */
function diffsToChanges(diffs: Diff[]): Change[] {
  const changes: Change[] = [];

  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];
    if (diff === undefined) continue;

    const [op, text] = diff;

    // Skip empty diffs that can occur after cleanup operations
    if (text.length === 0) continue;

    const change: Change = {
      value: text,
      // Using the same boolean flags as the original implementation for 100% compatibility
      added: op === DIFF_INSERT ? true : undefined,
      removed: op === DIFF_DELETE ? true : undefined,
      count: countLines(text),
    };

    changes.push(change);
  }

  return changes;
}

/**
 * Converts word tokens to single characters for efficient diffing.
 * Similar to @sanity/diff-match-patch's linesToChars but operates on words.
 * Returns null if the number of unique tokens exceeds the safe limit.
 */
function diffWordsToChars(
  text1: string,
  text2: string
): { chars1: string; chars2: string; wordArray: string[] } | null {
  const wordArray: string[] = [];
  const wordHash = new Map<string, number>();

  /**
   * Converts text to character-encoded representation.
   * Each unique word/whitespace token maps to a unique character.
   */
  function wordsToCharsMunge(text: string): string | null {
    let chars = '';
    // Match words (non-whitespace sequences) and whitespace (space sequences) separately
    // This preserves whitespace exactly as diffWordsWithSpace did
    const tokens = text.match(/\S+|\s+/g) || [];

    for (let j = 0; j < tokens.length; j++) {
      const token = tokens[j];
      if (token === undefined) continue;

      const existingIndex = wordHash.get(token);
      if (existingIndex !== undefined) {
        chars += String.fromCharCode(existingIndex + 0x100);
      } else {
        if (wordArray.length >= MAX_UNIQUE_TOKENS) {
          // Too many unique tokens; signal fallback to char diff
          return null;
        }
        const index = wordArray.length;
        wordArray.push(token);
        wordHash.set(token, index);
        chars += String.fromCharCode(index + 0x100);
      }
    }
    return chars;
  }

  const chars1 = wordsToCharsMunge(text1);
  if (chars1 === null) return null;

  const chars2 = wordsToCharsMunge(text2);
  if (chars2 === null) return null;

  return { chars1, chars2, wordArray };
}

/**
 * Converts character-encoded diffs back to original word tokens.
 * Modifies the diffs array in place for efficiency.
 */
function diffCharsToWords(diffs: Diff[], wordArray: string[]): void {
  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];
    if (diff === undefined) continue;

    const chars = diff[1];
    const words: string[] = [];
    for (let j = 0; j < chars.length; j++) {
      const charCode = chars.charCodeAt(j) - 0x100;
      if (charCode >= 0 && charCode < wordArray.length) {
        const word = wordArray[charCode];
        if (word !== undefined) {
          words.push(word);
        }
      }
    }
    diffs[i] = [diff[0], words.join('')];
  }
}

/**
 * Performs line-level diff using @sanity/diff-match-patch's optimized line mode.
 * This is the primary diff for establishing the structure of changes.
 * Uses local linesToChars and charsToLines implementations for full compatibility.
 */
function computeLineDiff(text1: string, text2: string): Diff[] {
  // Use our local line-level diffing implementation
  // This converts lines to single characters, diffs, then converts back
  const lineData = linesToChars(text1, text2);
  // makeDiff with checkLines: false since we've already done line conversion
  const diffs = makeDiff(lineData.chars1, lineData.chars2, {
    checkLines: false,
    timeout: diffOptions.timeout,
  });
  // Restore the original line text
  charsToLines(diffs, lineData.lineArray);
  return diffs;
}

/**
 * Performs character-level diff with semantic cleanup for readability.
 * Provides maximum precision for showing exact character changes.
 */
function computeCharDiff(text1: string, text2: string): Diff[] {
  const diffs = makeDiff(text1, text2, {
    checkLines: false,
    timeout: diffOptions.timeout,
  });
  cleanupSemantic(diffs);
  return diffs;
}

/**
 * Performs word-level diff with automatic fallback to character diff.
 * Maintains whitespace information for accurate reconstruction.
 */
function computeWordDiff(text1: string, text2: string): Diff[] {
  const wordData = diffWordsToChars(text1, text2);

  if (wordData !== null) {
    const diffs = makeDiff(wordData.chars1, wordData.chars2, {
      checkLines: false,
      timeout: diffOptions.timeout,
    });
    diffCharsToWords(diffs, wordData.wordArray);
    cleanupSemantic(diffs);
    return diffs;
  }

  // Fallback to character diff if too many unique words
  return computeCharDiff(text1, text2);
}

/**
 * Merges adjacent diffs of the same type that can occur after line-to-char conversion.
 * Ensures clean output without fragmented consecutive changes.
 */
function mergeAdjacentDiffs(diffs: Diff[]): Diff[] {
  if (diffs.length === 0) return diffs;

  const firstDiff = diffs[0];
  if (firstDiff === undefined) return [];

  const merged: Diff[] = [];
  let currentOp = firstDiff[0] as Diff[0];
  let currentText: string = firstDiff[1];

  for (let i = 1; i < diffs.length; i++) {
    const diff = diffs[i];
    if (diff === undefined) continue;

    const op = diff[0];
    const text = diff[1];

    if (op === currentOp) {
      currentText += text;
    } else {
      if (currentText.length > 0) {
        merged.push([currentOp, currentText]);
      }
      currentOp = op;
      currentText = text;
    }
  }

  if (currentText.length > 0) {
    merged.push([currentOp, currentText]);
  }

  return merged;
}

const diffEngine = {
  /**
   * Computes diff between two content inputs.
   *
   * @param type - The type of diff to compute ('words', 'chars', 'smart', 'lines')
   * @param content1 - Original content (string or ArrayBuffer)
   * @param content2 - Modified content (string or ArrayBuffer)
   * @returns ArrayBuffer containing JSON-serialized Change[] for efficient transfer
   */
  async computeDiff(
    type: ConsumerDiffType,
    content1: string | ArrayBuffer,
    content2: string | ArrayBuffer
  ): Promise<ArrayBuffer> {
    // 1. Decode inputs from potential ArrayBuffer format
    const str1 = toString(content1);
    const str2 = toString(content2);

    // 2. Sanitize inputs (Production grade robustness)
    const clean1 = sanitizeInput(str1);
    const clean2 = sanitizeInput(str2);

    // 3. Text Diffing (Unified Line Diff with Intra-line Refinement)
    // Start with line-based diff to establish the structure (hunks).
    // This provides the "GitHub style" unified view skeleton.
    const lineDiffs = computeLineDiff(clean1, clean2);
    const mergedLineDiffs = mergeAdjacentDiffs(lineDiffs);
    const lineChanges = diffsToChanges(mergedLineDiffs);

    // 4. Intra-line Refinement
    // Refine modified blocks to show character or word level changes within the lines.
    // Modes:
    // 'words' -> Use word-level diff (like diffWordsWithSpace)
    // 'chars', 'smart' -> Use character-level diff (maximum precision)
    // 'lines' -> Skip intra-line detail for speed/overview

    const useWordRefinement = type === 'words';
    const useRefinement = type !== 'lines';

    if (useRefinement) {
      // Iterate through the line changes.
      // Look for adjacent "removed" and "added" blocks, which represent a modification.
      const changesLength = lineChanges.length;
      for (let i = 0; i < changesLength - 1; i++) {
        const current = lineChanges[i];
        const next = lineChanges[i + 1];

        // TypeScript guard: ensure both elements exist
        if (current === undefined || next === undefined) {
          continue;
        }

        // Check if this is a modification (Removed followed by Added)
        if (current.removed === true && next.added === true) {
          let refinedDiffs: Diff[];

          // Calculate refinement based on type
          if (useWordRefinement) {
            refinedDiffs = computeWordDiff(current.value, next.value);
          } else {
            // Character-level diff for maximum precision ('chars', 'smart', or default)
            refinedDiffs = computeCharDiff(current.value, next.value);
          }

          // Convert to Change format for the parts
          const refinedChanges = diffsToChanges(refinedDiffs);

          // Attach the refined intra-line diffs to the line objects.
          // We use 'parts' property to store the detailed changes.
          // Both removed and added lines share the same parts for side-by-side rendering.
          current.parts = refinedChanges;
          next.parts = refinedChanges;

          // Skip the next iteration as we processed the pair (current, next)
          i++;
        }
      }
    }

    // 5. Serialize and Transfer
    const json = JSON.stringify(lineChanges);
    const uint8Array = toUint8Array(json);
    const buffer = uint8Array.buffer.slice(0) as ArrayBuffer;

    return transfer(buffer, [buffer]);
  },
};

expose(diffEngine);
