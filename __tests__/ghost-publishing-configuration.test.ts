import { describe, expect, it } from "@jest/globals";
import {
    canonicalGhostSite, DEFAULT_GHOST_SETTINGS, GhostPublishingConfiguration,
    normalizeGhostSettings, type GhostPublishingSettings,
} from "../src/ghost-publishing/configuration";

const key = `${"a".repeat(24)}:${"b".repeat(64)}`;
const nextKey = `${"a".repeat(24)}:${"c".repeat(64)}`;
const settings: GhostPublishingSettings = { siteUrl: "https://example.test/blog", defaultVisibility: "members", profile: {} };

function assertHostSecretId(id: string): void {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) {
        throw new Error("Secret ID is invalid. Use only lowercase letters, numbers and dashes. 64 characters max.");
    }
}

function setup(options: { localScope?: string } = {}) {
    let current = { ...DEFAULT_GHOST_SETTINGS, profile: {} };
    let desktop = true;
    let fail = false;
    let accesses = 0;
    const secretValues = new Map<string, string>();
    const persisted: GhostPublishingSettings[] = [];
    const secretIds: string[] = [];
    const configuration = new GhostPublishingConfiguration({
        isDesktop: () => desktop,
        localScope: options.localScope ?? "synthetic-vault-on-desktop-A",
        getSettings: () => current,
        saveSettings: async (value) => {
            if (fail) { fail = false; throw new Error("Synthetic storage failure"); }
            current = value; persisted.push(value);
        },
        secrets: {
            getSecret: (id) => {
                assertHostSecretId(id);
                accesses++;
                return secretValues.get(id) ?? null;
            },
            setSecret: (id, value) => {
                assertHostSecretId(id);
                accesses++;
                if (!secretIds.includes(id)) secretIds.push(id);
                secretValues.set(id, value);
            },
        },
    });
    return { configuration, persisted, secretValues, secretIds, get accesses() { return accesses; },
        mobile: () => { desktop = false; }, failSave: () => { fail = true; } };
}

describe("Ghost publishing configuration", () => {
    it("stores only non-secret preferences and invalidates old connection identities on a key change", async () => {
        const app = setup();
        await app.configuration.save(settings, key);
        const first = await app.configuration.connection();
        expect(first.siteUrl).toBe("https://example.test/blog/");
        expect(first.siteId).toMatch(/^[a-f0-9]{64}$/);
        expect(await app.configuration.getAdminKey(first)).toBe(key);
        expect(JSON.stringify(app.persisted)).not.toContain(key);
        await app.configuration.save(settings, nextKey);
        await expect(app.configuration.getAdminKey(first)).rejects.toThrow("changing");
        const next = await app.configuration.connection();
        expect(next.siteId).toBe(first.siteId);
        expect(await app.configuration.getAdminKey(next)).toBe(nextKey);
        await app.configuration.save({ ...settings, defaultVisibility: "public" });
        expect(await app.configuration.getAdminKey(await app.configuration.connection())).toBe(nextKey);
    });

    it("uses a host-valid secret ID that is stable per local scope and site", async () => {
        const app = setup();
        await app.configuration.save(settings, key);
        const firstConnection = await app.configuration.connection();
        expect(await app.configuration.getAdminKey(firstConnection)).toBe(key);

        await app.configuration.save({ ...settings, siteUrl: "https://example.test/blog/" }, nextKey);
        const changedConnection = await app.configuration.connection();
        expect(await app.configuration.getAdminKey(changedConnection)).toBe(nextKey);
        expect(app.secretIds).toHaveLength(1);
        expect(app.secretIds[0]).toMatch(/^[a-z0-9-]{1,64}$/);

        const otherScope = setup({ localScope: "synthetic-vault-on-desktop-B" });
        await otherScope.configuration.save(settings, key);
        expect(otherScope.secretIds[0]).toMatch(/^[a-z0-9-]{1,64}$/);
        expect(otherScope.secretIds[0]).not.toBe(app.secretIds[0]);
        expect(await otherScope.configuration.getAdminKey(await otherScope.configuration.connection())).toBe(key);

        const otherSite = setup();
        const otherSiteSettings: GhostPublishingSettings = { ...settings, siteUrl: "https://other.test/" };
        await otherSite.configuration.save(otherSiteSettings, key);
        expect(otherSite.secretIds[0]).toMatch(/^[a-z0-9-]{1,64}$/);
        expect(otherSite.secretIds[0]).not.toBe(app.secretIds[0]);
        expect(await otherSite.configuration.getAdminKey(await otherSite.configuration.connection())).toBe(key);
    });

    it("retains old settings and restores the previous secret when persistence fails", async () => {
        const app = setup();
        await app.configuration.save(settings, key);
        const old = await app.configuration.connection();
        app.failSave();
        await expect(app.configuration.save({ ...settings, defaultVisibility: "paid" }, nextKey)).rejects.toThrow("save-failed");
        expect(app.persisted).toHaveLength(1);
        const current = await app.configuration.connection();
        expect(current.defaultVisibility).toBe("members");
        expect(await app.configuration.getAdminKey(current)).toBe(key);
        await expect(app.configuration.getAdminKey(old)).rejects.toThrow("changing");
    });

    it("requires manual valid site/key input and never accesses desktop secrets on mobile", async () => {
        const app = setup();
        expect(normalizeGhostSettings(undefined)).toEqual(DEFAULT_GHOST_SETTINGS);
        expect(normalizeGhostSettings({ ...settings, adminKey: key })).toEqual(DEFAULT_GHOST_SETTINGS);
        expect(() => canonicalGhostSite("https://user:password@example.test/")).toThrow("invalid-settings");
        expect(() => canonicalGhostSite("https://example.test/ghost/")).toThrow("invalid-settings");
        await expect(app.configuration.save(settings, "invalid")).rejects.toThrow("invalid-key");
        expect(app.accesses).toBe(0);
        app.mobile();
        await expect(app.configuration.save(settings, key)).rejects.toThrow("desktop-required");
        await expect(app.configuration.connection()).rejects.toThrow("desktop-required");
        expect(app.accesses).toBe(0);
    });
});
