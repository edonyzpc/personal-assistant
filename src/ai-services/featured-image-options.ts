import type { AIUtilsHost } from './ai-utils';
import { getDashScopeImageGenerationEndpoint } from './ai-utils';
import { resolveWanSynchronousEndpoint } from './image-generation-connection';
import type { FeaturedImageModel } from '../settings';

export interface FeaturedImageDefaults {
    readonly featuredImageModel: FeaturedImageModel;
    readonly numFeaturedImages: number;
    readonly featuredImagePath: string;
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
