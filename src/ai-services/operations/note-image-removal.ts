import MarkdownIt, { type Token } from "markdown-it";
import {
    checkpointTaskSourceRead,
    isTaskSourcePathAllowed,
    type TaskSourceReadGuard,
} from "../task-source-read-guard";
import { OperationsValidationError, validateRemoveNoteImageInput } from "./input-validation";
import {
    REMOVE_NOTE_IMAGE_TOOL_NAME,
    type NoteImageRemovalAttachmentAction,
    type NoteImageRemovalCoverage,
    type NoteImageRemovalFileIdentity,
    type NoteImageRemovalSourceScope,
    type PreparedNoteImageRemovalOperation,
    type RemoveNoteImageInput,
} from "./types";

const markdownParser = new MarkdownIt("commonmark", { html: true });
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
const WIKI_REFERENCE_PATTERN = /(!?)\[\[([^[\]\n]+)\]\]/g;
const MARKDOWN_REFERENCE_USE_PATTERN = /(!?)\[([^[\]\n]*)\]\[([^[\]\n]*)\]/g;

export type NoteImageRemovalReferenceSyntax =
    | "wiki-embed"
    | "wiki-link"
    | "markdown-image"
    | "markdown-link"
    | "markdown-reference-image"
    | "markdown-reference-link";

export interface NoteImageRemovalSourceFile extends NoteImageRemovalFileIdentity {
    readonly extension: "md" | "canvas";
}

export type NoteImageRemovalAttachmentFile = NoteImageRemovalFileIdentity;

/** Narrow Host-owned identity/read port. It never exposes vault bytes to a provider. */
export interface NoteImageRemovalHost {
    getSourceFile(path: string): NoteImageRemovalSourceFile | null | undefined;
    /** Current complete md/canvas candidate inventory, before domain permission filtering. */
    listSourceFiles(): readonly NoteImageRemovalSourceFile[] | null | undefined;
    readSourceFile(file: NoteImageRemovalSourceFile): Promise<string>;
    parseLinktext(linktext: string): { path: string; subpath: string };
    resolveImageDestination(
        linkpath: string,
        sourcePath: string,
    ): NoteImageRemovalAttachmentFile | null | undefined;
    /** Independent Data Boundary decision; a throw is treated as denied. */
    isPathAllowed(path: string): boolean;
    /** Separate attachment read/delete boundary; never inferred from note scope. */
    isAttachmentPathAllowed(path: string): boolean;
    /** P2-only local snapshot port. P1 preparation must never call it. */
    readAttachmentFile?(file: NoteImageRemovalAttachmentFile): Promise<ArrayBuffer | Uint8Array>;
    /** Exact-path identity lookup for restore collision checks. */
    getAttachmentFileByPath?(path: string): NoteImageRemovalAttachmentFile | null | undefined;
    restoreAttachmentFile?(
        file: NoteImageRemovalAttachmentFile,
        bytes: ArrayBuffer,
    ): Promise<NoteImageRemovalAttachmentFile | null | undefined>;
}

export interface NoteImageRemovalConflict {
    readonly sourcePath: string;
    readonly syntax: NoteImageRemovalReferenceSyntax;
    readonly remainsInSelectedNote: boolean;
}

export type NoteImageRemovalPreparationFailureCategory =
    | "selector_invalid"
    | "target_missing"
    | "ambiguous_target"
    | "source_denied"
    | "source_receipt_unavailable"
    | "coverage_incomplete"
    | "shared_reference"
    | "read_failed";

export class NoteImageRemovalPreparationError extends Error {
    constructor(
        readonly category: NoteImageRemovalPreparationFailureCategory,
        message: string,
        readonly details: {
            coverage?: NoteImageRemovalCoverage;
            conflicts?: readonly NoteImageRemovalConflict[];
        } = {},
    ) {
        super(message);
        this.name = "NoteImageRemovalPreparationError";
    }
}

export interface NoteImageRemovalPrivatePreparation {
    readonly attachmentAction: NoteImageRemovalAttachmentAction;
    readonly sourceValidity: () => boolean;
    readonly sourceAuthority: () => boolean;
    readonly note: NoteImageRemovalFileIdentity;
    readonly attachment: NoteImageRemovalFileIdentity;
    readonly scannedSources: readonly NoteImageRemovalSourceFile[];
    readonly inventorySnapshot?: readonly NoteImageRemovalSourceFile[];
    readonly sourceScope?: NoteImageRemovalSourceScope;
    /**
     * Rechecks the retained source receipt and both live file identities.
     * It intentionally does not retain or revive the originating Agent run.
     */
    readonly revalidate: () => boolean;
    readonly markNoteApplied: () => void;
    readonly revalidateAfterSelfWrite: () => boolean;
    readonly revalidateUndo: () => boolean;
}

export interface NoteImageRemovalPreparation {
    readonly operation: PreparedNoteImageRemovalOperation;
    readonly privatePreparation: NoteImageRemovalPrivatePreparation;
}

export interface PrepareNoteImageRemovalOptions {
    readonly runId: string;
    readonly turnId: string;
    readonly toolCallId: string;
    readonly input: unknown;
    readonly host: NoteImageRemovalHost;
    readonly taskSourceReadGuard: TaskSourceReadGuard;
    readonly createId?: () => string;
}

interface ParsedReference {
    readonly syntax: NoteImageRemovalReferenceSyntax;
    readonly target: string;
}

