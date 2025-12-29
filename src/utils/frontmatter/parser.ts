import { getFrontMatterInfo } from 'obsidian';
import type { FrontmatterMetadata, DelimiterType } from './types';
import {
  BOM,
  FRONTMATTER_START,
  FRONTMATTER_END_DASHES,
  FRONTMATTER_END_DOTS
} from './constants';
import { detectLineEnding, normalizeToLF, detectIndent, deepFreeze } from './common';

/**
 * Count top-level keys in YAML content using regex.
 * 
 * CRITICAL: Uses regex-only approach to avoid parsing YAML that may contain
 * special syntax like {{VALUE}} which would trigger warnings about complex keys.
 */
function countTopLevelKeys(yamlContent: string): number {
  if (!yamlContent.trim()) {
    return 0;
  }

  const lines = yamlContent.split('\n');
  let count = 0;
  
  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    
    // Match top-level keys (no leading whitespace, followed by colon)
    // Handles unquoted keys
    if (/^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(line)) {
      count++;
      continue;
    }
    
    // Match single-quoted keys
    if (/^'[^']+'\s*:/.test(line)) {
      count++;
      continue;
    }
    
    // Match double-quoted keys
    if (/^"[^"]+"\s*:/.test(line)) {
      count++;
      continue;
    }
  }
  
  return count;
}

/**
 * Extract frontmatter with complete metadata using Obsidian API
 */
export function extractFrontmatter(content: string): FrontmatterMetadata {
  const info = getFrontMatterInfo(content);
  const hasBom = content.startsWith(BOM);
  const originalLineEnding = detectLineEnding(content);

  // Helper to create non-existent metadata
  const createNonExistent = (): FrontmatterMetadata => deepFreeze({
    exists: false,
    raw: '',
    yamlContent: '',
    startOffset: hasBom ? 1 : 0,
    endOffset: hasBom ? 1 : 0,
    startDelimiter: '',
    endDelimiter: '',
    endDelimiterType: 'dashes' as DelimiterType,
    beforeContent: hasBom ? BOM : '',
    afterContent: hasBom ? normalizeToLF(content.slice(1)) : normalizeToLF(content),
    lineEnding: originalLineEnding,
    isEmpty: true,
    hasComments: false,
    hasAnchors: false,
    hasAliases: false,
    keyCount: 0,
    rawLineCount: 0,
    hasBom,
    indentSize: 2,
  });

  if (!info.exists) {
    return createNonExistent();
  }

  const yamlContent = info.frontmatter;
  
  // Construct raw block from start of file (including BOM if present) to contentStart.
  // info.contentStart is the offset where the body content begins.
  const raw = content.slice(0, info.contentStart);

  // Determine delimiters
  let endDelimiter = FRONTMATTER_END_DASHES;
  let endDelimiterType: DelimiterType = 'dashes';

  // Check the closing delimiter which lies between info.to (end of YAML) and info.contentStart (start of body)
  const closingSection = content.slice(info.to, info.contentStart);
  if (closingSection.includes('...')) {
    endDelimiter = FRONTMATTER_END_DOTS;
    endDelimiterType = 'dots';
  }

  // Analyze content
  const hasComments = /(?:^|\n)[ \t]*#/.test(yamlContent);
  const hasAnchors = /&[a-zA-Z_][a-zA-Z0-9_]*/.test(yamlContent);
  const hasAliases = /\*[a-zA-Z_][a-zA-Z0-9_]*/.test(yamlContent);
  const indentSize = detectIndent(yamlContent);
  
  // Check if empty (whitespace or comments only)
  const isEmpty = yamlContent.trim().length === 0 ||
    yamlContent.split(/\r\n|\r|\n/).every(line => line.trim() === '' || line.trim().startsWith('#'));

  // Count keys using regex (avoids YAML parsing warnings)
  const keyCount = isEmpty ? 0 : countTopLevelKeys(yamlContent);

  const rawLineCount = raw.split(/\r\n|\r|\n/).length;

  return deepFreeze({
    exists: true,
    raw,
    yamlContent,
    startOffset: info.from,
    endOffset: info.to,
    startDelimiter: FRONTMATTER_START,
    endDelimiter,
    endDelimiterType,
    beforeContent: hasBom ? BOM : '',
    afterContent: normalizeToLF(content.slice(info.contentStart)),
    lineEnding: originalLineEnding,
    isEmpty,
    hasComments,
    hasAnchors,
    hasAliases,
    keyCount,
    rawLineCount,
    hasBom,
    indentSize,
  });
}
