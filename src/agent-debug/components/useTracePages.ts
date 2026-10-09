import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { AgentDebugViewHost } from '../view';
import type { DebugEvent, DebugRun } from '../types';
import { TraceAccumulator } from '../trace-model';

export interface TraceLoad {
    captureId?: string;
    events: DebugEvent[];
    run?: DebugRun;
    state: 'loading' | 'saving' | 'ready' | 'partial' | 'error' | 'cleared';
    reason?: string;
}

/** One viewer owns one accumulator. Notifications coalesce without cancelling a page chain. */
export function useTracePages(host: AgentDebugViewHost, captureId: string | undefined, revision: number,
    epoch: MutableRefObject<number>, visible: MutableRefObject<boolean>) {
    const cache = useRef(new TraceAccumulator());
    const job = useRef({ captureId: undefined as string | undefined, token: 0, running: false, requested: false });
    const yielding = useRef<{ timer: ReturnType<typeof setTimeout>; resume: () => void }>();
    const [load, setLoad] = useState<TraceLoad>({ events: [], state: 'ready' });
    const cancelYield = () => {
        if (!yielding.current) return;
        clearTimeout(yielding.current.timer); yielding.current.resume(); yielding.current = undefined;
    };
    const invalidate = () => {
        job.current.token++; job.current.running = false; job.current.requested = false;
        cancelYield();
        cache.current.clear(); setLoad({ events: [], state: 'cleared' });
    };
    useEffect(() => {
        if (job.current.captureId !== captureId) {
            job.current.token++; job.current.captureId = captureId; job.current.running = false;
            cancelYield();
            job.current.requested = false; cache.current.clear();
            setLoad({ captureId, events: [], state: captureId ? 'loading' : 'ready' });
        }
        if (!captureId || !visible.current) return;
        if (job.current.running) { job.current.requested = true; return; }
        const token = job.current.token;
        const generation = epoch.current;
        const isCurrent = () => token === job.current.token && generation === epoch.current && visible.current;
        const read = async () => {
            job.current.running = true;
            do {
                job.current.requested = false;
                let after = cache.current.completedThrough;
                let through: number | undefined;
                setLoad(previous => ({ ...previous, captureId, state: 'loading' }));
                try {
                    while (isCurrent()) {
                        const page = await host.getTracePage(captureId, { after, through, limit: 500 });
                        if (!isCurrent()) break;
                        if (page.availability === 'cleared') {
                            cache.current.clear(); setLoad({ captureId, events: [], state: 'cleared', reason: page.reason }); break;
                        }
                        if (page.availability === 'unavailable') {
                            setLoad(previous => ({ ...previous, captureId, state: 'error', reason: page.reason })); break;
                        }
                        cache.current.apply(page, after);
                        setLoad({ captureId, events: cache.current.events(), run: page.run ?? undefined,
                            state: page.hasMore ? 'loading' : page.reason === 'persistence_pending' ? 'saving'
                                : page.availability === 'partial' ? 'partial' : 'ready', reason: page.reason });
                        if (!page.hasMore) break;
                        through = page.through; after = page.nextAfter;
                        await new Promise<void>(resolve => {
                            const timer = setTimeout(() => { yielding.current = undefined; resolve(); }, 0);
                            yielding.current = { timer, resume: resolve };
                        });
                    }
                } catch {
                    if (isCurrent()) setLoad(previous => ({ ...previous, state: 'error' }));
                }
            } while (isCurrent() && job.current.requested);
            if (token === job.current.token) job.current.running = false;
        };
        void read();
    }, [host, captureId, revision, epoch, visible]);
    useEffect(() => () => { job.current.token++; cancelYield(); cache.current.clear(); }, []);
    const currentLoad: TraceLoad = load.captureId === captureId ? load : { captureId, events: [], state: 'loading' };
    return { load: currentLoad, invalidate };
}
