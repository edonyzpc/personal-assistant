import type { App, TAbstractFile } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import type { ChatHistoryManager } from "../../chat/chat-history-manager";
import { clearPlatformInterval, clearPlatformTimeout, setPlatformInterval, setPlatformTimeout, type PlatformIntervalHandle, type PlatformTimeoutHandle } from "../../platform-dom";
import { MemoryUserProfileStore, assertProfileWriteCurrent, type ProfileWriteGuard, type UserProfileStore } from "./profile-store";
import {
    SerializedProfileGovernancePort,
    type ProfileGovernancePort,
    type ProfileGovernanceMutation,
} from "./profile-governance-port";
import {
    TypeAUserProfileExtractor,
    type UserProfileCandidate,
    type UserProfileSnapshot,
    type SemanticUserProfileCandidate,
} from "./type-a-extractor";
import type { PersistedConversation, PersistedTurn } from "../../chat/chat-history-store";
import { getOptionalPlatformDocument } from "../../platform-dom";
import { TypeCVaultMetacognitionAnalyzer, type SemanticClusterProvider, type VaultMetacognitionSnapshot } from "./type-c-analyzer";
import type { TypeAAdmissionBaseline } from "../../pa/memory-admission-coordinator";
import {
    collectChatMemorySources,
    collectChatMemorySemanticSources,
    cloneChatMemoryCandidateEvidence,
    isChatMemoryRecordAdmissible,
    type ChatMemoryAdmissionEvidence,
} from "../../pa/chat-memory-admission";
import { verifyChatMemorySemanticReceipt, type ChatMemorySemanticProjection } from "../../pa/chat-memory-semantic-receipt";

export type CreateModelForExtraction = () => Promise<{ invoke: (prompt: string) => Promise<string> } | null>;

export interface TypeAAdmissionBatch {
    semanticProjections?: ChatMemorySemanticProjection[];
    current: UserProfileSnapshot | null;
    proposed: UserProfileSnapshot;
    candidates: UserProfileCandidate[];
    baseline?: TypeAAdmissionBaseline;
    evidence: ChatMemoryAdmissionEvidence;
    /** Host-only lifetime; never serialized into candidate provenance. */
    isCurrent?: () => boolean;
    signal?: AbortSignal;
}

export type TypeAAdmissionResult = { status: "processed" | "retry" };

export type AdmitTypeACandidates = (
    batch: TypeAAdmissionBatch,
) => Promise<TypeAAdmissionResult>;

type TypeAAdmissionBaselineOutcome =
    | { status: "ready"; baseline: TypeAAdmissionBaseline }
    | { status: "failed"; error: unknown };

export interface MemoryExtractionSchedulerOptions {
    onVaultInsightsSourceChanged?: (source: VaultInsightsSourceReceipt | null) => void;
    semanticTypeA?: boolean;
    app: App;
    chatHistoryManager: ChatHistoryManager;
    userProfileStore?: UserProfileStore;
    profileGovernancePort?: ProfileGovernancePort;
    log?: (message: string, error?: unknown) => void;
    now?: () => Date;
    typeAIntervalTurns?: number;
    typeCRefreshIntervalMs?: number;
    typeCWritePath?: string | null;
    includeVaultInsightsInPrompt?: boolean;
    createModelForExtraction?: CreateModelForExtraction;
    shouldHandleVaultEvent?: (file: TFile) => boolean;
    getDataBoundaryFingerprint?: () => string;
    admitTypeACandidates?: AdmitTypeACandidates;
    captureTypeAAdmissionBaseline?: () => Promise<TypeAAdmissionBaseline>;
    getTypeAProcessedTurn?: (conversationId: string) => Promise<number | undefined>;
}

/** Ephemeral host evidence for an already prepared aggregate; contains no text. */
export interface VaultInsightsSourceReceipt {
    sourcePaths: readonly string[];
    isSourceCurrent: () => boolean;
}

export interface MemoryExtractionPromptContext {
    userProfile?: string;
    vaultInsights?: string;
}

export interface VaultInsightsSnapshotContext {
    snapshot: VaultMetacognitionSnapshot;
    dataBoundaryFingerprint: string;
    representativePaths: string[];
}

