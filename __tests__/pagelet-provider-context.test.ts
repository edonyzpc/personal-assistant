import { getPageletProviderAuthorizationContextId, getPageletProviderInfo } from "../src/pagelet/provider-context";

const settings = {
    provider: "openai",
    model: "configured-model",
    embeddingModel: "configured-embedding",
    providerPreset: null,
    endpoint: "https://user:secret@example.test/v1?key=private#fragment",
};
const scope = {
    excludedFolders: ["Private", "Archive"],
    excludedTags: ["private"],
    excludedPatterns: [],
    reviewsFolder: ".pagelet",
};

describe("current Pagelet provider context", () => {
    it("keeps credentials and query values out of the first-use disclosure", () => {
        expect(getPageletProviderInfo(settings)).toEqual({
            provider: "openai", model: "configured-model", endpoint: "https://example.test/v1",
        });
        expect(getPageletProviderInfo({ ...settings, endpoint: "invalid endpoint" }).endpoint)
            .toBe("Custom endpoint");
    });

    it("keeps equivalent scope order stable and invalidates changed provider or boundary identities", () => {
        const identity = getPageletProviderAuthorizationContextId(settings, scope, "boundary-a");
        expect(getPageletProviderAuthorizationContextId(settings, {
            ...scope, excludedFolders: [...scope.excludedFolders].reverse(),
        }, "boundary-a")).toBe(identity);
        expect(getPageletProviderAuthorizationContextId({ ...settings, model: "changed-model" }, scope, "boundary-a"))
            .not.toBe(identity);
        expect(getPageletProviderAuthorizationContextId(settings, scope, "boundary-b")).not.toBe(identity);
    });
});
