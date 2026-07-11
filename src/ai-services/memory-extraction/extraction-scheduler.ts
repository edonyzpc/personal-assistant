import type { App, TAbstractFile } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import type { ChatHistoryManager } from "../../chat/chat-history-manager";
import { clearPlatformInterval, clearPlatformTimeout, setPlatformInterval, setPlatformTimeout, type PlatformIntervalHandle, type PlatformTimeoutHandle } from "../../platform-dom";
import { MemoryUserProfileStore, type UserProfileStore } from "./profile-store";
import {
    SerializedProfileGovernancePort,
    type ProfileGovernancePort,
    type ProfileGovernanceMutation,
} from "./profile-governance-port";
import {
    TypeAUserProfileExtractor,
    type UserProfileCandidate,
    type UserProfileSnapshot,
} from "./type-a-extractor";
import type { PersistedConversation, PersistedTurn } from "../../chat/chat-history-store";
import { getOptionalPlatformDocument } from "../../platform-dom";
import { TypeCVaultMetacognitionAnalyzer, type SemanticClusterProvider, type VaultMetacognitionSnapshot } from "./type-c-analyzer";
import type { TypeAAdmissionBaseline } from "../../pa/memory-admission-coordinator";

export type CreateModelForExtraction = () => Promise<{ invoke: (prompt: string) => Promise<string> } | null>;

export interface TypeAAdmissionBatch {
    current: UserProfileSnapshot | null;
    proposed: UserProfileSnapshot;
    candidates: UserProfileCandidate[];
    baseline?: TypeAAdmissionBaseline;
    evidence: {
        conversationId: string;
        throughTurnIndex: number;
    };
}

export type TypeAAdmissionResult = { status: "processed" | "retry" };

export type AdmitTypeACandidates = (
    batch: TypeAAdmissionBatch,
) => Promise<TypeAAdmissionResult>;

type TypeAAdmissionBaselineOutcome =
    | { status: "ready"; baseline: TypeAAdmissionBaseline }
    | { status: "failed"; error: unknown };

export interface MemoryExtractionSchedulerOptions {
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
    private readonly captureTypeAAdmissionBaseline: MemoryExtractionSchedulerOptions["captureTypeAAdmissionBaseline"];
    private readonly getTypeAProcessedTurn: MemoryExtractionSchedulerOptions["getTypeAProcessedTurn"];

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
        this.captureTypeAAdmissionBaseline = options.captureTypeAAdmissionBaseline;
        this.getTypeAProcessedTurn = options.getTypeAProcessedTurn;
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

    async mutateUserProfile(operation: ProfileGovernanceMutation): Promise<UserProfileSnapshot> {
        await this.ensureUserProfileStoreReady();
        const snapshot = await this.profileGovernancePort.mutate(operation);
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

    handleVaultEvent(file: TAbstractFile | null, reason: string): void {
        if (this.disposed) return;
        if (!this.includeVaultInsightsInPrompt) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith(".md")) return;
        if (this.typeCWritePath && normalizePath(file.path) === this.typeCWritePath) return;
        if (!this.shouldHandleVaultEvent(file)) return;
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
        if (this.disposed) return null;
        const baselineOutcome = this.admitTypeACandidates
            ? scheduledBaseline ?? this.captureTypeAAdmissionBaselineOutcome()
            : undefined;
        const capturedBaseline = baselineOutcome ? await baselineOutcome : undefined;
        if (capturedBaseline?.status === "failed") throw capturedBaseline.error;
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
        const lastProcessedTurn = Math.max(
            this.typeAProcessedTurnByConversation.get(conversationId) ?? -1,
            durableProcessedTurn ?? -1,
        );
        const newTurns = turns.filter((turn) => turn.turnIndex > lastProcessedTurn);
        if (newTurns.length === 0) return this.userProfileSnapshot;
        const candidates = await this.extractTypeACandidates(conversation, newTurns);
        if (this.admitTypeACandidates) {
            const current = this.userProfileSnapshot
                ? cloneUserProfileSnapshot(this.userProfileSnapshot)
                : null;
            const proposed = this.typeAExtractor.mergeCandidates(current, candidates, this.now());
            const throughTurnIndex = Math.max(...newTurns.map((turn) => turn.turnIndex));
            const admitted = await this.admitTypeACandidates({
                current,
                proposed: cloneUserProfileSnapshot(proposed),
                candidates: candidates.map((candidate) => ({ ...candidate })),
                ...(baseline ? { baseline } : {}),
                evidence: { conversationId, throughTurnIndex },
            });
            if (admitted.status === "retry") return this.userProfileSnapshot;
        } else {
            this.userProfileSnapshot = await this.mutateUserProfile((current) => (
                this.typeAExtractor.mergeCandidates(current, candidates, this.now())
            ));
        }
        this.typeAProcessedTurnByConversation.set(
            conversationId,
            Math.max(...newTurns.map((turn) => turn.turnIndex)),
        );
        return this.userProfileSnapshot;
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
        this.vaultSnapshot = snapshot;
        this.vaultSnapshotDataBoundaryFingerprint = dataBoundaryFingerprint;
        this.vaultInsightsMarkdown = markdown;
        return snapshot;
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
