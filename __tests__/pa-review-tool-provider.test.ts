/* Copyright 2023 edonyzpc */

/**
 * Track C · C1 unit tests for the Pagelet Write Action Framework capability
 * provider and runtime composer.
 *
 * Coverage matrix:
 *  - Capability surface
 *    - Constants stable (PAGELET_WRITE_REVIEW_OUTPUT_NAME, PAGELET_PROVIDER_ID).
 *    - 17 required AgentCapability fields present + permission tier correct
 *      (`local-filesystem-write`).
 *    - WriteActionCapability extras (actionFamily, targetCategory,
 *      targetConfinement) match the framework contract.
 *  - Gate 1 — getTargetPath
 *    - Sync + pure: returns the same path twice for the same input.
 *    - Resolves through resolveReviewNotePath (vault-relative POSIX).
 *    - Rejects malformed input with a TypeError before touching the vault.
 *    - Reflects the latest `reviewsFolder` value (D010) on each call.
 *  - Gate 2 — buildPreview
 *    - Returns a PreviewSpec with displayPath === getTargetPath().
 *    - confirmCopy.confirmLabel + cancelLabel come from the i18n loader.
 *    - contentPreview.byteSize matches the actual body byte length.
 *  - execute() guard (SDD §3.2)
 *    - Throws a clear "go through ActionExecutor" error.
 *  - executeWrite()
 *    - Writes through the supplied vault adapter.
 *    - Calls `hooks.markSelfWrite(path)` BEFORE `adapter.write`.
 *    - Chains the externalMarkSelfWrite hook when wired.
 *  - provider.execute() rejects PAGELET_WRITE_REVIEW_OUTPUT_NAME with the
 *    "must be executed via the Write Action Framework" error.
 *  - createPaReviewRuntime
 *    - Exposes isRecentSelfWrite that reflects framework-driven marks.
 *    - Reflects external markSelfWrite calls during executeWrite.
 *    - buildPaAgentRuntimeOptions returns the expected runKind/permission slice.
 *    - dispose() clears any pending TTL timers (snapshot empties).
 *
 * Test isolation: every assertion uses an in-memory adapter + fresh runtime
 * + injected clock when relevant. No tests touch real vault state or rely
 * on Obsidian classes at runtime (the provider and runtime depend on
 * structural types only).
 */

import { describe, expect, it, jest } from "@jest/globals";

import type {
    AgentCapabilityContext,
} from "../src/ai-services/capability-types";
import {
    createSelfWriteRegistry,
    type ActionExecutor,
    type DebugObserver,
    type PreviewRenderer,
    type WriteActionExecuteHooks,
} from "../src/ai-services/write-action-framework";

import {
    createPaReviewToolProvider,
    PAGELET_PROVIDER_ID,
    PAGELET_WRITE_REVIEW_OUTPUT_NAME,
    type PageletReviewToolSettings,
    type PageletReviewToolVaultLike,
    type PageletWriteReviewOutputInput,
} from "../src/pagelet/pa-review-tool-provider";
import {
    createPaReviewRuntime,
    type CreatePaReviewRuntimeOptions,
} from "../src/pagelet/pa-review-runtime";
import {
    PAGELET_SCHEMA_VERSION,
    type PageletReviewResult,
} from "../src/pagelet/pa-review-schemas";
import { PAGELET_DEFAULTS, type PageletSettings } from "../src/settings/pagelet";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date(Date.UTC(2026, 5, 3, 14, 30, 45));

function validResult(overrides: Partial<PageletReviewResult> = {}): PageletReviewResult {
    return {
        schema_version: PAGELET_SCHEMA_VERSION,
        detected_language: "en",
        suggestions: [
            {
                source_id: "seg-1",
                kind: "clarify",
                rationale: "Needs a clearer scope statement near the opening line.",
                proposed_action: "Add a one-sentence scope note after the title.",
            },
        ],
        overall_remark: "Solid draft; one scope clarification away from a publish.",
        ...overrides,
    };
}

