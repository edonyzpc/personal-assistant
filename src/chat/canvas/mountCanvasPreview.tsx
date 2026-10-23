import type { Component } from "obsidian";
import { createRoot } from "react-dom/client";
import { CanvasErrorBoundary, CanvasPreview, type CanvasPreviewProps } from "./CanvasPreview";

export interface CanvasPreviewMountHandle {
    unmount(): void;
    update(props: Omit<CanvasPreviewProps, "owner">): void;
}

export function mountCanvasPreview(
    pre: HTMLElement,
    owner: Component,
    props: Omit<CanvasPreviewProps, "owner">,
): CanvasPreviewMountHandle | null {
    const parent = pre.parentElement;
    if (!parent) return null;
    const host = pre.ownerDocument.win.createDiv();
    host.className = "pa-chat-canvas-host";
    parent.insertBefore(host, pre);
    let mounted = true;
    const root = createRoot(host);
    const update = (next: Omit<CanvasPreviewProps, "owner">) => {
        if (!mounted) return;
        root.render(<CanvasErrorBoundary locale={next.locale} raw={next.block.raw}>
            <CanvasPreview {...next} owner={owner} />
        </CanvasErrorBoundary>);
    };
    try {
        update(props);
    } catch {
        root.unmount();
        host.remove();
        return null;
    }
    pre.remove();
    const cleanup = () => {
        if (!mounted) return;
        mounted = false;
        root.unmount();
        host.remove();
    };
    owner.register(cleanup);
    return { unmount: cleanup, update };
}
