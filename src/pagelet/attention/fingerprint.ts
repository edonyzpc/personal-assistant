/* Copyright 2023 edonyzpc */

import { normalizeVaultPath, stableHash } from "../../pa/helpers";
import {
    DELIVERY_FINGERPRINT_VERSION,
    type DeliveryKind,
    type DeliveryReceipt,
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

export function buildReviewDeliveryReceipt(
    input: ReviewDeliveryReceiptInput,
): DeliveryReceipt {
    const insightId = normalizeText(input.insightId);
    // ID-backed Deep Discover receipts use the stable insight identity alone.
    // The receipt/ledger wire version stays v1: legacy callers without an ID
    // retain the exact prior canonical algorithm. Existing opaque legacy hashes
    // cannot be losslessly remapped to IDs, so both identities coexist and
    // expire only through the existing bounded ledger eviction.
    if (insightId) return buildReceipt("review", [["insightId", insightId]]);
    return buildReceipt("review", [
        ["locale", normalizeLocale(input.locale)],
        ["title", normalizeText(input.title)],
        ["body", normalizeText(input.body)],
        ["whyNow", serializeList(normalizeTextList(input.whyNow))],
        ["anchorSourceIdentity", normalizeSourceIdentity(input.anchorSourceIdentity)],
        ["sourceIdentities", serializeList(normalizeSourceIdentities(input.sourceIdentities))],
    ]);
}
