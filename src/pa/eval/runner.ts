import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEvalCase } from "./schema";
import { runAssertion } from "./assertions";
import type { EvalCase, EvalCaseResult, EvalRunResult, EvalRunnerOptions } from "./types";

export function runEvalCase(evalCase: EvalCase, options: EvalRunnerOptions): EvalCaseResult {
    const failures = evalCase.expected.assertions
        .map((assertion) => runAssertion(evalCase, assertion, options))
        .filter((failure): failure is NonNullable<typeof failure> => failure !== null);
    return {
        caseId: evalCase.id,
        ok: failures.length === 0,
        failures,
    };
}

export function runEvalCases(evalCases: EvalCase[], options: EvalRunnerOptions): EvalRunResult {
    const results = evalCases.map((evalCase) => runEvalCase(evalCase, options));
    return {
        ok: results.every((result) => result.ok),
        results,
    };
}

export function loadEvalCasesFromDirectory(casesDir: string): EvalCase[] {
    return readdirSync(casesDir)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map((fileName) => {
            const raw = readFileSync(join(casesDir, fileName), "utf8");
            return parseEvalCase(JSON.parse(raw));
        });
}

export function createFixtureVaultOptions(vaultRoot: string): EvalRunnerOptions {
    return {
        sourceExists: (path: string) => existsSync(join(vaultRoot, path)),
    };
}
