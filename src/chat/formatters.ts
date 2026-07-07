import type { ChatAgentStatus, ChatContextUsedItem } from '../ai-services/chat-service';
import type { ChatRuntimeWarning, SourceRecord } from '../ai-services/chat-types';
import { getPluginUiLanguage, pluginT, type PluginLocale } from '../locales/plugin';

function ft(key: string, params?: Readonly<Record<string, string | number>>, locale?: PluginLocale): string {
    return pluginT(key, locale ?? getPluginUiLanguage(), params);
}

export function displaySourceName(path: string): string {
    const cleanPath = path.trim();
    if (!cleanPath) return ft('plugin.chat.formatter.untitledNote');
    const lastSegment = cleanPath.split('/').filter(Boolean).pop() ?? cleanPath;
    return lastSegment.replace(/\.md$/i, '') || ft('plugin.chat.formatter.untitledNote');
}

export function formatSourceSummary(sources: { path: string }[] | undefined): string {
    const names = [...new Set((sources ?? []).map((source) => displaySourceName(source.path)).filter(Boolean))];
    if (names.length === 0) return '';
    const visible = names.slice(0, 4).join(', ');
    const remaining = names.length - 4;
    return remaining > 0 ? `${visible}, ${ft('plugin.chat.formatter.moreCount', { count: remaining })}` : visible;
}

const TOOL_CONTEXT_MAP: Record<string, { category: ChatContextUsedItem['category']; labelKey: string; detailKey: string }> = {
    inspect_obsidian_note: { category: 'read-only-tool', labelKey: 'plugin.chat.formatter.contextTool.inspectNote.label', detailKey: 'plugin.chat.formatter.contextTool.inspectNote.detail' },
    read_canvas_summary: { category: 'read-only-tool', labelKey: 'plugin.chat.formatter.contextTool.readCanvas.label', detailKey: 'plugin.chat.formatter.contextTool.readCanvas.detail' },
    search_vault_snippets: { category: 'read-only-tool', labelKey: 'plugin.chat.formatter.contextTool.searchSnippets.label', detailKey: 'plugin.chat.formatter.contextTool.searchSnippets.detail' },
    list_vault_tags: { category: 'read-only-tool', labelKey: 'plugin.chat.formatter.contextTool.listTags.label', detailKey: 'plugin.chat.formatter.contextTool.listTags.detail' },
    get_current_note_context: { category: 'current-note', labelKey: 'plugin.chat.formatter.contextTool.currentNote.label', detailKey: 'plugin.chat.formatter.contextTool.currentNote.detail' },
    search_vault_metadata: { category: 'vault-metadata', labelKey: 'plugin.chat.formatter.contextTool.searchMetadata.label', detailKey: 'plugin.chat.formatter.contextTool.searchMetadata.detail' },
    list_recent_notes: { category: 'recent-notes', labelKey: 'plugin.chat.formatter.contextTool.recentNotes.label', detailKey: 'plugin.chat.formatter.contextTool.recentNotes.detail' },
    read_note_outline: { category: 'note-outline', labelKey: 'plugin.chat.formatter.contextTool.noteOutline.label', detailKey: 'plugin.chat.formatter.contextTool.noteOutline.detail' },
};

export function getToolContextUsedInfo(tool: string): Pick<ChatContextUsedItem, 'category' | 'label' | 'detail'> {
    const entry = TOOL_CONTEXT_MAP[tool];
    if (entry) {
        return { category: entry.category, label: ft(entry.labelKey), detail: ft(entry.detailKey) };
    }
    return {
        category: 'read-only-tool',
        label: ft('plugin.chat.formatter.contextTool.default.label'),
        detail: ft('plugin.chat.formatter.contextTool.default.detail'),
    };
}

