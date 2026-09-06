import { Modal, Notice, TFile, type App } from 'obsidian';
import { getPlatformCrypto } from '../platform-dom';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';
import type { WritingVersionService } from './writing-versions';
import { writingSceneSchema, type WritingScene, type WritingVersion } from './writing-types';
import type { WritingSaveAction, PreparedWritingSave } from './writing-save-action';
import type { SaveReceipt } from './save-receipt-types';
import type { ChatWritingRecovery } from '../ai-services/chat-types';
import { getWritingSceneDisplayValues, WritingStyleUnavailableError, type WritingStyleReference } from './writing-style-service';

export function newWritingActionId(): string {
    const crypto = getPlatformCrypto();
    if (!crypto?.randomUUID) throw new Error('Secure action identity unavailable');
    return `writing_${crypto.randomUUID().replace(/-/g, '')}`;
}

export interface WritingModalHost {
    versions: WritingVersionService;
    save?: WritingSaveAction;
    onSelect?: (version: WritingVersion) => void;
    rememberStyle?: (versionId: string, scene: WritingScene) => Promise<void>;
    readStyleReferences?: (revisionIds: readonly string[], signal?: AbortSignal) => Promise<WritingStyleReference[]>;
    onReferencesChanged?: (listener: () => void) => () => void;
}

export class WritingRecoveryModal extends Modal {
    private closed = false;
    private busy = false;
    constructor(app: App, private readonly recovery: ChatWritingRecovery,
        private readonly commit: (text: string, origin: WritingVersion['origin']) => Promise<WritingVersion>,
        private readonly host: WritingModalHost) { super(app); }
    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-writing-modal');
        this.contentEl.createEl('h2', { text: t('plugin.chat.writing.recovery') });
        this.contentEl.createEl('p', { text: t('plugin.chat.writing.recoveryHint') });
        const raw = this.contentEl.createEl('textarea', { cls: 'pa-writing-modal__body', attr: {
            readonly: '', rows: '10', 'aria-label': t('plugin.chat.writing.rawResponse'),
        } });
        raw.value = this.recovery.rawText;
        const select = this.contentEl.createEl('button', { text: t('plugin.chat.writing.selectBody'), attr: { type: 'button' } });
        const editor = this.contentEl.createEl('textarea', { cls: 'pa-writing-modal__body', attr: { rows: '8', 'aria-label': t('plugin.chat.writing.body') } });
        let selectedText: string | undefined;
        const status = this.contentEl.createEl('p', { attr: { role: 'status' } });
        select.onclick = () => {
            const selection = raw.value.slice(raw.selectionStart, raw.selectionEnd);
            if (!selection.trim()) { status.setText(t('plugin.chat.writing.noSelection')); return; }
            selectedText = selection; editor.value = selection; status.setText('');
        };
        const keep = this.contentEl.createEl('button', { text: t('plugin.chat.writing.recoverVersion'), attr: { type: 'button' } });
        keep.onclick = async () => {
            if (this.closed || this.busy) return;
            if (selectedText === undefined || !editor.value.trim()) { status.setText(t('plugin.chat.writing.noSelection')); return; }
            this.busy = true; keep.disabled = true;
            try {
                const version = await this.commit(editor.value, editor.value === selectedText ? 'ai_generated' : 'user_edited');
                if (!this.closed) { new WritingVersionModal(this.app, this.host, version.id).open(); this.close(); }
            } catch { if (!this.closed) { status.setText(t('plugin.chat.writing.unavailable')); keep.disabled = false; } }
            finally { this.busy = false; }
        };
    }
    onClose(): void { this.closed = true; this.contentEl.empty(); }
}

/** Selected text and complete material stay coupled when switching versions. */
export class WritingVersionModal extends Modal {
    private closed = false;
    private renderEpoch = 0;
    private releaseReferences?: () => void;
    constructor(app: App, private readonly host: WritingModalHost, private versionId: string) { super(app); }
    onOpen(): void { this.closed = false; void this.render(); }
    onClose(): void { this.closed = true; this.renderEpoch++; this.releaseReferences?.(); this.contentEl.empty(); }

