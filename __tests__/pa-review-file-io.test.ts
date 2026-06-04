/* Copyright 2023 edonyzpc */

/**
 * Track B · B6 unit tests for the Pagelet file IO + frontmatter module.
 *
 * Coverage matrix (mapped to SDD §5.1 / §5.3 / §5.4 + D008-D010 + D029):
 *  - Path resolution: default `.pagelet/`, custom folder, sanitization,
 *    Unicode, deep nested source paths, collision suffix progression.
 *  - Date / time formatting: UTC stability, ISO-8601 offset literal.
 *  - Frontmatter: schema validation, byte-stable key ordering, YAML
 *    quoting boundaries (reserved words, special characters, CJK).
 *  - Body rendering: zero-suggestion (empty) path, multi-suggestion with
 *    related_notes, overall remark, ZH heading parity.
 *  - `writeReviewNote` IO contract: folder creation walk, collision retry
 *    loop, `markSelfWrite` hook ordering, error propagation from mkdir +
 *    write failures.
 *
 * Test style mirrors `pa-review-cost.test.ts`: each assertion targets a
 * specific contract that downstream B2 / C1 wiring depends on, with the
 * "why" inlined so future refactors don't silently relax a guarantee.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    MAX_COLLISION_SUFFIX,
    PAGELET_DEFAULT_REVIEWS_FOLDER,
    PAGELET_FILENAME_INFIX,
    assembleReviewNote,
    buildReviewMetadata,
    formatPageletDate,
    formatPageletIsoTimestamp,
    resolveReviewsFolderPath,
    renderReviewBody,
    resolveReviewNotePath,
    sanitizeSourceBaseName,
    serializeFrontmatter,
    writeReviewNote,
    type PageletReviewIOAdapter,
} from "../src/pagelet/pa-review-file-io";
import {
    PAGELET_SCHEMA_VERSION,
    PageletReviewMetadataSchema,
    type PageletReviewMetadata,
    type PageletReviewResult,
} from "../src/pagelet/pa-review-schemas";

// ---------------------------------------------------------------------------
// Test fixtures + factories
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date(Date.UTC(2026, 5, 3, 14, 30, 45)); // 2026-06-03 14:30:45 UTC
const ISO_AT_FIXED_DATE = "2026-06-03T14:30:45+00:00";

function defaultSettings(): { reviewsFolder: string } {
    return { reviewsFolder: PAGELET_DEFAULT_REVIEWS_FOLDER };
}

function buildAdapter(overrides: Partial<PageletReviewIOAdapter> = {}): PageletReviewIOAdapter & {
    write: jest.Mock;
    mkdir: jest.Mock;
    exists: jest.Mock;
} {
    return {
        write: jest.fn(async () => undefined),
        mkdir: jest.fn(async () => undefined),
        exists: jest.fn(async () => false),
        ...overrides,
    } as PageletReviewIOAdapter & {
        write: jest.Mock;
        mkdir: jest.Mock;
        exists: jest.Mock;
    };
}

function validResult(overrides: Partial<PageletReviewResult> = {}): PageletReviewResult {
    return {
        schema_version: PAGELET_SCHEMA_VERSION,
        detected_language: "en",
        suggestions: [
            {
                source_id: "seg-1",
                kind: "clarify",
                rationale: "Needs a clearer scope statement near the opening line.",
                proposed_action: "Add a one-sentence scope note after the title.",
            },
        ],
        overall_remark: "Solid draft; one scope clarification away from a publish.",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// formatPageletDate
// ---------------------------------------------------------------------------

describe("formatPageletDate", () => {
    it("pads month and day with leading zeros", () => {
        const date = new Date(Date.UTC(2026, 0, 5));
        expect(formatPageletDate(date)).toBe("2026-01-05");
    });

    it("uses UTC components rather than the host TZ", () => {
        // 2026-06-03T23:30:00+00:00 → in UTC-08:00 (e.g. PST) the local date
        // would be 2026-06-03 too, but if we accidentally used getMonth()
        // (local) instead of getUTCMonth(), a date near midnight in a
        // negative-offset TZ would produce the prior day. The fixed-UTC
        // input above already guards against that, but we cross-check
        // explicitly by reading via the same UTC accessor.
        const date = new Date(Date.UTC(2026, 11, 31, 23, 30, 0));
        expect(formatPageletDate(date)).toBe("2026-12-31");
    });
});

describe("formatPageletIsoTimestamp", () => {
    it("emits a normalized +00:00 offset (not Z)", () => {
        // The SDD §5.3 sample carries an explicit offset; downstream
        // consumers (settings panel, audit log) expect the trailing
        // `[+-]HH:MM` form. A drift to `Z` would still parse but breaks
        // naive regex matchers in the audit pipeline.
        expect(formatPageletIsoTimestamp(FIXED_DATE)).toBe(ISO_AT_FIXED_DATE);
    });

    it("zero-pads sub-day fields", () => {
        const date = new Date(Date.UTC(2026, 0, 1, 1, 2, 3));
        expect(formatPageletIsoTimestamp(date)).toBe("2026-01-01T01:02:03+00:00");
    });
});

// ---------------------------------------------------------------------------
// sanitizeSourceBaseName
// ---------------------------------------------------------------------------

describe("sanitizeSourceBaseName", () => {
    it("drops the source folder prefix", () => {
        // We only need the leaf name; mirroring the source folder tree
        // inside `.pagelet/` would create a surprise hierarchy. The
        // pathing comment in pa-review-file-io.ts documents this rule.
        expect(sanitizeSourceBaseName("notes/projects/thoughts.md")).toBe("thoughts");
    });

    it("drops a single trailing extension", () => {
        expect(sanitizeSourceBaseName("idea.markdown")).toBe("idea");
        expect(sanitizeSourceBaseName("idea")).toBe("idea"); // no extension is fine
    });

    it("preserves a dot inside the stem (e.g. dated RFC notes)", () => {
        // Users like to keep version-style filenames; collapsing internal
        // dots would mangle "RFC-2026.06.02" into "RFC-2026_06_02" which
        // doesn't match what the user expects to see in their vault.
        expect(sanitizeSourceBaseName("RFC-2026.06.02.md")).toBe("RFC-2026.06.02");
    });

    it("replaces Windows-reserved characters with `_` (trailing run trimmed)", () => {
        // The three trailing reserved chars (`<`, `>`, `|`) each become
        // `_`, then the rule-4 trim strips the trailing `___` so the
        // final filename doesn't end in a punctuation cluster (which
        // some sync tools choke on).
        expect(sanitizeSourceBaseName(`weird:name*with?bad"chars<>|.md`))
            .toBe("weird_name_with_bad_chars");
    });

    it("collapses runs of underscores and trims leading/trailing underscores", () => {
        expect(sanitizeSourceBaseName("__a___b__.md")).toBe("a_b");
    });

    it("converts spaces to `_` so the filename round-trips on shells", () => {
        // The sanitizer treats spaces as separator characters. We assert
        // the consequence so a future relaxation (e.g. allow spaces) is a
        // conscious decision rather than an accidental regression.
        expect(sanitizeSourceBaseName("Project Notes 2026.md")).toBe("Project_Notes_2026");
    });

    it("preserves Unicode (CJK) base names", () => {
        // Obsidian + all FS we target handle CJK fine; surrogate-mangling
        // would be a worse UX hit than the rare iCloud edge case.
        expect(sanitizeSourceBaseName("笔记/项目/思考.md")).toBe("思考");
    });

    it("falls back to `pagelet-note` for empty or all-illegal input", () => {
        expect(sanitizeSourceBaseName("")).toBe("pagelet-note");
        expect(sanitizeSourceBaseName("///")).toBe("pagelet-note");
        expect(sanitizeSourceBaseName("...")).toBe("pagelet-note");
    });

    it("strips a leading backslash-prefixed path (Windows-style)", () => {
        // We normalize on `/` first then `\\` — both should leave the
        // last segment exposed.
        expect(sanitizeSourceBaseName("C\\\\folder\\\\note.md")).toBe("note");
    });
});

// ---------------------------------------------------------------------------
// resolveReviewsFolderPath
// ---------------------------------------------------------------------------

describe("resolveReviewsFolderPath", () => {
    it("returns the default for empty / whitespace input", () => {
        expect(resolveReviewsFolderPath("")).toBe(PAGELET_DEFAULT_REVIEWS_FOLDER);
        expect(resolveReviewsFolderPath("   ")).toBe(PAGELET_DEFAULT_REVIEWS_FOLDER);
        expect(resolveReviewsFolderPath(undefined)).toBe(PAGELET_DEFAULT_REVIEWS_FOLDER);
    });

    it("strips leading `./` / `/` and trailing slashes", () => {
        expect(resolveReviewsFolderPath("/Pagelet/")).toBe("Pagelet");
        expect(resolveReviewsFolderPath("./reviews/")).toBe("reviews");
    });

    it("collapses a root-only path back to the default", () => {
        // A user typo of `/` would otherwise resolve to an empty folder
        // and break `vault.adapter.write` calls in a confusing way.
        expect(resolveReviewsFolderPath("/")).toBe(PAGELET_DEFAULT_REVIEWS_FOLDER);
        expect(resolveReviewsFolderPath(".")).toBe(PAGELET_DEFAULT_REVIEWS_FOLDER);
    });
});

// ---------------------------------------------------------------------------
// resolveReviewNotePath
// ---------------------------------------------------------------------------

describe("resolveReviewNotePath", () => {
    it("produces the SDD §5.1 layout for the default folder", () => {
        // The exact byte-pattern is the contract Templater / Smart Connections
        // ignore-rules will likely match against. Document it via assertion.
        const path = resolveReviewNotePath({
            sourcePath: "notes/thoughts.md",
            settings: defaultSettings(),
            date: FIXED_DATE,
        });
        expect(path).toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03.md`);
    });

    it("respects a custom reviewsFolder", () => {
        const path = resolveReviewNotePath({
            sourcePath: "diary.md",
            settings: { reviewsFolder: "Pagelet Reviews" },
            date: FIXED_DATE,
        });
        expect(path).toBe(`Pagelet Reviews/diary-${PAGELET_FILENAME_INFIX}-2026-06-03.md`);
    });

    it("falls back to default folder when setting is blank", () => {
        const path = resolveReviewNotePath({
            sourcePath: "x.md",
            settings: { reviewsFolder: "" },
            date: FIXED_DATE,
        });
        expect(path.startsWith(`${PAGELET_DEFAULT_REVIEWS_FOLDER}/`)).toBe(true);
    });

    it("appends -2, -3, … for collision indexes", () => {
        // Match the human numbering scheme described in the IO module
        // comment: collisionIndex=0 → bare, 1 → "-2", 2 → "-3", etc. This
        // is what users see when they open the folder and is a key
        // observable contract for the writer.
        const baseInput = {
            sourcePath: "thoughts.md",
            settings: defaultSettings(),
            date: FIXED_DATE,
        };
        expect(resolveReviewNotePath({ ...baseInput, collisionIndex: 0 }))
            .toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03.md`);
        expect(resolveReviewNotePath({ ...baseInput, collisionIndex: 1 }))
            .toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03-2.md`);
        expect(resolveReviewNotePath({ ...baseInput, collisionIndex: 4 }))
            .toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03-5.md`);
    });

    it("sanitizes deeply nested + Unicode source paths", () => {
        const path = resolveReviewNotePath({
            sourcePath: "笔记/2026/项目/思考 第二版.md",
            settings: defaultSettings(),
            date: FIXED_DATE,
        });
        expect(path).toBe(`.pagelet/思考_第二版-${PAGELET_FILENAME_INFIX}-2026-06-03.md`);
    });
});

// ---------------------------------------------------------------------------
// buildReviewMetadata + serializeFrontmatter
// ---------------------------------------------------------------------------

describe("buildReviewMetadata", () => {
    it("validates against PageletReviewMetadataSchema", () => {
        const metadata = buildReviewMetadata({
            sourcePath: "notes/thoughts.md",
            mode: "basic",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
            costUsd: 0.003,
            provider: "qwen",
            model: "qwen-plus",
        });
        expect(() => PageletReviewMetadataSchema.parse(metadata)).not.toThrow();
        expect(metadata).toMatchObject({
            pagelet: true,
            pagelet_schema_version: PAGELET_SCHEMA_VERSION,
            pagelet_source: "notes/thoughts.md",
            pagelet_mode: "basic",
            pagelet_cost_usd: 0.003,
            pagelet_provider: "qwen",
            pagelet_model: "qwen-plus",
            pagelet_detected_language: "en",
        });
    });

    it("omits optional fields when not provided", () => {
        // The schema allows omission; the frontmatter serializer relies on
        // that to emit a compact preamble. If the builder accidentally
        // included `undefined`, zod-strict mode would still pass but the
        // YAML output would gain `pagelet_cost_usd: undefined` which is
        // not parseable by YAML.
        const metadata = buildReviewMetadata({
            sourcePath: "a.md",
            mode: "deeper",
            detectedLanguage: "zh",
            createdAtIso: ISO_AT_FIXED_DATE,
        });
        expect(metadata).not.toHaveProperty("pagelet_cost_usd");
        expect(metadata).not.toHaveProperty("pagelet_provider");
        expect(metadata).not.toHaveProperty("pagelet_model");
    });

    it("throws on invalid mode (zod surface)", () => {
        // Catching this at build time means we never write a corrupt
        // envelope to disk — a subsequent re-read would otherwise fail
        // schema validation and surface as silent data loss.
        expect(() => buildReviewMetadata({
            sourcePath: "x.md",
            // @ts-expect-error — runtime validation under test
            mode: "swift",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
        })).toThrow();
    });
});

describe("serializeFrontmatter", () => {
    function envelopeFor(extra: Partial<PageletReviewMetadata> = {}): PageletReviewMetadata {
        return buildReviewMetadata({
            sourcePath: "notes/thoughts.md",
            mode: "basic",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
            ...("pagelet_cost_usd" in extra ? { costUsd: extra.pagelet_cost_usd as number } : {}),
            ...("pagelet_provider" in extra ? { provider: extra.pagelet_provider as string } : {}),
            ...("pagelet_model" in extra ? { model: extra.pagelet_model as string } : {}),
        });
    }

    it("wraps output in `---` fences", () => {
        const out = serializeFrontmatter(envelopeFor());
        expect(out.startsWith("---\n")).toBe(true);
        expect(out.endsWith("\n---")).toBe(true);
    });

    it("emits keys in the canonical order regardless of input order", () => {
        // The schema is conceptually un-ordered, but stable output
        // matters for users diffing review folders under git. We assert
        // the canonical order from pa-review-file-io.ts's orderedKeys.
        const out = serializeFrontmatter(
            envelopeFor({ pagelet_cost_usd: 0.012, pagelet_provider: "openai", pagelet_model: "gpt-4o-mini" }),
        );
        const lines = out.split("\n").slice(1, -1).map((l) => l.split(":")[0]);
        expect(lines).toEqual([
            "pagelet",
            "pagelet_schema_version",
            "pagelet_source",
            "pagelet_created_at",
            "pagelet_mode",
            "pagelet_cost_usd",
            "pagelet_detected_language",
            "pagelet_provider",
            "pagelet_model",
        ]);
    });

    it("emits pagelet: true as a bare boolean", () => {
        // Smart Connections / Copilot etc. detect via `pagelet: true`. If
        // we ever quoted it the consumer regex would skip our notes.
        const out = serializeFrontmatter(envelopeFor());
        expect(out).toContain("pagelet: true");
    });

    it("JSON-quotes strings that contain spaces or colons", () => {
        // Defensive: source paths can contain spaces (`Project Notes/...`)
        // or even `:` on macOS aliases. A bare YAML scalar would either
        // break parsing or be interpreted as a mapping.
        const envelope = buildReviewMetadata({
            sourcePath: "Project Notes/2026: thoughts.md",
            mode: "basic",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
        });
        const out = serializeFrontmatter(envelope);
        expect(out).toContain(
            'pagelet_source: "Project Notes/2026: thoughts.md"',
        );
    });

    it("JSON-quotes CJK / emoji strings", () => {
        const envelope = buildReviewMetadata({
            sourcePath: "笔记/思考.md",
            mode: "basic",
            detectedLanguage: "zh",
            createdAtIso: ISO_AT_FIXED_DATE,
        });
        const out = serializeFrontmatter(envelope);
        expect(out).toContain('pagelet_source: "笔记/思考.md"');
        // detected_language stays bare since "zh" is a safe scalar.
        expect(out).toContain("pagelet_detected_language: zh");
    });

    it("JSON-quotes provider names that match YAML reserved words", () => {
        // Highly unlikely but cheap to defend: a provider literally
        // called "on" / "off" / "yes" / "no" would parse as a boolean
        // under YAML 1.1 — the loader downstream would then crash
        // because the metadata schema expects a string.
        const envelope = buildReviewMetadata({
            sourcePath: "a.md",
            mode: "basic",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
            provider: "on",
        });
        const out = serializeFrontmatter(envelope);
        expect(out).toContain('pagelet_provider: "on"');
    });

    it("emits a numeric cost without quotes", () => {
        const envelope = buildReviewMetadata({
            sourcePath: "a.md",
            mode: "basic",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
            costUsd: 0.003,
        });
        const out = serializeFrontmatter(envelope);
        expect(out).toContain("pagelet_cost_usd: 0.003");
    });
});

// ---------------------------------------------------------------------------
// renderReviewBody + assembleReviewNote
// ---------------------------------------------------------------------------

describe("renderReviewBody", () => {
    it("emits the EN empty-result placeholder when no suggestions", () => {
        const body = renderReviewBody(validResult({ suggestions: [], overall_remark: undefined }));
        expect(body).toContain("## Suggestions");
        expect(body).toContain("_No suggestions for this review._");
    });

    it("emits the ZH empty-result placeholder when language is zh", () => {
        const body = renderReviewBody(validResult({
            detected_language: "zh",
            suggestions: [],
            overall_remark: undefined,
        }));
        expect(body).toContain("## 建议");
        expect(body).toContain("_本次审阅未发现需要改进的点。_");
    });

    it("renders each suggestion with kind, source_id, rationale, action", () => {
        const body = renderReviewBody(validResult());
        expect(body).toContain("### 1. clarify — `seg-1`");
        expect(body).toContain("**Rationale**: Needs a clearer scope statement near the opening line.");
        expect(body).toContain("**Proposed action**: Add a one-sentence scope note after the title.");
    });

    it("renders related_notes as wikilinks", () => {
        // [[ ]] wikilinks are the Obsidian-native link form. The body
        // doubles as a portable record — users who copy the file to
        // another vault still get clickable refs.
        const body = renderReviewBody(validResult({
            suggestions: [
                {
                    source_id: "seg-1",
                    kind: "link",
                    rationale: "Reference [[Concept-X]] when discussing the central idea.",
                    proposed_action: "Add a link to [[Concept-X]] in the second paragraph.",
                    related_notes: ["Concept-X", "Method-Y"],
                },
            ],
            overall_remark: undefined,
        }));
        expect(body).toContain("- [[Concept-X]]");
        expect(body).toContain("- [[Method-Y]]");
    });

    it("appends overall_remark when present", () => {
        const body = renderReviewBody(validResult());
        expect(body).toContain("## Overall remark");
        expect(body).toContain("Solid draft; one scope clarification away from a publish.");
    });
});

describe("assembleReviewNote", () => {
    it("places the frontmatter at the top followed by a blank line", () => {
        const metadata = buildReviewMetadata({
            sourcePath: "a.md",
            mode: "basic",
            detectedLanguage: "en",
            createdAtIso: ISO_AT_FIXED_DATE,
        });
        const note = assembleReviewNote(metadata, validResult({ suggestions: [], overall_remark: undefined }));
        expect(note.startsWith("---\n")).toBe(true);
        // The blank-line separator between frontmatter and body is
        // important — without it Obsidian's frontmatter parser will eat
        // the next heading as part of the YAML.
        expect(note).toContain("---\n\n## Suggestions");
        expect(note.endsWith("\n")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// writeReviewNote — IO contract
// ---------------------------------------------------------------------------

describe("writeReviewNote", () => {
    it("creates the target folder recursively before writing", async () => {
        const adapter = buildAdapter({
            // Folder does not exist on first probe.
            exists: jest.fn(async (path: unknown) => {
                if (typeof path !== "string") return false;
                if (path.endsWith(".md")) return false; // candidate file
                return false; // folder & every parent missing
            }) as unknown as PageletReviewIOAdapter["exists"],
        });
        const result = await writeReviewNote({
            sourcePath: "notes/thoughts.md",
            reviewResult: validResult(),
            settings: { reviewsFolder: "Pagelet Reviews/2026" },
            vault: { adapter },
            mode: "basic",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
        });
        // mkdir should be called for each missing path segment.
        expect(adapter.mkdir).toHaveBeenCalledWith("Pagelet Reviews");
        expect(adapter.mkdir).toHaveBeenCalledWith("Pagelet Reviews/2026");
        expect(adapter.write).toHaveBeenCalledTimes(1);
        expect(result.path).toBe(
            `Pagelet Reviews/2026/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03.md`,
        );
        expect(result.created).toBe(true);
    });

    it("skips mkdir when intermediate folders already exist", async () => {
        // exists() returns true for folder segments, false for the candidate file.
        const existing = new Set([".pagelet"]);
        const adapter = buildAdapter({
            exists: jest.fn(async (path: unknown) => {
                if (typeof path !== "string") return false;
                if (path.endsWith(".md")) return false;
                return existing.has(path);
            }) as unknown as PageletReviewIOAdapter["exists"],
        });
        await writeReviewNote({
            sourcePath: "thoughts.md",
            reviewResult: validResult(),
            settings: defaultSettings(),
            vault: { adapter },
            mode: "basic",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
        });
        expect(adapter.mkdir).not.toHaveBeenCalled();
    });

    it("retries with -2, -3, … when the candidate already exists", async () => {
        // First two probes (folder + bare file) hit, third probe (-2 suffix) free.
        const probed: string[] = [];
        const adapter = buildAdapter({
            exists: jest.fn(async (path: unknown) => {
                if (typeof path !== "string") return false;
                probed.push(path);
                // folder probes return true (folder exists)
                if (!path.endsWith(".md")) return true;
                // first candidate file occupied
                if (path === `.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03.md`) return true;
                return false;
            }) as unknown as PageletReviewIOAdapter["exists"],
        });
        const result = await writeReviewNote({
            sourcePath: "thoughts.md",
            reviewResult: validResult(),
            settings: defaultSettings(),
            vault: { adapter },
            mode: "basic",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
        });
        expect(result.path).toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03-2.md`);
        // mkdir should not run when folder probe returned true.
        expect(adapter.mkdir).not.toHaveBeenCalled();
        // The chosen path is the second-attempted file probe.
        const fileProbes = probed.filter((p) => p.endsWith(".md"));
        expect(fileProbes[0]).toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03.md`);
        expect(fileProbes[1]).toBe(`.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03-2.md`);
    });

    it("falls back to HMS suffix after exhausting numeric collisions", async () => {
        // Everything collides until the HMS fallback path.
        const adapter = buildAdapter({
            exists: jest.fn(async (path: unknown) => {
                if (typeof path !== "string") return false;
                if (!path.endsWith(".md")) return true;
                // Reject the HMS-suffixed path (UTC 14:30:45 → 143045) so
                // the writer eventually settles on it.
                return !path.endsWith("-143045.md");
            }) as unknown as PageletReviewIOAdapter["exists"],
        });
        const result = await writeReviewNote({
            sourcePath: "thoughts.md",
            reviewResult: validResult(),
            settings: defaultSettings(),
            vault: { adapter },
            mode: "basic",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
        });
        expect(result.path).toBe(
            `.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03-143045.md`,
        );
        // We probed every numeric suffix from 0 to MAX_COLLISION_SUFFIX
        // before falling back. The +1 accounts for the bare attempt.
        const fileProbes = (adapter.exists as jest.Mock).mock.calls
            .map((c) => c[0])
            .filter((p): p is string => typeof p === "string" && p.endsWith(".md") && !p.endsWith("-143045.md"));
        expect(fileProbes.length).toBe(MAX_COLLISION_SUFFIX + 1);
    });

    it("calls markSelfWrite before the actual write (R3 wiring)", async () => {
        // The framework's modify-event listener short-circuits when it
        // sees a path in the self-write set. If we wrote first and
        // notified after, the listener could fire on our own output.
        const adapter = buildAdapter();
        const sequence: string[] = [];
        (adapter.write as jest.Mock).mockImplementation(async () => {
            sequence.push("write");
        });
        const markSelfWrite = jest.fn((_path: string) => {
            sequence.push("mark");
        });
        await writeReviewNote({
            sourcePath: "thoughts.md",
            reviewResult: validResult(),
            settings: defaultSettings(),
            vault: { adapter },
            mode: "basic",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
            markSelfWrite,
        });
        expect(sequence).toEqual(["mark", "write"]);
        expect(markSelfWrite).toHaveBeenCalledWith(
            `.pagelet/thoughts-${PAGELET_FILENAME_INFIX}-2026-06-03.md`,
        );
    });

    it("propagates mkdir errors", async () => {
        const adapter = buildAdapter({
            exists: jest.fn(async () => false) as unknown as PageletReviewIOAdapter["exists"],
            mkdir: jest.fn(async () => {
                throw new Error("EACCES: no perm");
            }) as unknown as PageletReviewIOAdapter["mkdir"],
        });
        await expect(
            writeReviewNote({
                sourcePath: "thoughts.md",
                reviewResult: validResult(),
                settings: defaultSettings(),
                vault: { adapter },
                mode: "basic",
                detectedLanguage: "en",
                dateOverride: FIXED_DATE,
            }),
        ).rejects.toThrow(/EACCES/);
        expect(adapter.write).not.toHaveBeenCalled();
    });

    it("propagates write errors and does not return success", async () => {
        const adapter = buildAdapter({
            exists: jest.fn(async () => false) as unknown as PageletReviewIOAdapter["exists"],
            write: jest.fn(async () => {
                throw new Error("ENOSPC: disk full");
            }) as unknown as PageletReviewIOAdapter["write"],
        });
        await expect(
            writeReviewNote({
                sourcePath: "thoughts.md",
                reviewResult: validResult(),
                settings: defaultSettings(),
                vault: { adapter },
                mode: "basic",
                detectedLanguage: "en",
                dateOverride: FIXED_DATE,
            }),
        ).rejects.toThrow(/ENOSPC/);
    });

    it("returns a metadata envelope that round-trips through schema validation", async () => {
        const adapter = buildAdapter();
        const result = await writeReviewNote({
            sourcePath: "notes/thoughts.md",
            reviewResult: validResult(),
            settings: defaultSettings(),
            vault: { adapter },
            mode: "deeper",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
            costUsd: 0.0042,
            provider: "qwen",
            model: "qwen-plus",
        });
        expect(() => PageletReviewMetadataSchema.parse(result.metadata)).not.toThrow();
        expect(result.metadata.pagelet_created_at).toBe(ISO_AT_FIXED_DATE);
        // The written body should contain the frontmatter we built — this
        // catches accidental drift between the returned metadata and the
        // disk artefact.
        const written = (adapter.write as jest.Mock).mock.calls[0][1] as string;
        expect(written).toContain("pagelet_mode: deeper");
        expect(written).toContain("pagelet_cost_usd: 0.0042");
        expect(written).toContain("pagelet_provider: qwen");
        expect(written).toContain("pagelet_model: qwen-plus");
    });

    it("uses an injected nowIso for the created_at field", async () => {
        // Tests covering downstream flows (e.g. C1's preview rendering)
        // need to assert a stable created_at; the override is the seam.
        const adapter = buildAdapter();
        const result = await writeReviewNote({
            sourcePath: "thoughts.md",
            reviewResult: validResult(),
            settings: defaultSettings(),
            vault: { adapter },
            mode: "basic",
            detectedLanguage: "en",
            dateOverride: FIXED_DATE,
            nowIso: () => "2027-01-01T00:00:00+00:00",
        });
        expect(result.metadata.pagelet_created_at).toBe("2027-01-01T00:00:00+00:00");
    });
});
