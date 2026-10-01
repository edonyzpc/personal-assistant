import { createCooperativeTask } from '../src/ai-services/cooperative-task';

describe('cooperative task', () => {
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
