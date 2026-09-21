/** A local decision made before HTTP dispatch; retrying the same payload cannot repair it. */
export class ProviderAdmissionError extends Error {
    readonly code = 'provider_admission_rejected';
    readonly cause: unknown;

    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : 'Provider request was not admitted');
        this.name = 'ProviderAdmissionError';
        this.cause = cause;
    }
}

/** The serialized evidence is stale, but a host-owned fresh projection may omit it. */
export class ProviderInputReprepareRequiredError extends ProviderAdmissionError {}

/** OpenAI wraps fetch failures in APIConnectionError; preserve the local cause. */
export function getProviderAdmissionError(error: unknown): ProviderAdmissionError | undefined {
    const seen = new Set<unknown>();
    while (error && typeof error === 'object' && !seen.has(error)) {
        if (error instanceof ProviderAdmissionError) return error;
        seen.add(error);
        error = 'cause' in error ? error.cause : undefined;
    }
    return undefined;
}

function rejectAdmission(error: unknown): never {
    if (error instanceof ProviderAdmissionError || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
    }
    throw new ProviderAdmissionError(error);
}

export function runProviderAdmission(check?: () => void): void {
    try { check?.(); } catch (error) { rejectAdmission(error); }
}

export async function prepareProviderAdmission(check: () => void | Promise<void>): Promise<void> {
    try { await check(); } catch (error) { rejectAdmission(error); }
}
