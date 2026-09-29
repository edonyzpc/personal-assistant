import { GhostExportError } from "./errors";
import type { GhostPublishingFields, ManagedFieldValue } from "./types";

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
    return {
        title: title.mode === "unmanaged"
            ? { mode: "manage", value: filename.replace(/\.md$/i, "") }
            : title,
        tags: tagsField(source.tags),
        featureImage: stringField(source.feature_image, "feature_image"),
        customExcerpt: stringField(source.custom_excerpt, "custom_excerpt"),
    };
}

export function ghostFieldsForCandidate(fields: GhostPublishingFields): {
    title: string;
    tags?: string[] | null;
    feature_image?: string | null;
    custom_excerpt?: string | null;
} {
    if (fields.title.mode !== "manage" || typeof fields.title.value !== "string") {
        throw new GhostExportError("field-invalid", "A managed title is required.");
    }
    return {
        title: fields.title.value,
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
    };
}
