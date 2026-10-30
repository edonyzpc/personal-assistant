import type { AIUtilsHost } from './ai-utils';
import { getDashScopeImageGenerationEndpoint } from './ai-utils';
import { resolveWanSynchronousEndpoint } from './image-generation-connection';
import type { ImageGenerationConnection } from './image-generation-connection';

export interface FeaturedImageDefaults {
    readonly featuredImageModel: string;
    readonly numFeaturedImages: number;
    readonly featuredImagePath: string;
}

/** Choices for the existing controls; actual request admission remains in the image service. */
export function imageModelChoices(connection?: Readonly<ImageGenerationConnection> | null): string[] {
    return connection?.adapter === 'openai-image'
        ? [...new Set([connection.model, connection.sourceImageModel].filter((model): model is string => Boolean(model)))]
        : ['wan2.7-image', 'wan2.7-image-pro'];
}

export function imageCountLimit(connection?: Readonly<ImageGenerationConnection> | null): number {
    return connection?.adapter === 'openai-image' ? 10 : 4;
}

export function isImageModelSupported(model: string, connection?: Readonly<ImageGenerationConnection> | null): boolean {
    return connection?.adapter === 'openai-image'
        ? model.startsWith('gpt-image-') && model.length <= 128
        : model === 'wan2.7-image' || model === 'wan2.7-image-pro';
}

/** The Plugin owns connection revisions and the original Markdown target. */
export interface FeaturedImageRunAdmission {
    readonly connection: Readonly<AIUtilsHost['settings']>;
    readonly imageEndpoint: string;
    readonly imageBaseURL?: string;
    readonly getImageAPIToken?: () => Promise<string>;
    readonly isCurrent: () => boolean;
}

export interface FeaturedImageRunOptions extends FeaturedImageDefaults, FeaturedImageRunAdmission {}

export function freezeFeaturedImageRunOptions(options: FeaturedImageRunOptions): FeaturedImageRunOptions {
    return Object.freeze({ ...options, connection: Object.freeze({ ...options.connection }) });
}

export class FeaturedImageRunInvalidatedError extends Error {
    constructor() {
        super('The featured image note or AI connection changed.');
        this.name = 'FeaturedImageRunInvalidatedError';
    }
}

export function assertFeaturedImageRunCurrent(options: FeaturedImageRunOptions): void {
    let endpoint: string | null = null;
    try {
        endpoint = resolveWanSynchronousEndpoint(options.imageBaseURL ?? options.connection.baseURL);
    } catch {
        endpoint = null;
    }
    if (!options.isCurrent() || endpoint !== options.imageEndpoint
        || (!options.imageBaseURL && (options.connection.aiProvider !== 'qwen'
            || getDashScopeImageGenerationEndpoint(options.connection.baseURL) !== options.imageEndpoint))) {
        throw new FeaturedImageRunInvalidatedError();
    }
}