export function formatToolRunningStatus(tool: string): string {
    if (tool === 'get_current_note_context') return ft('plugin.chat.formatter.readingCurrentNote');
    if (tool === 'inspect_obsidian_note') return ft('plugin.chat.formatter.readingNoteStructure');
    if (tool === 'read_canvas_summary') return ft('plugin.chat.formatter.checkingCanvasStructure');
    if (tool === 'search_vault_snippets') return ft('plugin.chat.formatter.searchingNoteSnippets');
    if (tool === 'list_vault_tags') return ft('plugin.chat.formatter.readingTags');
    if (tool === 'search_vault_metadata') return ft('plugin.chat.formatter.searchingMetadata');
    if (tool === 'list_recent_notes') return ft('plugin.chat.formatter.readingRecentNotes');
    if (tool === 'read_note_outline') return ft('plugin.chat.formatter.readingNoteOutline');
    return ft('plugin.chat.formatter.readingContext');
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
            label: ft('plugin.chat.formatter.contextUsed.selectedMemory'),
            detail: status.sources.length === 1
                ? ft('plugin.chat.formatter.contextUsed.selectedNoteOne')
                : ft('plugin.chat.formatter.contextUsed.selectedNoteMany', { count: status.sources.length }),
            sources: status.sources,
            citationEligible: true,
        }];
    }
    if (status.type === 'tool-done') {
        const toolInfo = getToolContextUsedInfo(status.tool);
        if (status.availability === 'unavailable') {
            return [{
                category: 'tool-unavailable',
                label: ft('plugin.chat.formatter.contextUsed.toolUnavailableLabel', { label: toolInfo.label }),
                detail: ft('plugin.chat.formatter.contextUsed.vaultContextUnavailable'),
                sources: status.sources,
                citationEligible: false,
                statusOnly: true,
            }];
        }
        return [{
            category: toolInfo.category,
            label: toolInfo.label,
            detail: status.availability === 'partial'
                ? ft('plugin.chat.formatter.contextUsed.partialDetail', { detail: toolInfo.detail ?? '' })
                : toolInfo.detail,
            sources: status.sources,
            citationEligible: false,
        }];
    }
    if (status.type === 'tool-skipped') {
        if (isDuplicateReadOnlyToolSkip(status)) return [];
        const toolInfo = getToolContextUsedInfo(status.tool);
        return [{
            category: 'tool-unavailable',
            label: ft('plugin.chat.formatter.contextUsed.toolUnavailableLabel', { label: toolInfo.label }),
            detail: ft('plugin.chat.formatter.contextUsed.vaultContextUnavailable'),
            statusOnly: true,
        }];
    }
    if (status.type === 'fallback') {
        const isLoopCap = /cap reached|stopped before/i.test(status.reason);
        return [{
            category: isLoopCap ? 'loop-cap' : 'fallback',
            label: isLoopCap
                ? ft('plugin.chat.formatter.contextUsed.usingGathered')
                : ft('plugin.chat.formatter.contextUsed.availableContext'),
            detail: isLoopCap
                ? ft('plugin.chat.formatter.contextUsed.answeredAfterLimit')
                : ft('plugin.chat.formatter.contextUsed.answeredFromAvailable'),
            statusOnly: true,
        }];
    }
    return [];
}

export function formatAgentStatus(status: ChatAgentStatus): string {
    if (status.type === 'thinking') {
        return ft('plugin.chat.formatter.decidingContext');
    } else if (status.type === 'memory-prefetching') {
        return ft('plugin.chat.formatter.searchingNotes', { query: status.query });
    } else if (status.type === 'memory-prefetched') {
        const sources = formatSourceSummary(status.sources);
        return sources ? ft('plugin.chat.formatter.relatedNotesFound', { sources }) : ft('plugin.chat.formatter.noRelatedNotes');
    } else if (status.type === 'memory-reranking') {
        return ft('plugin.chat.formatter.checkingRelatedNotes', { count: status.candidateCount });
    } else if (status.type === 'memory-selected') {
        const sources = formatSourceSummary(status.sources);
        return sources ? ft('plugin.chat.formatter.selectedNotes', { sources }) : ft('plugin.chat.formatter.noRelevantNotes');
    } else if (status.type === 'memory-expanded') {
        return ft('plugin.chat.formatter.readingSelectedNotes');
    } else if (status.type === 'retrieving') {
        return ft('plugin.chat.formatter.searchingNotes', { query: status.query });
    } else if (status.type === 'retrieved') {
        const sources = formatSourceSummary(status.sources);
        return sources ? ft('plugin.chat.formatter.relatedNotesFound', { sources }) : ft('plugin.chat.formatter.noRelatedNotes');
    } else if (status.type === 'memory-skipped') {
        return /returned 0 source/i.test(status.reason) ? ft('plugin.chat.formatter.noRelatedNotes') : ft('plugin.chat.formatter.notesSkipped');
    } else if (status.type === 'tool-running') {
        return formatToolRunningStatus(status.tool);
    } else if (status.type === 'tool-done') {
        const sources = formatSourceSummary(status.sources);
        const toolInfo = getToolContextUsedInfo(status.tool);
        return sources
            ? ft('plugin.chat.formatter.toolDoneWithSources', { label: toolInfo.label, sources })
            : ft('plugin.chat.formatter.toolDoneNoSources', { label: toolInfo.label });
    } else if (status.type === 'tool-skipped') {
        if (isDuplicateReadOnlyToolSkip(status)) return ft('plugin.chat.formatter.contextAlreadyGathered');
        return ft('plugin.chat.formatter.contextUnavailable');
    } else if (status.type === 'answering') {
        return ft('plugin.chat.formatter.answering');
    } else if (status.type === 'fallback') {
        return /cap reached|stopped before/i.test(status.reason)
            ? ft('plugin.chat.formatter.usingGatheredContext')
            : ft('plugin.chat.formatter.answeringFromContext');
    }
    return ft('plugin.chat.formatter.thinking');
}

