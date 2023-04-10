import { Notice, Plugin, Platform, addIcon, moment, normalizePath, setIcon } from 'obsidian';

import { PluginControlModal, OpenPlugin, ClosePlugin } from './modal'
import { SettingTab, PluginManagerSettings, DEFAULT_SETTINGS } from './settings'
import { LocalGraph } from './localGraph';
import { Memos } from './memos';

const debug = (debug: boolean, ...msg: any) => {
	if (debug) console.log(...msg);
};

const icons: Record<string, string> = {
	PluginAST: `<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px"
	width="100" height="100"
	viewBox="0 0 172 172"
	style=" fill:#000000;"><g fill="none" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><path d="M0,172v-172h172v172z" fill="none"></path><g fill="currentColor"><path d="M53.75,21.5c-8.27246,0 -14.86523,5.20703 -18.39257,12.09375c-8.39844,1.76368 -15.91504,6.84473 -19.31641,15.03321c-6.50879,15.5371 -16.04102,41.53027 -16.04102,64.24804c0,20.70215 16.92285,37.625 37.625,37.625c14.90723,0 27.75683,-8.86035 33.84571,-21.5h29.05859c6.08886,12.63965 18.93847,21.5 33.8457,21.5c20.70215,0 37.625,-16.92285 37.625,-37.625c0,-8.44043 -2.60351,-19.44239 -5.87891,-30.90625c-3.31739,-11.50585 -7.39062,-23.26367 -10.58203,-32.08203c-3.10742,-8.44043 -10.41406,-13.85742 -18.77051,-15.99902c-3.48534,-7.05469 -10.12011,-12.3877 -18.51855,-12.3877c-7.68457,0 -13.73145,4.61915 -17.51074,10.75h-29.47852c-3.77929,-6.13085 -9.82617,-10.75 -17.51074,-10.75zM53.75,32.25c4.70313,0 8.6084,3.02344 10.07813,7.18067l1.25977,3.56933h41.82422l1.25976,-3.56933c1.46973,-4.15723 5.375,-7.18067 10.07813,-7.18067c4.8291,0 8.77636,3.19141 10.16211,7.5166l1.00781,3.14942l3.27539,0.50391c5.87891,0.92382 10.70801,4.61914 12.76563,10.1621c2.81348,7.72656 6.21484,17.7627 9.19629,27.71484c-5.87891,-3.77929 -12.80761,-6.04687 -20.28223,-6.04687c-14.90723,0 -27.75683,8.86035 -33.8457,21.5h-29.05859c-6.08888,-12.63965 -18.93848,-21.5 -33.84571,-21.5c-8.18848,0 -15.74707,2.72949 -21.91992,7.22266c3.06543,-11.21192 7.01269,-21.87793 10.24609,-29.68848c2.22558,-5.375 7.22266,-8.86034 13.10156,-9.49023l3.44335,-0.37793l1.0918,-3.2754c1.42773,-4.2832 5.375,-7.39062 10.1621,-7.39062zM37.625,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM134.375,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM74.7041,107.5h22.59179c-0.25195,1.76368 -0.5459,3.52734 -0.5459,5.375c0,1.84766 0.29395,3.61133 0.5459,5.375h-22.59179c0.25195,-1.76367 0.5459,-3.52734 0.5459,-5.375c0,-1.84766 -0.29395,-3.61132 -0.5459,-5.375z"></path></g></g></svg>`,
	PluginAST_STATUSBAR: `<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px"
	width="100" height="100"
	viewBox="0 0 172 172"><g fill="currentColor" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><path d="M0,172v-172h172v172z" fill="none"></path><g fill="currentColor"><path d="M53.75,21.5c-8.27246,0 -14.86523,5.20703 -18.39257,12.09375c-8.39844,1.76368 -15.91504,6.84473 -19.31641,15.03321c-6.50879,15.5371 -16.04102,41.53027 -16.04102,64.24804c0,20.70215 16.92285,37.625 37.625,37.625c14.90723,0 27.75683,-8.86035 33.84571,-21.5h29.05859c6.08886,12.63965 18.93847,21.5 33.8457,21.5c20.70215,0 37.625,-16.92285 37.625,-37.625c0,-8.44043 -2.60351,-19.44239 -5.87891,-30.90625c-3.31739,-11.50585 -7.39062,-23.26367 -10.58203,-32.08203c-3.10742,-8.44043 -10.41406,-13.85742 -18.77051,-15.99902c-3.48534,-7.05469 -10.12011,-12.3877 -18.51855,-12.3877c-7.68457,0 -13.73145,4.61915 -17.51074,10.75h-29.47852c-3.77929,-6.13085 -9.82617,-10.75 -17.51074,-10.75zM53.75,32.25c4.70313,0 8.6084,3.02344 10.07813,7.18067l1.25977,3.56933h41.82422l1.25976,-3.56933c1.46973,-4.15723 5.375,-7.18067 10.07813,-7.18067c4.8291,0 8.77636,3.19141 10.16211,7.5166l1.00781,3.14942l3.27539,0.50391c5.87891,0.92382 10.70801,4.61914 12.76563,10.1621c2.81348,7.72656 6.21484,17.7627 9.19629,27.71484c-5.87891,-3.77929 -12.80761,-6.04687 -20.28223,-6.04687c-14.90723,0 -27.75683,8.86035 -33.8457,21.5h-29.05859c-6.08888,-12.63965 -18.93848,-21.5 -33.84571,-21.5c-8.18848,0 -15.74707,2.72949 -21.91992,7.22266c3.06543,-11.21192 7.01269,-21.87793 10.24609,-29.68848c2.22558,-5.375 7.22266,-8.86034 13.10156,-9.49023l3.44335,-0.37793l1.0918,-3.2754c1.42773,-4.2832 5.375,-7.39062 10.1621,-7.39062zM37.625,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM134.375,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM74.7041,107.5h22.59179c-0.25195,1.76368 -0.5459,3.52734 -0.5459,5.375c0,1.84766 0.29395,3.61133 0.5459,5.375h-22.59179c0.25195,-1.76367 0.5459,-3.52734 0.5459,-5.375c0,-1.84766 -0.29395,-3.61132 -0.5459,-5.375z"></path></g></g></svg>`
};

