import type { ChatAgentStatus, ChatContextUsedItem } from '../ai-services/chat-service';
import type { ChatRuntimeWarning, SourceRecord } from '../ai-services/chat-types';
import { parseObservedSourceRevision } from '../ai-services/generation-input-snapshot';
import { getPluginUiLanguage, pluginT, type PluginLocale } from '../locales/plugin';

function ft(key: string, params?: Readonly<Record<string, string | number>>, locale?: PluginLocale): string {
    return pluginT(key, locale ?? getPluginUiLanguage(), params);
}

export function getChatThinkingProcessLocale(): PluginLocale {
    return getPluginUiLanguage();
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

export function getToolContextUsedInfo(tool: string, locale?: PluginLocale): Pick<ChatContextUsedItem, 'category' | 'label' | 'detail'> {
    const entry = TOOL_CONTEXT_MAP[tool];
    if (entry) {
        return { category: entry.category, label: ft(entry.labelKey, undefined, locale), detail: ft(entry.detailKey, undefined, locale) };
    }
    return {
        category: 'read-only-tool',
        label: ft('plugin.chat.formatter.contextTool.default.label', undefined, locale),
        detail: ft('plugin.chat.formatter.contextTool.default.detail', undefined, locale),
    };
}

export function formatToolRunningStatus(tool: string, locale?: PluginLocale): string {
    if (tool === 'get_current_note_context') return ft('plugin.chat.formatter.readingCurrentNote', undefined, locale);
    if (tool === 'inspect_obsidian_note') return ft('plugin.chat.formatter.readingNoteStructure', undefined, locale);
    if (tool === 'read_canvas_summary') return ft('plugin.chat.formatter.checkingCanvasStructure', undefined, locale);
    if (tool === 'search_vault_snippets') return ft('plugin.chat.formatter.searchingNoteSnippets', undefined, locale);
    if (tool === 'list_vault_tags') return ft('plugin.chat.formatter.readingTags', undefined, locale);
    if (tool === 'search_vault_metadata') return ft('plugin.chat.formatter.searchingMetadata', undefined, locale);
    if (tool === 'list_recent_notes') return ft('plugin.chat.formatter.readingRecentNotes', undefined, locale);
    if (tool === 'read_note_outline') return ft('plugin.chat.formatter.readingNoteOutline', undefined, locale);
    return ft('plugin.chat.formatter.readingContext', undefined, locale);
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
        const key = `${item.category}:${item.label}:${item.memoryClaimId ?? ""}`;
        const existing = byKey.get(key);
        if (!existing) {
            const safeItem = { ...item };
            delete safeItem.sources;
            byKey.set(key, {
                ...safeItem,
                ...(item.memoryClaimId
                    ? {}
                    : { sources: dedupeContextSources(item.sources) }),
            });
            continue;
        }
        if (existing.memoryClaimId) {
            delete existing.sources;
        } else {
            existing.sources = dedupeContextSources([
                ...(existing.sources ?? []),
                ...(item.sources ?? []),
            ]);
        }
        existing.detail ??= item.detail;
        existing.memoryEffect ??= item.memoryEffect;
        existing.memorySource ??= item.memorySource;
        existing.memoryScope ??= item.memoryScope;
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
            const memoryClaimId = typeof record.memoryClaimId === 'string'
                ? record.memoryClaimId
                : undefined;
            return {
                category: record.category as ChatContextUsedItem['category'],
                label: record.label,
                detail: typeof record.detail === 'string' ? record.detail : undefined,
                sources: !memoryClaimId && Array.isArray(record.sources)
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
                memoryClaimId,
                memoryEffect: record.memoryEffect === 'future_answers'
                    || record.memoryEffect === 'collaboration_default'
                    ? record.memoryEffect
                    : undefined,
                memorySource: record.memorySource === 'notes'
                    || record.memorySource === 'interactions'
                    || record.memorySource === 'settings'
                    || record.memorySource === 'mixed'
                    ? record.memorySource
                    : undefined,
                memoryScope: record.memoryScope === 'current_vault'
                    || record.memoryScope === 'same_device'
                    ? record.memoryScope
                    : undefined,
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
            const observedRevision = parseObservedSourceRevision(record.observedRevision);
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
                ...(observedRevision ? { observedRevision } : {}),
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
            JSON.stringify(record.observedRevision ?? null),
        ].join('\u0000');
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

export function getContextUsedItemsFromStatus(status: ChatAgentStatus, locale?: PluginLocale): ChatContextUsedItem[] {
    const lt = (key: string, params?: Readonly<Record<string, string | number>>) => ft(key, params, locale);
    if (status.type === 'memory-selected' || status.type === 'memory-expanded') {
        if (status.sources.length === 0) return [];
        return [{
            category: 'memory',
            label: lt('plugin.chat.formatter.contextUsed.selectedMemory'),
            detail: status.sources.length === 1
                ? lt('plugin.chat.formatter.contextUsed.selectedNoteOne')
                : lt('plugin.chat.formatter.contextUsed.selectedNoteMany', { count: status.sources.length }),
            sources: status.sources,
            citationEligible: true,
        }];
    }
    if (status.type === 'tool-done') {
        const toolInfo = getToolContextUsedInfo(status.tool, locale);
        if (status.availability === 'unavailable') {
            return [{
                category: 'tool-unavailable',
                label: lt('plugin.chat.formatter.contextUsed.toolUnavailableLabel', { label: toolInfo.label }),
                detail: lt('plugin.chat.formatter.contextUsed.vaultContextUnavailable'),
                sources: status.sources,
                citationEligible: false,
                statusOnly: true,
            }];
        }
        return [{
            category: toolInfo.category,
            label: toolInfo.label,
            detail: status.availability === 'partial'
                ? lt('plugin.chat.formatter.contextUsed.partialDetail', { detail: toolInfo.detail ?? '' })
                : toolInfo.detail,
            sources: status.sources,
            citationEligible: false,
        }];
    }
    if (status.type === 'tool-skipped') {
        if (isDuplicateReadOnlyToolSkip(status)) return [];
        const toolInfo = getToolContextUsedInfo(status.tool, locale);
        return [{
            category: 'tool-unavailable',
            label: lt('plugin.chat.formatter.contextUsed.toolUnavailableLabel', { label: toolInfo.label }),
            detail: lt('plugin.chat.formatter.contextUsed.vaultContextUnavailable'),
            statusOnly: true,
        }];
    }
    if (status.type === 'fallback') {
        const isLoopCap = /cap reached|stopped before/i.test(status.reason);
        return [{
            category: isLoopCap ? 'loop-cap' : 'fallback',
            label: isLoopCap
                ? lt('plugin.chat.formatter.contextUsed.usingGathered')
                : lt('plugin.chat.formatter.contextUsed.availableContext'),
            detail: isLoopCap
                ? lt('plugin.chat.formatter.contextUsed.answeredAfterLimit')
                : lt('plugin.chat.formatter.contextUsed.answeredFromAvailable'),
            statusOnly: true,
        }];
    }
    return [];
}

export function formatAgentStatus(status: ChatAgentStatus, locale?: PluginLocale): string {
    const lt = (key: string, params?: Readonly<Record<string, string | number>>) => ft(key, params, locale);
    if (status.type === 'thinking') {
        return lt('plugin.chat.formatter.decidingContext');
    } else if (status.type === 'memory-prefetching') {
        return lt('plugin.chat.formatter.searchingNotes', { query: status.query });
    } else if (status.type === 'memory-prefetched') {
        const sources = formatSourceSummary(status.sources);
        return sources ? lt('plugin.chat.formatter.relatedNotesFound', { sources }) : lt('plugin.chat.formatter.noRelatedNotes');
    } else if (status.type === 'memory-reranking') {
        return lt('plugin.chat.formatter.checkingRelatedNotes', { count: status.candidateCount });
    } else if (status.type === 'memory-selected') {
        const sources = formatSourceSummary(status.sources);
        return sources ? lt('plugin.chat.formatter.selectedNotes', { sources }) : lt('plugin.chat.formatter.noRelevantNotes');
    } else if (status.type === 'memory-expanded') {
        return lt('plugin.chat.formatter.readingSelectedNotes');
    } else if (status.type === 'retrieving') {
        return lt('plugin.chat.formatter.searchingNotes', { query: status.query });
    } else if (status.type === 'retrieved') {
        const sources = formatSourceSummary(status.sources);
        return sources ? lt('plugin.chat.formatter.relatedNotesFound', { sources }) : lt('plugin.chat.formatter.noRelatedNotes');
    } else if (status.type === 'memory-skipped') {
        return /returned 0 source/i.test(status.reason) ? lt('plugin.chat.formatter.noRelatedNotes') : lt('plugin.chat.formatter.notesSkipped');
    } else if (status.type === 'tool-running') {
        return formatToolRunningStatus(status.tool, locale);
    } else if (status.type === 'tool-done') {
        const sources = formatSourceSummary(status.sources);
        const toolInfo = getToolContextUsedInfo(status.tool, locale);
        return sources
            ? lt('plugin.chat.formatter.toolDoneWithSources', { label: toolInfo.label, sources })
            : lt('plugin.chat.formatter.toolDoneNoSources', { label: toolInfo.label });
    } else if (status.type === 'tool-skipped') {
        if (isDuplicateReadOnlyToolSkip(status)) return lt('plugin.chat.formatter.contextAlreadyGathered');
        return lt('plugin.chat.formatter.contextUnavailable');
    } else if (status.type === 'answering') {
        return lt('plugin.chat.formatter.answering');
    } else if (status.type === 'fallback') {
        return /cap reached|stopped before/i.test(status.reason)
            ? lt('plugin.chat.formatter.usingGatheredContext')
            : lt('plugin.chat.formatter.answeringFromContext');
    }
    return lt('plugin.chat.formatter.thinking');
}

export function formatCanonicalToolStatus(toolName: string, locale?: PluginLocale): string {
    if (toolName === 'search_memory') return ft('plugin.chat.formatter.searchingMemory', undefined, locale);
    if (toolName === 'webSearch') return ft('plugin.chat.formatter.searchingWeb', undefined, locale);
    return ft(getToolRunningKey(toolName), undefined, locale);
}

function getToolRunningKey(toolName: string): string {
    if (toolName === 'get_current_note_context') return 'plugin.chat.formatter.readingCurrentNote';
    if (toolName === 'inspect_obsidian_note') return 'plugin.chat.formatter.readingNoteStructure';
    if (toolName === 'read_canvas_summary') return 'plugin.chat.formatter.checkingCanvasStructure';
    if (toolName === 'search_vault_snippets') return 'plugin.chat.formatter.searchingNoteSnippets';
    if (toolName === 'list_vault_tags') return 'plugin.chat.formatter.readingTags';
    if (toolName === 'search_vault_metadata') return 'plugin.chat.formatter.searchingMetadata';
    if (toolName === 'list_recent_notes') return 'plugin.chat.formatter.readingRecentNotes';
    if (toolName === 'read_note_outline') return 'plugin.chat.formatter.readingNoteOutline';
    return 'plugin.chat.formatter.readingContext';
}

export function formatCanonicalToolCompletedStatus(toolName: string, outcome: string, locale?: PluginLocale): string {
    const label = toolName === 'search_memory'
        ? ft('plugin.chat.formatter.toolLabel.memory', undefined, locale)
        : toolName === 'webSearch'
            ? ft('plugin.chat.formatter.toolLabel.webSearch', undefined, locale)
            : ft(getToolContextLabelKey(toolName), undefined, locale);
    if (outcome === 'success') return ft('plugin.chat.formatter.toolComplete', { label }, locale);
    if (outcome === 'reused_result') return ft('plugin.chat.formatter.toolReused', { label }, locale);
    if (outcome === 'control_applied') return ft('plugin.chat.formatter.toolControlApplied', { label }, locale);
    if (outcome === 'budget_exceeded') return ft('plugin.chat.formatter.toolSkippedBudget', { label }, locale);
    if (outcome === 'duplicate_skipped') return ft('plugin.chat.formatter.toolAlreadyGathered', { label }, locale);
    if (outcome === 'aborted' || outcome === 'abort_timeout') return ft('plugin.chat.formatter.toolStopped', { label }, locale);
    return ft('plugin.chat.formatter.toolUnavailable', { label }, locale);
}

function getToolContextLabelKey(toolName: string): string {
    const entry = TOOL_CONTEXT_MAP[toolName];
    return entry?.labelKey ?? 'plugin.chat.formatter.contextTool.default.label';
}

export function formatThinkingResultFact(fact: { kind: string } | undefined, locale?: PluginLocale): string | undefined {
    if (!fact) return undefined;
    switch (fact.kind) {
        case 'accepted': return ft('plugin.chat.thinking.factAccepted', undefined, locale);
        case 'evidence': return ft('plugin.chat.thinking.factEvidence', undefined, locale);
        case 'no_match': return ft('plugin.chat.thinking.factNoMatch', undefined, locale);
        case 'unavailable': return ft('plugin.chat.thinking.factUnavailable', undefined, locale);
        case 'transient_failure': return ft('plugin.chat.thinking.factTransientFailure', undefined, locale);
        case 'artifact_ready': return ft('plugin.chat.thinking.factArtifactReady', undefined, locale);
        case 'approval_pending': return ft('plugin.chat.thinking.factApprovalPending', undefined, locale);
        case 'applied': return ft('plugin.chat.thinking.factApplied', undefined, locale);
        case 'partial': return ft('plugin.chat.thinking.factPartial', undefined, locale);
        case 'unknown': return ft('plugin.chat.thinking.factUnknown', undefined, locale);
        default: return undefined;
    }
}

export function formatThinkingDuration(milliseconds: number, locale: PluginLocale): string {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return ft('plugin.chat.thinking.elapsedSeconds', { seconds }, locale);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return ft('plugin.chat.thinking.elapsedMinutes', {
        minutes,
        seconds: String(remainingSeconds).padStart(2, '0'),
    }, locale);
}

export function formatRuntimeWarningType(type: string, locale?: PluginLocale): string {
    if (type === 'provider_admission_rejected') return ft('plugin.chat.formatter.warningContextUnavailable', undefined, locale);
    if (type === 'provider_tool_calls_missing') return ft('plugin.chat.formatter.warningToolRequestIncomplete', undefined, locale);
    if (type === 'assistant_source_changed') return ft('plugin.chat.writing.sourceChangedHint', undefined, locale);
    if (type === 'context_local_overflow' || type === 'provider_context_overflow') return ft('plugin.chat.formatter.warningContextTooLong', undefined, locale);
    if (type === 'required_capability_missing') return ft('plugin.chat.formatter.warningIncomplete', undefined, locale);
    if (type === 'provider_partial_error') return ft('plugin.chat.formatter.warningStoppedEarly', undefined, locale);
    if (type === 'assistant_idle_timeout') return ft('plugin.chat.formatter.warningIdleTimeout', undefined, locale);
    if (type === 'assistant_empty_response') return ft('plugin.chat.formatter.warningEmptyResponse', undefined, locale);
    if (type === 'wall_clock_exceeded') return ft('plugin.chat.formatter.warningRuntimeLimit', undefined, locale);
    return ft('plugin.chat.formatter.warningGeneric', undefined, locale);
}

export function formatRuntimeWarningLabel(warning: ChatRuntimeWarning, locale?: PluginLocale): string {
    if (warning.type === 'provider_admission_rejected' || warning.type === 'provider_tool_calls_missing') return formatRuntimeWarningType(warning.type, locale);
    if (warning.type === 'assistant_empty_response' || warning.type === 'context_local_overflow'
        || warning.type === 'provider_context_overflow') return formatRuntimeWarningType(warning.type, locale);
    return warning.message ?? formatRuntimeWarningType(warning.type, locale);
}

export function formatRuntimeWarningDetail(warning: ChatRuntimeWarning, locale?: PluginLocale): string | undefined {
    if (warning.type === 'context_local_overflow') return ft('plugin.chat.formatter.warningContextTooLongDetail', undefined, locale);
    if (warning.type === 'provider_context_overflow') return ft('plugin.chat.formatter.warningProviderContextTooLongDetail', undefined, locale);
    if (warning.type === 'assistant_empty_response') return ft('plugin.chat.formatter.warningNoAnswer', undefined, locale);
    return warning.detail ?? warning.capability;
}

export function formatCanonicalTerminalSummary(
    status: string | undefined,
    warnings: ChatRuntimeWarning[] = [],
    locale?: PluginLocale,
): string {
    if (warnings.some((warning) => warning.type === 'context_local_overflow' || warning.type === 'provider_context_overflow')) {
        return ft('plugin.chat.formatter.warningContextTooLong', undefined, locale);
    }
    if (status === 'needs_user') return ft('plugin.chat.formatter.summaryNeedsUser', undefined, locale);
    if (status === 'incomplete' || warnings.some((warning) => warning.type === 'assistant_empty_response')) {
        return ft('plugin.chat.formatter.summaryIncomplete', undefined, locale);
    }
    if (status === 'aborted') return ft('plugin.chat.formatter.summaryCancelled', undefined, locale);
    if (status === 'error') return ft('plugin.chat.formatter.summaryFailed', undefined, locale);
    if (status === 'completed_with_warning' || warnings.length > 0) return ft('plugin.chat.formatter.summaryWithWarning', undefined, locale);
    return ft('plugin.chat.formatter.summaryComplete', undefined, locale);
}

export function runtimeWarningKey(warning: ChatRuntimeWarning): string {
    return JSON.stringify([
        warning.type,
        warning.message ?? '',
        warning.detail ?? '',
        warning.capability ?? '',
    ]);
}
