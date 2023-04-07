import { App, PluginSettingTab, Setting } from "obsidian";

import { PluginManager } from "./plugin"

interface ResizeStyle {
    width: number,
    height: number,
    top: number,
    left: number,
}

export interface PluginManagerSettings {
    debug: boolean;
    targetPath: string;
    fileFormat: string;
    localGraph: {
        notice: string,
        type: string,
        depth: number,
        showTags: boolean,
        showAttach: boolean,
        showNeighbor: boolean,
        collapse: boolean,
        resizeStyle: ResizeStyle,
    }
    memos: {
        resizeStyle: ResizeStyle,
    }
}

export const DEFAULT_SETTINGS: PluginManagerSettings = {
    debug: true,
    targetPath: "2.fleeting/fleeting-thoughts/",
    fileFormat: "YYYY-MM-DD",
    localGraph: {
        notice: "show current note grah view",
        type: "popover",
        depth: 2,
        showTags: true,
        showAttach: true,
        showNeighbor: true,
        collapse: false,
        resizeStyle: {
            width: 550,
            height: 500,
            left:475,
            top: 255
        }
    },
    memos: {
        resizeStyle: {
            width: 550,
            height: 500,
            left:475,
            top: 255
        }
    }
}

// [obsidian-link-archive](https://github.com/tomzorz/obsidian-link-archive/blob/master/settings.ts)
// [obsidian-dev-tools](https://github.com/KjellConnelly/obsidian-dev-tools)
export class SettingTab extends PluginSettingTab {
    plugin: PluginManager;

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const plugin: PluginManager = this.plugin;
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h1', { text: 'Settings for Obsidian Assistant' });
        // create anchor link element
        const link = document.createElement("a");
        link.setText("Open GitHub repository");
        // set the href property
        link.href = "https://github.com/edonyzpc/obsidian-plugins-mng";
        link.setAttr("style", "font-style: italic;");
        containerEl.createEl("p", { text: "Obsidian Assistant by Shadow Walker, " }).appendChild(link);
        //containerEl.createEl("a", { text: "Open GitHub repository", href: "https://github.com/edonyzpc/obsidian-plugins-mng" });

