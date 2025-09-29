import { moment } from 'obsidian';
import clsx from 'clsx';
import { type FC, type MouseEvent, type KeyboardEvent, useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '../../types';
import { formatFileSize } from '../utils/dom';
import { thunks } from '../../state/thunks';
import { actions } from '../../state/appSlice';
import { versionActions } from '../VersionActions';
import { Icon } from './Icon';
import type { AppStore } from '../../state/store';
import { useRelativeTime } from '../hooks/useRelativeTime';

interface HistoryEntryProps {
    version: VersionHistoryEntryType;
}

export const HistoryEntry: FC<HistoryEntryProps> = ({ version }) => {
    const dispatch = useAppDispatch();
    const { settings, namingVersionId, highlightedVersionId } = useAppSelector(state => ({
        settings: state.settings,
        namingVersionId: state.namingVersionId,
        highlightedVersionId: state.highlightedVersionId,
    }));
    const nameInputRef = useRef<HTMLInputElement>(null);
    const isNamingThisVersion = version.id === namingVersionId;

    const handleEntryClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch(thunks.viewVersionInPanel(version));
    }, [dispatch, version]);

    const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (e.target instanceof HTMLInputElement && e.target.classList.contains('v-version-name-input')) return;
        e.preventDefault();
        e.stopPropagation();
        dispatch(thunks.showVersionContextMenu(version));
    }, [dispatch, version]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            dispatch(thunks.showVersionContextMenu(version));
        }
    }, [dispatch, version]);

    const saveName = useCallback(() => {
        if (!nameInputRef.current) return;
        const rawValue = nameInputRef.current.value.trim();
        if (rawValue !== (version.name || '')) {
            dispatch(thunks.updateVersionDetails(version.id, rawValue));
        } else {
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch, version]);

    const handleNameInputBlur = useCallback(() => {
        setTimeout(saveName, 150);
    }, [saveName]);

    const handleNameInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            nameInputRef.current?.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch]);

    useEffect(() => {
        if (isNamingThisVersion && nameInputRef.current) {
            const input = nameInputRef.current;
            const focusTimer = setTimeout(() => {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }, 0);
            return () => clearTimeout(focusTimer);
        }
        return; // Explicitly return for all code paths.
    }, [isNamingThisVersion]);

    const relativeTimestamp = useRelativeTime(new Date(version.timestamp).getTime());
    const timestampText = settings.useRelativeTimestamps ? relativeTimestamp : (moment as any)(version.timestamp).format("YYYY-MM-DD HH:mm");

    return (
        <div
            className={clsx('v-history-entry', {
                'is-list-view': settings.isListView,
                'is-naming': isNamingThisVersion,
                'is-highlighted': version.id === highlightedVersionId,
            })}
            role="listitem"
            tabIndex={0}
            onClick={handleEntryClick}
            onContextMenu={handleContextMenu}
            onKeyDown={handleKeyDown}
        >
            <div className="v-entry-header">
                <span className="v-version-id">V{version.versionNumber}</span>
                {isNamingThisVersion ? (
                    <input
                        ref={nameInputRef}
                        type="text"
                        className="v-version-name-input"
                        defaultValue={version.name || ''}
                        placeholder="Version name..."
                        aria-label="Version name input"
                        onBlur={handleNameInputBlur}
                        onKeyDown={handleNameInputKeyDown}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : settings.isListView ? (
                    <div className="v-entry-main-info">
                        {version.name ? (
                            <div className="v-version-name" title={version.name}>{version.name}</div>
                        ) : (
                            <div className="v-version-name is-empty" />
                        )}
                    </div>
                ) : (
                    version.name && <div className="v-version-name" title={version.name}>{version.name}</div>
                )}
                <span className="v-version-timestamp" title={(moment as any)(version.timestamp).format("LLLL")}>
                    {timestampText}
                </span>
            </div>
            {!settings.isListView && (
                <>
                    <div className="v-version-content">Size: {formatFileSize(version.size)}</div>
                    <div className="v-entry-footer">
                        <button className="v-action-btn" aria-label="Preview in panel" title="Preview in panel" onClick={(e) => { e.stopPropagation(); dispatch(thunks.viewVersionInPanel(version)); }}>
                            <Icon name="eye" />
                        </button>
                        {versionActions.map(action => (
                            <button
                                key={action.id}
                                className={clsx('v-action-btn', { 'danger': action.isDanger })}
                                aria-label={action.tooltip}
                                title={action.tooltip}
                                onClick={(e) => { e.stopPropagation(); action.actionHandler(version, { dispatch } as AppStore); }}
                            >
                                <Icon name={action.icon} />
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
