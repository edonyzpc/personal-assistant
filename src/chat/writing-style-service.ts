import type { PersistedSourceRef } from '../pa/contracts';
import type { MemoryGovernanceCoordinator } from '../pa/memory-governance-coordinator';
import type { DeviceMemoryGovernanceStateV1, MemoryClaimRevision } from '../pa/memory-governance-persistence';
import { selectGovernedWritingStyles, type MemorySuppressionFingerprintRef } from '../pa/memory-use-projection';
import { hashWritingStyleText, isGovernableWritingStyle, parseWritingStyle, writingStyleSceneSchema,
    writingStyleSceneMatches, type WritingStyleScene } from '../pa/writing-style';
import type { ChatWritingStylePreparation, ChatWritingStyleResult } from '../ai-services/chat-types';
import { isWritingContinuationPrompt } from '../ai-services/writing-output';
import type { WritingVersionService } from './writing-versions';

export interface WritingStyleServiceOptions {
    versions: Pick<WritingVersionService, 'get'>;
    coordinator: Pick<MemoryGovernanceCoordinator, 'rememberWritingStyle' | 'correct' | 'pauseUse' | 'resumeUse' | 'forget'>;
    getStateSnapshot: () => { state: DeviceMemoryGovernanceStateV1; vaultScopeKey: string } | null;
    isRuntimeEnabled: () => boolean;
    canManage?: () => boolean;
    verifyNoteSource: (ref: PersistedSourceRef, signal?: AbortSignal) => Promise<{ allowed: boolean; isCurrent: () => boolean }>;
}

export interface WritingStyleReference {
    revisionId: string;
    exactText: string;
    scene: WritingStyleScene;
    isCurrent: () => boolean;
}

export class WritingStyleUnavailableError extends Error {
    constructor(readonly code: 'legacy_memory' | 'governance_unavailable') {
        super('Writing style is unavailable');
        this.name = 'WritingStyleUnavailableError';
    }
}

export class WritingStyleService {
    private disposed = false;
    constructor(private readonly options: WritingStyleServiceOptions) {}

    async remember(versionId: string, scene: WritingStyleScene, explicitActionId: string, noteSourceRef?: PersistedSourceRef): Promise<{ claimId: string; revisionId: string }> {
        this.assertActive();
        if (!(this.options.canManage?.() ?? this.options.isRuntimeEnabled())) throw new Error('Writing style is unavailable');
        const version = await this.options.versions.get(versionId);
        if (!version) throw new Error('Writing version unavailable');
        const normalized = normalizeWritingScene(scene);
        if (!normalized) throw new Error('Writing scene required');
        const payload = parseWritingStyle({ version: 1, exactText: version.text, textHash: version.textHash,
            writingVersionId: version.id, source: { conversationId: version.conversationId, messageId: version.messageId,
                ...(noteSourceRef ? { noteSourceRef } : {}) }, explicitActionId, scene: normalized });
        if (!payload) throw new Error('Writing style must fit within 8192 UTF-8 bytes');
        const source = noteSourceRef ? await this.options.verifyNoteSource(noteSourceRef) : { allowed: true, isCurrent: () => true };
        this.assertActive();
        const result = await this.options.coordinator.rememberWritingStyle({ writingStyle: payload,
            scopeAllowed: this.options.canManage?.() ?? this.options.isRuntimeEnabled(), dataBoundaryAllowed: source.allowed,
            isCurrent: () => !this.disposed && (this.options.canManage?.() ?? this.options.isRuntimeEnabled()) && source.isCurrent() });
        if (!result.ok) throw new Error(`Writing style: ${result.reason}`);
        return { claimId: result.value.claimId, revisionId: result.value.revisionId };
    }

    forScene(scene: WritingStyleScene | undefined, currentInstructionConflicts = false): ChatWritingStylePreparation {
        return (budget) => this.prepare(scene, { ...budget, currentInstructionConflicts });
    }