interface MarkdownReferenceDefinitions {
    readonly [label: string]: { href: string; title?: string | null };
}

interface SourceAnalysis {
    readonly active: Uint8Array;
    readonly inlineCode: Uint8Array;
    readonly htmlNonRendered: Uint8Array;
    readonly references: readonly ParsedReference[];
    readonly definitions: MarkdownReferenceDefinitions;
    unsupported: boolean;
}

interface SelectedReference extends ParsedReference {
    readonly start: number;
    readonly end: number;
}

export interface ScopedReferenceSearch {
    readonly conflicts: readonly NoteImageRemovalConflict[];
    readonly coverage: NoteImageRemovalCoverage;
    readonly evidence?: {
        readonly scannedSources: readonly NoteImageRemovalSourceFile[];
        readonly inventorySnapshot: readonly NoteImageRemovalSourceFile[];
        readonly sourceScope: NoteImageRemovalSourceScope;
    };
}

export async function prepareNoteImageRemoval(
    options: PrepareNoteImageRemovalOptions,
): Promise<NoteImageRemovalPreparation> {
    assertIdentification(options);
    let input: RemoveNoteImageInput;
    try {
        input = validateRemoveNoteImageInput(options.input);
    } catch (error) {
        if (error instanceof OperationsValidationError) {
            throw new NoteImageRemovalPreparationError("selector_invalid", error.message);
        }
        throw error;
    }

    const guard = options.taskSourceReadGuard;
    let sourceValidity: (() => boolean) | undefined;
    try {
        sourceValidity = guard.captureSourceValidity?.();
    } catch {
        sourceValidity = undefined;
    }
    if (!sourceValidity) {
        throw new NoteImageRemovalPreparationError(
            "source_receipt_unavailable",
            "The Host did not provide a durable source receipt for this note-image proposal.",
        );
    }
    const assertCurrent = async (): Promise<void> => {
        await checkpointTaskSourceRead(guard);
        if (!sourceValidity!()) {
            throw new NoteImageRemovalPreparationError(
                "source_denied",
                "The source receipt for the selected note is no longer valid.",
            );
        }
    };
    let sourceAuthority: (() => boolean) | undefined;
    try {
        sourceAuthority = guard.captureSourceAuthority?.() ?? sourceValidity;
    } catch {
        sourceAuthority = sourceValidity;
    }
    if (!sourceAuthority) {
        throw new NoteImageRemovalPreparationError(
            "source_receipt_unavailable",
            "The Host did not provide a durable source authority receipt for this note-image proposal.",
        );
    }

    await assertCurrent();
    if (!isTaskSourcePathAllowed(guard, input.notePath, "task_material")) {
        throw new NoteImageRemovalPreparationError(
            "source_denied",
            "The selected note is outside the current task source scope.",
        );
    }

    const note = getSourceIdentity(options.host, input.notePath, "md");
    assertHostPathAllowed(options.host, note.path);
    await assertCurrent();
    assertSameSourceIdentity(options.host, note);
    let noteContent: string;
    try {
        noteContent = await options.host.readSourceFile(note);
    } catch (error) {
        throw new NoteImageRemovalPreparationError(
            "read_failed",
            `The selected note could not be read: ${safeError(error)}`,
        );
    }
    await assertCurrent();
    assertSameSourceIdentity(options.host, note);

    const selected = selectReference(noteContent, input.imageReference);
    const selectedLink = parseLinktextSafely(options.host, selected.target);
    assertLocalLinkpath(selectedLink.path, input.imageReference);
    const attachment = resolveAttachment(options.host, selectedLink.path, note.path);
    if (input.attachmentAction === "delete" && !isAttachmentPathAllowed(options.host, attachment.path)) {
        throw new NoteImageRemovalPreparationError(
            "source_denied",
            "The selected attachment is denied by the independent attachment Data Boundary.",
        );
    }
    const expectedAfter = removeSelectedReference(noteContent, selected);

    const search = input.attachmentAction === "delete"
        ? await inspectScopedReferences({
            host: options.host,
            guard,
            sourceValidity,
            selectedNote: note,
            selectedAttachmentPath: attachment.path,
            expectedAfter,
        })
        : undefined;
    if (search && !search.coverage.complete) {
        throw new NoteImageRemovalPreparationError(
            "coverage_incomplete",
            `Reference coverage is incomplete: ${search.coverage.reason ?? "unknown reason"}`,
            { coverage: search.coverage },
        );
    }

    const coverage: NoteImageRemovalCoverage = search?.coverage ?? {
        kind: "current_note",
        complete: true,
    };
    const operation: PreparedNoteImageRemovalOperation = Object.freeze({
        kind: "note_image_removal",
        id: options.createId?.() ?? `${options.runId}:${options.toolCallId}`,
        toolCallId: options.toolCallId,
        name: REMOVE_NOTE_IMAGE_TOOL_NAME,
        input,
        path: note.path,
        expectedBefore: noteContent,
        expectedAfter,
        effects: Object.freeze({
            note: Object.freeze({ path: note.path, status: "not_started" }),
            attachment: Object.freeze({
                path: attachment.path,
                action: input.attachmentAction,
                plannedAction: input.attachmentAction === "delete" ? "remove" : "retain",
                status: "not_started",
            }),
        }),
        coverage: Object.freeze({ ...coverage }),
        undoLimitation: input.attachmentAction === "delete"
            ? "temporary-attachment-and-note"
            : "markdown-only",
        ...(search?.conflicts.length ? {
            block: Object.freeze({
                reason: "shared_reference" as const,
                conflicts: Object.freeze(search.conflicts.map(conflict => Object.freeze({ ...conflict }))),
            }),
        } : {}),
    });
    const searchEvidence = search?.evidence;
    const phase = { noteApplied: false };

    const privatePreparation: NoteImageRemovalPrivatePreparation = Object.freeze({
        attachmentAction: input.attachmentAction,
        sourceValidity,
        sourceAuthority: () => sourceAuthority!(),
        note,
        attachment,
        scannedSources: Object.freeze([
            note,
            ...(searchEvidence?.scannedSources.filter(source => source.path !== note.path) ?? []),
        ].map(source => freezeIdentity(source) as NoteImageRemovalSourceFile)),
        ...(searchEvidence?.inventorySnapshot ? {
            inventorySnapshot: Object.freeze(
                searchEvidence.inventorySnapshot.map(source => freezeIdentity(source) as NoteImageRemovalSourceFile),
            ),
        } : {}),
        ...(searchEvidence?.sourceScope ? { sourceScope: searchEvidence.sourceScope } : {}),
        revalidate: () => {
            try {
                if (!sourceValidity!()) return false;
                if (!options.host.isPathAllowed(note.path)) return false;
                const currentNote = options.host.getSourceFile(note.path);
                if (!sameIdentity(currentNote, note)) return false;
                if (input.attachmentAction === "delete") {
                    if (!options.host.isAttachmentPathAllowed(attachment.path)) return false;
                    const currentAttachment = options.host.resolveImageDestination(selectedLink.path, note.path);
                    if (!sameIdentity(currentAttachment, attachment)) return false;
                }
                const scannedSources = privatePreparation.scannedSources;
                if (scannedSources.some(source => (
                    !options.host.isPathAllowed(source.path)
                    || !sameIdentity(options.host.getSourceFile(source.path), source)
                ))) {
                    return false;
                }
                if (input.attachmentAction === "delete") {
                    const currentInventory = readInventory(options.host);
                    if (!currentInventory || !sameInventory(currentInventory, privatePreparation.inventorySnapshot ?? [])) {
                        return false;
                    }
                }
                return true;
            } catch {
                return false;
            }
        },
        markNoteApplied: () => {
            phase.noteApplied = true;
        },
        revalidateAfterSelfWrite: () => {
            try {
                if (!sourceAuthority!()) return false;
                if (scannedSourcesExcludeNote().some(source => (
                    !options.host.isPathAllowed(source.path)
                    || !sameIdentity(options.host.getSourceFile(source.path), source)
                ))) return false;
                if (input.attachmentAction === "delete") {
                    const currentInventory = readInventory(options.host)?.filter(source => source.path !== note.path);
                    const expectedInventory = privatePreparation.inventorySnapshot
                        ?.filter(source => source.path !== note.path) ?? [];
                    if (!currentInventory || !sameInventory(currentInventory, expectedInventory)) return false;
                }
                return true;
            } catch {
                return false;
            }
        },
        revalidateUndo: () => {
            try {
                if (!sourceAuthority!()) return false;
                if (!options.host.isPathAllowed(note.path)) return false;
                return input.attachmentAction !== "delete"
                    || options.host.isAttachmentPathAllowed(attachment.path);
            } catch {
                return false;
            }
        },
    });
    return Object.freeze({ operation, privatePreparation });

    function scannedSourcesExcludeNote(): readonly NoteImageRemovalSourceFile[] {
        return privatePreparation.scannedSources.filter(source => source.path !== note.path);
    }
}

