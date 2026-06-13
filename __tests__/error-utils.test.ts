import { describe, expect, it } from "@jest/globals";
import { toError } from "../src/error-utils";

describe("toError", () => {
    it("returns Error instances unchanged", () => {
        const error = new Error("boom");

        expect(toError(error)).toBe(error);
    });

    it("wraps primitive rejections", () => {
        const error = toError("boom");

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("boom");
    });

    it("preserves Error-like object fields", () => {
        const cause = { detail: "source" };
        const error = toError({
            message: "busy",
            name: "StorageBusyError",
            code: "opfs-sahpool-locked",
            cause,
        }) as Error & { code?: unknown; cause?: unknown };

        expect(error.message).toBe("busy");
        expect(error.name).toBe("StorageBusyError");
        expect(error.code).toBe("opfs-sahpool-locked");
        expect(error.cause).toBe(cause);
    });
});
