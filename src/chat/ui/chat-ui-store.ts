import { createStore, type StoreApi } from 'zustand/vanilla';

export interface ChatUiState {
    viewVisible: boolean;
    taskDetailsOpen: Record<string, boolean>;
    taskMenusOpen: Record<string, boolean>;
    setViewVisible(visible: boolean): void;
    setTaskDetailsOpen(taskId: string, open: boolean): void;
    setTaskMenuOpen(menuId: string, open: boolean): void;
    closeTaskMenus(): void;
    releaseTask(taskId: string): void;
}

export type ChatUiStore = StoreApi<ChatUiState>;

export function createChatUiStore(): ChatUiStore {
    return createStore<ChatUiState>()((set, get) => ({
        viewVisible: true,
        taskDetailsOpen: {},
        taskMenusOpen: {},
        setViewVisible: visible => {
            if (get().viewVisible === visible) return;
            set({ viewVisible: visible });
            if (!visible) get().closeTaskMenus();
        },
        setTaskDetailsOpen: (taskId, open) => {
            if ((get().taskDetailsOpen[taskId] ?? false) === open) return;
            set({ taskDetailsOpen: { ...get().taskDetailsOpen, [taskId]: open } });
        },
        setTaskMenuOpen: (menuId, open) => {
            if ((get().taskMenusOpen[menuId] ?? false) === open) return;
            const taskMenusOpen = open
                ? { ...get().taskMenusOpen, [menuId]: true }
                : Object.fromEntries(Object.entries(get().taskMenusOpen).filter(([key, value]) => key !== menuId || !value));
            set({ taskMenusOpen });
        },
        closeTaskMenus: () => {
            if (Object.values(get().taskMenusOpen).every(value => !value)) return;
            set({ taskMenusOpen: {} });
        },
        releaseTask: taskId => {
            if (get().taskDetailsOpen[taskId] === undefined
                && !Object.keys(get().taskMenusOpen).some(key => key.startsWith(`${taskId}:`))) return;
            const taskDetailsOpen = { ...get().taskDetailsOpen };
            delete taskDetailsOpen[taskId];
            const taskMenusOpen = Object.fromEntries(
                Object.entries(get().taskMenusOpen).filter(([key]) => !key.startsWith(`${taskId}:`)),
            );
            set({ taskDetailsOpen, taskMenusOpen });
        },
    }));
}
