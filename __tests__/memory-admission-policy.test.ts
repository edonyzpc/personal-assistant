import {
    decideMemoryAdmission,
    type MemoryAdmissionPolicyInput,
} from "../src/pa/memory-admission-policy";

describe("decideMemoryAdmission", () => {
    it.each(["type_a", "memory_candidate"] as const)(
        "uses the same complete safety rule for %s",
        (origin) => {
            expect(decideMemoryAdmission(createSilentInput({ origin }))).toBe("silent_durable");
        },
    );

    it.each([
        ["sourceBacking", "unbacked"],
        ["sensitivity", "medium"],
        ["scope", "same_device_explicit"],
        ["reversibility", "irreversible"],
        ["conflict", "present"],
        ["durableTaskConstraint", "present"],
        ["changeEventSupport", "unavailable"],
        ["recoverySupport", "unavailable"],
        ["atomicCommitSupport", "unavailable"],
    ] as const)("does not silently persist when %s is %s", (key, value) => {
        const input = createSilentInput() as unknown as Record<string, unknown>;
        input[key] = value;
        expect(decideMemoryAdmission(input as unknown as MemoryAdmissionPolicyInput)).toBe("require_prior_review");
    });

    it.each([
        ["dataBoundary", "denied"],
        ["suppression", "matched"],
        ["writeAuthority", "requested"],
        ["networkAuthority", "requested"],
        ["externalActionAuthority", "requested"],
        ["policyCompliance", "prohibited"],
        ["provenanceValidity", "invalid"],
        ["scope", "cross_vault"],
        ["scope", "global"],
    ] as const)("rejects unsafe or unauthorized %s=%s", (key, value) => {
        const input = createSilentInput() as unknown as Record<string, unknown>;
        input[key] = value;
        expect(decideMemoryAdmission(input as unknown as MemoryAdmissionPolicyInput)).toBe("reject");
    });

    it("rejects sensitive inference but routes explicit sensitive content to prior review", () => {
        expect(decideMemoryAdmission(createSilentInput({
            authority: "pa_inference",
            sensitivity: "high",
        }))).toBe("reject");
        expect(decideMemoryAdmission(createSilentInput({
            authority: "explicit_user",
            sensitivity: "high",
        }))).toBe("require_prior_review");
    });

    it("never silently admits a durable task constraint based on type alone", () => {
        expect(decideMemoryAdmission(createSilentInput({
            memoryType: "task_constraint",
            durableTaskConstraint: "absent",
        }))).toBe("require_prior_review");
    });

    it("keeps safe current-turn context ephemeral and never persists it", () => {
        expect(decideMemoryAdmission(createEphemeralInput())).toBe("ephemeral_only");
        expect(decideMemoryAdmission(createEphemeralInput({ sourceBacking: "unbacked" }))).toBe("ephemeral_only");
        expect(decideMemoryAdmission(createEphemeralInput({
            reversibility: "irreversible",
            changeEventSupport: "unavailable",
            recoverySupport: "unavailable",
            atomicCommitSupport: "unavailable",
        }))).toBe("ephemeral_only");
        expect(decideMemoryAdmission(createEphemeralInput({ ephemeralContextEligibility: "ineligible" })))
            .toBe("require_prior_review");
    });

    it.each([
        ["none", "ephemeral_only"],
        ["retrieval_only", "ephemeral_only"],
        ["stored_not_in_use", "silent_durable"],
        ["future_answers", "silent_durable"],
        ["collaboration_default", "require_prior_review"],
    ] as const)("routes durable %s by actual effect", (effect, expected) => {
        expect(decideMemoryAdmission(createSilentInput({ effect }))).toBe(expected);
    });

    it("rejects an ephemeral request that claims a durable future effect", () => {
        expect(decideMemoryAdmission(createEphemeralInput({ effect: "future_answers" }))).toBe("reject");
    });

    it("requires prior review for collaboration defaults even when explicitly requested", () => {
        expect(decideMemoryAdmission(createSilentInput({
            authority: "explicit_user",
            scope: "same_device_explicit",
            effect: "collaboration_default",
        }))).toBe("require_prior_review");
    });

    it("rejects an inferred collaboration default as scope widening", () => {
        expect(decideMemoryAdmission(createSilentInput({
            authority: "pa_inference",
            scope: "same_device_explicit",
            effect: "collaboration_default",
        }))).toBe("reject");
    });

    it.each([
        "provenanceValidity",
        "sourceBacking",
        "sensitivity",
        "authority",
        "scope",
        "reversibility",
        "conflict",
        "durableTaskConstraint",
        "dataBoundary",
        "suppression",
        "writeAuthority",
        "networkAuthority",
        "externalActionAuthority",
        "changeEventSupport",
        "recoverySupport",
        "atomicCommitSupport",
        "policyCompliance",
        "ephemeralContextEligibility",
    ] as const)("fails closed when %s is explicitly unknown", (key) => {
        const input = createSilentInput() as unknown as Record<string, unknown>;
        input[key] = "unknown";
        expect(decideMemoryAdmission(input as unknown as MemoryAdmissionPolicyInput)).toBe("require_prior_review");
    });

    it.each([
        "provenanceValidity",
        "sourceBacking",
        "sensitivity",
        "authority",
        "scope",
        "reversibility",
        "conflict",
        "durableTaskConstraint",
        "dataBoundary",
        "suppression",
        "writeAuthority",
        "networkAuthority",
        "externalActionAuthority",
        "changeEventSupport",
        "recoverySupport",
        "atomicCommitSupport",
        "policyCompliance",
        "ephemeralContextEligibility",
    ] as const)("fails closed when %s is missing at runtime", (key) => {
        const input = createSilentInput() as unknown as Record<string, unknown>;
        delete input[key];
        expect(decideMemoryAdmission(input as unknown as MemoryAdmissionPolicyInput)).toBe("require_prior_review");
    });

    it("does not use the legacy 30-confirmation count", () => {
        const baseline = createSilentInput();
        const withLegacyCount = {
            ...baseline,
            legacyConfirmedCount: 0,
        } as unknown as MemoryAdmissionPolicyInput;
        const withTrustedLegacyCount = {
            ...baseline,
            legacyConfirmedCount: 30,
        } as unknown as MemoryAdmissionPolicyInput;

        expect(decideMemoryAdmission(withLegacyCount)).toBe("silent_durable");
        expect(decideMemoryAdmission(withTrustedLegacyCount)).toBe("silent_durable");
    });

    it("rejects malformed routing fields rather than guessing", () => {
        for (const [key, value] of [
            ["origin", "legacy_threshold"],
            ["memoryType", "health"],
            ["persistenceIntent", "sometimes"],
            ["effect", "write_notes"],
        ] as const) {
            const input = createSilentInput() as unknown as Record<string, unknown>;
            input[key] = value;
            expect(decideMemoryAdmission(input as unknown as MemoryAdmissionPolicyInput)).toBe("reject");
        }
    });
});

function createSilentInput(
    overrides: Partial<MemoryAdmissionPolicyInput> = {},
): MemoryAdmissionPolicyInput {
    return {
        origin: "memory_candidate",
        memoryType: "preference",
        authority: "explicit_user",
        persistenceIntent: "durable",
        effect: "future_answers",
        provenanceValidity: "valid",
        sourceBacking: "source_backed",
        sensitivity: "low",
        scope: "current_vault",
        reversibility: "reversible",
        conflict: "absent",
        durableTaskConstraint: "absent",
        dataBoundary: "allowed",
        suppression: "absent",
        writeAuthority: "none",
        networkAuthority: "none",
        externalActionAuthority: "none",
        changeEventSupport: "available",
        recoverySupport: "available",
        atomicCommitSupport: "available",
        policyCompliance: "allowed",
        ephemeralContextEligibility: "eligible",
        ...overrides,
    };
}

function createEphemeralInput(
    overrides: Partial<MemoryAdmissionPolicyInput> = {},
): MemoryAdmissionPolicyInput {
    return createSilentInput({
        persistenceIntent: "ephemeral",
        effect: "retrieval_only",
        scope: "task_ephemeral",
        ...overrides,
    });
}
