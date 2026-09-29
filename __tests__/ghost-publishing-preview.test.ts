import { Script } from "node:vm";
import { describe, expect, it, jest } from "@jest/globals";
import {
    evaluateGhostPreviewProbe, ghostPreviewExpectations, ghostPreviewProbeScript, ghostPreviewUrl,
    GhostNativePreviewAdapter,
    type GhostNativeWebview, type GhostNativeView, type GhostNativeLeaf, type GhostPreviewHost,
    type GhostPageProbeResult, type GhostPreviewExpectations, type GhostPreviewOptions, type GhostPreviewTarget,
} from "../src/ghost-publishing/preview";
import type { GhostRequestGate } from "../src/ghost-publishing/client";

const URL = "https://ghost.example/blog/p/00000000-0000-4000-8000-000000000001/";

function expectations(): GhostPreviewExpectations {
    return {
        recipe: { version: "b153-v1", contentHash: "1234abcd" },
        codes: [{ text: 'const value = "exact";\n', language: "javascript", highlightRequired: true },
            { text: "unknown but intact", language: "unknown-language", highlightRequired: false }],
        images: [{ url: "https://ghost.example/image.png", role: "body" }],
        mermaidCount: 1, inlineMathCount: 1, displayMathCount: 1,
    };
}

function success(): GhostPageProbeResult {
    return {
        documentReady: true, urlMatches: true, scopeFound: true,
        recipe: { matches: true, prism: "loaded", mermaid: "rendered", math: "loaded" },
        codes: [{ exact: true, visible: true, grammar: true, tokens: 4 }, { exact: true, visible: true, grammar: false, tokens: 0 }],
        images: [{ found: true, complete: true, visible: true, width: 120, height: 60 }],
        mermaid: { count: 1, errors: false, visible: true },
        math: { inline: 1, display: 1, errors: 0, visible: true },
    };
}

function responsiveFeatureExpectations(url: string): GhostPreviewExpectations {
    return {
        recipe: { version: "b153-v1", contentHash: "1234abcd" },
        codes: [], images: [{ url, role: "feature" }],
        mermaidCount: 0, inlineMathCount: 0, displayMathCount: 0,
    };
}

function runGeneratedImageProbe(source: { src: string; currentSrc?: string }): GhostPageProbeResult {
    const previewUrl = "https://ghost.example/blog/p/00000000-0000-4000-8000-000000000001/";
    const expected = responsiveFeatureExpectations(
        "https://ghost.example/blog/content/images/2026/09/e5e94ce175f197b295e4ed5d27db99c0c3bc11b5a55f54f2e064c6815dbfeafe.png",
    );
    const image = {
        ...source,
        srcset: "https://ghost.example/blog/content/images/size/w1200/same-file.png 1200w",
        complete: true, naturalWidth: 50, naturalHeight: 25, loading: "lazy",
        decode: () => ({ catch: () => undefined }),
        getBoundingClientRect: () => ({ width: 50, height: 25 }),
    };
    const article = { getBoundingClientRect: () => ({ width: 900, height: 700 }) };
    const sandbox = {
        URL: globalThis.URL,
        Set,
        location: { href: previewUrl },
        getComputedStyle: () => ({ visibility: "visible", display: "block" }),
        window: { __paGhostRecipe: { version: "b153-v1", contentHash: "1234abcd" } },
        document: {
            readyState: "complete",
            querySelector: () => article,
            querySelectorAll: () => [image],
        },
    };
    return new Script(ghostPreviewProbeScript(expected, previewUrl)).runInNewContext(sandbox) as GhostPageProbeResult;
}

function gate(overrides: Partial<GhostRequestGate> = {}): GhostRequestGate {
    return { beforeSend: async () => {}, assertCurrent: () => {}, ...overrides };
}

