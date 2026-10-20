import type { App } from 'obsidian';
import { getPlatformCrypto } from '../platform-dom';
import type { ReadingSnapshot } from './reading-position';

export const UI_RECOVERY_KEY = 'personal-assistant:ui-recovery:v1';
export interface RecoveryRoute { slotId: string; conversationId: string | null; }
interface StoredSlot extends RecoveryRoute {
    startupRoutePending?: true;
    savedAt: number;
    draft: unknown;
    reading: ReadingSnapshot | null;
}
interface Database { schemaVersion: 1; slots: StoredSlot[]; }
interface VaultOwners {
    slots: Map<string, LocalRecovery<unknown>>;
    deleted: Set<string>;
}
// Only live ownership/deletion facts are shared. Draft bytes stay in the App backend.
const owners = new WeakMap<App, VaultOwners>();
function vaultOwners(app: App): VaultOwners {
    let value = owners.get(app);
    if (!value) { value = { slots: new Map(), deleted: new Set() }; owners.set(app, value); }
    return value;
}
function readDatabase(app: App): Database {
    const value: unknown = app.loadLocalStorage(UI_RECOVERY_KEY);
    if (value == null) return { schemaVersion: 1, slots: [] };
    const data = value as Partial<Database>;
    if (data.schemaVersion !== 1 || !Array.isArray(data.slots)) {
        throw new Error('Invalid UI recovery index');
    }
    // Individual damaged slots do not make unrelated drafts unavailable. Keep
    // their bytes intact unless a new edit explicitly replaces that same slot.
    return { schemaVersion: 1, slots: data.slots };
}
function hasIdentity(slot: StoredSlot | null | undefined): slot is StoredSlot {
    return Boolean(slot && typeof slot.slotId === 'string'
        && (slot.conversationId === null || typeof slot.conversationId === 'string'));
}
function reading(value: unknown): ReadingSnapshot | null {
    if (value == null) return null;
    const item = value as ReadingSnapshot;
    if (typeof item.offset !== 'number' || !Number.isFinite(item.offset)
        || typeof item.fallbackTop !== 'number' || !Number.isFinite(item.fallbackTop)
        || (item.anchorId !== undefined && typeof item.anchorId !== 'string')
        || (item.disclosures !== undefined && (!Array.isArray(item.disclosures)
            || !item.disclosures.every(id => typeof id === 'string')))) throw new Error('Invalid reading position');
    return { offset: item.offset, fallbackTop: item.fallbackTop,
        ...(item.anchorId ? { anchorId: item.anchorId } : {}),
        ...(item.disclosures ? { disclosures: [...item.disclosures] } : {}) };
}

/** The business manager calls this only after a successful delete/prune. */
export function deleteConversationRecovery(app: App, conversationId: string): void {
    const shared = vaultOwners(app);
    shared.deleted.add(conversationId);
    for (const slot of [...shared.slots.values()]) {
        if (slot.route.conversationId === conversationId) slot.invalidateDeleted();
    }
    const data = readDatabase(app);
    const retained = data.slots.filter(slot => !hasIdentity(slot) || slot.conversationId !== conversationId);
    if (retained.length !== data.slots.length) app.saveLocalStorage(UI_RECOVERY_KEY,
        retained.length ? { schemaVersion: 1, slots: retained } : null);
}

/** Persistence projection only: ComposerDraft remains the edit/consume/revision owner. */
export class LocalRecovery<T> {
    readonly route: RecoveryRoute;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
    private closed = false;
    private protectedRecord = false;
    private draft: T | undefined;
    private lastReading: ReadingSnapshot | null = null;
    private pendingRoute: boolean;
    private storedRoute: RecoveryRoute | null = null;
    private readonly shared: VaultOwners;

