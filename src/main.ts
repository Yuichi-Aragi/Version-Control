/**
 * Main plugin module for Version Control.
 * This module exports the main plugin class as default, as required by Obsidian's plugin API.
 */
import VersionControlPlugin from '@/main/VersionControlPlugin';

export default VersionControlPlugin;
export type { default as VersionControlPlugin } from '@/main/VersionControlPlugin';
export type { DebouncerInfo, QueuedChangelogRequest } from '@/main/types';