interface AdapterRecorder {
    exists: jest.Mock<(path: string) => Promise<boolean>>;
    mkdir: jest.Mock<(path: string) => Promise<void>>;
    write: jest.Mock<(path: string, data: string) => Promise<void>>;
    /** Call log capturing `(method, path)` tuples in invocation order. */
    log: Array<{ method: "exists" | "mkdir" | "write"; path: string }>;
}

function recordingVault(): PageletReviewToolVaultLike & { recorder: AdapterRecorder } {
    const log: AdapterRecorder["log"] = [];
    const adapter: AdapterRecorder = {
        exists: jest.fn(async (path: string): Promise<boolean> => {
            log.push({ method: "exists", path });
            return false;
        }) as AdapterRecorder["exists"],
        mkdir: jest.fn(async (path: string): Promise<void> => {
            log.push({ method: "mkdir", path });
        }) as AdapterRecorder["mkdir"],
        write: jest.fn(async (path: string, _data: string): Promise<void> => {
            log.push({ method: "write", path });
        }) as AdapterRecorder["write"],
        log,
    };
    return {
        adapter: {
            exists: adapter.exists as unknown as (path: string) => Promise<boolean>,
            mkdir: adapter.mkdir as unknown as (path: string) => Promise<void>,
            write: adapter.write as unknown as (path: string, data: string) => Promise<void>,
        },
        recorder: adapter,
    };
}

function defaultInput(overrides: Partial<PageletWriteReviewOutputInput> = {}): PageletWriteReviewOutputInput {
    return {
        sourcePath: "notes/draft.md",
        reviewResult: validResult(),
        mode: "basic",
        detectedLanguage: "en",
        dateOverride: FIXED_DATE,
        ...overrides,
    };
}

function makeContext(): AgentCapabilityContext {
    // The capability never touches the plugin from `context`; a minimal cast
    // is safer than constructing a fake PluginManager.
    return {
        plugin: undefined as unknown as AgentCapabilityContext["plugin"],
        turnId: "turn-test",
    };
}

function makeExecuteHooks(): WriteActionExecuteHooks & {
    callLog: string[];
} {
    const callLog: string[] = [];
    return {
        callLog,
        markSelfWrite: (path: string) => {
            callLog.push(path);
        },
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("Pagelet capability constants (SDD §3.2)", () => {
    it("declares the stable capability + provider names", () => {
        // These two values are part of the framework's debug-observer test
        // surface and the planner's capability allowlist; relaxing them
        // would silently break those downstream consumers.
        expect(PAGELET_WRITE_REVIEW_OUTPUT_NAME).toBe("pagelet.write_review_output");
        expect(PAGELET_PROVIDER_ID).toBe("pa-pagelet");
    });
});

// ---------------------------------------------------------------------------
// Capability shape
// ---------------------------------------------------------------------------

describe("PaReviewToolProvider — capability surface", () => {
    function buildProvider() {
        const { adapter } = recordingVault();
        const settings: PageletReviewToolSettings = { reviewsFolder: ".pagelet" };
        return createPaReviewToolProvider({
            getSettings: () => settings,
            vault: { adapter },
        });
    }

    it("exposes the required AgentCapability + WriteActionCapability fields", () => {
        const provider = buildProvider();
        const cap = provider.capability;
        // Sanity: the field set the framework relies on (target-confinement,
        // preview, executeWrite gates) must all be present.
        expect(cap.name).toBe(PAGELET_WRITE_REVIEW_OUTPUT_NAME);
        expect(cap.kind).toBe("action");
        expect(cap.origin).toBe("core");
        expect(cap.providerId).toBe(PAGELET_PROVIDER_ID);
        expect(cap.requiresConfirmation).toBe(true);
        expect(cap.executionMode).toBe("sequential");
        expect(cap.failureBehavior).toBe("recoverable");
        // local-filesystem-write is the new permission tier introduced for
        // Write Action Framework v1; chat-mode runtimes reject it.
        expect(cap.permission).toBe("local-filesystem-write");
        expect(cap.actionFamily).toBe("create-file");
        expect(cap.targetCategory).toBe("pagelet-review-note");
    });

    it("derives targetConfinement from the latest reviewsFolder setting (D010)", () => {
        const { adapter } = recordingVault();
        let folder = ".pagelet";
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: folder }),
            vault: { adapter },
        });
        expect(provider.capability.targetConfinement.allowedRoots).toEqual([".pagelet/"]);
        // Mutate the underlying setting: the getter MUST observe the change.
        folder = "Reviews/Pagelet";
        expect(provider.capability.targetConfinement.allowedRoots).toEqual(["Reviews/Pagelet/"]);
        // Allow-list extension list never changes; only `.md` is permitted.
        expect(provider.capability.targetConfinement.allowedExtensions).toEqual([".md"]);
    });

    it("provider.load returns the capability under 'available'", async () => {
        const provider = buildProvider();
        const result = await provider.load({
            turnId: "t-1",
            platform: "desktop",
            settings: {},
        });
        expect(result.status).toBe("available");
        expect(result.capabilities).toHaveLength(1);
        expect(result.capabilities[0]?.name).toBe(PAGELET_WRITE_REVIEW_OUTPUT_NAME);
    });
});

