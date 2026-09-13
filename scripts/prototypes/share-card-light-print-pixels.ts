export interface ShareCardPixelData {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
}

export interface ShareCardPixelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ShareCardPixelComparison {
    changedPixelCount: number;
    selectedRegionChangedPixelCount: number;
    protectedRegionChangedPixelCount: number;
    outsideSelectedChangedPixelCount: number;
}

export interface ShareCardPixelEvaluation extends ShareCardPixelComparison {
    pass: boolean;
}

function clampRect(
    rect: ShareCardPixelRect,
    width: number,
    height: number,
    padding = 0,
): ShareCardPixelRect {
    const left = Math.max(0, Math.floor(rect.x - padding));
    const top = Math.max(0, Math.floor(rect.y - padding));
    const right = Math.min(width, Math.ceil(rect.x + rect.width + padding));
    const bottom = Math.min(height, Math.ceil(rect.y + rect.height + padding));
    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

function contains(rect: ShareCardPixelRect, x: number, y: number): boolean {
    return x >= rect.x
        && x < rect.x + rect.width
        && y >= rect.y
        && y < rect.y + rect.height;
}

export function compareShareCardPixelSamples(
    baseline: ShareCardPixelData,
    comparison: ShareCardPixelData,
    selectedRects: readonly ShareCardPixelRect[],
    protectedRects: readonly ShareCardPixelRect[],
    options: { selectedPaddingPixels?: number } = {},
): ShareCardPixelComparison {
    if (baseline.width !== comparison.width || baseline.height !== comparison.height) {
        throw new Error(`Pixel dimensions differ: ${baseline.width}x${baseline.height} vs ${comparison.width}x${comparison.height}.`);
    }
    if (baseline.data.length !== comparison.data.length) {
        throw new Error(`Pixel buffer lengths differ: ${baseline.data.length} vs ${comparison.data.length}.`);
    }

    const { width, height } = baseline;
    const padding = options.selectedPaddingPixels ?? 0;
    const selected = selectedRects.map((rect) => clampRect(rect, width, height, padding));
    const protectedRectsClamped = protectedRects.map((rect) => clampRect(rect, width, height));
    const result = {
        changedPixelCount: 0,
        selectedRegionChangedPixelCount: 0,
        protectedRegionChangedPixelCount: 0,
        outsideSelectedChangedPixelCount: 0,
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            let changed = false;
            for (let channel = 0; channel < 4; channel += 1) {
                if (baseline.data[offset + channel] !== comparison.data[offset + channel]) {
                    changed = true;
                    break;
                }
            }
            if (!changed) continue;

            result.changedPixelCount += 1;
            if (protectedRectsClamped.some((rect) => contains(rect, x, y))) {
                result.protectedRegionChangedPixelCount += 1;
            } else if (selected.some((rect) => contains(rect, x, y))) {
                result.selectedRegionChangedPixelCount += 1;
            } else {
                result.outsideSelectedChangedPixelCount += 1;
            }
        }
    }
    return result;
}

export function evaluateShareCardPixelComparison(
    baseline: ShareCardPixelData,
    comparison: ShareCardPixelData,
    selectedRects: readonly ShareCardPixelRect[],
    protectedRects: readonly ShareCardPixelRect[],
    expectSelectedChange: boolean,
    options: { selectedPaddingPixels?: number } = {},
): ShareCardPixelEvaluation {
    const comparisonResult = compareShareCardPixelSamples(
        baseline,
        comparison,
        selectedRects,
        protectedRects,
        options,
    );
    return {
        ...comparisonResult,
        pass: comparisonResult.protectedRegionChangedPixelCount === 0
            && comparisonResult.outsideSelectedChangedPixelCount === 0
            && (!expectSelectedChange || comparisonResult.selectedRegionChangedPixelCount > 0),
    };
}
