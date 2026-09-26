import { describe, expect, it } from "@jest/globals";

import {
    buildNoteTemplateContext,
    DEFAULT_NOTE_TEMPLATE,
    insertNoteTemplateContent,
    NOTE_TEMPLATE_CONTENT_MARKER,
    renderNoteTemplate,
    type NoteTemplateContext,
} from "../src/note-template";

describe("renderNoteTemplate", () => {
    const baseContext: NoteTemplateContext = {
        title: "2026-06-28",
        date: "2026-06-28 09:07:00",
        modify: "2026-06-28 09:07:00",
        author: "edony.zpc",
        aliases: "2026-06-28",
        subject: "#capture",
    };

    it("replaces all placeholders in the default template", () => {
        const result = renderNoteTemplate(DEFAULT_NOTE_TEMPLATE, baseContext);
        expect(result).toContain('title: "2026-06-28"');
        expect(result).toContain('date: "2026-06-28 09:07:00"');
        expect(result).toContain('modify: "2026-06-28 09:07:00"');
        expect(result).toContain('author: "edony.zpc"');
        expect(result).toContain('  - "2026-06-28"');
        expect(result).toContain("subject: #capture");
        expect(result).toContain("# 2026-06-28");
        expect(result).not.toContain("{{");
    });

    it("handles empty author", () => {
        const ctx = { ...baseContext, author: "" };
        const result = renderNoteTemplate(DEFAULT_NOTE_TEMPLATE, ctx);
        expect(result).toContain('author: ""');
        expect(result).not.toContain("{{author}}");
    });

    it("uses custom template when provided", () => {
        const custom = "---\ntitle: {{title}}\nauthor: {{author}}\n---\n# {{title}}\n";
        const result = renderNoteTemplate(custom, baseContext);
        expect(result).toBe("---\ntitle: 2026-06-28\nauthor: edony.zpc\n---\n# 2026-06-28\n");
    });

    it("leaves unknown placeholders verbatim", () => {
        const template = "{{title}} {{unknown}} {{date}}";
        const result = renderNoteTemplate(template, baseContext);
        expect(result).toBe("2026-06-28 {{unknown}} 2026-06-28 09:07:00");
    });

    it("preserves Markdown and placeholder text in the content slot before the footer", () => {
        const content = "# Heading\n\n- item\n  - nested\n\n```md\n{{title}}\n```\n";
        const result = renderNoteTemplate("# {{title}}\n\n{{content}}\n\n**关键词总结：**", {
            ...baseContext, content,
        });
        expect(result).toBe(`# 2026-06-28\n\n${content}\n${NOTE_TEMPLATE_CONTENT_MARKER}\n\n**关键词总结：**`);
    });

    it("retains the insertion marker when content is missing or empty", () => {
        expect(renderNoteTemplate("{{content}}", baseContext)).toBe(NOTE_TEMPLATE_CONTENT_MARKER);
        expect(renderNoteTemplate("{{content}}", { ...baseContext, content: "" })).toBe(NOTE_TEMPLATE_CONTENT_MARKER);
    });

    it("leaves templates without a content slot unchanged even when content is supplied", () => {
        expect(renderNoteTemplate(DEFAULT_NOTE_TEMPLATE, { ...baseContext, content: "capture" }))
            .toBe(renderNoteTemplate(DEFAULT_NOTE_TEMPLATE, baseContext));
    });
});

