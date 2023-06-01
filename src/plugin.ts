import { Notice, Plugin, TFile, addIcon, moment, normalizePath, setIcon } from 'obsidian';

import { PluginControlModal } from './modal'
import { SettingTab, PluginManagerSettings, DEFAULT_SETTINGS } from './settings'
import { LocalGraph } from './localGraph';
import { Memos } from './memos';
import { icons } from './utils';
import { PluginsUpdater, ThemeUpdater } from './manifest';

const debug = (debug: boolean, ...msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
	if (debug) console.log(...msg);
};

export class PluginManager extends Plugin {
	settings: PluginManagerSettings
	private localGraph = new LocalGraph(this.app, this);
	private memos = new Memos(this.app, this);

	async onload() {
		await this.loadSettings();
		// showup notification of plugin starting when it is in debug mode
		if (this.settings.debug) {
			new Notice("starting obsidian assistant");
		}
		// observe element which is concerned by commands
		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if ((node instanceof HTMLElement)) {
						document.querySelectorAll('.popover.hover-popover.hover-editor').forEach((el) => {
							this.log("obseving...")
							this.localGraph.resize();
							this.memos.resize();
						})
					}
				});
			});
		});
		observer.observe(document.body, {
			attributes: true,
			childList: true
		});

		// This creates an icon in the left ribbon.
		addIcon('PluginAST', icons['PluginAST']);
		const ribbonIconEl = this.addRibbonIcon('PluginAST', 'Obsidian Assistant', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Obsidian Assistant Startup');
			new PluginControlModal(this.app).open();
		});
		ribbonIconEl.addClass('plugin-manager-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		// status bar style setting
		statusBarItemEl.addClass('personal-assistant-statusbar');
		addIcon('PluginAST_STATUSBAR', icons['PluginAST_STATUSBAR']);
		setIcon(statusBarItemEl, 'PluginAST_STATUSBAR');
		// status bar event handling
		statusBarItemEl.onClickEvent((e) => {
			//TODO: showup plugin mannual modal
			new PluginControlModal(this.app).open();
		});

		this.addCommand({
			id: 'startup-recording',
			name: 'Open specific note to record',
			callback: async () => {
				const fileFormat = moment().format(this.settings.fileFormat);
				const targetDir = this.settings.targetPath;
				this.log(targetDir, fileFormat);
				await this.createNewNote(targetDir, fileFormat);
			}
		});

		this.addCommand({
			id: 'memos',
			name: 'assistant hover memos',
			callback: async () => {
				await this.memos.startup();
			}
		});

		this.addCommand({
			id: 'local-graph',
			name: 'hover local graph',
			callback: async () => {
				await this.localGraph.startup();
			}
		});

		this.addCommand({
			id: 'switch-on-or-off-plugin',
			name: 'switch on/off plugin according to its status',
			callback: () => {
				const modal = new PluginControlModal(this.app);
				modal.setPlaceholder("Type plugin name to find it");
				modal.open();
			}
		});

		this.addCommand({
			id: 'set-local-graph-view-colors',
			name: 'Set graph view colors',
			callback: async () => {
				await this.localGraph.updateGraphColors();
			}
		});

		this.addCommand({
			id: 'update-plugins',
			name: "Update plugins with one command",
			callback: async () => {
				const pluginUpdater = new PluginsUpdater(this.app, this);
				await pluginUpdater.update();
			}
		})

		this.addCommand({
			id: 'update-themes',
			name: "Update themes with one command",
			callback: async () => {
				const themeUpdater = await ThemeUpdater.init(this.app, this);
				await themeUpdater.update();
			}
		})

		this.addCommand({
			id: 'update-metadata',
			name: "Update metadata with one command",
			callback: async () => {
				if (this.settings.enableMetadataUpdating) {
					this.registerEvent(this.app.vault.on('modify', (file) => {
						if (file instanceof TFile) {
							if ((file as TFile).extension === 'md') {
								// update metadata
								const meta = this.app.metadataCache.getCache(file.path);
								if (meta && meta.frontmatter) {
									this.app.fileManager.processFrontMatter(file, (frontmatter) => {
										for (const key of Object.getOwnPropertyNames(frontmatter)) {
											for (const metaConfig of this.settings.metadatas) {
												if (key === metaConfig.key) {
													this.log((frontmatter as any)[key]); // eslint-disable-line @typescript-eslint/no-explicit-any
													let valut2Change: string;
													switch (metaConfig.t) {
														case 'moment':
															valut2Change = moment().format(metaConfig.value);
															break;
														case 'string':
															valut2Change = metaConfig.value;
															break;
														default:
															valut2Change = metaConfig.value;
															break;
													}
													(frontmatter as any)[key] = valut2Change; // eslint-disable-line @typescript-eslint/no-explicit-any
												}
											}
										}
									});
								}
							}
						}
					}));
				}
			}
		})

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.log("logging settings...", this.settings);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	log(...msg: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
		debug(this.settings.debug, ...msg);
	}

	// the following is referenced from https://github.com/vanadium23/obsidian-advanced-new-file/blob/master/src/CreateNoteModal.ts#L102
	private async createDirectory(dir: string): Promise<void> {
		const { vault } = this.app;
		const root = vault.getRoot().path;
		const directoryPath = this.join(root, dir);
		/**
		 * NOTE: `getAbstractFileByPath` will return TAbstractFile or null,
		 * so, to check if the directory is exists, compare the return
		 * value by using `==`.
		 **/
		if (vault.getAbstractFileByPath(directoryPath) == undefined) {
			await vault.createFolder(directoryPath);
		}
	}

	/**
	 * Handles creating the new note
	 * A new markdown file will be created at the given file path (`input`)
	 * in the specified parent folder (`this.folder`)
	 **/
	async createNewNote(targetPath: string, fileName: string): Promise<void> {
		const { vault } = this.app;
		const root = vault.getRoot().path;
		const directoryPath = this.join(root, targetPath);
		const filePath = this.join(directoryPath, `${fileName}.md`);

		try {
			if (this.app.vault.getAbstractFileByPath(filePath) instanceof TFile) {
				// If the file already exists, open it and send notification
				const files = vault.getMarkdownFiles();
				for (const file of files) {
					if (file.path === filePath) {
						const leaf = this.app.workspace.getLeaf('tab');
						await leaf.openFile(file);
						return;
					}
				}
				throw new Error(`${filePath} already exists but fail to open`);
			}
			if (directoryPath !== '') {
				// If `input` includes a directory part, create it
				this.log("creating directory path: ", directoryPath);
				await this.createDirectory(directoryPath);
			}
			this.log("creating file: ", filePath);
			const File = await vault.create(filePath, '');
			// Create the file and open it in the active leaf
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(File);
		} catch (error) {
			new Notice(error.toString());
		}
	}

	/**
	 * Joins multiple strings into a path using Obsidian's preferred format.
	 * The resulting path is normalized with Obsidian's `normalizePath` func.
	 * - Converts path separators to '/' on all platforms
	 * - Removes duplicate separators
	 * - Removes trailing slash
	 **/
	private join(...strings: string[]): string {
		const parts = strings.map((s) => String(s).trim()).filter((s) => s != null);
		return normalizePath(parts.join('/'));
	}
}

