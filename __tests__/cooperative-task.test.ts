import { createCooperativeTask } from '../src/ai-services/cooperative-task';

describe('cooperative task', () => {
    it('yields on the elapsed budget before reaching the item limit', async () => {
        const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
        try {
            const task = createCooperativeTask();
            expect(await task.checkpoint()).toBe(false);
            clock.mockReturnValue(8);
            expect(await task.checkpoint()).toBe(true);
            expect(await task.checkpoint()).toBe(false);
        } finally { clock.mockRestore(); }
    });

    it('allows an input macrotask before a long loop completes', async () => {
        let inputHandled = false;
        const input = new Promise<void>(resolve => setTimeout(() => {
            inputHandled = true;
            resolve();
        }, 0));
        const task = createCooperativeTask();
        let handledDuringLoop = false;
        for (let index = 0; index < 192; index++) {
            await task.checkpoint();
            handledDuringLoop ||= inputHandled;
        }
        expect(handledDuringLoop).toBe(true);
        await input;
    });

    it('rejects a cancelled slice before work resumes', async () => {
        const controller = new AbortController();
        const resumed = jest.fn();
        const task = createCooperativeTask(controller.signal, resumed);
        const pending = task.checkpoint(true);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(resumed).toHaveBeenCalledTimes(1);
    });
});
