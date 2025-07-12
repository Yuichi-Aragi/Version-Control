import type { AppStore } from '../state/store'; 
import type { VersionHistoryEntry } from '../types';
import { thunks } from '../state/thunks/index';

export interface VersionActionConfig {
    id: string;
    title: string;
    icon: string;
    tooltip:string;
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
        title: 'Restore This Version',
        icon: 'rotate-ccw',
        tooltip: 'Restore current note to this version',
        actionHandler: (version, store) => store.dispatch(thunks.requestRestore(version)),
    },
    {
        id: 'diff',
        title: 'Diff this Version',
        icon: 'diff',
        tooltip: 'Compare this version with another',
        actionHandler: (version, store) => store.dispatch(thunks.requestDiff(version)),
    },
    {
        id: 'edit',
        title: 'Edit Name',
        icon: 'edit-3',
        tooltip: 'Edit the name for this version',
        actionHandler: (version, store) => store.dispatch(thunks.requestEditVersion(version)),
    },
    {
        id: 'deviation',
        title: 'Create New Note From Version',
        icon: 'git-branch', 
        tooltip: 'Create a new note using this version\'s content',
        actionHandler: (version, store) => store.dispatch(thunks.createDeviation(version)),
    },
    {
        id: 'export-single',
        title: 'Export This Version',
        icon: 'download',
        tooltip: 'Export this specific version to a file',
        actionHandler: (version, store) => store.dispatch(thunks.requestExportSingleVersion(version)),
    },
    {
        id: 'delete',
        title: 'Delete This Version',
        icon: 'trash-2', 
        tooltip: 'Permanently delete this version',
        isDanger: true, 
        actionHandler: (version, store) => store.dispatch(thunks.requestDelete(version)),
    },
];
