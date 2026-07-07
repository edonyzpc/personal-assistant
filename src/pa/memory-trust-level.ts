/* Copyright 2023 edonyzpc */

export const MEMORY_TRUST_THRESHOLDS = { level1: 10, level2: 30 } as const;

export type MemoryTrustLevel = 0 | 1 | 2;

export function getMemoryTrustLevel(confirmedCount: number): MemoryTrustLevel {
    if (confirmedCount >= MEMORY_TRUST_THRESHOLDS.level2) return 2;
    if (confirmedCount >= MEMORY_TRUST_THRESHOLDS.level1) return 1;
    return 0;
}
