import {
    createShareCardLogo,
    createShareCardOrnament,
} from "../src/share-card/share-card-assets";
import { asDocument, ShareCardTestDocument } from "./helpers/share-card-dom";

describe("Share Card SVG assets", () => {
    it.each([
        ["logo", createShareCardLogo],
        ["ornament", createShareCardOrnament],
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
});
