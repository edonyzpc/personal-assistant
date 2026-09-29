import type { GhostRequestGate } from "./client";
import type { GhostPreviewCheck } from "./service";
import type { GhostSnapshot } from "./state-schema";
import type { LexicalNodeJson } from "./types";

export interface GhostPreviewExpectations {
    recipe: { version: string; contentHash: string };
    codes: Array<{ text: string; language: string; highlightRequired: boolean }>;
    images: Array<{ url: string; role: "body" | "feature" }>;
    mermaidCount: number;
    inlineMathCount: number;
    displayMathCount: number;
}

export interface GhostPageProbeResult {
    documentReady: boolean;
    urlMatches: boolean;
    scopeFound: boolean;
    recipe: { matches: boolean; prism: string; mermaid: string; math: string };
    codes: Array<{ exact: boolean; visible: boolean; tokens: number; grammar: boolean }>;
    images: Array<{ found: boolean; complete: boolean; visible: boolean; width: number; height: number }>;
    mermaid: { count: number; errors: boolean; visible: boolean };
    math: { inline: number; display: number; errors: number; visible: boolean };
}

export type GhostPreviewIssue = "page-loading" | "wrong-page" | "body-unavailable" | "recipe-mismatch"
    | "code-mismatch" | "highlight-unavailable" | "image-unavailable" | "mermaid-unavailable" | "math-unavailable" | "invalid-probe";

export interface GhostPreviewDiagnostics {
    status: "unavailable" | "checking" | "passed" | "failed" | "invalidated";
    reason?: "desktop-required" | "enable-web-viewer" | "native-capability-unavailable" | "navigation-unavailable" | "cancelled" | "probe-unavailable";
    issues: GhostPreviewIssue[];
    unsupportedCodeCount: number;
}

function safeUrl(value: string): string {
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
        return url.href;
    } catch { throw new Error("Invalid preview URL"); }
}

export function ghostPreviewUrl(site: string, uuid: string): string {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(uuid)) throw new Error("Invalid preview identity");
    const base = new URL(safeUrl(site));
    if (base.search || base.hash) throw new Error("Invalid preview site");
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
    return new URL(`p/${uuid}/`, base).href;
}

/** Reads only the current validated candidate; it never accepts a page-provided probe. */
export function ghostPreviewExpectations(snapshot: {
    content: Pick<GhostSnapshot["content"], "lexical" | "feature_image">;
    recipe: Pick<GhostSnapshot["recipe"], "version" | "contentHash" | "prismLanguages" | "needsKatex">;
}): GhostPreviewExpectations {
    const result: GhostPreviewExpectations = {
        recipe: { version: snapshot.recipe.version, contentHash: snapshot.recipe.contentHash },
        codes: [], images: [], mermaidCount: 0, inlineMathCount: 0, displayMathCount: 0,
    };
    const visibleText: string[] = [];
    const countMath = (text: string) => {
        if (!snapshot.recipe.needsKatex) return;
        result.inlineMathCount += (text.match(/\\\([\s\S]*?\\\)/g) ?? []).length;
        result.displayMathCount += (text.match(/\\\[[\s\S]*?\\\]/g) ?? []).length;
    };
    const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const visit = (node: LexicalNodeJson) => {
        if (node.type === "codeblock") {
            const language = String(node.language ?? "").toLowerCase();
            if (language === "mermaid") result.mermaidCount++;
            else result.codes.push({ text: String(node.code ?? ""), language, highlightRequired: snapshot.recipe.prismLanguages.includes(language) });
        } else if (node.type === "image") {
            result.images.push({ url: safeUrl(String(node.src)), role: "body" });
        } else if (node.type === "html") {
            // The exporter owns these HTML cards. Exclude literal code before counting math.
            const html = String(node.html ?? "");
            for (const match of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
                result.images.push({ url: safeUrl(decode(match[2])), role: "body" });
            }
            countMath(html.replace(/<(code|pre|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]*>/g, ""));
        } else if ((node.type === "text" || node.type === "extended-text") && !(Number(node.format) & 16)) {
            visibleText.push(String(node.text ?? ""));
        }
        if (Array.isArray(node.children)) (node.children as LexicalNodeJson[]).forEach(visit);
    };
    const lexical = JSON.parse(snapshot.content.lexical) as { root: LexicalNodeJson };
    visit(lexical.root);
    // Ghost formatting can split one formula across adjacent text nodes.
    countMath(visibleText.join(""));
    if (snapshot.recipe.needsKatex && result.inlineMathCount + result.displayMathCount === 0) {
        throw new Error("Unverifiable math expectations");
    }
    if (snapshot.content.feature_image) result.images.push({ url: safeUrl(snapshot.content.feature_image), role: "feature" });
    return result;
}