    async prepare(scene: WritingStyleScene | undefined, budget: Parameters<ChatWritingStylePreparation>[0] & {
        currentInstructionConflicts?: boolean;
    }): Promise<ChatWritingStyleResult> {
        const empty = (): ChatWritingStyleResult => ({ context: '', revisionIds: [], isCurrent: () => true });
        this.assertActive(budget.signal);
        const normalized = scene ? normalizeWritingScene(scene) : null;
        const snapshot = this.options.getStateSnapshot();
        if (!normalized || !snapshot || !this.options.isRuntimeEnabled()
            || snapshot.state.policyStates[snapshot.vaultScopeKey]?.contextProjectionMode !== 'governed') return empty();
        const { state, vaultScopeKey } = snapshot;
        const commitSequence = state.commitSequence;
        const allowed = new Set<string>(), guards = new Map<string, () => boolean>();
        const revisions = new Map(state.revisions.map((revision) => [revision.id, revision]));
        for (const claim of state.claims) {
            const revision = revisions.get(claim.activeRevisionId ?? '');
            if (!revision || claim.lifecycle !== 'active' || !isGovernableWritingStyle(claim, revision, vaultScopeKey)
                || !writingStyleSceneMatches(revision.writingStyle!.scene, normalized)) continue;
            this.assertActive(budget.signal);
            let source: { allowed: boolean; isCurrent: () => boolean };
            try { source = await this.verifyRevision(revision, budget.signal); }
            catch { this.assertActive(budget.signal); continue; }
            if (source.allowed) { allowed.add(revision.id); guards.set(revision.id, source.isCurrent); }
        }
        this.assertActive(budget.signal);
        const fingerprints: Record<string, MemorySuppressionFingerprintRef | undefined> = Object.create(null);
        const ambiguous = new Set<string>();
        for (const link of state.projectionLinks) {
            if (link.state !== 'active' || !link.sourceFingerprintId || !link.ruleFingerprint) continue;
            const previous = fingerprints[link.claimId];
            if (previous && (previous.sourceFingerprintId !== link.sourceFingerprintId || previous.ruleFingerprint !== link.ruleFingerprint)) ambiguous.add(link.claimId);
            fingerprints[link.claimId] = { sourceFingerprintId: link.sourceFingerprintId, ruleFingerprint: link.ruleFingerprint };
        }
        for (const id of ambiguous) delete fingerprints[id];
        const selected = selectGovernedWritingStyles({ vaultScopeKey, currentScope: { tags: [] }, claims: state.claims, revisions: state.revisions,
            suppressionMarkers: state.suppressionMarkers, pendingOperations: state.pendingOperations, claimSuppressionFingerprints: fingerprints,
            includeVaultInsights: false, vaultInsights: null, currentDataBoundaryFingerprint: '', dataBoundaryAllowed: (revision) => allowed.has(revision.id),
            sourceAllowed: (revision) => allowed.has(revision.id), scene: normalized, ...budget });
        if (!selected.context) return { ...empty(), skipped: selected.skipped } as ChatWritingStyleResult;
        const isCurrent = (): boolean => {
            if (this.disposed || budget.signal?.aborted || !this.options.isRuntimeEnabled()) return false;
            const latest = this.options.getStateSnapshot();
            return Boolean(latest && latest.vaultScopeKey === vaultScopeKey && latest.state.commitSequence === commitSequence
                && latest.state.policyStates[vaultScopeKey]?.contextProjectionMode === 'governed'
                && selected.revisionIds.every((id) => guards.get(id)?.() === true));
        };
        if (!isCurrent()) throw new Error('Writing style changed while preparing');
        return { context: selected.context, revisionIds: selected.revisionIds, isCurrent, skipped: selected.skipped } as ChatWritingStyleResult;
    }

    async correct(claimId: string, exactText: string, scene: WritingStyleScene, explicitActionId: string): Promise<void> {
        this.assertActive();
        const snapshot = this.options.getStateSnapshot();
        const claim = snapshot?.state.claims.find((value) => value.id === claimId);
        const revision = snapshot?.state.revisions.find((value) => value.id === claim?.activeRevisionId);
        if (!snapshot || !claim || !revision || !isGovernableWritingStyle(claim, revision, snapshot.vaultScopeKey)) throw new Error('Writing style unavailable');
        const normalized = normalizeWritingScene(scene);
        const payload = parseWritingStyle({ ...revision.writingStyle, exactText, textHash: hashWritingStyleText(exactText), explicitActionId, scene: normalized });
        if (!payload) throw new Error('Writing style must fit within 8192 UTF-8 bytes');
        const source = await this.verifyRevision(revision);
        const result = await this.options.coordinator.correct({ claimId, summary: `Writing style: ${payload.scene.domain} / ${payload.scene.purpose}`,
            writingStyle: payload, expectedRevisionId: revision.id,
            scopeAllowed: this.options.canManage?.() ?? this.options.isRuntimeEnabled(), dataBoundaryAllowed: source.allowed && source.isCurrent(),
            isCurrent: () => !this.disposed && (this.options.canManage?.() ?? this.options.isRuntimeEnabled()) && source.isCurrent() });
        if (!result.ok) throw new Error(`Writing style: ${result.reason}`);
    }

