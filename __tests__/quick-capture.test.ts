import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { TFile } from "obsidian";
import type { App } from "obsidian";

const mockNotices: string[] = [];
const mockModalInstances: Array<{
    createdElements: MockElement[];
    close(): void;
}> = [];

type MockElement = {
    tag: string;
    text?: string;
    value: string;
    disabled: boolean;
    dataset: Record<string, string>;
    listeners: Record<string, Array<(event?: unknown) => void>>;
    addEventListener(type: string, listener: (event?: unknown) => void): void;
    dispatchEvent(event: { type: string }): boolean;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    focus(): void;
    setSelectionRange(start: number, end: number): void;
    createEl?(tag: string, options?: { text?: string }): MockElement;
};

jest.mock("obsidian", () => {
    function createMockElement(tag: string, options?: { text?: string }): MockElement {
        const listeners: MockElement["listeners"] = {};
        return {
            tag,
            text: options?.text,
            value: "",
            disabled: false,
            dataset: {},
            listeners,
            addEventListener: jest.fn((type: string, listener: (event?: unknown) => void) => {
                listeners[type] = listeners[type] ?? [];
                listeners[type].push(listener);
            }),
            dispatchEvent(event: { type: string }) {
                for (const listener of listeners[event.type] ?? []) {
                    listener(event);
                }
                return true;
            },
            setAttribute: jest.fn(),
            removeAttribute: jest.fn(),
            focus: jest.fn(),
            setSelectionRange: jest.fn(),
        };
    }

    class MockTFile {
        path: string;
        name: string;
        extension: string;

        constructor(path: string) {
            this.path = path;
            this.name = path.split("/").pop() ?? path;
            this.extension = path.endsWith(".md") ? "md" : "";
        }
    }

    return {
        App: class { },
        Modal: class {
            createdElements: MockElement[] = [];
            modalEl = { addClass: jest.fn() };
            contentEl = {
                empty: jest.fn(),
                addClass: jest.fn(),
                createEl: jest.fn((tag: string, options?: { text?: string }) => {
                    const element = createMockElement(tag, options);
                    this.createdElements.push(element);
                    return element;
                }),
                createDiv: jest.fn(() => {
                    const element = createMockElement("div");
                    element.createEl = jest.fn((tag: string, options?: { text?: string }) => {
                        const child = createMockElement(tag, options);
                        this.createdElements.push(child);
                        return child;
                    });
                    this.createdElements.push(element);
                    return element;
                }),
            };
            constructor(_app?: unknown) {
                mockModalInstances.push(this);
            }
            open() {
                (this as unknown as { onOpen?: () => void }).onOpen?.();
            }
            close() {
                (this as unknown as { onClose?: () => void }).onClose?.();
            }
        },
        Notice: class {
            constructor(message?: unknown) {
                mockNotices.push(String(message));
            }
        },
        TFile: MockTFile,
        normalizePath: (path: string) => {
            const normalized = path
                .replace(/\\/g, "/")
                .replace(/\/+/g, "/")
                .replace(/\/$/g, "");
            return normalized === "" ? "." : normalized;
        },
    };
});

import {
    QUICK_CAPTURE_DEFAULTS,
    QuickCaptureService,
    buildQuickCaptureDailyPath,
    buildQuickCaptureEntry,
    mergeQuickCaptureSettings,
    normalizeQuickCaptureInboxPath,
    type QuickCaptureCopy,
    type QuickCapturePostProcessInput,
    type QuickCaptureResult,
    type QuickCaptureSettings,
} from "../src/quick-capture";

type MockVaultEntry = { file: TFile; content: string };

function createTFile(path: string): TFile {
    return new (TFile as unknown as { new(path: string): TFile })(path);
}

