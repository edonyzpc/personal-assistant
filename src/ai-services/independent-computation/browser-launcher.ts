import {
    CodemodeSandboxBase,
    type VmEvents,
    type VmLauncher,
} from "../../third_party/pi-codemode/runtime/execution";
import type { CodemodeError, CodemodeResult } from "../../third_party/pi-codemode/types";
import workerSource from "./worker-entry.ts?worker-source";

export const INDEPENDENT_COMPUTATION_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;

function sandboxError(message: string): CodemodeError {
    return { kind: "sandbox", message };
}

/** Starts one disposable browser Worker and terminates it when execution finishes. */
export function browserLauncher(): VmLauncher {
    return (data, events: VmEvents) => {
        const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        let worker: Worker;
        try {
            worker = new Worker(url, {
                type: "module",
                name: "personal-assistant-independent-computation",
            });
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error instanceof Error ? error : new Error(String(error));
        }

        let stopped = false;
        const onMessage = (event: MessageEvent) => {
            if (stopped) return;
            const message = event.data;
            if (message && typeof message === "object" && message.type === "failure") {
                const failure = message.error;
                events.failure(
                    failure && typeof failure === "object" && typeof failure.message === "string"
                        ? failure as CodemodeError
                        : sandboxError("Independent computation Worker failed."),
                );
                return;
            }
            events.message(message);
        };
        const onError = (event: ErrorEvent) => {
            if (stopped) return;
            event.preventDefault();
            events.failure(sandboxError(event.message || "Independent computation Worker failed."));
        };
        const onMessageError = () => {
            if (stopped) return;
            events.failure(sandboxError("Independent computation Worker message could not be cloned."));
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onMessageError);
        const channel = {
            post(message: unknown) {
                if (!stopped) worker.postMessage(message);
            },
            async stop() {
                if (stopped) return;
                stopped = true;
                worker.removeEventListener("message", onMessage);
                worker.removeEventListener("error", onError);
                worker.removeEventListener("messageerror", onMessageError);
                try {
                    worker.terminate();
                } finally {
                    URL.revokeObjectURL(url);
                }
            },
        };

        try {
            worker.postMessage({ type: "start", data });
        } catch (error) {
            void channel.stop();
            throw error instanceof Error ? error : new Error(String(error));
        }
        return channel;
    };
}

export async function runIndependentCode(input: {
    code: string;
    signal?: AbortSignal;
    timeoutMs: number;
}): Promise<CodemodeResult> {
    const sandbox = new CodemodeSandboxBase({
        timeoutMs: input.timeoutMs,
        memoryLimitBytes: INDEPENDENT_COMPUTATION_MEMORY_LIMIT_BYTES,
    }, browserLauncher());
    try {
        return await sandbox.execute(input.code, {
            ...(input.signal ? { signal: input.signal } : {}),
            timeoutMs: input.timeoutMs,
        });
    } finally {
        await sandbox.close();
    }
}
