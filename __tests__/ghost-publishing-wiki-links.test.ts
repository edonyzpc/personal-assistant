import { describe, expect, it, jest } from "@jest/globals";
import { resolveGhostWikiLinks } from "../src/ghost-publishing/wiki-links";
import type { GhostBindingHost } from "../src/ghost-publishing/binding";
import type { GhostPublishingSourceFile } from "../src/ghost-publishing/types";

const POST_ID = "a".repeat(24);
const links = [{ target: "Linked", sourcePath: "Main.md", line: 2 }];

function fixture(properties: Record<string, unknown>, paths = ["Linked.md"]) {
    const files: GhostPublishingSourceFile[] = [{ path: "Main.md", extension: "md" }, ...paths.map((path) => ({ path, extension: "md" }))];
    const state = { allowed: true, revision: 1 };
    const read = jest.fn<(file: GhostPublishingSourceFile) => Promise<string>>(async () => `---\n${JSON.stringify(properties)}\n---\nPrivate target body`);
    const readPost = jest.fn<(id: string) => Promise<{ id: string; status: string; url: string } | null>>(async (id) => ({
        id, status: "published", url: "https://blog.example/current-url/",
    }));
    const host: GhostBindingHost = {
        vault: { getAbstractFileByPath: (path) => files.find((file) => file.path === path) ?? null, getMarkdownFiles: () => files, read },
        metadataCache: { getFileCache: () => null },
        fileManager: { processFrontMatter: async () => undefined },
        getFrontMatterInfo: (markdown) => ({ exists: true, frontmatter: markdown.split("\n")[1], contentStart: markdown.indexOf("Private") }),
        parseYaml: JSON.parse,
    };
    const publishingHost = { ...host, metadataCache: { ...host.metadataCache,
        getFirstLinkpathDest: () => files.find((file) => file.path === "Linked.md") ?? files[1] } };
    const options = { host: publishingHost, siteUrl: "https://blog.example/", readPost,
        guard: { isCurrent: () => true, isPathAllowed: (path: string) => path === "Main.md" || state.allowed, isNoteDomainAllowed: () => true },
        assertCurrent: () => undefined, getSourceRevision: () => state.revision };
    return { options, read, readPost, state, files };
}

describe("Ghost ordinary links with a current single-ID association", () => {
    it("uses only GHOST_ID and queries the real published URL without sending target content", async () => {
        const f = fixture({ GHOST_ID: POST_ID.toUpperCase(), pa_ghost_site: "https://old.example/", pa_ghost_post_url: "old", pa_ghost: false });
        const receipt = await resolveGhostWikiLinks(links, f.options);
        expect(receipt.targets.Linked).toEqual({ status: "published", url: "https://blog.example/current-url/" });
        expect(f.readPost).toHaveBeenCalledWith(POST_ID);
        expect(f.readPost).toHaveBeenCalledTimes(1);
        expect(f.read.mock.calls.map(([file]) => file.path)).toEqual(["Linked.md"]);
    });

    it("does not query old-only or illegal associations", async () => {
        for (const properties of [{ pa_ghost_post_id: POST_ID }, { GHOST_ID: "", pa_ghost_post_id: POST_ID }]) {
            const f = fixture(properties);
            expect((await resolveGhostWikiLinks(links, f.options)).targets.Linked).toEqual({ status: "unpublished" });
            expect(f.readPost).not.toHaveBeenCalled();
        }
    });

    it("degrades a missing, draft, different or failed API result without substituting another article", async () => {
        for (const result of [null, { id: POST_ID, status: "draft", url: "https://blog.example/draft/" },
            { id: "b".repeat(24), status: "published", url: "https://blog.example/other/" }]) {
            const f = fixture({ GHOST_ID: POST_ID });
            f.readPost.mockResolvedValue(result);
            expect((await resolveGhostWikiLinks(links, f.options)).targets.Linked).toEqual({ status: "unpublished" });
        }
        const failed = fixture({ GHOST_ID: POST_ID });
        failed.readPost.mockRejectedValue(new Error("network unavailable"));
        expect((await resolveGhostWikiLinks(links, failed.options)).targets.Linked).toEqual({ status: "unpublished" });
    });

    it("does not read denied or ambiguous targets", async () => {
        const denied = fixture({ GHOST_ID: POST_ID });
        denied.state.allowed = false;
        expect((await resolveGhostWikiLinks(links, denied.options)).targets.Linked).toEqual({ status: "unpublished" });
        expect(denied.read).not.toHaveBeenCalled();
        expect(denied.readPost).not.toHaveBeenCalled();
        const ambiguous = fixture({ GHOST_ID: POST_ID }, ["one/Linked.md", "two/Linked.md"]);
        expect((await resolveGhostWikiLinks(links, ambiguous.options)).targets.Linked).toEqual({ status: "ambiguous" });
        expect(ambiguous.read).not.toHaveBeenCalled();
        expect(ambiguous.readPost).not.toHaveBeenCalled();
    });

    it("still blocks actual permission or source changes across the API await", async () => {
        for (const kind of ["permission", "revision", "identity"]) {
            const f = fixture({ GHOST_ID: POST_ID });
            f.readPost.mockImplementation(async (id) => {
                if (kind === "permission") f.state.allowed = false;
                if (kind === "revision") f.state.revision++;
                if (kind === "identity") f.files[1] = { ...f.files[1] };
                return { id, status: "published", url: "https://blog.example/current-url/" };
            });
            await expect(resolveGhostWikiLinks(links, f.options)).rejects.toMatchObject({
                code: kind === "permission" ? "source-revoked" : "source-changed",
            });
        }
    });
});