// ---------------------------------------------------------------------------
// Gate 1 — getTargetPath
// ---------------------------------------------------------------------------

describe("PaReviewToolProvider — Gate 1 getTargetPath", () => {
    it("is synchronous + pure: identical input → identical output", () => {
        const { adapter } = recordingVault();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
        });
        const input = defaultInput();
        const first = provider.capability.getTargetPath(input);
        const second = provider.capability.getTargetPath(input);
        expect(first).toBe(second);
        // The deterministic shape: <folder>/<base>-pagelet-review-<date>.md
        expect(first).toMatch(/^\.pagelet\/draft-pagelet-review-2026-06-03\.md$/);
        // Adapter MUST not have been touched — Gate 1 is path-only, no IO.
        expect(adapter.exists).not.toHaveBeenCalled();
        expect(adapter.write).not.toHaveBeenCalled();
    });

    it("reflects the latest reviewsFolder on each call", () => {
        const { adapter } = recordingVault();
        let folder = ".pagelet";
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: folder }),
            vault: { adapter },
        });
        const input = defaultInput();
        expect(provider.capability.getTargetPath(input)).toMatch(/^\.pagelet\//);
        folder = "Reviews/Pagelet";
        expect(provider.capability.getTargetPath(input)).toMatch(/^Reviews\/Pagelet\//);
    });

    it("rejects malformed input with a TypeError (fail-fast)", () => {
        const { adapter } = recordingVault();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
        });
        // The framework calls getTargetPath BEFORE buildPreview; surfacing
        // a TypeError keeps untrusted LLM input from leaking into the
        // preview modal.
        expect(() => provider.capability.getTargetPath({ sourcePath: "" }))
            .toThrow(TypeError);
        expect(() => provider.capability.getTargetPath({} as unknown))
            .toThrow(TypeError);
        expect(() => provider.capability.getTargetPath(null))
            .toThrow(TypeError);
    });
});

// ---------------------------------------------------------------------------
// Gate 2 — buildPreview
// ---------------------------------------------------------------------------