/** Build a source-only retained guard without retaining the originating run. */
export function createRetainedNoteImageReadGuard(
    host: NoteImageRemovalHost,
    preparation: NoteImageRemovalPrivatePreparation,
    phase: "before_write" | "after_self_write" | "undo" = "before_write",
): TaskSourceReadGuard {
    const scope = preparation.sourceScope;
    const allowsPath = (path: string): boolean => {
        if (!isHostPathAllowed(host, path)) return false;
        if (!scope) return true;
        return (scope.allowedPaths === null || scope.allowedPaths.includes(path))
            && !scope.excludedPaths.includes(path);
    };
    return Object.freeze({
        isCurrent: () => phase === "before_write"
            ? preparation.sourceValidity()
            : preparation.sourceAuthority(),
        isPathAllowed: (path: string, kind?: string) => kind === "task_material" && allowsPath(path),
        ...(scope ? {
            getNoteSearchScope: () => {
                if (phase === "before_write" && !preparation.sourceValidity()
                    || phase !== "before_write" && !preparation.sourceAuthority()) {
                    throw new Error("Task source admission is no longer current.");
                }
                return {
                    allowedPaths: scope.allowedPaths === null ? null : [...scope.allowedPaths],
                    excludedPaths: [...scope.excludedPaths],
                };
            },
        } : {}),
        captureSourceValidity: () => phase === "before_write"
            ? preparation.sourceValidity
            : preparation.sourceAuthority,
    });
}