    private async render(): Promise<void> {
        const epoch = ++this.renderEpoch;
        this.releaseReferences?.(); this.releaseReferences = undefined;
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.empty(); this.contentEl.addClass('pa-writing-modal');
        const status = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
        try {
            const current = await this.host.versions.get(this.versionId);
            if (!current) throw new Error('missing');
            const versions = await this.host.versions.list(current.conversationId);
            if (this.closed || epoch !== this.renderEpoch) return;
            this.contentEl.createEl('h2', { text: t('plugin.chat.writing.title') });
            const picker = this.contentEl.createEl('select', { attr: { 'aria-label': t('plugin.chat.writing.version') } });
            versions.forEach((version, index) => picker.createEl('option', {
                text: `${index + 1} · ${t(version.origin === 'ai_generated' ? 'plugin.chat.writing.aiDraft' : 'plugin.chat.writing.userEdited')}`,
                attr: { value: version.id },
            }));
            picker.value = current.id;
            picker.onchange = () => { this.versionId = picker.value; void this.render(); };
            const editor = this.contentEl.createEl('textarea', { cls: 'pa-writing-modal__body', attr: { 'aria-label': t('plugin.chat.writing.body'), rows: '10' } });
            editor.value = current.text;
            const material = this.contentEl.createEl('details');
            material.createEl('summary', { text: t('plugin.chat.writing.references') });
            material.createEl('p', { text: t(!current.referenceScope ? 'plugin.chat.writing.legacyReferences'
                : current.origin === 'user_edited' ? 'plugin.chat.writing.editedReferences' : 'plugin.chat.writing.referenceHint') });
            material.createEl('h3', { text: t('plugin.chat.writing.material', { count: current.associatedImages.length }) });
            for (const image of current.associatedImages) material.createEl('p', { text: `${image.ordinal}. ${image.label}` });
            material.createEl('h3', { text: t('plugin.chat.writing.backgroundReferences', { count: current.backgroundSourceRefs.length }) });
            for (const source of current.backgroundSourceRefs) {
                const label = `${source.path}${source.heading ? ` › ${source.heading}` : ''}${source.blockId ? ` › ${source.blockId}` : ''}`;
                const link = material.createEl('button', { text: label, attr: { type: 'button' } });
                link.onclick = async () => {
                    if (!(this.app.vault.getAbstractFileByPath(source.path) instanceof TFile)) {
                        status.setText(t('plugin.chat.writing.referenceUnavailable')); return;
                    }
                    const subpath = source.blockId ? `#^${source.blockId.replace(/^\^/, '')}` : source.heading ? `#${source.heading}` : '';
                    try { await this.app.workspace.openLinkText(`${source.path}${subpath}`, '', true); }
                    catch { if (!this.closed) status.setText(t('plugin.chat.writing.referenceUnavailable')); }
                };
            }
            material.createEl('h3', { text: t('plugin.chat.writing.styleReferences', { count: current.styleRevisionIds.length }) });
            const samples = material.createDiv();
            let controller: AbortController | undefined;
            const refresh = async () => {
                controller?.abort();
                const request = new AbortController(); controller = request;
                samples.empty();
                if (!material.open || !current.styleRevisionIds.length) return;
                samples.createEl('p', { text: t('plugin.chat.writing.referencesLoading') });
                let references: WritingStyleReference[] = [];
                try { references = await this.host.readStyleReferences?.(current.styleRevisionIds, request.signal) ?? []; }
                catch { /* Keep the body usable when references are unavailable. */ }
                if (request.signal.aborted || this.closed || epoch !== this.renderEpoch) return;
                samples.empty();
                current.styleRevisionIds.forEach((id, index) => {
                    const reference = references.find((item) => item.revisionId === id && item.isCurrent());
                    samples.createEl('p', { text: `${index + 1}. ${reference
                        ? Object.values(getWritingSceneDisplayValues(reference.scene, getPluginUiLanguage())).join(' · ')
                        : t('plugin.chat.writing.referenceUnavailable')}` });
                    if (reference) samples.createEl('pre', { cls: 'pa-writing-modal__body', text: reference.exactText });
                });
            };
            material.ontoggle = () => { void refresh(); };
            const unsubscribe = this.host.onReferencesChanged?.(() => { void refresh(); });
            const vaultEvents = this.app.vault ? [
                this.app.vault.on('modify', () => { void refresh(); }),
                this.app.vault.on('delete', () => { void refresh(); }),
                this.app.vault.on('rename', () => { void refresh(); }),
            ] : [];
            this.releaseReferences = () => {
                controller?.abort(); unsubscribe?.(); material.ontoggle = null;
                for (const event of vaultEvents) this.app.vault.offref(event);
            };
            if (current.explanation) {
                const explanation = this.contentEl.createEl('details');
                explanation.createEl('summary', { text: t('plugin.chat.writing.explanation') });
                explanation.createEl('p', { text: current.explanation });
            }
            let busy = false;
            const choose = async () => {
                const chosen = await this.host.versions.edit(current.id, editor.value, newWritingActionId());
                if (this.closed || epoch !== this.renderEpoch) throw new Error('closed');
                this.versionId = chosen.id;
                return chosen;
            };
            const action = (label: string, run: (chosen: WritingVersion) => void | Promise<void>) => {
                const button = this.contentEl.createEl('button', { text: label, attr: { type: 'button' } });
                button.onclick = async () => {
                    if (busy || !editor.value.trim()) return;
                    busy = true; button.disabled = true;
                    try { await run(await choose()); }
                    catch { if (!this.closed) status.setText(t('plugin.chat.writing.unavailable')); }
                    finally { busy = false; button.disabled = false; }
                };
            };
            action(t('plugin.chat.writing.copy'), async (chosen) => {
                await navigator.clipboard.writeText(chosen.text);
                if (!this.closed) status.setText(t('plugin.chat.notice.copied'));
            });
            action(t('plugin.chat.writing.keepEdit'), async () => { await this.render(); });
            if (this.host.onSelect) action(t('plugin.chat.writing.continue'), (chosen) => { this.host.onSelect?.(chosen); this.close(); });
            if (this.host.save) action(t('plugin.chat.writing.save'), (chosen) => { new WritingSaveModal(this.app, this.host.save!, chosen).open(); });
            if (this.host.rememberStyle) action(t('plugin.chat.writing.rememberStyle'), (chosen) => {
                new WritingStyleModal(this.app, chosen, this.host.rememberStyle!).open();
            });
        } catch { if (!this.closed && epoch === this.renderEpoch) status.setText(t('plugin.chat.writing.unavailable')); }
    }
}

