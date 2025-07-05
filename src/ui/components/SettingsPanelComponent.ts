import { Setting, debounce, setIcon, HTMLElement as ObsidianHTMLElement } from "obsidian";
import { Store } from "../../state/store";
import { AppState, ReadyState, AppStatus } from "../../state/state";
import { actions } from "../../state/actions";
import { thunks } from "../../state/thunks/index";
import { BasePanelComponent } from "./BasePanelComponent";

export class SettingsPanelComponent extends BasePanelComponent {
    private innerPanel: ObsidianHTMLElement;
    private autoCloseTimer: number | null = null;
    private readonly AUTO_CLOSE_DELAY_MS = 30000;

    constructor(parent: ObsidianHTMLElement, store: Store) {
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

        if (state.status === AppStatus.READY) {
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
        pluginSettingsSection.createEl('h4', {
            text: "Plugin Settings",
            cls: 'v-settings-section-title'
        });
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
        if (state.status !== AppStatus.READY) return;

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
        parent: ObsidianHTMLElement, 
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

    private createPluginSettingsControls(parent: ObsidianHTMLElement, state: AppState) {
        const { settings } = state; 

        new Setting(parent)
            .setName('Apply settings globally')
            .setDesc('ON: Changes apply to all notes. OFF: Changes apply only to the current note (if it has a version history).')
            .addToggle(toggle => toggle
                .setValue(settings.applySettingsGlobally)
                .onChange(async (value) => {
                    // The thunk will handle saving globally and updating the effective state.
                    // The component will re-render automatically from the store subscription.
                    await this.store.dispatch(thunks.updateSettings({ applySettingsGlobally: value }));
                }));
        
        parent.createEl('hr', { cls: 'v-settings-divider' });

        new Setting(parent)
            .setName('Enable version naming')
            .setDesc('If enabled, prompts for a version name when saving a new version.')
            .addToggle(toggle => toggle
                .setValue(settings.enableVersionNaming)
                .onChange(async (value) => {
                     await this.store.dispatch(thunks.updateSettings({ enableVersionNaming: value }));
                }));
        
        new Setting(parent)
            .setName('Compact list view')
            .setDesc('Display version history as a compact list. Otherwise, shows as cards.')
            .addToggle(toggle => toggle
                .setValue(settings.isListView)
                .onChange(async (value) => {
                    await this.store.dispatch(thunks.updateSettings({ isListView: value }));
                }));
        
        new Setting(parent)
            .setName('Show relative timestamps in list')
            .setDesc('E.g., "2 hours ago". Full timestamp on hover. If off, shows full date/time.')
            .addToggle(toggle => toggle 
                .setValue(settings.showTimestamps)
                .onChange(async (value) => {
                    await this.store.dispatch(thunks.updateSettings({ showTimestamps: value }));
                }));
        
        new Setting(parent)
            .setName('Render Markdown in preview')
            .setDesc('If enabled, version previews will render Markdown. Otherwise, plain text.')
            .addToggle(toggle => toggle
                .setValue(settings.renderMarkdownInPreview)
                .onChange(async (value) => {
                    await this.store.dispatch(thunks.updateSettings({ renderMarkdownInPreview: value }));
                }));

        new Setting(parent)
            .setName('Enable watch mode')
            .setDesc('Automatically save a new version if the note has changed after a set interval.')
            .addToggle(toggle => toggle
                .setValue(settings.enableWatchMode)
                .onChange(async (value) => {
                    await this.store.dispatch(thunks.updateSettings({ enableWatchMode: value }));
                }));
        
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
                });
        }

        new Setting(parent)
            .setName('Auto-cleanup orphaned versions')
            .setDesc('On startup and periodically, remove version data for notes that no longer exist or are no longer linked via vc-id. This setting is always global.')
            .addToggle(toggle => toggle
                .setValue(settings.autoCleanupOrphanedVersions)
                .onChange(async (value) => {
                    await this.store.dispatch(thunks.updateSettings({ autoCleanupOrphanedVersions: value }));
                }));

        new Setting(parent)
            .setName('Auto-cleanup old versions by age')
            .setDesc('Automatically delete versions older than a specified number of days. Keeps at least one version.')
            .addToggle(toggle => toggle
                .setValue(settings.autoCleanupOldVersions)
                .onChange(async (value) => {
                    await this.store.dispatch(thunks.updateSettings({ autoCleanupOldVersions: value }));
                }));

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
                });
        }

        new Setting(parent)
            .setName('Max versions per note')
            .setDesc('Maximum number of versions to keep per note. Oldest versions are deleted first. Set to 0 for infinite. Current: ' + (settings.maxVersionsPerNote === 0 ? "Infinite" : settings.maxVersionsPerNote))
            .addText(text => text
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
                }, 700)));
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
