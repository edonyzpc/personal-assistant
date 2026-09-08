import type { AIUtilsHost } from './ai-utils';
import { getDashScopeImageGenerationEndpoint } from './ai-utils';
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
    if (!options.isCurrent()
        || options.connection.aiProvider !== 'qwen'
        || getDashScopeImageGenerationEndpoint(options.connection.baseURL) !== options.imageEndpoint) {
        throw new FeaturedImageRunInvalidatedError();
    }
}
