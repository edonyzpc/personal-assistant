import { describe, expect, it } from "@jest/globals";
import { parseGhostCommand, resolveGhostRequestedNote } from "../src/ghost-publishing/entry";

const files = ["A.md", "notes/B.md", "one/Duplicate.md", "two/Duplicate.md"].map(path => ({
    path, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md",
}));
const host = {
    getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
    getMarkdownFiles: () => files,
    getFirstLinkpathDest: (name: string) => files.find(file => file.basename === name.replace(/\.md$/, "")) ?? null,
};
describe("Ghost explicit Chat entry", () => {
    it("keeps the captured note for an omitted locator and verifies submitted locators without prose matching", () => {
        expect(resolveGhostRequestedNote({ input: {}, userText: "@blog2ghost 将当前笔记发布到ghost平台", capturedPath: "A.md", host })).toBe("A.md");
        expect(resolveGhostRequestedNote({ input: { path: "A.md" }, userText: "@blog2ghost 将当前笔记发布到ghost平台", capturedPath: "A.md", host })).toBe("A.md");
        expect(resolveGhostRequestedNote({ input: { path: "A.md" }, userText: "@blog2ghost 当前笔记发不到ghost平台", capturedPath: "A.md", host })).toBe("A.md");
        expect(resolveGhostRequestedNote({ input: { path: "A.md" }, userText: "@blog2ghost publish the current note", capturedPath: "A.md", host })).toBe("A.md");
        expect(resolveGhostRequestedNote({ input: { path: "notes/B.md" }, userText: "@blog2ghost 发布我刚提到的那篇，不要用当前笔记", capturedPath: "A.md", host })).toBe("notes/B.md");
        expect(resolveGhostRequestedNote({ input: { path: "notes/B.md" }, userText: "@blog2ghost 发布 notes/B.md", capturedPath: "A.md", host })).toBe("notes/B.md");
        expect(resolveGhostRequestedNote({ input: { name: "B" }, userText: "@blog2ghost 发布 B", capturedPath: "A.md", host })).toBe("notes/B.md");
    });
    it("rejects only structural target failures at the file boundary", () => {
        expect(() => resolveGhostRequestedNote({ input: { name: "Duplicate" }, userText: "@blog2ghost 发布 Duplicate", capturedPath: "A.md", host })).toThrow("target-ambiguous");
        expect(() => resolveGhostRequestedNote({ input: { path: "missing/B.md" }, userText: "@blog2ghost 发布 B", capturedPath: "A.md", host })).toThrow("target-missing");
        expect(() => resolveGhostRequestedNote({ input: {}, userText: "@blog2ghost 发布当前笔记", capturedPath: "missing.md", host })).toThrow("target-missing");
        expect(() => resolveGhostRequestedNote({ input: {}, userText: "正文里提到 @blog2ghost", capturedPath: "A.md", host })).toThrow("request-required");
    });
    it("does not intercept existing actions, skills or an inline mention", () => {
        for (const prompt of ["@Writing 写文章", "@CreateImage 封面", "#blog2ghost", "讨论 @blog2ghost"]) expect(parseGhostCommand(prompt)).toBeNull();
        expect(parseGhostCommand("@BLOG2GHOST 发布当前笔记")).toBe("发布当前笔记");
    });
    it("does not classify the Agent's structured target from request wording", () => {
        for (const userText of ["@blog2ghost 使用 PA 发布当前笔记", "@blog2ghost 发布 BACKUP", "@blog2ghost 不要发布当前笔记，发布 notes/B.md",
            "@blog2ghost 发布 old/notes/B.md", "@blog2ghost 发布 [[Other|A]]"]) {
            expect(resolveGhostRequestedNote({ input: { name: "A" }, userText, capturedPath: "notes/B.md", host })).toBe("A.md");
            expect(resolveGhostRequestedNote({ input: { path: "notes/B.md" }, userText, capturedPath: "A.md", host })).toBe("notes/B.md");
        }
    });
});
