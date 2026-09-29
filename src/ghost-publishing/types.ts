import type { TaskSourceReadGuard } from "../ai-services/task-source-read-guard";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface LexicalNodeJson {
    type: string;
    version: number;
    [key: string]: JsonValue;
}

export interface LexicalDocumentJson {
    root: {
        type: "root";
        version: 1;
        direction: null;
        format: "";
        indent: 0;
        children: LexicalNodeJson[];
    };
}

export type GhostPublishingSourceGuard = TaskSourceReadGuard;

export interface GhostPublishingSourceFile {
    path: string;
    name?: string;
    basename?: string;
    extension: string;
    stat?: { mtime?: number; size?: number; ctime?: number };
}

export interface GhostSubpathResult {
    type: "heading" | "block" | "footnote";
    start: { line: number; col: number; offset?: number };
    end: { line: number; col: number; offset?: number } | null;
}

export interface GhostPublishingCachedMetadata {
    headings?: Array<{ heading: string; level: number; position?: { start: { line: number; col: number }; end?: { line: number; col: number } } }>;
    blocks?: Record<string, { id?: string; position?: { start: { line: number; col: number }; end?: { line: number; col: number } } }>;
    frontmatter?: Record<string, unknown>;
}

export interface GhostPublishingHost {
    vault: {
        read(file: GhostPublishingSourceFile): Promise<string>;
        getAbstractFileByPath?(path: string): GhostPublishingSourceFile | null;
    };
    metadataCache?: {
        getFirstLinkpathDest?(linkpath: string, sourcePath: string): GhostPublishingSourceFile | null;
        getFileCache?(file: GhostPublishingSourceFile): GhostPublishingCachedMetadata | null;
    };
    parseYaml(yaml: string): unknown;
    resolveSubpath?(cache: GhostPublishingCachedMetadata, subpath: string): GhostSubpathResult | null;
}

export interface SourceDependency {
    path: string;
    kind: "main" | "embed";
    subpath: "" | "heading" | "block";
    subpathValue?: string;
    contentHash: string;
    mtime?: number;
    size?: number;
}

export interface SourceMapSpan {
    start: number;
    end: number;
    path: string;
    dependencyIndex: number;
    sourceLine: number;
}

export interface LoadedSourceTree {
    targetPath: string;
    markdown: string;
    frontmatter: Record<string, unknown>;
    dependencies: SourceDependency[];
    sourceMap: SourceMapSpan[];
    sourceValidity: () => boolean;
}

export type ManagedFieldMode = "unmanaged" | "clear" | "manage";

export interface ManagedFieldValue<T> {
    mode: ManagedFieldMode;
    value?: T;
}

export interface GhostPublishingFields {
    title: ManagedFieldValue<string>;
    tags: ManagedFieldValue<string[]>;
    featureImage: ManagedFieldValue<string>;
    customExcerpt: ManagedFieldValue<string>;
}

export type ResourceKind = "local" | "remote" | "unresolved";

export interface ExportResourcePlan {
    id: string;
    kind: ResourceKind;
    source: string;
    resolvedPath?: string;
    alt: string;
    title?: string;
    caption?: string;
    occurrences: Array<{
        path: string;
        line: number;
        field?: "feature_image";
    }>;
}

export interface ExportBlock {
    id: string;
    nodeKind: string;
    sourcePath: string;
    sourceDependencyIndex: number;
    sourceStartLine: number;
    sourceEndLine: number;
    sourceHash: string;
    semanticSignature: string;
    nodeIndex: number;
}

export type BaselineExportBlock = ExportBlock & {
    remoteBlockId?: string;
};

export interface RemoteExportBlock {
    id: string;
    semanticSignature: string;
    node: LexicalNodeJson;
}

export interface ExportCapabilities {
    codeLanguages: string[];
    hasMermaid: boolean;
    hasInlineMath: boolean;
    hasDisplayMath: boolean;
}

export interface SiteLibraryProfile {
    compatible: boolean;
    version?: string;
    evidence: "settings-whitelist" | "page-check" | "unknown";
    initialization?: "auto" | "explicit" | "unknown";
}

export interface SitePublishingProfile {
    siteId: string;
    prism?: SiteLibraryProfile;
    mermaid?: SiteLibraryProfile;
    katex?: SiteLibraryProfile;
    manualHeadInjection?: string;
    manualFootInjection?: string;
}

export interface RecipeAsset {
    url: string;
    integrity: string;
}

export interface RecipeSelection {
    version: "b153-v1";
    needsPrism: boolean;
    loadsPrism: boolean;
    initializesPrism: boolean;
    prismLanguages: string[];
    needsMermaid: boolean;
    loadsMermaid: boolean;
    initializesMermaid: boolean;
    needsKatex: boolean;
    loadsKatex: boolean;
    initializesKatex: boolean;
    reuse: {
        prism: boolean;
        mermaid: boolean;
        katex: boolean;
    };
    headAssets: RecipeAsset[];
    footAssets: RecipeAsset[];
    contentHash: string;
}

export interface GhostPublishingRecipeInjection {
    head: string;
    foot: string;
    selection: RecipeSelection;
    manualHeadPreserved: boolean;
    manualFootPreserved: boolean;
}

export interface WikiLinkTarget {
    status: "published" | "unpublished" | "missing" | "ambiguous";
    url?: string;
    anchor?: string;
    anchorFallback?: boolean;
}

export interface WikiLinkOccurrence { target: string; sourcePath: string; line: number; }

export interface ExportWarning {
    code:
        | "unresolved-wiki-link"
        | "unpublished-wiki-link"
        | "ambiguous-wiki-link"
        | "wiki-link-anchor-fallback"
        | "unknown-highlight-language"
        | "profile-page-check-required";
    path: string;
    line: number;
    message: string;
}

export interface GhostExportResult {
    sourceManifest: {
        targetPath: string;
        dependencies: SourceDependency[];
    };
    lexical: LexicalDocumentJson;
    blocks: ExportBlock[];
    fields: GhostPublishingFields;
    resources: ExportResourcePlan[];
    capabilities: ExportCapabilities;
    recipe: GhostPublishingRecipeInjection;
    warnings: ExportWarning[];
    candidateHash: string;
}