class NativeFrame implements GhostNativeWebview {
    isConnected = true;
    offsetWidth = 900;
    offsetHeight = 700;
    url = URL;
    loading = false;
    listeners = new Map<string, Set<() => void>>();
    executeJavaScript = jest.fn<(script: string) => Promise<unknown>>().mockResolvedValue(success());
    getURL(): string { return this.url; }
    isLoading(): boolean { return this.loading; }
    addEventListener(name: string, listener: () => void): void {
        const set = this.listeners.get(name) ?? new Set();
        set.add(listener);
        this.listeners.set(name, set);
    }
    removeEventListener(name: string, listener: () => void): void { this.listeners.get(name)?.delete(listener); }
    emit(name: string): void { for (const listener of [...this.listeners.get(name) ?? []]) listener(); }
    listenerCount(): number { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

function fixture(options: Partial<GhostPreviewOptions> = {}) {
    const frame = new NativeFrame();
    const leaves: GhostNativeLeaf[] = [];
    const view: GhostNativeView = {
        mode: "webview",
        containerEl: { querySelector: () => frame },
        navigate: jest.fn<(url: string) => void>((url) => {
            frame.loading = true;
            frame.emit("did-start-loading");
            frame.url = url;
            frame.loading = false;
            frame.emit("did-stop-loading");
        }),
    };
    const leaf: GhostNativeLeaf = {
        view,
        setViewState: jest.fn<GhostNativeLeaf["setViewState"]>(async () => { leaves.push(leaf); }),
    };
    const host: GhostPreviewHost = {
        workspace: {
            getLeaf: jest.fn(() => leaf),
            getLeavesOfType: () => [...leaves],
        },
    };
    const adapter = new GhostNativePreviewAdapter(host, {
        isDesktop: () => true, isWebViewerEnabled: () => true, loadTimeoutMs: 30, probeTimeoutMs: 20, ...options,
    });
    let candidateCurrent = true;
    const target: GhostPreviewTarget = {
        url: URL, candidateHash: "candidate-one", expectations: expectations(), isCandidateCurrent: () => candidateCurrent,
    };
    return { adapter, frame, view, leaf, leaves, host, target, revokeCandidate: () => { candidateCurrent = false; } };
}

describe("fixed Ghost preview diagnostics (no real DOM or native app in this suite)", () => {
    it("extracts only the current candidate's code, image, Mermaid and math requirements", () => {
        const expected = ghostPreviewExpectations({
            recipe: { version: "b153-v1", contentHash: "1234abcd", prismLanguages: ["javascript"], needsKatex: true },
            content: {
                feature_image: "https://ghost.example/cover.png",
                lexical: JSON.stringify({ root: { type: "root", version: 1, children: [
                    { type: "codeblock", version: 1, language: "javascript", code: "const x = 1;\n" },
                    { type: "codeblock", version: 1, language: "unknown-language", code: "\\(not math\\)" },
                    { type: "codeblock", version: 1, language: "mermaid", code: "graph TD; A-->B;" },
                    { type: "image", version: 1, src: "https://ghost.example/body.png" },
                    { type: "extended-text", version: 1, text: "\\(x+", format: 0 },
                    { type: "extended-text", version: 1, text: "1\\)", format: 1 },
                    { type: "extended-text", version: 1, text: "\\(literal code\\)", format: 16 },
                    { type: "html", version: 1, html: '<table><tr><td><img src="https://ghost.example/a.png?a=1&amp;b=2"></td></tr></table><div class="pa-ghost-math-block">\\[x^2\\]</div>' },
                ] } }),
            },
        });
        expect(expected.codes).toEqual([
            { text: "const x = 1;\n", language: "javascript", highlightRequired: true },
            { text: "\\(not math\\)", language: "unknown-language", highlightRequired: false },
        ]);
        expect(expected.images).toEqual([
            { url: "https://ghost.example/body.png", role: "body" },
            { url: "https://ghost.example/a.png?a=1&b=2", role: "body" },
            { url: "https://ghost.example/cover.png", role: "feature" },
        ]);
        expect(expected).toMatchObject({ mermaidCount: 1, inlineMathCount: 1, displayMathCount: 1 });
        expect(evaluateGhostPreviewProbe(expectations(), success())).toEqual({ passed: true, issues: [] });
    });

    it("rejects missing images, wrong URL, hidden body, error SVGs, altered code and insufficient math despite a page's claimed pass", () => {
        const cases: Array<{ modify: (result: GhostPageProbeResult) => void; issue: string }> = [
            { modify: (r) => { r.images[0].width = 0; }, issue: "image-unavailable" },
            { modify: (r) => { r.urlMatches = false; }, issue: "wrong-page" },
            { modify: (r) => { r.scopeFound = false; }, issue: "body-unavailable" },
            { modify: (r) => { r.mermaid.errors = true; }, issue: "mermaid-unavailable" },
            { modify: (r) => { r.recipe.mermaid = "failed"; }, issue: "mermaid-unavailable" },
            { modify: (r) => { r.codes[0].exact = false; }, issue: "code-mismatch" },
            { modify: (r) => { r.math.display = 0; }, issue: "math-unavailable" },
            { modify: (r) => { r.recipe.prism = "error"; }, issue: "highlight-unavailable" },
        ];
        for (const test of cases) {
            const result = success();
            test.modify(result);
            expect(evaluateGhostPreviewProbe(expectations(), { ...result, passed: true })).toEqual({ passed: false, issues: [test.issue] });
        }
        expect(evaluateGhostPreviewProbe(expectations(), { passed: true })).toEqual({ passed: false, issues: ["invalid-probe"] });
    });

    it("does not require unused libraries or pretend an unknown code language was highlighted", () => {
        const expected = expectations();
        expected.codes = [expected.codes[1]];
        expected.mermaidCount = 0;
        expected.inlineMathCount = 0;
        expected.displayMathCount = 0;
        const result = success();
        result.codes = [result.codes[1]];
        result.recipe = { matches: true, prism: "missing", math: "missing", mermaid: "missing" };
        result.mermaid = { count: 0, errors: false, visible: true };
        result.math = { inline: 0, display: 0, errors: 0, visible: true };
        expect(evaluateGhostPreviewProbe(expected, result)).toEqual({ passed: true, issues: [] });
        result.codes[0].exact = false;
        expect(evaluateGhostPreviewProbe(expected, result).issues).toEqual(["code-mismatch"]);
    });

    it("builds a fixed script with safely serialized candidate data and fixed subdirectory preview URLs", () => {
        const expected = expectations();
        expected.codes[0].text = '</script>"; window.attack = true; //\u2028';
        const script = ghostPreviewProbeScript(expected, URL);
        expect(() => new Script(script)).not.toThrow();
        expect(script).toContain("\\u003c/script>");
        expect(script).toContain("__paGhostRecipe");
        expect(script).not.toContain("__paB153Recipe");
        expect(script).not.toContain("candidate-one");
        expect(ghostPreviewUrl("https://ghost.example/blog", "00000000-0000-4000-8000-000000000001")).toBe(URL);
    });

    it("accepts a same-origin Ghost responsive feature image and rejects replacement identities", () => {
        const responsive = runGeneratedImageProbe({
            src: "/blog/content/images/size/w1200/2026/09/e5e94ce175f197b295e4ed5d27db99c0c3bc11b5a55f54f2e064c6815dbfeafe.png",
            currentSrc: "https://ghost.example/blog/content/images/size/w2000/2026/09/e5e94ce175f197b295e4ed5d27db99c0c3bc11b5a55f54f2e064c6815dbfeafe.png",
        });
        expect(responsive.images[0]).toMatchObject({ found: true, complete: true, visible: true, width: 50, height: 25 });
        const expected = responsiveFeatureExpectations(
            "https://ghost.example/blog/content/images/2026/09/e5e94ce175f197b295e4ed5d27db99c0c3bc11b5a55f54f2e064c6815dbfeafe.png",
        );
        expect(evaluateGhostPreviewProbe(expected, responsive)).toEqual({ passed: true, issues: [] });

        const differentFile = runGeneratedImageProbe({
            src: "/blog/content/images/size/w1200/2026/09/0807f6dcaf2bc3dcd9054bc70b1e54aec712ca729956cdf4938cfa85894e36e9.png",
            currentSrc: "https://ghost.example/blog/content/images/size/w2000/2026/09/0807f6dcaf2bc3dcd9054bc70b1e54aec712ca729956cdf4938cfa85894e36e9.png",
        });
        expect(differentFile.images[0].found).toBe(false);
        expect(evaluateGhostPreviewProbe(expected, differentFile).issues).toEqual(["image-unavailable"]);

        const otherOrigin = runGeneratedImageProbe({
            src: "/blog/content/images/size/w1200/2026/09/e5e94ce175f197b295e4ed5d27db99c0c3bc11b5a55f54f2e064c6815dbfeafe.png",
            currentSrc: "https://other.example/content/images/size/w2000/2026/09/e5e94ce175f197b295e4ed5d27db99c0c3bc11b5a55f54f2e064c6815dbfeafe.png",
        });
        expect(otherOrigin.images[0].found).toBe(false);
        expect(evaluateGhostPreviewProbe(expected, otherOrigin).issues).toEqual(["image-unavailable"]);
    });
});

describe("native Ghost preview receipt lifecycle", () => {
    it("opens through native setViewState, reuses native navigate and invalidates the previous candidate receipt", async () => {
        const f = fixture();
        const first = await f.adapter.check(f.target, gate());
        expect(first.passed).toBe(true);
        expect(first.isCurrent()).toBe(true);
        expect(f.leaf.setViewState).toHaveBeenCalledWith({ type: "webviewer", state: { url: URL }, active: true });
        expect(f.view.navigate).toHaveBeenCalledWith(URL, false);
        expect(f.adapter.getDiagnostics()).toMatchObject({ status: "passed", unsupportedCodeCount: 1 });
        const second = await f.adapter.check({ ...f.target, candidateHash: "candidate-two" }, gate());
        expect(second.passed).toBe(true);
        expect(first.isCurrent()).toBe(false);
        expect(f.host.workspace.getLeaf).toHaveBeenCalledTimes(1);
        expect(f.leaf.setViewState).toHaveBeenCalledTimes(1);
        expect(f.view.navigate).toHaveBeenCalledTimes(2);
        f.revokeCandidate();
        expect(second.isCurrent()).toBe(false);
        f.adapter.dispose();
        expect(f.frame.listenerCount()).toBe(0);
        expect(f.leaves).toEqual([f.leaf]);
    });

    it("invalidates receipts on native loading, navigation, destruction and close without closing the user's leaf", async () => {
        for (const event of ["did-start-loading", "did-navigate-in-page", "destroyed", "close"]) {
            const f = fixture();
            const check = await f.adapter.check(f.target, gate());
            expect(check.isCurrent()).toBe(true);
            f.frame.emit(event);
            expect(check.isCurrent()).toBe(false);
            expect(f.adapter.getDiagnostics().status).toBe("invalidated");
            if (["destroyed", "close"].includes(event)) expect(f.frame.listenerCount()).toBe(0);
            f.adapter.dispose();
            expect(f.frame.listenerCount()).toBe(0);
            expect(f.leaves).toHaveLength(1);
        }
    });

    it("requires a fresh load and refuses an old, hidden or error-mode webview even at the expected URL", async () => {
        const stale = fixture();
        stale.view.navigate = () => {}; // Same URL alone is not evidence of this navigation.
        expect((await stale.adapter.check(stale.target, gate())).passed).toBe(false);
        expect(stale.frame.executeJavaScript).not.toHaveBeenCalled();
        stale.adapter.dispose();
        for (const hidden of [true, false]) {
            const f = fixture();
            if (hidden) f.frame.offsetWidth = 0;
            else f.view.mode = "error";
            expect((await f.adapter.check(f.target, gate())).passed).toBe(false);
            expect(f.frame.executeJavaScript).not.toHaveBeenCalled();
            f.adapter.dispose();
        }
    });

    it("detects a removed or replaced webview when checking a previously passing receipt", async () => {
        const f = fixture();
        const check = await f.adapter.check(f.target, gate());
        expect(check.isCurrent()).toBe(true);
        f.view.containerEl.querySelector = () => new NativeFrame();
        expect(check.isCurrent()).toBe(false);
        f.adapter.dispose();
    });

    it("does not open a viewer on mobile, enable a disabled core plugin or replace an unavailable native API", async () => {
        for (const options of [{ isDesktop: () => false }, { isWebViewerEnabled: () => false }]) {
            const f = fixture(options);
            expect((await f.adapter.check(f.target, gate())).passed).toBe(false);
            expect(f.host.workspace.getLeaf).not.toHaveBeenCalled();
            expect(f.frame.executeJavaScript).not.toHaveBeenCalled();
            expect(f.adapter.getDiagnostics().reason).toBe(options.isDesktop ? "desktop-required" : "enable-web-viewer");
            expect(f.adapter.systemBrowserUrl(URL)).toBe(URL);
            f.adapter.dispose();
        }
        const unsupported = fixture();
        unsupported.leaf.view = { containerEl: { querySelector: () => unsupported.frame } };
        expect((await unsupported.adapter.check(unsupported.target, gate())).passed).toBe(false);
        expect(unsupported.frame.executeJavaScript).not.toHaveBeenCalled();
        expect(unsupported.adapter.getDiagnostics().reason).toBe("native-capability-unavailable");
        unsupported.adapter.dispose();
    });

    it("revokes an in-flight check on navigation and releases its waits/listeners on dispose", async () => {
        const f = fixture();
        let finish!: (value: unknown) => void;
        let entered!: () => void;
        const executing = new Promise<void>((resolve) => { entered = resolve; });
        f.frame.executeJavaScript.mockImplementation(async () => {
            entered();
            return new Promise((resolve) => { finish = resolve; });
        });
        const pending = f.adapter.check(f.target, gate());
        await executing;
        f.frame.emit("did-start-loading");
        finish(success());
        expect((await pending).passed).toBe(false);

        f.frame.executeJavaScript.mockImplementation(async () => { entered(); return new Promise(() => {}); });
        const another = f.adapter.check(f.target, gate());
        await new Promise<void>((resolve) => setImmediate(resolve));
        f.adapter.dispose();
        expect((await another).passed).toBe(false);
        expect(f.frame.listenerCount()).toBe(0);
        expect(f.leaves).toHaveLength(1);
    });

    it("keeps exceptions, page addresses and preview tokens out of diagnostics and rejects source cancellation", async () => {
        const f = fixture();
        f.frame.executeJavaScript.mockRejectedValue(new Error(`${URL}?preview=private-token raw article`));
        const result = await f.adapter.check(f.target, gate());
        expect(result.passed).toBe(false);
        const diagnostics = JSON.stringify(f.adapter.getDiagnostics());
        expect(diagnostics).not.toContain(URL);
        expect(diagnostics).not.toContain("private-token");
        expect(diagnostics).not.toContain("raw article");
        f.adapter.dispose();
        const denied = fixture();
        const controller = new AbortController();
        const denial = await denied.adapter.check(denied.target, gate({ signal: controller.signal, beforeSend: async () => { controller.abort(); } }));
        expect(denial.passed).toBe(false);
        expect(denied.host.workspace.getLeaf).not.toHaveBeenCalled();
        denied.adapter.dispose();
    });
});
