import type { PaAgentMessage } from "./chat-types";
import { parseObservedSourceRevision } from "./generation-input-snapshot";
import { createSourceDedupKey } from "./source-store";
import { parseVaultObservationEvidence, stableJson } from "./vault-observation-evidence";
import { validateSourceRefPathShape } from "../pa/contracts/source-ref";

type ToolResult = Extract<PaAgentMessage, { role: "toolResult" }>;

/** Run-local, Host-owned progress. A successful call alone is not new task evidence. */
export class HostProgressLedger {
    private readonly seen = new Set<string>();
    private activeWritingSelection: string | null = null;
    epoch = 0;

    preview(results: readonly ToolResult[]): string[][] {
        return this.identities(results, false);
    }

    record(results: readonly ToolResult[]): boolean {
        let advanced = false;
        for (const identities of this.identities(results, true)) {
            for (const identity of identities) {
                if (this.seen.has(identity)) continue;
                this.seen.add(identity);
                advanced = true;
            }
        }
        if (advanced) this.epoch += 1;
        return advanced;
    }

    private identities(results: readonly ToolResult[], commit: boolean): string[][] {
        let activeWritingSelection = this.activeWritingSelection;
        const identities = results.map(result => {
            const keys = hostProgressIdentities(result);
            const selection = preparedWritingContextSelection(result);
            if (selection !== null && selection !== activeWritingSelection) {
                keys.push(`get_writing_context:${stableJson({ from: activeWritingSelection, to: selection })}`);
                activeWritingSelection = selection;
            }
            return keys;
        });
        if (commit) this.activeWritingSelection = activeWritingSelection;
        return identities;
    }
}

export function hostProgressIdentities(result: ToolResult): string[] {
    const metadata = result.content.metadata;
    const outcome = metadata?.outcome;
    if (result.isError || outcome !== "success" || !result.content.includeInNextPrompt
        || !result.content.promptText.trim()) return [];

    if (metadata?.vaultObservationContractVersion === 1) {
        const parsed = parseVaultObservationEvidence(metadata.vaultObservationEvidence);
        if (!parsed.ok || parsed.evidence.tool !== result.toolName) return [];
        const evidence = parsed.evidence;
        const scope = stableJson({
            allowedPaths: evidence.scope.allowedPaths?.slice().sort() ?? null,
            excludedPaths: evidence.scope.excludedPaths.slice().sort(),
        });
        const prefix = `${evidence.tool}:${scope}:`;
        switch (evidence.tool) {
            case "read_note": {
                const item = evidence.items[0];
                return [prefix + stableJson({ path: item.path, part: item.part,
                    contentHash: item.contentHash, range: item.range })];
            }
            case "inspect_obsidian_note": {
                const item = evidence.items[0];
                return [prefix + stableJson({ path: item.path, cacheProjectionDigest: item.cacheProjectionDigest,
                    linkFactsDigest: item.linkFactsDigest, bodyRead: item.bodyRead,
                    bodyHash: item.bodyHash ?? null })];
            }
            case "query_notes": {
                const itemKeys = evidence.items.map(item => prefix + stableJson({
                    path: item.path, metadataDigest: item.metadataDigest,
                }));
                // A complete, versioned search domain also proves a bounded no-match fact.
                if (evidence.coverage.state === "complete"
                    && !evidence.coverage.cacheUnknown
                    && evidence.aggregate.completeCandidateSet && evidence.aggregate.projectionComplete
                    && evidence.aggregate.evaluatedCandidates === evidence.coverage.evaluatedCandidates) {
                    itemKeys.push(prefix + stableJson({ coverage: {
                        candidateSetDigest: evidence.aggregate.candidateSetDigest,
                        metadataSetDigest: evidence.aggregate.metadataSetDigest,
                    } }));
                }
                return itemKeys;
            }
            case "search_vault_snippets": {
                const itemKeys = evidence.items.map(item => prefix + stableJson({
                    path: item.path, part: item.part, range: item.range,
                    contentHash: item.contentHash,
                }));
                if (evidence.coverage.state === "complete"
                    && !evidence.coverage.skippedFiles
                    && evidence.aggregate.evaluatedCandidates === evidence.coverage.evaluatedCandidates) {
                    itemKeys.push(prefix + stableJson({ coverage: {
                        part: evidence.aggregate.part,
                        candidateSetDigest: evidence.aggregate.candidateSetDigest,
                        scannedVersionDigest: evidence.aggregate.scannedVersionDigest,
                    } }));
                }
                return itemKeys;
            }
        }
    }

    if (result.toolName === "get_current_note_context"
        && metadata?.tool === "get_current_note_context" && metadata.ok === true) {
        return (result.content.sourceRecords ?? []).flatMap(record => {
            if (record.kind !== "context-used" || record.sourceBoundary !== "current-note"
                || record.capabilityName !== "get_current_note_context"
                || record.providerId !== "core-tools" || record.citationEligible !== false
                || record.statusOnly === true || record.redacted === true
                || typeof record.path !== "string" || record.path.length > 4096
                || !validateSourceRefPathShape({ path: record.path }).ok
                || record.dedupKey !== createSourceDedupKey(record.path)) return [];
            const revision = parseObservedSourceRevision(record.observedRevision);
            if (revision?.state !== "identified"
                || (revision.basis !== "editor_snapshot" && revision.basis !== "metadata_snapshot")) return [];
            return [`get_current_note_context:${stableJson({ path: record.path,
                basis: revision.basis, scope: revision.digest.scope,
                digest: revision.digest.value })}`];
        });
    }

    const appliedInsight = appliedInsightReceipt(result);
    return appliedInsight ? [`manage_saved_insight:${appliedInsight}`] : [];
}

