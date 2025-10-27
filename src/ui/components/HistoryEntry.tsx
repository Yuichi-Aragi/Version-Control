import { moment } from 'obsidian';
import clsx from 'clsx';
import { type FC, type MouseEvent, type KeyboardEvent, useCallback, useEffect, useRef, memo, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '../../types';
import { formatFileSize } from '../utils/dom';
import { thunks } from '../../state/thunks';
import { actions } from '../../state/appSlice';
import { versionActions } from '../VersionActions';
import { Icon } from './Icon';
import type { AppStore } from '../../state/store';
import { useTime } from '../contexts/TimeContext';

interface HistoryEntryProps {
    version: VersionHistoryEntryType;
}

const MAX_NAME_LENGTH = 256;

export const HistoryEntry: FC<HistoryEntryProps> = memo(({ version }) => {
    const dispatch = useAppDispatch();
    const { settings, namingVersionId, highlightedVersionId } = useAppSelector(state => ({
        settings: state.settings ?? { isListView: true, useRelativeTimestamps: true },
        namingVersionId: state.namingVersionId,
        highlightedVersionId: state.highlightedVersionId,
    }));
    const { now } = useTime();

    const nameInputRef = useRef<HTMLInputElement | null>(null);
    const blurSaveTimerRef = useRef<number | null>(null);
    const isMountedRef = useRef(false);
    const isNamingThisVersion = version.id === namingVersionId;

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (blurSaveTimerRef.current !== null) {
                clearTimeout(blurSaveTimerRef.current);
                blurSaveTimerRef.current = null;
            }
        };
    }, []);

    const handleEntryClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch { /* noop */ }
        dispatch(thunks.viewVersionInPanel(version));
    }, [dispatch, version]);

    const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (e.target instanceof HTMLInputElement && e.target.classList.contains('v-version-name-input')) return;

        try {
            e.preventDefault();
            e.stopPropagation();
        } catch { /* noop */ }
        dispatch(thunks.showVersionContextMenu(version));
    }, [dispatch, version]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            try {
                e.preventDefault();
                e.stopPropagation();
            } catch { /* noop */ }
            dispatch(thunks.showVersionContextMenu(version));
        }
    }, [dispatch, version]);

    const saveName = useCallback(() => {
        try {
            const el = nameInputRef.current;
            if (!el) {
                dispatch(actions.stopVersionEditing());
                return;
            }
            const rawValue = String(el.value ?? '').trim().slice(0, MAX_NAME_LENGTH);
            const currentName = String(version.name ?? '');
            if (rawValue !== currentName) {
                dispatch(thunks.updateVersionDetails(version.id, rawValue));
            } else {
                dispatch(actions.stopVersionEditing());
            }
        } catch (err) {
            console.error('HistoryEntry.saveName error:', err);
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch, version]);

    const handleNameInputBlur = useCallback(() => {
        if (blurSaveTimerRef.current !== null) clearTimeout(blurSaveTimerRef.current);
        blurSaveTimerRef.current = window.setTimeout(() => {
            blurSaveTimerRef.current = null;
            if (isMountedRef.current) saveName();
        }, 150);
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
            const id = window.setTimeout(() => {
                try {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                } catch {
                    /* ignore focus errors */
                }
            }, 0);
            return () => {
                window.clearTimeout(id);
            };
        }
        return;
    }, [isNamingThisVersion]);

    const { timestampText, tooltipTimestamp } = useMemo(() => {
        const m = (moment as any)(version.timestamp);
        if (!m.isValid()) {
            return { timestampText: 'Invalid date', tooltipTimestamp: 'Invalid date' };
        }

        // The `now` dependency from useTime() ensures this memo re-evaluates periodically
        // for live relative timestamp updates.
        const text = settings?.useRelativeTimestamps ? m.fromNow() : m.format('YYYY-MM-DD HH:mm');
        const tooltip = m.format('LLLL');
        
        return { timestampText: text, tooltipTimestamp: tooltip };
    }, [version.timestamp, settings?.useRelativeTimestamps, now]);

    const safeActions = Array.isArray(versionActions) ? versionActions : [];

    return (
        <div
            className={clsx('v-history-entry', {
                'is-list-view': settings?.isListView,
                'is-naming': isNamingThisVersion,
                'is-highlighted': version.id === highlightedVersionId,
            })}
            role="listitem"
            tabIndex={0}
            onClick={handleEntryClick}
            onContextMenu={handleContextMenu}
            onKeyDown={handleKeyDown}
            aria-selected={version.id === highlightedVersionId}
            data-version-id={String(version.id)}
        >
            <div className="v-entry-header">
                <span className="v-version-id" aria-hidden>V{String(version.versionNumber ?? '')}</span>

                {isNamingThisVersion ? (
                    <input
                        ref={nameInputRef}
                        type="text"
                        className="v-version-name-input"
                        defaultValue={String(version.name ?? '')}
                        placeholder="Version name..."
                        aria-label="Version name input"
                        onBlur={handleNameInputBlur}
                        onKeyDown={handleNameInputKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        maxLength={MAX_NAME_LENGTH}
                    />
                ) : (
                    <div className="v-entry-main-info">
                        {version.name ? (
                            <div className="v-version-name">{version.name}</div>
                        ) : (
                            <div className="v-version-name is-empty" />
                        )}
                    </div>
                )}

                <span className="v-version-timestamp" title={tooltipTimestamp}>
                    {timestampText}
                </span>
            </div>

            <div className="v-version-content" aria-hidden>Size: {formatFileSize(typeof version.size === 'number' ? version.size : 0)}</div>

            {!settings?.isListView && (
                <div className="v-entry-footer">
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
                            try {
                                if (typeof action.actionHandler === 'function') {
                                    action.actionHandler(version, { dispatch } as unknown as AppStore);
                                } else {
                                    console.warn('HistoryEntry: action missing handler', action);
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
                </div>
            )}
        </div>
    );
});
HistoryEntry.displayName = 'HistoryEntry';