export class PluginManager extends Plugin {
	settings: PluginManagerSettings
	private localGraph = new LocalGraph(this.app, this);
	private memos = new Memos(this.app, this);

	async onload() {
		new Notice("starting obsidian assistant");
		await this.loadSettings();
		// monitor element which is concerned by other command
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
			new PluginControlModal(this.app, OpenPlugin).open();
		});
		// Perform additional things with the ribbon
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
			new PluginControlModal(this.app, ClosePlugin).open();
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
			id: 'assistant-memos',
			name: 'assistant hover memos',
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "m" }],
			callback: async () => {
				await this.memos.startup();
			}
		});

		this.addCommand({
			id: 'assistant-local-graph',
			name: 'hover local graph',
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "g" }],
			callback: async () => {
				await this.localGraph.startup();
			}
		});

		this.addCommand({
			id: 'open-disabled-plugin',
			name: 'open disabled plugin',
			callback: () => {
				new PluginControlModal(this.app, OpenPlugin).open();
			}
		});

		this.addCommand({
			id: 'close-enabled-plugin',
			name: 'close enabled plugin',
			callback: () => {
				new PluginControlModal(this.app, ClosePlugin).open();
			}
		});

		this.addCommand({
			id: 'set-local-graph-view-colors',
			name: 'Set graph view colors',
			callback: async () => {
				await this.localGraph.updateGraphColors();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			this.log('click', evt);
		});
		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => this.log('setInterval'), 5 * 60 * 1000));
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

	log(...msg: any) {
		debug(this.settings.debug, ...msg);
	}

	private async createDirectory(dir: string): Promise<void> {
		const { vault } = this.app;
		const { adapter } = vault;
		const root = vault.getRoot().path;
		const directoryPath = this.join(root, dir);
		const directoryExists = await adapter.exists(directoryPath);
		// ===============================================================
		// -> Desktop App
		// ===============================================================
		if (!Platform.isIosApp) {
			if (!directoryExists) {
				return adapter.mkdir(normalizePath(directoryPath));
			}
		}
		// ===============================================================
		// -> Mobile App (IOS)
		// ===============================================================
		// This is a workaround for a bug in the mobile app:
		// To get the file explorer view to update correctly, we have to create
		// each directory in the path one at time.

		// Split the path into an array of sub paths
		// Note: `normalizePath` converts path separators to '/' on all platforms
		// @example '/one/two/three/' ==> ['one', 'one/two', 'one/two/three']
		// @example 'one\two\three' ==> ['one', 'one/two', 'one/two/three']
		const subPaths: string[] = normalizePath(directoryPath)
			.split('/')
			.filter((part) => part.trim() !== '')
			.map((_, index, arr) => arr.slice(0, index + 1).join('/'));

		// Create each directory if it does not exist
		for (const subPath of subPaths) {
			const directoryExists = await adapter.exists(this.join(root, subPath));
			if (!directoryExists) {
				await adapter.mkdir(this.join(root, subPath));
			}
		}
	}


	/**
   * Handles creating the new note
   * A new markdown file will be created at the given file path (`input`)
   * in the specified parent folder (`this.folder`)
   */
	async createNewNote(targetPath: string, fileName: string): Promise<void> {
		const { vault } = this.app;
		const { adapter } = vault;
		const root = vault.getRoot().path;
		const directoryPath = this.join(root, targetPath);
		const filePath = this.join(directoryPath, `${fileName}.md`);

		try {
			const fileExists = await adapter.exists(filePath);
			if (fileExists) {
				// If the file already exists, open it and send notification
				const files = vault.getMarkdownFiles();
				for (const file of files) {
					this.log(file);
					if (file.path === filePath) {
						const leaf = this.app.workspace.getLeaf(false);
						await leaf.openFile(file);
					}
				}
				throw new Error(`${filePath} already exists`);
			}
			if (directoryPath !== '') {
				// If `input` includes a directory part, create it
				await this.createDirectory(directoryPath);
			}
			const File = await vault.create(filePath, '');
			// Create the file and open it in the active leaf
			const leaf = this.app.workspace.getLeaf(false);
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
   */
	private join(...strings: string[]): string {
		const parts = strings.map((s) => String(s).trim()).filter((s) => s != null);
		return normalizePath(parts.join('/'));
	}
}