const DEFAULT_TYPE_A_INTERVAL_TURNS = 8;
const DEFAULT_TYPE_C_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
const DEFAULT_TYPE_C_VAULT_EVENT_DELAY_MS = 5 * 60_000;
export const VAULT_INSIGHTS_PATH = "PA-Memory/vault-insights.md";

export class MemoryExtractionScheduler {
    private readonly app: App;
    private readonly chatHistoryManager: ChatHistoryManager;
    private readonly log: (message: string, error?: unknown) => void;
    private readonly now: () => Date;
    private readonly typeAIntervalTurns: number;
    private readonly typeCRefreshIntervalMs: number;
    private readonly typeCWritePath: string | null;
    private includeVaultInsightsInPrompt: boolean;
    private readonly profileGovernancePort: ProfileGovernancePort;
    private readonly typeAExtractor = new TypeAUserProfileExtractor();
    private readonly typeCAnalyzer: TypeCVaultMetacognitionAnalyzer;
    private typeATimer: PlatformTimeoutHandle | null = null;
    private typeCTimer: PlatformTimeoutHandle | null = null;
    private typeCInterval: PlatformIntervalHandle | null = null;
    private userProfileStoreReady: Promise<void> | null = null;
    private disposed = false;
    private readonly admissionController = new AbortController();
    private userProfileSnapshot: UserProfileSnapshot | null = null;
    private vaultSnapshot: VaultMetacognitionSnapshot | null = null;
    private vaultSnapshotDataBoundaryFingerprint = "";
    private vaultInsightsRefreshFailed = false;
    private vaultInsightsMarkdown = "";
    private lastTypeAConversationId: string | null = null;
    private typeCRefreshInFlight: Promise<VaultMetacognitionSnapshot | null> | null = null;
    private readonly typeAProcessedTurnByConversation = new Map<string, number>();
    private readonly createModelForExtraction: CreateModelForExtraction | null;
    private readonly shouldHandleVaultEvent: (file: TFile) => boolean;
    private readonly getDataBoundaryFingerprint: () => string;
    private readonly admitTypeACandidates: AdmitTypeACandidates | null;
    private readonly semanticTypeA: boolean;
    private readonly captureTypeAAdmissionBaseline: MemoryExtractionSchedulerOptions["captureTypeAAdmissionBaseline"];
    private readonly getTypeAProcessedTurn: MemoryExtractionSchedulerOptions["getTypeAProcessedTurn"];
    private readonly onVaultInsightsSourceChanged: MemoryExtractionSchedulerOptions["onVaultInsightsSourceChanged"];
    private vaultInsightsSourceIdentity: object = {};

    constructor(options: MemoryExtractionSchedulerOptions) {
        this.app = options.app;
        this.chatHistoryManager = options.chatHistoryManager;
        this.log = options.log ?? (() => undefined);
        this.now = options.now ?? (() => new Date());
        this.typeAIntervalTurns = Math.max(1, options.typeAIntervalTurns ?? DEFAULT_TYPE_A_INTERVAL_TURNS);
        this.typeCRefreshIntervalMs = Math.max(60_000, options.typeCRefreshIntervalMs ?? DEFAULT_TYPE_C_REFRESH_INTERVAL_MS);
        this.typeCWritePath = options.typeCWritePath === undefined || options.typeCWritePath === null
            ? null
            : normalizePath(options.typeCWritePath);
        this.includeVaultInsightsInPrompt = options.includeVaultInsightsInPrompt ?? false;
        this.profileGovernancePort = options.profileGovernancePort
            ?? new SerializedProfileGovernancePort(
                options.userProfileStore ?? new MemoryUserProfileStore(),
                this.now,
            );
        this.createModelForExtraction = options.createModelForExtraction ?? null;
        this.shouldHandleVaultEvent = options.shouldHandleVaultEvent ?? (() => true);
        this.getDataBoundaryFingerprint = options.getDataBoundaryFingerprint ?? (() => "data_boundary:unknown");
        this.admitTypeACandidates = options.admitTypeACandidates ?? null;
        this.semanticTypeA = options.semanticTypeA === true;
        this.captureTypeAAdmissionBaseline = options.captureTypeAAdmissionBaseline;
        this.getTypeAProcessedTurn = options.getTypeAProcessedTurn;
        this.onVaultInsightsSourceChanged = options.onVaultInsightsSourceChanged;
        this.typeCAnalyzer = new TypeCVaultMetacognitionAnalyzer(this.app, {
            shouldIncludeFile: (file) => this.shouldHandleVaultEvent(file),
        });
    }

