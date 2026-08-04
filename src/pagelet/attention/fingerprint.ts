/* Copyright 2023 edonyzpc */

import { normalizeVaultPath, stableHash } from "../../pa/helpers";
import {
    DELIVERY_FINGERPRINT_VERSION,
    type DeliveryKind,
    type DeliveryReceipt,
    type RecallDeliveryReceiptInput,
    type RecapDeliveryReceiptInput,
    type RecapScopeIdentity,
    type ReviewDeliveryReceiptInput,
} from "./types";

type CanonicalField = readonly [name: string, value: string];

function normalizeText(value: string | null | undefined): string {
    return String(value ?? "")
        .normalize("NFKC")
        .replace(/\r\n?/g, "\n")
        .trim()
        .replace(/\s+/gu, " ");
}

function normalizeTextList(
    value: string | readonly string[] | null | undefined,
): string[] {
    const values = Array.isArray(value) ? value : [value ?? ""];
    return values
        .map((entry) => normalizeText(entry))
        .filter((entry) => entry.length > 0);
}

function normalizeLocale(locale: string | null | undefined): string {
    return normalizeText(locale).toLowerCase();
}

function normalizeSourceIdentity(identity: string | null | undefined): string {
    return normalizeVaultPath(String(identity ?? ""));
}

function normalizeSourceIdentities(
    identities: readonly string[] | null | undefined,
): string[] {
    return uniqueSorted((identities ?? [])
        .map((identity) => normalizeSourceIdentity(identity))
        .filter((identity) => identity.length > 0));
}


function serializeScalar(value: string): string {
    return `${value.length}:${value}`;
}

function serializeList(values: readonly string[]): string {
    return `${values.length}:${values.map(serializeScalar).join("")}`;
}

function serializeFields(fields: readonly CanonicalField[]): string {
    return fields
        .map(([name, value]) => `${serializeScalar(name)}${serializeScalar(value)}`)
        .join("");
}

function compareCanonicalStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort(compareCanonicalStrings);
}

function serializeScopeIdentity(scope: RecapScopeIdentity): string {
    if (typeof scope === "string" && normalizeText(scope).length > 0) return serializeFields([
        ["type", "string"],
        ["value", normalizeText(scope)],
    ]);

    const structured = typeof scope === "object" && scope !== null ? scope : {};
    const paths = uniqueSorted((structured.paths ?? [])
        .map((path) => normalizeSourceIdentity(path))
        .filter((path) => path.length > 0));
    const tags = uniqueSorted((structured.tags ?? [])
        .map((tag) => normalizeText(tag).replace(/^#+/, "").toLowerCase())
        .filter((tag) => tag.length > 0));
    return serializeFields([
        ["type", "structured"],
        ["kind", normalizeText(structured.kind).toLowerCase()],
        ["label", normalizeText(structured.label)],
        ["paths", serializeList(paths)],
        ["tags", serializeList(tags)],
    ]);
}

function buildReceipt(kind: DeliveryKind, fields: readonly CanonicalField[]): DeliveryReceipt {
    const canonical = serializeFields([
        ["version", String(DELIVERY_FINGERPRINT_VERSION)],
        ["kind", kind],
        ...fields,
    ]);
    const left = stableHash(`pagelet-delivery-fingerprint-left\u0000${canonical}`);
    const right = stableHash(`pagelet-delivery-fingerprint-right\u0000${canonical}`);
    return {
        version: DELIVERY_FINGERPRINT_VERSION,
        kind,
        fingerprint: `v${DELIVERY_FINGERPRINT_VERSION}:${kind}:${left}${right}`,
    };
}

export function buildRecallDeliveryReceipt(
    input: RecallDeliveryReceiptInput,
): DeliveryReceipt {
    return buildReceipt("recall", [
        ["locale", normalizeLocale(input.locale)],
        ["title", normalizeText(input.title)],
        ["body", normalizeText(input.body)],
        ["whyNow", serializeList(normalizeTextList(input.whyNow))],
        ["excerpt", serializeList(normalizeTextList(input.excerpt))],
        ["currentSourceIdentity", normalizeSourceIdentity(input.currentSourceIdentity)],
        [
            "recalledSourceIdentities",
            serializeList(normalizeSourceIdentities(input.recalledSourceIdentities)),
        ],
    ]);
}

export function buildRecapDeliveryReceipt(
    input: RecapDeliveryReceiptInput,
): DeliveryReceipt {
    return buildReceipt("recap", [
        ["locale", normalizeLocale(input.locale)],
        ["title", normalizeText(input.title)],
        ["body", normalizeText(input.body)],
        ["whyItMatters", serializeList(normalizeTextList(input.whyItMatters))],
        ["scopeIdentity", serializeScopeIdentity(input.scopeIdentity)],
        ["sourceIdentities", serializeList(normalizeSourceIdentities(input.sourceIdentities))],
    ]);
}

export function buildReviewDeliveryReceipt(
    input: ReviewDeliveryReceiptInput,
): DeliveryReceipt {
    return buildReceipt("review", [
        ["locale", normalizeLocale(input.locale)],
        ["title", normalizeText(input.title)],
        ["body", normalizeText(input.body)],
        ["whyNow", serializeList(normalizeTextList(input.whyNow))],
        ["anchorSourceIdentity", normalizeSourceIdentity(input.anchorSourceIdentity)],
        ["sourceIdentities", serializeList(normalizeSourceIdentities(input.sourceIdentities))],
    ]);
}
