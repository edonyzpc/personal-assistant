import type { BaselineExportBlock, ExportBlock, LexicalNodeJson, RemoteExportBlock } from "./types";

export type FormatReplacementMode = "preserve-matching" | "replace-all";

export interface FormatPreservationResult {
    status: "ok" | "needs-explicit-replace";
    preservedNodes: Array<{ blockId: string; remoteBlockId: string; node: LexicalNodeJson }>;
    newBlocks: string[];
    conflicts: Array<{
        blockId: string;
        reason: "remote-semantic-change" | "ambiguous-signature" | "remote-extra-block" | "remote-missing-block";
    }>;
}

interface BaselineRelation {
    baseline: BaselineExportBlock;
    remote: RemoteExportBlock;
}

function matchCurrentToBaseline(
    current: ExportBlock,
    candidates: readonly BaselineExportBlock[],
): BaselineExportBlock | undefined {
    const sameHash = candidates.filter((baseline) =>
        baseline.sourcePath === current.sourcePath && baseline.sourceHash === current.sourceHash);
    if (sameHash.length === 1) return sameHash[0];
    const sameSemantic = candidates.filter((baseline) =>
        baseline.sourcePath === current.sourcePath
        && baseline.semanticSignature === current.semanticSignature);
    if (sameSemantic.length === 1) return sameSemantic[0];
    return undefined;
}

function relateBaselineToRemote(
    baseline: BaselineExportBlock,
    remoteBlocks: readonly RemoteExportBlock[],
): BaselineRelation | { ambiguous: true } | undefined {
    if (baseline.remoteBlockId) {
        const remote = remoteBlocks.find((candidate) => candidate.id === baseline.remoteBlockId);
        return remote ? { baseline, remote } : undefined;
    }
    const matches = remoteBlocks.filter((candidate) => candidate.semanticSignature === baseline.semanticSignature);
    if (matches.length === 1) return { baseline, remote: matches[0] };
    if (matches.length > 1) return { ambiguous: true };
    return undefined;
}

export function planFormatPreservation(
    sourceBlocks: readonly ExportBlock[],
    remoteBlocks: readonly RemoteExportBlock[],
    baselineBlocks: readonly BaselineExportBlock[] = [],
    mode: FormatReplacementMode = "preserve-matching",
): FormatPreservationResult {
    if (mode === "replace-all") {
        return {
            status: "ok",
            preservedNodes: [],
            newBlocks: sourceBlocks.map((block) => block.id),
            conflicts: [],
        };
    }

    const conflicts: FormatPreservationResult["conflicts"] = [];
    const relations = new Map<string, BaselineRelation>();
    for (const baseline of baselineBlocks) {
        const relation = relateBaselineToRemote(baseline, remoteBlocks);
        if (relation === undefined) {
            conflicts.push({ blockId: baseline.id, reason: "remote-missing-block" });
            continue;
        }
        if ("ambiguous" in relation) {
            conflicts.push({ blockId: baseline.id, reason: "ambiguous-signature" });
            continue;
        }
        relations.set(baseline.id, relation);
    }

    for (const relation of relations.values()) {
        if (relation.remote.semanticSignature !== relation.baseline.semanticSignature) {
            conflicts.push({
                blockId: relation.baseline.id,
                reason: "remote-semantic-change",
            });
        }
    }

    const unusedBaseline = new Map(baselineBlocks.map((baseline) => [baseline.id, baseline]));
    const usedRemote = new Set<string>();
    const preservedNodes: FormatPreservationResult["preservedNodes"] = [];
    const newBlocks: string[] = [];
    for (const current of sourceBlocks) {
        const candidates = [...unusedBaseline.values()].filter((candidate) =>
            candidate.sourcePath === current.sourcePath
            && (candidate.sourceHash === current.sourceHash
                || candidate.semanticSignature === current.semanticSignature));
        if (candidates.length > 1) {
            conflicts.push({ blockId: current.id, reason: "ambiguous-signature" });
            newBlocks.push(current.id);
            continue;
        }
        const baseline = matchCurrentToBaseline(current, candidates);
        if (!baseline) {
            newBlocks.push(current.id);
            continue;
        }
        unusedBaseline.delete(baseline.id);
        const relation = relations.get(baseline.id);
        if (!relation || usedRemote.has(relation.remote.id)) {
            newBlocks.push(current.id);
            continue;
        }
        if (relation.remote.semanticSignature !== baseline.semanticSignature) {
            newBlocks.push(current.id);
            continue;
        }
        if (current.semanticSignature === relation.remote.semanticSignature) {
            usedRemote.add(relation.remote.id);
            preservedNodes.push({
                blockId: current.id,
                remoteBlockId: relation.remote.id,
                node: relation.remote.node,
            });
        } else {
            newBlocks.push(current.id);
        }
    }

    const relatedRemote = new Set([...relations.values()].map((relation) => relation.remote.id));
    for (const remote of remoteBlocks) {
        if (!relatedRemote.has(remote.id)) {
            conflicts.push({
                blockId: remote.id,
                reason: "remote-extra-block",
            });
        }
    }

    return {
        status: conflicts.length > 0 ? "needs-explicit-replace" : "ok",
        preservedNodes,
        newBlocks,
        conflicts,
    };
}
