import {
    PageletProviderCallAdmission,
    type PageletHighRiskDecision,
    type PageletProviderCallReservation,
    type PageletProviderCallRisk,
    type PageletProviderRevalidationStage,
} from "../src/pagelet/provider-call-admission";

function makeAdmission(options?: {
    notified?: boolean;
    order?: string[];
    onNotice?: () => void;
}) {
    let notified = options?.notified ?? false;
    const order = options?.order ?? [];
    const notice = jest.fn(() => {
        order.push("notice");
        options?.onNotice?.();
    });
    const mark = jest.fn(() => {
        order.push("mark");
        notified = true;
    });
    const admission = new PageletProviderCallAdmission({
        isFirstUseNotified: () => notified,
        markFirstUseNotified: mark,
        showStandardFirstUseNotice: notice,
    });
    return {
        admission,
        notice,
        mark,
        order,
        isNotified: () => notified,
    };
}

function makeRiskAwareOptions<TInput extends { risk: PageletProviderCallRisk }>(options: {
    input: TInput;
    order: string[];
    decisions: Array<PageletHighRiskDecision<TInput>>;
    invoke?: (input: TInput) => Promise<string> | string;
}) {
    return {
        input: options.input,
        classifyRisk: jest.fn((input: TInput) => {
            options.order.push(`classify:${input.risk}`);
            return input.risk;
        }),
        requestHighRiskDecision: jest.fn(async () => {
            options.order.push("disclose");
            const decision = options.decisions.shift();
            if (!decision) throw new Error("missing test decision");
            return decision;
        }),
        revalidate: jest.fn(async (_input: TInput, stage: PageletProviderRevalidationStage) => {
            options.order.push(`revalidate:${stage}`);
            return true;
        }),
        reserve: jest.fn(async (): Promise<boolean | PageletProviderCallReservation> => {
            options.order.push("reserve");
            return true;
        }),
        invoke: jest.fn(async (input: TInput) => {
            options.order.push("invoke");
            return await (options.invoke?.(input) ?? "ok");
        }),
    };
}

