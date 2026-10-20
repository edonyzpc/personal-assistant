import { ReadingPositionController, type ReadingAnchor } from '../src/ui/reading-position';

type TestWindow = Window & typeof globalThis & { close(): void };

const { JSDOM } = require('jsdom') as {
    JSDOM: new (html: string, options: { pretendToBeVisual: boolean }) => { window: TestWindow };
};

function scheduler(window: Window) {
    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const timers = new Map<number, () => void>();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    jest.spyOn(window, 'setTimeout').mockImplementation(handler => {
        if (typeof handler !== 'function') throw new Error('Expected a timer callback');
        const id = nextId++;
        timers.set(id, handler as () => void);
        return id;
    });
    jest.spyOn(window, 'clearTimeout').mockImplementation(id => { if (id !== undefined) timers.delete(id); });
    return {
        frames, timers,
        frame() {
            const pending = [...frames];
            frames.clear();
            for (const [, callback] of pending) callback(0);
        },
        settle() {
            for (let count = 0; frames.size && count < 30; count += 1) this.frame();
            expect(frames.size).toBe(0);
            expect(timers.size).toBe(0);
        },
    };
}

function rect(top: number, height: number, width = 300): DOMRect {
    return { top, bottom: top + height, left: 0, right: width, height, width,
        x: 0, y: top, toJSON: () => ({}) };
}

function harness(window: TestWindow) {
    const clock = scheduler(window);
    const port = window.document.createElement('div');
    window.document.body.appendChild(port);
    const layout = { position: 0, height: 200, width: 300, contentHeight: 1200, visible: true, ready: true };
    const writes: number[] = [];
    const scrollEvents: Array<() => void> = [];
    Object.defineProperties(port, {
        scrollTop: {
            get: () => layout.position,
            set: (value: number) => {
                layout.position = Math.max(0, Math.min(layout.contentHeight - layout.height, value));
                writes.push(layout.position);
                scrollEvents.push(() => port.dispatchEvent(new window.Event('scroll')));
            },
        },
        scrollHeight: { get: () => layout.contentHeight },
        clientHeight: { get: () => layout.height },
    });
    port.getBoundingClientRect = () => rect(40, layout.height, layout.width);
    const anchors: ReadingAnchor[] = [];
    const onSnapshot = jest.fn();
    const onUserIntent = jest.fn();
    const restoreDisclosures = jest.fn();
    const controller = new ReadingPositionController({
        scrollport: port, getAnchors: () => anchors, isVisible: () => layout.visible,
        isReady: () => layout.ready, onSnapshot, onUserIntent, restoreDisclosures,
    });
    return {
        clock, port, layout, writes, anchors, onSnapshot, onUserIntent, restoreDisclosures, controller,
        anchor(id: string, top: number, height = 120) {
            const element = window.document.createElement('article');
            port.appendChild(element);
            const geometry = { top, height };
            element.getBoundingClientRect = () => rect(40 + geometry.top - layout.position, geometry.height);
            anchors.push({ id, element });
            return { element, geometry };
        },
        flushScroll() {
            for (const dispatch of scrollEvents.splice(0)) dispatch();
        },
    };
}