export class WritingSaveModal extends Modal {
    private closed = false;
    private preparing = false;
    private prepared?: PreparedWritingSave;
    private controller?: AbortController;
    private prepareController?: AbortController;
    constructor(app: App, private readonly save: WritingSaveAction, private readonly version: WritingVersion) { super(app); }
    onOpen(): void {
        this.closed = false;
        const t = makePluginTranslator(getPluginUiLanguage());
        const root = this.contentEl;
        root.addClass('pa-writing-modal');
        root.createEl('h2', { text: t('plugin.chat.writing.save') });
        const path = root.createEl('input', { attr: { type: 'text', 'aria-label': t('plugin.chat.writing.notePath') } });
        path.value = `PA Writing ${new Date().toISOString().slice(0, 10)} ${this.version.id.slice(-8)}.md`;
        const ordered = this.version.associatedImages.map((image) => ({ image, selected: true }));
        const images = root.createDiv({ cls: 'pa-writing-modal__images' });
        const renderImages = () => {
            images.empty();
            ordered.forEach((entry, index) => {
                const row = images.createDiv({ cls: 'pa-writing-modal__image' });
                const label = row.createEl('label');
                const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
                checkbox.checked = entry.selected;
                checkbox.onchange = () => { entry.selected = checkbox.checked; };
                label.createSpan({ text: entry.image.label });
                const move = row.createEl('button', { text: '↑', attr: { type: 'button', 'aria-label': t('plugin.chat.writing.moveUp') } });
                move.disabled = index === 0;
                move.onclick = () => { [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]]; renderImages(); };
            });
        };
        renderImages();
        root.createEl('p', { text: t('plugin.chat.writing.saveRules') });
        const result = root.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
        const preview = root.createEl('button', { text: t('plugin.chat.writing.preview'), attr: { type: 'button' } });
        preview.onclick = async () => {
            if (this.controller || this.preparing) return;
            this.preparing = true; preview.disabled = true; path.disabled = true; images.hidden = true;
            const prepareController = new AbortController(); this.prepareController = prepareController;
            this.prepared?.release(); this.prepared = undefined;
            result.empty();
            try {
                const prepared = await this.save.prepare({ writingVersionId: this.version.id, targetNotePath: path.value,
                    images: ordered.filter((entry) => entry.selected).map((entry) => entry.image), signal: prepareController.signal });
                if (this.closed) { prepared.release(); return; }
                this.prepared = prepared;
                path.disabled = true; images.hidden = true; preview.hidden = true;
                result.createEl('p', { text: prepared.receipt.targetNotePath });
                const body = result.createEl('pre', { cls: 'pa-writing-modal__body', text: this.version.text });
                body.setAttribute('aria-label', t('plugin.chat.writing.body'));
                for (const attachment of prepared.receipt.attachments) result.createEl('p', {
                    text: `${attachment.sourceName} → ${attachment.filename}${attachment.attachmentKind === 'heic_jpeg' ? ` · ${t('plugin.chat.writing.heicJpeg')}` : ''}`,
                });
                const details = result.createEl('details');
                details.createEl('summary', { text: t('plugin.chat.writing.fullNote') });
                details.createEl('pre', { text: prepared.previewMarkdown });
                const confirm = result.createEl('button', { text: t('plugin.chat.writing.confirmSave'), cls: 'mod-cta', attr: { type: 'button' } });
                confirm.onclick = () => { confirm.disabled = true; void this.run(prepared.operationId, false, result); };
            } catch { if (!this.closed) { result.setText(t('plugin.chat.writing.previewFailed')); path.disabled = false; images.hidden = false; } }
            finally { this.preparing = false; this.prepareController = undefined; preview.disabled = false; }
        };
        void this.save.listReceipts(this.version.id).then((receipts) => {
            if (this.closed) return;
            for (const receipt of receipts.filter((item) => item.state !== 'completed')) {
                const recovery = root.createEl('button', { text: `${t('plugin.chat.writing.retrySave')} · ${receipt.targetNotePath}`, attr: { type: 'button' } });
                recovery.onclick = () => { if (!this.controller && !this.preparing) this.showReceipt(receipt, result); };
            }
        }).catch(() => { if (!this.closed) result.setText(t('plugin.chat.writing.unavailable')); });
    }

    onClose(): void {
        this.closed = true; this.prepareController?.abort(); this.controller?.abort(); this.prepared?.release(); this.contentEl.empty();
    }

    private async run(id: string, retry: boolean, result: HTMLElement): Promise<void> {
        if (this.closed || this.controller) return;
        const t = makePluginTranslator(getPluginUiLanguage());
        const controller = new AbortController(); this.controller = controller;
        result.empty(); result.createEl('p', { text: t('plugin.chat.writing.saving') });
        const cancel = result.createEl('button', { text: t('plugin.chat.action.cancel'), attr: { type: 'button' } });
        cancel.onclick = () => controller.abort();
        try {
            const receipt = retry ? await this.save.retry(id, { signal: controller.signal }) : await this.save.execute(id, { signal: controller.signal });
            if (!this.closed) this.showReceipt(receipt, result);
        } catch { if (!this.closed) result.setText(t('plugin.chat.writing.saveFailed')); }
        finally { this.controller = undefined; }
    }

    private showReceipt(receipt: SaveReceipt, result: HTMLElement): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        result.empty();
        result.createEl('p', { text: t(receipt.state === 'completed' ? 'plugin.chat.writing.saved' : 'plugin.chat.writing.partial') });
        result.createEl('p', { text: receipt.targetNotePath });
        result.createEl('pre', { cls: 'pa-writing-modal__body', text: this.version.text });
        for (const attachment of receipt.attachments) result.createEl('p', {
            text: `${attachment.state === 'written' ? '✓ ' : ''}${attachment.plannedPath ?? attachment.filename}${attachment.attachmentKind === 'heic_jpeg' ? ` · ${t('plugin.chat.writing.heicJpeg')}` : ''}`,
        });
        if (this.app.vault.getAbstractFileByPath(receipt.targetNotePath) instanceof TFile) {
            const open = result.createEl('button', { text: receipt.targetNotePath, attr: { type: 'button' } });
            open.onclick = () => { void this.app.workspace.openLinkText(receipt.targetNotePath, '', true); };
        }
        if (receipt.state !== 'completed') {
            const retry = result.createEl('button', { text: t('plugin.chat.writing.retrySave'), attr: { type: 'button' } });
            retry.onclick = () => { retry.disabled = true; void this.run(receipt.operationId, true, result); };
        }
    }
}