export function formatCanonicalToolStatus(toolName: string): string {
    if (toolName === 'search_memory') return ft('plugin.chat.formatter.searchingMemory');
    if (toolName === 'webSearch') return ft('plugin.chat.formatter.searchingWeb');
    return formatToolRunningStatus(toolName);
}

export function formatCanonicalToolCompletedStatus(toolName: string, outcome: string): string {
    const label = toolName === 'search_memory'
        ? ft('plugin.chat.formatter.toolLabel.memory')
        : toolName === 'webSearch'
            ? ft('plugin.chat.formatter.toolLabel.webSearch')
            : getToolContextUsedInfo(toolName).label;
    if (outcome === 'success') return ft('plugin.chat.formatter.toolComplete', { label });
    if (outcome === 'budget_exceeded') return ft('plugin.chat.formatter.toolSkippedBudget', { label });
    if (outcome === 'duplicate_skipped') return ft('plugin.chat.formatter.toolAlreadyGathered', { label });
    if (outcome === 'aborted' || outcome === 'abort_timeout') return ft('plugin.chat.formatter.toolStopped', { label });
    return ft('plugin.chat.formatter.toolUnavailable', { label });
}

export function formatRuntimeWarningType(type: string): string {
    if (type === 'required_capability_missing') return ft('plugin.chat.formatter.warningIncomplete');
    if (type === 'provider_partial_error') return ft('plugin.chat.formatter.warningStoppedEarly');
    if (type === 'assistant_idle_timeout') return ft('plugin.chat.formatter.warningIdleTimeout');
    if (type === 'assistant_empty_response') return ft('plugin.chat.formatter.warningEmptyResponse');
    if (type === 'wall_clock_exceeded') return ft('plugin.chat.formatter.warningRuntimeLimit');
    return ft('plugin.chat.formatter.warningGeneric');
}

export function formatRuntimeWarningLabel(warning: ChatRuntimeWarning): string {
    if (warning.type === 'assistant_empty_response') return formatRuntimeWarningType(warning.type);
    return warning.message ?? formatRuntimeWarningType(warning.type);
}

export function formatRuntimeWarningDetail(warning: ChatRuntimeWarning): string | undefined {
    if (warning.type === 'assistant_empty_response') return ft('plugin.chat.formatter.warningNoAnswer');
    return warning.detail ?? warning.capability;
}

export function formatCanonicalTerminalSummary(
    status: string | undefined,
    warnings: ChatRuntimeWarning[] = [],
): string {
    if (status === 'incomplete' || warnings.some((warning) => warning.type === 'assistant_empty_response')) {
        return ft('plugin.chat.formatter.summaryIncomplete');
    }
    if (status === 'aborted') return ft('plugin.chat.formatter.summaryCancelled');
    if (status === 'error') return ft('plugin.chat.formatter.summaryFailed');
    if (status === 'completed_with_warning' || warnings.length > 0) return ft('plugin.chat.formatter.summaryWithWarning');
    return ft('plugin.chat.formatter.summaryComplete');
}

export function runtimeWarningKey(warning: ChatRuntimeWarning): string {
    return JSON.stringify([
        warning.type,
        warning.message ?? '',
        warning.detail ?? '',
        warning.capability ?? '',
    ]);
}
