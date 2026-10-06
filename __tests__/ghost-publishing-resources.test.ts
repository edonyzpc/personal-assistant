import { createHash } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import { GHOST_MAX_RESOURCE_BYTES, GhostResourceError, prepareGhostResource } from "../src/ghost-publishing/resources";
import type { GhostResourceOptions } from "../src/ghost-publishing/resources";
import type { GhostDownloadedImage, GhostRequestGate } from "../src/ghost-publishing/client";
import type { ExportResourcePlan, GhostPublishingSourceFile } from "../src/ghost-publishing/types";

const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const local = (path = "assets/picture.png"): ExportResourcePlan => ({
    id: "resource-1", source: path, resolvedPath: path, kind: "local", alt: "",
    occurrences: [{ path: "Article.md", line: 2 }, { path: "Embedded.md", line: 4 }],
});
const remote = (url: string): ExportResourcePlan => ({ ...local(), source: url, kind: "remote", resolvedPath: undefined });

function fixture() {
    const state = { desktop: true, current: true, receipt: true, context: true, web: true, denied: "" };
    const controller = new AbortController();
    const readBinary = jest.fn<(file: GhostPublishingSourceFile) => Promise<ArrayBuffer>>()
        .mockImplementation(async () => image.slice().buffer);
    const getFile = jest.fn((path: string): GhostPublishingSourceFile | null => ({
        path, extension: path.split(".").pop() ?? "", stat: { mtime: 5, size: image.byteLength },
    }));
    const downloadImage = jest.fn<(url: string, gate: GhostRequestGate) => Promise<GhostDownloadedImage>>()
        .mockImplementation(async (_url, gate) => {
            await gate.beforeSend();
            gate.assertCurrent();
            return { bytes: image, mimeType: "image/png" };
        });
    const options: GhostResourceOptions = {
        host: { vault: { getAbstractFileByPath: getFile, readBinary } },
        client: { downloadImage },
        isDesktop: () => state.desktop,
        guard: {
            isCurrent: () => state.current,
            isPathAllowed: (path) => path !== state.denied,
            isNoteDomainAllowed: () => true,
            isWebAllowed: () => state.web,
        },
        sourceValidity: () => state.receipt,
        gate: {
            signal: controller.signal,
            beforeSend: async () => undefined,
            assertCurrent: () => { if (!state.context) throw new Error("private context"); },
        },
        siteId: "site-a",
        siteUrl: "https://blog.example/blog/",
    };
    return { options, state, controller, readBinary, getFile, downloadImage };
}

