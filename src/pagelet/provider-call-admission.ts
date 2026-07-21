/* Copyright 2023 edonyzpc */

/**
 * Shared admission for Pagelet provider calls.
 *
 * This module only coordinates provider disclosure, call revalidation, and
 * reservation order. The shared first-use flag is notification state; none of
 * these APIs grant Memory, persistence, vault-write, Markdown, or external
 * action authority.
 */

type MaybePromise<T> = T | PromiseLike<T>;

export type PageletProviderCallRisk = "standard" | "high-risk";

export type PageletHighRiskDecision<TInput> =
    | { action: "run" }
    | { action: "adjust"; input: TInput }
    | { action: "adjust" }
    | { action: "cancel" }
    | { action: "closed" };

export type PageletProviderRevalidationStage = "before-reserve" | "after-reserve";

/** A provisional persisted quota slot owned by the caller's limiter. */
export interface PageletProviderCallReservation {
    commit(): void;
    rollback(): MaybePromise<void>;
}

export type PageletProviderCallExecutionResult<TResult> =
    | {
        status: "invoked";
        risk: PageletProviderCallRisk;
        value: TResult;
    }
    | {
        status: "cancelled";
        action: "adjust" | "cancel" | "closed";
    }
    | {
        status: "blocked";
        stage: PageletProviderRevalidationStage | "reserve";
    };

/**
 * Stops a provider-backed Pagelet flow after an explicit admission outcome
 * without letting model-level retry/fallback logic reinterpret it as a model
 * schema or provider failure.
 */
export class PageletProviderCallControlError extends Error {
    constructor(
        readonly reason: "adjust" | "cancel" | "closed" | "blocked" | "rate-limit",
        message: string,
    ) {
        super(message);
        this.name = "PageletProviderCallControlError";
    }
}

export interface PageletProviderFirstUseCallbacks {
    /** Read the one shared persisted Pagelet first-use notification flag. */
    isFirstUseNotified(): boolean;

    /**
     * Synchronously set the shared flag and schedule its persistence.
     *
     * Synchronous mutation is required so concurrent or re-entrant calls see
     * the claim before they can reach their own provider invocation.
     */
    markFirstUseNotified(): void;

    /** Show the shared, non-blocking standard-envelope notification. */
    showStandardFirstUseNotice(): void;
}

export interface PageletRiskAwareProviderCallOptions<TInput, TResult> {
    input: TInput;

    /** End-to-end review deadline. Aborted work must not reserve or invoke. */
    signal?: AbortSignal;

    /** Re-run after every Adjust decision. */
    classifyRisk(input: TInput): MaybePromise<PageletProviderCallRisk>;

    /**
     * Show the complete per-run high-risk disclosure and return its outcome.
     * The callback owns UI only; it must not reserve cost or invoke a provider.
     */
    requestHighRiskDecision(
        input: TInput,
        signal?: AbortSignal,
    ): MaybePromise<PageletHighRiskDecision<TInput>>;

    /** Revalidate source, boundary, and policy identity around reservation. */
    revalidate(
        input: TInput,
        stage: PageletProviderRevalidationStage,
        signal?: AbortSignal,
    ): MaybePromise<boolean>;

    /** Reserve the run budget. False means that the run remains blocked. */
    reserve(
        input: TInput,
        signal?: AbortSignal,
    ): MaybePromise<boolean | PageletProviderCallReservation>;

    /** The actual provider invocation; admission is immediately before this. */
    invoke(input: TInput, signal?: AbortSignal): MaybePromise<TResult>;
}

/**
 * Coordinates the one shared Pagelet first-use state across provider paths.
 * Use one instance per plugin runtime.
 */
export class PageletProviderCallAdmission {
    private firstUseClaimed = false;
    private firstUseAdmissionInProgress: Promise<void> | null = null;

    constructor(private readonly firstUse: PageletProviderFirstUseCallbacks) {}

    /**
     * Admit a standard-envelope provider call at its actual invocation seam.
     * The caller must invoke the provider immediately after this promise
     * resolves; prefer `executeStandardCall` when wrapping is practical.
     */
    admitStandardCall(): Promise<void> {
        return this.admitFirstUseAtCallSeam({ showStandardNotice: true })
            ?? Promise.resolve();
    }

    /** Admit and immediately execute one standard-envelope provider call. */
    async executeStandardCall<TResult>(
        invoke: () => MaybePromise<TResult>,
        options: {
            revalidate?: () => MaybePromise<boolean>;
            /** Reserve a provisional quota slot after the first validation. */
            reserve?: () => MaybePromise<boolean | PageletProviderCallReservation>;
            signal?: AbortSignal;
        } = {},
    ): Promise<TResult> {
        let reservation: PageletProviderCallReservation | null = null;
        try {
            throwIfPageletProviderCallAborted(options.signal);
            if (options.revalidate) {
                const current = options.revalidate();
                const isCurrent = isPromiseLike(current) ? await current : current;
                throwIfPageletProviderCallAborted(options.signal);
                if (!isCurrent) throw new Error("pagelet_provider_call_stale");
            }
            if (options.reserve) {
                const pending = options.reserve();
                const reserved = isPromiseLike(pending) ? await pending : pending;
                throwIfPageletProviderCallAborted(options.signal);
                if (!reserved) {
                    throw new PageletProviderCallControlError(
                        "rate-limit",
                        "Pagelet provider-call budget exceeded.",
                    );
                }
                reservation = isPageletProviderCallReservation(reserved) ? reserved : null;
                if (options.revalidate) {
                    const current = options.revalidate();
                    const isCurrent = isPromiseLike(current) ? await current : current;
                    throwIfPageletProviderCallAborted(options.signal);
                    if (!isCurrent) throw new Error("pagelet_provider_call_stale");
                }
            }
            // All fallible gates have completed. Keep disclosure/claim and
            // invocation in the same continuation so zero-call work cannot
            // consume shared first-use state.
            throwIfPageletProviderCallAborted(options.signal);
            const admission = this.admitFirstUseAtCallSeam({ showStandardNotice: true });
            if (admission) {
                // Only a synchronously re-entrant call can reach this branch.
                // The outer call owns the shared first-use claim and proceeds
                // to its invocation without another gate.
                await admission;
                throwIfPageletProviderCallAborted(options.signal);
            }
            // No fallible gate or await may appear after first-use admission
            // and before entering the provider invocation.
            reservation?.commit();
            const invocation = invoke();
            return isPromiseLike(invocation) ? await invocation : invocation;
        } catch (error) {
            await reservation?.rollback();
            throw error;
        }
    }

