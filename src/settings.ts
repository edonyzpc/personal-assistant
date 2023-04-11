import { App, PluginSettingTab, Setting } from "obsidian";
import Picker from "vanilla-picker";

import { PluginManager } from "./plugin"

export interface ResizeStyle {
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
        autoColors: false,
        resizeStyle: {
            width: 550,
            height: 500,
            left: 475,
            top: 255
        }
    },
    memos: {
        resizeStyle: {
            width: 550,
            height: 500,
            left: 475,
            top: 255
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
    ]
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
                .setPlaceholder('2.fleeting/fleeting-thoughts/')
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
        new Setting(containerEl).setName(t)
            .addText(text => {
                text.setPlaceholder('top')
                    .setValue(this.plugin.settings.localGraph.resizeStyle.top.toString())
                    .onChange(async (value) => {
                        plugin.settings.localGraph.resizeStyle.top = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName(l)
            .addText(text => {
                text.setPlaceholder('left')
                    .setValue(this.plugin.settings.localGraph.resizeStyle.left.toString())
                    .onChange(async (value) => {
                        plugin.settings.localGraph.resizeStyle.left = parseInt(value);
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
        new Setting(containerEl).setName(mt)
            .addText(text => {
                text.setPlaceholder('top')
                    .setValue(this.plugin.settings.memos.resizeStyle.top.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.top = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerEl).setName(ml)
            .addText(text => {
                text.setPlaceholder('left')
                    .setValue(this.plugin.settings.memos.resizeStyle.left.toString())
                    .onChange(async (value) => {
                        plugin.settings.memos.resizeStyle.left = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });


        // setting options for graph colors
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
    }

    private findGraphColor(graphColor: GraphColor): number {
        return this.plugin.settings.colorGroups.findIndex((color) => {
            return graphColor.query === color.query &&
                graphColor.color.a === color.color.a &&
                graphColor.color.rgb === color.color.rgb;
        });
    }
}
