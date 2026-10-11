import { inlineLauncher } from "../../third_party/pi-codemode/runtime/inline";
import type { VmChannel } from "../../third_party/pi-codemode/runtime/execution";
import type { HostToWorkerMessage, VmStartData } from "../../third_party/pi-codemode/runtime/protocol";
import wasmBytes from "quickjs-wasi/quickjs.wasm";

export function createReceiver() {
    let channel: VmChannel | undefined;
    let started = false;
    const queued: HostToWorkerMessage[] = [];

    return (message: unknown) => {
        if (!message || typeof message !== "object" || typeof (message as { type?: unknown }).type !== "string") return;
        if ((message as { type: string }).type === "start") {
            if (started) {
                self.postMessage({
                    type: "failure",
                    error: { kind: "sandbox", message: "Independent computation Worker already started." },
                });
                return;
            }
            started = true;
            void (async () => {
                const wasm = await WebAssembly.compile(wasmBytes);
                channel = await inlineLauncher(wasm)((message as { data: VmStartData }).data, {
                    message: value => self.postMessage(value),
                    failure: error => self.postMessage({ type: "failure", error }),
                });
                for (const result of queued.splice(0)) channel.post(result);
            })().catch(error => {
                self.postMessage({
                    type: "failure",
                    error: { kind: "sandbox", message: error instanceof Error ? error.message : String(error) },
                });
            });
            return;
        }
        if ((message as { type?: unknown }).type === "result") {
            const hostMessage = message as HostToWorkerMessage;
            if (channel) channel.post(hostMessage);
            else queued.push(hostMessage);
        }
    };
}