export function preparedWritingContextSelection(result: ToolResult): string | null {
    if (result.toolName !== "get_writing_context" || result.isError
        || result.content.metadata?.outcome !== "success"
        || result.content.metadata.tool !== "get_writing_context"
        || result.content.metadata.ok !== true
        || !result.content.includeInNextPrompt || !result.content.promptText.trim()) return null;
    let payload: unknown;
    try { payload = JSON.parse(result.content.promptText); } catch { return null; }
    if (!payload || typeof payload !== "object") return null;
    const envelope = payload as Record<string, unknown>;
    if (envelope.tool !== "get_writing_context" || envelope.status !== "ok"
        || envelope.input !== "Requested writing context"
        || !envelope.observation || typeof envelope.observation !== "object") return null;
    const observation = envelope.observation as Record<string, unknown>;
    const handle = observation.contextHandle;
    if (typeof handle !== "string" || !/^[A-Za-z0-9_-]{1,128}:writing:[1-9][0-9]*$/.test(handle)) return null;
    const parent = observation.parent;
    if (parent !== null && (!parent || typeof parent !== "object"
        || typeof (parent as Record<string, unknown>).textHash !== "string"
        || !/^[a-f0-9]{64}$/.test((parent as Record<string, string>).textHash))) return null;
    const scene = observation.scene;
    if (scene !== null && (!scene || typeof scene !== "object" || Array.isArray(scene)
        || ["writingTask", "purpose", "audience", "domain"].some(key =>
            typeof (scene as Record<string, unknown>)[key] !== "string"))) return null;
    const images = observation.images;
    if (!Array.isArray(images) || images.some(image => !image || typeof image !== "object"
        || !image.ref || typeof image.ref.assetId !== "string"
        || typeof image.ref.contentHash !== "string")) return null;
    const style = observation.style;
    if (!style || typeof style !== "object" || Array.isArray(style)
        || typeof (style as Record<string, unknown>).context !== "string"
        || !Array.isArray((style as Record<string, unknown>).revisionIds)
        || !(style as { revisionIds: unknown[] }).revisionIds.every(id => typeof id === "string")) return null;
    // Context handles are Host-issued output authority, but a new handle alone
    // does not add task evidence. Compare the active semantic selection instead.
    return stableJson({ parentTextHash: parent ? (parent as Record<string, unknown>).textHash : null,
        scene, images: images.map(image => image.ref),
        style: { context: (style as Record<string, unknown>).context,
            revisionIds: (style as Record<string, unknown>).revisionIds } });
}

export function appliedInsightReceipt(result: ToolResult): string | null {
    if (result.toolName !== "manage_saved_insight" || result.isError
        || result.content.metadata?.outcome !== "success") return null;
    const fact = result.content.resultFact;
    return fact?.kind === "applied" && fact.action === "saved_insight" && fact.receiptId.trim()
        ? fact.receiptId : null;
}
