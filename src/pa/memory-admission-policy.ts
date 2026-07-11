import {
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    type MemorySensitivity,
    type MemoryType,
} from "./contracts";
import { includesString, isRecord } from "./helpers";
import type {
    MemoryControlCenterAuthority,
    MemoryControlCenterEffect,
} from "./memory-control-center";

export type MemoryAdmissionDecision =
    | "ephemeral_only"
    | "silent_durable"
    | "require_prior_review"
    | "reject";

export type MemoryAdmissionOrigin = "type_a" | "memory_candidate";

export type MemoryAdmissionScope =
    | "task_ephemeral"
    | "current_vault"
    | "same_device_explicit"
    | "cross_vault"
    | "global"
    | "unknown";

/**
 * Every safety-relevant field is required and carries an explicit unknown
 * state. Runtime callers that omit one are routed fail-closed by
 * decideMemoryAdmission; absence can never become silent admission.
 *
 * The legacy confirmation count is deliberately absent. It remains migration
 * compatibility state and is not an input to the target effect-based policy.
 */
export interface MemoryAdmissionPolicyInput {
    origin: MemoryAdmissionOrigin;
    memoryType: MemoryType | "unknown";
    authority: MemoryControlCenterAuthority | "unknown";
    persistenceIntent: "ephemeral" | "durable" | "unknown";
    effect: MemoryControlCenterEffect | "unknown";
    provenanceValidity: "valid" | "invalid" | "unknown";
    sourceBacking: "source_backed" | "unbacked" | "unknown";
    sensitivity: MemorySensitivity | "unknown";
    scope: MemoryAdmissionScope;
    reversibility: "reversible" | "irreversible" | "unknown";
    conflict: "absent" | "present" | "unknown";
    durableTaskConstraint: "absent" | "present" | "unknown";
    dataBoundary: "allowed" | "denied" | "unknown";
    suppression: "absent" | "matched" | "unknown";
    writeAuthority: "none" | "requested" | "unknown";
    networkAuthority: "none" | "requested" | "unknown";
    externalActionAuthority: "none" | "requested" | "unknown";
    changeEventSupport: "available" | "unavailable" | "unknown";
    recoverySupport: "available" | "unavailable" | "unknown";
    atomicCommitSupport: "available" | "unavailable" | "unknown";
    policyCompliance: "allowed" | "prohibited" | "unknown";
    ephemeralContextEligibility: "eligible" | "ineligible" | "unknown";
}

const ORIGINS = ["type_a", "memory_candidate"] as const;
const AUTHORITIES = [
    "source_observation",
    "pa_inference",
    "explicit_user",
    "user_correction",
] as const satisfies readonly MemoryControlCenterAuthority[];
const EFFECTS = [
    "none",
    "stored_not_in_use",
    "retrieval_only",
    "future_answers",
    "collaboration_default",
] as const satisfies readonly MemoryControlCenterEffect[];
const SCOPES = [
    "task_ephemeral",
    "current_vault",
    "same_device_explicit",
    "cross_vault",
    "global",
    "unknown",
] as const satisfies readonly MemoryAdmissionScope[];

const REQUIRED_SAFETY_FIELDS = [
    "memoryType",
    "authority",
    "persistenceIntent",
    "effect",
    "provenanceValidity",
    "sourceBacking",
    "sensitivity",
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
] as const satisfies readonly (keyof MemoryAdmissionPolicyInput)[];