describe("PageletProviderCallAdmission", () => {
    it("silently invokes a standard call when first-use was already recorded", async () => {
        const harness = makeAdmission({ notified: true });

        await expect(harness.admission.executeStandardCall(async () => {
            harness.order.push("invoke");
            return "ok";
        })).resolves.toBe("ok");

        expect(harness.notice).not.toHaveBeenCalled();
        expect(harness.mark).not.toHaveBeenCalled();
        expect(harness.order).toEqual(["invoke"]);
    });

    describe("standard provisional reservation", () => {
        it("rolls back when source identity changes after reservation", async () => {
            const harness = makeAdmission();
            const commit = jest.fn();
            const rollback = jest.fn(async () => undefined);
            const invoke = jest.fn(async () => "ok");
            const revalidate = jest.fn()
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(false);

            await expect(harness.admission.executeStandardCall(invoke, {
                revalidate,
                reserve: () => ({ commit, rollback }),
            })).rejects.toThrow("pagelet_provider_call_stale");

            expect(rollback).toHaveBeenCalledTimes(1);
            expect(commit).not.toHaveBeenCalled();
            expect(invoke).not.toHaveBeenCalled();
            expect(harness.notice).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
        });

        it("rolls back when first-use admission fails before invocation", async () => {
            const commit = jest.fn();
            const rollback = jest.fn(async () => undefined);
            const invoke = jest.fn(async () => "ok");
            const admission = new PageletProviderCallAdmission({
                isFirstUseNotified: () => false,
                markFirstUseNotified: () => { throw new Error("persist failed"); },
                showStandardFirstUseNotice: jest.fn(),
            });

            await expect(admission.executeStandardCall(invoke, {
                revalidate: () => true,
                reserve: () => ({ commit, rollback }),
            })).rejects.toThrow("persist failed");

            expect(rollback).toHaveBeenCalledTimes(1);
            expect(commit).not.toHaveBeenCalled();
            expect(invoke).not.toHaveBeenCalled();
        });

        it("commits immediately before entering the provider invocation", async () => {
            const harness = makeAdmission({ notified: true });
            const order: string[] = [];

            await expect(harness.admission.executeStandardCall(() => {
                order.push("invoke");
                return "ok";
            }, {
                revalidate: () => {
                    order.push("revalidate");
                    return true;
                },
                reserve: () => ({
                    commit: () => order.push("commit"),
                    rollback: async () => { order.push("rollback"); },
                }),
            })).resolves.toBe("ok");

            expect(order).toEqual([
                "revalidate",
                "revalidate",
                "commit",
                "invoke",
            ]);
            expect(harness.notice).not.toHaveBeenCalled();
        });
    });

    describe("RR-10 concurrent and re-entrant first use", () => {
        it("shows and persists the standard notice once across concurrent calls", async () => {
            const harness = makeAdmission();

            const results = await Promise.all([
                harness.admission.executeStandardCall(async () => {
                    harness.order.push("invoke:first");
                    return "first";
                }),
                harness.admission.executeStandardCall(async () => {
                    harness.order.push("invoke:second");
                    return "second";
                }),
            ]);

            expect(results).toEqual(["first", "second"]);
            expect(harness.notice).toHaveBeenCalledTimes(1);
            expect(harness.mark).toHaveBeenCalledTimes(1);
            expect(harness.order).toEqual([
                "notice",
                "mark",
                "invoke:first",
                "invoke:second",
            ]);
        });

        it("serializes a call re-entered while the notice is being shown", async () => {
            let reentered: Promise<string> | null = null;
            const holder: { admission?: PageletProviderCallAdmission } = {};
            const harness = makeAdmission({
                onNotice: () => {
                    reentered = holder.admission?.executeStandardCall(async () => {
                        harness.order.push("invoke:reentered");
                        return "reentered";
                    }) ?? null;
                },
            });
            holder.admission = harness.admission;

            const outer = await harness.admission.executeStandardCall(async () => {
                harness.order.push("invoke:outer");
                return "outer";
            });
            const nested = await reentered;

            expect([outer, nested]).toEqual(["outer", "reentered"]);
            expect(harness.notice).toHaveBeenCalledTimes(1);
            expect(harness.mark).toHaveBeenCalledTimes(1);
            expect(harness.order.slice(0, 2)).toEqual(["notice", "mark"]);
            expect(harness.order.slice(2).sort()).toEqual(["invoke:outer", "invoke:reentered"]);
        });
    });

    describe("RR-11 first actual call is high-risk", () => {
        it.each(["cancel", "closed"] as const)(
            "%s leaves provider, reservation, and shared state untouched",
            async (action) => {
                const harness = makeAdmission();
                const options = makeRiskAwareOptions({
                    input: { risk: "high-risk" as const },
                    order: harness.order,
                    decisions: [{ action }],
                });

                const result = await harness.admission.executeRiskAwareCall(options);

                expect(result).toEqual({ status: "cancelled", action });
                expect(options.reserve).not.toHaveBeenCalled();
                expect(options.invoke).not.toHaveBeenCalled();
                expect(harness.mark).not.toHaveBeenCalled();
                expect(harness.notice).not.toHaveBeenCalled();
                expect(harness.isNotified()).toBe(false);
                expect(harness.order).toEqual(["classify:high-risk", "disclose"]);
            },
        );

        it("repeats blocking disclosure after Adjust remains high-risk", async () => {
            const harness = makeAdmission();
            const adjusted = { risk: "high-risk" as const, version: 2 };
            const options = makeRiskAwareOptions({
                input: { risk: "high-risk" as const, version: 1 },
                order: harness.order,
                decisions: [
                    { action: "adjust", input: adjusted },
                    { action: "cancel" },
                ],
            });

            const result = await harness.admission.executeRiskAwareCall(options);

            expect(result).toEqual({ status: "cancelled", action: "cancel" });
            expect(options.requestHighRiskDecision).toHaveBeenCalledTimes(2);
            expect(options.reserve).not.toHaveBeenCalled();
            expect(options.invoke).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
            expect(harness.order).toEqual([
                "classify:high-risk",
                "disclose",
                "classify:high-risk",
                "disclose",
            ]);
        });

        it("fails closed when Adjust returns to an external scope picker", async () => {
            const harness = makeAdmission();
            const options = makeRiskAwareOptions({
                input: { risk: "high-risk" as const },
                order: harness.order,
                decisions: [{ action: "adjust" }],
            });

            const result = await harness.admission.executeRiskAwareCall(options);

            expect(result).toEqual({ status: "cancelled", action: "adjust" });
            expect(options.reserve).not.toHaveBeenCalled();
            expect(options.invoke).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
            expect(harness.order).toEqual(["classify:high-risk", "disclose"]);
        });

        it("uses ordinary shared notice after Adjust reduces the run to standard", async () => {
            const harness = makeAdmission();
            type AdjustableInput = { risk: PageletProviderCallRisk; version: number };
            const standard: AdjustableInput = { risk: "standard", version: 2 };
            const options = makeRiskAwareOptions<AdjustableInput>({
                input: { risk: "high-risk" as const, version: 1 },
                order: harness.order,
                decisions: [{ action: "adjust", input: standard }],
            });

            const result = await harness.admission.executeRiskAwareCall(options);

            expect(result).toEqual({ status: "invoked", risk: "standard", value: "ok" });
            expect(harness.notice).toHaveBeenCalledTimes(1);
            expect(harness.mark).toHaveBeenCalledTimes(1);
            expect(harness.order).toEqual([
                "classify:high-risk",
                "disclose",
                "classify:standard",
                "revalidate:before-reserve",
                "reserve",
                "revalidate:after-reserve",
                "notice",
                "mark",
                "invoke",
            ]);
        });

        it("marks at the imminent seam after Run without stacking a standard notice", async () => {
            const harness = makeAdmission();
            const options = makeRiskAwareOptions({
                input: { risk: "high-risk" as const },
                order: harness.order,
                decisions: [{ action: "run" }],
            });

            const result = await harness.admission.executeRiskAwareCall(options);

            expect(result).toEqual({ status: "invoked", risk: "high-risk", value: "ok" });
            expect(harness.notice).not.toHaveBeenCalled();
            expect(harness.mark).toHaveBeenCalledTimes(1);
            expect(harness.order).toEqual([
                "classify:high-risk",
                "disclose",
                "revalidate:before-reserve",
                "reserve",
                "revalidate:after-reserve",
                "mark",
                "invoke",
            ]);
        });

        it("does not mark or invoke when a post-Run gate fails", async () => {
            const harness = makeAdmission();
            const options = makeRiskAwareOptions({
                input: { risk: "high-risk" as const },
                order: harness.order,
                decisions: [{ action: "run" }],
            });
            options.revalidate.mockImplementation(async (_input, stage) => {
                harness.order.push(`revalidate:${stage}`);
                return stage === "before-reserve";
            });

            const result = await harness.admission.executeRiskAwareCall(options);

            expect(result).toEqual({ status: "blocked", stage: "after-reserve" });
            expect(options.reserve).toHaveBeenCalledTimes(1);
            expect(options.invoke).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
            expect(harness.notice).not.toHaveBeenCalled();
        });
    });

    describe("RR-12 failed first provider attempt", () => {
        it("keeps first-use marked after invocation rejects and stays silent on retry", async () => {
            const harness = makeAdmission();
            const failure = new Error("network failed");

            await expect(harness.admission.executeStandardCall(async () => {
                harness.order.push("invoke:failed");
                throw failure;
            })).rejects.toBe(failure);

            await expect(harness.admission.executeStandardCall(async () => {
                harness.order.push("invoke:retry");
                return "ok";
            })).resolves.toBe("ok");

            expect(harness.isNotified()).toBe(true);
            expect(harness.notice).toHaveBeenCalledTimes(1);
            expect(harness.mark).toHaveBeenCalledTimes(1);
            expect(harness.order).toEqual([
                "notice",
                "mark",
                "invoke:failed",
                "invoke:retry",
            ]);
        });
    });

    describe("deadline cancellation", () => {
        it("does not reserve or claim first-use when a high-risk decision resolves after abort", async () => {
            const harness = makeAdmission();
            const controller = new AbortController();
            let resolveDecision!: (decision: PageletHighRiskDecision<{ risk: "high-risk" }>) => void;
            let decisionRequested!: () => void;
            const requested = new Promise<void>((resolve) => { decisionRequested = resolve; });
            const options = makeRiskAwareOptions({
                input: { risk: "high-risk" as const },
                order: harness.order,
                decisions: [],
            });
            options.requestHighRiskDecision.mockImplementation(async () => {
                decisionRequested();
                return await new Promise((resolve) => { resolveDecision = resolve; });
            });

            const pending = harness.admission.executeRiskAwareCall({
                ...options,
                signal: controller.signal,
            });
            await requested;
            controller.abort();
            resolveDecision({ action: "run" });

            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(options.reserve).not.toHaveBeenCalled();
            expect(options.invoke).not.toHaveBeenCalled();
            expect(harness.notice).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
        });

        it("rolls back a provisional slot when abort wins during persistence", async () => {
            const harness = makeAdmission();
            const controller = new AbortController();
            let resolveReservation!: (reservation: PageletProviderCallReservation) => void;
            let reservationStarted!: () => void;
            const started = new Promise<void>((resolve) => { reservationStarted = resolve; });
            const commit = jest.fn();
            const rollback = jest.fn(async () => undefined);
            const options = makeRiskAwareOptions({
                input: { risk: "standard" as const },
                order: harness.order,
                decisions: [],
            });
            options.reserve.mockImplementation(async () => {
                reservationStarted();
                return await new Promise((resolve) => { resolveReservation = resolve; });
            });

            const pending = harness.admission.executeRiskAwareCall({
                ...options,
                signal: controller.signal,
            });
            await started;
            controller.abort();
            resolveReservation({ commit, rollback });

            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(rollback).toHaveBeenCalledTimes(1);
            expect(commit).not.toHaveBeenCalled();
            expect(options.invoke).not.toHaveBeenCalled();
            expect(harness.notice).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
        });
    });

    describe("RR-13 already-notified high-risk runs", () => {
        it("still blocks every run while Cancel remains zero-cost and Run can invoke", async () => {
            const harness = makeAdmission({ notified: true });
            const cancelled = makeRiskAwareOptions({
                input: { risk: "high-risk" as const, run: 1 },
                order: harness.order,
                decisions: [{ action: "cancel" }],
            });
            const run = makeRiskAwareOptions({
                input: { risk: "high-risk" as const, run: 2 },
                order: harness.order,
                decisions: [{ action: "run" }],
            });

            await expect(harness.admission.executeRiskAwareCall(cancelled)).resolves.toEqual({
                status: "cancelled",
                action: "cancel",
            });
            await expect(harness.admission.executeRiskAwareCall(run)).resolves.toEqual({
                status: "invoked",
                risk: "high-risk",
                value: "ok",
            });

            expect(cancelled.requestHighRiskDecision).toHaveBeenCalledTimes(1);
            expect(cancelled.reserve).not.toHaveBeenCalled();
            expect(cancelled.invoke).not.toHaveBeenCalled();
            expect(run.requestHighRiskDecision).toHaveBeenCalledTimes(1);
            expect(run.reserve).toHaveBeenCalledTimes(1);
            expect(run.invoke).toHaveBeenCalledTimes(1);
            expect(harness.notice).not.toHaveBeenCalled();
            expect(harness.mark).not.toHaveBeenCalled();
            expect(harness.order).toEqual([
                "classify:high-risk",
                "disclose",
                "classify:high-risk",
                "disclose",
                "revalidate:before-reserve",
                "reserve",
                "revalidate:after-reserve",
                "invoke",
            ]);
        });
    });
});
