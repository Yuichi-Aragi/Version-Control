import { App, PluginSettingTab, Plugin } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';
import type { AppStore } from '@/state';
import { AppContext } from './AppContext';
import { SettingsTabRoot } from './components/settings/SettingsTabRoot';

export class VersionControlSettingTab extends PluginSettingTab {
    private store: AppStore;
    private reactRoot: Root | null = null;

    constructor(app: App, plugin: Plugin, store: AppStore) {
        super(app, plugin);
        this.store = store;
    }

    override display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.addClass('version-control-settings-tab');

        this.reactRoot = createRoot(containerEl);
        this.reactRoot.render(
            <StrictMode>
                <Provider store={this.store}>
                    <AppContext.Provider value={this.app}>
                        <SettingsTabRoot />
                    </AppContext.Provider>
                </Provider>
            </StrictMode>
        );
    }

    override hide(): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }
    }
}
