import { Component, MarkdownRenderer, TFile, type App } from "obsidian";
import React, {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";
import { pluginT, type PluginLocale } from "../../locales/plugin";
import { splitShareCardVaultReference } from "../../share-card/share-card-resources";
import { deriveCanvasTitle, type CanvasEdge, type CanvasFenceBlock, type CanvasNode } from "./canvas-blocks";
import { canvasEmbedMarkdown, type CanvasPreviewResourcePort, type CanvasResolvedResource, type PreparedCanvasMarkdown } from "./canvas-resource-port";
import type { CanvasArtifactService, CanvasArtifactSource } from "./canvas-artifact-service";
import type { CanvasArtifactRecord } from "./types";

export interface CanvasPreviewProps {
    app: App;
    locale: PluginLocale;
    owner: Component;
    block: CanvasFenceBlock;
    capturedSourcePath: string;
    conversationId: string | null;
    turnIndex: number;
    messageId?: string;
    userMessageSourceHash?: string;
    messageContent: string;
    records?: CanvasArtifactRecord[];
    recordsInvalid?: boolean;
    resourcePort?: CanvasPreviewResourcePort;
    artifactService?: CanvasArtifactService;
    isCurrent(this: void): boolean;
    onSettingsChanged?(this: void, listener: () => void | Promise<void>): () => void;
    isVisible?(this: void): boolean;
    onDisplayResume?(this: void, listener: () => void): () => void;
}

type DisplayGate = (action: () => void) => () => void;

interface ViewBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

function canvasT(key: string, locale: PluginLocale, params?: Record<string, string | number>): string {
    return pluginT(key as never, locale, params);
}

function nodeTitle(node: CanvasNode, locale: PluginLocale): string {
    if (node.label?.trim()) return node.label.trim();
    if (node.text?.trim()) return node.text.split(/\r?\n/, 1)[0].replace(/^#+\s*/, "").trim();
    if (node.file) return splitShareCardVaultReference(node.file).linkpath.split("/").pop() ?? node.file;
    if (node.url) return node.url;
    return canvasT("plugin.chat.canvas.untitledNode", locale);
}

function documentTitle(block: CanvasFenceBlock, locale: PluginLocale): string {
    if (block.status.kind !== "preview") return canvasT("plugin.chat.canvas.generating", locale);
    return block.status.document.nodes.find(node => node.label?.trim())?.label?.trim()
        ?? block.status.document.nodes.find(node => node.text?.trim())?.text?.split(/\r?\n/, 1)[0].replace(/^#+\s*/, "").trim()
        ?? canvasT("plugin.chat.canvas.untitled", locale);
}

function initialViewBox(block: CanvasFenceBlock): ViewBox {
    if (block.status.kind !== "preview") return { x: 0, y: 0, width: 800, height: 500 };
    const nodes = block.status.document.nodes;
    if (nodes.length === 0) return { x: 0, y: 0, width: 800, height: 500 };
    const minX = Math.min(...nodes.map(node => node.x));
    const minY = Math.min(...nodes.map(node => node.y));
    const maxX = Math.max(...nodes.map(node => node.x + node.width));
    const maxY = Math.max(...nodes.map(node => node.y + node.height));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function colorClass(color: string | undefined): string {
    return color && /^[1-6]$/.test(color) ? ` pa-chat-canvas-color-${color}` : "";
}

function colorStyle(color: string | undefined): CSSProperties | undefined {
    return color && /^#[0-9a-f]{6}$/i.test(color)
        ? { "--pa-canvas-color": color } as CSSProperties : undefined;
}

function anchor(node: CanvasNode, side: string | undefined): { x: number; y: number } {
    const x = node.x + node.width / 2;
    const y = node.y + node.height / 2;
    if (side === "top") return { x, y: node.y };
    if (side === "bottom") return { x, y: node.y + node.height };
    if (side === "left") return { x: node.x, y };
    if (side === "right") return { x: node.x + node.width, y };
    return { x, y };
}

function edgeGeometry(nodes: Map<string, CanvasNode>, edge: CanvasEdge): {
    path: string;
    end: { x: number; y: number };
    angle: number;
    start: { x: number; y: number };
    startAngle: number;
} | null {
    const from = nodes.get(edge.fromNode);
    const to = nodes.get(edge.toNode);
    if (!from || !to) return null;
    const horizontal = Math.abs(to.x + to.width / 2 - from.x - from.width / 2)
        >= Math.abs(to.y + to.height / 2 - from.y - from.height / 2);
    const fromSide = edge.fromSide ?? (horizontal ? (to.x >= from.x ? "right" : "left") : (to.y >= from.y ? "bottom" : "top"));
    const toSide = edge.toSide ?? (horizontal ? (to.x >= from.x ? "left" : "right") : (to.y >= from.y ? "top" : "bottom"));
    const start = anchor(from, fromSide);
    const end = anchor(to, toSide);
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const bend = Math.max(40, Math.min(160, dx * 0.25, dy * 0.5));
    const signX = end.x >= start.x ? 1 : -1;
    const signY = end.y >= start.y ? 1 : -1;
    const mid1 = fromSide === "top" || fromSide === "bottom"
        ? { x: start.x, y: start.y + bend * signY }
        : { x: start.x + bend * signX, y: start.y };
    const mid2 = toSide === "top" || toSide === "bottom"
        ? { x: end.x, y: end.y - bend * signY }
        : { x: end.x - bend * signX, y: end.y };
    return {
        path: `M ${start.x} ${start.y} C ${mid1.x} ${mid1.y} ${mid2.x} ${mid2.y} ${end.x} ${end.y}`,
        end,
        angle: Math.atan2(end.y - mid2.y, end.x - mid2.x),
        start,
        startAngle: Math.atan2(start.y - mid1.y, start.x - mid1.x),
    };
}

function arrowPoints(point: { x: number; y: number }, angle: number): string {
    return [
        `${point.x},${point.y}`,
        `${point.x + Math.cos(angle + Math.PI * 0.82) * 12},${point.y + Math.sin(angle + Math.PI * 0.82) * 12}`,
        `${point.x + Math.cos(angle - Math.PI * 0.82) * 12},${point.y + Math.sin(angle - Math.PI * 0.82) * 12}`,
    ].join(" ");
}

function NativeMarkdownBody(props: {
    app: App;
    prepared: PreparedCanvasMarkdown;
    locale: PluginLocale;
    whenVisible: DisplayGate;
    isCurrent(this: void): boolean;
}): ReactNode {
    const hostRef = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let current = true;
        let settled = false;
        const owner = new Component();
        owner.load();
        setFailed(false);
        // Each run owns its buffer. A late renderer can only mutate that detached buffer.
        const buffer = host.ownerDocument.win.createDiv();
        const live = () => current && props.isCurrent();
        const waits = new Set<() => void>();
        const visible = () => new Promise<boolean>(resolve => {
            const cancel = props.whenVisible(() => resolve(live()));
            waits.add(() => { cancel(); resolve(false); });
        });
        const render = async (target: HTMLElement, prepared: PreparedCanvasMarkdown): Promise<void> => {
            if (!live() || !await visible()) return;
            const body = target.ownerDocument.win.createDiv();
            target.appendChild(body);
            const onLink = (event: MouseEvent) => {
                const element = event.target && (event.target as Node).nodeType === 1 ? event.target as Element : null;
                const link = element?.closest<HTMLAnchorElement>("a.internal-link");
                if (!link || !body.contains(link) || !live()) return;
                const href = link.getAttribute("data-href") ?? link.getAttribute("href");
                if (!href) return;
                event.preventDefault();
                event.stopPropagation();
                void props.app.workspace.openLinkText(href, prepared.sourcePath,
                    event.metaKey || event.ctrlKey ? "tab" : false);
            };
            body.addEventListener("click", onLink);
            owner.register(() => body.removeEventListener("click", onLink));
            await MarkdownRenderer.render(props.app, prepared.markdown, body, prepared.sourcePath, owner);
            if (!live()) return;
            for (const slot of prepared.slots) {
                const targets = Array.from(body.querySelectorAll<HTMLElement>("[data-pa-canvas-slot]"))
                    .filter(element => element.getAttribute("data-pa-canvas-slot") === slot.marker);
                if (targets.length !== 1) throw new Error("Canvas resource slot was not preserved by the Markdown renderer.");
                const slotTarget = targets[0];
                if (slot.kind === "markdown") await render(slotTarget, slot.prepared);
                else {
                    slotTarget.classList.add("pa-chat-canvas-placeholder");
                    slotTarget.textContent = canvasT("plugin.chat.canvas.resourceUnavailable", props.locale);
                }
                if (!live()) return;
            }
        };
        void render(buffer, props.prepared).then(async () => {
            if (live() && await visible()) host.replaceChildren(buffer);
        })
            .catch(() => {
                if (live()) {
                    buffer.replaceChildren();
                    setFailed(true);
                }
            }).finally(() => {
                settled = true;
                if (!current) owner.unload();
            });
        return () => {
            current = false;
            for (const cancel of waits) cancel();
            // Native post-processors may register cleanup until their render settles.
            if (settled) owner.unload();
            buffer.remove();
        };
    }, [props.app, props.prepared, props.locale, props.isCurrent, props.whenVisible]);
    return <div className="pa-chat-canvas-native-markdown">
        {failed ? <div className="pa-chat-canvas-placeholder" role="status">
            {canvasT("plugin.chat.canvas.markdownUnavailable", props.locale)}
        </div> : null}
        <div ref={hostRef} />
    </div>;
}

function GatedMarkdown(props: {
    app: App;
    port?: CanvasPreviewResourcePort;
    markdown: string;
    sourcePath: string;
    locale: PluginLocale;
    whenVisible: DisplayGate;
    owner: Component;
    isCurrent(this: void): boolean;
    policyRevision: number;
}): ReactNode {
    const [prepared, setPrepared] = useState<PreparedCanvasMarkdown | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!props.port) {
            setPrepared(null);
            setFailed(true);
            return;
        }
        const controller = new AbortController();
        let current = true;
        setPrepared(null);
        setFailed(false);
        let cancelPublish: (() => void) | undefined;
        const cancelStart = props.whenVisible(() => { void props.port!.prepareMarkdown({
            markdown: props.markdown,
            sourcePath: props.sourcePath,
            owner: props.owner,
            signal: controller.signal,
            isCurrent: () => current && props.isCurrent(),
        }).then(result => {
            if (!current || controller.signal.aborted || !props.isCurrent()) return;
            cancelPublish = props.whenVisible(() => {
                if (current && props.isCurrent()) setPrepared(result);
            });
        }).catch(() => {
            if (current) setFailed(true);
        }); });
        return () => {
            current = false;
            cancelStart();
            cancelPublish?.();
            controller.abort();
        };
    }, [props.port, props.markdown, props.sourcePath, props.owner, props.isCurrent, props.policyRevision, props.whenVisible]);
    if (failed || prepared === null) {
        return <div className="pa-chat-canvas-placeholder" role="status">
            {failed
                ? canvasT("plugin.chat.canvas.resourceUnavailable", props.locale)
                : canvasT("plugin.chat.canvas.preparing", props.locale)}
        </div>;
    }
    return <NativeMarkdownBody app={props.app} prepared={prepared} locale={props.locale}
        whenVisible={props.whenVisible} isCurrent={props.isCurrent} />;
}

