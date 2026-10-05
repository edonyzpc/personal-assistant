import { parseLinktext } from "obsidian";
import { prepareNoteImageRemoval } from "../src/ai-services/operations/note-image-removal";
import { createObsidianNoteImageHost } from "../src/ai-services/operations/obsidian-note-image-host";
import { TaskSourceConstraintState } from "../src/ai-services/task-source-constraint";

jest.mock("obsidian", () => ({
    parseLinktext: jest.fn((linktext: string) => ({ path: linktext, subpath: "" })),
}));

it("prepares image removal through the exported parser and native-shaped MetadataCache", async () => {
    const notePath = "notes/featured.md";
    const attachmentPath = "assets/image.png";
    const imageReference = `![[${attachmentPath}]]`;
    const before = `> [!featured-image]\n> Caption stays.\n> ${imageReference}\n\nBody stays.\n`;
    const note = { path: notePath, extension: "md", stat: { mtime: 1, size: before.length } };
    const attachment = { path: attachmentPath, extension: "png", stat: { mtime: 1, size: 3 } };
    const getFirstLinkpathDest = jest.fn((linkpath: string, sourcePath: string) => (
        linkpath === attachmentPath && sourcePath === notePath ? attachment : null
    ));
    const app = {
        vault: {
            getFiles: () => [note, attachment],
            getAbstractFileByPath: (path: string) => path === notePath ? note : path === attachmentPath ? attachment : null,
            read: jest.fn(async () => before),
            readBinary: jest.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
            createBinary: jest.fn(),
        },
        // Obsidian exposes parseLinktext as a module function, not a cache method.
        metadataCache: { getFirstLinkpathDest },
    };
    const host = createObsidianNoteImageHost({
        app,
        isPathAllowed: () => true,
        isAttachmentPathAllowed: () => true,
    });
    const state = new TaskSourceConstraintState({
        runId: "native-host-run",
        userMessageId: "native-host-user",
        userText: "Remove the featured image and its attachment.",
        noteHandles: new Map([["current", "note-id"]]),
    });
    const guard = state.createReadGuard(
        state.snapshot(),
        path => path === notePath ? "note-id" : undefined,
        () => true,
        undefined,
        () => ({ allowedPaths: null, excludedPaths: [] }),
        undefined,
        undefined,
        () => true,
    );

    const prepared = await prepareNoteImageRemoval({
        runId: "native-host-run",
        turnId: "native-host-turn",
        toolCallId: "native-host-tool-call",
        input: { notePath, imageReference, attachmentAction: "delete" },
        host,
        taskSourceReadGuard: guard,
    });

    expect(parseLinktext).toHaveBeenCalledWith(attachmentPath);
    expect(getFirstLinkpathDest).toHaveBeenCalledWith(attachmentPath, notePath);
    expect(prepared.operation.expectedAfter).toBe("> [!featured-image]\n> Caption stays.\n\nBody stays.\n");
    expect(prepared.privatePreparation.attachment.file).toBe(attachment);
    expect(app.vault.createBinary).not.toHaveBeenCalled();
});
