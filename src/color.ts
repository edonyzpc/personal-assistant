// ---------------------------------------------------------------------------------------------------------------------
// Color Types:
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A color in 8-bit RGB color space.
 * Each color component is between 0 and 255.
 */
export interface RGB {
    r: number;
    g: number;
    b: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Color Parsing:
// ---------------------------------------------------------------------------------------------------------------------
const REGEX_RGB = /^\s*rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?\s*)\)\s*$/i;

/**
 * Parses a `rgb()` CSS color into RGB components.
 *
 * @param color The color string.
 * @returns The color RGB, or null if not valid.
 */
export function parseColorRGB(rgb: string): RGB | null {
    const matches = REGEX_RGB.exec(rgb);
    if (matches === null) return null;

    const components = matches.slice(1).map((v) => v.trim()) as [string, string, string];
    const rgbComponents = rgbComponentStringsToNumber(components);
    if (rgbComponents === null) {
        return null;
    }

    // Validate.
    if (undefined !== rgbComponents.find((v) => isNaN(v) || v < 0 || v > 0xff)) {
        return null;
    }

    // Parsed.
    return {
        r: rgbComponents[0],
        g: rgbComponents[1],
        b: rgbComponents[2],
    };
}

function rgbComponentStringsToNumber(components: [string, string, string]): [number, number, number] | null {
    // Percentage.
    if (components[0].endsWith('%')) {
        if (undefined !== components.slice(1, 3).find((c) => !c.endsWith('%'))) {
            return null;
        }

        return components
            .map((v) => parseFloat(v.substring(0, v.length - 1)))
            .map((v) => Math.floor((v * 255) / 100)) as [number, number, number];
    }

    // Integer.
    if (undefined !== components.slice(1, 3).find((c) => c.endsWith('%'))) {
        return null;
    }

    return components.map((v) => parseInt(v, 10)) as [number, number, number];
}
