import { moment } from 'obsidian';
import type { TimelineEvent } from '@/state';
import type { TimelineMatch } from '@/ui/components/panels/TimelinePanel/types';
import { processLineChanges } from '@/ui/components/shared/VirtualizedDiff';
import { escapeRegExp } from '@/ui/utils/strings';

export const findMatches = (
    sortedEvents: TimelineEvent[],
    searchQuery: string,
    isCaseSensitive: boolean
): TimelineMatch[] => {
    if (!searchQuery || !sortedEvents.length) {
        return [];
    }

    const results: TimelineMatch[] = [];
    const regex = new RegExp(escapeRegExp(searchQuery), isCaseSensitive ? 'g' : 'gi');

    sortedEvents.forEach((event, eventIndex) => {
        const metaStrings = [
            event.toVersionName,
            `V${event.toVersionNumber}`,
            event.toVersionDescription,
            (moment as any)(event.timestamp).format('MMM D, YYYY h:mm A'),
            String(event.stats.additions),
            String(event.stats.deletions)
        ];

        let metaMatchFound = false;
        for (const str of metaStrings) {
            if (str && regex.test(str)) {
                metaMatchFound = true;
                break;
            }
        }

        if (metaMatchFound) {
            results.push({ eventIndex, type: 'metadata' });
        }

        const lines = processLineChanges(event.diffData, 'smart');
        lines.forEach((line, lineIndex) => {
            if (line.type === 'collapsed') return;

            regex.lastIndex = 0;
            const lineMatches = [...line.content.matchAll(regex)];

            lineMatches.forEach((_, matchIndex) => {
                results.push({
                    eventIndex,
                    type: 'diff',
                    lineIndex,
                    matchIndexInLine: matchIndex
                });
            });
        });
    });

    return results;
};
