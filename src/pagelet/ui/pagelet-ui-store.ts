import { createStore, type StoreApi } from 'zustand/vanilla';

export interface PageletUiState {
    viewVisible: boolean;
    sectionsExpanded: boolean;
    savedInsightRestoreTargetId: string | null;
    setViewVisible(visible: boolean): void;
    setSectionsExpanded(expanded: boolean): void;
    setSavedInsightRestoreTargetId(id: string | null): void;
}

export type PageletUiStore = StoreApi<PageletUiState>;

export function createPageletUiStore(): PageletUiStore {
    return createStore<PageletUiState>()((set, get) => ({
        viewVisible: true,
        sectionsExpanded: false,
        savedInsightRestoreTargetId: null,
        setViewVisible: viewVisible => {
            if (get().viewVisible !== viewVisible) set({ viewVisible });
        },
        setSectionsExpanded: sectionsExpanded => {
            if (get().sectionsExpanded !== sectionsExpanded) set({ sectionsExpanded });
        },
        setSavedInsightRestoreTargetId: savedInsightRestoreTargetId => {
            if (get().savedInsightRestoreTargetId !== savedInsightRestoreTargetId) {
                set({ savedInsightRestoreTargetId });
            }
        },
    }));
}
