import type { Debouncer } from "obsidian";

export type MemoryStatusListener = () => void | Promise<void>;
export type MemoryStatusDebounceFactory = (
    callback: () => void,
    timeoutMs: number,
    resetTimer: boolean,
) => Debouncer<[], void>;

export interface MemoryStatusNotifierDependencies {
    createDebounce: MemoryStatusDebounceFactory;
}

const MEMORY_STATUS_UPDATE_DEBOUNCE_MS = 300;

export class MemoryStatusNotifier {
    private readonly listeners = new Set<MemoryStatusListener>();
    private readonly debouncedUpdate: Debouncer<[], void>;

    constructor(private readonly dependencies: MemoryStatusNotifierDependencies) {
        this.debouncedUpdate = dependencies.createDebounce(() => {
            void this.notifyNow();
        }, MEMORY_STATUS_UPDATE_DEBOUNCE_MS, true);
    }

    subscribe(listener: MemoryStatusListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    schedule(): void {
        this.debouncedUpdate();
    }

    cancelPending(): void {
        this.debouncedUpdate.cancel();
    }

    async notifyNow(): Promise<void> {
        await Promise.allSettled(
            Array.from(this.listeners, (listener) => Promise.resolve().then(listener)),
        );
    }
}
