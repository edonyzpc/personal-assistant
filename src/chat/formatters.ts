import type { ChatAgentStatus, ChatContextUsedItem } from '../ai-services/chat-service';
import type { ChatRuntimeWarning, SourceRecord } from '../ai-services/chat-types';

export function displaySourceName(path: string): string {
    const cleanPath = path.trim();
    if (!cleanPath) return 'Untitled note';
    const lastSegment = cleanPath.split('/').filter(Boolean).pop() ?? cleanPath;
    return lastSegment.replace(/\.md$/i, '') || 'Untitled note';
}

export function formatSourceSummary(sources: { path: string }[] | undefined): string {
    const names = [...new Set((sources ?? []).map((source) => displaySourceName(source.path)).filter(Boolean))];
    if (names.length === 0) return '';
    const visible = names.slice(0, 4).join(', ');
    const remaining = names.length - 4;
    return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

export function getToolContextUsedInfo(tool: string): Pick<ChatContextUsedItem, 'category' | 'label' | 'detail'> {
    if (tool === 'inspect_obsidian_note') {
        return {
            category: 'read-only-tool',
            label: 'Note structure',
            detail: 'Read-only note structure, links/backlinks, tasks, and properties',
        };
    }
    if (tool === 'read_canvas_summary') {
        return {
            category: 'read-only-tool',
            label: 'Canvas structure',
            detail: 'Read-only canvas structure',
        };
    }
    if (tool === 'search_vault_snippets') {
        return {
            category: 'read-only-tool',
            label: 'Note snippets',
            detail: 'Bounded note snippet search results',
        };
    }
    if (tool === 'list_vault_tags') {
        return {
            category: 'read-only-tool',
            label: 'Vault tags',
            detail: 'Read-only vault tag counts',
        };
    }
    if (tool === 'get_current_note_context') {
        return {
            category: 'current-note',
            label: 'Current note',
            detail: 'Read-only current note context',
        };
    }
    if (tool === 'search_vault_metadata') {
        return {
            category: 'vault-metadata',
            label: 'Vault metadata',
            detail: 'Read-only metadata search results',
        };
    }
    if (tool === 'list_recent_notes') {
        return {
            category: 'recent-notes',
            label: 'Recent notes',
            detail: 'Read-only recent note list',
        };
    }
    if (tool === 'read_note_outline') {
        return {
            category: 'note-outline',
            label: 'Note outline',
            detail: 'Read-only note outline',
        };
    }
    return {
        category: 'read-only-tool',
        label: 'Read-only tool',
        detail: 'Read-only tool context',
    };
}

export function formatToolRunningStatus(tool: string): string {
    if (tool === 'get_current_note_context') return 'Reading current note...';
    if (tool === 'inspect_obsidian_note') return 'Reading note structure...';
    if (tool === 'read_canvas_summary') return 'Checking canvas structure...';
    if (tool === 'search_vault_snippets') return 'Searching note snippets...';
    if (tool === 'list_vault_tags') return 'Reading vault tags...';
    if (tool === 'search_vault_metadata') return 'Searching vault metadata...';
    if (tool === 'list_recent_notes') return 'Reading recent notes...';
    if (tool === 'read_note_outline') return 'Reading note outline...';
    return 'Reading vault context...';
}

export function dedupeContextSources(sources: ChatContextUsedItem['sources'] = []) {
    const seen = new Set<string>();
    return sources.filter((source) => {
        if (!source.path) return false;
        const key = `${source.path}:${source.chunkIndex ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 6);
}

export function mergeContextUsedItems(
    current: ChatContextUsedItem[],
    incoming: ChatContextUsedItem[],
): ChatContextUsedItem[] {
    const byKey = new Map<string, ChatContextUsedItem>();
    for (const item of [...current, ...incoming]) {
        const key = `${item.category}:${item.label}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, {
                ...item,
                sources: dedupeContextSources(item.sources),
            });
            continue;
        }
        existing.sources = dedupeContextSources([
            ...(existing.sources ?? []),
            ...(item.sources ?? []),
        ]);
        existing.detail ??= item.detail;
        existing.citationEligible = Boolean(existing.citationEligible || item.citationEligible);
        existing.statusOnly = Boolean(existing.statusOnly || item.statusOnly);
    }
    return [...byKey.values()].slice(0, 12);
}