/** Self-contained fixed page code. Keep all page dependencies inside this function. */
function fixedPageProbe(expected: GhostPreviewExpectations, expectedUrl: string): GhostPageProbeResult {
    const root = document.querySelector<HTMLElement>(
        "article .gh-content, article .post-content, article .entry-content, article [itemprop='articleBody'], main .gh-content, article",
    );
    const excluded = "header,footer,nav,aside,.gh-author,.author,.gh-article-image,.post-image,.post-feature-image,.read-next,.related-posts";
    const inBody = (node: Element) => !node.closest(excluded);
    const visible = (node: Element) => {
        const rectangle = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rectangle.width > 0 && rectangle.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const normalize = (url: string) => {
        try { return new URL(url, location.href).href; } catch { return ""; }
    };
    const imageIdentity = (value: URL) => {
        const marker = "/content/images/size/w";
        const start = value.pathname.indexOf(marker);
        if (start < 0) return value.pathname;
        const sized = /^[1-9]\d*\/(.+)$/.exec(value.pathname.slice(start + marker.length));
        return sized ? `${value.pathname.slice(0, start)}/content/images/${sized[1]}` : null;
    };
    const isManagedImage = (actualValue: string, expectedValue: string) => {
        const actualUrl = normalize(actualValue);
        const expectedUrl = normalize(expectedValue);
        if (!actualUrl || !expectedUrl) return false;
        if (actualUrl === expectedUrl) return true;
        try {
            const actual = new URL(actualUrl);
            const expected = new URL(expectedUrl);
            const actualPath = imageIdentity(actual);
            const expectedPath = imageIdentity(expected);
            return actual.origin === expected.origin && actualPath !== null && actualPath === expectedPath
                && actual.search === expected.search && actual.hash === expected.hash;
        } catch { return false; }
    };
    const globals = window as unknown as {
        __paGhostRecipe?: { version?: string; contentHash?: string; prism?: string; mermaid?: string; math?: string };
        Prism?: { languages?: Record<string, unknown> };
    };
    const recipe = globals.__paGhostRecipe ?? {};
    const status = (value: unknown) => typeof value === "string" && ["loaded", "rendered", "reused-auto", "reused-unverified", "error", "failed"].includes(value) ? value : "missing";
    const codeNodes = root && expected.codes.length ? Array.from(root.querySelectorAll<HTMLElement>("pre code")).filter(inBody) : [];
    const usedCodes = new Set<Element>();
    const codes = expected.codes.map((item) => {
        const node = codeNodes.find((code) => !usedCodes.has(code) && code.textContent === item.text
            && (!item.language || code.classList.contains(`language-${item.language}`) || code.parentElement?.classList.contains(`language-${item.language}`)));
        if (node) usedCodes.add(node);
        return { exact: Boolean(node), visible: Boolean(node && visible(node)), tokens: node?.querySelectorAll(".token").length ?? 0,
            grammar: Boolean(item.language && globals.Prism?.languages?.[item.language]) };
    });
    const bodyImages = root && expected.images.some((item) => item.role === "body") ? Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter(inBody) : [];
    const featureImages = expected.images.some((item) => item.role === "feature") ? Array.from(document.querySelectorAll<HTMLImageElement>(
        "article .gh-article-image img, article .post-image img, article .post-feature-image img, .gh-article-image img",
    )) : [];
    const usedImages = new Set<Element>();
    const images = expected.images.map((item) => {
        const candidates = item.role === "body" ? bodyImages : featureImages;
        const image = candidates.find((entry) => !usedImages.has(entry)
            && isManagedImage(entry.currentSrc || entry.src, item.url));
        if (image) {
            usedImages.add(image);
            image.loading = "eager";
            // Trigger ordinary lazy-image decoding; no Host requests or credentials enter the page.
            if (typeof image.decode === "function") void image.decode().catch(() => {});
        }
        return { found: Boolean(image), complete: image?.complete === true, visible: Boolean(image && visible(image)),
            width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 };
    });
    const graphs = root && expected.mermaidCount ? Array.from(root.querySelectorAll<SVGElement>("svg[id^='mermaid'],svg.mermaid,[data-processed='true'] svg")).filter(inBody) : [];
    const graphErrors = Boolean(expected.mermaidCount && root?.querySelector(".diagram-error,.error-icon,.error-text,.mermaid-error"));
    const validGraphs = graphs.filter((svg) => !svg.querySelector(".error-icon,.error-text")
        && Boolean(svg.querySelector("path,rect,circle,ellipse,polygon,line,polyline,text")));
    const needsMath = expected.inlineMathCount + expected.displayMathCount > 0;
    const math = root && needsMath ? Array.from(root.querySelectorAll<HTMLElement>(".katex")).filter(inBody) : [];
    const display = math.filter((node) => node.closest(".katex-display")).length;
    return {
        documentReady: document.readyState === "complete", urlMatches: location.href === expectedUrl, scopeFound: Boolean(root && visible(root)),
        recipe: { matches: recipe.version === expected.recipe.version && recipe.contentHash === expected.recipe.contentHash,
            prism: status(recipe.prism), mermaid: status(recipe.mermaid), math: status(recipe.math) },
        codes, images,
        mermaid: { count: validGraphs.length, errors: graphErrors, visible: validGraphs.every(visible) },
        math: { inline: math.length - display, display, errors: needsMath ? root?.querySelectorAll(".katex-error").length ?? 0 : 0, visible: math.every(visible) },
    };
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
}

/** The decision is made in Host code, never by trusting a page's `passed` property. */
export function evaluateGhostPreviewProbe(expected: GhostPreviewExpectations, raw: unknown): { passed: boolean; issues: GhostPreviewIssue[] } {
    const item = record(raw);
    const recipe = record(item?.recipe);
    const mermaid = record(item?.mermaid);
    const math = record(item?.math);
    const bool = (value: unknown) => typeof value === "boolean";
    if (!item || !recipe || !mermaid || !math || !bool(item.documentReady) || !bool(item.urlMatches) || !bool(item.scopeFound)
        || !bool(recipe.matches) || ![recipe.prism, recipe.mermaid, recipe.math].every((value) => typeof value === "string")
        || !count(mermaid.count) || !bool(mermaid.errors) || !bool(mermaid.visible)
        || !count(math.inline) || !count(math.display) || !count(math.errors) || !bool(math.visible)
        || !Array.isArray(item.codes) || item.codes.length !== expected.codes.length
        || !Array.isArray(item.images) || item.images.length !== expected.images.length) return { passed: false, issues: ["invalid-probe"] };
    const codes = item.codes.map(record);
    const images = item.images.map(record);
    if (codes.some((code) => !code || !bool(code.exact) || !bool(code.visible) || !bool(code.grammar) || !count(code.tokens))
        || images.some((image) => !image || !bool(image.found) || !bool(image.complete) || !bool(image.visible) || !count(image.width) || !count(image.height))) {
        return { passed: false, issues: ["invalid-probe"] };
    }
    const issues: GhostPreviewIssue[] = [];
    if (!item.documentReady) issues.push("page-loading");
    if (!item.urlMatches) issues.push("wrong-page");
    if (!item.scopeFound) issues.push("body-unavailable");
    if (!recipe.matches) issues.push("recipe-mismatch");
    if (codes.some((code) => !code?.exact || !code.visible)) issues.push("code-mismatch");
    if (codes.some((code, index) => expected.codes[index].highlightRequired
        && (!code?.grammar || !Number(code.tokens) || !["loaded", "reused-auto"].includes(String(recipe.prism))))) issues.push("highlight-unavailable");
    if (images.some((image) => !image?.found || !image.complete || !image.visible || !Number(image.width) || !Number(image.height))) issues.push("image-unavailable");
    if (expected.mermaidCount > 0 && (mermaid.count !== expected.mermaidCount || mermaid.errors || !mermaid.visible
        || !["rendered", "reused-auto"].includes(String(recipe.mermaid)))) issues.push("mermaid-unavailable");
    if (expected.inlineMathCount + expected.displayMathCount > 0 && (math.inline !== expected.inlineMathCount || math.display !== expected.displayMathCount
        || math.errors !== 0 || !math.visible || !["loaded", "reused-auto"].includes(String(recipe.math)))) issues.push("math-unavailable");
    return { passed: issues.length === 0, issues };
}

export function ghostPreviewProbeScript(expected: GhostPreviewExpectations, url: string): string {
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return `(${fixedPageProbe.toString()})(${json(expected)},${json(safeUrl(url))})`;
}

export interface GhostNativeWebview {
    isConnected: boolean;
    offsetWidth: number;
    offsetHeight: number;
    getURL(): string;
    isLoading(): boolean;
    checkVisibility?(options?: { checkVisibilityCSS?: boolean }): boolean;
    executeJavaScript(script: string): Promise<unknown>;
    addEventListener(event: string, listener: () => void): void;
    removeEventListener(event: string, listener: () => void): void;
}

export interface GhostNativeView {
    containerEl: { querySelector(selector: string): unknown };
    mode?: string;
    getState?(): { mode?: string };
    navigate(url: string, replace?: boolean): void | Promise<void>;
}

export interface GhostNativeLeaf {
    view: unknown;
    setViewState(state: { type: "webviewer"; state: { url: string }; active: true }): Promise<void>;
}

export interface GhostPreviewHost {
    workspace: {
        getLeaf(mode: "tab"): GhostNativeLeaf;
        getLeavesOfType(type: "webviewer"): GhostNativeLeaf[];
    };
}

export interface GhostPreviewTarget {
    url: string;
    candidateHash: string;
    expectations: GhostPreviewExpectations;
    /** Host checks current candidate/profile/source identity; never supplied by a model. */
    isCandidateCurrent(): boolean;
}

export interface GhostPreviewOptions {
    isDesktop(): boolean;
    isWebViewerEnabled(): boolean;
    loadTimeoutMs?: number;
    probeTimeoutMs?: number;
}

/** Owns only one native viewer reference and its diagnostic listeners, never the user's leaf lifetime. */
export class GhostNativePreviewAdapter {
    private leaf: GhostNativeLeaf | undefined;
    private sequence = 0;
    private pageRevision = 0;
    private disposed = false;
    private listeners: Array<() => void> = [];
    private pending = new Set<() => void>();
    private diagnostics: GhostPreviewDiagnostics = { status: "unavailable", issues: [], unsupportedCodeCount: 0 };
    private readonly loadTimeoutMs: number;
    private readonly probeTimeoutMs: number;

    constructor(private readonly host: GhostPreviewHost, private readonly options: GhostPreviewOptions) {
        const duration = (value: number | undefined, fallback: number) =>
            value === undefined ? fallback : Number.isFinite(value) && value > 0 && value <= 30_000 ? value : fallback;
        this.loadTimeoutMs = duration(options.loadTimeoutMs, 12_000);
        this.probeTimeoutMs = duration(options.probeTimeoutMs, 25_000);
    }

    getDiagnostics(): GhostPreviewDiagnostics {
        return { ...this.diagnostics, issues: [...this.diagnostics.issues] };
    }

    /** The returned address is only an explicit manual browser entry; it never passes a check. */
    systemBrowserUrl(url: string): string { return safeUrl(url); }

    invalidate(): void {
        this.sequence++;
        this.pageRevision++;
        for (const cancel of [...this.pending]) cancel();
        this.diagnostics = { ...this.diagnostics, status: "invalidated" };
    }

    dispose(): void {
        this.disposed = true;
        this.invalidate();
        this.removeListeners();
        this.leaf = undefined;
    }

    async check(target: GhostPreviewTarget, gate: GhostRequestGate): Promise<GhostPreviewCheck> {
        this.invalidate();
        const sequence = this.sequence;
        const failed = (): GhostPreviewCheck => ({ candidateHash: target.candidateHash, passed: false, isCurrent: () => false });
        const unavailable = (reason: GhostPreviewDiagnostics["reason"]) => {
            if (sequence === this.sequence) this.diagnostics = { status: "unavailable", reason, issues: [], unsupportedCodeCount: 0 };
            return failed();
        };
        if (!this.options.isDesktop()) return unavailable("desktop-required");
        if (!this.options.isWebViewerEnabled()) return unavailable("enable-web-viewer");
        const admission = () => {
            try {
                gate.assertCurrent();
                return !this.disposed && sequence === this.sequence && !gate.signal?.aborted
                    && this.options.isDesktop() && this.options.isWebViewerEnabled() && target.isCandidateCurrent();
            } catch { return false; }
        };
        if (!gate || typeof gate.beforeSend !== "function" || typeof gate.assertCurrent !== "function" || !admission()) {
            return unavailable("cancelled");
        }
        let url: string;
        let expected: GhostPreviewExpectations;
        try {
            url = safeUrl(target.url);
            expected = JSON.parse(JSON.stringify(target.expectations)) as GhostPreviewExpectations;
            if (!target.candidateHash || !record(expected.recipe) || typeof expected.recipe.version !== "string"
                || typeof expected.recipe.contentHash !== "string" || !Array.isArray(expected.codes) || !Array.isArray(expected.images)
                || !count(expected.mermaidCount) || !count(expected.inlineMathCount) || !count(expected.displayMathCount)
                || expected.codes.some((code) => typeof code.text !== "string" || typeof code.language !== "string" || typeof code.highlightRequired !== "boolean")
                || expected.images.some((image) => !["body", "feature"].includes(image.role) || safeUrl(image.url) !== image.url)) {
                return unavailable("probe-unavailable");
            }
        } catch { return unavailable("probe-unavailable"); }
        let admitted: boolean | undefined;
        try { admitted = await this.bounded(gate.beforeSend().then(() => true), this.loadTimeoutMs, gate.signal); }
        catch { return unavailable("cancelled"); }
        if (!admitted || !admission()) return unavailable("cancelled");
        this.diagnostics = { status: "checking", issues: [], unsupportedCodeCount: expected.codes.filter((code) => code.language && !code.highlightRequired).length };
        let native: { leaf: GhostNativeLeaf; view: GhostNativeView; webview: GhostNativeWebview } | null;
        try {
            if (!this.leaf || !this.host.workspace.getLeavesOfType("webviewer").includes(this.leaf)) {
                this.removeListeners();
                this.leaf = this.host.workspace.getLeaf("tab");
                if (!admission()) return unavailable("cancelled");
                const opened = await this.bounded(this.leaf.setViewState({ type: "webviewer", state: { url }, active: true }).then(() => true), this.loadTimeoutMs, gate.signal);
                if (!opened || !admission()) return unavailable("navigation-unavailable");
            }
            native = this.native(this.leaf);
        } catch { return unavailable("native-capability-unavailable"); }
        if (!native) return unavailable("native-capability-unavailable");
        this.watch(native.webview);
        if (!await this.navigate(native.view, native.webview, url, gate, admission)) return unavailable("navigation-unavailable");
        const revision = this.pageRevision;
        const current = () => admission() && revision === this.pageRevision && this.current(native, url);
        if (!current()) return unavailable("navigation-unavailable");
        const script = ghostPreviewProbeScript(expected, url);
        const deadline = Date.now() + this.probeTimeoutMs;
        let issues: GhostPreviewIssue[] = ["invalid-probe"];
        while (Date.now() < deadline && current()) {
            let raw: unknown;
            try {
                raw = await this.bounded(native.webview.executeJavaScript(script), Math.max(1, deadline - Date.now()), gate.signal);
            } catch { return unavailable("probe-unavailable"); }
            if (!current()) return unavailable("cancelled");
            const evaluated = evaluateGhostPreviewProbe(expected, raw);
            issues = evaluated.issues;
            if (evaluated.passed) {
                this.diagnostics = { ...this.diagnostics, status: "passed", issues: [] };
                return { candidateHash: target.candidateHash, passed: true, isCurrent: current };
            }
            // Navigation/invalid return shapes cannot improve by waiting on old page output.
            if (issues.includes("wrong-page") || issues.includes("invalid-probe")) break;
            await this.bounded(new Promise<never>(() => {}), Math.min(250, Math.max(1, deadline - Date.now())), gate.signal);
        }
        if (sequence === this.sequence) this.diagnostics = { ...this.diagnostics, status: "failed", issues };
        return failed();
    }

    private native(leaf: GhostNativeLeaf): { leaf: GhostNativeLeaf; view: GhostNativeView; webview: GhostNativeWebview } | null {
        const view = leaf.view as GhostNativeView | undefined;
        if (!view || typeof view.navigate !== "function" || typeof view.containerEl?.querySelector !== "function") return null;
        const webview = view.containerEl.querySelector("webview") as GhostNativeWebview | null;
        if (!webview || typeof webview.getURL !== "function" || typeof webview.isLoading !== "function"
            || typeof webview.executeJavaScript !== "function" || typeof webview.addEventListener !== "function"
            || typeof webview.removeEventListener !== "function") return null;
        return { leaf, view, webview };
    }

    private current(native: { leaf: GhostNativeLeaf; view: GhostNativeView; webview: GhostNativeWebview }, url: string): boolean {
        try {
            const { leaf, view, webview } = native;
            const mode = view.getState?.().mode ?? view.mode;
            return this.host.workspace.getLeavesOfType("webviewer").includes(leaf) && leaf.view === view
                && view.containerEl.querySelector("webview") === webview && mode === "webview"
                && webview.isConnected && webview.offsetWidth > 0 && webview.offsetHeight > 0
                && (webview.checkVisibility?.({ checkVisibilityCSS: true }) ?? true)
                && !webview.isLoading() && webview.getURL() === url;
        } catch { return false; }
    }

    private watch(webview: GhostNativeWebview): void {
        this.removeListeners();
        const changed = () => {
            this.pageRevision++;
            if (this.diagnostics.status === "passed") this.diagnostics = { ...this.diagnostics, status: "invalidated" };
        };
        for (const name of ["did-start-loading", "will-navigate", "did-navigate", "did-navigate-in-page", "did-fail-load", "destroyed", "render-process-gone", "close"]) {
            const listener = () => {
                changed();
                if (["destroyed", "render-process-gone", "close"].includes(name)) {
                    this.invalidate();
                    this.removeListeners();
                }
            };
            webview.addEventListener(name, listener);
            this.listeners.push(() => webview.removeEventListener(name, listener));
        }
    }

    private removeListeners(): void {
        for (const remove of this.listeners.splice(0)) remove();
    }

    private async navigate(view: GhostNativeView, webview: GhostNativeWebview, url: string, gate: GhostRequestGate, admission: () => boolean): Promise<boolean> {
        let started = false;
        let finish!: (value: boolean) => void;
        const loaded = new Promise<boolean>((resolve) => { finish = resolve; });
        const onStart = () => { started = true; };
        const onStop = () => {
            try { if (started && !webview.isLoading() && webview.getURL() === url) finish(true); }
            catch { finish(false); }
        };
        const onFailure = () => finish(false);
        webview.addEventListener("did-start-loading", onStart);
        webview.addEventListener("did-stop-loading", onStop);
        webview.addEventListener("did-fail-load", onFailure);
        try {
            if (!admission()) return false;
            gate.assertCurrent();
            const navigation = view.navigate(url, false);
            if (navigation) void navigation.catch(onFailure);
            return await this.bounded(loaded, this.loadTimeoutMs, gate.signal) === true && admission();
        } catch { return false; }
        finally {
            webview.removeEventListener("did-start-loading", onStart);
            webview.removeEventListener("did-stop-loading", onStop);
            webview.removeEventListener("did-fail-load", onFailure);
        }
    }

    private bounded<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T | undefined> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value?: T) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener("abort", cancel);
                this.pending.delete(cancel);
                resolve(value);
            };
            const cancel = () => finish();
            const timer = setTimeout(cancel, timeoutMs);
            this.pending.add(cancel);
            signal?.addEventListener("abort", cancel, { once: true });
            if (signal?.aborted || this.disposed) cancel();
            void promise.then(finish, cancel);
        });
    }
}
