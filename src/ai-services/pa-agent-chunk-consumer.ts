import type { AssistantMessagePart } from "./chat-types";
import type { PaAgentModelStreamChunk } from "./pa-agent-types";

export type NextModelChunkResult =
    | { type: "chunk"; chunk: PaAgentModelStreamChunk }
    | { type: "done" }
    | { type: "idle" }
    | { type: "aborted" }
    | { type: "wall_clock_exceeded" }
    | { type: "error"; error: unknown };

export interface ModelChunkConsumerConfig {
    signal?: AbortSignal;
    assistantIdleTimeoutMs: number;
    isAborted: () => boolean;
    isWallClockExceeded: () => boolean;
    wallClockRemainingMs: () => number | undefined;
}

export class ModelChunkConsumer {
    constructor(
        private readonly iterator: AsyncIterator<PaAgentModelStreamChunk>,
        private readonly config: ModelChunkConsumerConfig,
    ) {}

    async nextChunk(): Promise<NextModelChunkResult> {
        if (this.config.isAborted()) return { type: "aborted" };
        if (this.config.isWallClockExceeded()) return { type: "wall_clock_exceeded" };

        return new Promise<NextModelChunkResult>((resolve) => {
            let settled = false;
            let idleTimer: ReturnType<typeof setTimeout> | undefined;
            let wallClockTimer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
                if (idleTimer !== undefined) {
                    clearTimeout(idleTimer);
                }
                if (wallClockTimer !== undefined) {
                    clearTimeout(wallClockTimer);
                }
                this.config.signal?.removeEventListener("abort", onAbort);
            };
            const settle = (result: NextModelChunkResult) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(result);
            };
            const onAbort = () => {
                void this.iterator.return?.();
                settle({ type: "aborted" });
            };

            this.config.signal?.addEventListener("abort", onAbort, { once: true });
            if (Number.isFinite(this.config.assistantIdleTimeoutMs) && this.config.assistantIdleTimeoutMs > 0) {
                idleTimer = setTimeout(() => {
                    void this.iterator.return?.();
                    settle({ type: "idle" });
                }, this.config.assistantIdleTimeoutMs);
            }
            const wallClockRemainingMs = this.config.wallClockRemainingMs();
            if (wallClockRemainingMs !== undefined) {
                wallClockTimer = setTimeout(() => {
                    void this.iterator.return?.();
                    settle({ type: "wall_clock_exceeded" });
                }, wallClockRemainingMs);
            }

            this.iterator.next().then(
                (result) => {
                    if (this.config.isWallClockExceeded()) {
                        settle({ type: "wall_clock_exceeded" });
                        return;
                    }
                    settle(result.done
                        ? { type: "done" }
                        : { type: "chunk", chunk: result.value });
                },
                (error) => settle({ type: "error", error }),
            );
        });
    }
}

export function appendTextPart(parts: AssistantMessagePart[], type: "thinking" | "text", text: string): void {
    const last = parts.at(-1);
    if (last?.type === type) {
        last.text += text;
        return;
    }
    parts.push({ type, text });
}
