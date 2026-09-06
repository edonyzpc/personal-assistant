import { stableStringify } from "../ai-services/agent-utils";
import type { ExistingUserProfileReader, UserProfileReadResult } from "../ai-services/memory-extraction/profile-store";
import { renderUserProfileMarkdown, type UserProfileRecord, type UserProfileSnapshot } from "../ai-services/memory-extraction/type-a-extractor";
import type { PersistedTurn } from "../chat/chat-history-store";
import { collectChatMemorySources, isChatMemoryRecordAdmissible } from "./chat-memory-admission";
import { stableHash } from "./helpers";
import { classifyLegacyTypeAAdoption } from "./legacy-type-a-adoption";
import type { LegacyMemoryFinalizationSourceSnapshot } from "./memory-governance-finalization";
import { createTypeATargetSuppressionFingerprint, LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT } from "./memory-governance-migration-coordinator";
import { buildLegacyMemoryRollbackProjection } from "./memory-governance-rollback";
import type { DeviceMemoryGovernanceStateV1, GovernedMemoryClaim, MemoryClaimRevision, MemoryGovernanceRepository, MemoryProjectionLink } from "./memory-governance-persistence";

export type MemoryGovernanceUpgradeResult =
    | { ok: true; adoptedCount: number }
    | { ok: false; reason: string };

export interface MemoryGovernanceUpgradeOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    profileReader: ExistingUserProfileReader;
    readLegacySource(): Promise<LegacyMemoryFinalizationSourceSnapshot>;
    /** Undefined means missing or unreadable; an empty array is a real empty conversation. */
    readConversation(id: string): Promise<readonly PersistedTurn[] | undefined>;
    isPathAllowed(path: string): boolean;
    /** Captures vault, boundary, plugin lifecycle and compatibility-file identity. */
    isCurrent(): boolean;
}

class UpgradeBlocked extends Error {
    constructor(readonly reason: string) { super(reason); }
}

type Mapping = { claim: GovernedMemoryClaim; revision: MemoryClaimRevision; profileLink: MemoryProjectionLink; existing: boolean };
type Sources = { profile: UserProfileReadResult; legacy: LegacyMemoryFinalizationSourceSnapshot; conversations: Record<string, readonly PersistedTurn[]> };

/** Explicit local upgrade only. No Profile writes, extraction, migration restart or legacy cleanup. */
export class MemoryGovernanceUpgradeCoordinator {
    constructor(private readonly options: MemoryGovernanceUpgradeOptions) {}

    async run(): Promise<MemoryGovernanceUpgradeResult> {
        const o = this.options;
        try {
            this.assertCurrent();
            const initial = await o.repository.initialize();
            const sources = await this.readSources(await o.profileReader.read());
            const mappings = this.plan(initial, sources);
            this.assertCurrent();
            if (!o.profileReader.acquireReadLease) throw new UpgradeBlocked("profile_lock_unavailable");
            const lease = await o.profileReader.acquireReadLease();
            try {
                // An absent DB cannot be locked without creating storage. Never
                // mistake that limitation for a successfully locked empty source.
                if (!lease.isCurrent()) throw new UpgradeBlocked(lease.result.state === "not_present"
                    ? "profile_absence_unlocked" : "profile_lock_unavailable");
                if (fingerprint(lease.result) !== fingerprint(sources.profile)) throw new UpgradeBlocked("profile_changed");
                const assertCurrent = (): void => {
                    this.assertCurrent();
                    if (!lease.isCurrent()) throw new UpgradeBlocked("profile_lock_expired");
                };
                await o.repository.transact(async (draft) => {
                    if (draft.commitSequence !== initial.commitSequence) throw new UpgradeBlocked("governance_changed");
                    const currentSources = await this.readSources(lease.result);
                    if (fingerprint(currentSources) !== fingerprint(sources)) throw new UpgradeBlocked("source_changed");
                    this.plan(draft, currentSources);
                    assertCurrent();
                    for (const mapping of mappings) this.applyMapping(draft, mapping);
                    const policy = draft.policyStates[o.opaqueVaultKey];
                    policy.mode = "effect_based";
                    policy.contextProjectionMode = "governed";
                    // Preserve migrationRunId, cutoverSequence, deltas and the
                    // original rollback deadline. Rollback still uses its proof.
                }, Object.assign(assertCurrent, { signal: lease.signal }));
                return { ok: true, adoptedCount: mappings.length };
            } finally { lease.release(); }
        } catch (error) {
            return { ok: false, reason: error instanceof UpgradeBlocked ? error.reason : "upgrade_unavailable" };
        }
    }

    private assertCurrent(): void {
        if (!this.options.isCurrent()) throw new UpgradeBlocked("source_changed");
    }

    private async readSources(profile: UserProfileReadResult): Promise<Sources> {
        const records = readProfile(profile);
        const legacy = await this.options.readLegacySource();
        const conversations: Sources["conversations"] = Object.create(null) as Sources["conversations"];
        for (const id of new Set(records.flatMap((record) => record.conversationIds))) {
            const turns = await this.options.readConversation(id);
            if (turns) conversations[id] = turns;
        }
        this.assertCurrent();
        return { profile, legacy, conversations };
    }