export function normalizeContextUsedItems(value: unknown): ChatContextUsedItem[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): ChatContextUsedItem | null => {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            if (typeof record.category !== 'string' || typeof record.label !== 'string') return null;
            return {
                category: record.category as ChatContextUsedItem['category'],
                label: record.label,
                detail: typeof record.detail === 'string' ? record.detail : undefined,
                sources: Array.isArray(record.sources)
                    ? record.sources
                        .map((source): NonNullable<ChatContextUsedItem['sources']>[number] | null => {
                            if (!source || typeof source !== 'object') return null;
                            const sourceRecord = source as Record<string, unknown>;
                            if (typeof sourceRecord.path !== 'string') return null;
                            return {
                                path: sourceRecord.path,
                                chunkIndex: typeof sourceRecord.chunkIndex === 'number'
                                    ? sourceRecord.chunkIndex
                                    : undefined,
                                score: typeof sourceRecord.score === 'number'
                                    ? sourceRecord.score
                                    : undefined,
                            };
                        })
                        .filter((source): source is NonNullable<ChatContextUsedItem['sources']>[number] => Boolean(source))
                    : undefined,
                citationEligible: record.citationEligible === true,
                statusOnly: record.statusOnly === true,
            };
        })
        .filter((item): item is ChatContextUsedItem => Boolean(item));
}

export function normalizeSourceRecords(value: unknown): SourceRecord[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): SourceRecord | null => {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            if (typeof record.kind !== 'string' || typeof record.dedupKey !== 'string') return null;
            return {
                kind: record.kind as SourceRecord['kind'],
                dedupKey: record.dedupKey,
                turnId: typeof record.turnId === 'string' ? record.turnId : undefined,
                providerId: typeof record.providerId === 'string' ? record.providerId : undefined,
                capabilityName: typeof record.capabilityName === 'string' ? record.capabilityName : undefined,
                sourceBoundary: typeof record.sourceBoundary === 'string'
                    ? record.sourceBoundary as SourceRecord['sourceBoundary']
                    : undefined,
                title: typeof record.title === 'string' ? record.title : undefined,
                path: typeof record.path === 'string' ? record.path : undefined,
                url: typeof record.url === 'string' ? record.url : undefined,
                snippet: typeof record.snippet === 'string' ? record.snippet : undefined,
                score: typeof record.score === 'number' ? record.score : undefined,
                chunkIndex: typeof record.chunkIndex === 'number' ? record.chunkIndex : undefined,
                truncated: record.truncated === true,
                redacted: record.redacted === true,
                citationEligible: record.citationEligible === true,
                statusOnly: record.statusOnly === true,
                metadata: record.metadata && typeof record.metadata === 'object'
                    ? record.metadata as Record<string, unknown>
                    : undefined,
            };
        })
        .filter((item): item is SourceRecord => Boolean(item));
}

export function mergeSourceRecords(current: SourceRecord[], incoming: SourceRecord[]): SourceRecord[] {
    const byKey = new Map<string, SourceRecord>();
    for (const record of [...current, ...incoming]) {
        const key = [
            record.dedupKey,
            record.sourceBoundary ?? '',
            record.path ?? '',
            record.url ?? '',
            record.title ?? '',
        ].join(' ');
        if (!byKey.has(key)) {
            byKey.set(key, record);
        }
    }
    return [...byKey.values()];
}

export function isDuplicateReadOnlyToolSkip(status: ChatAgentStatus): boolean {
    return (
        status.type === 'tool-skipped'
        && status.reason === 'Duplicate read-only tool call skipped.'
    );
}

export function getContextUsedItemsFromStatus(status: ChatAgentStatus): ChatContextUsedItem[] {
    if (status.type === 'memory-selected' || status.type === 'memory-expanded') {
        if (status.sources.length === 0) return [];
        return [{
            category: 'memory',
            label: 'Selected Memory',
            detail: status.sources.length === 1 ? '1 selected note' : `${status.sources.length} selected notes`,
            sources: status.sources,
            citationEligible: true,
        }];
    }
    if (status.type === 'tool-done') {
        const toolInfo = getToolContextUsedInfo(status.tool);
        if (status.availability === 'unavailable') {
            return [{
                category: 'tool-unavailable',
                label: `${toolInfo.label} unavailable`,
                detail: 'Vault context was unavailable for this turn.',
                sources: status.sources,
                citationEligible: false,
                statusOnly: true,
            }];
        }
        return [{
            category: toolInfo.category,
            label: toolInfo.label,
            detail: status.availability === 'partial' ? `Partial ${toolInfo.detail}` : toolInfo.detail,
            sources: status.sources,
            citationEligible: false,
        }];
    }
    if (status.type === 'tool-skipped') {
        if (isDuplicateReadOnlyToolSkip(status)) return [];
        const toolInfo = getToolContextUsedInfo(status.tool);
        return [{
            category: 'tool-unavailable',
            label: `${toolInfo.label} unavailable`,
            detail: 'Vault context was unavailable for this turn.',
            statusOnly: true,
        }];
    }
    if (status.type === 'fallback') {
        const isLoopCap = /cap reached|stopped before/i.test(status.reason);
        return [{
            category: isLoopCap ? 'loop-cap' : 'fallback',
            label: isLoopCap ? 'Using gathered context' : 'Available context',
            detail: isLoopCap
                ? 'Answering from context gathered before the planning limit was reached.'
                : 'Answering from available context for this turn.',
            statusOnly: true,
        }];
    }
    return [];
}

