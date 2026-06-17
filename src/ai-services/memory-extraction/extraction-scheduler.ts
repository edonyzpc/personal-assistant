import type { App, TAbstractFile } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import type { ChatHistoryManager } from "../../chat/chat-history-manager";
import { clearPlatformInterval, clearPlatformTimeout, setPlatformInterval, setPlatformTimeout, type PlatformIntervalHandle, type PlatformTimeoutHandle } from "../../platform-dom";
import { MemoryUserProfileStore, type UserProfileStore } from "./profile-store";
import { TypeAUserProfileExtractor, type UserProfileSnapshot } from "./type-a-extractor";
import { TypeCVaultMetacognitionAnalyzer, type VaultMetacognitionSnapshot } from "./type-c-analyzer";

export interface MemoryExtractionSchedulerOptions {
    app: App;
    chatHistoryManager: ChatHistoryManager;
    userProfileStore?: UserProfileStore;
    log?: (message: string, error?: unknown) => void;
    now?: () => Date;
    typeAIntervalTurns?: number;
    typeCRefreshIntervalMs?: number;
    typeCWritePath?: string | null;
    includeVaultInsightsInPrompt?: boolean;
}

export interface MemoryExtractionPromptContext {
    userProfile?: string;
    vaultInsights?: string;
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
    private readonly includeVaultInsightsInPrompt: boolean;
    private readonly userProfileStore: UserProfileStore;
    private readonly typeAExtractor = new TypeAUserProfileExtractor();
    private readonly typeCAnalyzer: TypeCVaultMetacognitionAnalyzer;
    private typeATimer: PlatformTimeoutHandle | null = null;
    private typeCTimer: PlatformTimeoutHandle | null = null;
    private typeCInterval: PlatformIntervalHandle | null = null;
    private userProfileStoreReady: Promise<void> | null = null;
    private disposed = false;
    private userProfileSnapshot: UserProfileSnapshot | null = null;
    private vaultSnapshot: VaultMetacognitionSnapshot | null = null;
    private vaultInsightsMarkdown = "";
    private lastTypeAConversationId: string | null = null;
    private typeCRefreshInFlight: Promise<VaultMetacognitionSnapshot | null> | null = null;
    private readonly typeAProcessedTurnByConversation = new Map<string, number>();

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
        this.userProfileStore = options.userProfileStore ?? new MemoryUserProfileStore();
        this.typeCAnalyzer = new TypeCVaultMetacognitionAnalyzer(this.app);
    }

    start(): void {
        if (this.disposed) return;
        void this.ensureUserProfileStoreReady().catch((error) => {
            this.log("Type A user profile store failed to initialize", error);
        });
        this.typeCInterval = setPlatformInterval(() => {
            this.scheduleTypeCRefresh("interval");
        }, this.typeCRefreshIntervalMs);
        this.scheduleTypeCRefresh("startup", 15_000);
    }

    dispose(): void {
        this.disposed = true;
        if (this.typeATimer) clearPlatformTimeout(this.typeATimer);
        if (this.typeCTimer) clearPlatformTimeout(this.typeCTimer);
        if (this.typeCInterval) clearPlatformInterval(this.typeCInterval);
        this.typeATimer = null;
        this.typeCTimer = null;
        this.typeCInterval = null;
        void this.userProfileStore.dispose().catch((error) => {
            this.log("Type A user profile store failed to close", error);
        });
    }

    getPromptContext(): MemoryExtractionPromptContext {
        return {
            ...(this.userProfileSnapshot?.markdown ? { userProfile: this.userProfileSnapshot.markdown } : {}),
            ...(this.includeVaultInsightsInPrompt && this.vaultInsightsMarkdown
                ? { vaultInsights: summarizeVaultInsightsForPrompt(this.vaultInsightsMarkdown) }
                : {}),
        };
    }

    scheduleTypeAExtraction(conversationId: string, turnCount: number, delayMs = 2_000): void {
        if (this.disposed) return;
        if (turnCount % this.typeAIntervalTurns !== 0 && this.lastTypeAConversationId === conversationId) return;
        this.lastTypeAConversationId = conversationId;
        if (this.typeATimer) clearPlatformTimeout(this.typeATimer);
        this.typeATimer = setPlatformTimeout(() => {
            this.typeATimer = null;
            void this.runTypeAExtraction(conversationId).catch((error) => {
                this.log("Type A user profile extraction failed", error);
            });
        }, Math.max(0, delayMs));
    }

    handleVaultEvent(file: TAbstractFile | null, reason: string): void {
        if (this.disposed) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith(".md")) return;
        if (this.typeCWritePath && normalizePath(file.path) === this.typeCWritePath) return;
        this.scheduleTypeCRefresh(reason, DEFAULT_TYPE_C_VAULT_EVENT_DELAY_MS);
    }

    scheduleTypeCRefresh(reason: string, delayMs = 0): void {
        if (this.disposed) return;
        if (this.typeCTimer) clearPlatformTimeout(this.typeCTimer);
        this.typeCTimer = setPlatformTimeout(() => {
            this.typeCTimer = null;
            void this.runTypeCRefresh(reason).catch((error) => {
                this.log("Type C vault metacognition refresh failed", error);
            });
        }, Math.max(0, delayMs));
    }

    async runTypeAExtraction(conversationId: string): Promise<UserProfileSnapshot | null> {
        if (this.disposed) return null;
        await this.ensureUserProfileStoreReady();
        if (this.disposed) return null;
        const conversation = await this.chatHistoryManager.findConversation(conversationId);
        if (this.disposed) return null;
        if (!conversation) return this.userProfileSnapshot;
        const turns = await this.chatHistoryManager.getTurns(conversationId);
        if (this.disposed) return null;
        const lastProcessedTurn = this.typeAProcessedTurnByConversation.get(conversationId) ?? -1;
        const newTurns = turns.filter((turn) => turn.turnIndex > lastProcessedTurn);
        if (newTurns.length === 0) return this.userProfileSnapshot;
        const candidates = this.typeAExtractor.extractCandidates({
            conversation,
            turns: newTurns,
            now: this.now,
        });
        this.userProfileSnapshot = this.typeAExtractor.mergeCandidates(this.userProfileSnapshot, candidates, this.now());
        await this.userProfileStore.setProfile(this.userProfileSnapshot);
        this.typeAProcessedTurnByConversation.set(
            conversationId,
            Math.max(...newTurns.map((turn) => turn.turnIndex)),
        );
        return this.userProfileSnapshot;
    }

    async runTypeCRefresh(_reason: string): Promise<VaultMetacognitionSnapshot | null> {
        if (this.disposed) return null;
        if (this.typeCRefreshInFlight) return this.typeCRefreshInFlight;
        this.typeCRefreshInFlight = this.runTypeCRefreshUnlocked()
            .finally(() => {
                this.typeCRefreshInFlight = null;
            });
        return this.typeCRefreshInFlight;
    }

    private async runTypeCRefreshUnlocked(): Promise<VaultMetacognitionSnapshot | null> {
        if (this.disposed) return null;
        const snapshot = await this.typeCAnalyzer.analyze(this.now());
        const markdown = this.typeCAnalyzer.renderMarkdown(snapshot);
        if (this.typeCWritePath) {
            await writeVaultInsightsIfChanged(this.app, this.typeCWritePath, markdown);
            if (this.disposed) return null;
        }
        this.vaultSnapshot = snapshot;
        this.vaultInsightsMarkdown = markdown;
        return snapshot;
    }

    private async ensureUserProfileStoreReady(): Promise<void> {
        if (!this.userProfileStoreReady) {
            this.userProfileStoreReady = this.userProfileStore.initialize()
                .then(async () => {
                    this.userProfileSnapshot = await this.userProfileStore.getProfile();
                })
                .catch((error) => {
                    this.userProfileStoreReady = null;
                    throw error;
                });
        }
        await this.userProfileStoreReady;
    }
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