/** Pure, deterministic, effect-based admission decision. */
export function decideMemoryAdmission(input: MemoryAdmissionPolicyInput): MemoryAdmissionDecision {
    if (!isRecord(input)) return "reject";
    if (!includesString(ORIGINS, input.origin)) return "reject";

    const missingSafetyCondition = REQUIRED_SAFETY_FIELDS.some((field) => input[field] === undefined);
    if (missingSafetyCondition) return "require_prior_review";
    if (!hasValidEnumeratedShape(input)) return "reject";

    // Known denials and permission escalation are hard stops. Another unknown
    // field cannot soften an already-proven unsafe outcome into review.
    if (input.policyCompliance === "prohibited"
        || input.provenanceValidity === "invalid"
        || input.dataBoundary === "denied"
        || input.suppression === "matched"
        || input.writeAuthority === "requested"
        || input.networkAuthority === "requested"
        || input.externalActionAuthority === "requested"
        || input.scope === "cross_vault"
        || input.scope === "global") {
        return "reject";
    }

    if (isSensitiveInference(input)) return "reject";
    if (input.effect === "collaboration_default"
        && input.authority !== "explicit_user"
        && input.authority !== "user_correction"
        && input.authority !== "unknown") {
        return "reject";
    }

    if (hasUnknownSafetyCondition(input)) return "require_prior_review";

    const ephemeralEffect = input.effect === "none" || input.effect === "retrieval_only";
    if (input.persistenceIntent === "ephemeral" && !ephemeralEffect) return "reject";

    if (input.memoryType === "task_constraint" || input.durableTaskConstraint === "present") {
        return "require_prior_review";
    }
    if (input.conflict === "present") return "require_prior_review";
    if (input.sensitivity !== "low") return "require_prior_review";
    if (input.scope === "same_device_explicit" || input.effect === "collaboration_default") {
        return "require_prior_review";
    }

    if (input.persistenceIntent === "ephemeral" || ephemeralEffect) {
        return input.ephemeralContextEligibility === "eligible"
            ? "ephemeral_only"
            : "require_prior_review";
    }

    if (input.persistenceIntent !== "durable") return "require_prior_review";

    const everySilentDurableConditionProven = input.provenanceValidity === "valid"
        && input.sourceBacking === "source_backed"
        && input.sensitivity === "low"
        && input.scope === "current_vault"
        && input.reversibility === "reversible"
        && input.conflict === "absent"
        && input.durableTaskConstraint === "absent"
        && input.dataBoundary === "allowed"
        && input.suppression === "absent"
        && input.writeAuthority === "none"
        && input.networkAuthority === "none"
        && input.externalActionAuthority === "none"
        && input.changeEventSupport === "available"
        && input.recoverySupport === "available"
        && input.atomicCommitSupport === "available"
        && input.policyCompliance === "allowed";

    if (!everySilentDurableConditionProven) return "require_prior_review";
    return "silent_durable";
}

function hasValidEnumeratedShape(input: Record<string, unknown>): boolean {
    return (includesString(MEMORY_TYPES, input.memoryType) || input.memoryType === "unknown")
        && (includesString(AUTHORITIES, input.authority) || input.authority === "unknown")
        && includesString(["ephemeral", "durable", "unknown"] as const, input.persistenceIntent)
        && (includesString(EFFECTS, input.effect) || input.effect === "unknown")
        && includesString(["valid", "invalid", "unknown"] as const, input.provenanceValidity)
        && includesString(["source_backed", "unbacked", "unknown"] as const, input.sourceBacking)
        && (includesString(MEMORY_SENSITIVITIES, input.sensitivity) || input.sensitivity === "unknown")
        && includesString(SCOPES, input.scope)
        && includesString(["reversible", "irreversible", "unknown"] as const, input.reversibility)
        && includesString(["absent", "present", "unknown"] as const, input.conflict)
        && includesString(["absent", "present", "unknown"] as const, input.durableTaskConstraint)
        && includesString(["allowed", "denied", "unknown"] as const, input.dataBoundary)
        && includesString(["absent", "matched", "unknown"] as const, input.suppression)
        && includesString(["none", "requested", "unknown"] as const, input.writeAuthority)
        && includesString(["none", "requested", "unknown"] as const, input.networkAuthority)
        && includesString(["none", "requested", "unknown"] as const, input.externalActionAuthority)
        && includesString(["available", "unavailable", "unknown"] as const, input.changeEventSupport)
        && includesString(["available", "unavailable", "unknown"] as const, input.recoverySupport)
        && includesString(["available", "unavailable", "unknown"] as const, input.atomicCommitSupport)
        && includesString(["allowed", "prohibited", "unknown"] as const, input.policyCompliance)
        && includesString(["eligible", "ineligible", "unknown"] as const, input.ephemeralContextEligibility);
}

function hasUnknownSafetyCondition(input: MemoryAdmissionPolicyInput): boolean {
    return REQUIRED_SAFETY_FIELDS.some((field) => input[field] === "unknown");
}

function isSensitiveInference(input: MemoryAdmissionPolicyInput): boolean {
    return input.authority === "pa_inference"
        && (input.sensitivity === "medium" || input.sensitivity === "high");
}
