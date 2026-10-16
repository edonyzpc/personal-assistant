import {
    createShareCardLogo,
    createShareCardOrnament,
    createShareCardSharerMark,
} from "../src/share-card/share-card-assets";
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
