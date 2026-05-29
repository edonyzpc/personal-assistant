/* Copyright 2023 edonyzpc */

import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import Picker from "vanilla-picker";

import type { PluginManager } from "./plugin"
import { BUNDLED_SKILL_CATALOG, BUNDLED_SKILL_IDS } from "./ai-services/bundled-skill-catalog";
import { isDashScopeCompatibleBaseURL } from "./ai-services/ai-utils";
import { STAT_PREVIEW_TYPE } from './stats-view'
import { normalizeStatisticsView } from './stats/stats-store'
import { KEYCHAIN_API_TOKEN_ID } from './utils'
import { confirmUserAction } from "./confirm";

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
    statisticsVaultId: string;
    statisticsSyncEnabled: boolean;
    displaySectionCounts: boolean;
    countComments: boolean;
    animation: boolean;
    // AI模型配置
    aiProvider: string; // 'qwen' | 'openai'
    apiToken: string;
    baseURL: string;
    chatModelName: string;
    policyModelName: string;
    embeddingModelName: string;
    embeddingV4MigrationNoticeDismissed: boolean;
    memoryEnabled: boolean;
    memoryAutoCheckBeforeChat: boolean;
    memoryApprovalPolicy: "always" | "auto-refresh-after-prepare";
    showAdvancedMemoryControls: boolean;
    nativeToolPlanningSmokeEnabled: boolean;
    qwenThinkingEnabled: boolean;
    webSearchEnabled: boolean;
    shareAnonymousCapabilityUsage: boolean;
    skillContextEnabled: boolean;
    enabledSkillIds: string[];
    // 兼容旧版本
    modelName: string;
    featuredImagePath: string;
    numFeaturedImages: number;
    vssCacheExcludePath: string[];
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
    statisticsType: "overview",
    statsPath: "",
    statisticsVaultId: "",
    statisticsSyncEnabled: false,
    displaySectionCounts: false,
    countComments: false,
    animation: false,
    // AI模型配置
    aiProvider: "qwen",
    apiToken: "",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatModelName: "qwen-plus",
    policyModelName: "",
    embeddingModelName: "text-embedding-v4",
    embeddingV4MigrationNoticeDismissed: false,
    memoryEnabled: true,
    memoryAutoCheckBeforeChat: true,
    memoryApprovalPolicy: "always",
    showAdvancedMemoryControls: false,
    nativeToolPlanningSmokeEnabled: false,
    qwenThinkingEnabled: false,
    webSearchEnabled: false,
    shareAnonymousCapabilityUsage: false,
    skillContextEnabled: true,
    enabledSkillIds: [...BUNDLED_SKILL_IDS],
    // 兼容旧版本
    modelName: "qwen-plus",
    featuredImagePath: "9.src",
    numFeaturedImages: 2,
    vssCacheExcludePath: [".obsidian", "8.template", "9.src", "a.subjects", "b.notion"],
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

const QWEN_RESPONSE_OPTIONS_DASHSCOPE_DESC =
    "Qwen thinking and builtin WebSearch require Alibaba Cloud DashScope. They do not change Memory from your notes.";
const QWEN_RESPONSE_OPTIONS_NON_DASHSCOPE_DESC =
    "Qwen thinking and builtin WebSearch are available only with the DashScope OpenAI-compatible base URL.";
export const STATISTICS_SYNC_SETTING_DESC =
    "Creates Statistics history files inside this plugin's vault folder so writing history can sync across devices. Leave off to avoid ongoing Git changes from synced history.";

export function normalizeEnabledSkillIds(value: unknown): string[] {
    const knownSkillIds = new Set(BUNDLED_SKILL_IDS);
    if (!Array.isArray(value)) return [...BUNDLED_SKILL_IDS];
    const normalized = value
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => knownSkillIds.has(entry));
    return [...new Set(normalized)];
}

interface QwenResponseOptionToggle {
    setDisabled(disabled: boolean): unknown;
}

interface QwenResponseOptionsDescription {
    setText(text: string): unknown;
}

