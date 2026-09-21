import {
    assessAIReadiness,
    type AIReadinessIssue,
    type AIReadinessScope,
    type AIReadinessSnapshot,
    type APITokenCacheState,
} from "./ai-utils";
import {
    resolveImageGenerationConnection,
    type ImageGenerationConnection,
} from "./image-generation-connection";
import type { AISetupInput, AISetupResult } from "../chat/ChatHost";
import {
    PROVIDER_PRESETS,
    type PluginManagerSettings,
} from "../settings";
import { KEYCHAIN_API_TOKEN_ID, getVaultApiTokenId } from "../utils";

export type AIProviderConfigurationPatch = Partial<Pick<PluginManagerSettings,
    | "aiProvider"
    | "aiProviderPreset"
    | "baseURL"
    | "chatModelName"
    | "embeddingModelName"
>>;

export type ImageGenerationConnectionPatch = Partial<Pick<PluginManagerSettings,
    "imageGenerationConnectionMode" | "imageGenerationBaseURL"
>>;

interface SecretStoragePort {
    getSecret(id: string): string | null;
    setSecret(id: string, value: string): void;
}

export interface PluginAIConfigurationDependencies {
    getSettings(): PluginManagerSettings;
    isUnloading(): boolean;
    getSecretStorage(): SecretStoragePort;
    enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T>;
    saveSettingsData(snapshot: PluginManagerSettings): Promise<void>;
    trackRequiredSettingsTransaction<T>(operation: Promise<T>): Promise<T>;
    notifySettingsChanged(): Promise<void>;
    cancelActivePreparation(): void;
    translateSetupIssue(issue: AIReadinessIssue): string;
    showTokenMissingNotice(): void;
    log(message: string, detail?: unknown): void;
}

export class PluginAIConfiguration {
    private token = "";
    private tokenCacheState: APITokenCacheState = "unknown";
    private transactionTail: Promise<void> | null = null;
    private providerConfigurationRevision = 0;
    private tokenRevision = 0;
    private externalSettingsMutationEpoch = 0;
    private pendingExternalProviderMutationEpoch: number | null = null;
    private readinessFailureRevision = 0;
    private credentialTransitionCount = 0;
    private settingsNotificationDeferredDuringCredentialTransaction = false;

    constructor(private readonly dependencies: PluginAIConfigurationDependencies) {}

    getTokenForCompatibility(): string {
        return this.token;
    }

    setTokenForCompatibility(value: string): void {
        this.token = value;
    }

    getTokenCacheState(): APITokenCacheState {
        return this.tokenCacheState;
    }

    setTokenCacheStateForCompatibility(value: APITokenCacheState): void {
        this.tokenCacheState = value;
    }

    getTransactionTailForCompatibility(): Promise<void> | null {
        return this.transactionTail;
    }

    setTransactionTailForCompatibility(value: Promise<void> | null): void {
        this.transactionTail = value;
    }

    getProviderConfigurationRevision(): number {
        return this.providerConfigurationRevision;
    }

    setProviderConfigurationRevisionForCompatibility(value: number): void {
        this.providerConfigurationRevision = value;
    }

    getTokenRevision(): number {
        return this.tokenRevision;
    }

    setTokenRevisionForCompatibility(value: number): void {
        this.tokenRevision = value;
    }

    getExternalSettingsMutationEpochForCompatibility(): number {
        return this.externalSettingsMutationEpoch;
    }

    setExternalSettingsMutationEpochForCompatibility(value: number): void {
        this.externalSettingsMutationEpoch = value;
    }

    getPendingExternalProviderMutationEpochForCompatibility(): number | null {
        return this.pendingExternalProviderMutationEpoch;
    }

    setPendingExternalProviderMutationEpochForCompatibility(value: number | null): void {
        this.pendingExternalProviderMutationEpoch = value;
    }

    getReadinessFailureRevisionForCompatibility(): number {
        return this.readinessFailureRevision;
    }

    setReadinessFailureRevisionForCompatibility(value: number): void {
        this.readinessFailureRevision = value;
    }

