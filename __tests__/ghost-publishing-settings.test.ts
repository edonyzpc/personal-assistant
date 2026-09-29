import { webcrypto } from "node:crypto";
import { GhostPublishingConfiguration, type GhostPublishingSettings } from "../src/ghost-publishing/configuration";
import { renderGhostPublishingSettings } from "../src/ghost-publishing/settings-ui";
import { pluginT } from "../src/locales/plugin";

class MockNode {
    children: MockNode[] = [];
    textContent = "";
    open = false;
    attr: Record<string, string> = {};
    constructor(readonly tag = "div") {}
    createEl(tag: string, options?: { text?: string; attr?: Record<string, string> }): MockNode {
        const child = new MockNode(tag);
        child.textContent = options?.text ?? "";
        child.attr = options?.attr ?? {};
        this.children.push(child);
        return child;
    }
    createDiv(): MockNode { return this.createEl("div"); }
    text(): string { return [this.textContent, ...this.children.map((child) => child.text())].join(" "); }
}

class MockControl {
    value: string | boolean = "";
    disabled = false;
    label = "";
    options: Record<string, string> = {};
    inputEl = { value: "", type: "text", autocomplete: "", autocapitalize: "", spellcheck: true,
        disabled: false, setAttribute: jest.fn() };
    change: (value: string | boolean) => unknown = () => {};
    click: () => unknown = () => {};
    setValue(value: string | boolean): this { this.value = value; this.inputEl.value = String(value); return this; }
    setDisabled(value: boolean): this { this.disabled = value; return this; }
    setPlaceholder(): this { return this; }
    setCta(): this { return this; }
    setWarning(): this { return this; }
    setButtonText(label: string): this { this.label = label; return this; }
    addOption(value: string, label: string): this { this.options[value] = label; return this; }
    onChange(callback: (value: string | boolean) => unknown): this { this.change = callback; return this; }
    onClick(callback: () => unknown): this { this.click = callback; return this; }
    edit(value: string | boolean): unknown { this.setValue(value); return this.change(value); }
}

const mockSettings: Array<{ name: string; desc: string; text?: MockControl; dropdown?: MockControl;
    toggle?: MockControl; button?: MockControl }> = [];
jest.mock("obsidian", () => ({
    Setting: class {
        record: typeof mockSettings[number] = { name: "", desc: "" };
        constructor() { mockSettings.push(this.record); }
        setName(name: string): this { this.record.name = name; return this; }
        setDesc(desc: string): this { this.record.desc = desc; return this; }
        addText(callback: (control: MockControl) => void): this {
            this.record.text = new MockControl(); callback(this.record.text); return this;
        }
        addDropdown(callback: (control: MockControl) => void): this {
            this.record.dropdown = new MockControl(); callback(this.record.dropdown); return this;
        }
        addToggle(callback: (control: MockControl) => void): this {
            this.record.toggle = new MockControl(); callback(this.record.toggle); return this;
        }
        addButton(callback: (control: MockControl) => void): this {
            this.record.button = new MockControl(); callback(this.record.button); return this;
        }
    },
}), { virtual: true });

const key = `${"1".repeat(24)}:${"2".repeat(64)}`;
const nextKey = `${"3".repeat(24)}:${"4".repeat(64)}`;
const prefs: GhostPublishingSettings = { siteUrl: "https://example.test/blog/", defaultVisibility: "public", profile: {} };
const t = (id: Parameters<typeof pluginT>[0], params?: Readonly<Record<string, string | number>>) => pluginT(id, "en", params);
const row = (name: string) => mockSettings.find((setting) => setting.name === name)!;
const button = (name: string) => mockSettings.find((setting) => setting.button?.label === name)!.button!;
const save = () => button(t("plugin.ghost.settings.save")).click();

async function setup() {
    const otherSettings = { aiProvider: "unchanged", marker: 7 };
    let current = structuredClone(prefs);
    let failure = false;
    const persisted: GhostPublishingSettings[] = [];
    const secrets = new Map<string, string>();
    const getSecret = jest.fn((id: string) => secrets.get(id) ?? null);
    const configuration = new GhostPublishingConfiguration({
        isDesktop: () => true, localScope: "synthetic-settings-desktop", getSettings: () => current,
        saveSettings: async (settings) => {
            if (failure) throw new Error(`Raw storage detail ${nextKey}`);
            current = settings; persisted.push(settings);
        },
        secrets: { getSecret, setSecret: (id, value) => { secrets.set(id, value); } },
    });
    await configuration.save(prefs, key);
    getSecret.mockClear(); persisted.length = 0;
    const saveConfiguration = jest.spyOn(configuration, "save");
    const node = new MockNode();
    const dispose = renderGhostPublishingSettings(node as unknown as HTMLElement,
        { isDesktop: () => true, getSettings: () => current, configuration, t });
    return { node, dispose, configuration, saveConfiguration, getSecret, secrets, persisted, otherSettings,
        current: () => current, fail: () => { failure = true; } };
}

beforeAll(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });
beforeEach(() => { mockSettings.length = 0; });

