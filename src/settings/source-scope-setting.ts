/** Caller-owned draft for one source exclusion field, retained across Settings renders. */
export interface SourceScopeSettingState {
    draft?: string;
    dirty: boolean;
    pending: boolean;
    failed: boolean;
    editRevision: number;
    refresh?: () => void;
}

export function createSourceScopeSettingState(): SourceScopeSettingState {
    return { dirty: false, pending: false, failed: false, editRevision: 0 };
}

interface SourceScopeTextControl {
    setPlaceholder(value: string): unknown;
    setValue(value: string): unknown;
    onChange(callback: (value: string) => void): unknown;
}

interface SourceScopeSettingRow {
    addText(callback: (text: SourceScopeTextControl) => void): unknown;
}

interface SourceScopeSettingOptions {
    state: SourceScopeSettingState;
    read: () => string[];
    parse: (draft: string) => string[];
    save: (next: string[]) => Promise<void>;
    placeholder: string;
    copy: { save: string; saving: string; failed: string; retry: string };
    isCurrent?: () => boolean;
    log?: (...args: unknown[]) => void;
}

/** Text edits never publish a broader source scope; only an explicit save may do so. */
export function renderSourceScopeSetting(
    parentEl: HTMLElement,
    setting: SourceScopeSettingRow,
    options: SourceScopeSettingOptions,
): void {
    const { state, read, parse, copy } = options;
    if (state.draft === undefined || (!state.dirty && !state.pending && !state.failed)) {
        state.draft = read().join(", ");
    }
    const actions = parentEl.createEl("div", { cls: "pa-settings-source-scope-actions" });
    const button = actions.createEl("button", { text: copy.save, attr: { type: "button" } });
    const status = actions.createEl("span", { attr: { role: "status", "aria-live": "polite" } });
    let input: SourceScopeTextControl | undefined;
    let updating = false;
    let displayedDraft = state.draft;
    const isCurrent = () => state.refresh === refresh
        && parentEl.isConnected !== false && options.isCurrent?.() !== false;
    const refresh = () => {
        if (!isCurrent()) return;
        updating = true;
        try {
            if (displayedDraft !== state.draft) {
                input?.setValue(state.draft ?? "");
                displayedDraft = state.draft ?? "";
            }
            button.disabled = state.pending || !state.dirty;
            button.textContent = state.pending ? copy.saving : state.failed ? copy.retry : copy.save;
            status.textContent = state.failed ? copy.failed : state.pending ? copy.saving : "";
        } finally {
            updating = false;
        }
    };
    state.refresh = refresh;
    setting.addText((text) => {
        input = text;
        text.setPlaceholder(options.placeholder);
        text.setValue(state.draft ?? "");
        text.onChange((value) => {
            if (updating || !isCurrent()) return;
            state.draft = value;
            displayedDraft = value;
            state.editRevision += 1;
            state.dirty = JSON.stringify(parse(value)) !== JSON.stringify(read());
            state.failed = false;
            refresh();
        });
    });
    const saveDraft = async () => {
        if (!isCurrent() || state.pending || !state.dirty) return;
        const revision = state.editRevision;
        const requested = [...parse(state.draft ?? "")];
        state.pending = true;
        state.failed = false;
        refresh();
        try {
            await options.save(requested);
            if (revision === state.editRevision) state.draft = read().join(", ");
        } catch (error) {
            state.failed = true;
            options.log?.("Source scope changes were not saved", error);
        } finally {
            state.pending = false;
            state.dirty = JSON.stringify(parse(state.draft ?? "")) !== JSON.stringify(read());
            // A reopened field receives the result; an old render never touches its replacement.
            state.refresh?.();
        }
    };
    button.addEventListener("click", () => { void saveDraft(); });
    refresh();
}