function HostEmbed(props: {
    app: App;
    file: TFile;
    reference: string;
    sourcePath: string;
    locale: PluginLocale;
    whenVisible: DisplayGate;
    isCurrent(this: void): boolean;
}): ReactNode {
    const { subpath } = splitShareCardVaultReference(props.reference);
    const prepared = useMemo<PreparedCanvasMarkdown | null>(() => {
        const markdown = canvasEmbedMarkdown(props.app, props.file, props.sourcePath, subpath);
        return markdown === null ? null : { markdown, sourcePath: props.sourcePath, unavailableCount: 0, slots: [] };
    }, [props.app, props.file, props.sourcePath, subpath]);
    if (!prepared) return <div className="pa-chat-canvas-placeholder" role="status">
        {canvasT("plugin.chat.canvas.embedUnavailable", props.locale)}
    </div>;
    return <div className="pa-chat-canvas-host-embed">
        <NativeMarkdownBody app={props.app} prepared={prepared} locale={props.locale}
            whenVisible={props.whenVisible} isCurrent={props.isCurrent} />
    </div>;
}

function CanvasResource(props: {
    app: App;
    port?: CanvasPreviewResourcePort;
    owner: Component;
    reference: string;
    sourcePath: string;
    locale: PluginLocale;
    whenVisible: DisplayGate;
    backgroundStyle?: CanvasNode["backgroundStyle"];
    isCurrent(this: void): boolean;
    policyRevision: number;
}): ReactNode {
    const [resource, setResource] = useState<CanvasResolvedResource | null>(null);
    useEffect(() => {
        if (!props.port) {
            setResource({ status: "unavailable" });
            return;
        }
        const controller = new AbortController();
        let current = true;
        setResource(null);
        let cancelPublish: (() => void) | undefined;
        const cancelStart = props.whenVisible(() => { void props.port!.resolve({
            reference: props.reference,
            sourcePath: props.sourcePath,
            owner: props.owner,
            signal: controller.signal,
            isCurrent: () => current && props.isCurrent(),
        }).then(value => {
            if (current && !controller.signal.aborted && props.isCurrent()) {
                cancelPublish = props.whenVisible(() => {
                    if (current && props.isCurrent()) setResource(value);
                });
            }
        }).catch(() => {
            if (current) setResource({ status: "unavailable" });
        }); });
        return () => {
            current = false;
            cancelStart();
            cancelPublish?.();
            controller.abort();
        };
    }, [props.port, props.owner, props.reference, props.sourcePath, props.isCurrent, props.policyRevision, props.whenVisible]);
    if (!resource) return <div className="pa-chat-canvas-placeholder" role="status">
        {canvasT("plugin.chat.canvas.preparing", props.locale)}
    </div>;
    if (resource.status === "unavailable") return <div className="pa-chat-canvas-placeholder" role="status">
        {canvasT("plugin.chat.canvas.resourceUnavailable", props.locale)}
    </div>;
    if (resource.status === "markdown") {
        return <GatedMarkdown app={props.app} port={props.port} markdown={resource.markdown}
            sourcePath={resource.file.path} owner={props.owner} isCurrent={props.isCurrent}
            locale={props.locale} whenVisible={props.whenVisible} policyRevision={props.policyRevision} />;
    }
    if (props.backgroundStyle && /^(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(resource.file.extension)) {
        return <div className={`pa-chat-canvas-background pa-chat-canvas-background-${props.backgroundStyle}`}
            style={{ backgroundImage: `url(${JSON.stringify(props.app.vault.getResourcePath(resource.file))})` }} />;
    }
    return <HostEmbed app={props.app} file={resource.file} reference={props.reference}
        locale={props.locale} whenVisible={props.whenVisible} sourcePath={props.sourcePath} isCurrent={props.isCurrent} />;
}

function CanvasNodeBody(props: {
    app: App;
    node: CanvasNode;
    owner: Component;
    port?: CanvasPreviewResourcePort;
    sourcePath: string | null;
    locale: PluginLocale;
    whenVisible: DisplayGate;
    isCurrent(this: void): boolean;
    policyRevision: number;
}): ReactNode {
    if (props.node.type === "text") {
        // Native Canvas text has no source file. Keep its host lookup context
        // independent of the editable save destination and preserve the JSON.
        return <GatedMarkdown app={props.app} port={props.port} markdown={props.node.text ?? ""}
            sourcePath="" owner={props.owner} isCurrent={props.isCurrent}
            locale={props.locale} whenVisible={props.whenVisible} policyRevision={props.policyRevision} />;
    }
    if (props.sourcePath === null) return <div className="pa-chat-canvas-placeholder" role="status">
        {canvasT("plugin.chat.canvas.pathInvalid", props.locale)}
    </div>;
    if (props.node.type === "file" && props.node.file) {
        return <CanvasResource app={props.app} port={props.port} owner={props.owner}
            reference={`${props.node.file}${props.node.subpath ?? ""}`} sourcePath={props.sourcePath} isCurrent={props.isCurrent}
            locale={props.locale} whenVisible={props.whenVisible} policyRevision={props.policyRevision} />;
    }
    if (props.node.type === "link" && props.node.url) {
        const safeUrl = /^https?:\/\//i.test(props.node.url) ? props.node.url : undefined;
        return <div className="pa-chat-canvas-link-card">
            <span className="pa-chat-canvas-link-label">{nodeTitle(props.node, props.locale)}</span>
            {safeUrl
                ? <a href={safeUrl} target="_blank" rel="noreferrer noopener">{safeUrl}</a>
                : <span>{props.node.url}</span>}
        </div>;
    }
    if (props.node.type === "group" && props.node.background) {
        return <CanvasResource app={props.app} port={props.port} owner={props.owner}
            reference={props.node.background} sourcePath={props.sourcePath} isCurrent={props.isCurrent}
            locale={props.locale} whenVisible={props.whenVisible} backgroundStyle={props.node.backgroundStyle ?? "cover"} policyRevision={props.policyRevision} />;
    }
    return <div className="pa-chat-canvas-placeholder" role="status">
        {canvasT("plugin.chat.canvas.unknownNode", props.locale)}
    </div>;
}

export class CanvasErrorBoundary extends React.Component<{ children: ReactNode; locale: PluginLocale; raw: string }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }
    render(): ReactNode {
        if (this.state.failed) {
            return <div className="pa-chat-canvas-error" role="status">
                {canvasT("plugin.chat.canvas.renderFailed", this.props.locale)}
                <pre><code>{this.props.raw}</code></pre>
            </div>;
        }
        return this.props.children;
    }
}

