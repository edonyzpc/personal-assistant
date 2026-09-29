import { Setting } from "obsidian";
import type { ButtonComponent, DropdownComponent, TextComponent, ToggleComponent } from "obsidian";
import type { PluginMessageKey } from "../locales/plugin";
import { GhostConfigurationError, normalizeGhostSettings } from "./configuration";
import type { GhostPublishingConfiguration, GhostPublishingSettings } from "./configuration";

export interface GhostPublishingSettingsHost {
    isDesktop(): boolean;
    getSettings(): GhostPublishingSettings;
    readonly configuration?: Pick<GhostPublishingConfiguration, "save">;
    t(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>): string;
}

type Library = "prism" | "mermaid" | "katex";
type LibraryMode = "pa" | "auto" | "explicit";
const LIBRARIES: ReadonlyArray<{ key: Library; label: string }> = [
    { key: "prism", label: "Prism" }, { key: "mermaid", label: "Mermaid" }, { key: "katex", label: "KaTeX" },
];

/** Manual settings only. The UI never reads an existing secret or includes one in preferences. */
export function renderGhostPublishingSettings(container: HTMLElement, host: GhostPublishingSettingsHost): () => void {
    const t = host.t.bind(host);
    if (!host.isDesktop()) {
        container.createEl("p", { text: t("plugin.ghost.settings.desktopRequired") });
        return () => {};
    }
    const configuration = host.configuration;
    if (!configuration) {
        container.createEl("p", { text: t("plugin.ghost.settings.unavailable") });
        return () => {};
    }
    const saveConfiguration = configuration.save.bind(configuration);
    const initial = normalizeGhostSettings(host.getSettings());
    let siteUrl = initial.siteUrl;
    let visibility = initial.defaultVisibility;
    let adminKey = "";
    let alive = true;
    let busy = false;
    const modes: Record<Library, LibraryMode> = { prism: "pa", mermaid: "pa", katex: "pa" };
    const confirmed: Record<Library, boolean> = { prism: false, mermaid: false, katex: false };
    const toggles = new Map<Library, ToggleComponent>();
    const dropdowns: DropdownComponent[] = [];
    let siteInput: TextComponent;
    let keyInput: TextComponent;
    let saveButton: ButtonComponent;
    let deleteButton: ButtonComponent;

    container.createEl("p", { text: t("plugin.ghost.settings.description") });
    new Setting(container).setName(t("plugin.ghost.settings.site"))
        .setDesc(t("plugin.ghost.settings.siteDescription"))
        .addText((text) => {
            siteInput = text;
            text.inputEl.type = "url";
            text.setPlaceholder("https://example.com/").setValue(siteUrl).onChange((value) => {
                if (!alive || busy) return;
                siteUrl = value;
                // A previous site's library confirmation cannot authorize a new site's configuration.
                for (const { key } of LIBRARIES) {
                    confirmed[key] = false;
                    toggles.get(key)?.setValue(false);
                }
                updateControls();
            });
        });
    new Setting(container).setName(t("plugin.ghost.settings.key"))
        .setDesc(t("plugin.ghost.settings.keyDescription"))
        .addText((text) => {
            keyInput = text;
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "new-password";
            text.inputEl.autocapitalize = "none";
            text.inputEl.spellcheck = false;
            text.inputEl.setAttribute("autocorrect", "off");
            text.setValue("").setPlaceholder(t("plugin.ghost.settings.keyPlaceholder")).onChange((value) => {
                if (alive && !busy) adminKey = value;
            });
        });
    new Setting(container).setName(t("plugin.ghost.settings.visibility"))
        .setDesc(t("plugin.ghost.settings.visibilityDescription"))
        .addDropdown((dropdown) => {
            dropdowns.push(dropdown);
            dropdown.addOption("public", t("plugin.ghost.settings.public"))
                .addOption("members", t("plugin.ghost.settings.members"))
                .addOption("paid", t("plugin.ghost.settings.paid"))
                .setValue(visibility).onChange((value) => {
                    if (alive && !busy && (value === "public" || value === "members" || value === "paid")) visibility = value;
                });
        });

    const advanced = container.createEl("details", { cls: "pa-settings-detail" });
    advanced.open = false;
    advanced.createEl("summary", { text: t("plugin.ghost.settings.advanced") });
    const body = advanced.createDiv({ cls: "pa-settings-detail__body" });
    body.createEl("p", { text: t("plugin.ghost.settings.librariesDescription") });
    for (const { key, label } of LIBRARIES) {
        const existing = initial.profile[key];
        if (existing?.compatible && existing.evidence !== "unknown"
            && (existing.initialization === "auto" || existing.initialization === "explicit")) {
            modes[key] = existing.initialization;
            confirmed[key] = true;
        }
        new Setting(body).setName(label).addDropdown((dropdown) => {
            dropdowns.push(dropdown);
            dropdown.addOption("pa", t("plugin.ghost.settings.libraryPa"))
                .addOption("auto", t("plugin.ghost.settings.libraryAuto"))
                .addOption("explicit", t("plugin.ghost.settings.libraryExplicit"))
                .setValue(modes[key]).onChange((value) => {
                    if (!alive || busy || (value !== "pa" && value !== "auto" && value !== "explicit")) return;
                    modes[key] = value;
                    confirmed[key] = false;
                    toggles.get(key)?.setValue(false);
                    updateControls();
                });
        });
        new Setting(body).setName(t("plugin.ghost.settings.confirmCompatible", { library: label }))
            .addToggle((toggle) => {
                toggles.set(key, toggle);
                toggle.setValue(confirmed[key]).onChange((value) => {
                    if (!alive || busy || modes[key] === "pa") return;
                    confirmed[key] = value;
                    updateControls();
                });
            });
    }

    const feedback = container.createEl("p", { attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    new Setting(container).addButton((button) => {
        saveButton = button;
        button.setButtonText(t("plugin.ghost.settings.save")).setCta().onClick(() => save(false));
    });
    new Setting(container).setName(t("plugin.ghost.settings.deleteKey"))
        .setDesc(t("plugin.ghost.settings.deleteKeyDescription"))
        .addButton((button) => {
            deleteButton = button;
            button.setButtonText(t("plugin.ghost.settings.deleteKeyAction")).setWarning().onClick(() => save(true));
        });

    function needsConfirmation(): boolean {
        return LIBRARIES.some(({ key }) => modes[key] !== "pa" && !confirmed[key]);
    }

    function updateControls(): void {
        const disabled = busy || !alive || !host.isDesktop();
        siteInput.inputEl.disabled = disabled;
        keyInput.inputEl.disabled = disabled;
        for (const dropdown of dropdowns) dropdown.setDisabled(disabled);
        for (const [key, toggle] of toggles) toggle.setDisabled(disabled || modes[key] === "pa");
        saveButton.setDisabled(disabled || needsConfirmation());
        deleteButton.setDisabled(disabled || !normalizeGhostSettings(host.getSettings()).siteUrl);
        if (!disabled) feedback.textContent = needsConfirmation() ? t("plugin.ghost.settings.compatibilityRequired") : "";
    }

    async function save(removeKey: boolean): Promise<void> {
        if (!alive || busy || !host.isDesktop() || (!removeKey && needsConfirmation())) return;
        const profile: GhostPublishingSettings["profile"] = {};
        for (const { key } of LIBRARIES) {
            const mode = modes[key];
            if (mode !== "pa") profile[key] = { compatible: true, evidence: "settings-whitelist", initialization: mode };
        }
        // Deletion acts on the saved site's key only, leaving this form's unsaved preferences alone.
        const settings = removeKey ? normalizeGhostSettings(host.getSettings()) : { siteUrl, defaultVisibility: visibility, profile };
        const key = removeKey ? "" : adminKey.trim() || undefined;
        busy = true;
        updateControls();
        feedback.textContent = t("plugin.ghost.settings.saving");
        let message: PluginMessageKey;
        try {
            await saveConfiguration(settings, key);
            adminKey = "";
            keyInput.setValue("");
            message = removeKey ? "plugin.ghost.settings.keyDeleted" : "plugin.ghost.settings.saved";
        } catch (error) {
            message = error instanceof GhostConfigurationError && error.code === "invalid-key"
                ? "plugin.ghost.settings.invalidKey"
                : error instanceof GhostConfigurationError && error.code === "invalid-settings"
                    ? "plugin.ghost.settings.invalidSite" : "plugin.ghost.settings.saveFailed";
        } finally {
            busy = false;
        }
        if (alive) {
            updateControls();
            feedback.textContent = t(message);
        }
    }

    updateControls();
    return () => {
        alive = false;
        adminKey = "";
        keyInput.setValue("");
        updateControls();
    };
}
