import { describe, expect, it, jest } from '@jest/globals';
import { updateChatMenuAvailableWidth } from '../src/chat/menu-helpers';

jest.mock('obsidian');

function createMenu({ paneLeft = 800, paneRight = 1100, menuLeft = 780, menuRight = 1080,
    viewport = 1200, message = false, growsRight = false, hidden = false } = {}) {
    const bounds = { left: paneLeft, right: paneRight };
    const setProperty = jest.fn();
    const menu = {
        hidden,
        ownerDocument: { defaultView: { innerWidth: viewport } },
        classList: { contains: () => message },
        closest: (selector: string) => {
            if (selector === '.llm-message.assistant, .llm-message.system') return growsRight ? {} : null;
            if (selector === '.llm-chat-container' && !message) return null;
            return { getBoundingClientRect: () => bounds };
        },
        getBoundingClientRect: () => ({ left: menuLeft, right: menuRight }),
        style: { setProperty },
    } as unknown as HTMLElement;
    return { menu, bounds, setProperty };
}

describe('anchored chat menu width', () => {
    it('uses the space left of the actual composer/Memory anchor in a narrow sidebar', () => {
        const { menu, setProperty } = createMenu();
        updateChatMenuAvailableWidth(menu);
        expect(setProperty).toHaveBeenLastCalledWith('--pa-chat-menu-available-width', '272px');
    });

    it('recomputes an open menu when its pane shrinks and grows again', () => {
        const { menu, bounds, setProperty } = createMenu();
        bounds.left = 950;
        updateChatMenuAvailableWidth(menu);
        expect(setProperty).toHaveBeenLastCalledWith('--pa-chat-menu-available-width', '122px');
        bounds.left = 700;
        updateChatMenuAvailableWidth(menu);
        expect(setProperty).toHaveBeenLastCalledWith('--pa-chat-menu-available-width', '372px');
    });

    it.each([false, true])('bounds message menus on their actual opening side (grows right: %s)', (growsRight) => {
        const { menu, setProperty } = createMenu({ message: true, growsRight, menuLeft: 830, menuRight: 970 });
        updateChatMenuAvailableWidth(menu);
        expect(setProperty).toHaveBeenLastCalledWith('--pa-chat-menu-available-width', growsRight ? '262px' : '162px');
    });

    it('intersects pane bounds with a smaller viewport', () => {
        const { menu, setProperty } = createMenu({ paneLeft: -40, paneRight: 500, menuLeft: 20,
            menuRight: 400, viewport: 320, message: true, growsRight: true });
        updateChatMenuAvailableWidth(menu);
        expect(setProperty).toHaveBeenLastCalledWith('--pa-chat-menu-available-width', '288px');
    });

    it('does not measure or update closed menus', () => {
        const { menu, setProperty } = createMenu({ hidden: true });
        updateChatMenuAvailableWidth(menu);
        expect(setProperty).not.toHaveBeenCalled();
    });
});