export async function verifyNoteImageReferenceCoverage(input: {
    host: NoteImageRemovalHost;
    guard: TaskSourceReadGuard;
    sourceValidity: () => boolean;
    selectedNote: NoteImageRemovalSourceFile;
    selectedAttachmentPath: string;
    expectedAfter: string;
}): Promise<ScopedReferenceSearch> {
    return await inspectScopedReferences(input);
}

async function inspectScopedReferences(input: {
    host: NoteImageRemovalHost;
    guard: TaskSourceReadGuard;
    sourceValidity: () => boolean;
    selectedNote: NoteImageRemovalSourceFile;
    selectedAttachmentPath: string;
    expectedAfter: string;
}): Promise<ScopedReferenceSearch> {
    type NoteScope = ReturnType<NonNullable<TaskSourceReadGuard["getNoteSearchScope"]>>;
    let scope: NoteScope | undefined;
    try {
        scope = input.guard.getNoteSearchScope?.();
    } catch {
        scope = undefined as never;
    }
    if (!scope || !Array.isArray(scope.excludedPaths)
        || (scope.allowedPaths !== null && !Array.isArray(scope.allowedPaths))) {
        return {
            conflicts: [],
            coverage: incompleteCoverage("scoped_note_scope_unavailable", 0, 0, 0, 0),
        };
    }

    let listed: readonly NoteImageRemovalSourceFile[] | null | undefined;
    try {
        listed = input.host.listSourceFiles();
    } catch {
        listed = undefined;
    }
    if (!Array.isArray(listed)) {
        return {
            conflicts: [],
            coverage: incompleteCoverage("source_inventory_unavailable", 0, 0, 0, 0),
        };
    }

    // Detach version objects at the boundary. A live TFile may retain the same
    // stat object and update mtime/size in place after this inventory read.
    const initialInventory = Object.freeze(
        listed.map(source => freezeIdentity(source) as NoteImageRemovalSourceFile),
    );

    const excluded = new Set(scope.excludedPaths);
    const allowed = scope.allowedPaths === null ? null : new Set(scope.allowedPaths);
    const byPath = new Map<string, NoteImageRemovalSourceFile>();
    let invalidInventory = false;
    for (const candidate of initialInventory) {
        if (!isValidSourceIdentity(candidate)) {
            invalidInventory = true;
            continue;
        }
        const existing = byPath.get(candidate.path);
        if (existing && existing.file !== candidate.file) {
            invalidInventory = true;
            continue;
        }
        byPath.set(candidate.path, candidate);
    }
    const outsideAllowedCount = allowed === null
        ? 0
        : [...byPath.keys()].filter(path => !allowed.has(path)).length;
    const excludedCount = [...byPath.keys()].filter(path => excluded.has(path)).length;
    let missingAllowed = 0;
    if (allowed !== null) {
        for (const path of allowed) {
            if (!excluded.has(path) && !byPath.has(path)) missingAllowed += 1;
        }
    }

    const candidates = [...byPath.values()].filter(candidate => (
        (allowed === null || allowed.has(candidate.path)) && !excluded.has(candidate.path)
    ));
    if (outsideAllowedCount > 0) {
        return {
            conflicts: [],
            coverage: Object.freeze({
                kind: "scoped_vault_search",
                complete: false,
                reason: "necessary_source_outside_allowed_scope",
            }),
        };
    }

    if (invalidInventory) {
        return genericIncompleteSearch("source_inventory_invalid");
    }
    if (excludedCount > 0) {
        return genericIncompleteSearch("sources_excluded");
    }
    if (missingAllowed > 0) {
        return genericIncompleteSearch("allowed_source_missing");
    }

    const deniedCount = candidates.filter(candidate => !isHostPathAllowed(input.host, candidate.path)).length;
    if (deniedCount > 0) {
        return genericIncompleteSearch("source_permission_unavailable");
    }
    const canvasCount = candidates.filter(candidate => candidate.extension === "canvas").length;
    const candidateCount = byPath.size;
    const conflicts: NoteImageRemovalConflict[] = [];
    const scannedSources: NoteImageRemovalSourceFile[] = [];
    let readCount = 0;
    let incomplete = false;

    for (const candidate of candidates) {
        if (!isHostPathAllowed(input.host, candidate.path)) continue;
        if (candidate.path === input.selectedNote.path && candidate.file !== input.selectedNote.file) {
            return {
                conflicts,
                coverage: incompleteCoverage("selected_note_identity_changed", candidateCount, readCount, excludedCount, canvasCount),
            };
        }
        try {
            await checkpointTaskSourceRead(input.guard);
            if (!input.sourceValidity()) {
                return {
                    conflicts,
                    coverage: incompleteCoverage("source_receipt_revoked", candidateCount, readCount, excludedCount, canvasCount),
                };
            }
            const beforeRead = input.host.getSourceFile(candidate.path);
            if (!sameIdentity(beforeRead, candidate)) {
                return {
                    conflicts,
                    coverage: incompleteCoverage("source_identity_changed_before_read", candidateCount, readCount, excludedCount, canvasCount),
                };
            }
            const content = candidate.path === input.selectedNote.path
                ? input.expectedAfter
                : await input.host.readSourceFile(candidate);
            await checkpointTaskSourceRead(input.guard);
            if (!input.sourceValidity()) {
                return {
                    conflicts,
                    coverage: incompleteCoverage("source_receipt_revoked", candidateCount, readCount, excludedCount, canvasCount),
                };
            }
            const afterRead = input.host.getSourceFile(candidate.path);
            if (!sameIdentity(afterRead, candidate)) {
                return {
                    conflicts,
                    coverage: incompleteCoverage("source_identity_changed_after_read", candidateCount, readCount, excludedCount, canvasCount),
                };
            }
            const parsed = collectSourceReferences(candidate, content);
            if (parsed.unsupported) {
                incomplete = true;
                continue;
            }
            for (const reference of parsed.references) {
                const link = parseLinktextSafely(input.host, reference.target);
                if (!isLocalLinkpath(link.path)) continue;
                const destination = input.host.resolveImageDestination(link.path, candidate.path);
                if (!destination || !isImagePath(destination.path)) continue;
                if (destination.path === input.selectedAttachmentPath) {
                    conflicts.push(Object.freeze({
                        sourcePath: candidate.path,
                        syntax: reference.syntax,
                        remainsInSelectedNote: candidate.path === input.selectedNote.path,
                    }));
                }
            }
            readCount += 1;
            scannedSources.push(candidate);
        } catch {
            return {
                conflicts,
                coverage: incompleteCoverage(
                    candidate.extension === "canvas" ? "canvas_read_failed" : "note_read_failed",
                    candidateCount,
                    readCount,
                    excludedCount,
                    canvasCount,
                ),
            };
        }
    }

    try {
        await checkpointTaskSourceRead(input.guard);
        if (!input.sourceValidity()) {
            return {
                conflicts,
                coverage: incompleteCoverage("source_receipt_revoked", candidateCount, readCount, excludedCount, canvasCount),
            };
        }
        const finalScope = input.guard.getNoteSearchScope?.();
        if (!finalScope
            || !sameStringSet(finalScope.allowedPaths, scope.allowedPaths)
            || !sameStringSet(finalScope.excludedPaths, scope.excludedPaths)) {
            return {
                conflicts,
                coverage: incompleteCoverage("source_scope_changed_after_scan", candidateCount, readCount, excludedCount, canvasCount),
            };
        }
        const finalInventory = readInventory(input.host);
        if (!finalInventory || !sameInventory(finalInventory, initialInventory)) {
            return {
                conflicts,
                coverage: incompleteCoverage("source_inventory_changed_after_scan", candidateCount, readCount, excludedCount, canvasCount),
            };
        }
    } catch {
        return {
            conflicts,
            coverage: incompleteCoverage("source_scan_freshness_unavailable", candidateCount, readCount, excludedCount, canvasCount),
        };
    }

    return {
        conflicts: Object.freeze(conflicts),
        coverage: Object.freeze({
            kind: "scoped_vault_search",
            complete: !incomplete,
            candidateCount,
            readCount,
            excludedCount,
            canvasCount,
            ...(incomplete ? { reason: "reference_check_incomplete" } : {}),
        }),
        evidence: Object.freeze({
            scannedSources: Object.freeze(scannedSources.map(source => freezeIdentity(source) as NoteImageRemovalSourceFile)),
            inventorySnapshot: initialInventory,
            sourceScope: Object.freeze({
                allowedPaths: scope.allowedPaths === null ? null : Object.freeze([...scope.allowedPaths]),
                excludedPaths: Object.freeze([...scope.excludedPaths]),
            }),
        }),
    };
}

