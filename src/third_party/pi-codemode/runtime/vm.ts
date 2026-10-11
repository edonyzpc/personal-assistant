/**
 * Drives one QuickJS VM through one script, independent of the transport that connects it to the
 * host. The worker thread, the in-thread launcher, and the remote server all run the VM through
 * this module, so the bridge between prelude and host exists once.
 *
 * Contract with the caller:
 * - `post` receives every message for the host, synchronously from inside VM callbacks. The
 *   caller must not re-enter the VM from `post` (no `deliver`, no `dispose`); a worker posts to
 *   another thread, and the in-thread launcher defers delivery to a microtask.
 * - `deliver` hands the VM a tool result and runs the script until it waits again. It must only be
 *   called while the VM is idle, which holds for any caller that never re-enters from `post`.
 * - `shouldInterrupt` is polled by QuickJS while the script runs, and here between batches of
 *   promise jobs. Returning true throws an uncatchable error in the script; the VM then reports
 *   `crash` or a failed `done`. The job batches matter for a script such as `while (true) await
 *   null`: every iteration is a separate job that executes only a few opcodes, so QuickJS's own
 *   polling, which counts opcodes, would let it run for a long time between polls.
 * - The VM never decides on its own when it is finished: after `done` or `crash` it stays alive
 *   until the caller disposes it (or terminates the worker that hosts it).
 *
 * Failures after the VM exists are reported as a `crash` message; `startVm` only rejects when the
 * VM cannot be created at all.
 */
import { JSException, type JSValueHandle, MAX_STACK_SIZE, QuickJS } from "quickjs-wasi";
import type { CodemodeWasmModule } from "../wasm.ts";
import { PRELUDE_SOURCE } from "./prelude-source.ts";
import type { HostToWorkerMessage, VmStartData, WorkerToHostMessage } from "./protocol.ts";

export interface VmSession {
	deliver(message: HostToWorkerMessage): void;
	/** Releases the VM's wasm instance. The session must not be used afterwards. */
	dispose(): void;
}

export interface StartVmOptions {
	data: VmStartData;
	wasm: CodemodeWasmModule;
	/**
	 * QuickJS's guard on its own stack, which turns deep recursion into a catchable `RangeError`.
	 * The wasm frames also use the host thread's native stack, so the guard must trip before that
	 * stack runs out: a host overflow fails the whole execution instead. Default: `MAX_STACK_SIZE`
	 * (512 KiB), which fits the 4 MB stack of a Node worker thread but not a 1 MB main thread.
	 */
	maxStackSize?: number;
	post(message: WorkerToHostMessage): void;
	shouldInterrupt(): boolean;
}

/**
 * QuickJS writes engine diagnostics to fd 1 and 2, which the default shim
 * forwards to the host's stdout and stderr. That output belongs to the host
 * application (for example a TUI), so it is discarded. Reporting every byte as
 * written keeps libc from retrying.
 */
function discardOutput(memory: { readonly buffer: ArrayBufferLike }) {
	return {
		fd_write(_fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
			const view = new DataView(memory.buffer);
			let written = 0;
			for (let i = 0; i < iovsLen; i++) {
				written += view.getUint32(iovsPtr + i * 8 + 4, true);
			}
			view.setUint32(nwrittenPtr, written, true);
			return 0;
		},
	};
}

function describeException(error: JSException): string {
	const head = error.message ? `${error.name}: ${error.message}` : error.name;
	const stack = error.stack?.trimEnd();
	return JSON.stringify({ name: error.name, message: error.message, stack: stack ? `${head}\n${stack}` : head });
}

/** Promise jobs run between two `shouldInterrupt` polls while draining the job queue. */
const JOBS_PER_POLL = 50;

