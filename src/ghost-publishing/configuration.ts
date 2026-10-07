import { z } from "zod";
import { stableStringify } from "../ai-services/agent-utils";
import { getPlatformCrypto } from "../platform-dom";
import type { SitePublishingProfile } from "./types";

const librarySchema = z.object({
    compatible: z.boolean(), version: z.string().max(100).optional(),
    evidence: z.enum(["settings-whitelist", "page-check", "unknown"]),
    initialization: z.enum(["auto", "explicit", "unknown"]).optional(),
}).strict();
const settingsSchema = z.object({
    siteUrl: z.string().max(2048), defaultVisibility: z.enum(["public", "members", "paid"]),
    profile: z.object({ prism: librarySchema.optional(), mermaid: librarySchema.optional(), katex: librarySchema.optional() }).strict(),
}).strict();
export type GhostPublishingSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_GHOST_SETTINGS: GhostPublishingSettings = { siteUrl: "", defaultVisibility: "public", profile: {} };

export function canonicalGhostSite(value: string): string {
    try {
        const url = new URL(value.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
            || /%2f|%5c/i.test(url.pathname) || /\/ghost(?:\/|$)/i.test(url.pathname)) throw new Error("Invalid site");
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
        return url.href;
    } catch { throw new GhostConfigurationError("invalid-settings"); }
}

export function normalizeGhostSettings(value: unknown): GhostPublishingSettings {
    const parsed = settingsSchema.safeParse(value);
    if (!parsed.success) return { ...DEFAULT_GHOST_SETTINGS, profile: {} };
    try { return { ...parsed.data, siteUrl: parsed.data.siteUrl ? canonicalGhostSite(parsed.data.siteUrl) : "" }; }
    catch { return { ...DEFAULT_GHOST_SETTINGS, profile: {} }; }
}