export function updateQwenResponseOptionAvailability(
    baseURL: unknown,
    descriptionEl: QwenResponseOptionsDescription,
    toggles: QwenResponseOptionToggle[],
): boolean {
    const isDashScopeCompatible = isDashScopeCompatibleBaseURL(baseURL);
    descriptionEl.setText(
        isDashScopeCompatible
            ? QWEN_RESPONSE_OPTIONS_DASHSCOPE_DESC
            : QWEN_RESPONSE_OPTIONS_NON_DASHSCOPE_DESC
    );
    toggles.forEach((toggle) => toggle.setDisabled(!isDashScopeCompatible));
    return isDashScopeCompatible;
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
                                this.log("removing color group", this.plugin.settings.colorGroups[index]);
                                this.plugin.settings.colorGroups.splice(index, 1);
                            }

                            await this.plugin.saveSettings();
                            this.display();
                        });
                    })
                    .addExtraButton(btn => {
                        btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
                            if (index > -1) {
                                this.log("resetting color group", this.plugin.settings.colorGroups[index]);
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
                                this.log("removing metadata rule", this.plugin.settings.metadatas[index]);
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
            .setDesc("Choose the default statistics dashboard view")
            .addDropdown(dropDown => {
                dropDown.addOption('overview', 'Overview');
                dropDown.addOption('daily', 'Daily Writing');
                dropDown.addOption('growth', 'Growth');
                dropDown.addOption('composition', 'Composition');
                dropDown.setValue(normalizeStatisticsView(this.plugin.settings.statisticsType));
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
        new Setting(containerEl).setName("Sync statistics history across devices")
            .setDesc(STATISTICS_SYNC_SETTING_DESC)
            .addToggle((toggle) => {
                toggle.setValue(Boolean(this.plugin.settings.statisticsSyncEnabled))
                    .onChange(async (value) => {
                        const previousValue = Boolean(this.plugin.settings.statisticsSyncEnabled);
                        this.plugin.settings.statisticsSyncEnabled = value;
                        try {
                            await this.plugin.statsManager?.setStatisticsSyncEnabled(value);
                            await this.plugin.saveSettings();
                        } catch (error) {
                            this.plugin.settings.statisticsSyncEnabled = previousValue;
                            toggle.setValue(previousValue);
                            await this.plugin.saveSettings();
                            this.plugin.log("Failed to change Statistics sync setting", error);
                            new Notice("Could not change Statistics sync setting. Your notes are not affected.", 5000);
                        }
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
        containerEl.createEl("p", {
            text: 'AI Helper supports Qwen and OpenAI models',
        }).setAttr("style", "font-size:15px");
        let refreshQwenResponseOptionAvailability: (() => void) | undefined;

        // AI Provider Selection
        new Setting(containerEl).setName("AI Provider")
            .setDesc("Select the AI service provider")
            .addDropdown(dropDown => {
                dropDown.addOption('qwen', 'Qwen (通义千问)');
                dropDown.addOption('openai', 'OpenAI');

                dropDown.setValue(this.plugin.settings.aiProvider);
                dropDown.onChange(async (value) => {
                    this.plugin.log("changing AI provider", value);
                    this.plugin.settings.aiProvider = value;
                    // 根据提供商设置默认值
                    if (value === 'qwen') {
                        this.plugin.settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
                        this.plugin.settings.chatModelName = 'qwen-plus';
                        this.plugin.settings.embeddingModelName = 'text-embedding-v4';
                    } else if (value === 'openai') {
                        this.plugin.settings.baseURL = 'https://api.openai.com/v1';
                        this.plugin.settings.chatModelName = 'gpt-3.5-turbo';
                        this.plugin.settings.embeddingModelName = 'text-embedding-3-small';
                    }
                    await this.plugin.saveSettings();
                    this.display(); // 重新渲染设置界面
                });
            });

        // Base URL Setting
        new Setting(containerEl)
            .setName("Base URL")
            .setDesc("API base URL for the selected provider")
            .addText((text) => {
                text.setPlaceholder("https://api.openai.com/v1");
                text.setValue(this.plugin.settings.baseURL);
                text.onChange(async (value: string) => {
                    this.plugin.settings.baseURL = value;
                    await this.plugin.saveSettings();
                    refreshQwenResponseOptionAvailability?.();
                });
            });

        // Chat Model Name
        new Setting(containerEl)
            .setName("Chat Model Name")
            .setDesc("Name of the chat model to use")
            .addText((text) => {
                text.setPlaceholder("gpt-3.5-turbo");
                text.setValue(this.plugin.settings.chatModelName);
                text.onChange(async (value: string) => {
                    this.plugin.settings.chatModelName = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Policy model name")
            .setDesc("Optional lightweight model used to classify whether Memory, current note context, or builtin WebSearch is needed. Your chat request and explicitly sent context may be sent to your configured AI provider; hidden vault content is not sent. Leave blank to use local fallback rules.")
            .addText((text) => {
                text.setPlaceholder(this.plugin.settings.chatModelName || "optional");
                text.setValue(this.plugin.settings.policyModelName);
                text.onChange(async (value: string) => {
                    this.plugin.settings.policyModelName = value.trim();
                    await this.plugin.saveSettings();
                });
            });

        if (this.plugin.settings.aiProvider === 'qwen') {
            const qwenOptionToggles: QwenResponseOptionToggle[] = [];
            containerEl.createEl('h3', { text: 'Qwen response options' });
            const qwenOptionsDescriptionEl = containerEl.createEl("p");
            qwenOptionsDescriptionEl.setAttr("style", "font-size:14px");
            refreshQwenResponseOptionAvailability = () => {
                updateQwenResponseOptionAvailability(
                    this.plugin.settings.baseURL,
                    qwenOptionsDescriptionEl,
                    qwenOptionToggles,
                );
            };

            new Setting(containerEl)
                .setName("Show Qwen model thinking")
                .setDesc("Show the model thinking text returned by DashScope in this chat session. It is not added to the final answer, notes, or Memory.")
                .addToggle((toggle) => {
                    qwenOptionToggles.push(toggle);
                    toggle
                        .setValue(this.plugin.settings.qwenThinkingEnabled)
                        .onChange(async (value) => {
                            this.plugin.settings.qwenThinkingEnabled = value;
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(containerEl)
                .setName("Enable builtin WebSearch tool")
                .setDesc("Allow PA Agent to call the read-only builtin WebSearch tool. Search queries may be sent to DashScope WebSearch MCP and can produce web sources.")
                .addToggle((toggle) => {
                    qwenOptionToggles.push(toggle);
                    toggle
                        .setValue(this.plugin.settings.webSearchEnabled)
                        .onChange(async (value) => {
                            this.plugin.settings.webSearchEnabled = value;
                            await this.plugin.saveSettings();
                        });
                });

            refreshQwenResponseOptionAvailability();
        }

        new Setting(containerEl)
            .setName("Share anonymous capability usage")
            .setDesc("Share local PA Agent usage events for capability invoked, failed, skipped, or unavailable states. Events do not include prompts, note text, observations, or vault paths.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.shareAnonymousCapabilityUsage)
                    .onChange(async (value) => {
                        this.plugin.settings.shareAnonymousCapabilityUsage = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h3', { text: 'Skill guides' });
        containerEl.createEl("p", {
            text: "Let the assistant use bundled read-only skill guides for Obsidian formats and vault review tasks.",
        }).setAttr("style", "font-size:14px");

        new Setting(containerEl)
            .setName("Use skill guides")
            .setDesc("Skill guides add bounded reference context to chat answers. They do not add tools, write notes, run commands, or change Memory.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.skillContextEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.skillContextEnabled = value;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        const enabledSkillIds = new Set(this.plugin.settings.enabledSkillIds);
        for (const skill of BUNDLED_SKILL_CATALOG) {
            new Setting(containerEl)
                .setName(skill.label)
                .setDesc(skill.description)
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.plugin.settings.skillContextEnabled && enabledSkillIds.has(skill.id))
                        .setDisabled(!this.plugin.settings.skillContextEnabled)
                        .onChange(async (value) => {
                            const nextEnabledSkillIds = new Set(this.plugin.settings.enabledSkillIds);
                            if (value) {
                                nextEnabledSkillIds.add(skill.id);
                            } else {
                                nextEnabledSkillIds.delete(skill.id);
                            }
                            this.plugin.settings.enabledSkillIds = normalizeEnabledSkillIds([...nextEnabledSkillIds]);
                            await this.plugin.saveSettings();
                        });
                });
        }

        new Setting(containerEl)
            .setName("API Token")
            .setDesc("Stored securely in your OS keychain (macOS Keychain / iOS Keychain / Windows Credential Manager).")
            .addComponent((el) => {
                const secret = new SecretComponent(this.app, el);
                const existing = this.app.secretStorage.getSecret(KEYCHAIN_API_TOKEN_ID);
                if (existing) {
                    secret.setValue(existing);
                }
                secret.onChange((value: string) => {
                    if (value) {
                        this.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, value);
                        this.plugin.clearTokenCache();
                    }
                });
                return secret;
            });
        containerEl.createEl('h2', { text: 'Memory' });
        containerEl.createEl("p", {
            text: "Let the assistant use memory from your notes when answering.",
        }).setAttr("style", "font-size:15px");

        new Setting(containerEl)
            .setName("Use memory from my notes")
            .setDesc("The assistant asks before preparing Memory. After you approve and Memory is ready, changed notes may update in the background while the app is open.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.memoryEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.memoryEnabled = value;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName("Check memory before chat")
            .setDesc("The assistant will ask before preparing anything that may use AI credits.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.memoryAutoCheckBeforeChat)
                    .onChange(async (value) => {
                        this.plugin.settings.memoryAutoCheckBeforeChat = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Advanced memory controls")
            .setDesc("Show maintenance and diagnostic controls for the local memory copy.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.showAdvancedMemoryControls)
                    .onChange(async (value) => {
                        this.plugin.settings.showAdvancedMemoryControls = value;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        if (this.plugin.settings.showAdvancedMemoryControls) {
            new Setting(containerEl)
                .setName("Keep memory updated in background")
                .setDesc("After memory has been prepared, update changed notes automatically while the app is open. Changed note text may be sent to your configured AI provider.")
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.plugin.settings.memoryApprovalPolicy === "auto-refresh-after-prepare")
                        .onChange(async (value) => {
                            this.plugin.settings.memoryApprovalPolicy = value ? "auto-refresh-after-prepare" : "always";
                            await this.plugin.saveSettings();
                            if (value) {
                                this.plugin.memoryManager.scheduleReconcile("settings");
                                this.plugin.memoryManager.scheduleAutoFlush("settings");
                            }
                        });
                });

            new Setting(containerEl)
                .setName("Memory model")
                .setDesc("Advanced: model used to prepare memory from notes.")
                .addText((text) => {
                    text.setPlaceholder("model name");
                    text.setValue(this.plugin.settings.embeddingModelName);
                    text.onChange(async (value: string) => {
                        this.plugin.settings.embeddingModelName = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(containerEl)
                .setName("Update memory now")
                .setDesc("Update memory for changed notes.")
                .addButton((button) => {
                    button.setButtonText("Update").onClick(async () => {
                        await this.plugin.memoryManager.updateFromCommand();
                        await this.plugin.updateMemoryStatusBar();
                    });
                });

            new Setting(containerEl)
                .setName("Rebuild memory on this device")
                .setDesc("Prepare memory again for this device. Your notes will not be changed or deleted.")
                .addButton((button) => {
                    button.setButtonText("Rebuild").onClick(async () => {
                        await this.plugin.memoryManager.prepareFromCommand();
                    });
                });

            new Setting(containerEl)
                .setName("Reset local memory copy")
                .setDesc("Remove this device's local memory copy. Your notes will not be deleted.")
                .addButton((button) => {
                    button.setButtonText("Reset").onClick(async () => {
                        const confirmed = await confirmUserAction(this.app, {
                            title: "Reset local memory copy?",
                            message: "Your notes will not be changed or deleted. This device may need to prepare Memory again before using it.",
                            confirmText: "Reset",
                        });
                        if (!confirmed) return;
                        await this.plugin.vss.resetLocalIndex();
                        await this.plugin.updateMemoryStatusBar();
                    });
                });

            new Setting(containerEl)
                .setName("Delete old Memory cache files")
                .setDesc("Delete old Memory cache files after Memory is ready. Your notes will not be deleted.")
                .addButton((button) => {
                    button.setButtonText("Delete").onClick(async () => {
                        await this.plugin.vss.cleanLegacyJsonCache();
                        await this.plugin.updateMemoryStatusBar();
                    });
                });

            new Setting(containerEl)
                .setName("Show technical memory status")
                .setDesc("Diagnostic details for troubleshooting.")
                .addButton((button) => {
                    button.setButtonText("Show").onClick(async () => {
                        await this.plugin.showTechnicalMemoryStatus();
                    });
                });

            new Setting(containerEl).setName("Memory Exclude Path")
                .setDesc("Exclude note folders from memory. Separate paths with commas.")
                .addText(text => {
                    text.setPlaceholder('tmp/,notes/templates')
                        .setValue(this.plugin.settings.vssCacheExcludePath.join(','))
                        .onChange(async (value) => {
                            plugin.settings.vssCacheExcludePath = value.split(",").map((path) => path.trim()).filter(Boolean);
                            await this.plugin.saveSettings();
                        })
                });
        }

        // 图片生成设置（仅Qwen支持）
        if (this.plugin.settings.aiProvider === 'qwen') {
            new Setting(containerEl)
                .setName("AI Featured Image Path")
                .setDesc("AI feautured image helper will download the images and save them to this path.")
                .addText((text) => {
                    text.setPlaceholder("9.src");
                    text.setValue(this.plugin.settings.featuredImagePath.toString());
                    text.onChange(async (value: string) => {
                        this.plugin.settings.featuredImagePath = value;
                        await this.plugin.saveSettings();
                    });
                });
            new Setting(containerEl).setName("AI Featured Images Generating Number")
                .setDesc("The number of images to generate when using AI Featured Image Helper.")
                .addText(text => {
                    text.setPlaceholder('2')
                        .setValue(this.plugin.settings.numFeaturedImages.toString())
                        .onChange(async (value) => {
                            plugin.settings.numFeaturedImages = parseInt(value);
                            await this.plugin.saveSettings();
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

    private findMetadata(metaKey: string) {
        return this.plugin.settings.metadatas.findIndex((m) => {
            return m.key === metaKey;
        })
    }
}
