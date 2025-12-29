import { App, TFile } from 'obsidian';
import { BOM, FRONTMATTER_START, FRONTMATTER_END_DASHES } from './constants';
import { toLineEnding } from './common';
import type { FrontmatterMetadata } from './types';

/**
 * Read file content safely
 */
export async function readFile(app: App, file: TFile): Promise<string> {
  try {
    const content = await app.vault.read(file);
    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read "${file.path}": ${message}`);
  }
}

/**
 * Write file content with idempotency check
 */
export async function writeFile(
  app: App,
  file: TFile,
  content: string,
  originalContent: string
): Promise<boolean> {
  // Idempotency: no write if unchanged
  if (content === originalContent) {
    return false;
  }

  try {
    await app.vault.modify(file, content);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write "${file.path}": ${message}`);
  }
}

/**
 * Reconstruct file content with updated frontmatter
 */
export function reconstructContent(
  yamlContent: string,
  metadata: FrontmatterMetadata,
  targetLineEnding: '\n' | '\r\n'
): string {
  let content: string;

  if (yamlContent.trim().length === 0) {
    // Empty frontmatter block
    content = `${FRONTMATTER_START}\n${metadata.endDelimiter}`;
  } else {
    // Normalize yaml content
    let normalized = yamlContent.trim();
    if (!normalized.endsWith('\n')) {
      normalized += '\n';
    }
    content = `${FRONTMATTER_START}\n${normalized}${metadata.endDelimiter}`;
  }

  // Add content after frontmatter
  if (metadata.afterContent.length > 0) {
    const after = metadata.afterContent.startsWith('\n')
      ? metadata.afterContent
      : '\n' + metadata.afterContent;
    content += after;
  } else {
    content += '\n';
  }

  // Handle BOM
  if (metadata.hasBom) {
    content = BOM + content;
  }

  return toLineEnding(content, targetLineEnding);
}

/**
 * Create new frontmatter content
 */
export function createNewFrontmatter(
  yamlContent: string,
  existingContent: string,
  hasBom: boolean,
  targetLineEnding: '\n' | '\r\n'
): string {
  let normalized = yamlContent.trim();
  if (normalized.length > 0 && !normalized.endsWith('\n')) {
    normalized += '\n';
  }

  let content = `${FRONTMATTER_START}\n${normalized}${FRONTMATTER_END_DASHES}\n`;

  // Add existing content
  const bodyContent = existingContent.trim();
  if (bodyContent.length > 0) {
    content += '\n' + bodyContent + '\n';
  }

  // Handle BOM
  if (hasBom) {
    content = BOM + content;
  }

  return toLineEnding(content, targetLineEnding);
}