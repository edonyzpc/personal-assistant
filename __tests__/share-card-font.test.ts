import { readFileSync } from "node:fs";
import {
    SHARE_CARD_FONT_FAMILY,
    getShareCardLocalFonts,
    loadShareCardFont,
    registerShareCardFontFace,
    unregisterShareCardFontFace,
} from "../src/share-card/share-card-font";

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

interface TestFontDocument {
    document: Document;
    add: jest.Mock;
    remove: jest.Mock;
    FontFaceCtor: jest.Mock;
}

describe("Share Card bundled font lifecycle", () => {
    it("keeps the bundled face primary for all non-code card labels", () => {
        const css = readFileSync("src/custom.pcss", "utf8");

        expect(css).toContain('font-family: "PA Share Serif", serif;');
        expect(css).toMatch(
            /\.pa-share-card \.pa-share-card-body[\s\S]*?\.pa-share-card \.pa-share-card-footer \*[\s\S]*?font-family: inherit;/u,
        );
        expect(css).toMatch(/\.pa-share-card-footer \{[\s\S]*?font-family: inherit;/u);
        expect(css).toMatch(/\.pa-share-card-body code \{[\s\S]*?font-family: ui-monospace/u);
    });

    it("exposes exactly one inline WOFF2 font to the capture boundary", async () => {
        const dataUrl = await loadShareCardFont();

        expect(dataUrl).toBe("data:font/woff2;base64,d09GMg==");
        await expect(getShareCardLocalFonts()).resolves.toEqual([{
            family: SHARE_CARD_FONT_FAMILY,
            src: dataUrl,
            weight: "400",
            style: "normal",
        }]);
    });

    it("reference-counts one FontFace per owner document and supports reopening", async () => {
        await loadShareCardFont();
        const firstFace = createFace();
        const secondFace = createFace();
        const testDocument = createFontDocument([firstFace, secondFace]);

        await Promise.all([
            registerShareCardFontFace(testDocument.document),
            registerShareCardFontFace(testDocument.document),
        ]);

        expect(testDocument.FontFaceCtor).toHaveBeenCalledTimes(1);
        expect(testDocument.FontFaceCtor).toHaveBeenCalledWith(
            SHARE_CARD_FONT_FAMILY,
            "url(data:font/woff2;base64,d09GMg==)",
            { weight: "400", style: "normal", display: "swap" },
        );
        expect(testDocument.add).toHaveBeenCalledWith(firstFace);

        unregisterShareCardFontFace(testDocument.document);
        expect(testDocument.remove).not.toHaveBeenCalled();
        unregisterShareCardFontFace(testDocument.document);
        expect(testDocument.remove).toHaveBeenCalledWith(firstFace);

        await registerShareCardFontFace(testDocument.document);
        expect(testDocument.FontFaceCtor).toHaveBeenCalledTimes(2);
        expect(testDocument.add).toHaveBeenLastCalledWith(secondFace);
        unregisterShareCardFontFace(testDocument.document);
        expect(testDocument.remove).toHaveBeenLastCalledWith(secondFace);
    });

    it("isolates FontFace ownership across different documents", async () => {
        await loadShareCardFont();
        const firstFace = createFace();
        const secondFace = createFace();
        const firstDocument = createFontDocument([firstFace]);
        const secondDocument = createFontDocument([secondFace]);

        await Promise.all([
            registerShareCardFontFace(firstDocument.document),
            registerShareCardFontFace(secondDocument.document),
        ]);
        expect(firstDocument.add).toHaveBeenCalledWith(firstFace);
        expect(secondDocument.add).toHaveBeenCalledWith(secondFace);

        unregisterShareCardFontFace(firstDocument.document);
        expect(firstDocument.remove).toHaveBeenCalledWith(firstFace);
        expect(secondDocument.remove).not.toHaveBeenCalled();
        unregisterShareCardFontFace(secondDocument.document);
        expect(secondDocument.remove).toHaveBeenCalledWith(secondFace);
    });

    it("does not add a face when its final reference closes during loading", async () => {
        await loadShareCardFont();
        const loading = deferred<FontFace>();
        const face = createFace(() => loading.promise);
        const testDocument = createFontDocument([face]);

        const registration = registerShareCardFontFace(testDocument.document);
        await flushMicrotasks();
        expect(testDocument.FontFaceCtor).toHaveBeenCalledTimes(1);
        unregisterShareCardFontFace(testDocument.document);
        loading.resolve(face);
        await registration;

        expect(testDocument.add).not.toHaveBeenCalled();
        expect(testDocument.remove).not.toHaveBeenCalled();
    });

    it("fails closed on FontFace load errors and permits a clean retry", async () => {
        await loadShareCardFont();
        const failedFace = createFace(async () => {
            throw new Error("font decode failed");
        });
        const retryFace = createFace();
        const testDocument = createFontDocument([failedFace, retryFace]);

        await expect(registerShareCardFontFace(testDocument.document))
            .rejects.toThrow("font decode failed");
        expect(testDocument.add).not.toHaveBeenCalled();

        await expect(registerShareCardFontFace(testDocument.document)).resolves.toBeUndefined();
        expect(testDocument.FontFaceCtor).toHaveBeenCalledTimes(2);
        expect(testDocument.add).toHaveBeenCalledWith(retryFace);
        unregisterShareCardFontFace(testDocument.document);
    });
});

function createFace(
    load: () => Promise<FontFace> = async function loadFace(this: FontFace) {
        return this;
    },
): FontFace & { load: jest.Mock } {
    const face = { load: jest.fn() } as unknown as FontFace & { load: jest.Mock };
    face.load.mockImplementation(() => load.call(face));
    return face;
}

function createFontDocument(faces: FontFace[]): TestFontDocument {
    const add = jest.fn();
    const remove = jest.fn();
    const FontFaceCtor = jest.fn(function FontFaceMock() {
        const face = faces.shift();
        if (!face) throw new Error("No test FontFace remains.");
        return face;
    });
    const document = {
        defaultView: { FontFace: FontFaceCtor },
        fonts: { add, delete: remove },
    } as unknown as Document;
    return { document, add, remove, FontFaceCtor };
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
