/* Copyright 2023 edonyzpc */

/**
 * Pagelet — call-rate gating.
 *
 * Spec source:
 *  - `docs/archive/review-assistant-sdd.md` §7.2 (Call counting)
 *  - `docs/archive/review-assistant-decisions.md` D019 / D020 / D021
 *
 * Window strategy (per SDD §7.2 reference impl):
 *  - Hourly cap: **sliding 1-hour window**. We keep timestamps of recent
 *    calls and evict any older than 1h on each check. Sliding is preferred
 *    to a tumbling window because the latter has a "double-burst at the
 *    boundary" pathology (10 calls at 11:59, then 10 more at 12:01 — both
 *    legal under tumbling, but the user just made 20 calls in 2 minutes).
 *  - Daily cap: **fixed local-midnight window**. We carry a `dailyResetAt`
 *    timestamp; when `now >= dailyResetAt` we zero the counter and roll
 *    `dailyResetAt` to the next midnight. Daily windows match user
 *    intuition ("how many reviews today") far better than a sliding
 *    24-hour window would, and the implementation is simpler.
 *
 * Persistence:
 *  - Pluggable `PageletRateLimitStorage` interface. The Track C wiring is
 *    expected to inject the Obsidian-plugin `loadData`/`saveData` adapter;
 *    the in-memory implementation here is for tests AND for graceful
 *    degradation when storage is somehow unavailable.
 *  - We DELIBERATELY do not store the rate-limit state inside settings
 *    (D020 — limits are fixed, not user-tunable, so they don't deserve a
 *    Settings entry; the counter is operational state, not configuration).
 *
 * Cross-module ownership: the orchestrator (`pa-review-model.ts`) decides
 * WHEN to call `reserve()` / `peek()`; this module only enforces. That
 * separation lets the Track C runtime gate at a different layer (e.g.
 * inside a deeper-review loop where each LLM hop should count separately)
 * without rewriting the gate.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Persisted state shape. Numbers are wall-clock ms (UTC). The two windows
 * use different storage strategies on purpose — see file-header rationale.
 *
 * `hourlyTimestamps` is bounded (the eviction loop in `prune` keeps it that
 * way) so the serialised form stays small even after months of use.
 */
export interface PageletRateLimitState {
    /** Ms-since-epoch timestamps of recent calls; older than 1h get evicted. */
    hourlyTimestamps: number[];
    /** Count of calls in the current daily window. */
    dailyCount: number;
    /** Wall-clock ms when the daily counter rolls over to 0. */
    dailyResetAt: number;
}

/**
 * The check result. `resumeAt` is the wall-clock time at which the user
 * will regain at least one slot — UI can render a human-friendly "available
 * in 17 min" instead of a generic "limit reached".
 */
export type RateLimitDecision =
    | { ok: true }
    | { ok: false; reason: "hr-cap" | "day-cap"; resumeAt: number };

/**
 * Storage seam. Implementations may be synchronous (in-memory test storage)
 * or asynchronous (Obsidian's plugin.data API). The limiter awaits both
 * uniformly via `Promise.resolve()` so the API is the same either way.
 *
 * Callers may legitimately return `null` from `load()` on a fresh install —
 * the limiter then constructs a default state (no recent calls, daily
 * counter at 0, daily reset at next local midnight).
 */
export interface PageletRateLimitStorage {
    load(): Promise<PageletRateLimitState | null> | PageletRateLimitState | null;
    save(state: PageletRateLimitState): Promise<void> | void;
}

export interface PageletRateLimitConfig {
    /** Hourly cap. Defaults to PAGELET_FIXED_CALL_LIMITS.hourly (D020 = 10). */
    hourlyCap?: number;
    /** Daily cap. Defaults to PAGELET_FIXED_CALL_LIMITS.daily (D020 = 100). */
    dailyCap?: number;
}