    constructor(private readonly options: {
        app: App;
        route: { slotId?: string; conversationId: string | null };
        fresh?: boolean;
        startupRoutePending?: boolean;
        decode: (value: unknown) => T;
        isEmpty: (draft: T) => boolean;
        onFailure: (error: unknown) => void;
        onSaved?: (workspaceRouteChanged: boolean) => void;
        onDeleted: () => void;
    }) {
        this.shared = vaultOwners(options.app);
        let data: Database = { schemaVersion: 1, slots: [] };
        try { data = readDatabase(options.app); }
        catch (error) { this.protectedRecord = true; options.onFailure(error); }
        const requested = options.route.slotId;
        const matching = !options.fresh ? data.slots.filter(hasIdentity).filter(slot =>
            slot.conversationId === options.route.conversationId && !this.shared.slots.has(slot.slotId)
            && (!requested || slot.slotId === requested)
            && (options.startupRoutePending ? slot.startupRoutePending === true
                : Boolean(requested) || !slot.startupRoutePending)).reverse().sort((a, b) =>
                (Number.isFinite(b.savedAt) ? b.savedAt : 0) - (Number.isFinite(a.savedAt) ? a.savedAt : 0))[0] : undefined;
        // Slots are appended on each save; reverse preserves last-save order
        // when rapid handoff/close writes share the same millisecond.
        // A duplicated workspace route gets a new slot; it must not clone another open draft.
        const conflictingRoute = data.slots.some(slot => hasIdentity(slot) && slot.slotId === requested
            && slot.conversationId !== options.route.conversationId);
        const slotId = requested && !conflictingRoute && !this.shared.slots.has(requested) ? requested
            : matching?.slotId ?? getPlatformCrypto()?.randomUUID()
                ?? `pa-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.route = { slotId, conversationId: options.route.conversationId };
        this.pendingRoute = options.startupRoutePending === true || matching?.startupRoutePending === true;
        this.shared.slots.set(slotId, this as LocalRecovery<unknown>);
        if (matching && matching.slotId === slotId) {
            try {
                if (typeof matching.savedAt !== 'number' || !Number.isFinite(matching.savedAt)) throw new Error('Invalid recovery timestamp');
                if (matching.startupRoutePending !== undefined && (matching.startupRoutePending !== true
                    || matching.conversationId !== null)) throw new Error('Invalid pending recovery route');
                this.draft = options.decode(matching.draft);
                this.lastReading = reading(matching.reading);
                this.storedRoute = { ...this.route };
            }
            catch (error) { this.protectedRecord = true; options.onFailure(error); }
        }
    }

    restored(): { draft: T; reading: ReadingSnapshot | null } | null {
        return !this.closed && !this.protectedRecord && this.draft !== undefined
            ? { draft: this.draft, reading: this.lastReading } : null;
    }

    get startupRoutePending(): boolean { return this.pendingRoute; }
    get workspaceRoute(): RecoveryRoute | null {
        // Business identity updates immediately. Workspace must still address the
        // last recoverable record until its new association is successfully saved.
        const route = this.storedRoute ?? (this.pendingRoute ? null : this.route);
        return route ? { ...route } : null;
    }

    bindConversation(conversationId: string | null): void {
        if (this.closed || (this.route.conversationId === conversationId && !this.pendingRoute)) return;
        const wasPending = this.pendingRoute;
        this.route.conversationId = conversationId;
        this.pendingRoute = false;
        if (this.draft !== undefined && !this.protectedRecord) {
            this.schedule();
            // Persist the resolved identity before workspace publishes this route.
            if (wasPending) this.flush();
        }
    }

    edit(draft: T, consume = false): void {
        if (this.closed) return;
        this.draft = draft;
        this.protectedRecord = false;
        this.schedule();
        if (consume) this.flush();
    }

    setReading(snapshot: ReadingSnapshot): void {
        if (this.closed || this.protectedRecord || this.draft === undefined) return;
        const previous = this.lastReading;
        if (previous && previous.anchorId === snapshot.anchorId && previous.offset === snapshot.offset
            && previous.fallbackTop === snapshot.fallbackTop
            && (previous.disclosures ?? []).join('\n') === (snapshot.disclosures ?? []).join('\n')) return;
        this.lastReading = reading(snapshot);
        this.schedule();
    }

    /** Seed a genuinely empty new slot without authorizing replacement of unread/corrupt bytes. */
    initializeEmpty(draft: T): void {
        if (!this.protectedRecord && this.draft === undefined) this.draft = draft;
    }

    flush(): boolean {
        this.cancelTimer();
        if (this.closed || !this.dirty || this.protectedRecord || this.draft === undefined) return false;
        if (this.route.conversationId && this.shared.deleted.has(this.route.conversationId)) return false;
        try {
            const previousWorkspaceRoute = this.workspaceRoute;
            const data = readDatabase(this.options.app);
            const retained = data.slots.filter(slot => !hasIdentity(slot) || (slot.slotId !== this.route.slotId
                && (!slot.conversationId || !this.shared.deleted.has(slot.conversationId))));
            // A blank new Chat at the top has no reading context to recover.
            const hasReadingContext = this.lastReading !== null
                && (this.route.conversationId !== null || Boolean(this.lastReading.anchorId)
                    || this.lastReading.fallbackTop > 0 || Boolean(this.lastReading.disclosures?.length));
            const retainRecord = !this.options.isEmpty(this.draft) || hasReadingContext;
            if (retainRecord) retained.push({
                ...this.route, draft: this.draft, reading: this.lastReading, savedAt: Date.now(),
                ...(this.pendingRoute ? { startupRoutePending: true } : {}),
            });
            this.options.app.saveLocalStorage(UI_RECOVERY_KEY,
                retained.length ? { schemaVersion: 1, slots: retained } : null);
            this.dirty = false;
            this.storedRoute = retainRecord ? { ...this.route } : null;
            const nextWorkspaceRoute = this.workspaceRoute;
            const workspaceRouteChanged = previousWorkspaceRoute?.slotId !== nextWorkspaceRoute?.slotId
                || previousWorkspaceRoute?.conversationId !== nextWorkspaceRoute?.conversationId;
            this.options.onSaved?.(workspaceRouteChanged);
            return true;
        } catch (error) { this.options.onFailure(error); return false; }
    }

    close(): void {
        if (this.closed) return;
        this.flush();
        this.closed = true;
        this.cancelTimer();
        if (this.shared.slots.get(this.route.slotId) === this) this.shared.slots.delete(this.route.slotId);
    }

    invalidateDeleted(): void {
        if (this.closed) return;
        this.closed = true;
        this.cancelTimer();
        this.shared.slots.delete(this.route.slotId);
        this.options.onDeleted();
    }

    private schedule(): void {
        this.dirty = true;
        this.cancelTimer();
        this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
    }
    private cancelTimer(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }
}