export function formatAgentStatus(status: ChatAgentStatus): string {
    if (status.type === 'thinking') {
        return 'Deciding what context to use...';
    } else if (status.type === 'memory-prefetching') {
        return `Searching notes: ${status.query}`;
    } else if (status.type === 'memory-prefetched') {
        const sources = formatSourceSummary(status.sources);
        return sources ? `Related notes found: ${sources}` : 'No related memory';
    } else if (status.type === 'memory-reranking') {
        return `Checking ${status.candidateCount} related note${status.candidateCount === 1 ? '' : 's'}...`;
    } else if (status.type === 'memory-selected') {
        const sources = formatSourceSummary(status.sources);
        return sources ? `Selected memory: ${sources}` : 'No relevant memory selected';
    } else if (status.type === 'memory-expanded') {
        return 'Reading selected Memory...';
    } else if (status.type === 'retrieving') {
        return `Searching notes: ${status.query}`;
    } else if (status.type === 'retrieved') {
        const sources = formatSourceSummary(status.sources);
        return sources ? `Related notes found: ${sources}` : 'No related memory';
    } else if (status.type === 'memory-skipped') {
        return /returned 0 source/i.test(status.reason) ? 'No related memory' : 'Memory skipped';
    } else if (status.type === 'tool-running') {
        return formatToolRunningStatus(status.tool);
    } else if (status.type === 'tool-done') {
        const sources = formatSourceSummary(status.sources);
        return sources ? `${status.message}: ${sources}` : status.message;
    } else if (status.type === 'tool-skipped') {
        if (isDuplicateReadOnlyToolSkip(status)) return 'Vault context already gathered';
        return 'Vault context unavailable';
    } else if (status.type === 'answering') {
        return 'Answering...';
    } else if (status.type === 'fallback') {
        return /cap reached|stopped before/i.test(status.reason)
            ? 'Using gathered context after reaching the planning limit.'
            : 'Answering from available context.';
    }
    return 'Thinking...';
}

export function formatCanonicalToolStatus(toolName: string): string {
    if (toolName === 'search_memory') return 'Searching Memory...';
    if (toolName === 'webSearch') return 'Searching the web...';
    return formatToolRunningStatus(toolName);
}

export function formatCanonicalToolCompletedStatus(toolName: string, outcome: string): string {
    const label = toolName === 'search_memory'
        ? 'Memory search'
        : toolName === 'webSearch'
            ? 'WebSearch'
            : getToolContextUsedInfo(toolName).label;
    if (outcome === 'success') return `${label} complete`;
    if (outcome === 'budget_exceeded') return `${label} skipped: budget reached`;
    if (outcome === 'duplicate_skipped') return `${label} already gathered`;
    if (outcome === 'aborted' || outcome === 'abort_timeout') return `${label} stopped`;
    return `${label} unavailable`;
}

export function formatRuntimeWarningType(type: string): string {
    if (type === 'required_capability_missing') return 'Answer may be incomplete';
    if (type === 'provider_partial_error') return 'Answer stopped early';
    if (type === 'assistant_idle_timeout') return 'Assistant stopped responding';
    if (type === 'assistant_empty_response') return 'Answer incomplete';
    if (type === 'wall_clock_exceeded') return 'Runtime limit reached';
    return 'Answer warning';
}

export function formatRuntimeWarningLabel(warning: ChatRuntimeWarning): string {
    if (warning.type === 'assistant_empty_response') return formatRuntimeWarningType(warning.type);
    return warning.message ?? formatRuntimeWarningType(warning.type);
}

export function formatRuntimeWarningDetail(warning: ChatRuntimeWarning): string | undefined {
    if (warning.type === 'assistant_empty_response') return 'No final answer was produced.';
    return warning.detail ?? warning.capability;
}

export function formatCanonicalTerminalSummary(
    status: string | undefined,
    warnings: ChatRuntimeWarning[] = [],
): string {
    if (status === 'incomplete' || warnings.some((warning) => warning.type === 'assistant_empty_response')) {
        return 'Answer incomplete';
    }
    if (status === 'aborted') return 'Generation cancelled';
    if (status === 'error') return 'Answer failed';
    if (status === 'completed_with_warning' || warnings.length > 0) return 'Answer completed with warning';
    return 'Thinking complete';
}

export function runtimeWarningKey(warning: ChatRuntimeWarning): string {
    return JSON.stringify([
        warning.type,
        warning.message ?? '',
        warning.detail ?? '',
        warning.capability ?? '',
    ]);
}
