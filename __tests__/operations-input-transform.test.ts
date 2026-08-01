import {
    MAX_FRONTMATTER_JSON_NODES,
    MAX_FRONTMATTER_KEYS,
    MAX_FRONTMATTER_KEY_CHARS,
    MAX_OPERATION_SELECTOR_CHARS,
    OperationsValidationError,
    validateCoreWriteInput,
} from "../src/ai-services/operations/input-validation";
import { OperationsPathError, validateOperationsVaultPath } from "../src/ai-services/operations/vault-path";
import {
    OperationsTransformError,
    appendMarkdown,
    deleteMarkdownLines,
    deleteMarkdownSection,
    insertMarkdown,
    replaceLiteral,
    transformFrontmatter,
} from "../src/ai-services/operations/vault-transform";

const jsonFrontmatterCodec = {
    parse: (source: string): unknown => JSON.parse(source),
    stringify: (value: Record<string, unknown>): string => JSON.stringify(value),
};

describe("Operations core input validation", () => {
    it("strictly validates the four core tool shapes", () => {
        expect(validateCoreWriteInput("vault_create", { path: "notes/new.md", content: "# New" })).toEqual({
            path: "notes/new.md",
            content: "# New",
        });
        expect(validateCoreWriteInput("vault_append", { path: "notes/a.md", content: "More" })).toEqual({
            path: "notes/a.md",
            content: "More",
        });
        expect(validateCoreWriteInput("vault_process", {
            path: "notes/a.md",
            operation: "insert",
            params: { anchor: { line: 2 }, position: "after", content: "More" },
        })).toEqual({
            path: "notes/a.md",
            operation: "insert",
            params: { anchor: { line: 2 }, position: "after", content: "More" },
        });
        expect(validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: { status: "done", score: 2 },
            delete: ["draft"],
        })).toMatchObject({ path: "notes/a.md", set: { status: "done", score: 2 }, delete: ["draft"] });
    });

    it("rejects additional, ambiguous, empty, and invalid nested properties", () => {
        expect(() => validateCoreWriteInput("vault_create", {
            path: "notes/new.md",
            content: "x",
            overwrite: true,
        })).toThrow(OperationsValidationError);
        expect(() => validateCoreWriteInput("vault_append", { path: "notes/a.md", content: "" }))
            .toThrow("must not be empty");
        expect(() => validateCoreWriteInput("vault_process", {
            path: "notes/a.md",
            operation: "insert",
            params: { anchor: { heading: "A", line: 1 }, position: "after", content: "x" },
        })).toThrow("exactly one");
        expect(() => validateCoreWriteInput("vault_process", {
            path: "notes/a.md",
            operation: "delete",
            params: { from: 3, to: 2 },
        })).toThrow("less than or equal");
        expect(() => validateCoreWriteInput("frontmatter_update", { path: "notes/a.md" }))
            .toThrow("non-empty set or delete");
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: { status: "done" },
            delete: ["status"],
        })).toThrow("cannot set and delete");

        const polluted = JSON.parse('{"path":"notes/a.md","set":{"safe":{"__proto__":{"polluted":true}}}}');
        expect(() => validateCoreWriteInput("frontmatter_update", polluted)).toThrow("forbidden key __proto__");
        expect(() => validateCoreWriteInput("vault_process", {
            path: "notes/a.md",
            operation: "replace",
            params: { search: "x".repeat(50_001), replace: "y" },
        })).toThrow("exceeds 50000 characters");
    });

    it("bounds heading and section selectors supplied by the provider", () => {
        const oversizedSelector = "h".repeat(MAX_OPERATION_SELECTOR_CHARS + 1);
        expect(() => validateCoreWriteInput("vault_process", {
            path: "notes/a.md",
            operation: "insert",
            params: { anchor: { heading: oversizedSelector }, position: "after", content: "x" },
        })).toThrow(`exceeds ${MAX_OPERATION_SELECTOR_CHARS} characters`);
        expect(() => validateCoreWriteInput("vault_process", {
            path: "notes/a.md",
            operation: "delete",
            params: { section: oversizedSelector },
        })).toThrow(`exceeds ${MAX_OPERATION_SELECTOR_CHARS} characters`);
    });

    it("bounds frontmatter key counts and key lengths before allocating output arrays", () => {
        const oversizedKey = "k".repeat(MAX_FRONTMATTER_KEY_CHARS + 1);
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            delete: [oversizedKey],
        })).toThrow(`longer than ${MAX_FRONTMATTER_KEY_CHARS} characters`);
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            delete: Array.from({ length: MAX_FRONTMATTER_KEYS + 1 }, (_, index) => `key-${index}`),
        })).toThrow(`at most ${MAX_FRONTMATTER_KEYS} keys`);
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: Object.fromEntries(Array.from(
                { length: MAX_FRONTMATTER_KEYS + 1 },
                (_, index) => [`key-${index}`, index],
            )),
        })).toThrow(`at most ${MAX_FRONTMATTER_KEYS} keys`);
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: { nested: { [oversizedKey]: true } },
        })).toThrow(`longer than ${MAX_FRONTMATTER_KEY_CHARS} characters`);

        const aggregateOversizedDelete = Array.from({ length: 200 }, (_, index) => (
            `${index}-`.padEnd(MAX_FRONTMATTER_KEY_CHARS, "x")
        ));
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            delete: aggregateOversizedDelete,
        })).toThrow("supplied content exceeds 50000 characters");
    });

    it("preflights frontmatter JSON node and encoded-character budgets before deep cloning", () => {
        const oversizedSparseArray: unknown[] = [];
        oversizedSparseArray.length = MAX_FRONTMATTER_JSON_NODES + 1;
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: { values: oversizedSparseArray },
        })).toThrow(`exceeds ${MAX_FRONTMATTER_JSON_NODES} JSON nodes`);

        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: { value: "\u0000".repeat(9_000) },
        })).toThrow("frontmatter_update.set exceeds 50000 characters");

        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => validateCoreWriteInput("frontmatter_update", {
            path: "notes/a.md",
            set: cyclic,
        })).toThrow("must not contain cycles");
    });
});