    setSemanticClusterProvider(provider: SemanticClusterProvider): void {
        this.typeCAnalyzer.setSemanticClusterProvider(provider);
    }

    start(): void {
        if (this.disposed) return;
        void this.ensureUserProfileStoreReady().catch((error) => {
            this.log("Type A user profile store failed to initialize", error);
        });
        if (this.includeVaultInsightsInPrompt) {
            this.startTypeCRefreshLoop();
            this.scheduleTypeCRefresh("startup", 15_000);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.admissionController.abort();
        if (this.typeATimer) clearPlatformTimeout(this.typeATimer);
        if (this.typeCTimer) clearPlatformTimeout(this.typeCTimer);
        if (this.typeCInterval) clearPlatformInterval(this.typeCInterval);
        this.typeATimer = null;
        this.typeCTimer = null;
        this.typeCInterval = null;
        void this.profileGovernancePort.dispose().catch((error) => {
            this.log("Type A user profile store failed to close", error);
        });
    }

    getPromptContext(): MemoryExtractionPromptContext {
        return {
            ...(this.userProfileSnapshot?.markdown ? { userProfile: this.userProfileSnapshot.markdown } : {}),
            ...(this.getVaultInsightsStatus() === "ready" && this.vaultInsightsMarkdown
                ? { vaultInsights: summarizeVaultInsightsForPrompt(this.vaultInsightsMarkdown) }
                : {}),
        };
    }

    getInsightsViewerContext(): MemoryExtractionPromptContext {
        return {
            ...(this.userProfileSnapshot?.markdown ? { userProfile: this.userProfileSnapshot.markdown } : {}),
            ...(this.getVaultInsightsStatus() === "ready" && this.vaultInsightsMarkdown
                ? { vaultInsights: this.vaultInsightsMarkdown }
                : {}),
        };
    }

    getUserProfileSnapshot(): UserProfileSnapshot | null {
        return this.userProfileSnapshot ? cloneUserProfileSnapshot(this.userProfileSnapshot) : null;
    }

    async mutateUserProfile(operation: ProfileGovernanceMutation, guard?: ProfileWriteGuard): Promise<UserProfileSnapshot> {
        assertProfileWriteCurrent(guard);
        await this.ensureUserProfileStoreReady();
        assertProfileWriteCurrent(guard);
        const snapshot = await this.profileGovernancePort.mutate(operation, guard);
        assertProfileWriteCurrent(guard);
        this.userProfileSnapshot = cloneUserProfileSnapshot(snapshot);
        return cloneUserProfileSnapshot(snapshot);
    }

    getVaultInsightsSnapshot(): VaultInsightsSnapshotContext | null {
        if (!this.vaultSnapshot || !this.vaultSnapshotDataBoundaryFingerprint) return null;
        return {
            snapshot: cloneVaultMetacognitionSnapshot(this.vaultSnapshot),
            dataBoundaryFingerprint: this.vaultSnapshotDataBoundaryFingerprint,
            representativePaths: collectRepresentativeVaultInsightPaths(this.vaultSnapshot),
        };
    }

    getVaultInsightsStatus(): "disabled" | "not_loaded" | "ready" | "stale_boundary" | "error" {
        if (!this.includeVaultInsightsInPrompt) return "disabled";
        if (this.vaultSnapshot && this.vaultSnapshotDataBoundaryFingerprint) {
            return this.getDataBoundaryFingerprint() === this.vaultSnapshotDataBoundaryFingerprint
                ? "ready"
                : "stale_boundary";
        }
        return this.vaultInsightsRefreshFailed ? "error" : "not_loaded";
    }

    setIncludeVaultInsightsInPrompt(include: boolean): void {
        if (this.disposed) return;
        if (this.includeVaultInsightsInPrompt === include) return;
        this.includeVaultInsightsInPrompt = include;
        if (include) {
            this.startTypeCRefreshLoop();
            this.scheduleTypeCRefresh("settings");
        } else {
            this.stopTypeCRefreshLoop();
            this.vaultSnapshot = null;
            this.vaultSnapshotDataBoundaryFingerprint = "";
            this.vaultInsightsRefreshFailed = false;
            this.vaultInsightsMarkdown = "";
            this.vaultInsightsSourceIdentity = {};
            this.onVaultInsightsSourceChanged?.(null);
        }
    }

    scheduleTypeAExtraction(conversationId: string, turnCount: number, delayMs = 2_000): void {
        if (this.disposed) return;
        if (turnCount % this.typeAIntervalTurns !== 0 && this.lastTypeAConversationId === conversationId) return;
        this.lastTypeAConversationId = conversationId;
        if (this.typeATimer) clearPlatformTimeout(this.typeATimer);
        // Convert a rejected capture into a settled outcome immediately. The
        // timer may be delayed, replaced, or disposed before it gets a chance
        // to await the capture, so retaining a raw rejected Promise here would
        // surface an unhandled rejection in the meantime.
        const baseline = this.admitTypeACandidates
            ? this.captureTypeAAdmissionBaselineOutcome()
            : undefined;
        this.typeATimer = setPlatformTimeout(() => {
            this.typeATimer = null;
            void this.runTypeAExtraction(conversationId, baseline).catch((error) => {
                this.log("Type A user profile extraction failed", error);
            });
        }, Math.max(0, delayMs));
    }

    /** Revoke in-flight evidence without scheduling analysis (including self-writes). */
    invalidateVaultInsightsSource(file: TAbstractFile | null): void {
        if (this.disposed) return;
        if (!this.includeVaultInsightsInPrompt) return;
        if (!file) return;
        if (!(file instanceof TFile)) {
            // A folder rename can bring new eligible children into the aggregate
            // without a separate file event. Empty/excluded folders add no input.
            if (this.app.vault.getMarkdownFiles().some(candidate => candidate.path.startsWith(`${file.path}/`)
                && this.shouldHandleVaultEvent(candidate))) this.vaultInsightsSourceIdentity = {};
            return;
        }
        if (!file.path.endsWith(".md")) return;
        if (this.typeCWritePath && normalizePath(file.path) === this.typeCWritePath) return;
        if (!this.shouldHandleVaultEvent(file)) return;
        this.vaultInsightsSourceIdentity = {};
    }

    handleVaultEvent(file: TAbstractFile | null, reason: string): void {
        if (this.disposed) return;
        if (!this.includeVaultInsightsInPrompt) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith(".md")) return;
        if (this.typeCWritePath && normalizePath(file.path) === this.typeCWritePath) return;
        if (!this.shouldHandleVaultEvent(file)) return;
        this.invalidateVaultInsightsSource(file);
        this.scheduleTypeCRefresh(reason, DEFAULT_TYPE_C_VAULT_EVENT_DELAY_MS);
    }

