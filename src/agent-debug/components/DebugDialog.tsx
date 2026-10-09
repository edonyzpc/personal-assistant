import { useEffect, useRef, type ReactNode } from 'react';
import { debugT as t } from './debug-format';

export function DebugDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        const prior = dialog?.ownerDocument.activeElement;
        // showModal owns background isolation. Extra viewer-level inert would block close's focus restoration.
        dialog?.showModal();
        return () => { dialog?.close(); if (prior?.isConnected && 'focus' in prior) (prior as HTMLElement).focus(); };
    }, []);
    return <dialog ref={ref} className="pa-agent-debug-dialog" aria-label={title}
        onKeyDown={event => {
            if (event.key !== 'Escape') return;
            // The modal owns Escape before Obsidian's workspace shortcuts can handle the same key.
            event.preventDefault(); event.stopPropagation(); onClose();
        }} onCancel={event => { event.preventDefault(); onClose(); }}>
        <header><h3>{title}</h3><button type="button" onClick={onClose}>{t('plugin.agentDebug.close')}</button></header>
        <div className="pa-agent-debug-dialog-content">{children}</div>
    </dialog>;
}