function crashMessage(error: unknown): WorkerToHostMessage {
	return { type: "crash", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}

export async function startVm(options: StartVmOptions): Promise<VmSession> {
	const { data, post } = options;
	const vm = await QuickJS.create({
		wasm: options.wasm,
		memoryLimit: data.memoryLimitBytes,
		// Without a guard, deep recursion overflows the wasm stack and traps instead of throwing a
		// catchable RangeError.
		maxStackSize: options.maxStackSize ?? MAX_STACK_SIZE,
		interruptHandler: options.shouldInterrupt,
		wasi: discardOutput,
	});
	let disposed = false;
	const session: VmSession = {
		deliver(message) {
			if (disposed) return;
			try {
				vm.withScope(() => {
					vm.callFunction(
						settle,
						api,
						vm.newNumber(message.id),
						message.ok ? vm.true : vm.false,
						message.payload === undefined ? vm.undefined : vm.newString(message.payload),
					);
				});
				drain();
			} catch (error) {
				post(crashMessage(error));
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			vm.dispose();
		},
	};

	let api: JSValueHandle;
	let settle: JSValueHandle;
	let stalled: JSValueHandle;
	// `executePendingJobs()` runs the queue to empty without a chance to interrupt, so jobs run one at a
	// time through the (internal, but public) exports; quickjs-wasi is pinned to an exact version.
	const exports = vm._getExports();
	/** Run queued jobs, then fail a script that waits on nothing that can ever resume it. */
	const drain = () => {
		let jobs = 0;
		while (exports.qjs_is_job_pending()) {
			// A job only fails for uncatchable errors, such as an interrupt.
			if (exports.qjs_execute_pending_job() < 0) throw new Error("Promise job failed");
			if (++jobs % JOBS_PER_POLL === 0 && options.shouldInterrupt()) throw new Error("Execution interrupted");
		}
		vm.callFunction(stalled, api).dispose();
	};

	try {
		// Called from the prelude with primitives only.
		const bridge = vm.newFunction("bridge", (kind, a, b, c) => {
			switch (kind.toString()) {
				case "call":
				case "global":
					post({
						type: "call",
						id: a.toNumber(),
						target: kind.toString() === "call" ? "tool" : "global",
						name: b.toString(),
						args: c === undefined || c.isUndefined ? undefined : c.toString(),
					});
					break;
				case "output":
					post({
						type: "output",
						item:
							a.toString() === "image"
								? { type: "image", data: b.toString(), mimeType: c.toString() }
								: a.toString() === "console"
									? { type: "text", text: b.toString(), console: true }
									: { type: "text", text: b.toString() },
					});
					break;
				case "done":
					if (a.toBoolean()) {
						post({
							type: "done",
							ok: true,
							value: b === undefined || b.isUndefined ? undefined : b.toString(),
							writes: c.toString(),
						});
					} else {
						post({ type: "done", ok: false, error: b.toString() });
					}
					break;
			}
			return vm.undefined;
		});

		// These handles live as long as the VM, which the caller disposes as a whole.
		api = vm.withScope((scope) =>
			scope.escape(
				vm.callFunction(
					vm.evalCode(PRELUDE_SOURCE, "codemode-prelude.js"),
					vm.undefined,
					bridge,
					vm.newString(JSON.stringify(data.tools)),
					vm.newString(JSON.stringify(data.globals)),
					vm.newString(JSON.stringify(data.store)),
				),
			),
		);
		settle = api.getProp("settle");
		const run = api.getProp("run");
		stalled = api.getProp("stalled");

		// The prefix shares the first line with the script so reported line numbers
		// match the script as written.
		let fn: JSValueHandle;
		try {
			fn = vm.evalCode(`(async (tools, console) => {${data.code}\n})`, "codemode.js");
		} catch (error) {
			if (!(error instanceof JSException)) throw error;
			post({ type: "done", ok: false, error: describeException(error) });
			return session;
		}
		vm.callFunction(run, api, fn).dispose();
		fn.dispose();
		drain();
	} catch (error) {
		post(crashMessage(error));
	}
	return session;
}