    getCredentialTransitionCountForCompatibility(): number {
        return this.credentialTransitionCount;
    }

    setCredentialTransitionCountForCompatibility(value: number): void {
        this.credentialTransitionCount = value;
    }

    getNotificationDeferredForCompatibility(): boolean {
        return this.settingsNotificationDeferredDuringCredentialTransaction;
    }

    setNotificationDeferredForCompatibility(value: boolean): void {
        this.settingsNotificationDeferredDuringCredentialTransaction = value;
    }

    async notifyReadinessChanged(): Promise<void> {
        if (this.dependencies.isUnloading()) return;
        await this.enqueueTransaction(async () => {
            if (!this.dependencies.isUnloading()) {
                await this.dependencies.notifySettingsChanged();
            }
        });
    }

    beginProviderConfigurationMutation(): number {
        const epoch = this.externalSettingsMutationEpoch + 1;
        this.externalSettingsMutationEpoch = epoch;
        this.pendingExternalProviderMutationEpoch = epoch;
        return epoch;
    }

    hasActiveCredentialTransition(): boolean {
        return this.credentialTransitionCount > 0;
    }

    deferSettingsNotification(): void {
        this.settingsNotificationDeferredDuringCredentialTransaction = true;
    }

    getAPITokenSecretId(): string {
        return getVaultApiTokenId(this.dependencies.getSettings().statisticsVaultId || "default-vault");
    }

    getImageAPITokenSecretId(): string {
        return getVaultApiTokenId(
            `${this.dependencies.getSettings().statisticsVaultId || "default-vault"}-image`,
        );
    }

    getImageGenerationConnection(): ImageGenerationConnection | null {
        try {
            return resolveImageGenerationConnection(this.dependencies.getSettings(), {
                chat: this.getAPITokenSecretId(),
                dedicated: this.getImageAPITokenSecretId(),
            });
        } catch {
            return null;
        }
    }

    getConfiguredImageAPITokenSecret(): string | null {
        return normalizeAPIToken(
            this.dependencies.getSecretStorage().getSecret(this.getImageAPITokenSecretId()),
        );
    }

    async setImageAPITokenSecret(value: string): Promise<void> {
        const normalized = normalizeAPIToken(value) ?? "";
        const secretId = this.getImageAPITokenSecretId();
        const storage = this.dependencies.getSecretStorage();
        const previous = storage.getSecret(secretId);
        storage.setSecret(secretId, normalized);
        try {
            await this.saveImageGenerationConnectionSettings({});
        } catch (error) {
            storage.setSecret(secretId, previous ?? "");
            throw error;
        }
    }