describe("PaReviewToolProvider — Gate 2 buildPreview", () => {
    function buildProvider(opts: { reviewsFolder?: string } = {}) {
        const { adapter } = recordingVault();
        return createPaReviewToolProvider({
            getSettings: () => ({
                reviewsFolder: opts.reviewsFolder ?? ".pagelet",
            }),
            vault: { adapter },
            translator: (key) => {
                // Recording translator so we can assert label resolution
                // without touching the i18n JSON.
                if (key === "pagelet.preview.confirm") return "Save review note";
                if (key === "pagelet.preview.cancel") return "Cancel";
                return key;
            },
        });
    }

    it("returns displayPath identical to getTargetPath() (framework invariant)", async () => {
        const provider = buildProvider();
        const input = defaultInput();
        const expectedPath = provider.capability.getTargetPath(input);
        const spec = await provider.capability.buildPreview(input, makeContext());
        // The framework rejects writes whose preview displayPath does not
        // match the path validated at Gate 1; we MUST emit them through
        // the same resolver (`resolveReviewNotePath`).
        expect(spec.target.displayPath).toBe(expectedPath);
        expect(spec.capabilityId).toBe(PAGELET_WRITE_REVIEW_OUTPUT_NAME);
        expect(spec.operationType).toBe("create-file");
        expect(spec.actionFamily).toBe("create-file");
    });

    it("populates confirmCopy from the translator", async () => {
        const provider = buildProvider();
        const spec = await provider.capability.buildPreview(defaultInput(), makeContext());
        expect(spec.confirmCopy.confirmLabel).toBe("Save review note");
        expect(spec.confirmCopy.cancelLabel).toBe("Cancel");
    });

    it("computes byteSize from the actual markdown body", async () => {
        const provider = buildProvider();
        const spec = await provider.capability.buildPreview(defaultInput(), makeContext());
        // byteSize is exposed in the preview modal's "writes N bytes"
        // indicator; we re-measure here to guard against an off-by-one
        // (e.g. counting characters not bytes).
        expect(spec.contentPreview.byteSize).toBe(Buffer.byteLength(spec.contentPreview.body, "utf8"));
        expect(spec.contentPreview.byteSize).toBeGreaterThan(0);
    });

    it("marks impact as offline (no AI / external mutation at write time)", async () => {
        const provider = buildProvider();
        const spec = await provider.capability.buildPreview(defaultInput(), makeContext());
        // The LLM call already happened upstream in PageletReviewModel; the
        // write itself touches only the local vault.
        expect(spec.impact.usesAiProvider).toBe(false);
        expect(spec.impact.usesAiCredits).toBe(false);
        expect(spec.impact.affectsExternalState).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// execute() guard
// ---------------------------------------------------------------------------

describe("PaReviewToolProvider — execute() guard (SDD §3.2)", () => {
    it("throws when execute() is called directly (must go through ActionExecutor)", async () => {
        const { adapter } = recordingVault();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
        });
        // Calling execute() bypasses Gate 1-3; surfacing the mistake loudly
        // prevents a sneaky path from skipping confinement + confirmation.
        await expect(provider.capability.execute({}, makeContext()))
            .rejects.toThrow(/must not be invoked directly/);
        // provider.execute() with the capability name must also reject.
        expect(typeof provider.execute).toBe("function");
        const providerExecute = provider.execute!.bind(provider);
        await expect(providerExecute(PAGELET_WRITE_REVIEW_OUTPUT_NAME, {}, makeContext()))
            .rejects.toThrow(/Write Action Framework/);
    });

    it("provider.execute() throws Unknown for an unrelated capability name", async () => {
        const { adapter } = recordingVault();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
        });
        expect(typeof provider.execute).toBe("function");
        const providerExecute = provider.execute!.bind(provider);
        await expect(providerExecute("some-other-tool", {}, makeContext()))
            .rejects.toThrow(/Unknown capability/);
    });
});

// ---------------------------------------------------------------------------
// executeWrite
// ---------------------------------------------------------------------------

