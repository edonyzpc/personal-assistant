import { createHash } from "node:crypto";
import {
    createShareCardLogo,
    createShareCardOrnament,
    createShareCardSharerMark,
} from "../src/share-card/share-card-assets";
import { ensurePaperReady, getPaperDataUri } from "../src/share-card/share-card-paper";
import { asDocument, ShareCardTestDocument } from "./helpers/share-card-dom";

describe("Share Card SVG assets", () => {
    it.each([
        ["logo", createShareCardLogo],
        ["ornament", createShareCardOrnament],
        ["sharer mark", createShareCardSharerMark],
    ] as const)("keeps the %s detached in its owner document when another document is active", (_name, createAsset) => {
        const ownerDocument = new ShareCardTestDocument();
        const activeDocument = new ShareCardTestDocument();
        const previousActiveDocument = Object.getOwnPropertyDescriptor(globalThis, "activeDocument");
        Object.defineProperty(globalThis, "activeDocument", {
            configurable: true,
            value: asDocument(activeDocument),
        });

        try {
            const asset = createAsset(asDocument(ownerDocument));
            for (const element of [asset, ...Array.from(asset.querySelectorAll("*"))]) {
                expect(element.ownerDocument).toBe(ownerDocument);
                expect(element.namespaceURI).toBe("http://www.w3.org/2000/svg");
            }
            expect(asset.isConnected).toBe(false);
            expect(asset.parentNode).toBeNull();
            expect(ownerDocument.body.children).toHaveLength(0);
            expect(activeDocument.body.children).toHaveLength(0);
        } finally {
            if (previousActiveDocument) {
                Object.defineProperty(globalThis, "activeDocument", previousActiveDocument);
            } else {
                Reflect.deleteProperty(globalThis, "activeDocument");
            }
        }
    });

    it("builds the approved EZ signature with its original geometry", () => {
        const document = new ShareCardTestDocument();
        const svg = createShareCardSharerMark(asDocument(document));
        const group = svg.querySelector("g")!;
        const paths = Array.from(svg.querySelectorAll("path"));

        expect(svg.getAttribute("viewBox")).toBe("63.5 25.125 224 168");
        expect(svg.getAttribute("width")).toBe("32");
        expect(svg.getAttribute("height")).toBe("24");
        expect(svg.getAttribute("aria-hidden")).toBe("true");
        expect(group.getAttribute("fill")).toBe("none");
        expect(group.getAttribute("stroke")).toBe("currentColor");
        expect(group.getAttribute("stroke-linecap")).toBe("round");
        expect(group.getAttribute("stroke-linejoin")).toBe("round");
        expect(paths.map((path) => path.getAttribute("d"))).toEqual([
            "M90 77 C108 66 128 65 145 71",
            "M88 110 C109 102 129 103 146 108",
            "M89 141 C110 140 132 144 153 150",
            "M188 78 C210 71 233 72 254 79",
            "M249 83 C228 100 206 119 185 140",
            "M182 144 C208 142 236 146 262 152",
        ]);
        expect(paths.map((path) => path.getAttribute("stroke-width"))).toEqual([
            "23", "19", "20", "20", "24", "21",
        ]);
    });
});

describe("Share Card frozen paper", () => {
    it.each([
        ["light", 680727, "8cdbf029e1332b3cf451093afda2ea96464d9d0826b42d494de782b9269364d2"],
        ["dark", 534809, "2cb2e29ad81cef4ad013d0048d7c69a30ba9fe18e6fd5a454fb3694f4c536a64"],
    ] as const)("preserves the approved %s PNG bytes and native dimensions", (theme, size, sha256) => {
        const uri = getPaperDataUri(theme);
        expect(uri.startsWith("data:image/png;base64,")).toBe(true);
        const png = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
        expect(png.length).toBe(size);
        expect(createHash("sha256").update(png).digest("hex")).toBe(sha256);
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([540, 720]);
    });

    it("reuses a pending decode only for the same owner document and theme", async () => {
        const document = new ShareCardTestDocument();
        const otherDocument = new ShareCardTestDocument();
        let finishDecode!: () => void;
        const decode = jest.fn(() => new Promise<void>((resolve) => { finishDecode = resolve; }));
        const otherDecode = jest.fn(async () => undefined);
        const image = Object.assign(document.createElement("img"), { decode, src: "" });
        const otherImage = Object.assign(otherDocument.createElement("img"), { decode: otherDecode, src: "" });
        const createImage = jest.spyOn(document, "createElement").mockReturnValue(image);
        const createOtherImage = jest.spyOn(otherDocument, "createElement").mockReturnValue(otherImage);

        const pending = ensurePaperReady(asDocument(document), "light");
        expect(ensurePaperReady(asDocument(document), "light")).toBe(pending);
        expect(image.src === getPaperDataUri("light")).toBe(true);
        expect(createImage).toHaveBeenCalledWith("img");
        expect(decode).toHaveBeenCalledTimes(1);
        finishDecode();
        await pending;
        expect(ensurePaperReady(asDocument(document), "light")).toBe(pending);

        const dark = ensurePaperReady(asDocument(document), "dark");
        expect(dark).not.toBe(pending);
        expect(image.src === getPaperDataUri("dark")).toBe(true);
        finishDecode();
        await dark;
        await ensurePaperReady(asDocument(otherDocument), "light");
        expect(createImage).toHaveBeenCalledTimes(2);
        expect(createOtherImage).toHaveBeenCalledTimes(1);
        expect(otherDecode).toHaveBeenCalledTimes(1);
        expect(image.ownerDocument).toBe(document);
        expect(otherImage.ownerDocument).toBe(otherDocument);
        expect(document.body.children).toHaveLength(0);
        expect(otherDocument.body.children).toHaveLength(0);
    });

    it("evicts a failed decode so the next render can retry", async () => {
        const document = new ShareCardTestDocument();
        const decode = jest.fn<Promise<void>, []>()
            .mockRejectedValueOnce(new Error("decode failed"))
            .mockResolvedValueOnce(undefined);
        const image = Object.assign(document.createElement("img"), { decode, src: "" });
        jest.spyOn(document, "createElement").mockReturnValue(image);

        const failed = ensurePaperReady(asDocument(document), "dark");
        await expect(failed).rejects.toThrow("decode failed");
        const retry = ensurePaperReady(asDocument(document), "dark");
        expect(retry).not.toBe(failed);
        await expect(retry).resolves.toBeUndefined();
        expect(decode).toHaveBeenCalledTimes(2);
    });
});
