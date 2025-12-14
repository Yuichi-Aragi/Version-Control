import { useCallback, useRef, useEffect, type MouseEvent, type KeyboardEvent, type FocusEvent } from 'react';
import { useAppDispatch } from '@/ui/hooks';
import type { VersionHistoryEntry as VersionHistoryEntryType, ViewMode } from '@/types';
import { thunks, appSlice } from '@/state';
import { trimName, trimDescription, hasChanged } from '@/ui/components/HistoryEntry/utils';

export function useEntryActions(
    version: VersionHistoryEntryType,
    viewMode: ViewMode,
    namingVersionId: string | null,
    isNamingThisVersion: boolean,
    nameValue: string,
    descValue: string,
    entryRef: React.RefObject<HTMLDivElement | null>,
    ignoreBlurRef: React.MutableRefObject<boolean>
) {
    const dispatch = useAppDispatch();
    const isEditButtonAction = useRef(false);
    const shouldIgnoreClickRef = useRef(false);

    const saveDetails = useCallback(() => {
        try {
            const rawName = trimName(nameValue);
            const rawDesc = trimDescription(descValue);

            const currentName = String(version.name ?? '');
            const currentDesc = String(version.description ?? '');

            if (hasChanged(currentName, rawName) || hasChanged(currentDesc, rawDesc)) {
                if (viewMode === 'edits') {
                    dispatch(thunks.updateEditDetails(version.id, { name: rawName, description: rawDesc }));
                } else {
                    dispatch(thunks.updateVersionDetails(version.id, { name: rawName, description: rawDesc }));
                }
            } else {
                dispatch(appSlice.actions.stopVersionEditing());
            }
        } catch (err) {
            console.error('HistoryEntry.saveDetails error:', err);
            dispatch(appSlice.actions.stopVersionEditing());
        }
    }, [dispatch, version.id, version.name, version.description, nameValue, descValue, viewMode]);

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

    const handleContainerBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
        if (ignoreBlurRef.current) return;
        if (isEditButtonAction.current) {
            isEditButtonAction.current = false;
            return;
        }
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            saveDetails();
        }
    }, [saveDetails, ignoreBlurRef]);

    const handleNameInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            saveDetails();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dispatch(appSlice.actions.stopVersionEditing());
        }
    }, [dispatch, saveDetails]);

    const handleDescTextareaKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            dispatch(appSlice.actions.stopVersionEditing());
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            saveDetails();
        }
    }, [dispatch, saveDetails]);

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
    }, [isNamingThisVersion, saveDetails, entryRef]);

    return {
        isEditButtonAction,
        handleMouseDown,
        handleEntryClick,
        handleContextMenu,
        handleKeyDown,
        handleContainerBlur,
        handleNameInputKeyDown,
        handleDescTextareaKeyDown,
        saveDetails,
    };
}
