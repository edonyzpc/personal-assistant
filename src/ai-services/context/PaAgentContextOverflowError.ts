/** A locally rejected request, distinct from provider/transport failure. */
export class PaAgentContextOverflowError extends Error {
    constructor(readonly promptChars: number, readonly maxPromptChars: number) {
        super("The request exceeds the local context budget.");
        this.name = "PaAgentContextOverflowError";
    }
}