function makeAppHarness(initialFiles: Record<string, string> = {}, activePath?: string) {
    const files = new Map<string, MockVaultEntry>();
    for (const [path, content] of Object.entries(initialFiles)) {
        files.set(path, { file: createTFile(path), content });
    }
    const folders = new Set<string>();
    for (const path of Object.keys(initialFiles)) {
        const slash = path.lastIndexOf("/");
        if (slash > 0) folders.add(path.slice(0, slash));
    }
    const activeFile = activePath ? files.get(activePath)?.file ?? createTFile(activePath) : null;
    if (activePath && !files.has(activePath)) {
        files.set(activePath, { file: activeFile as TFile, content: "" });
    }

    const vault = {
        adapter: {
            exists: jest.fn(async (path: string) => folders.has(path) || files.has(path)),
        },
        getAbstractFileByPath: jest.fn((path: string) => {
            if (files.has(path)) return files.get(path)?.file ?? null;
            if (folders.has(path)) return { path };
            return null;
        }),
        createFolder: jest.fn(async (path: string) => {
            folders.add(path);
        }),
        create: jest.fn(async (path: string, content: string) => {
            const file = createTFile(path);
            files.set(path, { file, content });
            return file;
        }),
        read: jest.fn(async (file: TFile) => files.get(file.path)?.content ?? ""),
        modify: jest.fn(async (file: TFile, content: string) => {
            files.set(file.path, { file, content });
        }),
    };
    const workspace = {
        getActiveFile: jest.fn(() => activeFile),
    };
    return {
        app: { vault, workspace } as unknown as App,
        vault,
        workspace,
        files,
        folders,
    };
}

const copy: QuickCaptureCopy = {
    modalTitle: "Quick Capture",
    modalPlaceholder: "Save a thought...",
    save: "Save",
    cancel: "Cancel",
    savedDaily: "Saved to Daily Note",
    savedInbox: "Saved to Inbox",
    savedCurrentFile: "Saved to current note",
    saveFailed: "Could not save Quick Capture.",
};

function makeService(
    app: App,
    quickCapture?: Partial<QuickCaptureSettings>,
    postProcessCapture?: (input: QuickCapturePostProcessInput) => Promise<void> | void,
    draft?: { value: string },
    onCaptureSaved?: (result: Extract<QuickCaptureResult, { status: "saved" }>) => Promise<void> | void,
): QuickCaptureService {
    return new QuickCaptureService({
        app,
        settings: {
            targetPath: ".",
            fileFormat: "YYYY-MM-DD",
            quickCapture,
        },
        formatDate: () => "2026-06-28",
        now: () => new Date(2026, 5, 28, 9, 7),
        log: jest.fn(),
        draft: draft
            ? {
                get: () => draft.value,
                set: (value) => { draft.value = value; },
                clear: () => { draft.value = ""; },
            }
            : undefined,
        onCaptureSaved,
        postProcessCapture,
    }, copy);
}

beforeEach(() => {
    mockNotices.length = 0;
    mockModalInstances.length = 0;
});

describe("Quick Capture settings helpers", () => {
    it("normalizes defaults and rolling inbox paths", () => {
        expect(mergeQuickCaptureSettings(undefined)).toEqual(QUICK_CAPTURE_DEFAULTS);
        expect(mergeQuickCaptureSettings({
            enabled: false,
            destination: "inbox",
            inboxPath: "captures/inbox",
            postProcessingEnabled: true,
            postProcessingDisclosureAccepted: true,
        })).toEqual({
            enabled: false,
            destination: "inbox",
            inboxPath: "captures/inbox.md",
            postProcessingEnabled: true,
            postProcessingDisclosureAccepted: true,
        });
        expect(normalizeQuickCaptureInboxPath("")).toBe("Inbox/Quick Capture.md");
    });

    it("builds Daily Note paths from the existing record-note settings", () => {
        expect(buildQuickCaptureDailyPath(".", "2026-06-28")).toBe("2026-06-28.md");
        expect(buildQuickCaptureDailyPath("journal", "2026/06/28")).toBe("journal/2026/06/28.md");
    });
});