    /**
     * Execute a provider call whose input may be high-risk.
     *
     * High-risk inputs always pass through blocking disclosure, even when the
     * shared first-use flag is already true. Adjust is reclassified. Run is
     * followed by revalidate -> reserve -> revalidate; only then is first-use
     * claimed at the immediately-adjacent provider seam.
     */
    async executeRiskAwareCall<TInput, TResult>(
        options: PageletRiskAwareProviderCallOptions<TInput, TResult>,
    ): Promise<PageletProviderCallExecutionResult<TResult>> {
        let input = options.input;
        throwIfPageletProviderCallAborted(options.signal);
        let risk = await options.classifyRisk(input);
        throwIfPageletProviderCallAborted(options.signal);

        while (risk === "high-risk") {
            const decision = await options.requestHighRiskDecision(input, options.signal);
            throwIfPageletProviderCallAborted(options.signal);
            if (decision.action === "cancel" || decision.action === "closed") {
                return { status: "cancelled", action: decision.action };
            }
            if (decision.action === "adjust") {
                if (!("input" in decision)) {
                    return { status: "cancelled", action: "adjust" };
                }
                input = decision.input;
                risk = await options.classifyRisk(input);
                throwIfPageletProviderCallAborted(options.signal);
                continue;
            }
            break;
        }

        if (!await options.revalidate(input, "before-reserve", options.signal)) {
            return { status: "blocked", stage: "before-reserve" };
        }
        throwIfPageletProviderCallAborted(options.signal);
        const reserved = await options.reserve(input, options.signal);
        const reservation = isPageletProviderCallReservation(reserved) ? reserved : null;
        if (!reserved) {
            return { status: "blocked", stage: "reserve" };
        }
        try {
            throwIfPageletProviderCallAborted(options.signal);
            const finalValidation = options.revalidate(
                input,
                "after-reserve",
                options.signal,
            );
            const finalIsCurrent = isPromiseLike(finalValidation)
                ? await finalValidation
                : finalValidation;
            if (!finalIsCurrent) {
                await reservation?.rollback();
                return { status: "blocked", stage: "after-reserve" };
            }
            throwIfPageletProviderCallAborted(options.signal);

            // All fallible gates have completed. Admission must be immediately
            // adjacent to the actual invocation.
            throwIfPageletProviderCallAborted(options.signal);
            if (risk === "high-risk") {
                // The complete blocking disclosure already covered first-use.
                const admission = this.admitFirstUseAtCallSeam({ showStandardNotice: false });
                if (admission) {
                    await admission;
                    throwIfPageletProviderCallAborted(options.signal);
                }
            } else {
                const admission = this.admitFirstUseAtCallSeam({ showStandardNotice: true });
                if (admission) {
                    await admission;
                    throwIfPageletProviderCallAborted(options.signal);
                }
            }

            // No fallible gate or await may appear after first-use admission
            // and before entering the provider invocation.
            reservation?.commit();
            const invocation = options.invoke(input, options.signal);
            const value = isPromiseLike(invocation) ? await invocation : invocation;
            return { status: "invoked", risk, value };
        } catch (error) {
            await reservation?.rollback();
            throw error;
        }
    }

    private admitFirstUseAtCallSeam(
        options: { showStandardNotice: boolean },
    ): Promise<void> | null {
        if (this.firstUseAdmissionInProgress) return this.firstUseAdmissionInProgress;
        if (this.firstUseClaimed || this.firstUse.isFirstUseNotified()) {
            this.firstUseClaimed = true;
            return null;
        }

        let resolveAdmission!: () => void;
        let rejectAdmission!: (error: unknown) => void;
        const admission = new Promise<void>((resolve, reject) => {
            resolveAdmission = resolve;
            rejectAdmission = reject;
        });
        // A rejection is still observed by any re-entrant caller, while this
        // handler prevents an unhandled rejection when no re-entry occurred.
        void admission.catch(() => undefined);
        this.firstUseAdmissionInProgress = admission;
        try {
            if (options.showStandardNotice) {
                this.firstUse.showStandardFirstUseNotice();
            }
            this.firstUse.markFirstUseNotified();
            this.firstUseClaimed = true;
            resolveAdmission();
            return null;
        } catch (error) {
            rejectAdmission(error);
            throw error;
        } finally {
            this.firstUseAdmissionInProgress = null;
        }
    }
}

function isPromiseLike<T>(value: MaybePromise<T>): value is PromiseLike<T> {
    return typeof value === "object"
        && value !== null
        && typeof (value as PromiseLike<T>).then === "function";
}

function isPageletProviderCallReservation(
    value: boolean | PageletProviderCallReservation,
): value is PageletProviderCallReservation {
    return typeof value === "object"
        && value !== null
        && typeof value.commit === "function"
        && typeof value.rollback === "function";
}

function throwIfPageletProviderCallAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const error = new Error("Pagelet provider call aborted.");
    error.name = "AbortError";
    throw error;
}