    /** Read an exact, still-authorized sample for details; never substitute its replacement. */
    async readReferences(revisionIds: readonly string[], signal?: AbortSignal): Promise<WritingStyleReference[]> {
        this.assertActive(signal);
        const snapshot = this.options.getStateSnapshot();
        const canRead = () => !this.disposed && !signal?.aborted
            && (this.options.canManage?.() ?? this.options.isRuntimeEnabled());
        if (!snapshot || !canRead() || snapshot.state.policyStates[snapshot.vaultScopeKey]?.contextProjectionMode !== 'governed') return [];
        const { state, vaultScopeKey } = snapshot;
        const sequence = state.commitSequence;
        const result: WritingStyleReference[] = [];
        for (const id of new Set(revisionIds)) {
            const revisions = state.revisions.filter((revision) => revision.id === id);
            const revision = revisions.length === 1 ? revisions[0] : undefined;
            const claims = state.claims.filter((claim) => claim.id === revision?.claimId);
            const claim = claims.length === 1 ? claims[0] : undefined;
            if (!revision || !claim || !['active', 'paused'].includes(claim.lifecycle)
                || !isGovernableWritingStyle(claim, revision, vaultScopeKey)
                || state.pendingOperations.some((operation) => operation.claimId === claim.id
                    && (operation.kind === 'forget' || operation.state === 'pending'))) continue;
            const links = state.projectionLinks.filter((link) => link.claimId === claim.id && link.state === 'active');
            if (!links.length || links.some((link) => !link.sourceFingerprintId || !link.ruleFingerprint
                || state.suppressionMarkers.some((marker) => marker.partition.kind === claim.partition.kind
                    && marker.partition.key === claim.partition.key
                    && marker.sourceFingerprintId === link.sourceFingerprintId && marker.ruleFingerprint === link.ruleFingerprint))) continue;
            try {
                const source = await this.verifyRevision(revision, signal);
                const isCurrent = () => {
                    const latest = this.options.getStateSnapshot();
                    return Boolean(canRead() && latest && latest.vaultScopeKey === vaultScopeKey
                        && latest.state.commitSequence === sequence
                        && latest.state.policyStates[vaultScopeKey]?.contextProjectionMode === 'governed'
                        && source.allowed && source.isCurrent());
                };
                if (isCurrent()) result.push({ revisionId: id, exactText: revision.writingStyle!.exactText,
                    scene: { ...revision.writingStyle!.scene }, isCurrent });
            } catch { /* Unavailable source must not prevent reading the version body. */ }
        }
        return result.filter((reference) => reference.isCurrent());
    }

    dispose(): void { this.disposed = true; }
    private assertActive(signal?: AbortSignal): void { if (this.disposed || signal?.aborted) throw new Error('Writing style cancelled'); }
    private async verifyRevision(revision: MemoryClaimRevision, signal?: AbortSignal): Promise<{ allowed: boolean; isCurrent: () => boolean }> {
        const checks: Array<{ allowed: boolean; isCurrent: () => boolean }> = [];
        const source = revision.writingStyle?.source.noteSourceRef;
        if (source) checks.push(await this.options.verifyNoteSource(source, signal));
        for (const provenance of revision.provenance) {
            if (provenance.kind === 'note' && provenance.sourceRef.path !== source?.path) {
                checks.push(await this.options.verifyNoteSource(provenance.sourceRef, signal));
            } else if (!['note', 'conversation', 'explicit_setting'].includes(provenance.kind)) return { allowed: false, isCurrent: () => false };
        }
        return { allowed: checks.every((check) => check.allowed), isCurrent: () => checks.every((check) => check.isCurrent()) };
    }
}

