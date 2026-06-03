/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — debounce + idempotency (Track B · B5 / R2).
 *
 * Spec source: `docs/review-assistant-sdd.md` §6.1 R2.
 *
 * Two concerns, one module — because in practice they're inseparable:
 *  1. **Debounce** (300ms per SDD) — rapid same-key triggers (user
 *     mashes the command palette, plugin hotkey held down, file-open
 *     event burst on workspace re-layout) must coalesce into ONE
 *     real review. Without this we burn cost-gate budget on duplicates.
 *  2. **Idempotency cache** (~30s TTL) — when the user re-fires Pagelet
 *     on the same `{notePath, contentHash}` while the previous run is
 *     still in-flight OR completed recently, return the cached result
 *     instead of re-spending tokens. The TTL is short on purpose:
 *     long enough to catch "I clicked twice", short enough that a
 *     genuine edit cycle (which mutates contentHash) is never
 *     suppressed.
 *
 * Why module-local in-memory state:
 *  - Persistence would create cross-session caching, which would
 *    confuse users who expect "open the note tomorrow → get a fresh
 *    review". The task brief explicitly says do NOT persist.
 *  - One coalescer instance per `PageletReviewRuntime` (a 1:1
 *    relationship). Track C wires the instance into the host.
 *
 * Design choices:
 *  - `contentHash` (NOT just `notePath`) is part of the key so a real
 *    edit invalidates the cache automatically — no manual eviction
 *    needed on file changes.
 *  - The cache stores `{ promise }` not `{ value }` so callers always
 *    receive a Promise (uniform shape) and we can return the same
 *    in-flight promise to N concurrent callers.
 *  - `now` is injected so tests don't have to use `jest.useFakeTimers`
 *    for every assertion. Production gets `Date.now`.
 *  - Errors are NOT cached. A failed run is treated as if it never
 *    happened — the next call retries. This matches the "Pagelet
 *    review failed, please try again" UX (see SDD §4.3).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The key identifying a logical Pagelet review request. */
export interface PageletReviewKey {
    /** Vault-relative path of the note under review. */
    notePath: string;
    /**
     * Stable hash of the note's content at request time. Caller can
     * supply any string; we treat it opaquely. Practical choices:
     *   - sha1/sha256 of body
     *   - first 8 chars of a hash + length suffix
     *   - mtime-based hash for cheap "did file change" tests
     */
    contentHash: string;
}

export interface PageletCoalescerOptions {
    /**
     * Debounce window in ms. Defaults to 300 per SDD §6.1 R2. Set to
     * `0` to disable debouncing entirely (still keeps idempotency).
     */
    debounceMs?: number;
    /**
     * How long a completed result stays cached. Defaults to 30_000ms
     * per B5 task brief. Set to `0` to disable post-completion caching.
     */
    ttlMs?: number;
    /** Monotonic clock seam. Defaults to `Date.now`. */
    now?: () => number;
    /**
     * setTimeout seam. Defaults to the global. Used by tests that want
     * synchronous control over the debounce window.
     */
    setTimer?: (cb: () => void, ms: number) => unknown;
    /** clearTimeout seam. Must accept whatever `setTimer` returned. */
    clearTimer?: (handle: unknown) => void;
}

/**
 * Snapshot returned by `peek` for inspection in tests / debug UI.
 * NOT for runtime branching — `request` is the only correct API.
 */