    private plan(state: DeviceMemoryGovernanceStateV1, sources: Sources): Mapping[] {
        const key = this.options.opaqueVaultKey;
        const migration = state.migrationStates[key];
        const policy = state.policyStates[key];
        if (!key || !migration || migration.phase !== "compatibility" || !migration.sourceHash
            || !migration.migrationRunId || !migration.cutoverSequence || migration.lastErrorCode
            || policy?.mode !== "legacy_threshold" || policy.contextProjectionMode !== "legacy"
            || policy.legacyBaseline?.importedFromSourceHash !== migration.sourceHash) throw new UpgradeBlocked("upgrade_not_available");
        if (migration.pendingLegacySourceHash) throw new UpgradeBlocked("legacy_source_changed");
        if (sources.legacy.sourceHash !== (migration.legacySourceStateHash ?? migration.sourceHash)) throw new UpgradeBlocked("legacy_source_changed");
        if (!migration.rollbackExpiresAt) throw new UpgradeBlocked("rollback_proof_unavailable");
        // Verify the original proof at its original deadline, even if elapsed.
        // This verifies identity without granting a fresh rollback window.
        const rollback = buildLegacyMemoryRollbackProjection(state, key, new Date(migration.rollbackExpiresAt));
        // Local queue/claim changes are journaled for rollback while the
        // compatibility barrier preserves the legacy source. Their replay can
        // legitimately differ from that source, whose exact hash is checked above.
        if (!rollback.ok) throw new UpgradeBlocked("legacy_projection_mismatch");
        const inPartition = (partition: { kind: string; key: string }): boolean => partition.kind === "device_collaboration" || partition.key === key;
        if (state.pendingOperations.some((operation) => operation.kind === "forget"
            ? inPartition(operation.partition)
            : operation.state === "pending" && state.claims.some((claim) => claim.id === operation.claimId && inPartition(claim.partition)))) {
            throw new UpgradeBlocked("pending_operations");
        }
        const records = readProfile(sources.profile);
        const ids = new Set(records.map((record) => record.profileRecordId!));
        const vaultClaims = new Set(state.claims.filter((claim) => claim.partition.kind === "vault" && claim.partition.key === key).map((claim) => claim.id));
        // A live source link with no row is an incomplete external projection,
        // never an invitation to recreate a removed Profile row.
        if (state.projectionLinks.some((link) => link.state === "active" && vaultClaims.has(link.claimId)
            && link.target.kind === "type_a_profile" && !ids.has(link.target.profileRecordId))) throw new UpgradeBlocked("profile_projection_mismatch");
        for (const record of sources.legacy.projection.records) {
            if (!record.sourceRefs.every((ref) => this.options.isPathAllowed(ref.path))) throw new UpgradeBlocked("source_excluded");
        }
        return records.map((record) => this.mapRecord(state, sources, record));
    }

