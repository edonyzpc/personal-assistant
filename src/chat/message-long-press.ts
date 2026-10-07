import { clearPlatformTimeout, getOptionalPlatformDocument, setPlatformTimeout, type PlatformTimeoutHandle } from '../platform-dom';

type MessagePressTarget = {
    roleEl: HTMLElement;
    isCurrent: () => boolean;
    open: () => void;
};

/** Leave message contents to native selection and embedded controls. */
export function registerMessageLongPress(
    container: HTMLElement,
    resolve: (message: HTMLElement) => MessagePressTarget | undefined,
) {
    const doc = container.ownerDocument ?? getOptionalPlatformDocument();
    let pending: { message: HTMLElement; target: MessagePressTarget; pointerId: number; x: number; y: number } | null = null;
    let timer: PlatformTimeoutHandle | null = null;
    let completedMessage: HTMLElement | null = null;
    const cancel = () => {
        if (timer !== null) clearPlatformTimeout(timer);
        timer = null;
        pending = null;
    };
    const pressTarget = (element: HTMLElement) => {
        const message = element.closest('.llm-message') as HTMLElement | null;
        const target = message ? resolve(message) : undefined;
        if (!message || !target || element.closest('button')) return undefined;
        if (element !== message && !target.roleEl.contains(element)) return undefined;
        return { message, target };
    };
    const onPointerDown = (event: PointerEvent) => {
        cancel();
        completedMessage = null;
        if (event.button !== 0 || !event.isPrimary) return;
        const match = pressTarget(event.target as HTMLElement);
        if (!match) return;
        pending = { ...match, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        timer = setPlatformTimeout(() => {
            const press = pending;
            cancel();
            if (!press?.target.isCurrent()) return;
            completedMessage = press.message;
            press.target.open();
        }, 500);
    };
    const onPointerMove = (event: PointerEvent) => {
        if (!pending || pending.pointerId !== event.pointerId) return;
        const rect = pending.message.getBoundingClientRect();
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10
            || event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom) cancel();
    };
    const onClick = (event: MouseEvent) => {
        if (!completedMessage) return;
        const match = pressTarget(event.target as HTMLElement);
        if (match?.message !== completedMessage) return;
        // Consume only the release click from this long press, never a menu action.
        completedMessage = null;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
        const match = pressTarget(event.target as HTMLElement);
        if (!match?.target.isCurrent()) return;
        event.preventDefault();
        cancel();
        match.target.open();
    };
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('contextmenu', onContextMenu);
    doc?.addEventListener('pointermove', onPointerMove, true);
    doc?.addEventListener('pointerup', cancel, true);
    doc?.addEventListener('pointercancel', cancel, true);
    doc?.addEventListener('scroll', cancel, true);
    doc?.addEventListener('click', onClick, true);
    return {
        cancel,
        dispose: () => {
            cancel();
            completedMessage = null;
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('contextmenu', onContextMenu);
            doc?.removeEventListener('pointermove', onPointerMove, true);
            doc?.removeEventListener('pointerup', cancel, true);
            doc?.removeEventListener('pointercancel', cancel, true);
            doc?.removeEventListener('scroll', cancel, true);
            doc?.removeEventListener('click', onClick, true);
        },
    };
}