/** Pending receipts remain reachable after their conversation has been pruned. */
export class WritingSaveRecoveryListModal extends Modal {
    private closed = false;
    constructor(app: App, private readonly save: WritingSaveAction, private readonly versions: WritingVersionService) { super(app); }
    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-writing-modal');
        this.contentEl.createEl('h2', { text: t('plugin.chat.writing.pendingSaves') });
        const list = this.contentEl.createDiv();
        void this.save.listReceipts().then((receipts) => {
            if (this.closed) return;
            const pending = receipts.filter((receipt) => receipt.state !== 'completed');
            if (!pending.length) list.createEl('p', { text: t('plugin.chat.writing.noPendingSaves') });
            for (const receipt of pending) {
                const button = list.createEl('button', { text: receipt.targetNotePath, attr: { type: 'button' } });
                button.onclick = async () => {
                    button.disabled = true;
                    try {
                        const version = await this.versions.get(receipt.writingVersionId);
                        if (!version) throw new Error('missing');
                        if (!this.closed) new WritingSaveModal(this.app, this.save, version).open();
                    } catch { if (!this.closed) new Notice(t('plugin.chat.writing.unavailable')); }
                    finally { button.disabled = false; }
                };
            }
        }).catch(() => { if (!this.closed) list.setText(t('plugin.chat.writing.unavailable')); });
    }
    onClose(): void { this.closed = true; this.contentEl.empty(); }
}

