/* Copyright 2023 edonyzpc */

export { };

declare global {
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
