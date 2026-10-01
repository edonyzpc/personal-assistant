export const GHOST_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidGhostSlug(value: string): boolean {
    return value.length > 0 && value.length <= 80 && GHOST_SLUG_PATTERN.test(value);
}
