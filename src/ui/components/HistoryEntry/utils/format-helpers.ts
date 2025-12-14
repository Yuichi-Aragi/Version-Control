import { moment } from 'obsidian';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '@/types';
import type { TimestampData } from '@/ui/components/HistoryEntry/types';

export function formatTimestamp(timestamp: number | string, useRelativeTimestamps: boolean, _now: number): TimestampData {
    const m = (moment as any)(timestamp);
    if (!m.isValid()) {
        return { timestampText: 'Invalid date', tooltipTimestamp: 'Invalid date' };
    }
    const text = useRelativeTimestamps ? m.fromNow() : m.format('YYYY-MM-DD HH:mm');
    const tooltip = m.format('LLLL');
    return { timestampText: text, tooltipTimestamp: tooltip };
}

export function getDisplaySize(
    enableCompression: boolean,
    version: VersionHistoryEntryType
): number {
    if (enableCompression) {
        return version.compressedSize ?? version.uncompressedSize ?? version.size;
    }
    return version.uncompressedSize ?? version.size;
}

export function getStatCounts(
    version: VersionHistoryEntryType,
    settings: {
        includeMdSyntaxInWordCount: boolean;
        includeMdSyntaxInCharacterCount: boolean;
        includeMdSyntaxInLineCount: boolean;
    }
) {
    const wordCount = settings.includeMdSyntaxInWordCount ? version.wordCountWithMd : version.wordCount;
    const charCount = settings.includeMdSyntaxInCharacterCount ? version.charCountWithMd : version.charCount;
    const lineCount = settings.includeMdSyntaxInLineCount ? version.lineCount : version.lineCountWithoutMd;

    return { wordCount, charCount, lineCount };
}
