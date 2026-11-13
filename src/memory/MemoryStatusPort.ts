/* Copyright 2023 edonyzpc */

import type { MemoryMaintenancePlan, MemoryStatusSnapshot } from "../memory-manager";

/**
 * Narrow Memory status/control port consumed by chat UI.
 */
export interface MemoryStatusPort {
    getMaintenancePlan(): Promise<MemoryMaintenancePlan>;
    prepareFromCommand(): Promise<void>;
    updateFromCommand(): Promise<void>;
    getStatusSnapshot(): MemoryStatusSnapshot;
    showPreparationProgress(): boolean;
    showTechnicalStatus(): void;
    onStatusChanged(listener: () => void | Promise<void>): () => void;
}
