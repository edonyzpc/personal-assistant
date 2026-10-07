import { stableHash } from "../pa/helpers";
import { getPlatformCrypto } from "../platform-dom";
import { buildGhostPublishingFields, PA_GENERATED_FEATURE_IMAGE_CAPTION } from "./fields";
import { buildRecipeInjection } from "./recipe";
import { loadGhostSourceTree } from "./source-loader";
import { prepareMainBodyForExport } from "./source-cleanup";
import { convertMarkdownToLexical } from "./markdown-exporter";
import type {
    GhostExportResult,
    GhostPublishingHost,
    GhostPublishingSourceGuard,
    SitePublishingProfile,
    WikiLinkTarget,
    WikiLinkOccurrence,
} from "./types";

async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await getPlatformCrypto()!.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export interface PrepareGhostExportOptions {
    targetPath: string;
    host: GhostPublishingHost;
    guard: GhostPublishingSourceGuard;
    siteProfile: SitePublishingProfile;
    wikiLinks?: Record<string, WikiLinkTarget>;
    resolveWikiLinks?(links: readonly WikiLinkOccurrence[]): Promise<Record<string, WikiLinkTarget>>;
}

export async function prepareGhostExport(options: PrepareGhostExportOptions): Promise<GhostExportResult> {
    const source = await loadGhostSourceTree(options.targetPath, options.host, options.guard);
    const fields = buildGhostPublishingFields(source.frontmatter, source.targetPath);
    const preparedBody = prepareMainBodyForExport({
        markdown: source.markdown,
        sourceMap: source.sourceMap,
        sourcePath: source.targetPath,
        fields,
    });
    const conversion = {
        markdown: preparedBody.markdown,
        sourceMap: source.sourceMap,
        sourcePath: source.targetPath,
        host: options.host,
        fields,
        fieldOrigins: { featureImage: preparedBody.featureImageOrigin },
        wikiLinks: options.wikiLinks,
    };
    let converted = convertMarkdownToLexical(conversion);
    if (options.resolveWikiLinks && converted.wikiLinkOccurrences.length > 0) {
        const wikiLinks = await options.resolveWikiLinks(converted.wikiLinkOccurrences);
        converted = convertMarkdownToLexical({ ...conversion, wikiLinks });
    }

    if (converted.fieldResourceReferences.featureImage) {
        fields.featureImage = {
            mode: "manage",
            value: converted.fieldResourceReferences.featureImage,
        };
        const cover = converted.resources.find(resource => `pending-resource://${resource.id}` === fields.featureImage.value);
        const declaredByPa = cover && preparedBody.paFeatureImageSources.some(imageSource =>
            imageSource.trim() === cover.source || cover.kind === "local" && cover.resolvedPath
                && options.host.metadataCache?.getFirstLinkpathDest?.(imageSource, source.targetPath)?.path === cover.resolvedPath);
        if (declaredByPa) fields.featureImageCaption = { mode: "manage", value: PA_GENERATED_FEATURE_IMAGE_CAPTION };
    }

    const warnings = [...converted.warnings];
    const recipe = buildRecipeInjection(converted.capabilities, options.siteProfile);
    const knownLanguages = new Set(recipe.selection.prismLanguages);
    for (const language of converted.capabilities.codeLanguages) {
        if (!knownLanguages.has(language)) {
            warnings.push({
                code: "unknown-highlight-language",
                path: source.targetPath,
                line: 0,
                message: `Code is preserved, but highlight grammar is not in the fixed recipe: ${language}`,
            });
        }
    }

    const identity = {
        schemaVersion: 1,
        source: source.dependencies,
        lexical: converted.lexical,
        blocks: converted.blocks,
        fields,
        resources: converted.resources,
        capabilities: converted.capabilities,
        recipe: {
            selection: recipe.selection,
            headHash: stableHash(recipe.head),
            footHash: stableHash(recipe.foot),
        },
        siteProfile: {
            siteId: options.siteProfile.siteId,
            manualHeadHash: stableHash(options.siteProfile.manualHeadInjection ?? ""),
            manualFootHash: stableHash(options.siteProfile.manualFootInjection ?? ""),
        },
    };
    const candidateHash = await sha256(JSON.stringify(identity));
    if (!options.guard.isCurrent()
        || options.guard.isPathAllowed(source.targetPath, "task_material") !== true
        || options.guard.isNoteDomainAllowed?.() === false
        || source.sourceValidity() !== true) {
        throw new Error("Source guard became invalid before Ghost export candidate identity was fixed.");
    }

    return {
        sourceManifest: {
            targetPath: source.targetPath,
            dependencies: source.dependencies,
        },
        lexical: converted.lexical,
        blocks: converted.blocks,
        fields,
        resources: converted.resources,
        capabilities: converted.capabilities,
        recipe,
        warnings,
        candidateHash,
    };
}
