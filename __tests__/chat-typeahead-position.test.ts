import { caretRectFromMirror, clampTypeaheadPosition, intersectRects } from '../src/chat/typeahead-position';

describe('Chat textarea caret measurement', () => {
    it('translates mirror-relative caret geometry to the actual textarea origin', () => {
        expect(caretRectFromMirror({
            markerRect: { left: 75, top: 140, width: 1, height: 18 },
            mirrorRect: { left: 30, top: 90, width: 300, height: 120 },
            textAreaRect: { left: 10, top: 220, width: 280, height: 96 },
            scrollLeft: 4,
            scrollTop: 12,
            height: 18,
        })).toEqual({ left: 51, top: 258, width: 1, height: 18 });
    });
});

describe('Chat typeahead positioning geometry', () => {
    it('keeps a right-edge candidate inside the boundary and opens it above the caret', () => {
        const position = clampTypeaheadPosition({
            caretRect: { left: 390, top: 430, width: 1, height: 20 },
            typeaheadSize: { width: 180, height: 80 },
            positioningParent: { left: 20, top: 300, width: 400, height: 100 },
            boundary: { left: 0, top: 0, width: 500, height: 480 },
            margin: 10,
            gap: 4,
        });

        expect(position).toEqual({ left: 290, top: 46 });
        expect(position!.top + 80).toBeLessThanOrEqual(430);
    });

    it('uses the visible intersection and clamps a left-edge candidate into it', () => {
        const boundary = intersectRects(
            { left: -40, top: -20, width: 560, height: 520 },
            { left: 0, top: 0, width: 500, height: 480 },
        );
        expect(boundary).toEqual({ left: 0, top: 0, width: 500, height: 480 });

        const position = clampTypeaheadPosition({
            caretRect: { left: 5, top: 100, width: 1, height: 20 },
            typeaheadSize: { width: 180, height: 80 },
            positioningParent: { left: 20, top: 80, width: 400, height: 100 },
            boundary: boundary!,
            margin: 10,
            gap: 4,
        });

        expect(position).toEqual({ left: -10, top: 44 });
    });

    it('hides rather than emitting an out-of-bounds position when no width fits', () => {
        expect(clampTypeaheadPosition({
            caretRect: { left: 20, top: 20, width: 1, height: 20 },
            typeaheadSize: { width: 180, height: 80 },
            positioningParent: { left: 0, top: 0, width: 100, height: 100 },
            boundary: { left: 0, top: 0, width: 16, height: 100 },
        })).toBeNull();
    });
});
