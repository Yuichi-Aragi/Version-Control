import { Plugin, TFile, WorkspaceLeaf, debounce, Notice, MetadataCache } from 'obsidian';
import { ManifestManager } from './core/manifest-manager';
import { VersionManager } from './core/version-manager';
import { NoteManager } from './core/note-manager';
import { CleanupManager } from './core/cleanup-manager';
import { ExportManager } from './services/export-manager';
import { VersionControlView } from './ui/version-control-view';
import { VersionControlSettings } from './types';
import { VIEW_TYPE_VERSION_CONTROL, DEFAULT_SETTINGS, NOTE_FRONTMATTER_KEY } from './constants';
import { Store } from './state/store';
import { getInitialState } from './state/state';
import { actions } from './state/actions';
import { thunks } from './state/thunks';

export default class VersionControlPlugin extends Plugin {
	settings: VersionControlSettings;
	store: Store;

	// Managers and Services
	manifestManager: ManifestManager;
	noteManager: NoteManager;
	cleanupManager: CleanupManager;
	versionManager: VersionManager;
	exportManager: ExportManager;

	async onload() {
		try {
			const loadedSettings = await this.loadSettings();

			// Initialize managers in dependency order
			this.manifestManager = new ManifestManager(this.app);
			this.noteManager = new NoteManager(this.app, this.manifestManager);
			this.cleanupManager = new CleanupManager(this.app, this.manifestManager, () => this.store.getState().settings);
			this.versionManager = new VersionManager(this.app, this.manifestManager, this.noteManager, this.cleanupManager);
			this.exportManager = new ExportManager(this.app, this.versionManager);

			// Initialize the state management store
			const initialState = getInitialState(loadedSettings);
			this.store = new Store(initialState, this);
			this.settings = this.store.getState().settings;

			// Subscribe to settings changes to persist them
			this.store.subscribe(() => {
				const newSettings = this.store.getState().settings;
				if (this.settings !== newSettings) {
					this.settings = newSettings;
					this.saveSettings();
				}
			});

			await this.manifestManager.initializeDatabase();

			this.registerView(
				VIEW_TYPE_VERSION_CONTROL,
				(leaf) => new VersionControlView(leaf, this)
			);

			this.addRibbonIcon('history', 'Open Version Control', () => this.activateView());
			this.addCommands();
			this.registerPluginEvents();
			
			this.cleanupManager.managePeriodicCleanup();
			this.addStatusBarItem().setText('VC Ready');
			console.log("Version Control plugin loaded successfully.");
		} catch (error) {
			console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = error instanceof Error ? error.message : "Unknown error";
			new Notice(`Version Control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);
		}
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
        this.cleanupManager?.completePendingCleanups();
	}

	async loadSettings(): Promise<VersionControlSettings> {
		try {
			const loadedData = await this.loadData();
			return Object.assign({}, DEFAULT_SETTINGS, loadedData);
		} catch (error) {
			console.error("Version Control: Could not load settings, using defaults.", error);
			new Notice("Version Control: Could not load settings, using defaults.");
			return { ...DEFAULT_SETTINGS };
		}
	}

	async saveSettings() {
		try {
			await this.saveData(this.settings);
			this.cleanupManager.managePeriodicCleanup(); // Re-evaluate interval on settings change
		} catch (error) {
			console.error("Version Control: Could not save settings.", error);
			new Notice("Version Control: Could not save settings.");
		}
	}

	private addCommands() {
		this.addCommand({
			id: 'open-version-control-view',
			name: 'Open Version Control View',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'save-new-version',
			name: 'Save a new version of the current note',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === 'md') {
					if (!checking) {
						this.store.dispatch(thunks.saveNewVersion());
					}
					return true;
				}
				return false;
			}
		});

        this.addCommand({
            id: 'cleanup-orphaned-versions',
            name: 'Clean up orphaned version data',
            callback: () => this.cleanupManager.cleanupOrphanedVersions(true),
        });
	}

	private registerPluginEvents() {
		const debouncedHandler = debounce(() => this.store.dispatch(thunks.updateActiveNote()), 150, true);

		this.registerEvent(this.app.workspace.on('active-leaf-change', debouncedHandler));
		this.registerEvent(this.app.workspace.on('file-open', debouncedHandler));
        
        this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache: MetadataCache['fileCache'][string]) => {
            const { file: currentFile, noteId: currentNoteId } = this.store.getState().activeNote;
            if (file === currentFile && cache) {
                const newNoteId = cache.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;
                if (currentNoteId !== newNoteId) {
                    debouncedHandler();
                }
            }
        }));

        this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
            if (file instanceof TFile && file.extension === 'md') {
                // This was a note rename, check if we were tracking it and update manifests.
                await this.noteManager.handleNoteRename(file, oldPath);
                
                // If the renamed file is the one currently active in our view, we must refresh the state.
                const { file: currentFile } = this.store.getState().activeNote;
                if (currentFile && currentFile.path === oldPath) {
                    // The file we were looking at was just renamed.
                    // Trigger a full state update to reflect the new path and reload history.
                    this.store.dispatch(thunks.updateActiveNote());
                }
            }
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Invalidate cache so that if a new note is created with the same path,
                // we don't mistakenly associate it with the old, deleted note's history.
                this.noteManager.invalidateCentralManifestCache();
                
                // If the deleted file is the one we are viewing, clear the view to prevent a dead state.
                const { file: currentFile } = this.store.getState().activeNote;
                if (currentFile && currentFile.path === file.path) {
                    this.store.dispatch(actions.clearActiveNote());
                }
            }
        }));
	}

	async activateView() {
        const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL)[0];
        if (existingLeaf) {
            this.app.workspace.revealLeaf(existingLeaf);
            return;
        }

		const leaf = this.app.workspace.getRightLeaf(false);
		await leaf.setViewState({
			type: VIEW_TYPE_VERSION_CONTROL,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}
}