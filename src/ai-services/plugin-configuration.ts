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
    type LegacyImageConnectionReference,
} from "./image-generation-connection";
import type { AISetupInput, AISetupResult } from "../chat/ChatHost";
import {
    PROVIDER_PRESETS,
    type PluginManagerSettings,
} from "../settings";
import { KEYCHAIN_API_TOKEN_ID, getVaultApiTokenId } from "../utils";
import { getPlatformCrypto } from "../platform-dom";
import { createConnectionDefaults, getProviderDefinition } from "./provider-definitions";
import { isHttpEndpoint, resolveAIConnection as resolveSavedAIConnection } from "./ai-connection-resolver";
import type {
    AIConnection, AIConnectionsSettings, AIPurpose, PurposeBinding, AIConnectionResolution,
} from "./ai-connection-types";

export interface AIConnectionInput {
    providerId: string;
    name?: string;
    region?: string;
    endpoints?: AIConnection["endpoints"];
    models?: AIConnection["models"];
    options?: AIConnection["options"];
}

export type AIConnectionPatch = Pick<AIConnectionInput, "name" | "models" | "options">;

export interface AIConnectionDeletion {
    defaultConnectionId?: string | null;
    bindings?: Partial<Record<AIPurpose, PurposeBinding>>;
}

export interface AIConnectionCredentialLease {
    connectionId: string;
    secretRef: string;
    revision: number;
    token: string;
    isCurrent(): boolean;
}

interface ConnectionCredentialState {
    secretRef: string;
    state: APITokenCacheState;
    token: string;
    revision: number;
    transitioning: boolean;
    blocked: boolean;
}

