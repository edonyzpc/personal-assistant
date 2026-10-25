import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { CodemodeSandboxBase } from "../src/third_party/pi-codemode/runtime/execution";
import { inlineLauncher } from "../src/third_party/pi-codemode/runtime/inline";
import { completeInputLineage, sourceRecordsInputLineage, unionInputLineages } from "../src/ai-services/input-lineage";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { OperationsToolCapability } from "../src/ai-services/operations/operations-tool-provider";
import { RESOURCE_OPERATION_TOOL_NAMES } from "../src/ai-services/operations/types";
import { CACHE_FIELDS, OBSIDIAN_SDK_METHODS } from "../src/ai-services/independent-computation/obsidian-resource-sdk";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { createExecuteObsidianCodeTool } from "../src/ai-services/independent-computation/obsidian-code-capability";
import { attachObsidianSdkGuidance, createObsidianSdkReadCapabilities, createObsidianSdkStatusCapability } from "../src/ai-services/independent-computation/obsidian-sdk-tool-definitions";

jest.mock("obsidian");

describe("SDK library and disclosure integration", () => {
    it("runs the actual pinned library bundle in QuickJS without host I/O globals", async () => {
        const [bundle, wasm] = await Promise.all([
            build({ entryPoints: ["src/ai-services/independent-computation/guest-libraries.ts"],
                bundle: true, platform: "browser", format: "iife", target: "es2020",
                mainFields: ["browser", "module", "main"], conditions: ["browser"], write: false }),
            readFile("node_modules/quickjs-wasi/quickjs.wasm").then(bytes => WebAssembly.compile(bytes)),
        ]);
        const sandbox = new CodemodeSandboxBase({ timeoutMs: 5_000,
            guestLibrarySource: bundle.outputFiles![0].text }, inlineLauncher(wasm));
        try {
            const result = await sandbox.execute(`
                const yaml = jsyaml.safeLoad("date: 2026-10-12\\nlabel: 中文😀\\n");
                return { html: markdownit().render("# 中文😀\\n"), label: yaml.label,
                    date: yaml.date.toISOString(), roundtrip: jsyaml.safeLoad(jsyaml.safeDump({label: yaml.label})).label,
                    ambient: [typeof fetch, typeof require, typeof process, typeof app, typeof obsidian] };
            `);
            expect(result).toMatchObject({ ok: true, value: { html: "<h1>中文😀</h1>\n",
                label: "中文😀", date: "2026-10-12T00:00:00.000Z", roundtrip: "中文😀",
                ambient: ["undefined", "undefined", "undefined", "undefined", "undefined"] } });
        } finally {
            await sandbox.close();
        }
    });

    it("keeps SDK methods in the executable registry while exporting the facade and current entry guidance", () => {
        const registry = new CapabilityRegistry();
        const methods = createObsidianSdkReadCapabilities();
        for (const method of methods) expect(registry.register(method)).toBe(true);
        registry.register(createObsidianSdkStatusCapability({ read: async ({ intentId }) => ({ intentId, available: false }) }));
        const entry = createChatToolCapability(createExecuteObsidianCodeTool(), { providerId: "independent-computation" });
        attachObsidianSdkGuidance(entry, registry);
        registry.register(entry);
        const exported = registry.listDefinitions().map(definition => definition.name);
        expect(exported).toEqual(["list_vault_entries", "execute_obsidian_code"]);
        expect(registry.exportProviderSchemas().map(schema => schema.function.name)).toEqual(exported);
        expect(registry.get("obsidian.vault.readBinary")).toBe(methods.find(method => method.name === "obsidian.vault.readBinary"));
        const guidance = entry.toRegistryDefinition().plannerGuidance.join("\n");
        expect(guidance).toContain("obsidian.* and tools.* are parallel top-level roots");
        expect(guidance).toContain("Promise<SdkResult<T>>");
        expect(guidance).toContain("preserves each existing tool's own result");
        expect(guidance).toContain("The outer load_tools tool only changes which ordinary tools are disclosed in later provider requests");
        expect(guidance).toContain("obsidian.vault.readBinary:");
        const sdkEnvelope = "Obsidian SDK results are SdkResult: success is `{ok:true,value}`";
        expect(guidance).toContain(sdkEnvelope);
        expect(guidance.split(sdkEnvelope)).toHaveLength(2);
        expect(methods.find(method => method.name === "list_vault_entries")!.toRegistryDefinition()
            .plannerGuidance.join("\n")).toContain(sdkEnvelope);
        const inspectStart = guidance.indexOf("obsidian.metadata.inspect:");
        const linksStart = guidance.indexOf("obsidian.metadata.links:");
        const linksEnd = guidance.indexOf("obsidian.metadata.resolveLink:", linksStart);
        const inspectDefinition = methods.find(method => method.name === "obsidian.metadata.inspect")!;
        expect(inspectDefinition.inputSchema.properties.fields).toEqual({
            type: "array", items: { type: "string", enum: [...CACHE_FIELDS] },
        });
        const inspectGuidance = guidance.slice(inspectStart, linksStart);
        expect(inspectGuidance).toContain("omitted selects every supported field, while an explicit empty array selects zero fields");
        expect(inspectGuidance).toContain("`tags` contains body TagCache rows and is not merged with `frontmatter` tags");
        expect(inspectGuidance).toContain("array cache fields produce `{field,value}` rows, and object cache fields produce `{field,key,value}` rows");
        expect(inspectGuidance).toContain("means only the selected fields produced no rows in this cache observation");
        const linksGuidance = guidance.slice(linksStart, linksEnd);
        expect(linksGuidance).toContain("value.entries");
        expect(linksGuidance).toContain("A resolved outgoing row has direction `value.path → entry.target`");
        expect(linksGuidance).toContain("an incoming row has direction `entry.source → value.path`");
        expect(linksGuidance).toContain("two views of the same A → B edge; neither proves B → A");
        expect(linksGuidance).toContain("`path`, `resourceRef`, `source`, `entries`, `range`, and `coverage`");
        expect(linksGuidance).toContain("`range.start` and `range.end` are the current page bounds");
        expect(linksGuidance).toContain("`range.total` is the size of this query's row collection");
        expect(linksGuidance).toContain("A complete empty cache observation requires");
        const guidanceLines = guidance.split("\n");
        const statusLines = guidanceLines.filter(line => line.startsWith("obsidian.operations.getStatus:"));
        expect(statusLines).toHaveLength(1);
        expect(statusLines[0]).toContain("Read the current status fresh each time");
        for (const line of guidanceLines.filter(line => line !== statusLines[0]))
            expect(line).not.toContain("Read the current status fresh each time");
        registry.unregister(methods.find(method => method.name === "obsidian.vault.readBinary")!);
        expect(entry.toRegistryDefinition().plannerGuidance.join("\n")).not.toContain("obsidian.vault.readBinary:");
    });

    it("retains distinct real resource generations in the existing source lineage", () => {
        const lineage = sourceRecordsInputLineage([
            { kind: "context-used", dedupKey: "old", sourceBoundary: "vault", path: "same.txt", resourceRef: "resource:old" },
            { kind: "context-used", dedupKey: "new", sourceBoundary: "vault", path: "same.txt", resourceRef: "resource:new" },
        ]);
        expect(unionInputLineages(completeInputLineage(), lineage).dependencies).toEqual([
            { kind: "vault", path: "same.txt", via: "note", resourceRef: "resource:old" },
            { kind: "vault", path: "same.txt", via: "note", resourceRef: "resource:new" },
        ]);
    });

    it("exports exactly the four new entry tools while admitting all sixteen bound SDK methods through the same policy", () => {
        const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({ licenseTier: "paid",
            runKind: "chat-with-actions", allowWrite: true, allowedActionPermissions: ["local-filesystem-write"] }) });
        for (const capability of createObsidianSdkReadCapabilities()) registry.register(capability);
        for (const name of RESOURCE_OPERATION_TOOL_NAMES) registry.register(new OperationsToolCapability(name));
        registry.register(createObsidianSdkStatusCapability({ read: async ({ intentId }) => ({ intentId, available: false }) }));
        const entry = createChatToolCapability(createExecuteObsidianCodeTool(), { providerId: "independent-computation" });
        attachObsidianSdkGuidance(entry, registry);
        registry.register(entry);
        for (const name of OBSIDIAN_SDK_METHODS) {
            expect(registry.get(name)?.sdkOnly).toBe(true);
            expect(registry.canExecute(name).allowed).toBe(true);
        }
        expect(registry.listDefinitions({ includeActions: true }).map(definition => definition.name).sort()).toEqual([
            "execute_obsidian_code", "list_vault_entries", "vault_create_folder", "vault_trash",
        ]);
        const denied = new CapabilityRegistry();
        const move = registry.get("obsidian.vault.move")!;
        denied.register(move);
        const deniedEntry = createChatToolCapability(createExecuteObsidianCodeTool(), { providerId: "independent-computation" });
        attachObsidianSdkGuidance(deniedEntry, denied);
        expect(denied.canExecute(move.name).allowed).toBe(false);
        expect(denied.listDefinitions({ includeActions: true })).toEqual([]);
        expect(entry.toRegistryDefinition().plannerGuidance.join("\n")).toContain("obsidian.vault.move:");
        expect(deniedEntry.toRegistryDefinition().plannerGuidance.join("\n")).not.toContain("obsidian.vault.move:");
        denied.register(deniedEntry);
    });
});
