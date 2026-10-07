import { describe, expect, it, jest } from "@jest/globals";
import { GhostTabPreview, type GhostNativeLeaf, type GhostPreviewHost } from "../src/ghost-publishing/preview";

const UUID = "f36fb365-bd7c-40b5-a77a-de5cd5cebb95";
const PREVIEW_URL = `https://public.example/blog/p/${UUID}/`;

function fixture() {
    const leaves: GhostNativeLeaf[] = [];
    const created: Array<{ leaf: GhostNativeLeaf; setViewState: ReturnType<typeof jest.fn> }> = [];
    const state = { desktop: true, enabled: true, failOpen: false };
    const getLeaf = jest.fn((_mode: "tab") => {
        const setViewState = jest.fn(async () => {
            if (state.failOpen) throw new Error("navigation failed");
        });
        const leaf = { setViewState } as GhostNativeLeaf;
        leaves.push(leaf);
        created.push({ leaf, setViewState });
        return leaf;
    });
    const revealLeaf = jest.fn(async (_leaf: GhostNativeLeaf) => {});
    const host: GhostPreviewHost = { workspace: { getLeaf, getLeavesOfType: () => leaves, revealLeaf } };
    const preview = new GhostTabPreview(host, { isDesktop: () => state.desktop, isWebViewerEnabled: () => state.enabled });
    return { state, leaves, created, preview, getLeaf, revealLeaf };
}

describe("Ghost URL tab navigation", () => {
    it("opens preview and editor URLs directly and reveals a reused tab every time", async () => {
        const f = fixture();
        const url = PREVIEW_URL;
        await f.preview.open(url);
        await f.preview.open("https://ghost.example/blog/ghost/#/editor/post/6ac4f4e0910d6f00010bb89b");
        expect(f.getLeaf).toHaveBeenCalledTimes(1);
        expect(f.getLeaf).toHaveBeenCalledWith("tab");
        expect(f.created[0].setViewState.mock.calls).toEqual([
            [{ type: "webviewer", state: { url }, active: true }],
            [{ type: "webviewer", state: { url: "https://ghost.example/blog/ghost/#/editor/post/6ac4f4e0910d6f00010bb89b" }, active: true }],
        ]);
        expect(f.revealLeaf).toHaveBeenCalledTimes(2);
        expect(f.revealLeaf).toHaveBeenLastCalledWith(f.created[0].leaf);
    });

    it("creates a new tab when the user's previous tab was closed and leaves tabs alone on dispose", async () => {
        const f = fixture();
        await f.preview.open(PREVIEW_URL);
        f.leaves.splice(0);
        await f.preview.open(PREVIEW_URL);
        expect(f.getLeaf).toHaveBeenCalledTimes(2);
        f.preview.dispose();
        expect(f.leaves).toHaveLength(1);
        await expect(f.preview.open(PREVIEW_URL)).rejects.toMatchObject({ code: "cancelled" });
    });

    it("reports unavailable navigation without executing page code or requiring a rendering result", async () => {
        const f = fixture();
        f.state.enabled = false;
        await expect(f.preview.open(PREVIEW_URL)).rejects.toMatchObject({ code: "enable-web-viewer" });
        expect(f.getLeaf).not.toHaveBeenCalled();
        f.state.enabled = true;
        f.state.desktop = false;
        await expect(f.preview.open(PREVIEW_URL)).rejects.toMatchObject({ code: "desktop-required" });
        f.state.desktop = true;
        f.state.failOpen = true;
        await expect(f.preview.open(PREVIEW_URL)).rejects.toThrow("navigation failed");
        expect(f.revealLeaf).not.toHaveBeenCalled();
    });

    it("rejects credential-bearing and non-web URLs before opening a tab", async () => {
        const f = fixture();
        for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://secret:key@ghost.example/"]) {
            await expect(f.preview.open(url)).rejects.toThrow("Invalid Ghost URL");
        }
        expect(f.getLeaf).not.toHaveBeenCalled();
    });
});
