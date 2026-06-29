import { describe, expect, it } from "@jest/globals";

import {
    DEFAULT_DATA_BOUNDARY_POLICY,
    decideDataBoundaryForSource,
    getProviderDisclosureReason,
} from "../src/pa/contracts";

describe("Data Boundary resolver", () => {
    it("allows ordinary note sources by default", () => {
        expect(decideDataBoundaryForSource({ path: "notes/day.md" }, DEFAULT_DATA_BOUNDARY_POLICY))
            .toMatchObject({ decision: "allow", reason: "allowed_by_policy" });
    });

    it("denies excluded folders using vault-folder boundaries", () => {
        const policy = {
            ...DEFAULT_DATA_BOUNDARY_POLICY,
            excludedFolders: ["private"],
        };

        expect(decideDataBoundaryForSource({ path: "private/secret.md" }, policy))
            .toMatchObject({ decision: "deny", reason: "excluded_folder" });
        expect(decideDataBoundaryForSource({ path: "private-notes/public.md" }, policy))
            .toMatchObject({ decision: "allow" });
    });

    it("normalizes Obsidian-style tags before matching exclusions", () => {
        const policy = {
            ...DEFAULT_DATA_BOUNDARY_POLICY,
            excludedTags: ["Sensitive"],
        };

        expect(decideDataBoundaryForSource({ path: "notes/a.md", tags: ["#sensitive"] }, policy))
            .toMatchObject({ decision: "deny", reason: "excluded_tag" });
    });

    it("excludes generated Pagelet notes unless the policy explicitly includes them", () => {
        expect(decideDataBoundaryForSource({ path: ".pagelet/review.md" }))
            .toMatchObject({ decision: "deny", reason: "generated_note" });
        expect(decideDataBoundaryForSource(
            { path: "pagelet-generated/review.md" },
            { ...DEFAULT_DATA_BOUNDARY_POLICY, generatedNotePolicy: "ask" },
        )).toMatchObject({ decision: "ask", reason: "generated_note" });
        expect(decideDataBoundaryForSource(
            { path: ".pagelet/review.md" },
            { ...DEFAULT_DATA_BOUNDARY_POLICY, generatedNotePolicy: "include-generated" },
        )).toMatchObject({ decision: "allow" });
    });

    it("keeps provider disclosure reasons as explicit policy decisions", () => {
        expect(getProviderDisclosureReason({ memoryPreparation: true })).toBe("memory_preparation");
        expect(getProviderDisclosureReason({})).toBeNull();
    });
});
