// Keep this entry free of static runtime imports. The Worker-only Symbol.dispose
// compatibility shim must execute before quickjs-wasi's module evaluation.
if (!(Symbol as { dispose?: symbol }).dispose) {
    Object.defineProperty(Symbol, "dispose", {
        value: Symbol("Symbol.dispose"),
        configurable: true,
    });
}

const pending: unknown[] = [];
let deliver: ((message: unknown) => void) | undefined;

self.addEventListener("message", event => {
    if (deliver) deliver(event.data);
    else pending.push(event.data);
});

void import("./worker-runtime").then(({ createReceiver }) => {
    deliver = createReceiver();
    for (const message of pending.splice(0)) deliver(message);
}).catch(error => {
    self.postMessage({
        type: "failure",
        error: { kind: "sandbox", message: error instanceof Error ? error.message : String(error) },
    });
});
export {};
