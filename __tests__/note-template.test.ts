import { describe, expect, it } from "@jest/globals";

import {
    buildNoteTemplateContext,
    DEFAULT_NOTE_TEMPLATE,
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

    it("replaces multiple occurrences of the same placeholder", () => {
        const template = "{{title}} / {{title}}";
        const result = renderNoteTemplate(template, baseContext);
        expect(result).toBe("2026-06-28 / 2026-06-28");
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

    it("pads single-digit months and days", () => {
        const timestamp = new Date(2026, 0, 5, 1, 2, 3);
        const ctx = buildNoteTemplateContext("note", timestamp, "", "#thoughts");
        expect(ctx.date).toBe("2026-01-05 01:02:03");
        expect(ctx.aliases).toBe("2026-01-05");
    });
});