        new Setting(containerEl).setName("Debug").addToggle((cb) =>
            cb.setValue(this.plugin.settings.debug)
                .onChange((value) => {
                    this.plugin.settings.debug = value;
                    this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'Settings for Record' });
        containerEl.createEl("p", { text: "Obsidian Management for Recording in Specific Path" }).setAttr("style", "font-size:14px");
        new Setting(containerEl).setName('Target Path')
            .setDesc('Target directory to do recording')
            .addText(text => text
                .setPlaceholder('2.fleeting/fleeting-thoughts/')
                .setValue(this.plugin.settings.targetPath)
                .onChange(async (value) => {
                    this.plugin.log('target path: ' + value);
                    plugin.settings.targetPath = value;
                    await this.plugin.saveSettings();
                }));
        const desc_format = document.createDocumentFragment();
        desc_format.createEl('p', undefined, (p) => {
            p.innerText = "File format which is like Diary setting.\nFor more syntax details, ";
            p.createEl('a', undefined, (link) => {
                link.innerText = 'please check moment format.';
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(containerEl).setName('File Format')
            .setDesc(desc_format)
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.fileFormat)
                .onChange(async (value) => {
                    this.plugin.log('format setting: ' + value);
                    plugin.settings.fileFormat = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'Settings for Hover Local Graph' });
        containerEl.createEl("p", { text: "Obsidian Management for Hover Local Graph" }).setAttr("style", "font-size:14px");
        new Setting(containerEl).setName('Type')
            .setDesc('Type of hover')
            .addText(text => {
                text
                    .setPlaceholder('popover')
                    .setValue(this.plugin.settings.localGraph.type)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.type = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Depth')
            .setDesc('Depth of link jumps')
            .addText(text => {
                text
                    .setPlaceholder('2')
                    .setValue(this.plugin.settings.localGraph.depth.toString())
                    .onChange(async (value) => {
                        plugin.settings.localGraph.depth = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Show Tags')
            .setDesc('Show tags in local graph view')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.localGraph.showTags)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showTags = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Show Attachment')
            .setDesc('Show attachments in local graph view')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.localGraph.showAttach)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showAttach = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Show Neighbor')
            .setDesc('Show neighbors in local graph view')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.localGraph.showNeighbor)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showNeighbor = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Collapse')
            .setDesc('Collapse local graph view setting')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.localGraph.collapse)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.collapse = value;
                        await this.plugin.saveSettings();
                    })
            });
        containerEl.createEl("p", { text: "Graph Resize" }).setAttr("style", "font-size:15px");
        const h = document.createDocumentFragment();
        h.createEl('span', undefined, (p) => {
            p.innerText = "height";
            p.setAttr('style', 'margin:18px');
        });
        const w = document.createDocumentFragment();
        w.createEl('span', undefined, (p) => {
            p.innerText = "width";
            p.setAttr('style', 'margin:18px');
        });
        const t = document.createDocumentFragment();
        t.createEl('span', undefined, (p) => {
            p.innerText = "top";
            p.setAttr('style', 'margin:18px');
        });
        const l = document.createDocumentFragment();
        l.createEl('span', undefined, (p) => {
            p.innerText = "left";
            p.setAttr('style', 'margin:18px');
        });
        new Setting(containerEl).setName(h)
            .addText(text => {
                text
                .setPlaceholder('height')
                .setValue(this.plugin.settings.localGraph.resizeStyle.height.toString())
                .onChange(async (value) => {
                    plugin.settings.localGraph.resizeStyle.height = parseInt(value);
                    await this.plugin.saveSettings();
                })
            });
        new Setting(containerEl).setName(w)
            .addText(text => {
                text
                .setPlaceholder('width')
                .setValue(this.plugin.settings.localGraph.resizeStyle.width.toString())
                .onChange(async (value) => {
                    plugin.settings.localGraph.resizeStyle.width = parseInt(value);
                    await this.plugin.saveSettings();
                })
            });
        new Setting(containerEl).setName(t)
            .addText(text => {
                text
                .setPlaceholder('top')
                .setValue(this.plugin.settings.localGraph.resizeStyle.top.toString())
                .onChange(async (value) => {
                    plugin.settings.localGraph.resizeStyle.top = parseInt(value);
                    await this.plugin.saveSettings();
                })
            });
        new Setting(containerEl).setName(l)
            .addText(text => {
                text
                .setPlaceholder('left')
                .setValue(this.plugin.settings.localGraph.resizeStyle.left.toString())
                .onChange(async (value) => {
                    plugin.settings.localGraph.resizeStyle.left = parseInt(value);
                    await this.plugin.saveSettings();
                })
            });
            containerEl.createEl("p", { text: "Memos Resize" }).setAttr("style", "font-size:15px");
            const mh = document.createDocumentFragment();
            mh.createEl('span', undefined, (p) => {
                p.innerText = "height";
                p.setAttr('style', 'margin:18px');
            });
            const mw = document.createDocumentFragment();
            mw.createEl('span', undefined, (p) => {
                p.innerText = "width";
                p.setAttr('style', 'margin:18px');
            });
            const mt = document.createDocumentFragment();
            mt.createEl('span', undefined, (p) => {
                p.innerText = "top";
                p.setAttr('style', 'margin:18px');
            });
            const ml = document.createDocumentFragment();
            ml.createEl('span', undefined, (p) => {
                p.innerText = "left";
                p.setAttr('style', 'margin:18px');
            });
            new Setting(containerEl).setName(mh)
                .addText(text => {
                    text
                    .setPlaceholder('height')
                    .setValue(this.plugin.settings.memos.resizeStyle.height.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.height = parseInt(value);
                        await this.plugin.saveSettings();
                    })
                });
            new Setting(containerEl).setName(mw)
                .addText(text => {
                    text
                    .setPlaceholder('width')
                    .setValue(this.plugin.settings.memos.resizeStyle.width.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.width = parseInt(value);
                        await this.plugin.saveSettings();
                    })
                });
            new Setting(containerEl).setName(mt)
                .addText(text => {
                    text
                    .setPlaceholder('top')
                    .setValue(this.plugin.settings.memos.resizeStyle.top.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.top = parseInt(value);
                        await this.plugin.saveSettings();
                    })
                });
            new Setting(containerEl).setName(ml)
                .addText(text => {
                    text
                    .setPlaceholder('left')
                    .setValue(this.plugin.settings.memos.resizeStyle.left.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.left = parseInt(value);
                        await this.plugin.saveSettings();
                    })
                });
    }

}
