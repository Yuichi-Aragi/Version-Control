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
import { useRelativeTime } from '../hooks/useRelativeTime';

/** Defensive timestamp formatter for display text */
function formatTimestampSafe(raw: unknown, useRelative: boolean, relativeText: string): string {
    if (useRelative && relativeText) return relativeText;
    try {
        // Justification for `as any`: The 'moment' object from Obsidian's API is a callable
        // function, but its type definition is not always correctly inferred as such by TypeScript.
        // This assertion bypasses the static check. The surrounding try/catch block and explicit
        // validation provide runtime safety against unexpected failures or invalid moment objects.
        const m = (moment as any)(raw);
        if (m && typeof m.format === 'function' && m.isValid()) {
            return m.format('YYYY-MM-DD HH:mm');
        }
    } catch {
        // Fallthrough on moment error
    }
    try {
        const d = new Date(String(raw));
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    } catch {
        /* swallow */
    }
    return '';
}

/** Defensive timestamp formatter for tooltips (always absolute) */
function formatAbsoluteTimestamp(raw: unknown, formatStr: string): string {
    if (raw === null || typeof raw === 'undefined') {
        return '';
    }
    try {
        // Justification for `as any`: The 'moment' object from Obsidian's API is a callable
        // function, but its type definition is not always correctly inferred as such by TypeScript.
        // This assertion bypasses the static check. The surrounding try/catch block and explicit
        // validation provide runtime safety against unexpected failures or invalid moment objects.
        const m = (moment as any)(raw);
        if (m && typeof m.format === 'function' && m.isValid()) {
            return m.format(formatStr);
        }
    } catch {
        // Fallthrough on moment error
    }
    // Fallback for non-moment-compatible formats
    try {
        const d = new Date(String(raw));
        if (!Number.isNaN(d.getTime())) {
            // Provide a reasonable fallback if moment fails
            return d.toLocaleString();
        }
    } catch {
        // Fallthrough on Date error
    }
    // Last resort, return the raw value as a string
    return String(raw);
}


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
        // Keep click behavior minimal and defensive
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch { /* noop */ }
        dispatch(thunks.viewVersionInPanel(version));
    }, [dispatch, version]);

    const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
        // Allow normal input behavior when interacting with the name input
        if (e.target instanceof HTMLInputElement && e.target.classList.contains('v-version-name-input')) return;

        try {
            e.preventDefault();
            e.stopPropagation();
        } catch { /* noop */ }
        dispatch(thunks.showVersionContextMenu(version));
    }, [dispatch, version]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        // Accessible keyboard support: Enter/Space opens context menu
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
                // Only dispatch if changed
                dispatch(thunks.updateVersionDetails(version.id, rawValue));
            } else {
                dispatch(actions.stopVersionEditing());
            }
        } catch (err) {
            // swallow to avoid bubbling to React
            // eslint-disable-next-line no-console
            console.error('HistoryEntry.saveName error:', err);
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch, version]);

    const handleNameInputBlur = useCallback(() => {
        // Use a short delay to allow click events on surrounding controls to be handled first.
        // Timer is cleared on unmount to avoid setting state when unmounted.
        if (blurSaveTimerRef.current !== null) clearTimeout(blurSaveTimerRef.current);
        // Using window.setTimeout so we can clear with window.clearTimeout in cleanup
        blurSaveTimerRef.current = window.setTimeout(() => {
            blurSaveTimerRef.current = null;
            if (isMountedRef.current) saveName();
        }, 150);
    }, [saveName]);

    const handleNameInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            // blur will call saveName via timer
            nameInputRef.current?.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dispatch(actions.stopVersionEditing());
        }
    }, [dispatch]);

    useEffect(() => {
        if (isNamingThisVersion && nameInputRef.current) {
            // Defer focus to next event loop for safety
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
        return; // explicit return
    }, [isNamingThisVersion]);

    // compute timestamp text defensively
    const timestampValue = useMemo(() => {
        const t = new Date(String(version.timestamp)).getTime();
        // The hook validates, but providing a stable invalid value is good practice.
        // 0 is a safe invalid value that isValidTimestamp will reject.
        return Number.isFinite(t) ? t : 0;
    }, [version.timestamp]);
    const relativeTimestamp = useRelativeTime(timestampValue);
    const timestampText = formatTimestampSafe(version.timestamp, Boolean(settings?.useRelativeTimestamps), relativeTimestamp);

    // Guard versionActions usage: it's an array of action descriptors (defensive)
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
                ) : settings?.isListView ? (
                    <div className="v-entry-main-info">
                        {version.name ? (
                            <div className="v-version-name">{version.name}</div>
                        ) : (
                            <div className="v-version-name is-empty" />
                        )}
                    </div>
                ) : (
                    version.name && <div className="v-version-name">{version.name}</div>
                )}

                <span className="v-version-timestamp" title={formatAbsoluteTimestamp(version.timestamp, 'LLLL')}>
                    {timestampText}
                </span>
            </div>

            {!settings?.isListView && (
                <>
                    <div className="v-version-content" aria-hidden>Size: {formatFileSize(typeof version.size === 'number' ? version.size : 0)}</div>

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
                                        // Be defensive about the handler signature
                                        action.actionHandler(version, { dispatch } as unknown as AppStore);
                                    } else {
                                        // eslint-disable-next-line no-console
                                        console.warn('HistoryEntry: action missing handler', action);
                                    }
                                } catch (err) {
                                    // don't let action exceptions bubble to our UI
                                    // eslint-disable-next-line no-console
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
                </>
            )}
        </div>
    );
});
HistoryEntry.displayName = 'HistoryEntry';
