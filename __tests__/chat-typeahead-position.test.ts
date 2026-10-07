import { caretRectFromMirror, clampTypeaheadPosition, intersectRects, measureTextAreaCaret } from '../src/chat/typeahead-position';

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

    it.each([false, true])('uses the textarea document and removes its measurement mirror when measurement fails: %s', (measurementFails) => {
        const styleValues = new Map<string, string>();
        const marker = {
            textContent: '',
            getBoundingClientRect: jest.fn(() => {
                if (measurementFails) throw new Error('measurement failed');
                return { left: 75, top: 140, width: 1, height: 18 };
            }),
        };
        const mirror = {
            className: '',
            style: { setProperty: (name: string, value: string) => styleValues.set(name, value) },
            append: jest.fn(),
            getBoundingClientRect: () => ({ left: 30, top: 90, width: 280, height: 120 }),
            remove: jest.fn(),
        };
        const sourceStyle = {
            getPropertyValue: (name: string) => ({
                'border-left-width': '2px',
                'border-right-width': '2px',
                'line-height': '18px',
                width: '280px',
            } as Record<string, string>)[name] ?? '',
        };
        const ownerDocument = {
            defaultView: { getComputedStyle: jest.fn(() => sourceStyle) },
            win: { createDiv: jest.fn(() => mirror), createSpan: jest.fn(() => marker) },
            createTextNode: jest.fn((text: string) => ({ textContent: text })),
        };
        const parent = { appendChild: jest.fn() };
        const textArea = {
            ownerDocument,
            parentElement: parent,
            value: 'hello world',
            selectionStart: 5,
            clientWidth: 276,
            scrollLeft: 4,
            scrollTop: 12,
            getBoundingClientRect: () => ({ left: 10, top: 220, width: 280, height: 96 }),
        } as unknown as HTMLTextAreaElement;

        if (measurementFails) {
            expect(() => measureTextAreaCaret(textArea)).toThrow('measurement failed');
        } else {
            expect(measureTextAreaCaret(textArea)).toEqual({ left: 51, top: 258, width: 1, height: 18 });
        }

        expect(ownerDocument.defaultView.getComputedStyle).toHaveBeenCalledWith(textArea);
        expect(ownerDocument.win.createDiv).toHaveBeenCalledTimes(1);
        expect(ownerDocument.win.createSpan).toHaveBeenCalledTimes(1);
        expect(ownerDocument.createTextNode).toHaveBeenCalledWith('hello');
        expect(mirror.append).toHaveBeenCalledWith({ textContent: 'hello' }, marker);
        expect(styleValues.get('width')).toBe('280px');
        expect(styleValues.get('visibility')).toBe('hidden');
        expect(parent.appendChild).toHaveBeenCalledWith(mirror);
        expect(mirror.remove).toHaveBeenCalledTimes(1);
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