function collectSourceReferences(
    source: NoteImageRemovalSourceFile,
    content: string,
): { references: readonly ParsedReference[]; unsupported: boolean } {
    if (source.extension === "canvas") return collectCanvasReferences(content);
    const analysis = analyzeMarkdownReferences(content);
    return { references: analysis.references, unsupported: analysis.unsupported };
}

function collectCanvasReferences(content: string): { references: readonly ParsedReference[]; unsupported: boolean } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { references: [], unsupported: true };
    }
    const nodes = (parsed as { nodes?: unknown })?.nodes;
    if (!Array.isArray(nodes)) return { references: [], unsupported: true };
    const references: ParsedReference[] = [];
    let unsupported = false;
    for (const node of nodes) {
        const record = node as { type?: unknown; file?: unknown; text?: unknown };
        const file = record.file;
        if (typeof file === "string" && file.trim()) references.push({ syntax: "wiki-link", target: file });
        if (record.type === "text" && typeof record.text === "string") {
            const textAnalysis = analyzeMarkdownReferences(record.text);
            references.push(...textAnalysis.references);
            unsupported ||= textAnalysis.unsupported;
        }
    }
    return { references: Object.freeze(references), unsupported };
}

function selectReference(content: string, selector: string): SelectedReference {
    const analysis = analyzeMarkdownReferences(content);
    const parsed = parseSelector(selector, analysis.definitions);
    if (!parsed) {
        throw new NoteImageRemovalPreparationError(
            "selector_invalid",
            "imageReference must be an exact supported Markdown image or image-link reference.",
        );
    }
    const active = analysis.active;
    const inlineCode = analysis.inlineCode;
    const htmlNonRendered = analysis.htmlNonRendered;
    const occurrences: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    while (cursor <= content.length) {
        const start = content.indexOf(selector, cursor);
        if (start < 0) break;
        const end = start + selector.length;
        if (rangeIsInactive(inlineCode, start, end)) {
            throw new NoteImageRemovalPreparationError(
                "target_missing",
                "The selected image reference is inside inline code and cannot be deleted as note content.",
            );
        }
        if (rangeIsInactive(htmlNonRendered, start, end)) {
            throw new NoteImageRemovalPreparationError(
                "target_missing",
                "The selected image reference is in non-rendered HTML and cannot be deleted as note content.",
            );
        }
        if (rangeIsActive(active, start, end)) {
            occurrences.push({ start, end });
        }
        cursor = start + 1;
    }
    if (occurrences.length === 0) {
        throw new NoteImageRemovalPreparationError(
            "target_missing",
            "The exact selected image reference is not present in the current note source.",
        );
    }
    if (occurrences.length > 1) {
        throw new NoteImageRemovalPreparationError(
            "ambiguous_target",
            "The exact selected image reference occurs more than once; a unique selection is required.",
        );
    }
    return { ...parsed, ...occurrences[0]! };
}

