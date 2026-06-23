/* Copyright 2023 edonyzpc */

import type { PreloadCacheEntry, PreloadFinding, PreloadResult } from "./types";

export class PreloadCache {
    private entry: PreloadCacheEntry | null = null;

    set(result: PreloadResult): void {
        this.entry = { result, cachedAt: Date.now() };
    }

    get(): PreloadCacheEntry | null {
        return this.entry;
    }

    has(): boolean {
        return this.entry !== null;
    }

    clear(): void {
        this.entry = null;
    }

    getFindings(): PreloadFinding[] {
        return this.entry?.result.findings ?? [];
    }
}