    scheduleTypeCRefresh(reason: string, delayMs = 0): void {
        if (this.disposed) return;
        if (!this.includeVaultInsightsInPrompt) return;
        if (this.typeCTimer) clearPlatformTimeout(this.typeCTimer);
        this.typeCTimer = setPlatformTimeout(() => {
            this.typeCTimer = null;
            void this.runTypeCRefresh(reason).catch((error) => {
                this.log("Type C vault metacognition refresh failed", error);
            });
        }, Math.max(0, delayMs));
    }

    async runTypeAExtraction(
        conversationId: string,
        scheduledBaseline?: Promise<TypeAAdmissionBaselineOutcome>,
    ): Promise<UserProfileSnapshot | null> {
        if (this.semanticTypeA) return this.runSemanticTypeAExtraction(conversationId, scheduledBaseline);
        if (this.disposed) return null;
        const baselineOutcome = this.admitTypeACandidates
            ? scheduledBaseline ?? this.captureTypeAAdmissionBaselineOutcome()
            : undefined;
        const capturedBaseline = baselineOutcome ? await baselineOutcome : undefined;
        if (capturedBaseline?.status === "failed") throw capturedBaseline.error;
        if (this.disposed) return null;
        const baseline = capturedBaseline?.baseline;
        await this.ensureUserProfileStoreReady();
        if (this.disposed) return null;
        const conversation = await this.chatHistoryManager.findConversation(conversationId);
        if (this.disposed) return null;
        if (!conversation) return this.userProfileSnapshot;
        const turns = await this.chatHistoryManager.getTurns(conversationId);
        if (this.disposed) return null;
        const durableProcessedTurn = this.getTypeAProcessedTurn
            ? await this.getTypeAProcessedTurn(conversationId)
            : undefined;
        if (this.disposed) return null;
        const lastProcessedTurn = Math.max(
            this.typeAProcessedTurnByConversation.get(conversationId) ?? -1,
            durableProcessedTurn ?? -1,
        );
        const newTurns = turns.filter((turn) => turn.turnIndex > lastProcessedTurn);
        if (newTurns.length === 0) return this.userProfileSnapshot;
        const evidence: ChatMemoryAdmissionEvidence = {
            conversationId,
            throughTurnIndex: Math.max(...newTurns.map((turn) => turn.turnIndex)),
            chatMessages: collectChatMemorySources(conversationId, newTurns)
                .map(({ text: _text, ...source }) => ({ ...source })),
        };
        const extracted = await this.extractTypeACandidates(conversation, newTurns);
        if (this.disposed) return null;
        // An extractor or model adapter cannot bypass either admission route.
        const candidates = extracted.filter((candidate) => isChatMemoryRecordAdmissible(candidate, evidence));
        if (this.admitTypeACandidates) {
            const current = this.userProfileSnapshot
                ? cloneUserProfileSnapshot(this.userProfileSnapshot)
                : null;
            const proposed = this.typeAExtractor.mergeCandidates(current, candidates, this.now());
            const admitted = await this.admitTypeACandidates({
                isCurrent: () => !this.disposed,
                signal: this.admissionController.signal,
                current,
                proposed: cloneUserProfileSnapshot(proposed),
                candidates: candidates.map((candidate) => ({ ...candidate,
                    ...(candidate.chatEvidence ? { chatEvidence: cloneChatMemoryCandidateEvidence(candidate.chatEvidence) } : {}) })),
                ...(baseline ? { baseline } : {}),
                evidence,
            });
            if (admitted.status === "retry") return this.userProfileSnapshot;
        } else {
            this.userProfileSnapshot = await this.mutateUserProfile((current) => (
                this.typeAExtractor.mergeCandidates(current,
                    candidates.filter((candidate) => isChatMemoryRecordAdmissible(candidate, evidence)), this.now())
            ));
        }
        if (this.disposed) return null;
        this.typeAProcessedTurnByConversation.set(
            conversationId,
            Math.max(...newTurns.map((turn) => turn.turnIndex)),
        );
        return this.userProfileSnapshot;
    }