    async saveImageGenerationConnectionSettings(patch: ImageGenerationConnectionPatch): Promise<void> {
        await this.dependencies.enqueueSettingsWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            const settings = this.dependencies.getSettings();
            const next = {
                ...settings,
                ...patch,
                imageGenerationConnectionRevision: settings.imageGenerationConnectionRevision + 1,
            };
            if (next.imageGenerationConnectionMode === "dedicated-wan") {
                resolveImageGenerationConnection(next, {
                    chat: this.getAPITokenSecretId(),
                    dedicated: this.getImageAPITokenSecretId(),
                });
            }
            await this.dependencies.saveSettingsData(next);
            Object.assign(this.dependencies.getSettings(), next);
        });
        await this.dependencies.notifySettingsChanged();
    }

    getConfiguredAPITokenSecret(): string | null {
        const storage = this.dependencies.getSecretStorage();
        const currentId = this.getAPITokenSecretId();
        const currentToken = normalizeAPIToken(storage.getSecret(currentId));
        if (currentToken) return currentToken;

        for (const legacyId of this.getAPITokenSecretCandidateIds()) {
            if (legacyId === currentId) continue;
            const legacyToken = normalizeAPIToken(storage.getSecret(legacyId));
            if (legacyToken) return legacyToken;
        }
        return null;
    }

    setAPITokenSecret(value: string, origin: "settings" | "inline-setup" = "settings"): void {
        const normalized = normalizeAPIToken(value) ?? "";
        this.dependencies.cancelActivePreparation();
        const storage = this.dependencies.getSecretStorage();
        const currentId = this.getAPITokenSecretId();
        try {
            storage.setSecret(currentId, normalized);
            if (normalized === "") {
                for (const legacyId of this.getAPITokenSecretCandidateIds()) {
                    if (legacyId !== currentId) storage.setSecret(legacyId, "");
                }
            }
        } catch (error) {
            this.clearTokenCache();
            this.claimTokenMutation();
            if (origin === "settings") this.externalSettingsMutationEpoch += 1;
            throw error;
        }
        this.token = "";
        this.tokenCacheState = normalized ? "present" : "missing";
        this.claimTokenMutation();
        if (origin === "settings") this.externalSettingsMutationEpoch += 1;
    }

    hasConfiguredAPIToken(): boolean {
        return this.tokenCacheState === "present";
    }

    hasTokenCachedValue(): boolean | null {
        if (this.tokenCacheState === "unknown") return null;
        return this.tokenCacheState === "present";
    }

    refreshAPITokenPresence(): APITokenCacheState {
        if (this.hasActiveCredentialTransition()) {
            this.deferSettingsNotification();
            return "unknown";
        }
        try {
            const token = this.getConfiguredAPITokenSecret();
            this.tokenCacheState = token ? "present" : "missing";
            if (!token) this.token = "";
        } catch (error) {
            this.clearTokenCache();
            this.dependencies.log("Failed to inspect API token presence", error);
        }
        return this.tokenCacheState;
    }

    getAIReadiness(scope: AIReadinessScope = "chat"): AIReadinessSnapshot {
        if (this.hasActiveCredentialTransition()) {
            this.deferSettingsNotification();
            return assessAIReadiness(this.dependencies.getSettings(), "unknown", scope);
        }
        return assessAIReadiness(this.dependencies.getSettings(), this.tokenCacheState, scope);
    }

    getAISetupIssue(scope: AIReadinessScope = "chat"): string | null {
        const issue = this.getAIReadiness(scope).issue;
        return issue === null ? null : this.dependencies.translateSetupIssue(issue);
    }

    async getAPIToken(): Promise<string> {
        if (this.hasActiveCredentialTransition()) {
            this.deferSettingsNotification();
            throw new Error("AI provider configuration is being updated. Try again.");
        }
        if (this.token !== "") return this.token;
        const token = this.getConfiguredAPITokenSecret();
        if (!token) {
            this.tokenCacheState = "missing";
            this.dependencies.showTokenMissingNotice();
            return "";
        }
        this.tokenCacheState = "present";
        this.token = token;
        return token;
    }

    clearTokenCache(): void {
        this.token = "";
        this.tokenCacheState = "unknown";
    }

    updateAIProviderConfiguration(
        patch: AIProviderConfigurationPatch,
        invocationEpoch: number,
    ): Promise<AISetupResult> {
        if (this.dependencies.isUnloading()) {
            if (this.pendingExternalProviderMutationEpoch === invocationEpoch) {
                this.pendingExternalProviderMutationEpoch = null;
            }
            return Promise.resolve({ ok: false, code: "settings_save_failed" });
        }
        const requestedPatch = { ...patch };
        const startingTokenRevision = this.tokenRevision;
        const releaseCredentialTransition = this.acquireCredentialTransition();
        const transaction = this.enqueueTransaction(
            () => this.updateAIProviderConfigurationTransaction(
                requestedPatch,
                startingTokenRevision,
                releaseCredentialTransition,
            ),
        );
        if (this.pendingExternalProviderMutationEpoch === invocationEpoch) {
            this.pendingExternalProviderMutationEpoch = null;
        }
        return transaction;
    }

    completeAISetup(input: AISetupInput): Promise<AISetupResult> {
        if (this.dependencies.isUnloading()) {
            return Promise.resolve({ ok: false, code: "settings_save_failed" });
        }
        if (typeof this.pendingExternalProviderMutationEpoch === "number") {
            return Promise.resolve({ ok: false, code: "settings_save_failed" });
        }
        const requestedInput = { ...input };
        const submittedExternalSettingsEpoch = this.externalSettingsMutationEpoch;
        const releaseCredentialTransition = normalizeAPIToken(requestedInput.token)
            ? this.acquireCredentialTransition()
            : null;
        return this.enqueueTransaction(
            () => this.completeAISetupTransaction(
                requestedInput,
                submittedExternalSettingsEpoch,
                releaseCredentialTransition,
            ),
        );
    }

    private getAPITokenSecretCandidateIds(): string[] {
        const currentId = this.getAPITokenSecretId();
        const defaultScopedId = getVaultApiTokenId("default-vault");
        return [currentId, defaultScopedId, KEYCHAIN_API_TOKEN_ID]
            .filter((id, index, ids) => ids.indexOf(id) === index);
    }

    private claimProviderTupleMutation(): number {
        this.providerConfigurationRevision += 1;
        return this.providerConfigurationRevision;
    }

    private claimTokenMutation(): number {
        this.tokenRevision += 1;
        return this.tokenRevision;
    }

    private acquireCredentialTransition(): () => void {
        this.credentialTransitionCount += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.credentialTransitionCount = Math.max(0, this.credentialTransitionCount - 1);
        };
    }

    private async settleCredentialTransitionNotification(shouldNotify: boolean): Promise<void> {
        if (shouldNotify) this.deferSettingsNotification();
        if (this.hasActiveCredentialTransition()) return;
        const notificationWasDeferred = this.settingsNotificationDeferredDuringCredentialTransaction;
        this.settingsNotificationDeferredDuringCredentialTransaction = false;
        if (notificationWasDeferred && !this.dependencies.isUnloading()) {
            await this.dependencies.notifySettingsChanged();
        }
    }

    private async failClosedProviderAfterCompensationFailure(logMessage: string): Promise<void> {
        const settings = this.dependencies.getSettings();
        settings.aiProvider = "";
        settings.aiProviderPreset = undefined;
        this.claimProviderTupleMutation();
        this.readinessFailureRevision += 1;
        try {
            await this.dependencies.saveSettingsData(settings);
        } catch (error) {
            this.dependencies.log(logMessage, error);
        }
    }

    private enqueueTransaction<T>(operation: () => Promise<T>): Promise<T> {
        this.transactionTail ??= Promise.resolve();
        const transaction = this.transactionTail.then(operation, operation);
        this.transactionTail = transaction.then(() => undefined, () => undefined);
        return this.dependencies.trackRequiredSettingsTransaction(transaction);
    }

    private async updateAIProviderConfigurationTransaction(
        patch: AIProviderConfigurationPatch,
        startingTokenRevision: number,
        releaseCredentialTransition: () => void,
    ): Promise<AISetupResult> {
        const startingFailureRevision = this.readinessFailureRevision;
        let result: AISetupResult | undefined;
        try {
            result = await this.dependencies.enqueueSettingsWrite(
                () => this.updateAIProviderConfigurationExclusive(patch, startingTokenRevision),
            );
            return result;
        } finally {
            const readinessFailedClosed = this.readinessFailureRevision !== startingFailureRevision;
            releaseCredentialTransition();
            await this.settleCredentialTransitionNotification(
                result?.ok === true || readinessFailedClosed,
            );
        }
    }

    private async updateAIProviderConfigurationExclusive(
        patch: AIProviderConfigurationPatch,
        startingTokenRevision: number,
    ): Promise<AISetupResult> {
        const settings = this.dependencies.getSettings();
        const previousSettings = {
            aiProvider: settings.aiProvider,
            aiProviderPreset: settings.aiProviderPreset,
            baseURL: settings.baseURL,
            chatModelName: settings.chatModelName,
            embeddingModelName: settings.embeddingModelName,
        };
        this.dependencies.cancelActivePreparation();
        let ownedProviderRevision = this.claimProviderTupleMutation();
        const nextSettings: PluginManagerSettings = { ...settings, ...patch };

        try {
            await this.dependencies.saveSettingsData(nextSettings);
            if (this.providerConfigurationRevision === ownedProviderRevision) {
                Object.assign(this.dependencies.getSettings(), {
                    aiProvider: nextSettings.aiProvider,
                    aiProviderPreset: nextSettings.aiProviderPreset,
                    baseURL: nextSettings.baseURL,
                    chatModelName: nextSettings.chatModelName,
                    embeddingModelName: nextSettings.embeddingModelName,
                });
            }
            return { ok: true };
        } catch (error) {
            this.dependencies.log("Failed to save AI provider from Settings", error);
        }

        if (this.tokenRevision !== startingTokenRevision) {
            await this.failClosedProviderAfterCompensationFailure(
                "Failed to persist incomplete AI provider state after concurrent token mutation",
            );
            return { ok: false, code: "compensation_failed" };
        }
        if (this.providerConfigurationRevision !== ownedProviderRevision) {
            return { ok: false, code: "settings_save_failed" };
        }

        ownedProviderRevision = this.claimProviderTupleMutation();
        try {
            await this.dependencies.saveSettingsData({
                ...this.dependencies.getSettings(),
                ...previousSettings,
            });
            if (this.tokenRevision !== startingTokenRevision) {
                await this.failClosedProviderAfterCompensationFailure(
                    "Failed to persist incomplete AI provider state after token mutation during rollback",
                );
                return { ok: false, code: "compensation_failed" };
            }
            return { ok: false, code: "settings_save_failed" };
        } catch (compensationError) {
            this.dependencies.log(
                "Failed to restore AI provider settings after Settings save failure",
                compensationError,
            );
        }
        if (this.providerConfigurationRevision === ownedProviderRevision) {
            await this.failClosedProviderAfterCompensationFailure(
                "Failed to persist incomplete AI provider state after rollback failure",
            );
        }
        return { ok: false, code: "compensation_failed" };
    }

    private async completeAISetupTransaction(
        input: AISetupInput,
        submittedExternalSettingsEpoch: number,
        releaseCredentialTransition: (() => void) | null,
    ): Promise<AISetupResult> {
        const startingFailureRevision = this.readinessFailureRevision;
        let result: AISetupResult | undefined;
        try {
            result = await this.dependencies.enqueueSettingsWrite(
                () => this.completeAISetupExclusive(input, submittedExternalSettingsEpoch),
            );
            return result;
        } finally {
            const readinessFailedClosed = this.readinessFailureRevision !== startingFailureRevision;
            releaseCredentialTransition?.();
            await this.settleCredentialTransitionNotification(
                result?.ok === true || readinessFailedClosed,
            );
        }
    }

    private async completeAISetupExclusive(
        input: AISetupInput,
        submittedExternalSettingsEpoch: number,
    ): Promise<AISetupResult> {
        if (this.externalSettingsMutationEpoch !== submittedExternalSettingsEpoch) {
            return { ok: false, code: "settings_save_failed" };
        }
        const preset = input.presetKey ? PROVIDER_PRESETS[input.presetKey] : undefined;
        if (input.presetKey && (!preset || input.presetKey === "custom")) {
            return { ok: false, code: "invalid_configuration" };
        }

        const startingProviderRevision = this.providerConfigurationRevision;
        const startingTokenRevision = this.tokenRevision;
        let ownedProviderRevision = startingProviderRevision;
        let ownedTokenRevision = startingTokenRevision;
        const settings = this.dependencies.getSettings();
        const previousSettings = {
            aiProvider: settings.aiProvider,
            aiProviderPreset: settings.aiProviderPreset,
            baseURL: settings.baseURL,
            chatModelName: settings.chatModelName,
            embeddingModelName: settings.embeddingModelName,
        };
        const nextSettings = preset ? {
            aiProvider: preset.runtimeProvider,
            aiProviderPreset: input.presetKey,
            baseURL: preset.baseURL,
            chatModelName: preset.chatModelName,
            embeddingModelName: preset.embeddingModelName,
        } : previousSettings;
        const requestedToken = normalizeAPIToken(input.token);

        if (!requestedToken && this.tokenCacheState === "unknown") {
            this.refreshAPITokenPresence();
        }
        if (!requestedToken && this.tokenCacheState !== "present") {
            return { ok: false, code: "token_required" };
        }
        if (!assessAIReadiness(nextSettings, "present", "chat").ready) {
            return { ok: false, code: "invalid_configuration" };
        }

        let previousToken: string | null = null;
        let tokenWritten = false;
        if (requestedToken) {
            try {
                previousToken = this.getConfiguredAPITokenSecret();
            } catch (error) {
                this.clearTokenCache();
                this.dependencies.log("Failed to inspect the previous API token during inline setup", error);
                return { ok: false, code: "token_save_failed" };
            }
            try {
                this.setAPITokenSecret(requestedToken, "inline-setup");
                tokenWritten = true;
                ownedTokenRevision = this.tokenRevision;
            } catch (error) {
                this.dependencies.log("Failed to save API token during inline setup", error);
                try {
                    this.setAPITokenSecret(previousToken ?? "", "inline-setup");
                } catch (compensationError) {
                    this.clearTokenCache();
                    this.dependencies.log(
                        "Failed to compensate API token after inline setup write failure",
                        compensationError,
                    );
                    await this.failClosedProviderAfterCompensationFailure(
                        "Failed to persist incomplete AI provider state after token write compensation failure",
                    );
                    return { ok: false, code: "compensation_failed" };
                }
                return { ok: false, code: "token_save_failed" };
            }
        }

        if (!preset) return { ok: true };

        this.dependencies.cancelActivePreparation();
        ownedProviderRevision = this.claimProviderTupleMutation();
        const settingsSnapshot: PluginManagerSettings = {
            ...this.dependencies.getSettings(),
            ...nextSettings,
        };
        try {
            await this.dependencies.saveSettingsData(settingsSnapshot);
            if (this.providerConfigurationRevision === ownedProviderRevision) {
                Object.assign(this.dependencies.getSettings(), nextSettings);
            }
            return { ok: true };
        } catch (error) {
            this.dependencies.log("Failed to save AI provider during inline setup", error);
            const ownsProviderTuple = this.providerConfigurationRevision === ownedProviderRevision;
            const ownsToken = tokenWritten && this.tokenRevision === ownedTokenRevision;
            if (ownsProviderTuple) ownedProviderRevision = this.claimProviderTupleMutation();
            let compensationFailed = false;
            let providerCompensationFailed = false;
            let tokenCompensationFailed = false;
            if (ownsToken) {
                try {
                    this.setAPITokenSecret(previousToken ?? "", "inline-setup");
                } catch (compensationError) {
                    compensationFailed = true;
                    tokenCompensationFailed = true;
                    this.clearTokenCache();
                    this.dependencies.log(
                        "Failed to restore API token after inline setup failure",
                        compensationError,
                    );
                }
            }
            if (ownsProviderTuple) {
                try {
                    await this.dependencies.saveSettingsData({
                        ...this.dependencies.getSettings(),
                        ...previousSettings,
                    });
                } catch (compensationError) {
                    compensationFailed = true;
                    providerCompensationFailed = true;
                    this.dependencies.log(
                        "Failed to restore AI provider settings after inline setup failure",
                        compensationError,
                    );
                }
            }
            if ((providerCompensationFailed || tokenCompensationFailed)
                && this.providerConfigurationRevision === ownedProviderRevision) {
                await this.failClosedProviderAfterCompensationFailure(
                    "Failed to persist incomplete AI provider state after inline setup rollback failure",
                );
            }
            return {
                ok: false,
                code: compensationFailed ? "compensation_failed" : "settings_save_failed",
            };
        }
    }
}

function normalizeAPIToken(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized || null;
}
