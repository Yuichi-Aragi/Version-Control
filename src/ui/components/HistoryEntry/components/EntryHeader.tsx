import { type FC, memo } from 'react';
import { HighlightedText } from '@/ui/components/shared/HighlightedText';
import { MAX_NAME_LENGTH, type EntryHeaderProps } from '@/ui/components/HistoryEntry/types';

export const EntryHeader: FC<EntryHeaderProps> = memo(({
    version,
    searchQuery,
    isSearchCaseSensitive,
    showNameEditor,
    nameValue,
    setNameValue,
    placeholderName,
    timestampText,
    tooltipTimestamp,
    handleNameInputKeyDown,
    prefix,
    nameInputRef,
}) => {
    return (
        <div className="v-entry-header">
            <span className="v-version-id" aria-hidden>
                <HighlightedText
                    text={`${prefix}${String(version.versionNumber ?? '')}`}
                    {...(searchQuery && { query: searchQuery })}
                    {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                />
            </span>

            {showNameEditor ? (
                <input
                    ref={nameInputRef}
                    type="text"
                    className="v-version-name-input"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    placeholder={placeholderName}
                    aria-label="Name input"
                    onKeyDown={handleNameInputKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    maxLength={MAX_NAME_LENGTH}
                />
            ) : (
                <div className="v-entry-main-info">
                    {version.name ? (
                        <div className="v-version-name">
                            <HighlightedText
                                text={version.name}
                                {...(searchQuery && { query: searchQuery })}
                                {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                            />
                        </div>
                    ) : (
                        <div className="v-version-name is-empty" />
                    )}
                </div>
            )}

            <span className="v-version-timestamp" title={tooltipTimestamp}>
                <HighlightedText
                    text={timestampText}
                    {...(searchQuery && { query: searchQuery })}
                    {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                />
            </span>
        </div>
    );
});

EntryHeader.displayName = 'EntryHeader';
