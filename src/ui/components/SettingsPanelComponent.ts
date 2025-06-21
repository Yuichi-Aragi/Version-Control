import { Setting, debounce, Notice, setIcon } from "obsidian";
import VersionControlPlugin from "../../main";
import { AppState } from "../../state/state";
import { actions } from "../../state/actions";
import { thunks } from "../../state/thunks";

export class SettingsPanelComponent {
    private container: HTMLElement;
    private plugin: VersionControlPlugin;
    private autoCloseTimer: number | null = null;

    constructor(parent: HTMLElement, plugin: VersionControlPlugin) {
        this.container = parent.createDiv("v-settings-panel");
        this.plugin = plugin;
    }

    render(state: AppState) {
        if (this.autoCloseTimer) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }

        this.container.classList.toggle('is-open', state.ui.isSettingsPanelOpen);
        this.container.empty();

        if (!state.ui.isSettingsPanelOpen) {
            return;
        }

        // Set auto-close timer for 15 seconds
        this.autoCloseTimer = window.setTimeout(() => {
            if (this.plugin.store.getState().ui.isSettingsPanelOpen) {
                this.plugin.store.dispatch(actions.toggleSettingsPanel());
            }
        }, 15000);

        const wrapper = this.container.createDiv('v-settings-panel-content-wrapper');
        
        const actionsContainer = wrapper.createDiv("v-settings-actions");
        this.createSettingsAction(actionsContainer, "Refresh", "refresh-cw", () => {
            const noteId = this.plugin.store.getState().activeNote.noteId;
            if (noteId) this.plugin.store.dispatch(thunks.loadHistory(noteId));
        });
        this.createSettingsAction(actionsContainer, "Export", "download-cloud", (e) => this.handleExport(e));
        this.createSettingsAction(actionsContainer, "Delete All", "trash-2", () => this.plugin.store.dispatch(thunks.requestDeleteAll()), "mod-warning");
        this.createSettingsAction(actionsContainer, "Help", "help-circle", () => new Notice("In compact view, right-click a version for options.", 4000));

        this.createPluginSettings(wrapper, state);
    }

    private handleExport(e: MouseEvent) {
        const { noteId, file } = this.plugin.store.getState().activeNote;
        if (!noteId || !file) return;
        this.plugin.exportManager.showExportMenu(noteId, file.basename, e);
    }

    private createSettingsAction(parent: HTMLElement, text: string, icon: string, handler: (e: MouseEvent) => void, extraClass = "") {
        const btn = parent.createEl("button", { text, cls: extraClass });
        setIcon(btn, icon);
        btn.addEventListener("click", handler);
    }

    private createPluginSettings(parent: HTMLElement, state: AppState) {
        const { settings } = state;

        new Setting(parent).setName('Enable version naming').addToggle(toggle => toggle
            .setValue(settings.enableVersionNaming)
            .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ enableVersionNaming: value }))));
        
        new Setting(parent).setName('Compact list view').addToggle(toggle => toggle
            .setValue(settings.isListView)
            .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ isListView: value }))));

        new Setting(parent).setName('Auto-cleanup orphaned versions').setDesc('On startup/periodically, remove version data for deleted notes.').addToggle(toggle => toggle
            .setValue(settings.autoCleanupOrphanedVersions)
            .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ autoCleanupOrphanedVersions: value }))));
        
        new Setting(parent).setName('Show timestamps in list').addToggle(toggle => toggle
            .setValue(settings.showTimestamps)
            .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ showTimestamps: value }))));
        
        new Setting(parent).setName('Render Markdown in preview').addToggle(toggle => toggle
            .setValue(settings.renderMarkdownInPreview)
            .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ renderMarkdownInPreview: value }))));

        new Setting(parent).setName('Auto-cleanup old versions').addToggle(toggle => toggle
            .setValue(settings.autoCleanupOldVersions)
            .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ autoCleanupOldVersions: value }))));

        if (settings.autoCleanupOldVersions) {
            new Setting(parent).setName('Cleanup after (days)').addSlider(slider => slider
                .setLimits(7, 365, 1).setValue(settings.autoCleanupDays).setDynamicTooltip()
                .onChange(value => this.plugin.store.dispatch(actions.updateSettings({ autoCleanupDays: value }))));
        }

        new Setting(parent).setName('Max versions per note').setDesc('0 for infinite.').addText(text => text
            .setValue(String(settings.maxVersionsPerNote))
            .onChange(debounce((value) => {
                const num = parseInt(value, 10);
                if (!isNaN(num) && num >= 0) {
                    this.plugin.store.dispatch(actions.updateSettings({ maxVersionsPerNote: num }));
                }
            }, 500)));
    }
}