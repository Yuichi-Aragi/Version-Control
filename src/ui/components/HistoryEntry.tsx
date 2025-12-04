import { moment } from 'obsidian';
import clsx from 'clsx';
import { type FC, type MouseEvent, type KeyboardEvent, useCallback, useEffect, useRef, memo, useMemo, useState, useLayoutEffect, type FocusEvent } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '../../types';
import { formatFileSize } from '../utils/dom';
import { thunks } from '../../state/thunks';
import { actions } from '../../state/appSlice';
import { versionActions } from '../VersionActions';
import { Icon } from './Icon';
import type { AppStore } from '../../state/store';
import { useTime } from '../contexts/TimeContext';
import { HighlightedText } from './shared/HighlightedText';

interface HistoryEntryProps {
    version: VersionHistoryEntryType;
    searchQuery?: string;
    isSearchCaseSensitive?: boolean;
}

const MAX_NAME_LENGTH = 256;
const MAX_DESC_LENGTH = 2048;

export const HistoryEntry: FC<HistoryEntryProps> = memo(({ version, searchQuery, isSearchCaseSensitive }) => {
    const dispatch = useAppDispatch();
    const { settings, namingVersionId, highlightedVersionId, isManualVersionEdit, isSearchActive } = useAppSelector(state => ({
        settings: state.settings,
        namingVersionId: state.namingVersionId,
        highlightedVersionId: state.highlightedVersionId,
        isManualVersionEdit: state.isManualVersionEdit,
        isSearchActive: state.isSearchActive,
    }));
    const { now } = useTime();

    const entryRef = useRef<HTMLDivElement | null>(null);
    const nameInputRef = useRef<HTMLInputElement | null>(null);
    const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    
    const ignoreBlurRef = useRef(false);
    const isEditButtonAction = useRef(false);
    const shouldIgnoreClickRef = useRef(false);

    const isNamingThisVersion = version.id === namingVersionId;

    const [nameValue, setNameValue] = useState('');
    const [descValue, setDescValue] = useState('');

    useEffect(() => {
        if (isNamingThisVersion) {
            setNameValue(version.name ?? '');
            setDescValue(version.description ?? '');
            ignoreBlurRef.current = true;
            const timer = setTimeout(() => { ignoreBlurRef.current = false; }, 150);
            return () => clearTimeout(timer);
        }
        return;
    }, [isNamingThisVersion, version.name, version.description]);

    useLayoutEffect(() => {
        const textarea = descTextareaRef.current;
        if (textarea && isNamingThisVersion) {
            textarea.style.height = 'inherit';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = `${scrollHeight}px`;
        }
    }, [descValue, isNamingThisVersion]);

    const handleMouseDown = useCallback((_e: MouseEvent<HTMLDivElement>) => {
        if (namingVersionId !== null) {
            shouldIgnoreClickRef.current = true;
        } else {
            shouldIgnoreClickRef.current = false;
        }
    }, [namingVersionId]);

    const handleEntryClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch { /* noop */ }

        if (shouldIgnoreClickRef.current) {
            shouldIgnoreClickRef.current = false;
            return;
        }

        dispatch(thunks.viewVersionInPanel(version));
    }, [dispatch, version]);

    const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (e.target instanceof HTMLElement && (e.target.matches('input, textarea'))) return;

        try {
            e.preventDefault();
            e.stopPropagation();
        } catch { /* noop */ }
        dispatch(thunks.showVersionContextMenu(version));
    }, [dispatch, version]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            if (e.target instanceof HTMLElement && (e.target.matches('input, textarea'))) return;
            try {
                e.preventDefault();
                e.stopPropagation();
            } catch { /* noop */ }
            dispatch(thunks.showVersionContextMenu(version));
        }
    }, [dispatch, version]);

    const saveDetails = useCallback(() => {
        try {
            const rawName = nameValue.trim().slice(0, MAX_NAME_LENGTH);
            const rawDesc = descValue.trim().slice(0, MAX_DESC_LENGTH);

            const currentName = String(version.name ?? '');
            const currentDesc = String(version.description ?? '');

            if (rawName !== currentName || rawDesc !== currentDesc) {
                dispatch(thunks.updateVersionDetails(version.id, { name: rawName, description: rawDesc }));
            } else {
                dispatch(actions.stopVersionEditing());
            }
        } catch (err) {
            console.error('HistoryEntry.saveDetails error:', err);
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch, version.id, version.name, version.description, nameValue, descValue]);

    useEffect(() => {
        if (!isNamingThisVersion) return;

        const handleClickOutside = (event: globalThis.MouseEvent) => {
            if (entryRef.current && !entryRef.current.contains(event.target as Node)) {
                saveDetails();
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isNamingThisVersion, saveDetails]);

    const handleContainerBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
        if (ignoreBlurRef.current) return;
        if (isEditButtonAction.current) {
            isEditButtonAction.current = false;
            return;
        }
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            saveDetails();
        }
    }, [saveDetails]);

    const handleNameInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            saveDetails();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch, saveDetails]);

    const handleDescTextareaKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            dispatch(actions.stopVersionEditing());
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            saveDetails();
        }
    }, [dispatch, saveDetails]);

    useEffect(() => {
        if (isNamingThisVersion) {
            const inputToFocus = (isManualVersionEdit || settings.enableVersionNaming) ? nameInputRef.current : descTextareaRef.current;
            if (inputToFocus) {
                const id = window.setTimeout(() => {
                    try {
                        inputToFocus.focus();
                        if (inputToFocus instanceof HTMLInputElement) {
                            inputToFocus.select();
                        }
                    } catch { /* ignore focus errors */ }
                }, 50);
                return () => window.clearTimeout(id);
            }
        }
        return;
    }, [isNamingThisVersion, settings.enableVersionNaming, isManualVersionEdit]);

    const { timestampText, tooltipTimestamp } = useMemo(() => {
        const m = (moment as any)(version.timestamp);
        if (!m.isValid()) {
            return { timestampText: 'Invalid date', tooltipTimestamp: 'Invalid date' };
        }
        const text = settings?.useRelativeTimestamps ? m.fromNow() : m.format('YYYY-MM-DD HH:mm');
        const tooltip = m.format('LLLL');
        return { timestampText: text, tooltipTimestamp: tooltip };
    }, [version.timestamp, settings?.useRelativeTimestamps, now]);

    const safeActions = Array.isArray(versionActions) ? versionActions : [];
    const showNameEditor = isNamingThisVersion && (isManualVersionEdit || settings.enableVersionNaming);
    const showDescEditor = isNamingThisVersion && (isManualVersionEdit || settings.enableVersionDescription);

    const wordCount = settings.includeMdSyntaxInWordCount ? version.wordCountWithMd : version.wordCount;
    const charCount = settings.includeMdSyntaxInCharacterCount ? version.charCountWithMd : version.charCount;
    const lineCount = settings.includeMdSyntaxInLineCount ? version.lineCount : version.lineCountWithoutMd;

    const hasDescription = !!version.description && version.description.trim().length > 0;
    const shouldShowDescription = hasDescription && (isSearchActive || settings.showDescriptionInList);
    const showFooterDescription = shouldShowDescription && !settings.isListView;
    const showListDescription = shouldShowDescription && settings.isListView;

    return (
        <div
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
        >
            <div className="v-entry-header">
                <span className="v-version-id" aria-hidden>
                    <HighlightedText 
                        text={`V${String(version.versionNumber ?? '')}`} 
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
                        placeholder="Version name..."
                        aria-label="Version name input"
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

            <div className="v-version-content" aria-hidden>
                <span>
                    Size: <HighlightedText 
                        text={formatFileSize(typeof version.size === 'number' ? version.size : 0)} 
                        {...(searchQuery && { query: searchQuery })}
                        {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                    />
                </span>
                {settings.enableWordCount && typeof wordCount === 'number' && (
                    <span>
                        Words: <HighlightedText 
                            text={String(wordCount)} 
                            {...(searchQuery && { query: searchQuery })}
                            {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                        />
                    </span>
                )}
                {settings.enableCharacterCount && typeof charCount === 'number' && (
                    <span>
                        Chars: <HighlightedText 
                            text={String(charCount)} 
                            {...(searchQuery && { query: searchQuery })}
                            {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                        />
                    </span>
                )}
                {settings.enableLineCount && typeof lineCount === 'number' && (
                    <span>
                        Lines: <HighlightedText 
                            text={String(lineCount)} 
                            {...(searchQuery && { query: searchQuery })}
                            {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                        />
                    </span>
                )}
            </div>
            
            {(showDescEditor || (isNamingThisVersion && isManualVersionEdit)) && (
                <div className="v-entry-description-editor">
                    <textarea
                        ref={descTextareaRef}
                        placeholder="Version description..."
                        aria-label="Version description input"
                        value={descValue}
                        onChange={(e) => setDescValue(e.target.value)}
                        onKeyDown={handleDescTextareaKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        maxLength={MAX_DESC_LENGTH}
                    />
                </div>
            )}

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
                <div className={clsx("v-entry-footer", { 'is-hidden': isNamingThisVersion })}>
                    {showFooterDescription ? (
                        <div className="v-history-description">
                            <HighlightedText 
                                text={version.description || ''} 
                                {...(searchQuery && { query: searchQuery })}
                                {...(isSearchCaseSensitive !== undefined && { caseSensitive: isSearchCaseSensitive })}
                            />
                        </div>
                    ) : (
                        <>
                            <button
                                className="v-action-btn"
                                aria-label="Preview in panel"
                                onClick={(e) => { e.stopPropagation(); dispatch(thunks.viewVersionInPanel(version)); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); dispatch(thunks.viewVersionInPanel(version)); } }}
                            >
                                <Icon name="eye" />
                            </button>

                            {safeActions.map(action => {
                                const handleAction = (e: React.SyntheticEvent) => {
                                    e.stopPropagation();
                                    if (action.id === 'edit') {
                                        isEditButtonAction.current = true;
                                    }
                                    try {
                                        if (typeof action.actionHandler === 'function') {
                                            action.actionHandler(version, { dispatch } as unknown as AppStore);
                                        }
                                    } catch (err) {
                                        console.error('HistoryEntry: action handler threw', err);
                                    }
                                };

                                return (
                                    <button
                                        key={String(action.id)}
                                        className={clsx('v-action-btn', { 'danger': Boolean(action.isDanger) })}
                                        aria-label={String(action.tooltip ?? '')}
                                        onClick={handleAction}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAction(e); } }}
                                    >
                                        <Icon name={String(action.icon ?? '')} />
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
            )}
        </div>
    );
});
HistoryEntry.displayName = 'HistoryEntry';