describe('ReadingPositionController', () => {
    const windows: TestWindow[] = [];
    const controllers: ReadingPositionController[] = [];
    function create() {
        const window = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true }).window;
        windows.push(window);
        const state = harness(window);
        controllers.push(state.controller);
        return { window, ...state };
    }

    afterEach(() => {
        for (const controller of controllers.splice(0)) controller.dispose();
        jest.restoreAllMocks();
        for (const window of windows.splice(0)) window.close();
    });

    it('captures the first visible stable anchor and rejects hidden or zero geometry', () => {
        const state = create();
        state.anchor('earlier', 0, 100);
        state.anchor('current', 100, 260);
        state.layout.position = 150;
        expect(state.controller.capture()).toEqual({ anchorId: 'current', offset: -50, fallbackTop: 150 });
        expect(state.onSnapshot).toHaveBeenCalledTimes(1);
        // Ordinary Chat auto-follow scrolls without an active explicit restore.
        state.layout.position = 175;
        state.port.dispatchEvent(new state.window.Event('scroll'));
        expect(state.onSnapshot).toHaveBeenLastCalledWith({ anchorId: 'current', offset: -75, fallbackTop: 175 });
        expect(state.onUserIntent).not.toHaveBeenCalled();
        state.layout.visible = false;
        expect(state.controller.capture()).toBeNull();
        state.port.dispatchEvent(new state.window.Event('scroll'));
        state.layout.visible = true;
        state.layout.height = 0;
        expect(state.controller.capture()).toBeNull();
        state.port.dispatchEvent(new state.window.Event('scroll'));
        expect(state.onSnapshot).toHaveBeenCalledTimes(2);
        expect(state.onUserIntent).not.toHaveBeenCalled();
    });

    it('waits without polling for disclosure/history readiness, then corrects actual relative geometry', () => {
        const state = create();
        const target = state.anchor('message', 420);
        state.layout.ready = false;
        state.controller.restore({ anchorId: 'message', offset: 20, fallbackTop: 99, disclosures: ['response'] });
        expect(state.restoreDisclosures).toHaveBeenCalledWith(['response']);
        expect(state.clock.frames.size).toBe(0);
        expect(state.clock.timers.size).toBe(0);
        expect(state.controller.capture()).toBeNull();
        state.controller.notifyLayout();
        expect(state.writes).toEqual([]);
        expect(state.clock.frames.size).toBe(0);

        state.layout.ready = true;
        state.controller.notifyLayout();
        state.clock.frame();
        expect(state.layout.position).toBe(400);
        target.geometry.top += 40;
        state.clock.frame();
        expect(state.layout.position).toBe(440);
        state.clock.settle();
        expect(target.element.getBoundingClientRect().top - state.port.getBoundingClientRect().top).toBe(20);
        // The host dispatches its delayed scroll only after restoration finished.
        state.flushScroll();
        expect(state.onUserIntent).not.toHaveBeenCalled();
        expect(state.onSnapshot).not.toHaveBeenCalled();
    });

    it('pauses scheduled work while hidden and bounds a deleted anchor fallback to the live scroll range', () => {
        const state = create();
        state.controller.restore({ anchorId: 'deleted', offset: 0, fallbackTop: 5000 });
        const oldFrame = [...state.clock.frames.values()][0];
        state.layout.visible = false;
        state.controller.notifyLayout();
        expect(state.clock.frames.size).toBe(0);
        expect(state.clock.timers.size).toBe(0);
        oldFrame(0);
        expect(state.writes).toEqual([]);
        state.layout.contentHeight = 700;
        state.layout.visible = true;
        state.controller.notifyLayout();
        state.clock.settle();
        expect(state.writes).toEqual([500]);
        state.flushScroll();
        expect(state.onUserIntent).not.toHaveBeenCalled();
    });

    it('lets new pointer, wheel, touch, keyboard and scroll intent cancel without later resurrection', () => {
        const state = create();
        state.anchor('message', 500, 800);
        for (const eventName of ['pointerdown', 'wheel', 'touchstart', 'keydown']) {
            state.controller.restore({ anchorId: 'message', offset: 0, fallbackTop: 0 });
            const lateFrame = [...state.clock.frames.values()][0];
            state.port.dispatchEvent(new state.window.Event(eventName, { bubbles: true }));
            state.controller.notifyLayout();
            lateFrame(0);
            expect(state.clock.frames.size).toBe(0);
            expect(state.clock.timers.size).toBe(0);
        }
        expect(state.onUserIntent).toHaveBeenCalledTimes(4);
        expect(state.writes).toEqual([]);
        state.controller.restore({ anchorId: 'message', offset: 0, fallbackTop: 0 });
        state.layout.position = 540;
        state.port.dispatchEvent(new state.window.Event('scroll'));
        state.controller.notifyLayout();
        expect(state.onUserIntent).toHaveBeenCalledTimes(5);
        expect(state.onSnapshot).toHaveBeenLastCalledWith({ anchorId: 'message', offset: -40, fallbackTop: 540 });
        expect(state.writes).toEqual([]);
        expect(state.clock.frames.size).toBe(0);
    });

    it('retains the pending snapshot across owner-window migration and disposes all callbacks', () => {
        const state = create();
        state.anchor('message', 500);
        state.controller.restore({ anchorId: 'message', offset: 10, fallbackTop: 0 });
        const oldFrame = [...state.clock.frames.values()][0];
        const oldTimeout = [...state.clock.timers.values()][0];
        const second = create();
        second.window.document.body.appendChild(second.window.document.adoptNode(state.port));
        const remove = jest.spyOn(state.port, 'removeEventListener');
        state.controller.rebindDocument();
        expect(state.clock.frames.size).toBe(0);
        expect(state.clock.timers.size).toBe(0);
        oldFrame(0);
        oldTimeout();
        expect(state.writes).toEqual([]);
        second.clock.settle();
        expect(state.layout.position).toBe(490);
        state.controller.restore({ anchorId: 'message', offset: 40, fallbackTop: 0 });
        const lateFrame = [...second.clock.frames.values()][0];
        const lateTimeout = [...second.clock.timers.values()][0];
        state.controller.dispose();
        state.controller.dispose();
        lateFrame(0);
        lateTimeout();
        state.controller.notifyLayout();
        state.port.dispatchEvent(new second.window.Event('wheel'));
        expect(state.writes).toEqual([490]);
        expect(state.onUserIntent).not.toHaveBeenCalled();
        expect(second.clock.frames.size).toBe(0);
        expect(second.clock.timers.size).toBe(0);
        expect(remove.mock.calls.map(([type]) => type).sort())
            .toEqual(['keydown', 'pointerdown', 'scroll', 'touchstart', 'wheel']);
        expect(state.controller.capture()).toBeNull();
    });
});