const aliases: Record<keyof WritingStyleScene, Record<string, string>> = {
    writingTask: { '文案': 'copywriting', '写文案': 'copywriting', '文案写作': 'copywriting', 'copy': 'copywriting', '写作': 'copywriting',
        '旅行短文': 'copywriting', '短文': 'copywriting', '配文': 'copywriting', '分享文案': 'copywriting', 'social post': 'copywriting', 'short text': 'copywriting',
        '邮件': 'email', '写邮件': 'email', '工作邮件': 'email', '商务邮件': 'email', 'email': 'email' },
    purpose: { '朋友圈': 'social_share', '社交分享': 'social_share', '分享': 'social_share', 'social': 'social_share',
        '分享旅行': 'social_share', '旅行分享': 'social_share', '朋友圈分享': 'social_share', '社交平台分享': 'social_share',
        'social sharing': 'social_share', 'travel sharing': 'social_share', 'share travel': 'social_share',
        '工作邮件': 'work_email', '商务邮件': 'work_email', 'work email': 'work_email', '推广': 'promotion', '营销': 'promotion' },
    audience: { '朋友': 'friends', '好友': 'friends', '亲友': 'friends', 'friends': 'friends', '同事': 'colleagues',
        '朋友圈好友': 'friends',
        'colleagues': 'colleagues', '客户': 'clients', '顾客': 'clients', 'clients': 'clients', '公众': 'public', 'public': 'public' },
    domain: { '旅行': 'travel', '旅游': 'travel', '游记': 'travel', 'travel': 'travel', '工作': 'work', '职场': 'work',
        '旅途': 'travel', '旅行经历': 'travel', '旅行感悟': 'travel', '旅拍': 'travel', '出游': 'travel',
        '商务': 'work', 'work': 'work', '美食': 'food', '餐饮': 'food', 'food': 'food', '日常': 'daily_life', '生活': 'daily_life', 'daily life': 'daily_life' },
};
export function normalizeWritingScene(value: unknown): WritingStyleScene | null {
    const parsed = writingStyleSceneSchema.safeParse(value); if (!parsed.success) return null;
    const scene = { ...parsed.data };
    for (const key of Object.keys(scene) as Array<keyof WritingStyleScene>) {
        const normalized = scene[key].trim().toLowerCase().replace(/\s+/g, ' ');
        if (!normalized) return null;
        scene[key] = aliases[key][normalized] ?? normalized;
    }
    return scene;
}
export function inferWritingScene(prompt: string, parentScene?: WritingStyleScene): WritingStyleScene | undefined {
    if (hasConflictingWritingStyleInstruction(prompt)) return undefined;
    const text = prompt.toLowerCase();
    const domain = /旅行|旅游|游记|旅途|旅拍|出游|\btravel\b/.test(text) ? 'travel' : /美食|餐饮|\bfood\b/.test(text) ? 'food'
        : /工作|职场|商务|\bwork\b/.test(text) ? 'work' : /日常|生活/.test(text) ? 'daily_life' : undefined;
    const purpose = /朋友圈|社交分享|分享旅行|旅行分享|social[_ ]shar(?:e|ing)|travel sharing/.test(text) ? 'social_share'
        : /工作邮件|商务邮件|work[_ ]email/.test(text) ? 'work_email' : /推广|营销/.test(text) ? 'promotion' : undefined;
    const audience = /同事|colleague/.test(text) ? 'colleagues' : /客户|顾客|client/.test(text) ? 'clients'
        : /朋友|好友|亲友|friend/.test(text) ? 'friends' : /公众|公开|public/.test(text) ? 'public'
        : /朋友圈/.test(text) ? 'friends' : undefined;
    const writingTask = /邮件|\bemail\b/.test(text) ? 'email' : /文案|短文|配文|copywriting|social post|写.{0,8}(朋友圈|分享)/.test(text) ? 'copywriting' : undefined;
    if (domain && purpose && audience && writingTask) return normalizeWritingScene({ domain, purpose, audience, writingTask }) ?? undefined;
    const parent = parentScene && normalizeWritingScene(parentScene);
    if (parent && isWritingContinuationPrompt(prompt)
        && (!domain || domain === parent.domain) && (!purpose || purpose === parent.purpose)
        && (!audience || audience === parent.audience) && (!writingTask || writingTask === parent.writingTask)) return parent;
    return undefined;
}

export function getWritingSceneDisplayValues(scene: WritingStyleScene, locale: 'zh' | 'en'): WritingStyleScene {
    const names: Record<string, string> = locale === 'zh'
        ? { copywriting: '文案', email: '邮件', social_share: '朋友圈分享', work_email: '工作邮件', promotion: '推广',
            friends: '朋友', colleagues: '同事', clients: '客户', public: '公众', travel: '旅行', work: '工作', food: '美食', daily_life: '日常' }
        : { copywriting: 'Copywriting', email: 'Email', social_share: 'Social sharing', work_email: 'Work email', promotion: 'Promotion',
            friends: 'Friends', colleagues: 'Colleagues', clients: 'Clients', public: 'Public', travel: 'Travel', work: 'Work', food: 'Food', daily_life: 'Daily life' };
    return Object.fromEntries(Object.entries(scene).map(([key, value]) => [key, names[value] ?? value])) as unknown as WritingStyleScene;
}

export function hasConflictingWritingStyleInstruction(prompt: string): boolean {
    return /(?:不要|不用|别|不必|禁止|停止).{0,16}(?:参考|沿用|模仿|学习|学我|风格|语气)|(?:换|改成|使用).{0,8}(?:一种|全新|不同|其他|别的).{0,4}风格|(?:do not|don't|never).{0,30}(?:use|copy|follow|imitate|reference).{0,30}(?:style|examples?)|ignore.{0,20}(?:old|previous|my).{0,12}style|(?:different|new)\s+style/i.test(prompt);
}
