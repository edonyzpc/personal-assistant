/* Copyright 2023 edonyzpc */

export { };

declare global {
    // Obsidian exposes these helpers on each window, including popout windows.
    // Its current declarations describe the globals but omit the Window members.
    interface Window {
        createEl: typeof createEl;
        createDiv: typeof createDiv;
        createSpan: typeof createSpan;
        createSvg: typeof createSvg;
        createFragment: typeof createFragment;
    }

    namespace Intl {
        interface SegmenterOptions {
            granularity?: "grapheme" | "word" | "sentence";
        }
        interface SegmentData {
            segment: string;
            index: number;
            isWordLike?: boolean;
        }
        interface Segments {
            [Symbol.iterator](): IterableIterator<SegmentData>;
        }
        class Segmenter {
            constructor(locale?: string, options?: SegmenterOptions);
            segment(input: string): Segments;
        }
    }
}
