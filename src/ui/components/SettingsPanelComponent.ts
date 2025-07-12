import { Setting, setIcon } from "obsidian";
import { debounce } from 'lodash-es';
import { AppStore } from "../../state/store";
import { AppState, AppStatus } from "../../state/state";
import { actions } from "../../state/appSlice";
import { thunks } from "../../state/thunks/index";
import { BasePanelComponent } from "./BasePanelComponent";

export class SettingsPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private autoCloseTimer: number | null = null;
    private readonly AUTO_CLOSE_DELAY_MS = 30000;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-settings-panel"]); 
        this.innerPanel = this.container.createDiv('v-settings-panel-content-wrapper');
    }

    render(isOpen: boolean, state: AppState) { 
        this.toggle(isOpen); 
        
        if (this.autoCloseTimer) {
            window.clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }

        if (!isOpen) {
            return;
        }
        
        this.innerPanel.empty(); 

        this.autoCloseTimer = window.setTimeout(() => {
            const currentState = this.store.getState();
            if (currentState.status === AppStatus.READY && currentState.panel?.type === 'settings') {
                this.store.dispatch(thunks.closeSettingsPanelWithNotice("Settings panel auto-closed.", 2000));
            }
        }, this.AUTO_CLOSE_DELAY_MS);

        if (state.status === AppStatus.READY && state.file) {
            const noteSection = this.innerPanel.createDiv('v-settings-section');
            // FIX: Clarify that actions are for the current note.
            noteSection.createEl('h4', {
                text: `Actions for "${state.file.basename}"`,
                cls: 'v-settings-section-title'
            });
            const noteActionsContainer = noteSection.createDiv("v-settings-actions");
            this.createSettingsAction(noteActionsContainer, "Refresh History", "refresh-cw", () => this.handleRefresh());
            this.createSettingsAction(noteActionsContainer, "Export History", "download-cloud", () => this.handleExport());
            if (state.noteId && state.history.length > 0) { 
                 this.createSettingsAction(noteActionsContainer, "Delete All Versions", "trash-2", () => this.store.dispatch(thunks.requestDeleteAll()), "mod-warning");
            }
        }
        
        const pluginSettingsSection = this.innerPanel.createDiv('v-settings-section');
        // FIX: Title reflects that settings are context-dependent.
        const settingsTitle = state.noteId ? `Settings for This Note` : `Default Settings`;
        pluginSettingsSection.createEl('h4', {
            text: settingsTitle,
            cls: 'v-settings-section-title'
        });
        // FIX: Add a description explaining the new settings behavior.
        const settingsDesc = pluginSettingsSection.createEl('p', { cls: 'v-settings-info v-meta-label' });
        if (state.noteId) {
            settingsDesc.setText('These settings apply only to the current note. Other notes will use the default settings.');
        } else {
            settingsDesc.setText('Open a note with version history to configure its specific settings.');
        }

        this.createPluginSettingsControls(pluginSettingsSection, state);

        const helpSection = this.innerPanel.createDiv('v-settings-section');
        const helpInfo = helpSection.createDiv('v-settings-info');
        helpInfo.createEl('p', {text: "In compact list view, right-click (or long-press) a version entry for more actions."});
        helpInfo.createEl('p', {text: "Settings panel will auto-close after 30 seconds of inactivity."});

        this.innerPanel.addEventListener('click', this.resetAutoCloseTimer, { capture: true });
        this.innerPanel.addEventListener('input', this.resetAutoCloseTimer, { capture: true });
    }

    private resetAutoCloseTimer = () => {
        if (this.autoCloseTimer) {
            window.clearTimeout(this.autoCloseTimer);
        }
        const currentState = this.store.getState();
        if (currentState.status === AppStatus.READY && currentState.panel?.type === 'settings') {
            this.autoCloseTimer = window.setTimeout(() => {
                const latestState = this.store.getState();
                if (latestState.status === AppStatus.READY && latestState.panel?.type === 'settings') {
                    this.store.dispatch(thunks.closeSettingsPanelWithNotice("Settings panel auto-closed due to inactivity.", 2000));
                }
            }, this.AUTO_CLOSE_DELAY_MS);
        }
    }


    private handleRefresh() {
        const state = this.store.getState();
        if (state.status !== AppStatus.READY || !state.file) return;

        if (state.noteId) {
            this.store.dispatch(thunks.loadHistoryForNoteId(state.file, state.noteId));
        } else {
            this.store.dispatch(thunks.loadHistory(state.file));
        }
        this.store.dispatch(actions.closePanel()); 
    }

    private handleExport() {
        const state = this.store.getState();
        if (state.status !== AppStatus.READY) return;

        if (!state.noteId) {
            this.store.dispatch(thunks.showNotice("This note is not under version control yet. Cannot export history.", 3000));
            return;
        }
        this.store.dispatch(thunks.requestExportAllVersions());
    }

    private createSettingsAction(
        parent: HTMLElement, 
        text: string, 
        iconName: string, 
        handler: (event: MouseEvent) => void, 
        extraClass: string = ""
    ) {
        const btn = parent.createEl("button", { text, cls: `clickable-icon ${extraClass}` });
        setIcon(btn, iconName);
        btn.setAttribute("aria-label", text);
        btn.addEventListener("click", handler);
    }

    private formatInterval(seconds: number): string {
        if (seconds < 60) {
            return `${seconds} sec`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (remainingSeconds === 0) {
            return `${minutes} min`;
        }
        return `${minutes} min ${remainingSeconds} sec`;
    }

    private createPluginSettingsControls(parent: HTMLElement, state: AppState) {
        const { settings } = state; 

        // FIX: Removed the 'Apply settings globally' toggle.

        // FIX: Add a divider to separate the global setting from per-note ones.
        new Setting(parent)
            .setName('Auto-cleanup orphaned versions')
            .setDesc('On startup and periodically, remove version data for notes that no longer exist. This setting is always global and applies to the entire vault.')
            .addToggle(toggle => toggle
                .setValue(settings.autoCleanupOrphanedVersions)
                .onChange(async (value) => {
                    // This thunk now correctly handles saving this to the central manifest.
                    await this.store.dispatch(thunks.updateSettings({ autoCleanupOrphanedVersions: value }));
                }));
        
        parent.createEl('hr', { cls: 'v-settings-divider' });

        // The rest of the settings are now implicitly per-note if a note is active.
        // The `updateSettings` thunk handles the saving logic automatically.
        // The `disabled` property ensures users can't change settings without an active, versioned note.
        const isNoteReady = state.status === AppStatus.READY && !!state.noteId;

        new Setting(parent)
            .setName('Enable version naming')
            .setDesc('If enabled, prompts for a version name when saving a new version.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.enableVersionNaming)
                    .onChange(async (value) => {
                         await this.store.dispatch(thunks.updateSettings({ enableVersionNaming: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        new Setting(parent)
            .setName('Compact list view')
            .setDesc('Display version history as a compact list. Otherwise, shows as cards.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.isListView)
                    .onChange(async (value) => {
                        await this.store.dispatch(thunks.updateSettings({ isListView: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        new Setting(parent)
            .setName('Use relative timestamps')
            .setDesc("ON: Show relative times (e.g., '2 hours ago'). OFF: Show full date and time.")
            .addToggle(toggle => {
                toggle 
                    .setValue(settings.useRelativeTimestamps)
                    .onChange(async (value) => {
                        await this.store.dispatch(thunks.updateSettings({ useRelativeTimestamps: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        new Setting(parent)
            .setName('Render Markdown in preview')
            .setDesc('If enabled, version previews will render Markdown. Otherwise, plain text.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.renderMarkdownInPreview)
                    .onChange(async (value) => {
                        await this.store.dispatch(thunks.updateSettings({ renderMarkdownInPreview: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });

        new Setting(parent)
            .setName('Enable watch mode')
            .setDesc('Automatically save a new version if the note has changed after a set interval.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.enableWatchMode)
                    .onChange(async (value) => {
                        await this.store.dispatch(thunks.updateSettings({ enableWatchMode: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        if (settings.enableWatchMode) {
            new Setting(parent)
                .setName('Watch mode interval')
                .setDesc(`Time to wait before auto-saving. Current: ${this.formatInterval(settings.watchModeInterval)}.`)
                .addSlider(slider => {
                    slider
                        .setLimits(5, 300, 5) // 5 seconds to 5 minutes, in 5-second steps
                        .setValue(settings.watchModeInterval)
                        .setDynamicTooltip()
                        .onChange(debounce(async (value) => {
                            await this.store.dispatch(thunks.updateSettings({ watchModeInterval: value }));
                        }, 500));
                    if (!isNoteReady) slider.setDisabled(true);
                });
        }

        new Setting(parent)
            .setName('Auto-cleanup old versions by age')
            .setDesc('Automatically delete versions older than a specified number of days. Keeps at least one version.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.autoCleanupOldVersions)
                    .onChange(async (value) => {
                        await this.store.dispatch(thunks.updateSettings({ autoCleanupOldVersions: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });

        if (settings.autoCleanupOldVersions) {
            new Setting(parent)
                .setName('Delete versions older than (days)')
                .setDesc(`Applies if "Auto-cleanup by age" is on. Min 7, Max 365. Current: ${settings.autoCleanupDays} days.`)
                .addSlider(slider => {
                    slider
                        .setLimits(7, 365, 1)
                        .setValue(settings.autoCleanupDays)
                        .setDynamicTooltip()
                        .onChange(debounce(async (value) => {
                            await this.store.dispatch(thunks.updateSettings({ autoCleanupDays: value }));
                        }, 500));
                    if (!isNoteReady) slider.setDisabled(true);
                });
        }

        new Setting(parent)
            .setName('Max versions per note')
            .setDesc('Maximum number of versions to keep per note. Oldest versions are deleted first. Set to 0 for infinite. Current: ' + (settings.maxVersionsPerNote === 0 ? "Infinite" : settings.maxVersionsPerNote))
            .addText(text => {
                text
                    .setPlaceholder("e.g., 50 or 0 for infinite")
                    .setValue(String(settings.maxVersionsPerNote))
                    .onChange(debounce(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            await this.store.dispatch(thunks.updateSettings({ maxVersionsPerNote: num }));
                        } else if (value.trim() !== "" && (isNaN(num) || num < 0)) {
                            this.store.dispatch(thunks.showNotice("Max versions must be a non-negative number.", 3000));
                            text.setValue(String(this.store.getState().settings.maxVersionsPerNote));
                        }
                    }, 700));
                if (!isNoteReady) text.setDisabled(true);
            });
    }

    onunload() {
        if (this.autoCloseTimer) {
            window.clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }
        this.innerPanel.removeEventListener('click', this.resetAutoCloseTimer, { capture: true });
        this.innerPanel.removeEventListener('input', this.resetAutoCloseTimer, { capture: true });
        super.onunload(); 
    }
}
