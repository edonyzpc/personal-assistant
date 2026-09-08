import { setIcon } from 'obsidian';

export const CHAT_MENU_IDLE_CLOSE_MS = 8000;

export function createChatMenuItem(
    parent: HTMLElement,
    { text, icon, cls = '' }: { text: string; icon: string; cls?: string },
): HTMLButtonElement {
    const button = parent.createEl('button', {
        cls: `pa-chat-menu-item ${cls}`.trim(),
        attr: { type: 'button', title: text },
    });
    const iconEl = button.createSpan({ cls: 'pa-chat-menu-item-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    button.createSpan({ cls: 'pa-chat-menu-item-text', text });
    return button;
}

export function createChatMenuDivider(parent: HTMLElement) {
    parent.createDiv({ cls: 'pa-chat-menu-divider' });
}

export function createChatMenuLabel(parent: HTMLElement, text: string, icon: string) {
    const label = parent.createDiv({ cls: 'pa-chat-menu-label', attr: { title: text } });
    const iconEl = label.createSpan({ cls: 'pa-chat-menu-label-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    label.createSpan({ cls: 'pa-chat-menu-label-text', text });
    return label;
}

/** Bound an anchored menu to the visible chat pane, not just the window width. */
export function updateChatMenuAvailableWidth(menu: HTMLElement): void {
    if (menu.hidden) return;
    const win = menu.ownerDocument?.defaultView;
    const boundary = menu.closest('.llm-chat-container') ?? menu.closest('.llm-view');
    if (!win || !boundary) return;

    const bounds = boundary.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const left = Math.max(bounds.left + 8, 12);
    const right = Math.min(bounds.right - 8, win.innerWidth - 12);
    // Assistant/system action menus grow rightward; composer, Memory and user
    // action menus grow leftward from their existing CSS anchors.
    const growsRight = menu.classList.contains('pa-chat-message-menu')
        && Boolean(menu.closest('.llm-message.assistant, .llm-message.system'));
    const available = growsRight ? right - rect.left : rect.right - left;
    menu.style.setProperty('--pa-chat-menu-available-width', `${Math.max(0, Math.floor(available))}px`);
}
