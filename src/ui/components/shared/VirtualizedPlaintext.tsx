import { useMemo, type FC, type Ref } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { HighlightedText } from './HighlightedText';

interface VirtualizedPlaintextProps {
    content: string;
    searchQuery?: string;
    isCaseSensitive?: boolean;
    scrollerRef?: Ref<VirtuosoHandle>;
    activeMatchInfo: { lineIndex: number; matchIndexInLine: number } | null;
}

export const VirtualizedPlaintext: FC<VirtualizedPlaintextProps> = ({ 
    content, 
    searchQuery, 
    isCaseSensitive, 
    scrollerRef, 
    activeMatchInfo 
}) => {
    const lines = useMemo(() => content.split('\n'), [content]);
    
    return (
        <Virtuoso
            {...(scrollerRef && { ref: scrollerRef })}
            className="v-virtuoso-container"
            data={lines}
            itemContent={(index, line) => {
                const isTargetLine = activeMatchInfo?.lineIndex === index;
                const targetMatchIndexInLine = isTargetLine ? activeMatchInfo.matchIndexInLine : -1;

                return (
                    <div className="v-plaintext-line">
                        <HighlightedText 
                            text={line || '\u00A0'} 
                            {...(searchQuery && { query: searchQuery })}
                            {...(isCaseSensitive !== undefined && { caseSensitive: isCaseSensitive })}
                            activeMatchIndex={targetMatchIndexInLine}
                        />
                    </div>
                );
            }}
        />
    );
};
VirtualizedPlaintext.displayName = 'VirtualizedPlaintext';