function parseSelector(
    selector: string,
    definitions: MarkdownReferenceDefinitions,
): ParsedReference | null {
    const wiki = /^(!?)\[\[([^[\]\n]+)\]\]$/.exec(selector);
    if (wiki) {
        return {
            syntax: wiki[1] === "!" ? "wiki-embed" : "wiki-link",
            target: (wiki[2] ?? "").split("|")[0] ?? "",
        };
    }
    const markdown = /^(!?)\[([^[\]\n]*)\]\(\s*(?:<([^<>\n]+)>|([^)\s]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)$/.exec(selector);
    if (markdown) {
        return {
            syntax: markdown[1] === "!" ? "markdown-image" : "markdown-link",
            target: decodeDestination(markdown[3] ?? markdown[4] ?? ""),
        };
    }
    const reference = /^(!?)\[([^[\]\n]*)\]\[([^[\]\n]*)\]$/.exec(selector);
    if (reference) {
        const label = (reference[3] || reference[2] || "").trim().toUpperCase();
        const definition = definitions[label];
        if (!definition?.href) return null;
        return {
            syntax: reference[1] === "!"
                ? "markdown-reference-image"
                : "markdown-reference-link",
            target: decodeDestination(definition.href),
        };
    }
    return null;
}

function removeSelectedReference(content: string, selected: SelectedReference): string {
    const lineStart = content.lastIndexOf("\n", selected.start - 1) + 1;
    const nextLineBreak = content.indexOf("\n", selected.end);
    const lineEnd = nextLineBreak < 0 ? content.length : nextLineBreak;
    const prefix = content.slice(lineStart, selected.start);
    const suffix = content.slice(selected.end, lineEnd);
    const soleImageLine = /^[>\s]*$/.test(prefix) && suffix.trim().length === 0;
    if (soleImageLine) {
        const removeEnd = nextLineBreak < 0 ? lineEnd : nextLineBreak + 1;
        return content.slice(0, lineStart) + content.slice(removeEnd);
    }
    return content.slice(0, selected.start) + content.slice(selected.end);
}

function markRange(active: Uint8Array, start: number, end: number): void {
    for (let index = Math.max(0, start); index < Math.min(active.length, end); index += 1) active[index] = 0;
}

function rangeIsActive(active: Uint8Array, start: number, end: number): boolean {
    if (start < 0 || end > active.length || end <= start) return false;
    for (let index = start; index < end; index += 1) {
        if (!active[index]) return false;
    }
    return true;
}

function rangeIsInactive(mask: Uint8Array, start: number, end: number): boolean {
    if (start < 0 || end > mask.length || end <= start) return false;
    for (let index = start; index < end; index += 1) {
        if (mask[index]) return false;
    }
    return true;
}

function analyzeMarkdownReferences(content: string): SourceAnalysis {
    const active = new Uint8Array(content.length).fill(1);
    // One means ordinary source; zero marks the unresolved source-line range
    // occupied by inline code. `rangeIsInactive` identifies the marked range.
    const inlineCode = new Uint8Array(content.length).fill(1);
    const htmlNonRendered = new Uint8Array(content.length).fill(1);
    // The installed MarkdownIt typings model the parser environment as `any`;
    // keep this boundary local and validate resolved href strings below.
    const referenceDefinitions = {} as unknown as Record<string, { href?: unknown; title?: unknown }>;
    const env = { references: referenceDefinitions } as unknown as Parameters<typeof markdownParser.parse>[1];
    const tokens = markdownParser.parse(content, env);
    const references: ParsedReference[] = [];
    let unsupported = false;
    let parsedReferenceUses = 0;
    const lineStarts = physicalLineStarts(content);
    const visit = (token: Token, inlineParent?: Token): void => {
        if ((token.type === "fence" || token.type === "code_block") && token.map) {
            markRange(active, lineStarts[token.map[0]] ?? 0, lineStarts[token.map[1]] ?? content.length);
        }
        if (token.type === "inline") {
            for (const child of token.children ?? []) visit(child, token);
            return;
        }
        if (token.type === "code_inline" && inlineParent?.map) {
            // Inline-code source ranges are not uniquely mapped by the stock
            // parser. Mark the whole source line unresolved and fail closed if
            // it also contains a candidate reference.
            markRange(inlineCode, lineStarts[inlineParent.map[0]] ?? 0, lineStarts[inlineParent.map[1]] ?? content.length);
        }
        if ((token.type === "html_inline" || token.type === "html_block") && /<\s*img\b/i.test(token.content)) {
            unsupported = true;
        }
        if ((token.type === "html_inline" || token.type === "html_block") && inlineParent?.map) {
            const start = lineStarts[inlineParent.map[0]] ?? 0;
            const end = lineStarts[inlineParent.map[1]] ?? content.length;
            markRange(active, start, end);
            markRange(htmlNonRendered, start, end);
        }
        if (token.type === "html_block" && token.map) {
            const start = lineStarts[token.map[0]] ?? 0;
            const end = lineStarts[token.map[1]] ?? content.length;
            markRange(active, start, end);
            markRange(htmlNonRendered, start, end);
        }
        if (token.type === "image") {
            const destination = token.attrGet("src");
            if (typeof destination === "string" && destination) {
                references.push({
                    syntax: token.meta?.label ? "markdown-reference-image" : "markdown-image",
                    target: decodeDestination(destination),
                });
            }
            if (token.meta?.label) parsedReferenceUses += 1;
        }
        if (token.type === "link_open") {
            const destination = token.attrGet("href");
            if (typeof destination === "string" && destination) {
                references.push({
                    syntax: token.meta?.label ? "markdown-reference-link" : "markdown-link",
                    target: decodeDestination(destination),
                });
            }
            if (token.meta?.label) parsedReferenceUses += 1;
        }
        for (const child of token.children ?? []) visit(child, inlineParent);
    };
    for (const token of tokens) visit(token);

    for (const match of content.matchAll(WIKI_REFERENCE_PATTERN)) {
        const start = match.index ?? -1;
        const end = start + match[0].length;
        if (rangeIsInactive(inlineCode, start, end)) {
            // The stock parser gives only the parent paragraph range for inline
            // code. A wiki candidate in that uncertain range cannot be proven
            // to be code, so it must block complete coverage rather than vanish.
            unsupported = true;
            continue;
        }
        if (rangeIsInactive(htmlNonRendered, start, end)) {
            unsupported = true;
            continue;
        }
        if (!rangeIsActive(active, start, end)) continue;
        references.push({
            syntax: match[1] === "!" ? "wiki-embed" : "wiki-link",
            target: (match[2] ?? "").split("|")[0] ?? "",
        });
    }
    let rawReferenceUses = 0;
    for (const match of content.matchAll(MARKDOWN_REFERENCE_USE_PATTERN)) {
        const start = match.index ?? -1;
        const end = start + match[0].length;
        if (rangeIsInactive(inlineCode, start, end)) {
            unsupported = true;
            continue;
        }
        if (rangeIsInactive(htmlNonRendered, start, end)) {
            unsupported = true;
            continue;
        }
        if (rangeIsActive(active, start, end)) rawReferenceUses += 1;
    }
    if (rawReferenceUses > parsedReferenceUses) unsupported = true;
    return {
        active,
        inlineCode,
        htmlNonRendered,
        references: Object.freeze(references),
        definitions: Object.fromEntries(
            Object.entries(referenceDefinitions).flatMap(([label, definition]) => (
                typeof definition?.href === "string" && definition.href
                    ? [[label, { href: definition.href }]]
                    : []
            )),
        ),
        unsupported,
    };
}

function physicalLineStarts(content: string): number[] {
    const starts = [0];
    for (let index = content.indexOf("\n"); index >= 0; index = content.indexOf("\n", index + 1)) {
        starts.push(index + 1);
    }
    return starts;
}

function getSourceIdentity(
    host: NoteImageRemovalHost,
    path: string,
    extension: "md",
): NoteImageRemovalSourceFile {
    let source: NoteImageRemovalSourceFile | null | undefined;
    try {
        source = host.getSourceFile(path);
    } catch {
        source = undefined;
    }
    if (!source || source.path !== path || source.extension !== extension || !isValidSourceIdentity(source)) {
        throw new NoteImageRemovalPreparationError(
            "target_missing",
            `The selected note identity is unavailable: ${path}`,
        );
    }
    return freezeIdentity(source) as NoteImageRemovalSourceFile;
}

function resolveAttachment(
    host: NoteImageRemovalHost,
    linkpath: string,
    sourcePath: string,
): NoteImageRemovalAttachmentFile {
    let attachment: NoteImageRemovalAttachmentFile | null | undefined;
    try {
        attachment = host.resolveImageDestination(linkpath, sourcePath);
    } catch {
        attachment = undefined;
    }
    if (!attachment || !isImagePath(attachment.path)
        || !isValidFileIdentity(attachment)) {
        throw new NoteImageRemovalPreparationError(
            "target_missing",
            "The selected reference does not resolve to one live local image attachment.",
        );
    }
    return freezeIdentity(attachment) as NoteImageRemovalAttachmentFile;
}

function parseLinktextSafely(host: NoteImageRemovalHost, linktext: string): { path: string; subpath: string } {
    try {
        const parsed = host.parseLinktext(linktext);
        if (typeof parsed.path !== "string" || typeof parsed.subpath !== "string") throw new Error("invalid");
        return parsed;
    } catch {
        throw new NoteImageRemovalPreparationError(
            "selector_invalid",
            "The Host link parser did not return a valid local linkpath.",
        );
    }
}

function assertLocalLinkpath(linkpath: string, selector: string): void {
    if (!isLocalLinkpath(linkpath)) {
        throw new NoteImageRemovalPreparationError(
            "selector_invalid",
            "imageReference must select a local vault attachment, not an external link.",
        );
    }
    if (!isImagePath(linkpath)) {
        throw new NoteImageRemovalPreparationError(
            "selector_invalid",
            `imageReference does not resolve to a supported image attachment: ${selector}`,
        );
    }
}

function isLocalLinkpath(linkpath: string): boolean {
    return typeof linkpath === "string" && linkpath.length > 0 && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(linkpath);
}

function isImagePath(path: string): boolean {
    const extension = path.split(".").pop()?.toLowerCase();
    return typeof extension === "string" && IMAGE_EXTENSIONS.has(extension);
}

function decodeDestination(destination: string): string {
    try {
        return decodeURIComponent(destination);
    } catch {
        return destination;
    }
}

function isValidSourceIdentity(value: unknown): value is NoteImageRemovalSourceFile {
    return isValidFileIdentity(value)
        && (value.extension === "md" || value.extension === "canvas")
        && /\.(md|canvas)$/i.test(value.path);
}

function isValidFileIdentity(value: unknown): value is NoteImageRemovalFileIdentity {
    return !!value && typeof value === "object"
        && typeof (value as NoteImageRemovalFileIdentity).path === "string"
        && typeof (value as NoteImageRemovalFileIdentity).extension === "string"
        && !!((value as NoteImageRemovalFileIdentity).path)
        && typeof (value as NoteImageRemovalFileIdentity).file === "object"
        && isVersion((value as NoteImageRemovalFileIdentity).version);
}

function isVersion(value: unknown): value is NoteImageRemovalFileIdentity["version"] {
    if (!value || typeof value !== "object") return false;
    const version = value as { mtime?: unknown; size?: unknown };
    return Number.isFinite(version.mtime) && (version.mtime as number) >= 0
        && Number.isInteger(version.size) && (version.size as number) >= 0;
}

function freezeIdentity<T extends NoteImageRemovalFileIdentity>(identity: T): T {
    return Object.freeze({
        ...identity,
        version: Object.freeze({ ...identity.version }),
    });
}

function isHostPathAllowed(host: NoteImageRemovalHost, path: string): boolean {
    try {
        return host.isPathAllowed(path) === true;
    } catch {
        return false;
    }
}

function isAttachmentPathAllowed(host: NoteImageRemovalHost, path: string): boolean {
    try {
        return host.isAttachmentPathAllowed(path) === true;
    } catch {
        return false;
    }
}

function assertHostPathAllowed(host: NoteImageRemovalHost, path: string): void {
    if (!isHostPathAllowed(host, path)) {
        throw new NoteImageRemovalPreparationError(
            "source_denied",
            "The selected source is denied by the current Data Boundary.",
        );
    }
}

function assertSameSourceIdentity(
    host: NoteImageRemovalHost,
    expected: NoteImageRemovalSourceFile,
): void {
    if (!sameIdentity(host.getSourceFile(expected.path), expected)) {
        throw new NoteImageRemovalPreparationError(
            "target_missing",
            "The selected note identity or version changed while its source was read.",
        );
    }
}

function sameIdentity(
    current: NoteImageRemovalFileIdentity | null | undefined,
    expected: NoteImageRemovalFileIdentity,
): boolean {
    return !!current
        && current.path === expected.path
        && current.extension === expected.extension
        && current.file === expected.file
        && current.version.mtime === expected.version.mtime
        && current.version.size === expected.version.size;
}

function readInventory(host: NoteImageRemovalHost): readonly NoteImageRemovalSourceFile[] | undefined {
    try {
        const inventory = host.listSourceFiles();
        return Array.isArray(inventory) && inventory.every(isValidSourceIdentity)
            ? inventory
            : undefined;
    } catch {
        return undefined;
    }
}

function sameInventory(
    current: readonly NoteImageRemovalSourceFile[],
    expected: readonly NoteImageRemovalSourceFile[],
): boolean {
    if (current.length !== expected.length) return false;
    const expectedByPath = new Map(expected.map(source => [source.path, source]));
    return current.every(source => {
        const prior = expectedByPath.get(source.path);
        return !!prior && sameIdentity(source, prior);
    });
}

function sameStringSet(
    current: readonly string[] | null,
    expected: readonly string[] | null,
): boolean {
    if (current === null || expected === null) return current === expected;
    return current.length === expected.length && new Set(current).size === new Set(expected).size
        && [...new Set(current)].every(path => new Set(expected).has(path));
}

function genericIncompleteCoverage(reason: string): NoteImageRemovalCoverage {
    return Object.freeze({
        kind: "scoped_vault_search",
        complete: false,
        reason,
    });
}

function genericIncompleteSearch(reason: string): ScopedReferenceSearch {
    return { conflicts: [], coverage: genericIncompleteCoverage(reason) };
}

function incompleteCoverage(
    reason: string,
    candidateCount: number,
    readCount: number,
    excludedCount: number,
    canvasCount: number,
): NoteImageRemovalCoverage {
    return Object.freeze({
        kind: "scoped_vault_search",
        complete: false,
        candidateCount,
        readCount,
        excludedCount,
        canvasCount,
        reason,
    });
}

function assertIdentification(options: PrepareNoteImageRemovalOptions): void {
    if (!options.runId.trim() || !options.turnId.trim() || !options.toolCallId.trim()) {
        throw new NoteImageRemovalPreparationError(
            "selector_invalid",
            "runId, turnId, and toolCallId are required for an internal note-image proposal.",
        );
    }
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}
