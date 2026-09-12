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
        private readonly commit: (text: string, origin: WritingVersion['origin'], confirmedIncompleteSources?: boolean) => Promise<WritingVersion>,
        private readonly host: WritingModalHost,
        private readonly requiresSourceConfirmation = false) { super(app); }
    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-writing-modal');
        this.contentEl.createEl('h2', { text: t('plugin.chat.writing.recovery') });
        this.contentEl.createEl('p', { text: t('plugin.chat.writing.recoveryHint') });
        if (this.requiresSourceConfirmation) {
            this.contentEl.createEl('p', { text: t('plugin.chat.writing.incompleteRecoverySources') });
        }
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
        const keep = this.contentEl.createEl('button', { text: t(this.requiresSourceConfirmation
            ? 'plugin.chat.writing.confirmRecovery' : 'plugin.chat.writing.recoverVersion'), attr: { type: 'button' } });
        keep.onclick = async () => {
            if (this.closed || this.busy) return;
            if (selectedText === undefined || !editor.value.trim()) { status.setText(t('plugin.chat.writing.noSelection')); return; }
            this.busy = true; keep.disabled = true;
            try {
                const version = await this.commit(editor.value, editor.value === selectedText ? 'ai_generated' : 'user_edited',
                    this.requiresSourceConfirmation ? true : undefined);
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
            if (this.host.save) action(t('plugin.chat.writing.save'), (chosen) => {
                new WritingSaveModal(this.app, this.host.save!, chosen, () => this.close()).open();
            });
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
    constructor(app: App, private readonly save: WritingSaveAction, private readonly version: WritingVersion,
        private readonly onNoteOpened?: () => void) { super(app); }
    onOpen(): void {
        this.closed = false;
        const t = makePluginTranslator(getPluginUiLanguage());
        const root = this.contentEl;
        root.addClass('pa-writing-modal');
        root.createEl('h2', { text: t('plugin.chat.writing.save') });
        const form = root.createEl('fieldset', { cls: 'pa-writing-save__form' });
        const titleLabel = form.createEl('label', { cls: 'pa-writing-save__field', text: t('plugin.chat.writing.noteTitle') });
        const title = titleLabel.createEl('input', { attr: { type: 'text' } });
        title.value = `PA Writing ${new Date().toISOString().slice(0, 10)} ${this.version.id.slice(-8)}`;
        const location = form.createEl('details', { cls: 'pa-writing-save__location' });
        const locationSummary = location.createEl('summary', { cls: 'pa-writing-save__location-summary' });
        const destination = locationSummary.createSpan();
        locationSummary.createSpan({ text: t('plugin.chat.writing.changeLocation') });
        const folderLabel = location.createEl('label', { cls: 'pa-writing-save__field', text: t('plugin.chat.writing.folder') });
        const folder = folderLabel.createEl('input', { attr: { type: 'text' } });
        location.createEl('p', { text: t('plugin.chat.writing.folderHint') });
        const updateLocation = () => destination.setText(t('plugin.chat.writing.saveLocation', {
            folder: folder.value.trim() || t('plugin.chat.writing.vaultRoot'),
        }));
        folder.oninput = updateLocation;
        updateLocation();
        const ordered = this.version.associatedImages.map((image) => ({ image, selected: true }));
        const imageSummary = form.createEl('p', { cls: 'pa-writing-save__image-summary' });
        const updateImageSummary = () => imageSummary.setText(t('plugin.chat.writing.imageSummary', {
            count: ordered.filter((entry) => entry.selected).length,
        }));
        const imageOptions = form.createEl('details', { cls: 'pa-writing-save__image-options' });
        imageOptions.hidden = !ordered.length;
        imageOptions.createEl('summary', { text: t('plugin.chat.writing.imageSelection') });
        const images = imageOptions.createDiv({ cls: 'pa-writing-modal__images' });
        const renderImages = () => {
            images.empty();
            ordered.forEach((entry, index) => {
                const row = images.createDiv({ cls: 'pa-writing-modal__image' });
                const label = row.createEl('label');
                const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
                checkbox.checked = entry.selected;
                checkbox.onchange = () => { entry.selected = checkbox.checked; updateImageSummary(); };
                label.createSpan({ text: entry.image.label });
                const move = row.createEl('button', { text: '↑', attr: { type: 'button', 'aria-label': t('plugin.chat.writing.moveUp') } });
                move.disabled = index === 0;
                move.onclick = () => { [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]]; renderImages(); };
            });
        };
        renderImages();
        updateImageSummary();
        if (ordered.length) form.createEl('p', { text: t('plugin.chat.writing.attachmentRules') });
        const preview = form.createEl('button', { text: t('plugin.chat.writing.preview'), cls: 'mod-cta', attr: { type: 'button' } });
        const result = root.createDiv({ cls: 'pa-writing-save__result', attr: { role: 'status', 'aria-live': 'polite' } });
        preview.onclick = async () => {
            if (this.closed || this.controller || this.preparing) return;
            const noteTitle = title.value.trim().replace(/\.md$/i, '');
            if (!noteTitle || /[/\\]/.test(noteTitle)) {
                result.setText(t('plugin.chat.writing.titleInvalid')); title.focus(); return;
            }
            // Preserve traversal and invalid separators for the existing save-path validator.
            const folderPath = folder.value.trim();
            const targetNotePath = `${folderPath ? `${folderPath}/` : ''}${noteTitle}.md`;
            this.preparing = true; form.disabled = true;
            const prepareController = new AbortController(); this.prepareController = prepareController;
            this.releasePrepared();
            result.empty();
            try {
                const prepared = await this.save.prepare({ writingVersionId: this.version.id, targetNotePath,
                    images: ordered.filter((entry) => entry.selected).map((entry) => entry.image), signal: prepareController.signal });
                if (this.closed || prepareController.signal.aborted) { prepared.release(); return; }
                this.prepared = prepared;
                form.hidden = true;
                this.renderDestination(result, prepared.receipt.targetNotePath);
                const body = result.createEl('pre', { cls: 'pa-writing-modal__body', text: this.version.text });
                body.setAttribute('aria-label', t('plugin.chat.writing.body'));
                this.renderSaveDetails(result, prepared.receipt, prepared.previewMarkdown);
                const actions = result.createDiv({ cls: 'pa-writing-save__actions' });
                const edit = actions.createEl('button', { text: t('plugin.chat.writing.editSave'), attr: { type: 'button' } });
                edit.onclick = () => { this.releasePrepared(); result.empty(); form.hidden = false; title.focus(); };
                const confirm = actions.createEl('button', { text: t('plugin.chat.writing.confirmSave'), cls: 'mod-cta', attr: { type: 'button' } });
                confirm.onclick = () => { confirm.disabled = true; void this.run(prepared.receipt, false, result); };
            } catch (error) {
                if (!this.closed) result.setText(t(/heic[-_]unsupported/.test(String(error))
                    ? 'plugin.chat.writing.heicUnsupported' : 'plugin.chat.writing.previewFailed'));
            }
            finally { this.preparing = false; this.prepareController = undefined; form.disabled = false; }
        };
        const recoveries = root.createDiv();
        void this.save.listReceipts(this.version.id).then((receipts) => {
            if (this.closed) return;
            for (const receipt of receipts.filter((item) => item.state !== 'completed')) {
                const recovery = recoveries.createEl('button', { text: `${t('plugin.chat.writing.retrySave')} · ${receipt.targetNotePath}`, attr: { type: 'button' } });
                recovery.onclick = () => {
                    if (this.closed || this.controller || this.preparing) return;
                    this.releasePrepared(); form.hidden = true; this.showReceipt(receipt, result);
                };
            }
        }).catch(() => { if (!this.closed) recoveries.setText(t('plugin.chat.writing.unavailable')); });
    }

    onClose(): void {
        this.closed = true; this.prepareController?.abort(); this.controller?.abort(); this.releasePrepared(); this.contentEl.empty();
    }

    private releasePrepared(): void {
        this.prepared?.release(); this.prepared = undefined;
    }

    private renderDestination(result: HTMLElement, path: string): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        const separator = path.lastIndexOf('/');
        const destination = result.createDiv({ cls: 'pa-writing-save__destination' });
        destination.createEl('h3', { cls: 'pa-writing-save__title', text: path.slice(separator + 1).replace(/\.md$/i, '') });
        destination.createEl('p', { text: t('plugin.chat.writing.saveLocation', {
            folder: separator < 0 ? t('plugin.chat.writing.vaultRoot') : path.slice(0, separator),
        }) });
    }

    private renderSaveDetails(result: HTMLElement, receipt: SaveReceipt, markdown?: string): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        result.createEl('p', { cls: 'pa-writing-save__image-summary', text: t('plugin.chat.writing.imageSummary', { count: receipt.attachments.length }) });
        if (receipt.attachments.length) result.createEl('p', { text: t('plugin.chat.writing.attachmentRules') });
        const details = result.createEl('details', { cls: 'pa-writing-save__details' });
        details.createEl('summary', { text: t('plugin.chat.writing.saveDetails') });
        details.createEl('p', { text: t('plugin.chat.writing.saveRules') });
        details.createEl('p', { text: receipt.targetNotePath });
        for (const attachment of receipt.attachments) details.createEl('p', {
            text: `${attachment.state === 'written' ? '✓ ' : ''}${attachment.sourceName} → ${attachment.plannedPath ?? (attachment.transfer === 'reference' ? attachment.sourcePath : attachment.filename)}${attachment.attachmentKind === 'heic_jpeg' && attachment.state === 'written' ? ` · ${t('plugin.chat.writing.heicJpeg')}` : ''}`,
        });
        if (markdown !== undefined) {
            details.createEl('h3', { text: t('plugin.chat.writing.fullNote') });
            details.createEl('pre', { cls: 'pa-writing-modal__body', text: markdown });
        }
    }

    private async run(plan: SaveReceipt, retry: boolean, result: HTMLElement): Promise<void> {
        if (this.closed || this.controller) return;
        const t = makePluginTranslator(getPluginUiLanguage());
        const controller = new AbortController(); this.controller = controller;
        result.empty(); result.createEl('p', { text: t('plugin.chat.writing.saving') });
        this.renderDestination(result, plan.targetNotePath);
        const cancel = result.createEl('button', { text: t('plugin.chat.action.cancel'), attr: { type: 'button' } });
        cancel.onclick = () => controller.abort();
        try {
            const receipt = retry ? await this.save.retry(plan.operationId, { signal: controller.signal }) : await this.save.execute(plan.operationId, { signal: controller.signal });
            this.releasePrepared();
            if (!this.closed) this.showReceipt(receipt, result);
        } catch (error) {
            if (!this.closed) {
                this.showReceipt({ ...plan, state: 'failed' }, result, retry);
                if (/heic[-_]unsupported/.test(String(error))) result.createEl('p', { text: t('plugin.chat.writing.heicUnsupported') });
            }
        }
        finally { this.controller = undefined; }
    }

    private showReceipt(receipt: SaveReceipt, result: HTMLElement, retryExisting = true): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        result.empty();
        result.createEl('p', { text: t(receipt.state === 'completed' ? 'plugin.chat.writing.saved'
            : receipt.state === 'failed' ? 'plugin.chat.writing.saveFailed' : 'plugin.chat.writing.partial') });
        if (receipt.failureReason === 'heic_unsupported') result.createEl('p', { text: t('plugin.chat.writing.heicUnsupported') });
        this.renderDestination(result, receipt.targetNotePath);
        if (receipt.state !== 'completed') {
            const body = result.createEl('pre', { cls: 'pa-writing-modal__body', text: this.version.text });
            body.setAttribute('aria-label', t('plugin.chat.writing.body'));
        }
        this.renderSaveDetails(result, receipt);
        if (this.app.vault.getAbstractFileByPath(receipt.targetNotePath) instanceof TFile) {
            const open = result.createEl('button', { text: t('plugin.chat.writing.openNote'), attr: { type: 'button' } });
            open.onclick = async () => {
                if (this.closed || open.disabled) return;
                open.disabled = true;
                try { await this.app.workspace.openLinkText(receipt.targetNotePath, '', true); }
                catch {
                    if (!this.closed) {
                        new Notice(t('plugin.chat.notice.openNoteFailed', { note: receipt.targetNotePath }));
                        open.disabled = false;
                    }
                    return;
                }
                if (this.closed) return;
                this.close(); this.onNoteOpened?.();
            };
        }
        if (receipt.state !== 'completed') {
            const retry = result.createEl('button', { text: t('plugin.chat.writing.retrySave'), attr: { type: 'button' } });
            retry.onclick = () => { retry.disabled = true; void this.run(receipt, retryExisting, result); };
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
                        if (!this.closed) new WritingSaveModal(this.app, this.save, version, () => this.close()).open();
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
