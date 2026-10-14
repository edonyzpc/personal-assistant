declare module "js-yaml" {
    export function safeLoad(source: string, options?: Record<string, unknown>): unknown;
    export function safeDump(value: unknown, options?: Record<string, unknown>): string;
}