describe("insertNoteTemplateContent", () => {
    const footer = "#跟周至的一场超时空对话\n\n**关键词总结：** 已有总结\n";
    const emptyTemplate = `# Note\n\n${NOTE_TEMPLATE_CONTENT_MARKER}\n\n#跟周至的一场超时空对话\n\n**关键词总结：**\n`;

    it("inserts successive captures before the marker while preserving the footer", () => {
        const original = `# Note\n\n${NOTE_TEMPLATE_CONTENT_MARKER}\n\n${footer}`;
        const first = insertNoteTemplateContent(original, "- first\n  - nested")!;
        const second = insertNoteTemplateContent(first, "```md\n{{title}}\n```\n\n")!;
        expect(second).toBe(`# Note\n\n- first\n  - nested\n\n\`\`\`md\n{{title}}\n\`\`\`\n\n${NOTE_TEMPLATE_CONTENT_MARKER}\n\n${footer}`);
    });

    it("preserves CRLF, leading whitespace and trailing blank lines in raw text", () => {
        const original = `# Note\r\n${NOTE_TEMPLATE_CONTENT_MARKER}\r\nFooter`;
        const content = "  indented\r\n\r\n\r\n";
        expect(insertNoteTemplateContent(original, content))
            .toBe(`# Note\r\n\r\n${content}${NOTE_TEMPLATE_CONTENT_MARKER}\r\nFooter`);
    });

    it("leaves the note intact for an empty capture", () => {
        expect(insertNoteTemplateContent(emptyTemplate, "")).toBe(emptyTemplate);
    });

    it.each([
        "# Note\nNo marker",
        `${NOTE_TEMPLATE_CONTENT_MARKER}\n${NOTE_TEMPLATE_CONTENT_MARKER}`,
        `inline ${NOTE_TEMPLATE_CONTENT_MARKER}`,
        `    ${NOTE_TEMPLATE_CONTENT_MARKER}`,
        `\`\`\`md\n${NOTE_TEMPLATE_CONTENT_MARKER}\n\`\`\``,
        `~~~md\n${NOTE_TEMPLATE_CONTENT_MARKER}\n~~~`,
        `\`\`\`\`md\n\`\`\`\n${NOTE_TEMPLATE_CONTENT_MARKER}\n\`\`\`\``,
    ])("returns null for absent, ambiguous or code-only markers: %s", original => {
        expect(insertNoteTemplateContent(original, "capture")).toBeNull();
    });

    it("does not let a marker in captured text create an ambiguous future location", () => {
        expect(insertNoteTemplateContent(emptyTemplate, `example\n${NOTE_TEMPLATE_CONTENT_MARKER}`)).toBeNull();
    });

    it("accepts a marker after a properly closed code fence", () => {
        const original = `\`\`\`md\ntext\n\`\`\`\n\n${NOTE_TEMPLATE_CONTENT_MARKER}`;
        expect(insertNoteTemplateContent(original, "capture"))
            .toBe(`\`\`\`md\ntext\n\`\`\`\n\ncapture\n\n${NOTE_TEMPLATE_CONTENT_MARKER}`);
    });

    it("inserts before the unique configured footer in old Templater notes without rewriting it", () => {
        const original = `---\nmodify: original timestamp\n---\n# Note\n\nold content\n\n${footer}`;
        const first = insertNoteTemplateContent(original, "new **Markdown**", emptyTemplate)!;
        const second = insertNoteTemplateContent(first, "another", emptyTemplate)!;
        expect(second).toBe(`---\nmodify: original timestamp\n---\n# Note\n\nold content\n\nnew **Markdown**\n\nanother\n\n${footer}`);
    });

    it("ignores footer examples inside fenced code", () => {
        const original = `~~~md\n${footer}~~~\n\n${footer}`;
        expect(insertNoteTemplateContent(original, "capture", emptyTemplate))
            .toBe(`~~~md\n${footer}~~~\n\ncapture\n\n${footer}`);
    });

    it.each([
        "No configured footer\n",
        `${footer}\n${footer}`,
        `\`\`\`md\n${footer}\`\`\``,
        `inline ${footer}`,
    ])("falls back when the old-note footer is missing, ambiguous or not standalone: %s", original => {
        expect(insertNoteTemplateContent(original, "capture", emptyTemplate)).toBeNull();
    });

    it("does not guess from a template without a unique valid slot or substantive footer", () => {
        for (const template of ["# Note", NOTE_TEMPLATE_CONTENT_MARKER, `${NOTE_TEMPLATE_CONTENT_MARKER}\n#`,
            `${NOTE_TEMPLATE_CONTENT_MARKER}\n${NOTE_TEMPLATE_CONTENT_MARKER}\n${footer}`]) {
            expect(insertNoteTemplateContent(footer, "capture", template)).toBeNull();
        }
    });
});

describe("buildNoteTemplateContext", () => {
    it("formats date and time correctly", () => {
        const timestamp = new Date(2026, 5, 28, 9, 7, 15);
        const ctx = buildNoteTemplateContext("2026-06-28", timestamp, "edony.zpc", "#capture");
        expect(ctx.title).toBe("2026-06-28");
        expect(ctx.date).toBe("2026-06-28 09:07:15");
        expect(ctx.modify).toBe("2026-06-28 09:07:15");
        expect(ctx.author).toBe("edony.zpc");
        expect(ctx.aliases).toBe("2026-06-28");
        expect(ctx.subject).toBe("#capture");
    });

    it("maps creation and modification times independently for an existing file", () => {
        const ctx = buildNoteTemplateContext("note", new Date(2026, 0, 5, 1, 2, 3), "", "#thoughts",
            new Date(2026, 8, 22, 14, 30, 1));
        expect(ctx.date).toBe("2026-01-05 01:02:03");
        expect(ctx.aliases).toBe("2026-01-05");
        expect(ctx.modify).toBe("2026-09-22 14:30:01");
    });
});
