import { type FC, memo } from 'react';
import clsx from 'clsx';
import { useAppDispatch } from '@/ui/hooks';
import { thunks } from '@/state';
import { versionActions } from '@/ui/VersionActions';
import { editActions } from '@/ui/EditActions';
import { Icon } from '@/ui/components';
import type { AppStore } from '@/state';
import type { EntryActionsProps } from '@/ui/components/HistoryEntry/types';

export const EntryActions: FC<EntryActionsProps> = memo(({
    version,
    showFooterDescription,
    viewMode,
    isEditButtonAction,
}) => {
    const dispatch = useAppDispatch();
    const actionsList = viewMode === 'edits' ? editActions : versionActions;
    const safeActions = Array.isArray(actionsList) ? actionsList : [];

    if (showFooterDescription) {
        return null;
    }

    return (
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
    );
});

EntryActions.displayName = 'EntryActions';