describe("Quick Capture modal layout", () => {
    it("keeps the command modal roomy enough for multiline capture", () => {
        const source = readFileSync("src/quick-capture.ts", "utf8");
        const css = readFileSync("src/custom.pcss", "utf8");

        expect(source).toContain("pa-quick-capture-modal-shell");
        expect(source).toContain('rows: "12"');
        expect(css).toMatch(/\.pa-quick-capture-modal-shell\s*{[\s\S]*?width:\s*min\(720px,\s*calc\(100vw - 32px\)\);[\s\S]*?overflow-x:\s*hidden;/);
        expect(css).toMatch(/\.pa-quick-capture-modal__input\s*{[\s\S]*?min-height:\s*clamp\(260px,\s*42vh,\s*420px\);[\s\S]*?max-height:\s*min\(62vh,\s*620px\);[\s\S]*?overflow-y:\s*auto;/);
        expect(css).toMatch(/\.pa-quick-capture-modal__actions\s*{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-quick-capture-modal__input\s*{[\s\S]*?min-height:\s*clamp\(220px,\s*48vh,\s*420px\);[\s\S]*?max-height:\s*62vh;/);
    });

    it("preserves unsaved modal text across accidental close and clears it on cancel", () => {
        const harness = makeAppHarness();
        const draft = { value: "" };
        const service = makeService(harness.app, undefined, undefined, draft);

        service.openModal();
        const firstModal = mockModalInstances.at(-1);
        const firstInput = firstModal?.createdElements.find((element) => element.tag === "textarea");
        expect(firstInput).toBeDefined();
        firstInput!.value = "half-written capture";
        firstInput!.dispatchEvent({ type: "input" });

        expect(draft.value).toBe("half-written capture");

        firstModal!.close();

        expect(draft.value).toBe("half-written capture");

        service.openModal();
        const secondModal = mockModalInstances.at(-1);
        const secondInput = secondModal?.createdElements.find((element) => element.tag === "textarea");
        const cancelButton = secondModal?.createdElements.find((element) => element.tag === "button" && element.text === "Cancel");

        expect(secondInput?.value).toBe("half-written capture");
        cancelButton!.dispatchEvent({ type: "click" });

        expect(draft.value).toBe("");
    });

    it("ignores duplicate save clicks while a modal submit is in flight", async () => {
        const harness = makeAppHarness();
        const originalCreate = harness.vault.create;
        const releaseCreate: Array<() => void> = [];
        harness.vault.create = jest.fn((path: string, content: string) =>
            new Promise<TFile>((resolve) => {
                releaseCreate.push(() => {
                    void originalCreate(path, content).then(resolve);
                });
            }));
        const service = makeService(harness.app);

        service.openModal();
        const modal = mockModalInstances.at(-1);
        const input = modal?.createdElements.find((element) => element.tag === "textarea");
        const saveButton = modal?.createdElements.find((element) => element.tag === "button" && element.text === "Save");
        input!.value = "single submit only";

        saveButton!.dispatchEvent({ type: "click" });
        saveButton!.dispatchEvent({ type: "click" });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(harness.vault.create).toHaveBeenCalledTimes(1);
        expect(releaseCreate).toHaveLength(1);
        releaseCreate[0]();
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.files.get("2026-06-28.md")?.content).toBe("- 09:07 single submit only\n");
    });
});

describe("QuickCaptureService", () => {
    it("writes exact single-line text to the Daily Note by default", async () => {
        const harness = makeAppHarness();
        const service = makeService(harness.app);

        await service.captureText("remember the launch lesson");

        expect(harness.vault.create).toHaveBeenCalledWith(
            "2026-06-28.md",
            "- 09:07 remember the launch lesson\n",
        );
        expect(harness.vault.modify).not.toHaveBeenCalled();
        expect(mockNotices).toEqual(["Saved to Daily Note"]);
    });

    it("does not write or notify for empty input", async () => {
        const harness = makeAppHarness();
        const service = makeService(harness.app);

        await expect(service.captureText("  \n\t  ")).resolves.toEqual({ status: "empty" });

        expect(harness.vault.create).not.toHaveBeenCalled();
        expect(harness.vault.modify).not.toHaveBeenCalled();
        expect(mockNotices).toEqual([]);
    });

    it("appends to the configured rolling Inbox note", async () => {
        const harness = makeAppHarness({
            "Inbox/Quick Capture.md": "Existing inbox\n",
        });
        const service = makeService(harness.app, { destination: "inbox" });

        await service.captureText("new fragment");

        expect(harness.files.get("Inbox/Quick Capture.md")?.content).toBe(
            "Existing inbox\n\n- 09:07 new fragment\n",
        );
        expect(harness.vault.create).not.toHaveBeenCalled();
        expect(mockNotices).toEqual(["Saved to Inbox"]);
    });

    it("serializes concurrent appends to the same target note", async () => {
        const harness = makeAppHarness({
            "Inbox/Quick Capture.md": "Existing inbox\n",
        });
        const service = makeService(harness.app, { destination: "inbox" });

        await Promise.all([
            service.captureText("first fragment"),
            service.captureText("second fragment"),
        ]);

        expect(harness.files.get("Inbox/Quick Capture.md")?.content).toBe([
            "Existing inbox",
            "",
            "- 09:07 first fragment",
            "",
            "- 09:07 second fragment",
            "",
        ].join("\n"));
        expect(harness.vault.modify).toHaveBeenCalledTimes(2);
    });

    it("appends to the current file only when that destination is selected", async () => {
        const harness = makeAppHarness({
            "notes/current.md": "Working note",
        }, "notes/current.md");
        const service = makeService(harness.app, { destination: "current-file" });

        await service.captureText("in-context thought");

        expect(harness.files.get("notes/current.md")?.content).toBe(
            "Working note\n\n- 09:07 in-context thought\n",
        );
        expect(harness.vault.create).not.toHaveBeenCalled();
        expect(mockNotices).toEqual(["Saved to current note"]);
    });

    it("preserves multiline original text inside a fenced text block", async () => {
        const text = "line one\nline two with ``` fence";
        const entry = buildQuickCaptureEntry(text, new Date(2026, 5, 28, 9, 7));

        expect(entry).toContain("- 09:07\n````text\n");
        expect(entry).toContain(text + "\n````");
    });

    it("rejects protected vault paths before writing", async () => {
        const harness = makeAppHarness();
        const service = makeService(harness.app, {
            destination: "inbox",
            inboxPath: ".obsidian/plugins/personal-assistant/capture.md",
        });

        await expect(service.captureText("should not write")).rejects.toThrow("Quick Capture target is not allowed");

        expect(harness.vault.create).not.toHaveBeenCalled();
        expect(harness.vault.modify).not.toHaveBeenCalled();
        expect(mockNotices).toEqual(["Could not save Quick Capture."]);
    });

    it("schedules post-processing only after raw capture succeeds", async () => {
        const harness = makeAppHarness();
        const postProcessCapture = jest.fn(async (_input: QuickCapturePostProcessInput) => undefined);
        const service = makeService(harness.app, {
            postProcessingEnabled: true,
        }, postProcessCapture);

        const result = await service.captureText("maybe turn this into a task");

        expect(result.status).toBe("saved");
        expect(postProcessCapture).toHaveBeenCalledWith(expect.objectContaining({
            rawText: "maybe turn this into a task",
            path: "2026-06-28.md",
            destination: "daily",
            captureId: expect.stringMatching(/^qc-/),
        }));
        expect(harness.vault.create).toHaveBeenCalledWith(
            "2026-06-28.md",
            "- 09:07 maybe turn this into a task\n",
        );
    });

    it("calls the saved callback only after a raw capture succeeds", async () => {
        const harness = makeAppHarness();
        const onCaptureSaved = jest.fn((_result: Extract<QuickCaptureResult, { status: "saved" }>) => undefined);
        const service = makeService(harness.app, undefined, undefined, undefined, onCaptureSaved);

        await service.captureText("bridge this capture later");

        expect(onCaptureSaved).toHaveBeenCalledWith(expect.objectContaining({
            status: "saved",
            path: "2026-06-28.md",
            captureId: expect.stringMatching(/^qc-/),
        }));

        const blocked = makeService(harness.app, {
            destination: "inbox",
            inboxPath: ".obsidian/plugins/personal-assistant/capture.md",
        }, undefined, undefined, onCaptureSaved);
        await expect(blocked.captureText("blocked")).rejects.toThrow("Quick Capture target is not allowed");
        expect(onCaptureSaved).toHaveBeenCalledTimes(1);
    });

    it("can skip post-processing for one-action Pagelet capture", async () => {
        const harness = makeAppHarness();
        const postProcessCapture = jest.fn(async (_input: QuickCapturePostProcessInput) => undefined);
        const service = makeService(harness.app, {
            postProcessingEnabled: true,
        }, postProcessCapture);

        const result = await service.captureText("one tap context", { postProcess: false });

        expect(result.status).toBe("saved");
        expect(postProcessCapture).not.toHaveBeenCalled();
        expect(harness.vault.create).toHaveBeenCalledWith(
            "2026-06-28.md",
            "- 09:07 one tap context\n",
        );
    });

    it("does not let post-processing failure block the raw save", async () => {
        const harness = makeAppHarness();
        const postProcessCapture = jest.fn(async () => {
            throw new Error("provider failed");
        });
        const service = makeService(harness.app, {
            postProcessingEnabled: true,
        }, postProcessCapture);

        await expect(service.captureText("save even if AI fails")).resolves.toMatchObject({
            status: "saved",
            path: "2026-06-28.md",
        });

        await Promise.resolve();
        expect(harness.files.get("2026-06-28.md")?.content).toBe("- 09:07 save even if AI fails\n");
        expect(mockNotices).toEqual(["Saved to Daily Note"]);
    });
});