export interface PageletRateLimiterOptions {
    /** Persistence. If absent, an in-memory storage is created so the limiter still works (but resets on plugin reload). */
    storage?: PageletRateLimitStorage;
    config?: PageletRateLimitConfig;
    /** Injectable clock for tests; defaults to `Date.now`. */
    now?: () => number;
    /**
     * Local-midnight calculator. Default rolls midnight in the runtime's
     * local timezone, matching user intuition ("today" means MY today).
     * Tests override this to drive the daily window deterministically.
     */
    nextLocalMidnight?: (now: number) => number;
    /**
     * Stable identity for writers that share one persisted bucket. When set,
     * reservations are serialized through a process-global tail so a plugin
     * hot reload cannot let the old and new instances oversubscribe the cap.
     */
    coordinationKey?: string;
}

// ---------------------------------------------------------------------------
// Default caps mirror D020 — duplicated as a soft default rather than imported
// from `src/settings/pagelet` because the settings module is owned by B3 and
// its frozen constant is the source-of-truth. We re-state the numbers here
// (with a test that asserts they match) so we don't take a hard import dep
// just for two numbers.
// ---------------------------------------------------------------------------

export const PAGELET_RATE_LIMIT_DEFAULTS = Object.freeze({
    hourly: 10,
    daily: 100,
    hourMs: 60 * 60 * 1000,
});

// ---------------------------------------------------------------------------
// In-memory storage (test + fallback)
// ---------------------------------------------------------------------------

/**
 * Default storage. Backs the limiter when the caller hasn't wired plugin
 * persistence yet, AND serves as the test double for unit specs.
 *
 * Returned states are deep-cloned to prevent the limiter's internal
 * mutations from leaking back into the storage view — the real plugin
 * storage serialises through JSON, so this clone preserves that semantics.
 */
export class InMemoryRateLimitStorage implements PageletRateLimitStorage {
    private state: PageletRateLimitState | null = null;
    public loadCalls = 0;
    public saveCalls = 0;

    constructor(initial?: PageletRateLimitState) {
        if (initial) this.state = cloneState(initial);
    }

    load(): PageletRateLimitState | null {
        this.loadCalls += 1;
        return this.state ? cloneState(this.state) : null;
    }

    save(state: PageletRateLimitState): void {
        this.saveCalls += 1;
        this.state = cloneState(state);
    }

    /** Test-only inspection helper — peek at the persisted snapshot. */
    peek(): PageletRateLimitState | null {
        return this.state ? cloneState(this.state) : null;
    }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

/**
 * The gate. One instance per Pagelet session, constructed by the Track C
 * runtime adapter and passed into `reviewNote()` via options. The class is
 * intentionally stateful — load-state is cached after the first call to
 * avoid a round-trip per LLM call.
 */
export class PageletRateLimiter {
    private readonly storage: PageletRateLimitStorage;
    private readonly hourlyCap: number;
    private readonly dailyCap: number;
    private readonly now: () => number;
    private readonly nextLocalMidnight: (now: number) => number;
    private readonly coordinationKey: string | null;
    /**
     * Cached, possibly stale view of storage. Updated on every `prune()` call
     * (which is invoked by every public method). We tolerate the staleness
     * because the limiter is the sole writer; the cache only goes out of date
     * if another process touches storage, which never happens in production.
     */
    private cached: PageletRateLimitState | null = null;
    private cacheLoaded = false;
    /** Serialize check-and-save so concurrent feature calls cannot oversubscribe a hard cap. */
    private reserveTail: Promise<void> = Promise.resolve();

    constructor(options: PageletRateLimiterOptions = {}) {
        this.storage = options.storage ?? new InMemoryRateLimitStorage();
        this.hourlyCap = options.config?.hourlyCap ?? PAGELET_RATE_LIMIT_DEFAULTS.hourly;
        this.dailyCap = options.config?.dailyCap ?? PAGELET_RATE_LIMIT_DEFAULTS.daily;
        this.now = options.now ?? Date.now;
        this.nextLocalMidnight = options.nextLocalMidnight ?? defaultNextLocalMidnight;
        this.coordinationKey = options.coordinationKey?.trim() || null;
    }