    private async runSemanticTypeAExtraction(conversationId: string, scheduledBaseline?: Promise<TypeAAdmissionBaselineOutcome>): Promise<UserProfileSnapshot | null> {
        if (this.disposed || !this.admitTypeACandidates || !this.createModelForExtraction || this.isMobileHidden()) return null;
        const manager = this.chatHistoryManager as ChatHistoryManager & { captureSourceLifetime?: (id: string) => () => boolean };
        const lease = manager.captureSourceLifetime?.(conversationId);
        const isCurrent = () => {
            try { return !this.disposed && !this.admissionController.signal.aborted && lease?.() === true; }
            catch { return false; }
        };
        if (!isCurrent()) return null;
        try {
            const captured = await (scheduledBaseline ?? this.captureTypeAAdmissionBaselineOutcome());
            if (!isCurrent() || captured?.status === "failed") return null;
            await this.ensureUserProfileStoreReady();
            if (!isCurrent()) return null;
            const conversation = await manager.findConversation(conversationId);
            if (!isCurrent() || !conversation) return null;
            const turns = await manager.getTurns(conversationId);
            if (!isCurrent()) return null;
            const durable = this.getTypeAProcessedTurn ? await this.getTypeAProcessedTurn(conversationId) : undefined;
            if (!isCurrent()) return null;
            const cursor = Math.max(durable ?? -1, this.typeAProcessedTurnByConversation.get(conversationId) ?? -1);
            const newTurns = turns.filter((turn) => turn.turnIndex > cursor);
            const sources = collectChatMemorySemanticSources(conversationId, newTurns);
            if (sources.length === 0) return this.userProfileSnapshot;
            const sourceIdentity = JSON.stringify(sources);
            const model = await this.createModelForExtraction();
            if (!isCurrent() || !model) return null;
            const checkSources = async () => {
                if (!isCurrent()) return false;
                const currentTurns = await manager.getTurns(conversationId);
                return isCurrent() && JSON.stringify(collectChatMemorySemanticSources(conversationId,
                    currentTurns.filter((turn) => turn.turnIndex > cursor))) === sourceIdentity;
            };
            if (!await checkSources()) return null;
            const extracted = await this.typeAExtractor.extractSemanticCandidatesWithLLM({ conversation, turns: newTurns, now: this.now }, async (prompt) => {
                if (!isCurrent()) throw new Error("Semantic extraction source expired");
                return model.invoke(prompt);
            });
            if (!isCurrent() || extracted.status !== "parsed" || extracted.projections.length === 0 || !await checkSources()) return null;
            const candidates = extracted.candidates.filter((candidate) => verifyChatMemorySemanticReceipt(
                candidate.chatSemanticReceipt, candidate, conversationId, extracted.projections,
            )) as SemanticUserProfileCandidate[];
            const current = this.userProfileSnapshot ? cloneUserProfileSnapshot(this.userProfileSnapshot) : null;
            const proposed = this.typeAExtractor.mergeSemanticCandidates(current, candidates, this.now());
            const canonicalIds = captured?.status === "ready" ? captured.baseline.profileRecordIdsByKey : undefined;
            const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
            const proposedKeys = new Set<string>();
            const proposedIds = new Set<string>();
            for (const record of proposed.records) {
                if (candidateKeys.has(record.key) && canonicalIds && Object.prototype.hasOwnProperty.call(canonicalIds, record.key)) {
                    const canonicalId = canonicalIds[record.key];
                    if (typeof canonicalId === "string" && canonicalId.trim()) record.profileRecordId = canonicalId;
                }
                if (!record.key?.trim() || !record.profileRecordId?.trim()
                    || proposedKeys.has(record.key) || proposedIds.has(record.profileRecordId)) return null;
                proposedKeys.add(record.key);
                proposedIds.add(record.profileRecordId);
            }
            const throughTurnIndex = Math.max(...newTurns.map((turn) => turn.turnIndex));
            const admitted = await this.admitTypeACandidates({ current, proposed, candidates,
                semanticProjections: extracted.projections,
                ...(captured?.status === "ready" ? { baseline: captured.baseline } : {}),
                evidence: { conversationId, throughTurnIndex }, isCurrent, signal: this.admissionController.signal });
            if (admitted.status === "processed" && isCurrent()) this.typeAProcessedTurnByConversation.set(conversationId, throughTurnIndex);
            return this.userProfileSnapshot;
        } catch (error) {
            this.log("Semantic extraction will retry without legacy fallback", error);
            return this.userProfileSnapshot;
        }
    }