    private mapRecord(state: DeviceMemoryGovernanceStateV1, sources: Sources, record: UserProfileRecord): Mapping {
        const key = this.options.opaqueVaultKey;
        const profileId = record.profileRecordId!;
        const links = state.projectionLinks.filter((link) => link.target.kind === "type_a_profile" && link.target.profileRecordId === profileId
            && state.claims.some((claim) => claim.id === link.claimId && claim.partition.kind === "vault" && claim.partition.key === key));
        const suppression = createTypeATargetSuppressionFingerprint(key, profileId);
        if (state.suppressionMarkers.some((marker) => (marker.partition.kind === "device_collaboration" || marker.partition.key === key)
            && (marker.sourceFingerprintId === suppression || links.some((link) => link.sourceFingerprintId === marker.sourceFingerprintId)))) {
            throw new UpgradeBlocked("source_suppressed");
        }
        if (links.length) {
            if (links.length !== 1 || links[0].state !== "active") throw new UpgradeBlocked("profile_projection_mismatch");
            const profileLink = links[0];
            const claim = state.claims.find((entry) => entry.id === profileLink.claimId)!;
            const revision = state.revisions.find((entry) => entry.id === claim.activeRevisionId && entry.claimId === claim.id);
            if (!revision || claim.lifecycle !== "active" || claim.effect !== "future_answers" || claim.sensitivity !== "low"
                || revision.writingStyle || revision.summary !== record.text
                || !["explicit_user", "user_correction"].includes(revision.authority)
                || !revision.provenance.length || revision.provenance.some((item) => item.kind !== "conversation"
                    || item.conversationIds.some((id) => !record.conversationIds.includes(id)))
                || !record.conversationIds.every((id) => revision.provenance.some((item) => item.kind === "conversation" && item.conversationIds.includes(id)))) {
                throw new UpgradeBlocked("profile_projection_mismatch");
            }
            return { claim, revision, profileLink, existing: true };
        }
        const decision = classifyLegacyTypeAAdoption({ opaqueVaultKey: key, record });
        if (decision.status !== "adopt") throw new UpgradeBlocked("profile_evidence_unsupported");
        const actual = record.conversationIds.flatMap((id) => {
            const turns = sources.conversations[id];
            if (!turns) throw new UpgradeBlocked("conversation_missing");
            return collectChatMemorySources(id, turns);
        });
        // Pre-evidence records must match actual ordinary user text exactly.
        // Newer host receipts permit a paraphrase only with matching text hash
        // and actual eligible message identities, never a model-supplied label.
        const hasExactSource = actual.some((source) => source.conversationId === record.conversationId && source.text === record.text);
        const hasHostReceipt = isChatMemoryRecordAdmissible(record, {
            conversationId: record.conversationId, throughTurnIndex: Number.MAX_SAFE_INTEGER,
            chatMessages: actual.filter((source) => source.conversationId === record.conversationId),
        });
        if (!hasExactSource && !hasHostReceipt) throw new UpgradeBlocked("conversation_evidence_mismatch");
        const id = `upgrade-${stableHash(fingerprint([key, state.migrationStates[key].migrationRunId, profileId]))}`;
        const claim: GovernedMemoryClaim = {
            id, partition: { kind: "vault", key }, memoryType: "preference", sensitivity: "low",
            applicability: decision.applicability, activeRevisionId: `${id}-revision`, effect: "future_answers", lifecycle: "active",
            createdAt: record.observedAt, updatedAt: record.observedAt,
        };
        const revision: MemoryClaimRevision = { id: claim.activeRevisionId!, claimId: id, summary: record.text,
            provenance: decision.provenance, authority: decision.authority, createdAt: record.observedAt };
        const profileLink: MemoryProjectionLink = { id: `${id}-profile`, claimId: id,
            target: { kind: "type_a_profile", profileRecordId: profileId }, relation: "origin", state: "active",
            sourceFingerprintId: id, ruleFingerprint: LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT, createdAt: record.observedAt };
        if (state.claims.some((entry) => entry.id === id) || state.revisions.some((entry) => entry.id === revision.id)
            || state.projectionLinks.some((entry) => entry.id === profileLink.id)) throw new UpgradeBlocked("mapping_collision");
        return { claim, revision, profileLink, existing: false };
    }

    private applyMapping(state: DeviceMemoryGovernanceStateV1, mapping: Mapping): void {
        const { claim, revision, profileLink } = mapping;
        if (!mapping.existing) {
            state.claims.push(claim);
            state.revisions.push(revision);
            state.projectionLinks.push(profileLink);
        }
        const promptLinks = state.projectionLinks.filter((link) => link.claimId === claim.id && link.target.kind === "prompt_projection");
        if (promptLinks.length) {
            if (promptLinks.length !== 1 || promptLinks[0].state !== "active") throw new UpgradeBlocked("profile_projection_mismatch");
            return;
        }
        const id = `${claim.id}-upgrade-prompt`;
        if (state.projectionLinks.some((link) => link.id === id)) throw new UpgradeBlocked("mapping_collision");
        state.projectionLinks.push({ ...profileLink, id, target: { kind: "prompt_projection", projectionId: `prompt:${claim.id}` }, relation: "derived_copy" });
    }
}

function readProfile(result: UserProfileReadResult): UserProfileRecord[] {
    if (result.state === "not_present") return [];
    if (result.state !== "ready") throw new UpgradeBlocked(`profile_${result.state}`);
    if (result.snapshot === null) return [];
    const snapshot: UserProfileSnapshot = result.snapshot;
    if (!Array.isArray(snapshot.records) || typeof snapshot.markdown !== "string" || !date(snapshot.updatedAt)) throw new UpgradeBlocked("profile_invalid");
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const record of snapshot.records) {
        if (!record || !id(record.profileRecordId) || ids.has(record.profileRecordId) || !id(record.key) || keys.has(record.key)
            || typeof record.text !== "string" || !record.text.trim() || record.text.length > 10_000
            || !["user_explicit", "user_correction", "inferred_behavior", "discussed"].includes(record.kind)
            || !["high", "medium", "low"].includes(record.confidence) || typeof record.confirmed !== "boolean"
            || !Number.isSafeInteger(record.occurrences) || record.occurrences < 1 || !date(record.observedAt)
            || !id(record.conversationId) || !Array.isArray(record.conversationIds) || !record.conversationIds.length
            || record.conversationIds.some((value) => !id(value)) || new Set(record.conversationIds).size !== record.conversationIds.length
            || !record.conversationIds.includes(record.conversationId)) throw new UpgradeBlocked("profile_invalid");
        ids.add(record.profileRecordId);
        keys.add(record.key);
    }
    if (snapshot.markdown !== renderUserProfileMarkdown(snapshot.records, new Date(snapshot.updatedAt))) throw new UpgradeBlocked("profile_projection_mismatch");
    return snapshot.records;
}

function id(value: unknown): value is string { return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 256; }
function date(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function fingerprint(value: unknown): string { return stableStringify(value); }
