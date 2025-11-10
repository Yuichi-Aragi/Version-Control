import { debounce, moment } from 'obsidian';
import clsx from 'clsx';
import { orderBy } from 'lodash-es';
import { type FC, useCallback, useEffect, useMemo, useRef, useState, memo, useTransition, Fragment, useLayoutEffect, type FocusEvent, type KeyboardEvent } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { actions } from '../../../state/appSlice';
import { thunks } from '../../../state/thunks';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '../../../types';
import { formatFileSize } from '../../utils/dom';
import { escapeRegExp } from '../../utils/strings';
import { Icon } from '../Icon';
import { useTime } from '../../contexts/TimeContext';
import { usePanelClose } from '../../hooks/usePanelClose';
import { useBackdropClick } from '../../hooks/useBackdropClick';
import { useDelayedFocus } from '../../hooks/useDelayedFocus';

const HighlightedText: FC<{ text: string; highlight: string; isCaseSensitive: boolean }> = ({ text, highlight, isCaseSensitive }) => {
    if (!highlight.trim() || !text) {
        return <>{text}</>;
    }
    try {
        const regex = new RegExp(`(${escapeRegExp(highlight)})`, isCaseSensitive ? 'g' : 'gi');
        const parts = text.split(regex);
        return (
            <>
                {parts.map((part, i) =>
                    regex.test(part) ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>
                )}
            </>
        );
    } catch (e) {
        return <>{text}</>;
    }
};

const MAX_NAME_LENGTH = 256;
const MAX_DESC_LENGTH = 2048;

interface DescriptionEntryProps {
    version: VersionHistoryEntryType;
    searchQuery: string;
    isCaseSensitive: boolean;
}

const DescriptionEntry: FC<DescriptionEntryProps> = memo(({ version, searchQuery, isCaseSensitive }) => {
    const dispatch = useAppDispatch();
    const { now } = useTime();
    const { settings, namingVersionId, isManualVersionEdit } = useAppSelector(state => ({
        settings: state.settings,
        namingVersionId: state.namingVersionId,
        isManualVersionEdit: state.isManualVersionEdit,
    }));

    const entryRef = useRef<HTMLDivElement | null>(null);
    const nameInputRef = useRef<HTMLInputElement | null>(null);
    const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const isNamingThisVersion = version.id === namingVersionId;
    const ignoreBlurRef = useRef(false);

    const [nameValue, setNameValue] = useState('');
    const [descValue, setDescValue] = useState('');

    useEffect(() => {
        if (isNamingThisVersion) {
            setNameValue(version.name ?? '');
            setDescValue(version.description ?? '');
            
            // When editing starts, ignore blur events for a short period.
            // This prevents the blur caused by the context menu closing from
            // immediately exiting edit mode.
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
            console.error('DescriptionEntry.saveDetails error:', err);
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch, version.id, version.name, version.description, nameValue, descValue]);

    // Handles clicks outside the component to save and exit editing mode.
    useEffect(() => {
        if (!isNamingThisVersion) return;

        const handleClickOutside = (event: globalThis.MouseEvent) => {
            if (entryRef.current && !entryRef.current.contains(event.target as Node)) {
                saveDetails();
            }
        };

        // Add listener on next tick to avoid capturing the click that initiated the edit mode.
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isNamingThisVersion, saveDetails]);

    const handleContainerBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
        if (ignoreBlurRef.current) {
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

    const timestampText = useMemo(() => {
        const m = (moment as any)(version.timestamp);
        return m.isValid() ? m.fromNow() : 'Invalid date';
    }, [version.timestamp, now]);

    const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target instanceof HTMLElement && (e.target.matches('input, textarea'))) return;
        e.preventDefault();
        e.stopPropagation();
        dispatch(thunks.showVersionContextMenu(version));
    }, [dispatch, version]);
    
    const showNameEditor = isNamingThisVersion && (isManualVersionEdit || settings.enableVersionNaming);
    const showDescEditor = isNamingThisVersion && (isManualVersionEdit || settings.enableVersionDescription);

    return (
        <div
            ref={entryRef}
            className={clsx("v-description-entry", { 'is-naming': isNamingThisVersion })}
            onContextMenu={handleContextMenu}
            onBlur={isNamingThisVersion ? handleContainerBlur : undefined}
        >
            <div className="v-description-entry-header">
                <span className="v-version-id">
                    <HighlightedText text={`V${version.versionNumber}`} highlight={searchQuery} isCaseSensitive={isCaseSensitive} />
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
                    <div className="v-description-entry-name">
                        <HighlightedText text={version.name || 'Untitled Version'} highlight={searchQuery} isCaseSensitive={isCaseSensitive} />
                    </div>
                )}
                <div className="v-description-entry-meta">
                    <span>{timestampText}</span>
                    <span>{formatFileSize(version.size)}</span>
                </div>
            </div>
            {(showDescEditor || (isNamingThisVersion && isManualVersionEdit)) ? (
                <div className="v-description-entry-description-editor">
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
            ) : version.description ? (
                <div className="v-description-entry-body">
                    <HighlightedText text={version.description} highlight={searchQuery} isCaseSensitive={isCaseSensitive} />
                </div>
            ) : null}
        </div>
    );
});
DescriptionEntry.displayName = 'DescriptionEntry';

