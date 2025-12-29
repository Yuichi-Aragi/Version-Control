import { createToggleSetting } from './ToggleSettingFactory';

export const DiskPersistenceSettings = createToggleSetting(
    'Enable disk persistence',
    'If enabled, edit history data is automatically exported to .vctrl files in the vault. If disabled, data is stored only in the internal database (and imported from disk if newer).',
    'enableDiskPersistence'
);
DiskPersistenceSettings.displayName = 'DiskPersistenceSettings';