import clsx from 'clsx';
import { type FC, useRef, memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAppSelector } from '@/ui/hooks';
import { useTime } from '@/ui/contexts';
import { HighlightedText } from '@/ui/components/shared/HighlightedText';
import { EntryHeader, EntryMetadata, EntryActions, EntryEditor } from '@/ui/components/HistoryEntry/components';
import { useEntryEdit, useEntryActions, useEntryHighlight } from '@/ui/components/HistoryEntry/hooks';
import { formatTimestamp, getDisplaySize, getStatCounts } from '@/ui/components/HistoryEntry/utils';
import type { HistoryEntryProps } from '@/ui/components/HistoryEntry/types';

export const HistoryEntry: FC<HistoryEntryProps> = memo(({ version, searchQuery, isSearchCaseSensitive, viewMode = 'versions' }) => {
    const { settings, enableCompression, namingVersionId, highlightedVersionId, isManualVersionEdit, isSearchActive } = useAppSelector(state => ({
        settings: state.app.effectiveSettings,
        enableCompression: state.app.settings.enableCompression,
        namingVersionId: state.app.namingVersionId,
        highlightedVersionId: state.app.highlightedVersionId,
        isManualVersionEdit: state.app.isManualVersionEdit,
        isSearchActive: state.app.isSearchActive,
    }));
    const { now } = useTime();

    const entryRef = useRef<HTMLDivElement | null>(null);
    const nameInputRef = useRef<HTMLInputElement | null>(null);
    const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const isNamingThisVersion = version.id === namingVersionId;

    const { nameValue, setNameValue, descValue, setDescValue, ignoreBlurRef } = useEntryEdit(
        isNamingThisVersion,
        version,
        descTextareaRef
    );

    const {
        isEditButtonAction,
        handleMouseDown,
        handleEntryClick,
        handleContextMenu,
        handleKeyDown,
        handleContainerBlur,
        handleNameInputKeyDown,
        handleDescTextareaKeyDown,
    } = useEntryActions(
        version,
        viewMode,
        namingVersionId,
        isNamingThisVersion,
        nameValue,
        descValue,
        entryRef,
        ignoreBlurRef
    );

    useEntryHighlight(
        isNamingThisVersion,
        nameInputRef,
        descTextareaRef,
        isManualVersionEdit,
        settings.enableVersionNaming
    );

    const { timestampText, tooltipTimestamp } = useMemo(
        () => formatTimestamp(version.timestamp, settings?.useRelativeTimestamps, now),
        [version.timestamp, settings?.useRelativeTimestamps, now]
    );

    const showNameEditor = isNamingThisVersion && (isManualVersionEdit || settings.enableVersionNaming);
    const showDescEditor = isNamingThisVersion && (isManualVersionEdit || settings.enableVersionDescription);

    const { wordCount, charCount, lineCount } = getStatCounts(version, settings);

    const hasDescription = !!version.description && version.description.trim().length > 0;
    const shouldShowDescription = hasDescription && (isSearchActive || settings.showDescriptionInList);
    const showFooterDescription = shouldShowDescription && !settings.isListView;
    const showListDescription = shouldShowDescription && settings.isListView;

    const prefix = viewMode === 'edits' ? 'E' : 'V';
    const placeholderName = viewMode === 'edits' ? 'Edit name...' : 'Version name...';
    const placeholderDesc = viewMode === 'edits' ? 'Edit description...' : 'Version description...';

    const displaySize = useMemo(
        () => getDisplaySize(enableCompression, version),
        [enableCompression, version]
    );

    // Hover animation props (applied only when not in list view or naming)
    const hoverProps = (!settings.isListView && !isNamingThisVersion) 
        ? { whileHover: { y: -2 }, whileTap: { y: -1 } } 
        : {};

    return (
        <motion.div
            ref={entryRef}
            className={clsx('v-history-entry', {
                'is-list-view': settings?.isListView,
                'is-naming': isNamingThisVersion,
                'is-highlighted': version.id === highlightedVersionId,
            })}
            role="listitem"
            tabIndex={0}
            onClick={handleEntryClick}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
            onKeyDown={handleKeyDown}
            onBlur={isNamingThisVersion ? handleContainerBlur : undefined}
            aria-selected={version.id === highlightedVersionId}
            data-version-id={String(version.id)}
            
            // Removed Motion entry animations (initial, animate, exit)
            // Relies on CSS animation in historylist.css for reliable virtual list rendering
            {...hoverProps}
        >
            <EntryHeader
                version={version}
                searchQuery={searchQuery}
                isSearchCaseSensitive={isSearchCaseSensitive}
                showNameEditor={showNameEditor}
                nameValue={nameValue}
                setNameValue={setNameValue}
                placeholderName={placeholderName}
                timestampText={timestampText}
                tooltipTimestamp={tooltipTimestamp}
                handleNameInputKeyDown={handleNameInputKeyDown}
                prefix={prefix}
                nameInputRef={nameInputRef}
            />

            <EntryMetadata
                searchQuery={searchQuery}
                isSearchCaseSensitive={isSearchCaseSensitive}
                displaySize={displaySize}
                wordCount={wordCount}
                charCount={charCount}
                lineCount={lineCount}
                enableWordCount={settings.enableWordCount}
                enableCharacterCount={settings.enableCharacterCount}
                enableLineCount={settings.enableLineCount}
            />

            <EntryEditor
                isVisible={showDescEditor || (isNamingThisVersion && isManualVersionEdit)}
                descValue={descValue}
                setDescValue={setDescValue}
                placeholderDesc={placeholderDesc}
                handleDescTextareaKeyDown={handleDescTextareaKeyDown}
                descTextareaRef={descTextareaRef}
            />

            {showListDescription && !isNamingThisVersion && (
                <div className="v-history-description">
                    <HighlightedText
                        text={version.description || ''}
                        {...(searchQuery && { query: searchQuery })}
                        {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                    />
                </div>
            )}

            {!settings?.isListView && (
                <div className={clsx("v-entry-footer", { 'v-is-hidden': isNamingThisVersion })}>
                    {showFooterDescription ? (
                        <div className="v-history-description">
                            <HighlightedText
                                text={version.description || ''}
                                {...(searchQuery && { query: searchQuery })}
                                {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                            />
                        </div>
                    ) : (
                        <EntryActions
                            version={version}
                            showFooterDescription={showFooterDescription}
                            viewMode={viewMode}
                            isEditButtonAction={isEditButtonAction}
                        />
                    )}
                </div>
            )}
        </motion.div>
    );
});

HistoryEntry.displayName = 'HistoryEntry';
