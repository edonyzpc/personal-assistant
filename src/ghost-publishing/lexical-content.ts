import { stableStringify } from "../ai-services/agent-utils";
import { stableHash } from "../pa/helpers";
import type { LexicalNodeJson } from "./types";

/** Resource identity is supplied by the current export or verified byte manifest. */
export interface LexicalContentIdentity {
    image(src: string): string;
    html?(html: string): string;
}

function mergeText(values: unknown[]): unknown[] {
    const result: unknown[] = [];
    const text = (value: unknown): value is { type: "text"; text: string } =>
        value !== null && typeof value === "object" && (value as { type?: string }).type === "text"
        && typeof (value as { text?: string }).text === "string";
    for (const value of values) {
        const previous = result[result.length - 1];
        if (text(previous) && text(value)) previous.text += value.text;
        else result.push(value);
    }
    return result;
}

function semanticValue(node: LexicalNodeJson, identity: LexicalContentIdentity): unknown {
    if (node.type === "extended-text" || node.type === "text") return { type: "text", text: node.text };
    if (node.type === "image") return {
        type: "image", identity: identity.image(String(node.src ?? "")),
        alt: node.alt ?? "", caption: node.caption ?? "", href: node.href ?? "",
    };
    if (node.type === "codeblock") return { type: "code", code: node.code, language: node.language };
    if (node.type === "html") return { type: "html", html: identity.html?.(String(node.html)) ?? node.html };
    if (node.type === "linebreak" || node.type === "horizontalrule") return { type: node.type };
    const kinds = new Set(["link", "autolink", "paragraph", "extended-heading", "heading", "extended-quote", "quote", "list", "listitem"]);
    // Unknown cards retain all fields. We cannot safely classify their changes as formatting.
    if (!kinds.has(node.type)) return node;
    const type = node.type === "heading" ? "extended-heading" : node.type === "quote" ? "extended-quote" : node.type;
    const result: Record<string, unknown> = { type };
    if (Array.isArray(node.children)) result.children = mergeText((node.children as LexicalNodeJson[]).map((child) => semanticValue(child, identity)));
    if (typeof node.tag === "string") result.tag = node.tag;
    if (node.type === "link" || node.type === "autolink") result.url = node.url;
    if (node.type === "list") { result.listType = node.listType; result.start = node.start; }
    if (node.type === "listitem" && typeof node.checked === "boolean") result.checked = node.checked;
    return result;
}

export function lexicalSemanticSignature(node: LexicalNodeJson, identity: LexicalContentIdentity): string {
    return stableHash(stableStringify(semanticValue(node, identity)));
}