describe("Ghost Settings UI", () => {
    it("leaves the password empty without reading secrets and preserves a saved key on blank input", async () => {
        const app = await setup();
        const input = row(t("plugin.ghost.settings.key")).text!;
        expect(input.value).toBe("");
        expect(input.inputEl.type).toBe("password");
        expect(app.getSecret).not.toHaveBeenCalled();
        row(t("plugin.ghost.settings.visibility")).dropdown!.edit("members");
        expect(app.current().defaultVisibility).toBe("public");
        await save();
        expect(app.saveConfiguration).toHaveBeenCalledWith({ ...prefs, defaultVisibility: "members" }, undefined);
        expect([...app.secrets.values()]).toEqual([key]);
        expect(app.getSecret).not.toHaveBeenCalled();
        expect(JSON.stringify(app.persisted)).not.toContain(key);
        expect(app.otherSettings).toEqual({ aiProvider: "unchanged", marker: 7 });
        app.dispose();
    });

    it("saves a replacement key only through configuration and clears the input afterward", async () => {
        const app = await setup();
        const input = row(t("plugin.ghost.settings.key")).text!;
        input.edit(nextKey);
        await save();
        expect([...app.secrets.values()]).toEqual([nextKey]);
        expect(app.saveConfiguration).toHaveBeenCalledWith(prefs, nextKey);
        expect(input.value).toBe("");
        expect(JSON.stringify(app.persisted)).not.toContain(nextKey);
        app.dispose();
    });

    it("deletes the saved site's key without committing unsaved site or audience changes", async () => {
        const app = await setup();
        row(t("plugin.ghost.settings.site")).text!.edit("https://different.test/");
        row(t("plugin.ghost.settings.visibility")).dropdown!.edit("paid");
        await button(t("plugin.ghost.settings.deleteKeyAction")).click();
        expect(app.saveConfiguration).toHaveBeenCalledWith(prefs, "");
        expect(app.current()).toEqual(prefs);
        expect([...app.secrets.values()]).toEqual([""]);
        expect(row(t("plugin.ghost.settings.site")).text!.value).toBe("https://different.test/");
        app.dispose();
    });

    it("keeps persisted preferences and the old key when save fails, without exposing the raw error", async () => {
        const app = await setup();
        app.fail();
        row(t("plugin.ghost.settings.key")).text!.edit(nextKey);
        row(t("plugin.ghost.settings.visibility")).dropdown!.edit("paid");
        await save();
        expect(app.current()).toEqual(prefs);
        expect([...app.secrets.values()]).toEqual([key]);
        expect(app.otherSettings).toEqual({ aiProvider: "unchanged", marker: 7 });
        expect(app.node.text()).toContain(t("plugin.ghost.settings.saveFailed"));
        expect(app.node.text()).not.toContain(nextKey);
        app.dispose();
    });

    it("requires each site-library confirmation and invalidates confirmations after a site edit", async () => {
        const app = await setup();
        expect(app.node.children.find((node) => node.tag === "details")?.open).toBe(false);
        expect(["Prism", "Mermaid", "KaTeX"].map((label) => row(label).dropdown!.value)).toEqual(["pa", "pa", "pa"]);
        row("Prism").dropdown!.edit("auto");
        row("Mermaid").dropdown!.edit("explicit");
        row("KaTeX").dropdown!.edit("auto");
        await save();
        expect(app.saveConfiguration).not.toHaveBeenCalled();
        for (const library of ["Prism", "Mermaid", "KaTeX"]) row(t("plugin.ghost.settings.confirmCompatible", { library })).toggle!.edit(true);
        expect(button(t("plugin.ghost.settings.save")).disabled).toBe(false);
        row(t("plugin.ghost.settings.site")).text!.edit("https://second.test/subsite/");
        expect(button(t("plugin.ghost.settings.save")).disabled).toBe(true);
        await save();
        expect(app.saveConfiguration).not.toHaveBeenCalled();
        for (const library of ["Prism", "Mermaid", "KaTeX"]) row(t("plugin.ghost.settings.confirmCompatible", { library })).toggle!.edit(true);
        await save();
        expect(app.current()).toEqual({ siteUrl: "https://second.test/subsite/", defaultVisibility: "public", profile: {
            prism: { compatible: true, evidence: "settings-whitelist", initialization: "auto" },
            mermaid: { compatible: true, evidence: "settings-whitelist", initialization: "explicit" },
            katex: { compatible: true, evidence: "settings-whitelist", initialization: "auto" },
        } });
        app.dispose();
    });

    it("does not access settings or configuration on mobile", () => {
        const node = new MockNode();
        const getSettings = jest.fn(() => { throw new Error("Must not read"); });
        renderGhostPublishingSettings(node as unknown as HTMLElement, { isDesktop: () => false, getSettings,
            get configuration(): GhostPublishingConfiguration { throw new Error("Must not access"); }, t })();
        expect(getSettings).not.toHaveBeenCalled();
        expect(mockSettings).toHaveLength(0);
        expect(node.text()).toContain(t("plugin.ghost.settings.desktopRequired"));
    });

    it("clears the password on disposal and prevents detached controls from submitting", async () => {
        const app = await setup();
        const input = row(t("plugin.ghost.settings.key")).text!;
        input.edit(nextKey);
        app.dispose();
        expect(input.value).toBe("");
        expect(input.inputEl.disabled).toBe(true);
        await save();
        await button(t("plugin.ghost.settings.deleteKeyAction")).click();
        expect(app.saveConfiguration).not.toHaveBeenCalled();
    });
});
