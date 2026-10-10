import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

/** Obsidian owns icon construction; React owns this viewer-local container. */
export function DebugIcon({ name, className }: { name: string; className?: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const container = ref.current;
        if (!container) return;
        setIcon(container, name);
        return () => container.replaceChildren();
    }, [name]);
    return <span ref={ref} className={`pa-agent-debug-icon${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