export function CanvasPreview(props: CanvasPreviewProps): ReactNode {
    const viewportTitleId = useId();
    const document = props.block.status.kind === "preview" ? props.block.status.document : undefined;
    const initialBox = useMemo(() => initialViewBox(props.block), [props.block]);
    const [viewBox, setViewBox] = useState<ViewBox>(initialBox);
    const [jsonOpen, setJsonOpen] = useState(false);
    const [policyRevision, setPolicyRevision] = useState(0);
    const mountedRef = useRef(true);
    const propsRef = useRef(props);
    propsRef.current = props;
    const currentSource = useCallback(() => mountedRef.current && propsRef.current.isCurrent(), []);
    const isViewCurrent = useCallback(() => currentSource() && (propsRef.current.isVisible?.() ?? true), [currentSource]);
    const waitingForDisplay = useRef(new Set<() => void>());
    const whenVisible = useCallback<DisplayGate>(action => {
        if (isViewCurrent()) action();
        else waitingForDisplay.current.add(action);
        return () => { waitingForDisplay.current.delete(action); };
    }, [isViewCurrent]);
    useEffect(() => props.onDisplayResume?.(() => {
        if (!isViewCurrent()) return;
        for (const action of Array.from(waitingForDisplay.current)) {
            waitingForDisplay.current.delete(action);
            action();
        }
    }), [props.onDisplayResume, isViewCurrent]);
    const source = useMemo<CanvasArtifactSource>(() => ({
        conversationId: props.conversationId ?? "",
        turnIndex: props.turnIndex,
        ...(props.messageId ? { messageId: props.messageId } : {}),
        ...(props.userMessageSourceHash ? { userMessageSourceHash: props.userMessageSourceHash } : {}),
        messageContent: props.messageContent,
        raw: props.block.raw,
        block: {
            language: props.block.language,
            startLine: props.block.sourceStartLine,
            sourceHash: props.block.sourceHash,
            occurrence: props.block.occurrence,
        },
        records: props.records,
        recordsInvalid: props.recordsInvalid,
        isCurrent: currentSource,
    }), [props.conversationId, props.turnIndex, props.messageId, props.userMessageSourceHash,
        props.messageContent, props.block, props.records, props.recordsInvalid, currentSource]);
    const [serviceRevision, setServiceRevision] = useState(0);
    const refreshBinding = useCallback(() => {
        if (mountedRef.current) setServiceRevision(value => value + 1);
    }, []);
    const binding = useMemo(() => props.conversationId
        ? props.artifactService?.resolveArtifact(source) : undefined,
    [props.artifactService, props.conversationId, source, serviceRevision]);
    const artifactId = binding?.id;
    const record = binding?.record;
    const savedPath = record?.save?.phase === "saved" ? record.save.path : undefined;
    const [draftPath, setDraftPath] = useState(() => binding?.path ?? savedPath
        ?? props.artifactService?.suggestPath(props.block.raw, props.capturedSourcePath)
        ?? `${deriveCanvasTitle(props.block.raw)}.canvas`);
    const [busy, setBusy] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [recreating, setRecreating] = useState(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            waitingForDisplay.current.clear();
        };
    }, []);

    useEffect(() => {
        if (!props.onSettingsChanged) return;
        return props.onSettingsChanged(() => setPolicyRevision(value => value + 1));
    }, [props.onSettingsChanged]);

    useEffect(() => {
        if (!props.artifactService || !artifactId) return;
        return props.artifactService.subscribe(artifactId, refreshBinding);
    }, [props.artifactService, artifactId, refreshBinding]);

    const unconfirmed = record?.save?.phase === "pending" && binding?.fileState === "unconfirmed";
    const displayPath = recreating ? draftPath : binding?.path ?? savedPath ?? draftPath;
    const sourcePath = useMemo(() => {
        try {
            return props.artifactService?.validateTargetPath(displayPath) ?? displayPath;
        } catch {
            return null;
        }
    }, [displayPath, props.artifactService, policyRevision]);
    const pathError = sourcePath === null ? canvasT("plugin.chat.canvas.pathInvalid", props.locale) : null;

    useEffect(() => {
        if (!props.artifactService || !artifactId || record?.save?.phase !== "pending" || !props.conversationId) return;
        let current = true;
        void props.artifactService.verifyPending({ source, artifactId }).then(() => {
            if (current) refreshBinding();
        }).catch(() => {
            if (current) setStatusMessage(canvasT("plugin.chat.canvas.associationUnconfirmed", props.locale));
        });
        return () => {
            current = false;
        };
    }, [props.artifactService, props.conversationId, source, artifactId, record?.save?.phase, refreshBinding, props.locale]);

    const zoom = (direction: 1 | -1) => {
        setViewBox(box => {
            const factor = direction > 0 ? 0.8 : 1.25;
            const width = Math.max(80, box.width * factor);
            const height = Math.max(50, box.height * factor);
            return {
                x: box.x + (box.width - width) / 2,
                y: box.y + (box.height - height) / 2,
                width,
                height,
            };
        });
    };

    const pan = (deltaX: number, deltaY: number) => {
        setViewBox(box => ({ ...box, x: box.x + deltaX, y: box.y + deltaY }));
    };

    const pointerState = useRef<{ id: number; x: number; y: number } | null>(null);
    const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
        const target = event.target && (event.target as Node).nodeType === 1 ? event.target as Element : null;
        if (event.button !== 0
            || (target?.closest("foreignObject") && !target.closest(".pa-chat-canvas-background"))) return;
        event.preventDefault();
        pointerState.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        const state = pointerState.current;
        if (!state || state.id !== event.pointerId) return;
        const scale = viewBox.width / Math.max(1, event.currentTarget.clientWidth);
        pan((state.x - event.clientX) * scale, (state.y - event.clientY) * scale);
        pointerState.current = { ...state, x: event.clientX, y: event.clientY };
    };
    const endPointer = () => {
        pointerState.current = null;
    };

    const nodesById = useMemo(() => new Map((document?.nodes ?? []).map(node => [node.id, node])), [document]);

    const runArtifactAction = async (action: "save" | "open" | "candidate" | "verify") => {
        if (!props.artifactService || !artifactId || busy) return;
        setBusy(true);
        setStatusMessage(null);
        try {
            if (action === "verify") {
                await props.artifactService.verifyPending({ source, artifactId });
                return;
            }
            if (action === "open" || action === "candidate") {
                const input = { source, artifactId, isViewCurrent };
                const opened = action === "candidate"
                    ? await props.artifactService.openCandidate(input)
                    : await props.artifactService.open(input);
                if (currentSource()) setStatusMessage(opened.phase === "opened" ? null
                    : canvasT(`plugin.chat.canvas.reason.${opened.reason ?? "open-failed"}`, props.locale));
                return;
            }
            if (!sourcePath) return;
            const saved = await props.artifactService.save({
                source,
                artifactId,
                path: sourcePath,
                recreateMissing: recreating,
                isViewCurrent,
            });
            if (currentSource()) {
                if (saved.file) setRecreating(false);
                setStatusMessage(saved.phase === "saved" ? null
                    : canvasT(`plugin.chat.canvas.reason.${saved.reason ?? "create-failed"}`, props.locale));
            }
        } catch {
            if (currentSource()) setStatusMessage(canvasT("plugin.chat.canvas.actionFailed", props.locale));
        } finally {
            refreshBinding();
            if (mountedRef.current) setBusy(false);
        }
    };

    const canSave = Boolean(props.artifactService && props.conversationId && props.block.status.kind === "preview"
        && !busy && !pathError && (!savedPath || recreating) && !unconfirmed
        && binding?.status === "ready");
    const missing = binding?.fileState === "missing" && Boolean(savedPath);
    const canOpen = Boolean(savedPath && !missing && !recreating);

    return <article className="pa-chat-canvas" data-pa-canvas-artifact-id={artifactId}>
        <header className="pa-chat-canvas-header">
            <div>
                <strong>{documentTitle(props.block, props.locale)}</strong>
                <span className="pa-chat-canvas-snapshot">
                    {canvasT("plugin.chat.canvas.generatedSnapshot", props.locale)}
                </span>
            </div>
            <div className="pa-chat-canvas-actions">
                <button type="button" onClick={() => zoom(-1)}>{canvasT("plugin.chat.canvas.zoomOut", props.locale)}</button>
                <button type="button" onClick={() => zoom(1)}>{canvasT("plugin.chat.canvas.zoomIn", props.locale)}</button>
                <button type="button" onClick={() => setViewBox(initialBox)}>{canvasT("plugin.chat.canvas.fit", props.locale)}</button>
                <button type="button" onClick={() => setJsonOpen(value => !value)}>
                    {jsonOpen
                        ? canvasT("plugin.chat.canvas.hideJson", props.locale)
                        : canvasT("plugin.chat.canvas.showJson", props.locale)}
                </button>
            </div>
        </header>
        <label className="pa-chat-canvas-path">
            <span>{canvasT("plugin.chat.canvas.saveTo", props.locale)}</span>
            <input value={displayPath} readOnly={(Boolean(savedPath) && !recreating) || unconfirmed} spellCheck={false}
                onChange={event => setDraftPath(event.target.value)} disabled={busy} />
        </label>
        {pathError ? <p className="pa-chat-canvas-error" role="alert">{pathError}</p> : null}
        {props.recordsInvalid ? <p className="pa-chat-canvas-error" role="status">
            {canvasT("plugin.chat.canvas.associationUnconfirmed", props.locale)}
        </p> : null}
        {statusMessage ? <p className="pa-chat-canvas-status" role="status">{statusMessage}</p> : null}
        {document ? <p className="pa-chat-canvas-status">
            {canvasT("plugin.chat.canvas.currentReferences", props.locale)}
        </p> : null}
        {binding?.associationRecorded === false ? <p className="pa-chat-canvas-status" role="status">
            {canvasT("plugin.chat.canvas.reason.association-failed", props.locale)}
        </p> : null}
        <div className="pa-chat-canvas-main-action">
            {unconfirmed ? <>
                <span role="status">{canvasT("plugin.chat.canvas.associationUnconfirmed", props.locale)}</span>
                <button type="button" disabled={busy} onClick={() => void runArtifactAction("verify")}>
                    {canvasT("plugin.chat.canvas.recheck", props.locale)}
                </button>
                <button type="button" disabled={busy} onClick={() => void runArtifactAction("candidate")}>
                    {canvasT("plugin.chat.canvas.inspectFile", props.locale)}
                </button>
            </> : missing && !recreating ? <>
                <span role="status">{canvasT("plugin.chat.canvas.reason.file-missing", props.locale)}</span>
                <button type="button" disabled={busy} onClick={() => {
                    setDraftPath(savedPath!);
                    setRecreating(true);
                }}>{canvasT("plugin.chat.canvas.resaveSnapshot", props.locale)}</button>
            </> : canOpen
                ? <button type="button" className="pa-chat-canvas-open" disabled={busy}
                    onClick={() => void runArtifactAction("open")}>
                    {canvasT("plugin.chat.canvas.open", props.locale)}
                </button>
                : <button type="button" className="pa-chat-canvas-save" disabled={!canSave}
                    onClick={() => void runArtifactAction("save")}>
                    {busy
                        ? canvasT("plugin.chat.canvas.saving", props.locale)
                        : canvasT("plugin.chat.canvas.saveAndOpen", props.locale)}
                </button>}
        </div>
        <div className="pa-chat-canvas-viewport" data-ignore-swipe="true">
            {document ? <svg className="pa-chat-canvas-svg" role="group" tabIndex={0}
                aria-labelledby={viewportTitleId}
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerUp={endPointer} onPointerCancel={endPointer}
                onKeyDown={event => {
                    if (event.target !== event.currentTarget) return;
                    const step = viewBox.width / 10;
                    const moves: Record<string, [number, number]> = {
                        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                        ArrowUp: [0, -step], ArrowDown: [0, step],
                    };
                    if (moves[event.key]) pan(...moves[event.key]);
                    else if (event.key === "+" || event.key === "=") zoom(1);
                    else if (event.key === "-") zoom(-1);
                    else if (event.key === "0") setViewBox(initialBox);
                    else return;
                    event.preventDefault();
                }}>
                <title id={viewportTitleId}>{canvasT("plugin.chat.canvas.keyboardHint", props.locale)}</title>
                {document.nodes.map(node => node.type === "group" ? <g key={node.id}
                    className={`pa-chat-canvas-group${colorClass(node.color)}`} style={colorStyle(node.color)}>
                    <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={12} />
                    {node.label ? <text x={node.x + 18} y={node.y + 28}>{node.label}</text> : null}
                    {node.background ? <foreignObject x={node.x + 12} y={node.y + (node.label ? 48 : 12)}
                        width={Math.max(0, node.width - 24)} height={Math.max(0, node.height - (node.label ? 60 : 24))}>
                        <CanvasNodeBody app={props.app} node={node} owner={props.owner} port={props.resourcePort}
                            locale={props.locale} whenVisible={whenVisible} sourcePath={sourcePath} isCurrent={currentSource} policyRevision={policyRevision} />
                    </foreignObject> : null}
                </g> : <foreignObject key={node.id} x={node.x} y={node.y}
                    width={node.width} height={node.height}
                    className={`pa-chat-canvas-node${colorClass(node.color)}`} style={colorStyle(node.color)}>
                    <CanvasNodeBody app={props.app} node={node} owner={props.owner} port={props.resourcePort}
                        locale={props.locale} whenVisible={whenVisible} sourcePath={sourcePath} isCurrent={currentSource} policyRevision={policyRevision} />
                </foreignObject>)}
                {document.edges.map(edge => {
                    const geometry = edgeGeometry(nodesById, edge);
                    if (!geometry) return null;
                    const labelX = (geometry.start.x + geometry.end.x) / 2;
                    const labelY = (geometry.start.y + geometry.end.y) / 2 - 8;
                    return <g key={edge.id} className={`pa-chat-canvas-edge-group${colorClass(edge.color)}`} style={colorStyle(edge.color)}>
                        <path d={geometry.path} className="pa-chat-canvas-edge" />
                        {edge.fromEnd === "arrow" ? <polygon className="pa-chat-canvas-arrow"
                            points={arrowPoints(geometry.start, geometry.startAngle)} /> : null}
                        {edge.toEnd === "arrow" ? <polygon className="pa-chat-canvas-arrow"
                            points={arrowPoints(geometry.end, geometry.angle)} /> : null}
                        {edge.label ? <text x={labelX} y={labelY} textAnchor="middle">{edge.label}</text> : null}
                    </g>;
                })}
            </svg> : <div className="pa-chat-canvas-placeholder" role="status">
                {canvasT("plugin.chat.canvas.generating", props.locale)}
            </div>}
        </div>
        {jsonOpen ? <details className="pa-chat-canvas-json" open>
            <summary>{canvasT("plugin.chat.canvas.rawJson", props.locale)}</summary>
            <pre><code>{props.block.raw}</code></pre>
            <button type="button" onClick={() => void navigator.clipboard.writeText(props.block.raw)}>
                {canvasT("plugin.chat.canvas.copyJson", props.locale)}
            </button>
        </details> : null}
    </article>;
}
