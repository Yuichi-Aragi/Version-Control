import { useMemo, type FC, Fragment, type Ref } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import clsx from 'clsx';
import { escapeRegExp } from '../../utils/strings';

interface VirtualizedPlaintextProps {
    content: string;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    scrollerRef?: Ref<VirtuosoHandle>;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
}

const HighlightedText: FC<{ 
    text: string; 
    query: string; 
    caseSensitive: boolean;
    isTargetLine: boolean;
    targetMatchIndexInLine: number;
}> = ({ text, query, caseSensitive, isTargetLine, targetMatchIndexInLine }) => {
    if (!query.trim()) {
        return <>{text}</>;
    }
    
    try {
        const regex = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
        const parts = text.split(regex);
        const matches = text.match(regex);
    
        if (!matches) {
            return <>{text}</>;
        }
    
        return (
            <>
                {parts.map((part, i) => (
                    <Fragment key={i}>
                        {part}
                        {i < matches.length && (
                            <mark className={clsx({ 'is-active-match': isTargetLine && i === targetMatchIndexInLine })}>
                                {matches[i]}
                            </mark>
                        )}
                    </Fragment>
                ))}
            </>
        );
    } catch (e) {
        return <>{text}</>;
    }
};

export const VirtualizedPlaintext: FC<VirtualizedPlaintextProps> = ({ content, searchQuery, isCaseSensitive, scrollerRef, activeMatchInfo }) => {
    const lines = useMemo(() => content.split('\n'), [content]);
    
    // Create a props object for Virtuoso
    const virtuosoProps: {
        className: string;
        data: string[];
        itemContent: (index: number, line: string) => React.ReactElement;
    } = {
        className: "v-virtuoso-container",
        data: lines,
        itemContent: (index, line) => {
            const isTargetLine = activeMatchInfo?.lineIndex === index;
            const targetMatchIndexInLine = isTargetLine ? activeMatchInfo.matchIndexInLine : -1;

            return (
                <div className="v-plaintext-line">
                    {searchQuery ? (
                        <HighlightedText 
                            text={line || '\u00A0'} 
                            query={searchQuery} 
                            caseSensitive={isCaseSensitive ?? false}
                            isTargetLine={isTargetLine}
                            targetMatchIndexInLine={targetMatchIndexInLine}
                        />
                    ) : (
                        line || '\u00A0'
                    )}
                </div>
            );
        }
    };
    
    // Only add ref if it's defined
    if (scrollerRef !== undefined) {
        return (
            <Virtuoso
                ref={scrollerRef}
                {...virtuosoProps}
            />
        );
    }
    
    return <Virtuoso {...virtuosoProps} />;
};
VirtualizedPlaintext.displayName = 'VirtualizedPlaintext';
