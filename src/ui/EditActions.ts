
import { thunks } from '../state/thunks/index';
import type { VersionActionConfig } from './VersionActions';

export const editActions: VersionActionConfig[] = [
    {
        id: 'restore',
        title: 'Restore this edit',
        icon: 'rotate-ccw',
        tooltip: 'Restore current note to this edit',
        actionHandler: (version, store) => store.dispatch(thunks.requestRestoreEdit(version)),
    },
    {
        id: 'diff',
        title: 'Diff this edit',
        icon: 'diff',
        tooltip: 'Compare this edit with another',
        actionHandler: (version, store) => store.dispatch(thunks.requestDiff(version)),
    },
    {
        id: 'edit',
        title: 'Edit Details',
        icon: 'edit-3',
        tooltip: 'Edit the name and description for this edit',
        actionHandler: (version, store) => store.dispatch(thunks.requestEditVersion(version)),
    },
    {
        id: 'deviation',
        title: 'Create new note from edit',
        icon: 'git-branch', 
        tooltip: 'Create a new note using this edit\'s content',
        actionHandler: (version, store) => store.dispatch(thunks.createDeviation(version)),
    },
    {
        id: 'export-single',
        title: 'Export this edit',
        icon: 'download',
        tooltip: 'Export this specific edit to a file',
        actionHandler: (version, store) => store.dispatch(thunks.requestExportSingleVersion(version)),
    },
    {
        id: 'delete',
        title: 'Delete this edit',
        icon: 'trash-2', 
        tooltip: 'Permanently delete this edit',
        isDanger: true, 
        actionHandler: (version, store) => store.dispatch(thunks.requestDeleteEdit(version)),
    },
];
