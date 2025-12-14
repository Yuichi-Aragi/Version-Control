import { type FC, memo } from 'react';
import { formatFileSize } from '@/ui/utils/dom';
import { HighlightedText } from '@/ui/components/shared/HighlightedText';
import type { MetadataProps } from '@/ui/components/HistoryEntry/types';

export const EntryMetadata: FC<MetadataProps> = memo(({
    searchQuery,
    isSearchCaseSensitive,
    displaySize,
    wordCount,
    charCount,
    lineCount,
    enableWordCount,
    enableCharacterCount,
    enableLineCount,
}) => {
    return (
        <div className="v-version-content" aria-hidden>
            <span>
                Size: <HighlightedText
                    text={formatFileSize(typeof displaySize === 'number' ? displaySize : 0)}
                    {...(searchQuery && { query: searchQuery })}
                    {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                />
            </span>
            {enableWordCount && typeof wordCount === 'number' && (
                <span>
                    Words: <HighlightedText
                        text={String(wordCount)}
                        {...(searchQuery && { query: searchQuery })}
                        {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                    />
                </span>
            )}
            {enableCharacterCount && typeof charCount === 'number' && (
                <span>
                    Chars: <HighlightedText
                        text={String(charCount)}
                        {...(searchQuery && { query: searchQuery })}
                        {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                    />
                </span>
            )}
            {enableLineCount && typeof lineCount === 'number' && (
                <span>
                    Lines: <HighlightedText
                        text={String(lineCount)}
                        {...(searchQuery && { query: searchQuery })}
                        {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                    />
                </span>
            )}
        </div>
    );
});

EntryMetadata.displayName = 'EntryMetadata';