    private captureTypeAAdmissionBaselineOutcome(): Promise<TypeAAdmissionBaselineOutcome> | undefined {
        if (!this.captureTypeAAdmissionBaseline) return undefined;
        try {
            return this.captureTypeAAdmissionBaseline().then<
                TypeAAdmissionBaselineOutcome,
                TypeAAdmissionBaselineOutcome
            >(
                (baseline) => ({ status: "ready", baseline }),
                (error: unknown) => ({ status: "failed", error }),
            );
        } catch (error) {
            return Promise.resolve({ status: "failed", error });
        }
    }

    private async extractTypeACandidates(
        conversation: PersistedConversation,
        turns: PersistedTurn[],
    ): Promise<UserProfileCandidate[]> {
        const input = { conversation, turns, now: this.now };
        if (this.createModelForExtraction && !this.isMobileHidden()) {
            try {
                const model = await this.createModelForExtraction();
                if (this.disposed) return [];
                if (model) {
                    return await this.typeAExtractor.extractCandidatesWithLLM(
                        input,
                        (prompt) => model.invoke(prompt).then((result) => {
                            if (typeof result === "string") return result;
                            const content = (result as { content?: unknown })?.content;
                            return content != null ? String(content) : String(result);
                        }),
                    );
                }
            } catch (error) {
                this.log("LLM extraction failed, falling back to regex", error);
            }
        }
        return this.typeAExtractor.extractCandidates(input);
    }

