export interface NoteTemplateContext {
    title: string;
    date: string;
    modify: string;
    author: string;
    aliases: string;
    subject: string;
    content?: string;
}

export const DEFAULT_NOTE_TEMPLATE = `---
title: "{{title}}"
date: "{{date}}"
modify: "{{modify}}"
author: "{{author}}"
tags: []
aliases:
  - "{{aliases}}"
---
%%
subject: {{subject}}
status:
type:
publish: false
related: [[]]
%%
# {{title}}
`;

export const NOTE_TEMPLATE_CONTENT_MARKER = "<!-- pa:quick-capture-content -->";

const PLACEHOLDER_RE = /\{\{(title|date|modify|author|aliases|subject|content)\}\}/g;

function blankLineSeparator(text: string, newline: string): string {
    if (!text || /(?:\r?\n){2}$/.test(text)) return "";
    return /\r?\n$/.test(text) ? newline : newline + newline;
}

export function renderNoteTemplate(template: string, context: NoteTemplateContext): string {
    const newline = template.includes("\r\n") ? "\r\n" : "\n";
    return template.replace(PLACEHOLDER_RE, (_, key: keyof NoteTemplateContext) => {
        if (key !== "content") return context[key];
        const content = context.content ?? "";
        return content + blankLineSeparator(content, newline) + NOTE_TEMPLATE_CONTENT_MARKER;
    });
}

/** Locate exact standalone lines outside Markdown fenced code blocks. */
function findContentLines(text: string, target: string): number[] {
    const positions: number[] = [];
    let offset = 0;
    let fence: { character: string; length: number } | null = null;

    for (const line of text.split("\n")) {
        const value = line.endsWith("\r") ? line.slice(0, -1) : line;
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
        if (fence) {
            if (delimiter && delimiter[1][0] === fence.character &&
                delimiter[1].length >= fence.length && /^\s*$/.test(delimiter[2])) {
                fence = null;
            }
        } else if (delimiter && !(delimiter[1][0] === "`" && delimiter[2].includes("`"))) {
            fence = { character: delimiter[1][0], length: delimiter[1].length };
        } else if (value === target) {
            positions.push(offset);
        }
        offset += line.length + 1;
    }
    return positions;
}

/** Insert without rewriting existing text; ambiguous locations use the caller's append fallback. */
export function insertNoteTemplateContent(
    existingContent: string,
    rawText: string,
    renderedEmptyTemplate?: string,
): string | null {
    if (rawText.includes(NOTE_TEMPLATE_CONTENT_MARKER)) return null;

    const markerCount = existingContent.split(NOTE_TEMPLATE_CONTENT_MARKER).length - 1;
    let positions: number[];
    if (markerCount > 0) {
        if (markerCount !== 1) return null;
        positions = findContentLines(existingContent, NOTE_TEMPLATE_CONTENT_MARKER);
    } else {
        // Old Templater notes have no marker. Match only the configured template's
        // first footer line, leaving any user-edited footer content intact.
        if (!renderedEmptyTemplate ||
            renderedEmptyTemplate.split(NOTE_TEMPLATE_CONTENT_MARKER).length !== 2) return null;
        const templateMarkers = findContentLines(renderedEmptyTemplate, NOTE_TEMPLATE_CONTENT_MARKER);
        if (templateMarkers.length !== 1) return null;
        const footer = renderedEmptyTemplate.slice(templateMarkers[0] + NOTE_TEMPLATE_CONTENT_MARKER.length);
        const firstFooterLine = footer.split(/\r?\n/).find(line => line.trim().length > 0);
        if (!firstFooterLine || firstFooterLine.trim().length < 4) return null;
        positions = findContentLines(existingContent, firstFooterLine);
    }
    if (positions.length !== 1) return null;
    if (!rawText) return existingContent;

    const insertionPoint = positions[0];
    const prefix = existingContent.slice(0, insertionPoint);
    const suffix = existingContent.slice(insertionPoint);
    const newline = existingContent.includes("\r\n") ? "\r\n" : "\n";
    return prefix + blankLineSeparator(prefix, newline) + rawText +
        blankLineSeparator(rawText, newline) + suffix;
}

function formatDateTime(d: Date): string {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}

function formatDate(d: Date): string {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
}

export function buildNoteTemplateContext(
    fileName: string,
    timestamp: Date,
    author: string,
    subject: string,
    modifiedAt: Date = timestamp,
): NoteTemplateContext {
    const dateTime = formatDateTime(timestamp);
    return {
        title: fileName,
        date: dateTime,
        modify: formatDateTime(modifiedAt),
        author,
        aliases: formatDate(timestamp),
        subject,
    };
}
