import { Setting, setIcon } from "obsidian";
import { debounce } from 'lodash-es';
import type { AppStore } from "../../state/store";
import { AppStatus, type SettingsPanel as SettingsPanelState } from "../../state/state";
import type { AppState } from "../../state/state";
import { actions } from "../../state/appSlice";
import { thunks } from "../../state/thunks/index";
import { BasePanelComponent } from "./BasePanelComponent";

export class SettingsPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private autoCloseTimer: number | null = null;
    private readonly AUTO_CLOSE_DELAY_MS = 30000;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-settings-panel"]); 
        
        // FIX: The close button has been removed. The panel is closed by clicking the settings icon in the action bar again.
        
        // Create the content wrapper once. Its content will be re-rendered.
        this.innerPanel = this.container.createDiv('v-settings-panel-content-wrapper');
    }

    render(panelState: SettingsPanelState | null, state: AppState) { 
        const isOpen = !!panelState;
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

        // Populate Content
        if (state.status === AppStatus.READY && state.file) {
            const noteSection = this.innerPanel.createDiv('v-settings-section');
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
        const descTitle = state.noteId ? `Note-Specific Settings` : `Default Settings`;
        pluginSettingsSection.createEl('h4', {
            text: descTitle,
            cls: 'v-settings-section-title'
        });
        const settingsDesc = pluginSettingsSection.createEl('p', { cls: 'v-settings-info v-meta-label' });
        if (state.noteId) {
            settingsDesc.setText('These settings apply only to the current note and override the defaults. Other notes will use the default settings.');
        } else {
            settingsDesc.setText('Open a note with version history to configure its specific settings.');
        }

        this.createPluginSettingsControls(this.innerPanel, state);

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

        const isNoteReady = state.status === AppStatus.READY && !!state.noteId;

        new Setting(parent)
            .setName('Enable version naming')
            .setDesc('If enabled, prompts for a version name when saving a new version.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.enableVersionNaming)
                    .onChange((value) => {
                         this.store.dispatch(thunks.updateSettings({ enableVersionNaming: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        new Setting(parent)
            .setName('Compact list view')
            .setDesc('Display version history as a compact list. Otherwise, shows as cards.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.isListView)
                    .onChange((value) => {
                        this.store.dispatch(thunks.updateSettings({ isListView: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        new Setting(parent)
            .setName('Use relative timestamps')
            .setDesc("ON: Show relative times (e.g., '2 hours ago'). OFF: Show full date and time.")
            .addToggle(toggle => {
                toggle 
                    .setValue(settings.useRelativeTimestamps)
                    .onChange((value) => {
                        this.store.dispatch(thunks.updateSettings({ useRelativeTimestamps: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        new Setting(parent)
            .setName('Render Markdown in preview')
            .setDesc('If enabled, version previews will render Markdown. Otherwise, plain text.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.renderMarkdownInPreview)
                    .onChange((value) => {
                        this.store.dispatch(thunks.updateSettings({ renderMarkdownInPreview: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });

        new Setting(parent)
            .setName('Enable watch mode')
            .setDesc('Automatically save a new version if the note has changed after a set interval.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.enableWatchMode)
                    .onChange((value) => {
                        this.store.dispatch(thunks.updateSettings({ enableWatchMode: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });
        
        if (settings.enableWatchMode) {
            let descEl: HTMLElement;
            new Setting(parent)
                .setName('Watch mode interval')
                .setDesc('placeholder') // Will be replaced
                .then(setting => {
                    descEl = setting.descEl;
                    descEl.setText(`Time to wait before auto-saving. Current: ${this.formatInterval(settings.watchModeInterval)}.`);
                })
                .addSlider(slider => {
                    const debouncedSave = debounce((value: number) => {
                        this.store.dispatch(thunks.updateSettings({ watchModeInterval: value }));
                    }, 500);

                    slider
                        .setLimits(5, 300, 5) // 5 seconds to 5 minutes, in 5-second steps
                        .setValue(settings.watchModeInterval)
                        .setDynamicTooltip()
                        .onChange((value) => {
                            if (descEl) {
                                descEl.setText(`Time to wait before auto-saving. Current: ${this.formatInterval(value)}.`);
                            }
                            debouncedSave(value);
                        });
                    if (!isNoteReady) slider.setDisabled(true);
                });
        }

        new Setting(parent)
            .setName('Auto-cleanup old versions by age')
            .setDesc('Automatically delete versions older than a specified number of days. Keeps at least one version.')
            .addToggle(toggle => {
                toggle
                    .setValue(settings.autoCleanupOldVersions)
                    .onChange((value) => {
                        this.store.dispatch(thunks.updateSettings({ autoCleanupOldVersions: value }));
                    });
                if (!isNoteReady) toggle.setDisabled(true);
            });

        if (settings.autoCleanupOldVersions) {
            let descEl: HTMLElement;
            new Setting(parent)
                .setName('Delete versions older than (days)')
                .setDesc('placeholder')
                .then(setting => {
                    descEl = setting.descEl;
                    descEl.setText(`Applies if "Auto-cleanup by age" is on. Min 7, Max 365. Current: ${settings.autoCleanupDays} days.`);
                })
                .addSlider(slider => {
                    const debouncedSave = debounce((value: number) => {
                        this.store.dispatch(thunks.updateSettings({ autoCleanupDays: value }));
                    }, 500);

                    slider
                        .setLimits(7, 365, 1)
                        .setValue(settings.autoCleanupDays)
                        .setDynamicTooltip()
                        .onChange((value) => {
                            if (descEl) {
                                descEl.setText(`Applies if "Auto-cleanup by age" is on. Min 7, Max 365. Current: ${value} days.`);
                            }
                            debouncedSave(value);
                        });
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
                    .onChange(debounce((value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            this.store.dispatch(thunks.updateSettings({ maxVersionsPerNote: num }));
                        } else if (value.trim() !== "" && (isNaN(num) || num < 0)) {
                            this.store.dispatch(thunks.showNotice("Max versions must be a non-negative number.", 3000));
                            text.setValue(String(this.store.getState().settings.maxVersionsPerNote));
                        }
                    }, 700));
                if (!isNoteReady) text.setDisabled(true);
            });
    }

    override onunload() {
        if (this.autoCloseTimer) {
            window.clearTimeout(this.autoCloseTimer);
        }
        this.innerPanel.removeEventListener('click', this.resetAutoCloseTimer, { capture: true });
        this.innerPanel.removeEventListener('input', this.resetAutoCloseTimer, { capture: true });
        super.onunload(); 
    }
}
