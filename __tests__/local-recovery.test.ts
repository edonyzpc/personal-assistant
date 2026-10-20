import type { App } from 'obsidian';
import { LocalRecovery, UI_RECOVERY_KEY, deleteConversationRecovery } from '../src/ui/local-recovery';

function fixture(values = new Map<string, string>()) {
    const app = {
        loadLocalStorage: jest.fn((key: string) => values.has(key) ? JSON.parse(values.get(key)!) : null),
        saveLocalStorage: jest.fn((key: string, data: unknown | null) => {
            if (data === null) values.delete(key);
            else values.set(key, JSON.stringify(data));
        }),
    } as unknown as App;
    const failure = jest.fn();
    const deleted = jest.fn();
    const open = (conversationId: string | null, slotId?: string) => new LocalRecovery({
        app, route: { conversationId, slotId }, onFailure: failure, onDeleted: deleted,
        decode: (value: unknown) => {
            if (typeof value !== 'string') throw new Error('Invalid draft');
            return value;
        },
        isEmpty: (value: string) => value === '',
    });
    return { app, values, failure, deleted, open };
}

describe('device-local UI recovery', () => {
    afterEach(() => jest.useRealTimers());

    it('isolates occupied routes and reclaims a closed unbound slot across a new App instance', () => {
        const first = fixture();
        const a = first.open(null);
        a.edit('draft a');
        a.flush();
        const duplicate = first.open(null, a.route.slotId);
        expect(duplicate.route.slotId).not.toBe(a.route.slotId);
        expect(duplicate.restored()).toBeNull();
        duplicate.edit('draft b');
        duplicate.close();
        a.bindConversation('conversation');
        a.close();
        const restarted = fixture(first.values);
        const reopened = restarted.open('conversation', a.route.slotId);
        expect(reopened.restored()?.draft).toBe('draft a');
        const unbound = restarted.open(null);
        expect(unbound.restored()?.draft).toBe('draft b');
        reopened.close();
        unbound.close();
    });

    it('keeps failed empty consumption dirty and retries on normal close', () => {
        const f = fixture();
        const slot = f.open('conversation');
        slot.edit('sent');
        slot.flush();
        (f.app.saveLocalStorage as jest.Mock).mockImplementationOnce(() => { throw new Error('disk'); });
        slot.edit('', true);
        expect(f.failure).toHaveBeenCalledTimes(1);
        slot.close();
        expect(f.values.has(UI_RECOVERY_KEY)).toBe(false);
    });

    it('drops empty unbound slots with no reading target while retaining drafts and conversation positions', () => {
        const f = fixture();
        const conversation = f.open('conversation');
        conversation.initializeEmpty('');
        conversation.setReading({ offset: 0, fallbackTop: 0 });
        conversation.close();
        const draft = f.open(null);
        draft.edit('unsent');
        draft.setReading({ offset: 0, fallbackTop: 0 });
        draft.close();

        for (const slotId of ['empty-first', 'empty-second']) {
            const empty = f.open(null, slotId);
            empty.initializeEmpty('');
            empty.setReading({ offset: 0, fallbackTop: 0 });
            empty.close();
        }
        const slots = () => JSON.parse(f.values.get(UI_RECOVERY_KEY)!).slots;
        expect(slots().map((slot: { slotId: string }) => slot.slotId))
            .toEqual([conversation.route.slotId, draft.route.slotId]);

        const cleared = f.open(null, draft.route.slotId);
        cleared.edit('', true);
        cleared.close();
        expect(slots()).toEqual([expect.objectContaining({
            conversationId: 'conversation', reading: { offset: 0, fallbackTop: 0 },
        })]);
    });

    it('preserves a corrupt slot through passive reading and close, but accepts a new edit', () => {
        const f = fixture();
        f.values.set(UI_RECOVERY_KEY, JSON.stringify({ schemaVersion: 1, slots: [
            { slotId: 'bad', conversationId: 'conversation', savedAt: 1, draft: { corrupt: true }, reading: null },
        ] }));
        const original = f.values.get(UI_RECOVERY_KEY);
        const bad = f.open('conversation');
        bad.initializeEmpty('');
        bad.setReading({ offset: 0, fallbackTop: 12 });
        bad.close();
        expect(f.values.get(UI_RECOVERY_KEY)).toBe(original);
        const edited = f.open('conversation');
        edited.edit('new valid edit');
        edited.close();
        expect(f.open('conversation').restored()?.draft).toBe('new valid edit');
    });

    it('coalesces edits and invalidates pending writes across all deleted conversation slots', () => {
        jest.useFakeTimers();
        const f = fixture();
        const a = f.open('conversation');
        const b = f.open('conversation');
        a.edit('a'); a.edit('aa'); b.edit('b');
        expect(f.app.saveLocalStorage).not.toHaveBeenCalled();
        jest.advanceTimersByTime(250);
        expect(f.app.saveLocalStorage).toHaveBeenCalledTimes(2);
        a.edit('late');
        deleteConversationRecovery(f.app, 'conversation');
        expect(f.deleted).toHaveBeenCalledTimes(2);
        a.edit('later'); b.close();
        jest.runOnlyPendingTimers();
        expect(f.values.has(UI_RECOVERY_KEY)).toBe(false);
    });

    it('does not overwrite an unread backend on a no-edit close', () => {
        const f = fixture();
        (f.app.loadLocalStorage as jest.Mock).mockImplementation(() => { throw new Error('unreadable'); });
        const slot = f.open(null);
        slot.initializeEmpty('');
        slot.setReading({ offset: 0, fallbackTop: 20 });
        slot.close();
        expect(f.app.saveLocalStorage).not.toHaveBeenCalled();
        expect(f.failure).toHaveBeenCalled();
    });

    it('repairs only an edited damaged slot while retaining unrelated and unidentifiable bytes', () => {
        const f = fixture();
        const untouched = { slotId: 'other', conversationId: 'other', savedAt: 2, draft: 'other unsent', reading: null };
        const unidentifiable = { damaged: 'preserve these bytes' };
        f.values.set(UI_RECOVERY_KEY, JSON.stringify({ schemaVersion: 1, slots: [
            { slotId: 'bad', conversationId: 'conversation', savedAt: 'broken', draft: 'old', reading: null },
            untouched, unidentifiable,
        ] }));
        const slot = f.open('conversation', 'bad');
        expect(slot.restored()).toBeNull();
        slot.edit('new intentional edit');
        expect(slot.flush()).toBe(true);
        const saved = JSON.parse(f.values.get(UI_RECOVERY_KEY)!).slots;
        expect(saved).toContainEqual(untouched);
        expect(saved).toContainEqual(unidentifiable);
        expect(saved.find((entry: { slotId?: string }) => entry.slotId === 'bad').draft).toBe('new intentional edit');
        slot.close();
    });

    it('keeps unknown index schemas intact even after an edit rather than discarding other drafts', () => {
        const f = fixture();
        const unknown = JSON.stringify({ schemaVersion: 9, slots: { futureDrafts: ['preserve'] } });
        f.values.set(UI_RECOVERY_KEY, unknown);
        const slot = f.open(null);
        slot.edit('current unsent draft');
        expect(slot.flush()).toBe(false);
        slot.close();
        expect(f.values.get(UI_RECOVERY_KEY)).toBe(unknown);
        expect(f.failure).toHaveBeenCalled();
    });
});
