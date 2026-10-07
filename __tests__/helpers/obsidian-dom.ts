type TestDocumentCreation = {
    createElement?: (tag: string) => unknown;
    createElementNS?: (namespace: string, tag: string) => unknown;
    createDocumentFragment?: () => unknown;
    win?: unknown;
};

/** Add Obsidian's detached creation helpers to a test document's own window. */
export function installObsidianDocumentHelpers<T extends TestDocumentCreation>(
    document: T,
): T & { win: Window } {
    const win = Object.assign(document.win ?? {}, {
        createEl: (tag: string) => document.createElement!(tag),
        createDiv: () => document.createElement!("div"),
        createSpan: () => document.createElement!("span"),
        createSvg: (tag: string) => document.createElementNS!("http://www.w3.org/2000/svg", tag),
        createFragment: () => document.createDocumentFragment!(),
    });
    return Object.assign(document, { win }) as T & { win: Window };
}