    /**
     * Non-committing check. Returns whether the next call WOULD be allowed.
     * Use this when you need to surface "is the gate open?" without
     * incrementing the counter (e.g. command or UI disabled state in B5).
     */
    async peek(): Promise<RateLimitDecision> {
        const state = await this.loadAndPrune();
        return decide(state, this.hourlyCap, this.dailyCap, this.now());
    }

    /**
     * Check + commit. Mirrors SDD §7.2's `reserve()` — atomic at the limiter
     * level: if the call would exceed a cap, no slot is consumed; otherwise
     * the slot is committed AND persisted before the function returns.
     *
     * This is the API that `pa-review-model.ts` should call before every
     * LLM invocation. If the orchestrator wants to gate at a finer
     * granularity (e.g. counting each retry as a separate call), it does
     * so by calling `reserve()` more than once per `reviewNote()`.
     */
    reserve(): Promise<RateLimitDecision> {
        if (this.coordinationKey) {
            const tails = getSharedReserveTails();
            const previous = tails.get(this.coordinationKey) ?? Promise.resolve();
            const operation = previous.then(() => {
                // A previous plugin instance may have committed while this
                // instance was waiting. Reload inside the shared critical
                // section before every check-and-save.
                this.invalidate();
                return this.reserveOnce();
            });
            const tail = operation.then(
                () => undefined,
                () => undefined,
            );
            tails.set(this.coordinationKey, tail);
            void tail.then(() => {
                if (tails.get(this.coordinationKey!) === tail) {
                    tails.delete(this.coordinationKey!);
                }
            });
            return operation;
        }
        const operation = this.reserveTail.then(() => this.reserveOnce());
        this.reserveTail = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    private async reserveOnce(): Promise<RateLimitDecision> {
        const state = await this.loadAndPrune();
        const now = this.now();
        const decision = decide(state, this.hourlyCap, this.dailyCap, now);
        if (!decision.ok) return decision;
        state.hourlyTimestamps.push(now);
        state.dailyCount += 1;
        this.cached = state;
        await Promise.resolve(this.storage.save(cloneState(state)));
        return decision;
    }

    /**
     * Snapshot of the current state. Useful for tests and for the future
     * "Today's cost" UI badge (D022) — which is a different concept from
     * "Today's call count" but happens to share the same daily window.
     */
    async getStateSnapshot(): Promise<PageletRateLimitState> {
        const state = await this.loadAndPrune();
        return cloneState(state);
    }

    /**
     * Forget the cached state and reload on the next call. Used after the
     * caller knows storage has been mutated externally (e.g. settings
     * "reset usage" → B5 will invoke this).
     */
    invalidate(): void {
        this.cached = null;
        this.cacheLoaded = false;
    }

    // ----- internals -------------------------------------------------------

    private async loadAndPrune(): Promise<PageletRateLimitState> {
        if (!this.cacheLoaded) {
            const loaded = await Promise.resolve(this.storage.load());
            this.cached = loaded ? sanitizeState(loaded, this.now, this.nextLocalMidnight) : null;
            this.cacheLoaded = true;
        }
        if (!this.cached) {
            this.cached = freshState(this.now(), this.nextLocalMidnight);
        }
        prune(this.cached, this.now(), this.nextLocalMidnight);
        return this.cached;
    }
}

const SHARED_RESERVE_TAILS_KEY = "__personalAssistantPageletRateLimitReserveTailsV1";

function getSharedReserveTails(): Map<string, Promise<void>> {
    const processGlobal = globalThis as typeof globalThis & {
        [SHARED_RESERVE_TAILS_KEY]?: Map<string, Promise<void>>;
    };
    processGlobal[SHARED_RESERVE_TAILS_KEY] ??= new Map<string, Promise<void>>();
    return processGlobal[SHARED_RESERVE_TAILS_KEY];
}

// ---------------------------------------------------------------------------
// Pure helpers (testable in isolation)
// ---------------------------------------------------------------------------

function freshState(now: number, midnight: (now: number) => number): PageletRateLimitState {
    return {
        hourlyTimestamps: [],
        dailyCount: 0,
        dailyResetAt: midnight(now),
    };
}

function sanitizeState(
    raw: PageletRateLimitState,
    now: () => number,
    midnight: (now: number) => number,
): PageletRateLimitState {
    // Pull each field through a defensive cast — storage in production is JSON,
    // and a malformed data.json from an earlier build shouldn't crash startup.
    const t = Array.isArray(raw.hourlyTimestamps)
        ? raw.hourlyTimestamps.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
        : [];
    const count = typeof raw.dailyCount === "number" && raw.dailyCount >= 0
        ? Math.floor(raw.dailyCount)
        : 0;
    const resetAt = typeof raw.dailyResetAt === "number" && Number.isFinite(raw.dailyResetAt)
        ? raw.dailyResetAt
        : midnight(now());
    return { hourlyTimestamps: t, dailyCount: count, dailyResetAt: resetAt };
}

/**
 * Mutate `state` in place to reflect the passage of time:
 *   - drop hourly timestamps older than 1h
 *   - if the daily window has elapsed, zero the count and roll the reset
 *
 * Pure-but-mutating is the right shape here: the limiter calls this before
 * every read or write, and we want one in-place pass rather than re-allocating
 * the timestamp array each call.
 */
export function prune(
    state: PageletRateLimitState,
    now: number,
    midnight: (now: number) => number = defaultNextLocalMidnight,
): void {
    const cutoff = now - PAGELET_RATE_LIMIT_DEFAULTS.hourMs;
    if (state.hourlyTimestamps.length > 0) {
        // In-place filter so the array reference stays stable for the storage
        // cache (which compares by ref for "dirty?" detection in future).
        let write = 0;
        for (let read = 0; read < state.hourlyTimestamps.length; read++) {
            const t = state.hourlyTimestamps[read];
            if (t > cutoff) {
                state.hourlyTimestamps[write] = t;
                write += 1;
            }
        }
        state.hourlyTimestamps.length = write;
    }
    if (now >= state.dailyResetAt) {
        state.dailyCount = 0;
        state.dailyResetAt = midnight(now);
    }
}

/**
 * Pure decision step — given a pruned state, decide ok / hr-cap / day-cap.
 * Exposed so unit tests can target it directly without round-tripping
 * through async storage.
 */
export function decide(
    state: PageletRateLimitState,
    hourlyCap: number,
    dailyCap: number,
    now: number,
): RateLimitDecision {
    if (state.hourlyTimestamps.length >= hourlyCap) {
        // Resume when the OLDEST in-window call falls out — that's when we
        // gain one slot back. Adding 1ms keeps the comparison strict.
        const oldest = state.hourlyTimestamps[0];
        return {
            ok: false,
            reason: "hr-cap",
            resumeAt: oldest + PAGELET_RATE_LIMIT_DEFAULTS.hourMs + 1,
        };
    }
    if (state.dailyCount >= dailyCap) {
        return {
            ok: false,
            reason: "day-cap",
            resumeAt: state.dailyResetAt,
        };
    }
    void now; // currently unused but kept in signature for future per-call window logic
    return { ok: true };
}

function cloneState(state: PageletRateLimitState): PageletRateLimitState {
    return {
        hourlyTimestamps: [...state.hourlyTimestamps],
        dailyCount: state.dailyCount,
        dailyResetAt: state.dailyResetAt,
    };
}

/**
 * Default: start-of-next-local-midnight (local meaning whatever the runtime
 * thinks "today" is). We use `new Date(...)` arithmetic because JS doesn't
 * expose UTC-offset helpers; the resulting `dailyResetAt` is local-midnight
 * cast to a UTC ms timestamp.
 */
function defaultNextLocalMidnight(now: number): number {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
}
