import { readFile } from "node:fs/promises";
import { CodemodeSandboxBase, type VmLauncher } from "../src/third_party/pi-codemode/runtime/execution";
import { inlineLauncher } from "../src/third_party/pi-codemode/runtime/inline";
import { bridgeJsonByteLength } from "../src/third_party/pi-codemode/runtime/protocol";
import { OBSIDIAN_CODE_CALL_RESOURCE_LIMITS } from "../src/ai-services/independent-computation/obsidian-code-runtime";

jest.mock("obsidian");

const wasm = readFile("node_modules/quickjs-wasi/quickjs.wasm").then(bytes => WebAssembly.compile(bytes));

describe("composed RPC protocol boundaries", () => {
    it("builds nested namespaces once and decodes only declared binary results including empty files", async () => {
        const sandbox = new CodemodeSandboxBase({
            timeoutMs: 2_000,
            globals: [
                { name: "obsidian.vault.readText", execute: () => ({ ok: true, value: { text: "raw" } }) },
                { name: "obsidian.vault.readBinary", binaryResult: true,
                    execute: args => ({ ok: true, value: { bytes: { __bytesBase64: args ? "AAH/" : "" } } }) },
                { name: "obsidian.metadata.inspect", execute: () => ({ properties: { __bytesBase64: "AAH/" } }) },
            ],
            tools: [{ name: "collision", execute: () => ({ value: { bytes: { __bytesBase64: "AAH/" } } }) }],
            callResourceLimits: OBSIDIAN_CODE_CALL_RESOURCE_LIMITS,
        }, inlineLauncher(await wasm));
        const result = await sandbox.execute(`
            const text = await obsidian.vault.readText();
            const full = await obsidian.vault.readBinary(true);
            const empty = await obsidian.vault.readBinary(false);
            return { text: text.value.text, full: [...full.value.bytes], typed: full.value.bytes instanceof Uint8Array,
                empty: empty.value.bytes.byteLength, properties: (await obsidian.metadata.inspect()).properties,
                collision: await tools.collision(), names: ALL_TOOLS.map(t => t.name) };
        `);
        expect(result).toMatchObject({ ok: true, value: { text: "raw", full: [0, 1, 255], typed: true, empty: 0,
            properties: { __bytesBase64: "AAH/" }, collision: { value: { bytes: { __bytesBase64: "AAH/" } } }, names: ["collision"] } });
        await sandbox.close();
    });

    it("explains missing members from the actual roots and namespace members without host calls", async () => {
        const calls: string[] = [];
        const sandbox = new CodemodeSandboxBase({
            timeoutMs: 2_000,
            callResourceLimits: OBSIDIAN_CODE_CALL_RESOURCE_LIMITS,
            globals: [{ name: "obsidian.metadata.links", execute: input => {
                calls.push("obsidian.metadata.links");
                return input;
            } }, { name: "utility.ping", execute: input => {
                calls.push("utility.ping");
                return input;
            } }],
            tools: [{ name: "inspect_obsidian_note", execute: input => {
                calls.push("inspect_obsidian_note");
                return input;
            } }],
        }, inlineLauncher(await wasm));
        try {
            const result = await sandbox.execute(`
                const attempt = async action => {
                    try { return await action(); } catch (error) { return error.message; }
                };
                return {
                    wrongRoot: await attempt(() => tools.obsidian.metadata.links({target: {path: "Cat.md"}})),
                    twoPartRoot: await attempt(() => tools.utility.ping()),
                    ordinaryTypo: await attempt(() => tools.inspect_obsidian_not({path: "Cat.md"})),
                    sdkTypo: await attempt(() => obsidian.metadata.link({target: {path: "Cat.md"}})),
                };
            `);
            expect(result).toMatchObject({ ok: true });
            if (!result.ok) throw new Error(result.error.message);
            const messages = result.value as {
                wrongRoot: string; twoPartRoot: string; ordinaryTypo: string; sdkTypo: string;
            };
            expect(messages.wrongRoot).toContain("tools.obsidian does not exist");
            expect(messages.wrongRoot).toContain("obsidian is a top-level namespace");
            expect(messages.twoPartRoot).toContain("tools.utility does not exist");
            expect(messages.twoPartRoot).toContain("utility is a top-level namespace");
            expect(messages.twoPartRoot).toContain("bound top-level members: ping");
            expect(messages.twoPartRoot).not.toContain("utility.<namespace>.<method>(args)");
            expect(messages.wrongRoot).toContain("ALL_TOOLS lists the names and descriptions of bound ordinary tools only");
            expect(messages.wrongRoot).not.toContain("inspect_obsidian_note");
            expect(messages.wrongRoot).not.toContain("metadata.links");
            expect(messages.wrongRoot).not.toContain("searchTools");
            expect(messages.ordinaryTypo).toContain("tools.inspect_obsidian_note");
            expect(messages.ordinaryTypo).not.toContain("obsidian.metadata.links");
            expect(messages.ordinaryTypo).not.toContain("searchTools");
            expect(messages.sdkTypo).toContain("obsidian.metadata.links");
            expect(messages.sdkTypo).not.toContain("searchTools");
            expect(calls).toEqual([]);
        } finally {
            await sandbox.close();
        }

        const empty = new CodemodeSandboxBase({
            timeoutMs: 2_000,
            globals: [{ name: "obsidian.metadata.links", execute: input => input }],
        }, inlineLauncher(await wasm));
        try {
            const result = await empty.execute(`
                const attempt = async action => {
                    try { return await action(); } catch (error) { return error.message; }
                };
                return {
                    wrongRoot: await attempt(() => tools.obsidian),
                    unknownTool: await attempt(() => tools.unrelated),
                    allTools: ALL_TOOLS.map(tool => tool.name),
                };
            `);
            expect(result).toMatchObject({ ok: true });
            if (!result.ok) throw new Error(result.error.message);
            const value = result.value as { wrongRoot: string; unknownTool: string; allTools: string[] };
            expect(value.allTools).toEqual([]);
            expect(value.wrongRoot).toContain("tools.obsidian does not exist");
            expect(value.wrongRoot).toContain("obsidian is a top-level namespace");
            expect(value.wrongRoot).toContain("bound top-level members: metadata");
            expect(value.wrongRoot).not.toContain("Available:");
            expect(value.wrongRoot).not.toContain("searchTools");
            expect(value.unknownTool).toContain("No ordinary tools are bound in this script");
            expect(value.unknownTool).not.toContain("unavailable");
            expect(value.unknownTool).not.toContain("Available:");
            expect(value.unknownTool).not.toContain("searchTools");
        } finally {
            await empty.close();
        }

        const noGlobals = new CodemodeSandboxBase({ timeoutMs: 2_000 }, inlineLauncher(await wasm));
        try {
            const result = await noGlobals.execute(`
                try { tools.obsidian; } catch (error) { return error.message; }
            `);
            expect(result).toMatchObject({ ok: true });
            if (!result.ok) throw new Error(result.error.message);
            const message = result.value as string;
            expect(message).toContain("tools.obsidian does not exist");
            expect(message).not.toContain("obsidian is a top-level");
            expect(message).not.toContain("Available:");
            expect(message).not.toContain("searchTools");
        } finally {
            await noGlobals.close();
        }
    });

    it("keeps an ordinary member with the same name as a root and describes a root function accurately", async () => {
        const calls: string[] = [];
        const sandbox = new CodemodeSandboxBase({
            timeoutMs: 2_000,
            callResourceLimits: OBSIDIAN_CODE_CALL_RESOURCE_LIMITS,
            globals: [
                { name: "obsidian.metadata.links", execute: input => input },
                { name: "helper", execute: input => {
                    calls.push("helper");
                    return input;
                } },
            ],
            tools: [{ name: "obsidian", execute: input => {
                calls.push("tools.obsidian");
                return input;
            } }],
        }, inlineLauncher(await wasm));
        try {
            const result = await sandbox.execute(`
                let missingRoot;
                try { tools.helper; } catch (error) { missingRoot = error.message; }
                return {
                    rootType: typeof obsidian.metadata.links,
                    direct: await tools.obsidian("called"),
                    missingRoot,
                };
            `);
            expect(result).toMatchObject({ ok: true, value: { rootType: "function", direct: "called" } });
            if (!result.ok) throw new Error(result.error.message);
            const value = result.value as { missingRoot: string };
            expect(value.missingRoot).toContain("tools.helper does not exist");
            expect(value.missingRoot).toContain("helper is a top-level function");
            expect(value.missingRoot).toContain("call helper(...)");
            expect(value.missingRoot).not.toContain("helper is a top-level namespace");
            expect(calls).toEqual(["tools.obsidian"]);
        } finally {
            await sandbox.close();
        }
    });

    it("reserves a live sender slot before serialization and drains more calls than the in-flight allowance", async () => {
        let release!: () => void;
        const first = new Promise<void>(resolve => { release = resolve; });
        let entered = 0;
        let reportStarted!: () => void;
        const started = new Promise<void>(resolve => { reportStarted = resolve; });
        const output: string[] = [];
        const launch = inlineLauncher(await wasm);
        const sandbox = new CodemodeSandboxBase({ timeoutMs: 2_000,
            callResourceLimits: { ...OBSIDIAN_CODE_CALL_RESOURCE_LIMITS, maxInflightCalls: 1 },
            tools: [{ name: "work", execute: async input => {
                entered++;
                if (entered === 1) { reportStarted(); await first; }
                return input;
            } }],
        }, (data, events) => launch(data, { ...events, message: message => {
            if ((message as { type?: string }).type === "output") output.push((message as { item: { text: string } }).item.text);
            events.message(message);
        } }));
        const resultPromise = sandbox.execute(`
            let serialized = 0;
            const calls = Array.from({length: 20}, (_, index) => tools.work({toJSON() { serialized++; return index; }}));
            text(serialized);
            return await Promise.all(calls);
        `);
        await started;
        expect(output).toEqual(["1"]);
        expect(entered).toBe(1);
        release();
        expect(await resultPromise).toMatchObject({ ok: true, value: Array.from({ length: 20 }, (_, index) => index) });
        expect(entered).toBe(20);
        await sandbox.close();
    });

    it("waits for live byte capacity before sending individually valid SDK calls", async () => {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let reportStarted!: () => void;
        const started = new Promise<void>(resolve => { reportStarted = resolve; });
        const owners: string[] = [];
        const sandbox = new CodemodeSandboxBase({ timeoutMs: 2_000,
            callResourceLimits: OBSIDIAN_CODE_CALL_RESOURCE_LIMITS,
            globals: [{ name: "obsidian.vault.createText", execute: async input => {
                const { path, text } = input as { path: string; text: string };
                owners.push(path);
                if (owners.length === 2) reportStarted();
                await held;
                return { ok: true, value: { path, chars: text.length } };
            } }],
        }, inlineLauncher(await wasm));
        try {
            const pending = sandbox.execute(`
                let serialized = 0;
                const calls = [0, 1, 2].map(index => obsidian.vault.createText({
                    toJSON() {
                        serialized++;
                        return { path: index + ".md", text: "x".repeat(700_000) };
                    }
                }));
                return { results: await Promise.all(calls), serialized };
            `);
            await started;
            expect(owners).toEqual(["0.md", "1.md"]);
            release();
            expect(await pending).toMatchObject({ ok: true, value: {
                results: [0, 1, 2].map(index => ({ ok: true, value: { path: `${index}.md`, chars: 700_000 } })),
                serialized: 3,
            } });
            expect(owners).toEqual(["0.md", "1.md", "2.md"]);
        } finally {
            release();
            await sandbox.close();
        }
    });

    it("rejects oversized UTF-8 arguments before the sender delivers a call", async () => {
        let delivered = 0;
        let owners = 0;
        const launch = inlineLauncher(await wasm);
        const bounds = { maxPayloadBytes: 20, maxInflightBytes: 40, maxInflightCalls: 1 };
        const sandbox = new CodemodeSandboxBase({ timeoutMs: 2_000, callResourceLimits: bounds,
            tools: [{ name: "write", execute: () => { owners++; } }],
        }, (data, events) => launch(data, { ...events, message: message => {
            if ((message as { type?: string }).type === "call") delivered++;
            events.message(message);
        } }));
        const json = JSON.stringify("中文".repeat(5));
        expect(json.length).toBeLessThan(bounds.maxPayloadBytes);
        expect(bridgeJsonByteLength(json)).toBeGreaterThan(bounds.maxPayloadBytes);
        expect(await sandbox.execute(`return await tools.write("中文".repeat(5));`)).toMatchObject({ ok: false });
        expect(delivered).toBe(0);
        expect(owners).toBe(0);
        await sandbox.close();
    });

    it.each(["bytes", "characters"] as const)("returns a recoverable SDK result for the sender %s budget and keeps later calls usable", async budget => {
        const owners: unknown[] = [];
        const sandbox = new CodemodeSandboxBase({ timeoutMs: 2_000,
            callResourceLimits: { maxPayloadBytes: 100, maxInflightBytes: 200, maxInflightCalls: 1 },
            ...(budget === "characters" ? { maxCallPayloadChars: 70 } : {}),
            globals: [{ name: "obsidian.vault.createText", execute: input => {
                owners.push(input);
                return { ok: true, value: input };
            } }],
        }, inlineLauncher(await wasm));
        try {
            const result = await sandbox.execute(`
                const rejected = await obsidian.vault.createText({path:"large.md",text:${budget === "bytes" ? '"中文".repeat(20)' : '"x".repeat(50)'}});
                if (rejected.ok) throw new Error("Expected a resource refusal");
                return { rejected, next: await obsidian.vault.createText({path:"small.md",text:"ok"}) };
            `);
            expect(result).toMatchObject({ ok: true, value: {
                rejected: { ok: false, error: { code: "resource_limit", executionState: "not_started" } },
                next: { ok: true, value: { path: "small.md", text: "ok" } },
            } });
            expect(owners).toEqual([{ path: "small.md", text: "ok" }]);
        } finally {
            await sandbox.close();
        }
    });

    it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid transport id %s before owner execution", async id => {
        let owners = 0;
        const launch: VmLauncher = (_data, events) => {
            queueMicrotask(() => events.message({ type: "call", id, target: "tool", name: "write", args: "{}" }));
            return { post: () => undefined, stop: async () => undefined };
        };
        const sandbox = new CodemodeSandboxBase({ timeoutMs: 2_000,
            tools: [{ name: "write", execute: () => { owners++; } }],
        }, launch);
        expect(await sandbox.execute("return 1")).toMatchObject({ ok: false, error: { kind: "sandbox" } });
        expect(owners).toBe(0);
        await sandbox.close();
    });

    it("rejects reversed ids and oversized receiver payloads before an additional owner attempt", async () => {
        for (const oversized of [false, true]) {
            let owners = 0;
            const launch: VmLauncher = (_data, events) => {
                queueMicrotask(() => {
                    if (!oversized) events.message({ type: "call", id: 2, target: "tool", name: "write", args: "{}" });
                    events.message({ type: "call", id: 1, target: "tool", name: "write",
                        args: oversized ? JSON.stringify("中文".repeat(5)) : "{}" });
                });
                return { post: () => undefined, stop: async () => undefined };
            };
            const sandbox = new CodemodeSandboxBase({ timeoutMs: 2_000,
                callResourceLimits: { maxPayloadBytes: 20, maxInflightBytes: 40, maxInflightCalls: 1 },
                tools: [{ name: "write", execute: () => { owners++; return {}; } }],
            }, launch);
            expect(await sandbox.execute("return 1")).toMatchObject({ ok: false, error: { kind: "sandbox" } });
            expect(owners).toBe(oversized ? 0 : 1);
            await sandbox.close();
        }
    });
});