    private isMobileHidden(): boolean {
        try {
            const doc = getOptionalPlatformDocument();
            return doc?.visibilityState === "hidden";
        } catch {
            return false;
        }
    }

    async runTypeCRefresh(_reason: string): Promise<VaultMetacognitionSnapshot | null> {
        if (this.disposed) return null;
        if (!this.includeVaultInsightsInPrompt) return null;
        if (this.isMobileHidden()) return null;
        if (this.typeCRefreshInFlight) return this.typeCRefreshInFlight;
        this.typeCRefreshInFlight = this.runTypeCRefreshUnlocked()
            .then((snapshot) => {
                if (snapshot) this.vaultInsightsRefreshFailed = false;
                return snapshot;
            })
            .catch((error) => {
                if (!this.disposed && this.includeVaultInsightsInPrompt && !this.vaultSnapshot) {
                    this.vaultInsightsRefreshFailed = true;
                }
                throw error;
            })
            .finally(() => {
                this.typeCRefreshInFlight = null;
            });
        return this.typeCRefreshInFlight;
    }

    private async runTypeCRefreshUnlocked(): Promise<VaultMetacognitionSnapshot | null> {
        if (this.disposed) return null;
        const dataBoundaryFingerprint = this.getDataBoundaryFingerprint();
        const source = this.onVaultInsightsSourceChanged
            ? this.captureVaultInsightsSource(dataBoundaryFingerprint) : undefined;
        const snapshot = await this.typeCAnalyzer.analyze(this.now());
        const markdown = this.typeCAnalyzer.renderMarkdown(snapshot);
        if (this.disposed || !this.includeVaultInsightsInPrompt) return null;
        if (this.getDataBoundaryFingerprint() !== dataBoundaryFingerprint) {
            this.scheduleTypeCRefresh("data-boundary-changed");
            return null;
        }
        if (this.typeCWritePath) {
            await writeVaultInsightsIfChanged(this.app, this.typeCWritePath, markdown);
            if (this.disposed || !this.includeVaultInsightsInPrompt) return null;
            if (this.getDataBoundaryFingerprint() !== dataBoundaryFingerprint) {
                this.scheduleTypeCRefresh("data-boundary-changed");
                return null;
            }
        }
        if (source && !source.isSourceCurrent()) return null;
        this.vaultSnapshot = snapshot;
        this.vaultSnapshotDataBoundaryFingerprint = dataBoundaryFingerprint;
        this.vaultInsightsMarkdown = markdown;
        if (source) this.onVaultInsightsSourceChanged?.(source);
        return snapshot;
    }

    private captureVaultInsightsSource(boundary: string): VaultInsightsSourceReceipt {
        const identity = this.vaultInsightsSourceIdentity;
        // Type C reads metadata for every eligible Markdown file, not just the
        // representative paths shown in its output. Capture before its awaits.
        const sources = this.app.vault.getMarkdownFiles().filter(file => this.shouldHandleVaultEvent(file))
            .map(file => ({ file, path: file.path, mtime: file.stat.mtime, ctime: file.stat.ctime, size: file.stat.size }));
        return {
            sourcePaths: sources.map(source => source.path),
            isSourceCurrent: () => this.vaultInsightsSourceIdentity === identity
                && this.getDataBoundaryFingerprint() === boundary && sources.every(source => (
                this.app.vault.getAbstractFileByPath(source.path) === source.file
                && source.file.path === source.path && source.file.stat.mtime === source.mtime
                && source.file.stat.ctime === source.ctime && source.file.stat.size === source.size
                && this.shouldHandleVaultEvent(source.file)
            )),
        };
    }

    private startTypeCRefreshLoop(): void {
        if (this.typeCInterval) return;
        this.typeCInterval = setPlatformInterval(() => {
            this.scheduleTypeCRefresh("interval");
        }, this.typeCRefreshIntervalMs);
    }

