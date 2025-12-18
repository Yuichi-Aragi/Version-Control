import { memo, Fragment } from 'react';
import clsx from 'clsx';
import { escapeRegExp } from '@/ui/utils/strings';

interface HighlightedTextProps {
    text: string;
    query?: string;
    caseSensitive?: boolean;
    /**
     * The index of the specific match within this text string to highlight as 'active'.
     * If -1 or undefined, no match is highlighted as active.
     */
    activeMatchIndex?: number;
    className?: string;
    ariaLabel?: string;
}

export const HighlightedText = memo(({ 
    text, 
    query, 
    caseSensitive = false, 
    activeMatchIndex = -1,
    className,
    ariaLabel
}: HighlightedTextProps) => {
    if (!query || !query.trim() || !text) {
        return <>{text}</>;
    }

    try {
        const escaped = escapeRegExp(query);
        const regex = new RegExp(`(${escaped})`, caseSensitive ? 'g' : 'gi');
        const parts = text.split(regex);
        const matches = text.match(regex);

        if (!matches) {
            return <>{text}</>;
        }

        return (
            <span aria-label={ariaLabel}>
                {parts.map((part, i) => {
                    // parts length is always matches.length + 1 (interleaved)
                    // The matches are at odd indices in the split array if we used capturing group,
                    // but here we are iterating parts.
                    // Actually, simpler logic:
                    // text.split(regex) with capturing group returns [pre, match, mid, match, post]
                    // So every odd index (1, 3, 5...) is a match.
                    
                    if (i % 2 === 1) {
                        // This is a match
                        const matchIndex = (i - 1) / 2;
                        const isActive = matchIndex === activeMatchIndex;
                        return (
                            <mark key={i} className={clsx(className, { 'is-active-match': isActive })}>
                                {part}
                            </mark>
                        );
                    }
                    return <Fragment key={i}>{part}</Fragment>;
                })}
            </span>
        );
    } catch (e) {
        console.warn('HighlightedText regex error:', e);
        return <>{text}</>;
    }
});

HighlightedText.displayName = 'HighlightedText';