interface ConnectionSecretWrite {
    connectionId: string;
    secretRef: string;
    value: string;
    previousValue: string | null;
}

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
    listSecrets?(): string[];
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
    private readonly connectionCredentials = new Map<string, ConnectionCredentialState>();
    private readonly pendingConnectionCredentials = new Map<string, number>();

    constructor(private readonly dependencies: PluginAIConfigurationDependencies) {}

    getAIConnections(): AIConnectionsSettings | undefined {
        const settings = this.dependencies.getSettings().aiConnections;
        return settings === undefined ? undefined : cloneConnectionSettings(settings);
    }

    previewAIConnectionName(name: string, exceptId?: string): string {
        const settings = this.dependencies.getSettings().aiConnections === undefined
            ? { connections: [] } : this.requireConnections();
        return this.availableConnectionName(name, settings, exceptId);
    }

    resolveAIConnection(purpose: AIPurpose): AIConnectionResolution {
        return resolveSavedAIConnection(this.dependencies.getSettings().aiConnections, purpose);
    }

    getAIConnectionTokenState(id: string): APITokenCacheState {
        const connection = this.findConnection(id);
        const state = this.connectionCredentialState(connection);
        return state.transitioning || state.blocked || this.pendingConnectionCredentials.has(id) ? "unknown" : state.state;
    }

    getAIConnectionCredentialRevision(id: string): number {
        return this.connectionCredentialState(this.findConnection(id)).revision;
    }

    async getAIConnectionToken(id: string): Promise<string> {
        const connection = this.findConnection(id);
        const state = this.connectionCredentialState(connection);
        if (state.transitioning || state.blocked || this.pendingConnectionCredentials.has(id) || this.dependencies.isUnloading()) {
            throw new Error("ai_connection:credential_unavailable");
        }
        if (state.state !== "unknown") return state.token;
        try {
            state.token = normalizeAPIToken(this.dependencies.getSecretStorage().getSecret(connection.secretRef)) ?? "";
            state.state = state.token ? "present" : "missing";
            return state.token;
        } catch {
            state.token = "";
            state.state = "unknown";
            throw new Error("ai_connection:secret_read_failed");
        }
    }

    async acquireCredentialLease(id: string): Promise<AIConnectionCredentialLease> {
        const token = await this.getAIConnectionToken(id);
        if (!token) throw new Error("ai_connection:token_missing");
        const connection = this.findConnection(id);
        const state = this.connectionCredentialState(connection);
        const revision = state.revision;
        const secretRef = connection.secretRef;
        return {
            connectionId: id, secretRef, revision, token,
            isCurrent: () => {
                const current = this.dependencies.getSettings().aiConnections?.connections.find(item => item.id === id);
                return !this.dependencies.isUnloading() && current?.secretRef === secretRef
                    && this.connectionCredentialState(current).revision === revision
                    && !state.transitioning && !state.blocked && !this.pendingConnectionCredentials.has(id);
            },
        };
    }

    createAIConnection(
        input: AIConnectionInput,
        key?: string,
        usage?: "default" | AIPurpose,
        options: { initialSetup?: boolean } = {},
    ): Promise<AIConnection> {
        const draft = JSON.parse(JSON.stringify(input)) as AIConnectionInput;
        return this.runConnectionTransaction(async () => {
            const previous = this.getAIConnections();
            const next = this.mutableConnections(previous, options.initialSetup === true);
            const defaults = createConnectionDefaults(draft.providerId);
            const definition = getProviderDefinition(draft.providerId)!;
            const endpoints = { ...defaults.endpoints, ...draft.endpoints };
            for (const endpoint of Object.values(endpoints)) {
                if (endpoint?.trim() && !isHttpEndpoint(endpoint.trim())) throw new Error("ai_connection:endpoint_invalid");
            }
            const connection: AIConnection = {
                ...defaults,
                id: `connection-${randomConnectionSuffix(24)}`,
                name: this.availableConnectionName(draft.name?.trim() || definition.name, next),
                region: draft.region ?? defaults.region,
                endpoints,
                models: { ...defaults.models, ...draft.models },
                options: { ...defaults.options, ...draft.options },
                secretRef: this.allocateSecretRef(draft.providerId, next),
                secretOwned: true,
                revision: 0,
            };
            next.connections.push(connection);
            if (usage === "default") next.defaultConnectionId = connection.id;
            else if (usage) next.bindings[usage] = { mode: "connection", connectionId: connection.id };
            const normalized = normalizeAPIToken(key);
            await this.commitConnections(previous, next, normalized ? {
                connectionId: connection.id, secretRef: connection.secretRef, value: normalized, previousValue: null,
            } : undefined, options.initialSetup === true);
            if (!normalized) this.connectionCredentialState(connection).state = "missing";
            return cloneConnection(connection);
        });
    }

    updateAIConnection(id: string, patch: AIConnectionPatch, key?: string): Promise<AIConnection> {
        const draft = JSON.parse(JSON.stringify(patch)) as AIConnectionPatch;
        const operation = () => this.runConnectionTransaction(async () => {
            const previous = this.requireConnections();
            const next = cloneConnectionSettings(previous);
            const connection = this.findConnection(id, next);
            if (draft.name !== undefined) {
                if (!draft.name.trim()) throw new Error("ai_connection:name_required");
                connection.name = this.availableConnectionName(draft.name.trim(), next, id);
            }
            const beforeRequest = connectionRequestIdentity(connection);
            if (draft.models) connection.models = { ...connection.models, ...draft.models };
            if (draft.options) connection.options = {
                ...connection.options, ...draft.options,
                ...(draft.options.chat ? { chat: { ...connection.options.chat, ...draft.options.chat } } : {}),
            };
            if (connectionRequestIdentity(connection) !== beforeRequest) connection.revision += 1;
            let write: ConnectionSecretWrite | undefined;
            const normalized = normalizeAPIToken(key);
            if (normalized) {
                const owned = this.ownsSecret(connection, previous);
                const previousValue = owned ? this.readSecretForWrite(connection.secretRef) : null;
                if (!owned) {
                    connection.secretRef = this.allocateSecretRef(connection.providerId, next);
                    connection.secretOwned = true;
                }
                write = { connectionId: id, secretRef: connection.secretRef, value: normalized, previousValue };
            }
            await this.commitConnections(previous, next, write);
            return cloneConnection(connection);
        });
        return normalizeAPIToken(key) ? this.withConnectionCredentialTransition(id, operation) : operation();
    }

    setDefaultAIConnection(id: string | null): Promise<void> {
        return this.runConnectionTransaction(async () => {
            const previous = this.requireConnections();
            const next = cloneConnectionSettings(previous);
            if (id !== null) this.findConnection(id, next);
            next.defaultConnectionId = id;
            await this.commitConnections(previous, next);
        });
    }

    setAIPurposeBinding(purpose: AIPurpose, binding: PurposeBinding): Promise<void> {
        const draft = { ...binding };
        return this.runConnectionTransaction(async () => {
            const previous = this.requireConnections();
            const next = cloneConnectionSettings(previous);
            this.validateBinding(draft, next);
            next.bindings[purpose] = draft;
            await this.commitConnections(previous, next);
        });
    }

    removeAIConnectionKey(id: string): Promise<void> {
        return this.withConnectionCredentialTransition(id, () => this.runConnectionTransaction(async () => {
            const previous = this.requireConnections();
            const next = cloneConnectionSettings(previous);
            const connection = this.findConnection(id, next);
            let write: ConnectionSecretWrite | undefined;
            if (this.ownsSecret(connection, previous)) {
                write = { connectionId: id, secretRef: connection.secretRef, value: "", previousValue: this.readSecretForWrite(connection.secretRef) };
            } else {
                // A persistent empty reference revokes this connection without damaging a shared legacy slot.
                connection.secretRef = this.allocateSecretRef(connection.providerId, next);
                connection.secretOwned = true;
            }
            await this.commitConnections(previous, next, write);
            const state = this.connectionCredentialState(connection);
            state.state = "missing";
            state.token = "";
        }));
    }

    deleteAIConnection(id: string, replacement: AIConnectionDeletion = {}): Promise<void> {
        const requested = JSON.parse(JSON.stringify(replacement)) as AIConnectionDeletion;
        return this.withConnectionCredentialTransition(id, () => this.runConnectionTransaction(async () => {
            const previous = this.requireConnections();
            const next = cloneConnectionSettings(previous);
            const connection = this.findConnection(id, next);
            if (next.defaultConnectionId === id) {
                if (!("defaultConnectionId" in requested)) throw new Error("ai_connection:connection_referenced");
                next.defaultConnectionId = requested.defaultConnectionId ?? null;
            }
            for (const purpose of AI_PURPOSES) {
                if (next.bindings[purpose].mode === "connection" && next.bindings[purpose].connectionId === id) {
                    if (!requested.bindings?.[purpose]) throw new Error("ai_connection:connection_referenced");
                    next.bindings[purpose] = requested.bindings[purpose]!;
                }
            }
            next.connections = next.connections.filter(item => item.id !== id);
            if (next.defaultConnectionId) this.findConnection(next.defaultConnectionId, next);
            for (const purpose of AI_PURPOSES) this.validateBinding(next.bindings[purpose], next);
            const write = this.ownsSecret(connection, previous) ? {
                connectionId: id, secretRef: connection.secretRef, value: "", previousValue: this.readSecretForWrite(connection.secretRef),
            } : undefined;
            await this.commitConnections(previous, next, write);
        }));
    }

    migrateLegacyAIConnections(input: { providerId?: string; secretRef?: string; key?: string } = {}): Promise<AIConnectionsSettings> {
        return this.runConnectionTransaction(async () => {
            const existing = this.getAIConnections();
            if (existing !== undefined) {
                this.requireConnections();
                return existing;
            }
            const settings = this.dependencies.getSettings();
            const key = normalizeAPIToken(input.key);
            const names = this.listSecretNames();
            const candidates = this.getAPITokenSecretCandidateIds().filter(id => names.includes(id));
            if (!key && input.secretRef && !this.getAPITokenSecretCandidateIds().includes(input.secretRef)) {
                throw new Error("ai_connection:legacy_secret_invalid");
            }
            if (!key && !input.secretRef && candidates.length > 1) throw new Error("ai_connection:legacy_secret_ambiguous");
            if (!key && candidates.length && !input.providerId) throw new Error("ai_connection:legacy_provider_required");
            const providerId = input.providerId ?? legacyProviderId(settings.baseURL);
            const originalProvider = legacyProviderId(settings.baseURL);
            // A blank address has no custom destination to retain when choosing a service.
            // Otherwise, only correct known official mismatches; preserve custom gateways.
            const correctedProvider = providerId !== originalProvider
                && (originalProvider !== "custom" || !settings.baseURL.trim());
            const defaults = createConnectionDefaults(providerId);
            const next = this.mutableConnections(undefined);
            next.memorySelection.cause = "migration";
            const main: AIConnection = {
                ...defaults,
                id: `legacy-chat-${settings.statisticsVaultId || "default-vault"}`,
                name: getProviderDefinition(providerId)!.name,
                endpoints: correctedProvider ? { ...defaults.endpoints }
                    : { ...defaults.endpoints, chat: settings.baseURL, embedding: settings.baseURL },
                models: correctedProvider ? { ...defaults.models }
                    : { ...defaults.models, chat: settings.chatModelName, policy: settings.policyModelName,
                        embedding: settings.embeddingModelName },
                options: { ...defaults.options, chat: { enableThinking: settings.qwenThinkingEnabled, webSearchEnabled: settings.webSearchEnabled } },
                secretRef: key ? this.allocateSecretRef(providerId, next)
                    : input.secretRef ?? candidates[0] ?? this.getAPITokenSecretId(),
                secretOwned: Boolean(key),
                revision: 0,
            };
            if (providerId.startsWith("dashscope-") && !correctedProvider) {
                main.endpoints.image = settings.baseURL;
                if (settings.imageGenerationConnectionMode === "inherit-chat") {
                    main.models.image = settings.featuredImageModel;
                    main.models.sourceImage = settings.featuredImageModel;
                }
            }
            next.connections.push(main);
            next.defaultConnectionId = main.id;
            if (settings.imageGenerationConnectionMode === "dedicated-wan") {
                const legacyImage = resolveImageGenerationConnection(settings, {
                    chat: this.getAPITokenSecretId(), dedicated: this.getImageAPITokenSecretId(),
                });
                // The existing Wan resolver has already admitted this exact public or workspace destination.
                const tasksHost = new URL(legacyImage.tasksEndpoint).hostname;
                const imageProvider = tasksHost === 'dashscope-intl.aliyuncs.com'
                    || tasksHost.endsWith('.ap-southeast-1.maas.aliyuncs.com') ? 'dashscope-intl' : 'dashscope-cn';
                const image: AIConnection = {
                    ...createConnectionDefaults(imageProvider),
                    id: `legacy-image-${settings.statisticsVaultId || "default-vault"}`,
                    name: this.availableConnectionName(`${getProviderDefinition(imageProvider)!.name} · Images`, next),
                    endpoints: { image: settings.imageGenerationBaseURL },
                    models: { image: settings.featuredImageModel, sourceImage: settings.featuredImageModel },
                    secretRef: this.getImageAPITokenSecretId(), secretOwned: false, revision: settings.imageGenerationConnectionRevision,
                };
                next.connections.push(image);
                next.bindings.image = { mode: "connection", connectionId: image.id };
            }
            await this.commitConnections(undefined, next, key ? {
                connectionId: main.id, secretRef: main.secretRef, value: key, previousValue: null,
            } : undefined, false, true);
            return cloneConnectionSettings(next);
        });
    }

    private findConnection(id: string, settings = this.requireConnections()): AIConnection {
        const connection = settings.connections.find(item => item.id === id);
        if (!connection) throw new Error("ai_connection:connection_missing");
        return connection;
    }

    private requireConnections(): AIConnectionsSettings {
        const settings = this.dependencies.getSettings().aiConnections;
        if (settings?.schemaVersion !== 1 || !Array.isArray(settings.connections) || !settings.bindings || !settings.memorySelection) {
            throw new Error("ai_connection:configuration_invalid");
        }
        return settings;
    }

    private mutableConnections(previous: AIConnectionsSettings | undefined, initialSetup = false): AIConnectionsSettings {
        if (previous !== undefined) {
            this.requireConnections();
            return cloneConnectionSettings(previous);
        }
        return {
            schemaVersion: 1, connections: [], defaultConnectionId: null,
            bindings: { chat: { mode: "inherit" }, embedding: { mode: "inherit" }, image: { mode: "inherit" } },
            memorySelection: { revision: randomConnectionSuffix(24), cause: initialSetup ? "initial-setup" : "configuration-change" },
            migrationVersion: 1,
        };
    }

    private connectionCredentialState(connection: AIConnection): ConnectionCredentialState {
        let state = this.connectionCredentials.get(connection.id);
        if (!state || state.secretRef !== connection.secretRef) {
            state = { secretRef: connection.secretRef, state: "unknown", token: "", revision: (state?.revision ?? -1) + 1,
                transitioning: false, blocked: false };
            this.connectionCredentials.set(connection.id, state);
        }
        return state;
    }

    private listSecretNames(): string[] {
        try {
            const names = this.dependencies.getSecretStorage().listSecrets?.();
            if (!Array.isArray(names)) throw new Error("unavailable");
            return names;
        } catch {
            throw new Error("ai_connection:secret_list_unavailable");
        }
    }

    private allocateSecretRef(providerId: string, settings: AIConnectionsSettings): string {
        const definition = getProviderDefinition(providerId);
        if (!definition) throw new Error("ai_connection:provider_unsupported");
        const occupied = new Set([...this.listSecretNames(), ...settings.connections.map(item => item.secretRef)]);
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const name = `pa-${definition.secretSlug}-${randomConnectionSuffix(10)}`;
            if (name.length <= 64 && !occupied.has(name)) return name;
        }
        throw new Error("ai_connection:secret_name_unavailable");
    }

    private availableConnectionName(name: string, settings: Pick<AIConnectionsSettings, 'connections'>, exceptId?: string): string {
        const names = new Set(settings.connections.filter(item => item.id !== exceptId).map(item => item.name));
        if (!names.has(name)) return name;
        let sequence = 2;
        while (names.has(`${name} ${sequence}`)) sequence += 1;
        return `${name} ${sequence}`;
    }

    private ownsSecret(connection: AIConnection, settings: AIConnectionsSettings): boolean {
        return connection.secretOwned === true && !settings.connections.some(item => item.id !== connection.id && item.secretRef === connection.secretRef);
    }

    private readSecretForWrite(secretRef: string): string | null {
        try { return this.dependencies.getSecretStorage().getSecret(secretRef); }
        catch { throw new Error("ai_connection:secret_read_failed"); }
    }

    private validateBinding(binding: PurposeBinding, settings: AIConnectionsSettings): void {
        if (binding.mode === "connection") this.findConnection(binding.connectionId, settings);
        else if (binding.mode !== "inherit" && binding.mode !== "unconfigured") throw new Error("ai_connection:binding_invalid");
    }

    private runConnectionTransaction<T>(operation: () => Promise<T>): Promise<T> {
        return this.enqueueTransaction(async () => {
            const previous = this.dependencies.getSettings().aiConnections;
            try {
                return await this.dependencies.enqueueSettingsWrite(async () => {
                    if (this.dependencies.isUnloading()) throw new Error("ai_connection:plugin_unloading");
                    return operation();
                });
            } finally {
                // Listeners can themselves enqueue settings work; never await them while holding its queue.
                if (this.dependencies.getSettings().aiConnections !== previous && !this.dependencies.isUnloading()) {
                    await this.settleCredentialTransitionNotification(true);
                }
            }
        });
    }

    private async withConnectionCredentialTransition<T>(id: string, operation: () => Promise<T>): Promise<T> {
        const state = this.connectionCredentialState(this.findConnection(id));
        state.revision += 1;
        state.state = "unknown";
        state.token = "";
        this.pendingConnectionCredentials.set(id, (this.pendingConnectionCredentials.get(id) ?? 0) + 1);
        const chat = this.resolveAIConnection("chat");
        const embedding = this.resolveAIConnection("embedding");
        if (chat.ok && chat.connection.connectionId === id) this.claimTokenMutation();
        if (embedding.ok && embedding.connection.connectionId === id) this.dependencies.cancelActivePreparation();
        try {
            return await operation();
        } finally {
            const remaining = (this.pendingConnectionCredentials.get(id) ?? 1) - 1;
            if (remaining > 0) this.pendingConnectionCredentials.set(id, remaining);
            else this.pendingConnectionCredentials.delete(id);
            await this.settleCredentialTransitionNotification(false);
        }
    }

    private async commitConnections(
        previous: AIConnectionsSettings | undefined,
        next: AIConnectionsSettings,
        write?: ConnectionSecretWrite,
        initialSetup = false,
        migration = false,
    ): Promise<void> {
        const embeddingChanged = embeddingSelectionIdentity(previous) !== embeddingSelectionIdentity(next);
        const chatChanged = purposeSelectionIdentity(previous, "chat") !== purposeSelectionIdentity(next, "chat");
        if (embeddingChanged && !migration) next.memorySelection = {
            revision: randomConnectionSuffix(24), cause: !previous && initialSetup ? "initial-setup" : "configuration-change",
        };
        const changedCredentials = (previous?.connections ?? []).filter(old => {
            const current = next.connections.find(item => item.id === old.id);
            return !current || current.secretRef !== old.secretRef || write?.connectionId === old.id;
        });
        const states = changedCredentials.map(connection => this.connectionCredentialState(connection));
        for (const state of states) { state.revision += 1; state.transitioning = true; state.token = ""; state.state = "unknown"; }
        const oldChat = resolveSavedAIConnection(previous, "chat");
        if (oldChat.ok && !this.pendingConnectionCredentials.has(oldChat.connection.connectionId)
            && changedCredentials.some(item => item.id === oldChat.connection.connectionId)) {
            this.claimTokenMutation();
        }
        const oldEmbedding = resolveSavedAIConnection(previous, "embedding");
        if (embeddingChanged || (oldEmbedding.ok && !this.pendingConnectionCredentials.has(oldEmbedding.connection.connectionId)
            && changedCredentials.some(item => item.id === oldEmbedding.connection.connectionId))) {
            this.dependencies.cancelActivePreparation();
        }
        const storage = this.dependencies.getSecretStorage();
        let secretAttempted = false;
        const before = { ...this.dependencies.getSettings() };
        try {
            if (write) { secretAttempted = true; storage.setSecret(write.secretRef, write.value); }
            await this.dependencies.saveSettingsData({ ...this.dependencies.getSettings(), aiConnections: next });
            this.dependencies.getSettings().aiConnections = next;
            if (chatChanged) this.claimProviderTupleMutation();
        } catch {
            let compensated = true;
            // A rejected write can have reached disk; restore the prior configuration before undoing its key.
            try { await this.dependencies.saveSettingsData(before); } catch { compensated = false; }
            if (compensated && secretAttempted && write) {
                try { storage.setSecret(write.secretRef, write.previousValue ?? ""); } catch { compensated = false; }
            }
            for (const state of states) state.blocked = !compensated;
            throw new Error(compensated ? "ai_connection:settings_save_failed" : "ai_connection:compensation_failed");
        } finally {
            for (const state of states) state.transitioning = false;
        }
        for (const connection of next.connections) {
            const state = this.connectionCredentialState(connection);
            if (changedCredentials.some(item => item.id === connection.id)) state.blocked = false;
            if (write?.connectionId === connection.id) {
                state.state = write.value ? "present" : "missing";
                state.token = write.value;
                state.blocked = false;
            }
        }
    }

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
        return this.credentialTransitionCount > 0 || this.pendingConnectionCredentials.size > 0;
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

    getImageGenerationConnection(connectionId?: string, legacy?: LegacyImageConnectionReference): ImageGenerationConnection | null {
        try {
            const settings = this.dependencies.getSettings();
            if (legacy && settings.aiConnections !== undefined) {
                const oldDedicated = settings.imageGenerationConnectionMode === 'dedicated-wan';
                const expectedId = `legacy-${oldDedicated ? 'image' : 'chat'}-${settings.statisticsVaultId || 'default-vault'}`;
                const oldSlot = oldDedicated ? this.getImageAPITokenSecretId() : this.getAPITokenSecretId();
                const oldEndpoint = (oldDedicated ? settings.imageGenerationBaseURL : settings.baseURL).trim().replace(/\/+$/, '');
                if (legacy.mode !== settings.imageGenerationConnectionMode || legacy.credentialSlot !== oldSlot
                    || legacy.endpointIdentity !== oldEndpoint || legacy.revision !== settings.imageGenerationConnectionRevision) return null;
                const candidates = settings.aiConnections?.connections.filter(item => item.id === expectedId) ?? [];
                if (candidates.length !== 1) return null;
                connectionId = expectedId;
            }
            const connection = resolveImageGenerationConnection(settings, {
                chat: this.getAPITokenSecretId(),
                dedicated: this.getImageAPITokenSecretId(),
            }, connectionId);
            if (legacy && connection.baseURL !== legacy.endpointIdentity) return null;
            if (connection.connectionId) connection.credentialRevision = this.getAIConnectionCredentialRevision(connection.connectionId);
            return connection;
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
        if (this.dependencies.getSettings().aiConnections !== undefined) {
            const resolution = this.resolveAIConnection(scope === "memory" ? "embedding" : "chat");
            const connection = resolution.ok ? resolution.connection : undefined;
            const tokenState = connection ? this.getAIConnectionTokenState(connection.connectionId) : "unknown";
            let issue: AIReadinessIssue | null = null;
            if (!resolution.ok) {
                if (resolution.issue === "provider_unsupported" || resolution.issue === "capability_unsupported") issue = "provider_unsupported";
                else if (resolution.issue === "endpoint_missing") issue = "base_url_missing";
                else if (resolution.issue === "model_missing") issue = scope === "memory" ? "embedding_model_missing" : "chat_model_missing";
                else issue = "provider_missing";
            } else if (tokenState === "unknown") issue = "token_unknown";
            else if (tokenState === "missing") issue = "token_missing";
            return {
                scope, ready: issue === null, issue, tokenState, hasToken: tokenState === "present",
                aiProvider: connection?.providerId ?? "", baseURL: connection?.endpoint ?? "",
                chatModelName: scope === "chat" ? connection?.model ?? "" : "",
                embeddingModelName: scope === "memory" ? connection?.model ?? "" : "",
            };
        }
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

const AI_PURPOSES: readonly AIPurpose[] = ["chat", "embedding", "image"];

function cloneConnectionSettings(settings: AIConnectionsSettings): AIConnectionsSettings {
    return JSON.parse(JSON.stringify(settings)) as AIConnectionsSettings;
}

function cloneConnection(connection: AIConnection): AIConnection {
    return JSON.parse(JSON.stringify(connection)) as AIConnection;
}

function randomConnectionSuffix(length: number): string {
    const crypto = getPlatformCrypto();
    if (!crypto?.getRandomValues) throw new Error("ai_connection:identity_unavailable");
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function legacyProviderId(baseURL: string): string {
    // Editing a legacy model marks the display preset custom without changing its service.
    const normalized = baseURL.trim().replace(/\/+$/, "");
    if (normalized === PROVIDER_PRESETS.openai.baseURL) return "openai";
    if (normalized === PROVIDER_PRESETS.qwen.baseURL) return "dashscope-cn";
    if (normalized === PROVIDER_PRESETS["qwen-intl"].baseURL) return "dashscope-intl";
    return "custom";
}

function connectionRequestIdentity(connection: AIConnection): string {
    return stableConnectionIdentity({ endpoints: connection.endpoints, models: connection.models, options: connection.options });
}

function embeddingSelectionIdentity(settings: AIConnectionsSettings | undefined): string {
    return purposeSelectionIdentity(settings, "embedding");
}

function purposeSelectionIdentity(settings: AIConnectionsSettings | undefined, purpose: AIPurpose): string {
    if (!settings) return "unconfigured";
    const binding = settings.bindings[purpose];
    const id = binding.mode === "connection" ? binding.connectionId : binding.mode === "inherit" ? settings.defaultConnectionId : null;
    const connection = settings.connections.find(item => item.id === id);
    if (!connection) return stableConnectionIdentity({ id, mode: binding.mode });
    return stableConnectionIdentity({
        id: connection.id, provider: connection.providerId, endpoint: connection.endpoints[purpose],
        model: connection.models[purpose],
        ...(purpose === "chat" ? { policy: connection.models.policy, options: connection.options.chat, secretRef: connection.secretRef } : {}),
        ...(purpose === "embedding" ? { dimensions: connection.options.embeddingDimensions } : {}),
    });
}

function stableConnectionIdentity(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableConnectionIdentity).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableConnectionIdentity(item)}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
}
