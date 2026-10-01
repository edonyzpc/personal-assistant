import { GhostExportError } from "./errors";
import { isValidGhostSlug } from "./slug";
import type { GhostPublishingFields, ManagedFieldValue } from "./types";

export const GHOST_CUSTOM_EXCERPT_MAX = 300;
export const GHOST_META_DESCRIPTION_MAX = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): ManagedFieldValue<string> {
    if (value === undefined) return { mode: "unmanaged" };
    if (value === null || (typeof value === "string" && value.trim() === "")) return { mode: "clear" };
    if (typeof value !== "string") {
        throw new GhostExportError("field-invalid", `ghost.${field} must be a string or null.`);
    }
    return { mode: "manage", value };
}

function boundedStringField(value: unknown, field: string, maxLength: number): ManagedFieldValue<string> {
    const result = stringField(value, field);
    if (result.mode === "manage" && Array.from(result.value ?? "").length > maxLength) {
        throw new GhostExportError("field-invalid", `${field} exceeds Ghost's ${maxLength}-character limit.`);
    }
    return result;
}

function nonemptyOrdinaryString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function slugField(frontmatter: Record<string, unknown>, source: Record<string, unknown>): ManagedFieldValue<string> {
    const hasTopLevel = Object.prototype.hasOwnProperty.call(frontmatter, "ghost_slug");
    const hasLegacy = Object.prototype.hasOwnProperty.call(source, "slug");
    const value = hasTopLevel ? frontmatter.ghost_slug : source.slug;
    if (hasTopLevel && hasLegacy && frontmatter.ghost_slug !== source.slug) {
        throw new GhostExportError("field-invalid", "ghost_slug and ghost.slug must match when both are present.");
    }
    if (!hasTopLevel && !hasLegacy) return { mode: "unmanaged" };
    if (typeof value !== "string" || !isValidGhostSlug(value)) {
        throw new GhostExportError("field-invalid", "Ghost slug must be 1-80 lowercase ASCII words separated by single hyphens.");
    }
    return { mode: "manage", value };
}

function tagsField(value: unknown): ManagedFieldValue<string[]> {
    if (value === undefined) return { mode: "unmanaged" };
    if (value === null) return { mode: "clear" };
    if (Array.isArray(value)) {
        if (value.length === 0) return { mode: "clear" };
        if (!value.every((item): item is string => typeof item === "string")) {
            throw new GhostExportError("field-invalid", "ghost.tags must contain only strings.");
        }
        return { mode: "manage", value };
    }
    if (typeof value === "string") {
        return value.trim() === ""
            ? { mode: "clear" }
            : { mode: "manage", value: [value] };
    }
    throw new GhostExportError("field-invalid", "ghost.tags must be a string array or null.");
}

export function buildGhostPublishingFields(
    frontmatter: Record<string, unknown>,
    sourcePath: string,
): GhostPublishingFields {
    const options = frontmatter.ghost;
    if (options !== undefined && !isRecord(options)) {
        throw new GhostExportError("field-invalid", "ghost frontmatter must be a mapping.");
    }
    const source = options ?? {};
    const filename = sourcePath.split("/").pop() ?? sourcePath;
    const title = stringField(source.title, "title");
    const ordinaryFeatureImage = nonemptyOrdinaryString(frontmatter.feature_image);
    const ordinaryExcerpt = nonemptyOrdinaryString(frontmatter.excerpt);
    return {
        title: title.mode === "unmanaged"
            ? { mode: "manage", value: filename.replace(/\.md$/i, "") }
            : title,
        slug: slugField(frontmatter, source),
        tags: tagsField(source.tags),
        featureImage: source.feature_image !== undefined
            ? stringField(source.feature_image, "feature_image")
            : ordinaryFeatureImage === undefined
                ? { mode: "unmanaged" }
                : { mode: "manage", value: ordinaryFeatureImage },
        customExcerpt: source.custom_excerpt !== undefined
            ? boundedStringField(source.custom_excerpt, "ghost.custom_excerpt", GHOST_CUSTOM_EXCERPT_MAX)
            : ordinaryExcerpt === undefined
                ? { mode: "unmanaged" }
                : boundedStringField(ordinaryExcerpt, "excerpt", GHOST_CUSTOM_EXCERPT_MAX),
        metaDescription: boundedStringField(source.meta_description, "ghost.meta_description", GHOST_META_DESCRIPTION_MAX),
    };
}

export function ghostFieldsForCandidate(fields: GhostPublishingFields): {
    title: string;
    slug?: string;
    tags?: string[] | null;
    feature_image?: string | null;
    custom_excerpt?: string | null;
    meta_description?: string | null;
} {
    if (fields.title.mode !== "manage" || typeof fields.title.value !== "string") {
        throw new GhostExportError("field-invalid", "A managed title is required.");
    }
    return {
        title: fields.title.value,
        slug: fields.slug.mode === "manage" && typeof fields.slug.value === "string" ? fields.slug.value : undefined,
        tags: fields.tags.mode === "unmanaged" ? undefined : fields.tags.mode === "clear" ? null : fields.tags.value,
        feature_image: fields.featureImage.mode === "unmanaged"
            ? undefined
            : fields.featureImage.mode === "clear"
                ? null
                : fields.featureImage.value,
        custom_excerpt: fields.customExcerpt.mode === "unmanaged"
            ? undefined
            : fields.customExcerpt.mode === "clear"
                ? null
                : fields.customExcerpt.value,
        meta_description: fields.metaDescription.mode === "unmanaged"
            ? undefined
            : fields.metaDescription.mode === "clear"
                ? null
                : fields.metaDescription.value,
    };
}