    private stopTypeCRefreshLoop(): void {
        if (this.typeCTimer) clearPlatformTimeout(this.typeCTimer);
        if (this.typeCInterval) clearPlatformInterval(this.typeCInterval);
        this.typeCTimer = null;
        this.typeCInterval = null;
    }

    private async ensureUserProfileStoreReady(): Promise<void> {
        if (!this.userProfileStoreReady) {
            this.userProfileStoreReady = this.profileGovernancePort.initialize()
                .then((storedProfile) => {
                    this.userProfileSnapshot = storedProfile;
                })
                .catch((error) => {
                    this.userProfileStoreReady = null;
                    throw error;
                });
        }
        await this.userProfileStoreReady;
    }
}

function cloneUserProfileSnapshot(snapshot: UserProfileSnapshot): UserProfileSnapshot {
    return {
        updatedAt: snapshot.updatedAt,
        markdown: snapshot.markdown,
        records: snapshot.records.map((record) => ({
            ...record,
            ...(record.chatEvidence ? { chatEvidence: cloneChatMemoryCandidateEvidence(record.chatEvidence) } : {}),
            conversationIds: [...record.conversationIds],
        })),
    };
}

function cloneVaultMetacognitionSnapshot(snapshot: VaultMetacognitionSnapshot): VaultMetacognitionSnapshot {
    return {
        generatedAt: snapshot.generatedAt,
        fileCount: snapshot.fileCount,
        folderThemes: snapshot.folderThemes.map((entry) => ({ ...entry })),
        tagTaxonomy: snapshot.tagTaxonomy.map((entry) => ({ ...entry })),
        linkTopology: {
            hubNotes: snapshot.linkTopology.hubNotes.map((entry) => ({ ...entry })),
            unresolvedLinks: snapshot.linkTopology.unresolvedLinks.map((entry) => ({ ...entry })),
        },
        writingHabits: {
            busiestWeekdays: snapshot.writingHabits.busiestWeekdays.map((entry) => ({ ...entry })),
            averageWords: snapshot.writingHabits.averageWords,
            recentlyActive: [...snapshot.writingHabits.recentlyActive],
        },
        topicClusters: snapshot.topicClusters.map((entry) => ({
            label: entry.label,
            paths: [...entry.paths],
        })),
        knowledgeGaps: snapshot.knowledgeGaps.map((entry) => ({ ...entry })),
        trends: snapshot.trends.map((entry) => ({ ...entry })),
    };
}

function collectRepresentativeVaultInsightPaths(snapshot: VaultMetacognitionSnapshot): string[] {
    const paths = new Set<string>();
    for (const cluster of snapshot.topicClusters) {
        for (const path of cluster.paths) {
            const normalized = normalizePath(path);
            if (normalized) paths.add(normalized);
            if (paths.size >= 20) return [...paths];
        }
    }
    for (const note of snapshot.linkTopology.hubNotes) {
        const normalized = normalizePath(note.path);
        if (normalized) paths.add(normalized);
        if (paths.size >= 20) return [...paths];
    }
    for (const path of snapshot.writingHabits.recentlyActive) {
        const normalized = normalizePath(path);
        if (normalized) paths.add(normalized);
        if (paths.size >= 20) break;
    }
    return [...paths];
}

async function writeVaultInsightsIfChanged(app: App, path: string, markdown: string): Promise<void> {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !(await app.vault.adapter.exists(folder))) {
        await createFolderRecursive(app, folder);
    }
    if (await app.vault.adapter.exists(path)) {
        const existing = await app.vault.adapter.read(path).catch(() => null);
        if (existing === markdown) return;
    }
    await app.vault.adapter.write(path, markdown);
}

async function createFolderRecursive(app: App, folder: string): Promise<void> {
    const parts = normalizePath(folder).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await app.vault.adapter.exists(current))) {
            await app.vault.adapter.mkdir(current);
        }
    }
}

function summarizeVaultInsightsForPrompt(markdown: string): string {
    return markdown
        .split("\n")
        .filter((line) => /^#|^- /.test(line))
        .slice(0, 40)
        .join("\n")
        .slice(0, 3000);
}