describe("Operations vault-wide path validation", () => {
    it("normalizes safe vault-relative Markdown paths", () => {
        expect(validateOperationsVaultPath("./Projects//PA/conclusion.md")).toBe("Projects/PA/conclusion.md");
        expect(validateOperationsVaultPath("root-note.md")).toBe("root-note.md");
    });

    it.each([
        "/tmp/a.md",
        "C:\\tmp\\a.md",
        "notes/../a.md",
        ".obsidian/plugins/a.md",
        "notes/.git/a.md",
        "notes/.trash/a.md",
        "notes/.obsidian.bak/a.md",
        "notes/a.txt",
        "notes/a. /b.md",
        `notes/zero\u200bwidth.md`,
    ])("rejects unsafe path %s", (path) => {
        expect(() => validateOperationsVaultPath(path)).toThrow(OperationsPathError);
    });
});

describe("Operations pure Markdown transforms", () => {
    it("appends with a single required line boundary", () => {
        expect(appendMarkdown("A", "B")).toBe("A\nB");
        expect(appendMarkdown("A\n", "B")).toBe("A\nB");
        expect(appendMarkdown("A\r\n", "B")).toBe("A\r\nB");
    });

    it("performs literal first/all replacement, including regex metacharacters", () => {
        expect(replaceLiteral("a.*b a.*b", ".*", "X", "first")).toBe("aXb a.*b");
        expect(replaceLiteral("a.*b a.*b", ".*", "X", "all")).toBe("aXb aXb");
        expect(() => replaceLiteral("abc", "z", "x")).toThrow("not found");
    });

    it("measures replace-all amplification before constructing an unbounded result", () => {
        expect(replaceLiteral("a".repeat(1_000), "a", "x".repeat(50), "all")).toHaveLength(50_000);
        expect(() => replaceLiteral("a".repeat(1_001), "a", "x".repeat(50), "all"))
            .toThrow("generates more than 50000 characters");
        expect(() => replaceLiteral("a".repeat(50_001), "a", "", "all"))
            .toThrow("exceeds 50000 matches");
    });

    it("matches visible headings while ignoring fenced code and refuses ambiguity", () => {
        const note = [
            "# Intro",
            "```md",
            "## Target",
            "```",
            "## Target",
            "body",
            "# End",
            "tail",
        ].join("\n");
        expect(insertMarkdown(note, { heading: "Target" }, "after", "inserted"))
            .toContain("## Target\ninserted\nbody");
        expect(deleteMarkdownSection(note, "Target")).toBe([
            "# Intro",
            "```md",
            "## Target",
            "```",
            "# End",
            "tail",
        ].join("\n"));
        expect(() => deleteMarkdownSection("## Same\na\n## Same\nb", "Same")).toThrow("ambiguous");
        expect(() => insertMarkdown(note, { heading: "Missing" }, "before", "x")).toThrow("not found");
    });

    it("supports Setext headings and ignores heading-like frontmatter values", () => {
        const note = [
            "---",
            "title: '# Hidden'",
            "---",
            "Visible heading",
            "===============",
            "Body",
        ].join("\n");

        expect(insertMarkdown(note, { heading: "Visible heading" }, "after", "Inserted"))
            .toBe([
                "---",
                "title: '# Hidden'",
                "---",
                "Visible heading",
                "===============",
                "Inserted",
                "Body",
            ].join("\n"));
        expect(() => insertMarkdown(note, { heading: "Hidden" }, "after", "x")).toThrow("not found");
    });

    it("uses 1-based inclusive line anchors and ranges", () => {
        expect(insertMarkdown("one\ntwo\nthree", { line: 2 }, "before", "new"))
            .toBe("one\nnew\ntwo\nthree");
        expect(insertMarkdown("one\ntwo", { line: 2 }, "after", "new"))
            .toBe("one\ntwo\nnew");
        expect(deleteMarkdownLines("one\ntwo\nthree\n", 2, 3)).toBe("one\n");
        expect(() => deleteMarkdownLines("one", 2, 2)).toThrow("outside");
    });

    it("updates frontmatter without touching the body and fails closed on invalid YAML", () => {
        const current = '---\n{"status":"draft","nested":{"safe":true}}\n---\n# Body\nText';
        const updated = transformFrontmatter(current, {
            path: "notes/a.md",
            set: { status: "done", tags: ["pa"] },
            delete: ["nested"],
        }, jsonFrontmatterCodec);
        expect(updated).toBe('---\n{"status":"done","tags":["pa"]}\n---\n# Body\nText');
        expect(() => transformFrontmatter("---\nnot-json\n---\nBody", {
            path: "notes/a.md",
            set: { status: "done" },
        }, jsonFrontmatterCodec)).toThrow(OperationsTransformError);
        expect(() => transformFrontmatter("---\n{}\nBody", {
            path: "notes/a.md",
            set: { status: "done" },
        }, jsonFrontmatterCodec)).toThrow("not closed");
    });

    it("preserves existing YAML-native values while restricting newly set values to JSON", () => {
        const created = new Date("2026-08-01T00:00:00.000Z");
        let serializedInput: Record<string, unknown> | undefined;
        const updated = transformFrontmatter("---\ncreated: 2026-08-01\n---\nBody", {
            path: "notes/a.md",
            set: { status: "done" },
        }, {
            parse: () => ({ created }),
            stringify: (value) => {
                serializedInput = value;
                return "created: 2026-08-01\nstatus: done";
            },
        });

        expect(serializedInput?.created).toBe(created);
        expect(updated).toBe("---\ncreated: 2026-08-01\nstatus: done\n---\nBody");
    });
});
