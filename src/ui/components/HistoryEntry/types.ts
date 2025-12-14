import type { RefObject, KeyboardEvent } from 'react';
import type { VersionHistoryEntry as VersionHistoryEntryType, ViewMode } from '@/types';

export interface HistoryEntryProps {
    version: VersionHistoryEntryType;
    searchQuery?: string;
    isSearchCaseSensitive?: boolean;
    viewMode?: ViewMode;
}

export interface TimestampData {
    timestampText: string;
    tooltipTimestamp: string;
}

export interface MetadataProps {
    searchQuery?: string | undefined;
    isSearchCaseSensitive?: boolean | undefined;
    displaySize: number;
    wordCount: number | undefined;
    charCount: number | undefined;
    lineCount: number | undefined;
    enableWordCount: boolean;
    enableCharacterCount: boolean;
    enableLineCount: boolean;
}

export interface EntryHeaderProps {
    version: VersionHistoryEntryType;
    searchQuery?: string | undefined;
    isSearchCaseSensitive?: boolean | undefined;
    showNameEditor: boolean;
    nameValue: string;
    setNameValue: (value: string) => void;
    placeholderName: string;
    timestampText: string;
    tooltipTimestamp: string;
    handleNameInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    prefix: string;
    nameInputRef: RefObject<HTMLInputElement | null>;
}

export interface EntryEditorProps {
    isVisible: boolean;
    descValue: string;
    setDescValue: (value: string) => void;
    placeholderDesc: string;
    handleDescTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    descTextareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface EntryActionsProps {
    version: VersionHistoryEntryType;
    showFooterDescription: boolean;
    viewMode: ViewMode;
    isEditButtonAction: React.MutableRefObject<boolean>;
}

export const MAX_NAME_LENGTH = 256;
export const MAX_DESC_LENGTH = 2048;
