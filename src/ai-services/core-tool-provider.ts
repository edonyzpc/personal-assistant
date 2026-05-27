import {
    createCapabilityFromChatToolDefinition,
} from "./capability-adapter";
import type {
    AgentCapability,
    AgentCapabilityContext,
    CapabilityProvider,
    ProviderLoadContext,
    ProviderLoadResult,
} from "./capability-types";
import {
    ToolRegistry,
    createCurrentNoteContextTool,
    createInspectObsidianNoteTool,
    createListRecentNotesTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createReadNoteOutlineTool,
    createSearchMemoryTool,
    createSearchVaultMetadataTool,
    createSearchVaultSnippetsTool,
    type ChatToolContext,
    type SearchMemoryInput,
} from "./chat-tools";
import type { MemorySearchResult } from "./chat-types";

export const CORE_TOOL_PROVIDER_ID = "core-tools";

export class CoreToolProvider implements CapabilityProvider {
    readonly id = CORE_TOOL_PROVIDER_ID;
    readonly displayName = "Core read-only tools";
    readonly required = true;
    readonly kind = "tool-provider" as const;
    readonly platform = "both" as const;
    private readonly legacyRegistry: ToolRegistry;

    constructor(
        executeMemorySearch: (input: SearchMemoryInput, context: ChatToolContext) => Promise<MemorySearchResult>,
    ) {
        this.legacyRegistry = new ToolRegistry();
        this.legacyRegistry.register(createSearchMemoryTool(executeMemorySearch));
        this.legacyRegistry.register(createCurrentNoteContextTool());
        this.legacyRegistry.register(createSearchVaultMetadataTool());
        this.legacyRegistry.register(createListRecentNotesTool());
        this.legacyRegistry.register(createReadNoteOutlineTool());
        this.legacyRegistry.register(createInspectObsidianNoteTool());
        this.legacyRegistry.register(createReadCanvasSummaryTool());
        this.legacyRegistry.register(createSearchVaultSnippetsTool());
        this.legacyRegistry.register(createListVaultTagsTool());
    }

    loadCapabilities(): AgentCapability[] {
        return this.legacyRegistry.listDefinitions().map((definition) => createCapabilityFromChatToolDefinition(
            definition,
            {
                providerId: this.id,
                origin: "core",
                platform: "both",
                execute: (input: unknown, context: AgentCapabilityContext) => {
                    return this.legacyRegistry.execute(definition.name, input, context);
                },
                prepareAndValidate: (raw, ctx) => {
                    return this.legacyRegistry.prepareAndValidate(definition.name, raw, ctx);
                },
            },
        ));
    }

    async load(_context: ProviderLoadContext): Promise<ProviderLoadResult> {
        return {
            status: "available",
            capabilities: this.loadCapabilities(),
        };
    }
}
