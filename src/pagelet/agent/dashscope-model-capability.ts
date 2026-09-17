import { requestUrl, type RequestUrlParam } from "obsidian";

import { isDashScopeCompatibleBaseURL } from "../../ai-services/ai-utils";

export type FunctionCallingCapability = "supported" | "unsupported" | "unknown";

/** Queries the model catalog on the same DashScope origin as the configured Chat endpoint. */
export async function probeDashScopeFunctionCalling(input: {
    baseURL: string;
    model: string;
    apiKey: string;
    request?: (params: RequestUrlParam) => Promise<{ status: number; json: unknown }>;
}): Promise<FunctionCallingCapability> {
    if (!isDashScopeCompatibleBaseURL(input.baseURL) || !input.model || !input.apiKey) {
        return "unknown";
    }
    const endpoint = new URL(input.baseURL);
    endpoint.pathname = "/api/v1/models";
    endpoint.search = "";
    endpoint.searchParams.set("model", input.model);

    try {
        const response = await (input.request ?? requestUrl)({
            url: endpoint.toString(),
            method: "GET",
            headers: { Authorization: `Bearer ${input.apiKey}` },
            throw: false,
        });
        if (response.status !== 200) return "unknown";
        const data = response.json as {
            success?: unknown;
            output?: { models?: unknown };
        } | null;
        if (data?.success !== true || !Array.isArray(data.output?.models)) return "unknown";
        const model = data.output.models.find((entry: unknown) => (
            entry !== null && typeof entry === "object"
            && (entry as { model?: unknown }).model === input.model
        )) as { features?: unknown } | undefined;
        if (!model || !Array.isArray(model.features)
            || !model.features.every((feature) => typeof feature === "string")) {
            return "unknown";
        }
        return model.features.includes("function-calling") ? "supported" : "unsupported";
    } catch {
        // Catalog availability is diagnostic only; the actual discovery request remains authoritative.
        return "unknown";
    }
}