export const DescriptionPanel: FC = () => {
    const dispatch = useAppDispatch();
    const { history, sortOrder } = useAppSelector(state => ({
        history: state.history,
        sortOrder: state.sortOrder,
    }));

    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [isCaseSensitive, setIsCaseSensitive] = useState(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [isPending, startTransition] = useTransition();
    const [processedHistory, setProcessedHistory] = useState<VersionHistoryEntryType[]>([]);

    useEffect(() => {
        startTransition(() => {
            const versionsWithDetails = history.filter(v => (v.description && v.description.trim() !== '') || (v.name && v.name.trim() !== ''));
            const trimmedQuery = searchQuery.trim();
            let filtered = versionsWithDetails;

            if (trimmedQuery) {
                const query = isCaseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
                filtered = versionsWithDetails.filter(v => {
                    const name = v.name || '';
                    const desc = v.description || '';
                    const versionNum = `V${v.versionNumber}`;
                    const searchable = `${name} ${desc} ${versionNum}`;
                    return isCaseSensitive ? searchable.includes(query) : searchable.toLowerCase().includes(query);
                });
            }
            const result = orderBy(filtered, [sortOrder.property], [sortOrder.direction]);
            setProcessedHistory(result);
        });
    }, [history, searchQuery, isCaseSensitive, sortOrder]);

    const debouncedSetSearchQuery = useCallback(debounce(setSearchQuery, 300, true), []);

    const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalSearchQuery(e.target.value);
        debouncedSetSearchQuery(e.target.value);
    }, [debouncedSetSearchQuery]);

    const handleToggleSearch = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setIsSearchActive(v => !v);
    }, []);

    const handleClearSearch = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setLocalSearchQuery('');
        setSearchQuery('');
        searchInputRef.current?.focus();
    }, []);

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') handleToggleSearch();
    };

    const handleClose = usePanelClose();
    const handleBackdropClick = useBackdropClick(handleClose);

    const handleShowSortMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        dispatch(thunks.showSortMenu());
    }, [dispatch]);

    useDelayedFocus(searchInputRef, 100, isSearchActive);

    return (
        <div className="v-panel-container is-active is-inset-modal" onClick={handleBackdropClick}>
            <div className="v-inline-panel v-description-panel">
                <div className={clsx("v-panel-header", { 'is-searching': isSearchActive })}>
                    <div className="v-panel-header-content">
                        <h3>Version Details</h3>
                        <div className="v-panel-header-actions">
                            <button className="clickable-icon" aria-label="Search details" onClick={handleToggleSearch}>
                                <Icon name="search" />
                            </button>
                            <button className="clickable-icon" aria-label="Sort options" onClick={handleShowSortMenu}>
                                <Icon name="filter" />
                            </button>
                        </div>
                    </div>
                    <div className="v-panel-search-bar-container">
                        <div className="v-search-input-wrapper">
                            <div className="v-search-icon" role="button" aria-label="Close search" onClick={handleToggleSearch}>
                                <Icon name="x-circle" />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="search"
                                placeholder="Search name, description, or version..."
                                value={localSearchQuery}
                                onChange={handleSearchInputChange}
                                onKeyDown={handleSearchKeyDown}
                            />
                            <div className="v-search-input-buttons">
                                <button className={clsx('clickable-icon', { 'is-active': isCaseSensitive })} aria-label="Toggle case sensitivity" onClick={() => setIsCaseSensitive(v => !v)}>
                                    <Icon name="case-sensitive" />
                                </button>
                                <button className={clsx('clickable-icon', { 'is-hidden': !localSearchQuery })} aria-label="Clear search" onClick={handleClearSearch}>
                                    <Icon name="x" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className={clsx("v-description-panel-list", { 'is-searching-bg': isPending })}>
                    {processedHistory.length > 0 ? (
                        <Virtuoso
                            ref={virtuosoRef}
                            className="v-virtuoso-container"
                            data={processedHistory}
                            defaultItemHeight={150}
                            itemContent={(_index, version) => (
                                <div className="v-description-entry-wrapper">
                                    <DescriptionEntry version={version} searchQuery={searchQuery} isCaseSensitive={isCaseSensitive} />
                                </div>
                            )}
                        />
                    ) : (
                        <div className="v-empty-state">
                            <div className="v-empty-state-icon"><Icon name={searchQuery ? "search-x" : "file-text"} /></div>
                            <p className="v-empty-state-title">{searchQuery ? "No Matches Found" : "No Details"}</p>
                            <p className="v-empty-state-subtitle v-meta-label">
                                {searchQuery ? "Try a different search query." : "Versions with a name or description will appear here."}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