export interface PageletCoalescerEntrySnapshot<T> {
    state: "scheduled" | "running" | "completed";
    /** Wall-clock ms when the entry first became scheduled. */
    scheduledAt: number;
    /** Wall-clock ms when the runner finished, or `null` if not yet. */
    completedAt: number | null;
    /** Result of the last completed run, or `null` if not finished. */
    value: T | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * SDD §6.1 R2 default. Exposed so callers / tests can compare against
 * "what does Pagelet think the spec says" without re-deriving it.
 */
export const PAGELET_DEFAULT_DEBOUNCE_MS = 300 as const;

/**
 * B5 brief default. Long enough to catch "user clicked twice", short
 * enough that a genuine edit cycle (which mutates contentHash) is
 * never suppressed.
 */
export const PAGELET_DEFAULT_IDEMPOTENCY_TTL_MS = 30_000 as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface ScheduledEntry<T> {
    state: "scheduled";
    scheduledAt: number;
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
    timer: unknown;
    runner: () => Promise<T>;
}

interface RunningEntry<T> {
    state: "running";
    scheduledAt: number;
    promise: Promise<T>;
}

interface CompletedEntry<T> {
    state: "completed";
    scheduledAt: number;
    completedAt: number;
    value: T;
    promise: Promise<T>;
}

type Entry<T> = ScheduledEntry<T> | RunningEntry<T> | CompletedEntry<T>;

/**
 * Per-key debounce + result cache for Pagelet review calls.
 *
 * Lifecycle of a single key:
 *
 *   request → no entry            → schedule (set timer)
 *           → entry "scheduled"    → return existing promise (coalesce)
 *           → entry "running"      → return existing promise (in-flight dedup)
 *           → entry "completed"
 *               within TTL         → return cached promise
 *               beyond TTL         → fresh schedule (replace entry)
 *
 *   timer fires (on a "scheduled" entry):
 *       state → "running"
 *       invoke runner
 *           on success → state → "completed", store value
 *           on failure → delete entry, reject promise
 */
export class PageletReviewCoalescer<T> {
    private readonly debounceMs: number;
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly setTimer: (cb: () => void, ms: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;
    private readonly entries = new Map<string, Entry<T>>();

    constructor(options: PageletCoalescerOptions = {}) {
        this.debounceMs = options.debounceMs ?? PAGELET_DEFAULT_DEBOUNCE_MS;
        this.ttlMs = options.ttlMs ?? PAGELET_DEFAULT_IDEMPOTENCY_TTL_MS;
        this.now = options.now ?? (() => Date.now());
        // Bind to a safe wrapper so tests can pass `setTimeout` without a
        // `this` confusion. The default casts to the synchronous-callback
        // 2-arg shape and returns the timer handle opaquely.
        this.setTimer = options.setTimer
            ?? ((cb, ms) => setTimeout(cb, ms) as unknown);
        this.clearTimer = options.clearTimer
            ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    }

    /**
     * Request a review with debounce + idempotency. Always returns a
     * Promise — same one for coalesced / cached calls.
     */
    request(key: PageletReviewKey, runner: () => Promise<T>): Promise<T> {
        const cacheKey = keyToString(key);
        const existing = this.entries.get(cacheKey);
        if (existing) {
            if (existing.state === "scheduled" || existing.state === "running") {
                // Both share the same promise we created on first schedule.
                return existing.promise;
            }
            // Completed: check TTL.
            if (this.now() - existing.completedAt <= this.ttlMs) {
                return existing.promise;
            }
            // Expired — drop and fall through to fresh schedule.
            this.entries.delete(cacheKey);
        }
        return this.schedule(cacheKey, runner);
    }

    /**
     * Drop every cached / in-flight entry. In-flight runners still
     * complete (we can't actually cancel them), but their results are
     * no longer cached. Use sparingly — designed for "user toggled
     * Pagelet off" cleanup, not as a general invalidation tool.
     */
    clear(): void {
        for (const entry of this.entries.values()) {
            if (entry.state === "scheduled") {
                this.clearTimer(entry.timer);
                // Reject so callers waiting on this entry observe a
                // cancellation rather than hanging forever.
                entry.reject(new PageletCoalescerClearedError());
            }
        }
        this.entries.clear();
    }

    /**
     * Inspect an entry without mutating state. Returns `null` when no
     * entry exists for the key. Use for testing / diagnostics only.
     */
    peek(key: PageletReviewKey): PageletCoalescerEntrySnapshot<T> | null {
        const entry = this.entries.get(keyToString(key));
        if (!entry) return null;
        return {
            state: entry.state,
            scheduledAt: entry.scheduledAt,
            completedAt: entry.state === "completed" ? entry.completedAt : null,
            value: entry.state === "completed" ? entry.value : null,
        };
    }

    /** Number of tracked entries (across all states). For tests / debug. */
    size(): number {
        return this.entries.size;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private schedule(cacheKey: string, runner: () => Promise<T>): Promise<T> {
        let resolveFn!: (value: T) => void;
        let rejectFn!: (err: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolveFn = res;
            rejectFn = rej;
        });

        const scheduledAt = this.now();
        const timer = this.setTimer(() => this.runScheduled(cacheKey), this.debounceMs);

        const entry: ScheduledEntry<T> = {
            state: "scheduled",
            scheduledAt,
            promise,
            resolve: resolveFn,
            reject: rejectFn,
            timer,
            runner,
        };
        this.entries.set(cacheKey, entry);
        return promise;
    }

    private runScheduled(cacheKey: string): void {
        const entry = this.entries.get(cacheKey);
        if (!entry || entry.state !== "scheduled") {
            // Either cleared mid-flight or replaced — nothing to do.
            return;
        }
        // Transition: scheduled → running. Hold onto the resolvers from
        // the scheduled entry so we can fulfill the original promise.
        const { promise, resolve, reject, runner, scheduledAt } = entry;
        const runningEntry: RunningEntry<T> = {
            state: "running",
            scheduledAt,
            promise,
        };
        this.entries.set(cacheKey, runningEntry);

        // Fire the runner. The Promise chain handles success / failure.
        runner().then(
            (value) => {
                // We may have been cleared / replaced while running.
                const current = this.entries.get(cacheKey);
                if (current === runningEntry) {
                    this.entries.set(cacheKey, {
                        state: "completed",
                        scheduledAt,
                        completedAt: this.now(),
                        value,
                        promise,
                    });
                }
                resolve(value);
            },
            (err) => {
                const current = this.entries.get(cacheKey);
                if (current === runningEntry) {
                    // Drop the entry so the next call starts fresh.
                    this.entries.delete(cacheKey);
                }
                reject(err);
            },
        );
    }
}

// ---------------------------------------------------------------------------
// Helpers / error types
// ---------------------------------------------------------------------------

function keyToString(key: PageletReviewKey): string {
    // `|` is forbidden in vault paths (Obsidian normalizes it out), so
    // this is collision-safe without escaping. The contentHash is
    // caller-supplied opaque — a hash, not a path, so it should never
    // contain `|` in practice either.
    return `${key.notePath}|${key.contentHash}`;
}

/**
 * Raised when a caller's pending request is dropped by `clear()`.
 * Distinct from a runner failure so callers can distinguish
 * "Pagelet was disabled mid-flight" from "model returned an error".
 */
export class PageletCoalescerClearedError extends Error {
    constructor() {
        super("Pagelet review request was cleared before completion");
        this.name = "PageletCoalescerClearedError";
    }
}