/** A separate explicit action: saving or editing does not enter this path. */
export class WritingStyleModal extends Modal {
    private closed = false;
    private busy = false;
    constructor(app: App, private readonly version: WritingVersion, private readonly remember: (versionId: string, scene: WritingScene) => Promise<void>) { super(app); }
    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        const root = this.contentEl; root.addClass('pa-writing-modal');
        root.createEl('h2', { text: t('plugin.chat.writing.rememberStyle') });
        root.createEl('p', { text: t('plugin.chat.writing.styleScope') });
        root.createEl('pre', { cls: 'pa-writing-modal__body', text: this.version.text });
        const fields = {} as Record<keyof WritingScene, HTMLInputElement>;
        const displayScene = this.version.scene ? getWritingSceneDisplayValues(this.version.scene, getPluginUiLanguage()) : undefined;
        const labels = { writingTask: 'plugin.chat.writing.sceneTask', purpose: 'plugin.chat.writing.scenePurpose', audience: 'plugin.chat.writing.sceneAudience', domain: 'plugin.chat.writing.sceneDomain' } as const;
        for (const key of Object.keys(labels) as Array<keyof WritingScene>) {
            const label = root.createEl('label', { text: t(labels[key]) });
            fields[key] = label.createEl('input', { attr: { type: 'text', maxlength: '64' } });
            fields[key].value = displayScene?.[key] ?? '';
        }
        const status = root.createEl('p', { attr: { role: 'status' } });
        const accept = root.createEl('button', { text: t('plugin.chat.writing.confirmStyle'), attr: { type: 'button' } });
        accept.onclick = async () => {
            if (this.closed || this.busy) return;
            const scene = writingSceneSchema.safeParse(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
            if (!scene.success || new TextEncoder().encode(this.version.text).byteLength > 8192) {
                status.setText(t('plugin.chat.writing.styleInvalid')); return;
            }
            this.busy = true; accept.disabled = true;
            try { await this.remember(this.version.id, scene.data); if (!this.closed) { new Notice(t('plugin.chat.writing.styleRemembered')); this.close(); } }
            catch (error) {
                if (!this.closed) {
                    status.setText(t(error instanceof WritingStyleUnavailableError
                        ? error.code === 'legacy_memory' ? 'plugin.chat.writing.styleLegacyMemory' : 'plugin.chat.writing.styleMemoryUnavailable'
                        : 'plugin.chat.writing.unavailable'));
                    accept.disabled = false;
                }
            }
            finally { this.busy = false; }
        };
    }
    onClose(): void { this.closed = true; this.contentEl.empty(); }
}
