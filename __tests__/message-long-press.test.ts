import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { registerMessageLongPress } from '../src/chat/message-long-press';

jest.mock('../src/platform-dom', () => ({
    setPlatformTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearPlatformTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    getOptionalPlatformDocument: () => undefined,
}));

function fixture() {
    const doc = new EventTarget();
    const container = Object.assign(new EventTarget(), { ownerDocument: doc });
    const message = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200 }) };
    const element = (isButton = false) => ({ closest: (selector: string) => selector === 'button'
        ? (isButton ? {} : null) : message });
    const heading = element();
    const content = element();
    const button = element(true);
    const roleEl = { contains: (target: unknown) => target === heading };
    const open = jest.fn();
    let current = true;
    const registration = registerMessageLongPress(container as unknown as HTMLElement, () => ({
        roleEl: roleEl as unknown as HTMLElement, isCurrent: () => current, open,
    }));
    const emit = (owner: EventTarget, type: string, target: unknown = heading, properties = {}) => {
        const event = new Event(type, { cancelable: true });
        for (const [name, value] of Object.entries({ target, button: 0, isPrimary: true, pointerId: 1,
            clientX: 50, clientY: 50, ...properties })) Object.defineProperty(event, name, { value });
        owner.dispatchEvent(event);
        return event;
    };
    return { doc, container, heading, content, button, open, registration, emit,
        invalidate: () => { current = false; } };
}

describe('message long press', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('opens after a hold, consumes its release click and leaves menu actions usable immediately', () => {
        const f = fixture();
        const outsideClick = jest.fn();
        f.doc.addEventListener('click', outsideClick);
        expect(f.emit(f.container, 'pointerdown').defaultPrevented).toBe(false);
        jest.advanceTimersByTime(499);
        expect(f.open).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(f.open).toHaveBeenCalledTimes(1);
        f.emit(f.doc, 'pointerup');
        expect(f.emit(f.doc, 'click').defaultPrevented).toBe(true);
        expect(outsideClick).not.toHaveBeenCalled();
        expect(f.emit(f.doc, 'click', f.button).defaultPrevented).toBe(false);
        expect(outsideClick).toHaveBeenCalledTimes(1);
        f.registration.dispose();
    });

    it.each(['pointerup', 'pointercancel', 'scroll', 'move', 'leave'])('cancels a hold on %s', reason => {
        const f = fixture();
        f.emit(f.container, 'pointerdown');
        if (reason === 'move') f.emit(f.doc, 'pointermove', f.heading, { clientX: 61 });
        else if (reason === 'leave') f.emit(f.doc, 'pointermove', f.heading, { clientX: 201 });
        else f.emit(f.doc, reason);
        jest.advanceTimersByTime(500);
        expect(f.open).not.toHaveBeenCalled();
        f.registration.dispose();
    });

    it('preserves native text selection, context menus and embedded buttons', () => {
        const f = fixture();
        for (const target of [f.content, f.button]) {
            expect(f.emit(f.container, 'pointerdown', target).defaultPrevented).toBe(false);
            expect(f.emit(f.container, 'contextmenu', target).defaultPrevented).toBe(false);
            jest.advanceTimersByTime(500);
        }
        expect(f.open).not.toHaveBeenCalled();
        expect(f.emit(f.container, 'contextmenu', f.heading).defaultPrevented).toBe(true);
        expect(f.open).toHaveBeenCalledTimes(1);
        f.registration.dispose();
    });

    it('does not open for a removed message or after view teardown', () => {
        const f = fixture();
        f.emit(f.container, 'pointerdown');
        f.invalidate();
        jest.advanceTimersByTime(500);
        expect(f.open).not.toHaveBeenCalled();
        f.emit(f.container, 'pointerdown');
        f.registration.dispose();
        jest.advanceTimersByTime(500);
        expect(f.open).not.toHaveBeenCalled();
        f.emit(f.container, 'pointerdown');
        expect(jest.getTimerCount()).toBe(0);
    });
});
