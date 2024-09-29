/* Copyright 2023 edonyzpc */

import { App, PluginSettingTab, Setting } from "obsidian";
import Picker from "vanilla-picker";

import { PluginManager } from "./plugin"
import { STAT_PREVIEW_TYPE } from './statsView'
import { CryptoHelper, personalAssitant } from './utils'

export interface ResizeStyle {
    width: number,
    height: number,
}

export interface PluginManagerSettings {
    debug: boolean;
    targetPath: string;
    fileFormat: string;
    previewLimits: number;
    previewTags: string[];
    localGraph: {
        notice: string,
        type: string,
        depth: number,
        showTags: boolean,
        showAttach: boolean,
        showNeighbor: boolean,
        collapse: boolean,
        autoColors: boolean,
        resizeStyle: ResizeStyle,
    };
    memos: {
        resizeStyle: ResizeStyle,
    };
    enableGraphColors: boolean;
    colorGroups: {
        query: string,
        color: {
            a: number,
            rgb: number,
        }
    }[];
    enableMetadataUpdating: boolean;
    metadatas: { key: string, value: any, t: string }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    metadataExcludePath: string[];
    isEnabledMetadataUpdating: boolean;
    cachePluginRepo: { [key: string]: any; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    cacheThemeRepo: { [key: string]: any; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    statisticsType: string;
    statsPath: string;
    displaySectionCounts: boolean;
    countComments: boolean;
    animation: boolean;
    modelName: string;
    apiToken: string;
}

export const DEFAULT_SETTINGS: PluginManagerSettings = {
    debug: false,
    targetPath: ".",
    fileFormat: "YYYY-MM-DD",
    previewLimits: 5,
    previewTags: [],
    localGraph: {
        notice: "show current note grah view",
        type: "popover",
        depth: 2,
        showTags: true,
        showAttach: true,
        showNeighbor: true,
        collapse: false,
        autoColors: false,
        resizeStyle: {
            width: 550,
            height: 500,
        }
    },
    memos: {
        resizeStyle: {
            width: 550,
            height: 500,
        }
    },
    enableGraphColors: false,
    colorGroups: [
        {
            query: "path:/",
            color: {
                a: 1,
                rgb: 6617700,
            }
        }
    ],
    enableMetadataUpdating: false,
    metadatas: [
        { key: "modify", value: "YYYY-MM-DD HH:mm:ss", t: "moment" },
    ],
    metadataExcludePath: [],
    isEnabledMetadataUpdating: false,
    cachePluginRepo: {
        "personal-assistant": "edonyzpc/personal-assistant",
    },
    cacheThemeRepo: {
        "Minimal": "kepano/obsidian-minimal",
    },
    statisticsType: "none",
    statsPath: ".obsidian/stats.json",
    displaySectionCounts: false,
    countComments: false,
    animation: false,
    modelName: "qwen-plus",
    apiToken: "sk-xxx",
}

interface GraphColor {
    query: string;
    color: {
        a: number,
        rgb: number,
    }
}

const DEFAULT_GRAPH_COLOR: GraphColor = {
    query: "path:/",
    color: {
        a: 1,
        rgb: 6617700,
    }
}


export class SettingTab extends PluginSettingTab {
    plugin: PluginManager;
    private log;

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
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
        link.href = "https://github.com/edonyzpc/personal-assistant";
        link.setAttr("style", "font-style: italic;");
        containerEl.createEl("p", { text: "Obsidian Assistant by Shadow Walker, " }).appendChild(link);

        // setting option for debug
        new Setting(containerEl).setName("Debug").addToggle((cb) =>
            cb.setValue(this.plugin.settings.debug)
                .onChange((value) => {
                    this.plugin.settings.debug = value;
                    this.plugin.saveSettings();
                }));


        // settiong options for recording
        containerEl.createEl('h2', { text: 'Settings for Record' });
        containerEl.createEl("p", { text: "Obsidian Management for Recording in Specific Path" }).setAttr("style", "font-size:14px");
        new Setting(containerEl).setName('Target Path')
            .setDesc('Target directory to do recording')
            .addText(text => text
                .setPlaceholder('.')
                .setValue(this.plugin.settings.targetPath)
                .onChange(async (value) => {
                    this.log('target path: ' + value);
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
            .addText(text => text.setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.fileFormat)
                .onChange(async (value) => {
                    this.log('format setting: ' + value);
                    plugin.settings.fileFormat = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl).setName("Preview Number")
            .setDesc("File numbers to preview")
            .addText(text => {
                text.setPlaceholder('5')
                    .setValue(this.plugin.settings.previewLimits.toString())
                    .onChange(async (value) => {
                        plugin.settings.previewLimits = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });


        // setting options for local graph
        containerEl.createEl('h2', { text: 'Settings for Hover Local Graph' });
        containerEl.createEl("p", { text: "Obsidian Management for Hover Local Graph" }).setAttr("style", "font-size:14px");
        new Setting(containerEl).setName('Type')
            .setDesc('Type of hover')
            .addText(text => {
                text.setPlaceholder('popover')
                    .setValue(this.plugin.settings.localGraph.type)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.type = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Depth')
            .setDesc('Depth of link jumps')
            .addText(text => {
                text.setPlaceholder('2')
                    .setValue(this.plugin.settings.localGraph.depth.toString())
                    .onChange(async (value) => {
                        plugin.settings.localGraph.depth = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Show Tags')
            .setDesc('Show tags in local graph view')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.localGraph.showTags)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showTags = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Show Attachment')
            .setDesc('Show attachments in local graph view')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.localGraph.showAttach)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showAttach = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Show Neighbor')
            .setDesc('Show neighbors in local graph view')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.localGraph.showNeighbor)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showNeighbor = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Collapse')
            .setDesc('Collapse local graph view setting')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.localGraph.collapse)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.collapse = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName('Auto Local Graph Colors')
            .setDesc('Automatically set colors of local graph view.')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.autoColors).onChange(async value => {
                    plugin.settings.localGraph.autoColors = value;
                    await plugin.saveSettings();
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
                text.setPlaceholder('height')
                    .setValue(this.plugin.settings.localGraph.resizeStyle.height.toString())
                    .onChange(async (value) => {
                        plugin.settings.localGraph.resizeStyle.height = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName(w)
            .addText(text => {
                text.setPlaceholder('width')
                    .setValue(this.plugin.settings.localGraph.resizeStyle.width.toString())
                    .onChange(async (value) => {
                        plugin.settings.localGraph.resizeStyle.width = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });


        // setting options for memos
        containerEl.createEl('h2', { text: 'Settings for Memos' });
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
        new Setting(containerEl).setName(mh)
            .addText(text => {
                text.setPlaceholder('height')
                    .setValue(this.plugin.settings.memos.resizeStyle.height.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.height = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName(mw)
            .addText(text => {
                text.setPlaceholder('width')
                    .setValue(this.plugin.settings.memos.resizeStyle.width.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.width = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });


        // setting options for graph colors
        containerEl.createEl('h2', { text: 'Graph Colors' })
        new Setting(containerEl).setName('Enable Graph Colors')
            .setDesc('Use personal assistant set colors of graph view.')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.enableGraphColors).onChange(async value => {
                    plugin.settings.enableGraphColors = value;
                    await plugin.saveSettings();
                    this.display();
                })
            });
        if (plugin.settings.enableGraphColors) {
            // deep copy setting.colorGroups for rendering
            const colorGroups: { query: string, color: { a: number, rgb: number } }[] = JSON.parse(JSON.stringify(plugin.settings.colorGroups));
            colorGroups.forEach((colorGroup) => {
                // find if the item is exist in plugin.settings
                const index = this.findGraphColor(colorGroup);
                const color = `#${colorGroup.color.rgb.toString(16)}`;
                const hexToRGB = (hex: string) => {
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    return "rgb(" + r + ", " + g + ", " + b + ")";
                };
                const colorRgb = hexToRGB(color);
                const nameEl = document.createDocumentFragment();
                nameEl.createSpan({ text: "●", attr: { style: `color: ${color}` } });
                nameEl.appendText(` Color for #${colorGroup.query}`);
                new Setting(containerEl)
                    .setName(nameEl)
                    .setDesc('This will be the Color used in the graph view.')
                    .addText(text => {
                        text.setValue(plugin.settings.colorGroups[index].query)
                            .onChange(async (value) => {
                                if (index > -1) {
                                    plugin.settings.colorGroups[index].query = value;
                                    await this.plugin.saveSettings();
                                }
                            })
                    })
                    .addButton(btn => {
                        btn.setButtonText("Change Color");
                        new Picker({
                            parent: btn.buttonEl,
                            onDone: async (color) => {
                                // hex format color: #00000000, [0] '#', [1-6] rgb, [7-8] alpha
                                let hexColor = color.hex.split('#')[1];
                                this.log(`origin hex color = ${hexColor}`);
                                // only get the color value without alpha, obsidian set alpha as 0xff by default
                                if (hexColor.length === 8) {
                                    hexColor = hexColor.substring(0, 6);
                                }
                                this.log(`hexColor without alpha ${hexColor}`);
                                if (index > -1) {
                                    this.plugin.settings.colorGroups[index].color.rgb = parseInt(hexColor, 16);
                                    await this.plugin.saveSettings();
                                    this.display();
                                }
                            },
                            popup: "left",
                            color: colorRgb,
                            alpha: false,
                        });
                    })
                    .addExtraButton(btn => {
                        btn.setIcon("trash").setTooltip("Remove").onClick(async () => {
                            //this.plugin.settings.colorGroups.remove(colorGroup);
                            if (index > -1) {
                                this.log(`removing  ${this.plugin.settings.colorGroups[index]}`);
                                this.plugin.settings.colorGroups.splice(index, 1);
                            }

                            await this.plugin.saveSettings();
                            this.display();
                        });
                    })
                    .addExtraButton(btn => {
                        btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
                            if (index > -1) {
                                this.log(`resetting ${this.plugin.settings.colorGroups[index]}`);
                                this.plugin.settings.colorGroups[index] = JSON.parse(JSON.stringify(DEFAULT_GRAPH_COLOR));
                            }
                            await this.plugin.saveSettings();
                            this.display();
                        });
                    });
            });
            new Setting(containerEl)
                .addButton(btn => {
                    btn.setButtonText("Add Color").onClick(async () => {
                        this.log("adding new color");
                        this.plugin.settings.colorGroups.push(JSON.parse(JSON.stringify(DEFAULT_GRAPH_COLOR)));
                        await this.plugin.saveSettings();
                        this.display();
                    })
                });
        }

        // setting options for updating metadata
        containerEl.createEl('h2', { text: 'Metadata Management' })
        const descFormat = document.createDocumentFragment();
        descFormat.createEl('p', undefined, (p) => {
            p.innerText = "Auto updating metadata in frontmatter when file is modified.\nTimestamp format follows `moment.js` and syntax details, ";
            p.createEl('a', undefined, (link) => {
                link.innerText = 'please check moment format.';
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(containerEl).setName('Enable Updating Metadata')
            .setDesc(descFormat)
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.enableMetadataUpdating).onChange(async value => {
                    plugin.settings.enableMetadataUpdating = value;
                    await plugin.saveSettings();
                    this.display();
                })
            });
        if (plugin.settings.enableMetadataUpdating) {
            // deep copy metadata for rendering
            const metas: { key: string, value: any }[] = JSON.parse(JSON.stringify(plugin.settings.metadatas)); // eslint-disable-line @typescript-eslint/no-explicit-any
            const nameEl1 = document.createDocumentFragment();
            nameEl1.createSpan({ text: "---" });
            new Setting(containerEl)
                .setName(nameEl1);
            for (let i = 0; i < metas.length; i++) {
                const index = this.findMetadata(metas[i].key);
                const nameEl = document.createDocumentFragment();
                nameEl.appendText(`${metas[i].key}: `);
                new Setting(containerEl)
                    .setName(nameEl)
                    .addText(text => {
                        text.setValue(plugin.settings.metadatas[index].value)
                            .onChange(async (value) => {
                                if (index > -1) {
                                    plugin.settings.metadatas[index].value = value;
                                    await this.plugin.saveSettings();
                                }
                            })
                    })
                    .addExtraButton(btn => {
                        btn.setIcon("trash").setTooltip("Remove").onClick(async () => {
                            //this.plugin.settings.colorGroups.remove(colorGroup);
                            if (index > -1) {
                                this.log(`removing  ${this.plugin.settings.metadatas[index]}`);
                                this.plugin.settings.metadatas.splice(index, 1);
                            }

                            await this.plugin.saveSettings();
                            this.display();
                        });
                    })
            }
            const nameEl2 = document.createDocumentFragment();
            nameEl2.createSpan({ text: "---" });
            new Setting(containerEl)
                .setName(nameEl2);
            // TODO: design better UX to configure frontmatter auto-updating

            let key: string;
            let value: any; // eslint-disable-line @typescript-eslint/no-explicit-any
            let t: string;
            new Setting(containerEl)
                .setName("Add Key:Value in frontmatter")
                .setDesc('Value now only upport formatted timestamp and regular string.')
                .addText(text => {
                    text.setPlaceholder('key')
                        .setValue(key)
                        .onChange(async (val) => {
                            key = val;
                        })
                })
                .addText(text => {
                    text.setPlaceholder('value')
                        .setValue(value)
                        .onChange(async (val) => {
                            value = val;
                        })
                })
                .addDropdown(dropDown => {
                    dropDown.addOption('string', '1 Regular String');
                    dropDown.addOption('moment', '2 Timestamp');
                    dropDown.onChange(async (value) => {
                        t = value;
                    });
                })
                .addButton(btn => {
                    btn.setButtonText("Add").onClick(async () => {
                        this.log("adding new frontmatter");
                        this.plugin.settings.metadatas.push({ key: key, value: value, t: t });
                        await this.plugin.saveSettings();
                        this.display();
                    })
                });
            new Setting(containerEl).setName("Meta Updating Exclude Path")
                .setDesc("Exclude files in the directory to update metadata")
                .addText(text => {
                    text.setPlaceholder('path strings with comma as separator, e.g. `tmp/,notes/templates`')
                        .setValue(this.plugin.settings.metadataExcludePath.join(','))
                        .onChange(async (value) => {
                            plugin.settings.metadataExcludePath = value.split(",");
                            await this.plugin.saveSettings();
                        })
                });


        }

        // setting for show statistics
        containerEl.createEl('h2', { text: 'Vault Statistics' })
        new Setting(containerEl).setName("Show Statistics")
            .setDesc("Show statistics in the status bar")
            .addDropdown(dropDown => {
                // reset to default
                this.log(this.plugin.settings.statisticsType);
                const daily = dropDown.addOption('daily', 'Daily Statistcs');
                const total = dropDown.addOption('total', 'Total Statistics');
                if (this.plugin.settings.statisticsType === 'daily') {
                    daily.setDisabled(false);
                    dropDown.setValue('daily');
                } else {
                    total.setDisabled(false);
                    dropDown.setValue('total');
                }
                dropDown.onChange(async (value) => {
                    this.plugin.log("changing statistics type", value);
                    this.plugin.settings.statisticsType = value;
                    await this.plugin.saveSettings();

                    // popup view
                    const leaf = this.app.workspace.getLeaf("window");
                    await leaf.setViewState({
                        type: STAT_PREVIEW_TYPE,
                        active: false,
                    });
                    this.app.workspace.revealLeaf(leaf);
                });
            });
        new Setting(containerEl)
            .setName("Vault Stats File Path")
            .setDesc("Reload required for change to take effect. The location of the vault statistics file, relative to the vault root.")
            .addText((text) => {
                text.setPlaceholder(".obsidian/stats.json");
                text.setValue(this.plugin.settings.statsPath.toString());
                text.onChange(async (value: string) => {
                    this.plugin.settings.statsPath = value;
                    await this.plugin.saveSettings();
                });
            });
        new Setting(containerEl).setName("Animation").addToggle((cb) =>
            cb.setValue(this.plugin.settings.animation)
                .onChange((value) => {
                    this.plugin.settings.animation = value;
                    this.plugin.saveSettings();
                })
        );

        // setting for AI assistant
        containerEl.createEl('h2', { text: 'AI Assistant' });
        containerEl.createEl("p", { text: 'AI Helper Only Support 通义千问 LLM' }).setAttr("style", "font-size:15px");
        new Setting(containerEl).setName("Set Model Name")
            .setDesc("Select the model name for AI Helper, only support qwen-max, qwen-turbo, qwen-plus")
            .addDropdown(dropDown => {
                const qwenMax = dropDown.addOption('qwen-max', 'qwen max');
                const qwenTurbo = dropDown.addOption('qwen-turbo', 'qwen turbo');
                const qwenPlus = dropDown.addOption('qwen-plus', 'qwen plus');
                if (this.plugin.settings.modelName === 'qwen-max') {
                    qwenMax.setDisabled(false);
                    dropDown.setValue('qwen-max');
                } else if (this.plugin.settings.modelName === 'qwen-turbo') {
                    qwenTurbo.setDisabled(false);
                    dropDown.setValue('qwen-turbo');
                } else {
                    qwenPlus.setDisabled(false);
                    dropDown.setValue('qwen-plus');
                }
                dropDown.onChange(async (value) => {
                    this.plugin.log("changing modle provider", value);
                    this.plugin.settings.modelName = value;
                    await this.plugin.saveSettings();
                });
            });
        new Setting(containerEl)
            .setName("API Token")
            .setDesc("LLM Model related API Token. NOTE: your input token is protected by AES-GCM encryption.")
            .addText((text) => {
                text.setPlaceholder("llm api token");
                text.setValue(this.plugin.settings.apiToken);
                text.onChange(async (value: string) => {
                    const crypto = new CryptoHelper();
                    const data = await crypto.encryptToBase64(value, personalAssitant);
                    this.plugin.settings.apiToken = data;
                    await this.plugin.saveSettings();
                });
            });
    }

    private findGraphColor(graphColor: GraphColor): number {
        return this.plugin.settings.colorGroups.findIndex((color) => {
            return graphColor.query === color.query &&
                graphColor.color.a === color.color.a &&
                graphColor.color.rgb === color.color.rgb;
        });
    }

    private findMetadata(metaKey: string) {
        return this.plugin.settings.metadatas.findIndex((m) => {
            return m.key === metaKey;
        })
    }
}