describe("Ghost resource preparation", () => {
    it("hashes the actual bytes on every preparation without reading a historical baseline", async () => {
        const f = fixture();
        const first = await prepareGhostResource(local(), f.options);
        expect(first.metadata).toMatchObject({ byteHash: digest(image), byteLength: image.byteLength, mimeType: "image/png" });
        expect(first.filename).toBe(`${digest(image)}.png`);
        expect(first.metadata.url).toBeUndefined();
        const moved = await prepareGhostResource(local("elsewhere/copy.png"), f.options);
        expect(moved.metadata).toMatchObject({ resolvedPath: "elsewhere/copy.png", byteHash: digest(image) });
        expect(moved.metadata.url).toBeUndefined();
        const changed = image.slice();
        changed[changed.length - 1] = 9;
        f.readBinary.mockResolvedValue(changed.buffer);
        const replacement = await prepareGhostResource(local(), f.options);
        expect(replacement.metadata.byteHash).toBe(digest(changed));
        expect(replacement.metadata.url).toBeUndefined();
        expect(f.readBinary).toHaveBeenCalledTimes(3);
        expect(f.downloadImage).not.toHaveBeenCalled();
    });

    it("rejects local revocation after read awaits and makes zero reads on mobile or missing authority", async () => {
        const mutations: Array<(f: ReturnType<typeof fixture>, file: GhostPublishingSourceFile) => void> = [
            (f) => { f.state.receipt = false; },
            (f) => { f.state.denied = "Embedded.md"; },
            (f) => { f.state.denied = "assets/picture.png"; },
            (f) => { f.state.current = false; },
            (f) => { f.state.context = false; },
            (f) => { f.controller.abort(); },
            (_f, file) => { file.path = "renamed.png"; },
            (_f, file) => { file.stat = { ...file.stat, mtime: 99 }; },
            (f) => { f.getFile.mockReturnValue(null); },
        ];
        for (const mutate of mutations) {
            const f = fixture();
            f.readBinary.mockImplementation(async (file) => {
                await Promise.resolve();
                mutate(f, file);
                return image.slice().buffer;
            });
            await expect(prepareGhostResource(local(), f.options)).rejects.toBeInstanceOf(GhostResourceError);
            expect(f.readBinary).toHaveBeenCalledTimes(1);
        }
        for (const remove of ["desktop", "guard", "receipt", "gate"] as const) {
            const f = fixture();
            if (remove === "desktop") f.state.desktop = false;
            if (remove === "guard") f.options.guard = undefined as unknown as GhostResourceOptions["guard"];
            if (remove === "receipt") f.options.sourceValidity = undefined as unknown as () => boolean;
            if (remove === "gate") f.options.gate = undefined as unknown as GhostRequestGate;
            await expect(prepareGhostResource(local(), f.options)).rejects.toBeInstanceOf(GhostResourceError);
            await expect(prepareGhostResource(remote("https://images.example/exact.png"), f.options)).rejects.toBeInstanceOf(GhostResourceError);
            expect(f.getFile).not.toHaveBeenCalled();
            expect(f.readBinary).not.toHaveBeenCalled();
            expect(f.downloadImage).not.toHaveBeenCalled();
        }
        const hashing = fixture();
        let loadedFile: GhostPublishingSourceFile | undefined;
        hashing.readBinary.mockImplementation(async (file) => {
            loadedFile = file;
            return image.slice().buffer;
        });
        const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
        const delayedDigest = jest.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
            const hash = await realDigest(algorithm, data);
            if (loadedFile) loadedFile.stat = { ...loadedFile.stat, mtime: 100 };
            return hash;
        });
        try {
            await expect(prepareGhostResource(local(), hashing.options)).rejects.toMatchObject({ code: "source-revoked" });
        } finally { delayedDigest.mockRestore(); }
    });

    it("passes only the explicit remote URL and rechecks web permission and every owner at each hop", async () => {
        const url = "https://images.example/exact.png?version=1";
        for (const web of [false, undefined]) {
            const f = fixture();
            f.options.guard.isWebAllowed = web === undefined ? undefined : () => web;
            await expect(prepareGhostResource(remote(url), f.options)).rejects.toMatchObject({ code: "web-denied" });
            expect(f.downloadImage).not.toHaveBeenCalled();
        }
        for (const mutation of ["owner", "web", "receipt", "context", "cancel"] as const) {
            const f = fixture();
            let dispatched = 0;
            f.downloadImage.mockImplementation(async (_url, gate) => {
                await gate.beforeSend();
                gate.assertCurrent();
                dispatched++;
                if (mutation === "owner") f.state.denied = "Embedded.md";
                if (mutation === "web") f.state.web = false;
                if (mutation === "receipt") f.state.receipt = false;
                if (mutation === "context") f.state.context = false;
                if (mutation === "cancel") f.controller.abort();
                await gate.beforeSend();
                gate.assertCurrent();
                dispatched++;
                return { bytes: image, mimeType: "image/png" };
            });
            await expect(prepareGhostResource(remote(url), f.options)).rejects.toBeInstanceOf(GhostResourceError);
            expect(f.downloadImage).toHaveBeenCalledWith(url, expect.objectContaining({ beforeSend: expect.any(Function), assertCurrent: expect.any(Function) }));
            expect(dispatched).toBe(1);
            expect(f.readBinary).not.toHaveBeenCalled();
        }
        const finalBarrier = fixture();
        finalBarrier.options.gate.beforeSend = async () => { finalBarrier.state.web = false; };
        await expect(prepareGhostResource(remote(url), finalBarrier.options)).rejects.toMatchObject({ code: "web-denied" });
    });

    it("directly reuses downloaded target image URLs and refuses other sites or arbitrary same-site routes", async () => {
        const f = fixture();
        const url = "https://blog.example/blog/content/images/2026/09/photo.png";
        const direct = await prepareGhostResource(remote(url), f.options);
        expect(direct.metadata).toMatchObject({ url, byteHash: digest(image) });
        expect(f.downloadImage).toHaveBeenCalledTimes(1);
        for (const other of [
            "https://other.example/blog/content/images/photo.png",
            "https://blog.example/blog/anything.png",
            "https://blog.example/content/images/photo.png",
            "https://blog.example/blog/content/images/%2e%2e%2fadmin.png",
        ]) {
            const result = await prepareGhostResource(remote(other), f.options);
            expect(result.metadata.url).toBeUndefined();
        }
        f.downloadImage.mockResolvedValue({ bytes: image, mimeType: "text/html" });
        await expect(prepareGhostResource(remote(url), f.options)).rejects.toMatchObject({ code: "unsupported-image" });
    });

    it("bounds actual bytes, supports only known formats, and exposes code-only resource failures", async () => {
        const f = fixture();
        await expect(prepareGhostResource(local("assets/movie.mp4"), f.options)).rejects.toMatchObject({ code: "unsupported-image" });
        expect(f.readBinary).not.toHaveBeenCalled();
        f.readBinary.mockResolvedValue(new ArrayBuffer(GHOST_MAX_RESOURCE_BYTES + 1));
        await expect(prepareGhostResource(local(), f.options)).rejects.toMatchObject({ code: "resource-too-large" });
        f.readBinary.mockResolvedValue(new ArrayBuffer(0));
        await expect(prepareGhostResource(local(), f.options)).rejects.toMatchObject({ code: "invalid-resource" });
        f.readBinary.mockRejectedValue(new Error("secret-token https://private.example/picture.png raw-bytes"));
        const error = await prepareGhostResource(local(), f.options).catch((caught: unknown) => caught) as GhostResourceError;
        expect(error).toBeInstanceOf(GhostResourceError);
        expect(error.code).toBe("read-failed");
        expect(`${error.stack} ${JSON.stringify(error)}`).not.toMatch(/secret-token|private\.example|raw-bytes/);
        expect(Object.keys(error).sort()).toEqual(["code", "name"]);
        f.downloadImage.mockResolvedValue({ bytes: new Uint8Array(GHOST_MAX_RESOURCE_BYTES + 1), mimeType: "image/png" });
        await expect(prepareGhostResource(remote("https://images.example/a.png"), f.options)).rejects.toMatchObject({ code: "resource-too-large" });
    });
});
