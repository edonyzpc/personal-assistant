/* Copyright 2023 edonyzpc */

import type { PetState } from "./types";

/**
 * Semantic events that drive Pet state transitions.
 *
 * The state machine is system-driven: external subsystems (note activity
 * detector, analysis pipeline, user interaction handler) fire these events;
 * the machine resolves the next state deterministically.
 */
export type PetEvent =
    | "note-activity"
    | "long-idle"
    | "analysis-start"
    | "analysis-done"
    | "insights-ready"
    | "user-interact";

export type PetStateListener = (prev: PetState, next: PetState) => void;

export interface PetStateMachineOptions {
    initialState?: PetState;
    proactiveHintsEnabled?: boolean;
    onTransition?: PetStateListener;
}

/**
 * Deterministic state machine for Pet v2.
 *
 * Transition table:
 *   resting  + note-activity   → idle
 *   idle     + analysis-start  → working
 *   idle     + long-idle       → resting
 *   working  + analysis-done   → idle
 *   working  + insights-ready  → nudge (if proactiveHintsEnabled) | idle
 *   nudge    + user-interact   → idle
 *   Any      + analysis-start  → working
 */
export class PetStateMachine {
    private _state: PetState;
    private _proactiveHintsEnabled: boolean;
    private readonly _listener: PetStateListener | undefined;

    constructor(options: PetStateMachineOptions = {}) {
        this._state = options.initialState ?? "idle";
        this._proactiveHintsEnabled = options.proactiveHintsEnabled ?? false;
        this._listener = options.onTransition;
    }

    get state(): PetState {
        return this._state;
    }

    get proactiveHintsEnabled(): boolean {
        return this._proactiveHintsEnabled;
    }

    set proactiveHintsEnabled(value: boolean) {
        this._proactiveHintsEnabled = value;
    }

    transition(event: PetEvent): PetState {
        const prev = this._state;
        const next = this.resolve(prev, event);
        if (next !== prev) {
            this._state = next;
            this._listener?.(prev, next);
        }
        return next;
    }

    /** Force a specific state, bypassing the transition table. */
    forceState(state: PetState): void {
        const prev = this._state;
        if (state !== prev) {
            this._state = state;
            this._listener?.(prev, state);
        }
    }

    private resolve(current: PetState, event: PetEvent): PetState {
        // "analysis-start" is a global override — any state → working
        if (event === "analysis-start") {
            return "working";
        }

        switch (current) {
            case "resting":
                if (event === "note-activity") return "idle";
                return current;

            case "idle":
                if (event === "long-idle") return "resting";
                return current;

            case "working":
                if (event === "analysis-done") return "idle";
                if (event === "insights-ready") {
                    return this._proactiveHintsEnabled ? "nudge" : "idle";
                }
                return current;

            case "nudge":
                if (event === "user-interact") return "idle";
                return current;

            default:
                return current;
        }
    }
}