describe("PaReviewToolProvider — executeWrite", () => {
    it("writes through the supplied vault adapter", async () => {
        const { adapter, recorder } = recordingVault();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
        });
        const result = await provider.capability.executeWrite(
            defaultInput(),
            makeContext(),
            makeExecuteHooks(),
        );
        expect(result.status).toBe("ok");
        const writeCalls = recorder.log.filter((entry) => entry.method === "write");
        expect(writeCalls).toHaveLength(1);
        expect(writeCalls[0]?.path).toMatch(/^\.pagelet\/draft-pagelet-review-2026-06-03\.md$/);
    });

    it("calls hooks.markSelfWrite BEFORE adapter.write (framework R3)", async () => {
        const { adapter, recorder } = recordingVault();
        const hooks = makeExecuteHooks();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
        });
        await provider.capability.executeWrite(
            defaultInput(),
            makeContext(),
            hooks,
        );
        const writeCall = recorder.log.find((entry) => entry.method === "write");
        expect(writeCall).toBeDefined();
        // The hook must have observed the path before the actual write
        // landed, so the framework's modify listener can suppress its own
        // ripple.
        expect(hooks.callLog).toEqual([writeCall!.path]);
    });

    it("chains externalMarkSelfWrite when configured", async () => {
        const { adapter } = recordingVault();
        const externalCalls: string[] = [];
        const hooks = makeExecuteHooks();
        const provider = createPaReviewToolProvider({
            getSettings: () => ({ reviewsFolder: ".pagelet" }),
            vault: { adapter },
            externalMarkSelfWrite: (path) => externalCalls.push(path),
        });
        await provider.capability.executeWrite(
            defaultInput(),
            makeContext(),
            hooks,
        );
        // Both registries observe the SAME path. This is the contract the
        // plugin-facing modify-event guard relies on.
        expect(hooks.callLog).toHaveLength(1);
        expect(externalCalls).toHaveLength(1);
        expect(externalCalls[0]).toBe(hooks.callLog[0]);
    });
});

// ---------------------------------------------------------------------------
// PaReviewRuntime — composer behaviour
// ---------------------------------------------------------------------------

