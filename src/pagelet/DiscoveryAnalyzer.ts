import type { DiscoveryResult, NoteConnection } from "./panel/types";
import type { StructuredFinding } from "./llm/types";

export type DiscoveryLLMCallback = (
    currentNote: { path: string; content: string },
    relatedNotes: Array<{ path: string; content: string }>,
) => Promise<DiscoveryResult | null>;

export type FindRelatedNotesCallback = (
    primarySourcePath: string,
    noteContents: Array<{ path: string; content: string }>,
    sourcePaths: readonly string[],
) => Promise<Array<{ path: string; content: string; score?: number; headingPath?: string[] }>>;

export function buildDiscoveryResultFromFindings(
    findings: readonly StructuredFinding[],
    currentNotePath: string,
): DiscoveryResult {
    const connections: NoteConnection[] = findings
        .filter((f) => f.category === "connection")
        .map((f) => ({
            fromNote: currentNotePath,
            toNote: f.sourceFile || "",
            strength: "medium" as const,
            sharedConcepts: [f.text],
        }));
    return {
        connections,
        themes: [],
        gaps: findings
            .filter((f) => f.category === "gap")
            .map((f) => ({ topic: f.sourceTitle || "", description: f.text })),
    };
}
