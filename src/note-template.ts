export interface NoteTemplateContext {
    title: string;
    date: string;
    modify: string;
    author: string;
    aliases: string;
    subject: string;
}

export const DEFAULT_NOTE_TEMPLATE = `---
title: {{title}}
date: {{date}}
modify: {{modify}}
author: {{author}}
tags: []
aliases:
  - {{aliases}}
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

const PLACEHOLDER_RE = /\{\{(title|date|modify|author|aliases|subject)\}\}/g;

export function renderNoteTemplate(template: string, context: NoteTemplateContext): string {
    return template.replace(PLACEHOLDER_RE, (_, key: keyof NoteTemplateContext) => context[key]);
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
): NoteTemplateContext {
    const dateTime = formatDateTime(timestamp);
    return {
        title: fileName,
        date: dateTime,
        modify: dateTime,
        author,
        aliases: formatDate(timestamp),
        subject,
    };
}
