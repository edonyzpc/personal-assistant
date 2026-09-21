import { AsyncCaller } from '@langchain/core/utils/async_caller';
import { getProviderAdmissionError } from './provider-admission-error';

// Delegate all other errors to the installed SDK's default policy, including
// authentication/quota rejection and retryable 429/5xx/connection failures.
// No calls enter this caller's queue; it only exposes the inherited policy.
class DefaultRetryPolicy extends AsyncCaller {
    handle(error: unknown): unknown { return this.onFailedAttempt?.(error); }
}
const defaultRetryPolicy = new DefaultRetryPolicy({});

export function onProviderFailedAttempt(error: unknown): unknown {
    const admission = getProviderAdmissionError(error);
    if (admission) throw admission;
    return defaultRetryPolicy.handle(error);
}