async function hash(value: string): Promise<string> {
    const digest = await getPlatformCrypto()!.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const GHOST_SECRET_ID_PREFIX = "pa-ghost-";
const GHOST_SECRET_ID_BODY_LENGTH = 55;
const GHOST_ADMIN_KEY_PATTERN = /^[a-f\d]{24}:[a-f\d]{64}$/i;

export class GhostConfigurationError extends Error {
    constructor(readonly code: "desktop-required" | "invalid-settings" | "invalid-key" | "not-configured" | "changing" | "save-failed") {
        super(`Ghost publishing: ${code}.`);
        this.name = "GhostConfigurationError";
    }
}

export interface GhostConnection {
    siteId: string;
    siteUrl: string;
    defaultVisibility: GhostPublishingSettings["defaultVisibility"];
    profile: SitePublishingProfile;
    identity: string;
}

export type GhostAdminKeyStatus = "configured" | "missing" | "unavailable";

/** Ghost credentials are separate from AI settings and are never persisted into data.json. */
export class GhostPublishingConfiguration {
    private revision = 0;
    private writes: Promise<void> = Promise.resolve();
    private changing = 0;

    constructor(private readonly dependencies: {
        isDesktop(): boolean;
        /** Device/vault local scope; not stored in the synchronized publishing settings. */
        localScope: string;
        getSettings(): GhostPublishingSettings;
        /** Host supplies the existing settings slice/persistence queue. */
        saveSettings(settings: GhostPublishingSettings): Promise<void>;
        secrets: { getSecret(id: string): string | null; setSecret(id: string, value: string): void };
    }) {}

    getIdentity(): string {
        return stableStringify({ settings: normalizeGhostSettings(this.dependencies.getSettings()), revision: this.revision, changing: this.changing > 0 });
    }

    async connection(): Promise<GhostConnection> {
        if (!this.dependencies.isDesktop()) throw new GhostConfigurationError("desktop-required");
        if (this.changing) throw new GhostConfigurationError("changing");
        const settings = normalizeGhostSettings(this.dependencies.getSettings());
        if (!settings.siteUrl) throw new GhostConfigurationError("not-configured");
        const identity = this.getIdentity();
        const siteId = await hash(settings.siteUrl);
        if (identity !== this.getIdentity() || !this.dependencies.isDesktop()) throw new GhostConfigurationError("changing");
        return { siteId, siteUrl: settings.siteUrl, defaultVisibility: settings.defaultVisibility,
            profile: { ...settings.profile, siteId }, identity };
    }

    private async secretId(siteUrl: string): Promise<string> {
        if (!this.dependencies.localScope) throw new GhostConfigurationError("not-configured");
        // Obsidian desktop SecretStorage IDs are limited to 64 lowercase URL-path-safe
        // characters. A single digest over both identity dimensions keeps IDs stable while
        // retaining 220 bits of scope/site separation.
        const digest = await hash(stableStringify({
            scope: this.dependencies.localScope,
            site: siteUrl,
        }));
        const id = `${GHOST_SECRET_ID_PREFIX}${digest.slice(0, GHOST_SECRET_ID_BODY_LENGTH)}`;
        if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new GhostConfigurationError("not-configured");
        return id;
    }

    async getAdminKey(connection: GhostConnection): Promise<string> {
        if (!this.dependencies.isDesktop()) throw new GhostConfigurationError("desktop-required");
        if (connection.identity !== this.getIdentity() || this.changing) throw new GhostConfigurationError("changing");
        const id = await this.secretId(connection.siteUrl);
        if (!this.dependencies.isDesktop()) throw new GhostConfigurationError("desktop-required");
        if (connection.identity !== this.getIdentity()) throw new GhostConfigurationError("changing");
        let key: string | null;
        try { key = this.dependencies.secrets.getSecret(id); }
        catch { throw new GhostConfigurationError("not-configured"); }
        if (!key || !GHOST_ADMIN_KEY_PATTERN.test(key)) throw new GhostConfigurationError("not-configured");
        return key;
    }

    /** Returns only whether this desktop has a readable valid key; the value never leaves configuration. */
    async getAdminKeyStatus(): Promise<GhostAdminKeyStatus> {
        if (!this.dependencies.isDesktop() || this.changing) return "unavailable";
        const settings = normalizeGhostSettings(this.dependencies.getSettings());
        if (!settings.siteUrl) return "missing";
        try {
            const identity = this.getIdentity();
            const id = await this.secretId(settings.siteUrl);
            if (!this.dependencies.isDesktop() || this.changing || this.getIdentity() !== identity) return "unavailable";
            let key: string | null;
            try { key = this.dependencies.secrets.getSecret(id); }
            catch { return "unavailable"; }
            return key && GHOST_ADMIN_KEY_PATTERN.test(key) ? "configured" : "missing";
        } catch {
            return "unavailable";
        }
    }

    /** Called only by manual Settings UI. Omitted key preserves this desktop's secret. */
    save(input: GhostPublishingSettings, adminKey?: string): Promise<void> {
        if (!this.dependencies.isDesktop()) return Promise.reject(new GhostConfigurationError("desktop-required"));
        const parsed = settingsSchema.safeParse(input);
        if (!parsed.success) return Promise.reject(new GhostConfigurationError("invalid-settings"));
        let settings: GhostPublishingSettings;
        try { settings = { ...parsed.data, siteUrl: canonicalGhostSite(parsed.data.siteUrl) }; }
        catch (error) { return Promise.reject(error); }
        if (adminKey !== undefined && adminKey !== "" && !GHOST_ADMIN_KEY_PATTERN.test(adminKey)) {
            return Promise.reject(new GhostConfigurationError("invalid-key"));
        }
        this.revision++;
        this.changing++;
        const operation = this.writes.then(async () => {
            if (!this.dependencies.isDesktop()) throw new GhostConfigurationError("desktop-required");
            const secretId = await this.secretId(settings.siteUrl);
            if (!this.dependencies.isDesktop()) throw new GhostConfigurationError("desktop-required");
            let previousKey: string | null = null;
            let changedKey = false;
            try {
                if (adminKey !== undefined) {
                    previousKey = this.dependencies.secrets.getSecret(secretId);
                    this.dependencies.secrets.setSecret(secretId, adminKey);
                    changedKey = true;
                }
                await this.dependencies.saveSettings(settings);
            } catch {
                if (changedKey) {
                    try { this.dependencies.secrets.setSecret(secretId, previousKey ?? ""); }
                    catch { /* Keep all old action contexts invalid; Settings reports failure. */ }
                }
                throw new GhostConfigurationError("save-failed");
            }
        }).finally(() => { this.changing--; });
        this.writes = operation.then(() => {}, () => {});
        return operation;
    }
}