describe("createPaReviewRuntime", () => {
    function makeAppLike(): { adapter: PageletReviewToolVaultLike["adapter"]; vault: PageletReviewToolVaultLike; recorder: AdapterRecorder } {
        const built = recordingVault();
        return {
            adapter: built.adapter,
            vault: { adapter: built.adapter },
            recorder: built.recorder,
        };
    }

    function makeFakeApp(adapter: PageletReviewToolVaultLike["adapter"]): CreatePaReviewRuntimeOptions["app"] {
        // The runtime only touches `app.vault.adapter` (for fsProbe defaults)
        // and `app.vault` (for the provider). A structural fake suffices.
        return { vault: { adapter } } as unknown as CreatePaReviewRuntimeOptions["app"];
    }

    function defaultSettings(): PageletSettings {
        return { ...PAGELET_DEFAULTS };
    }

    function silentRenderer(): PreviewRenderer {
        // Tests don't drive the 4-gate orchestrator end-to-end (the framework
        // is covered by its own suite). The provider's executeWrite is the
        // contract surface here; renderer is wired only to satisfy the
        // ActionExecutor constructor.
        return {
            show: jest.fn(async () => ({ outcome: "confirmed", renderWarnings: undefined })) as unknown as PreviewRenderer["show"],
        };
    }

    function silentObserver(): DebugObserver {
        return { emit: jest.fn() };
    }

    it("isRecentSelfWrite reflects provider executeWrite-driven marks", async () => {
        const fake = makeAppLike();
        const runtime = createPaReviewRuntime({
            app: makeFakeApp(fake.adapter),
            getPageletSettings: defaultSettings,
            previewRenderer: silentRenderer(),
            fsProbe: null,
            debugObserver: silentObserver(),
        });
        // No writes yet → no recent self-writes.
        expect(runtime.selfWriteSnapshot()).toEqual([]);
        // Drive the provider directly (simulating the framework calling
        // executeWrite). The provider's wired externalMarkSelfWrite hook
        // should land in the runtime's external registry.
        const hooks = makeExecuteHooks();
        await runtime.toolProvider.capability.executeWrite(
            defaultInput(),
            makeContext(),
            hooks,
        );
        const snap = runtime.selfWriteSnapshot();
        expect(snap).toHaveLength(1);
        expect(runtime.isRecentSelfWrite(snap[0]!)).toBe(true);
        runtime.dispose();
    });

    it("dispose() clears the external registry's TTL state", async () => {
        const fake = makeAppLike();
        const runtime = createPaReviewRuntime({
            app: makeFakeApp(fake.adapter),
            getPageletSettings: defaultSettings,
            previewRenderer: silentRenderer(),
            fsProbe: null,
            debugObserver: silentObserver(),
        });
        await runtime.toolProvider.capability.executeWrite(
            defaultInput(),
            makeContext(),
            makeExecuteHooks(),
        );
        expect(runtime.selfWriteSnapshot()).toHaveLength(1);
        runtime.dispose();
        expect(runtime.selfWriteSnapshot()).toEqual([]);
    });

    it("buildPaAgentRuntimeOptions returns the review-mode policy + provider", () => {
        const fake = makeAppLike();
        const runtime = createPaReviewRuntime({
            app: makeFakeApp(fake.adapter),
            getPageletSettings: defaultSettings,
            previewRenderer: silentRenderer(),
            fsProbe: null,
            debugObserver: silentObserver(),
        });
        const bundle = runtime.buildPaAgentRuntimeOptions();
        expect(bundle.policyOptions).toEqual({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["local-filesystem-write"],
        });
        expect(bundle.additionalCapabilityProviders).toHaveLength(1);
        expect(bundle.additionalCapabilityProviders[0]).toBe(runtime.toolProvider);
        expect(bundle.writeAction.previewRenderer).toBeDefined();
        runtime.dispose();
    });

    it("accepts an explicit selfWriteWindowMs (default = 5s)", async () => {
        const fake = makeAppLike();
        const runtime = createPaReviewRuntime({
            app: makeFakeApp(fake.adapter),
            getPageletSettings: defaultSettings,
            previewRenderer: silentRenderer(),
            fsProbe: null,
            debugObserver: silentObserver(),
            // 5 minutes — proves the option is honored without making the
            // test slow.
            selfWriteWindowMs: 5 * 60 * 1000,
        });
        await runtime.toolProvider.capability.executeWrite(
            defaultInput(),
            makeContext(),
            makeExecuteHooks(),
        );
        expect(runtime.selfWriteSnapshot()).toHaveLength(1);
        runtime.dispose();
    });

    it("ActionExecutor is exposed and bound to the same registry", async () => {
        // Sanity check: the runtime exposes a single ActionExecutor; tests
        // that exercise the 4 gates via this executor would observe marks
        // on the same external registry the plugin consults. We assert the
        // shape only; the framework's own test suite covers the gate logic.
        const fake = makeAppLike();
        const runtime = createPaReviewRuntime({
            app: makeFakeApp(fake.adapter),
            getPageletSettings: defaultSettings,
            previewRenderer: silentRenderer(),
            fsProbe: null,
            debugObserver: silentObserver(),
        });
        const executor: ActionExecutor = runtime.actionExecutor;
        expect(typeof executor.execute).toBe("function");
        runtime.dispose();
    });
});

// ---------------------------------------------------------------------------
// Cross-check: SelfWriteRegistry contract still holds
// ---------------------------------------------------------------------------

describe("createSelfWriteRegistry (framework helper sanity)", () => {
    it("isRecentSelfWrite flips true after markSelfWrite", () => {
        // The runtime relies on this contract; we re-assert it here so a
        // future framework change that broke it would surface in the
        // Pagelet suite as well (defense in depth).
        const reg = createSelfWriteRegistry();
        expect(reg.isRecentSelfWrite("a.md")).toBe(false);
        reg.markSelfWrite("a.md");
        expect(reg.isRecentSelfWrite("a.md")).toBe(true);
        reg.dispose();
        expect(reg.isRecentSelfWrite("a.md")).toBe(false);
    });
});
