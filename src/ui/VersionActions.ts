import type { AppStore } from '@/state'; 
import type { VersionHistoryEntry } from '@/types';
import { thunks } from '@/state';

export interface VersionActionConfig {
    id: string;
    title: string;
    icon: string;
    tooltip: string;
    isDanger?: boolean;
    /**
     * The action handler now only needs to know about the version and the store,
     * as it will dispatch a thunk to handle the operation.
     */
    actionHandler: (version: VersionHistoryEntry, store: AppStore) => void;
}

/**
 * Defines the data and associated thunks for each version action.
 * This array is now pure data, completely decoupled from UI creation.
 */
export const versionActions: VersionActionConfig[] = [
    {
        id: 'restore',
        title: 'Restore this version',
        icon: 'rotate-ccw',
        tooltip: 'Restore current note to this version',
        actionHandler: (version, store) => store.dispatch(thunks.requestRestore(version)),
    },
    {
        id: 'diff',
        title: 'Diff this version',
        icon: 'diff',
        tooltip: 'Compare this version with another',
        actionHandler: (version, store) => store.dispatch(thunks.requestDiff(version)),
    },
    {
        id: 'edit',
        title: 'Edit Details',
        icon: 'edit-3',
        tooltip: 'Edit the name and description for this version',
        actionHandler: (version, store) => store.dispatch(thunks.requestEditVersion(version)),
    },
    {
        id: 'deviation',
        title: 'Create new note from version',
        icon: 'git-branch', 
        tooltip: 'Create a new note using this version\'s content',
        actionHandler: (version, store) => store.dispatch(thunks.createDeviation(version)),
    },
    {
        id: 'export-single',
        title: 'Export this version',
        icon: 'download',
        tooltip: 'Export this specific version to a file',
        actionHandler: (version, store) => store.dispatch(thunks.requestExportSingleVersion(version)),
    },
    {
        id: 'delete',
        title: 'Delete this version',
        icon: 'trash-2', 
        tooltip: 'Permanently delete this version',
        isDanger: true, 
        actionHandler: (version, store) => store.dispatch(thunks.requestDelete(version)),
    },
];
