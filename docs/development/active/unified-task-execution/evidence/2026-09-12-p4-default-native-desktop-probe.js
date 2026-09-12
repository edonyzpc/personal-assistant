if (window.__b135P4DefaultNative?.state === 'running') throw new Error('B-135 P4 probe already running');
window.__b135P4DefaultNative = { state: 'running', startedAt: new Date().toISOString(), continue: null };

(async () => {
    const report = window.__b135P4DefaultNative;
    const plugin = app.plugins.plugins['personal-assistant'];
    if (!plugin) throw new Error('Personal Assistant is not loaded');
    if (document.querySelector('.pa-writing-modal')) throw new Error('Close the existing writing modal first');
    const targetPath = 'B135-P4-Default-Native.md';
    if (app.vault.getAbstractFileByPath(targetPath)) throw new Error('Synthetic save target already exists');

    const originalFactory = plugin.createChatHost;
    const originalActive = app.workspace.activeLeaf;
    const dbName = `pa-b135-p4-default-native-${crypto.randomUUID()}`;
    const store = new plugin.chatHistoryManager.store.constructor(dbName, indexedDB);
    const manager = new plugin.chatHistoryManager.constructor({ store });
    const versions = new plugin.writingVersions.constructor(store);
    const save = new plugin.writingSave.constructor(app, store, plugin.imageAssetService, {
        isPathAllowed: path => path === targetPath,
    });
    const template = plugin.createChatService();
    const Service = template.constructor;
    template.dispose();
    let leaf;
    let learningCalls = 0;
    const providerTurns = [];
    const previewLengths = [];
    const artifacts = [];
    const recoveries = [];
    const ordinaryCallbacks = [];
    const intents = [];
    const toolEvents = [];
    let physicalRequests = 0;

    const waitFor = async (condition, timeoutMs = 120000) => {
        const end = Date.now() + timeoutMs;
        while (!await condition()) {
            if (Date.now() > end) throw new Error('B-135 P4 condition did not settle');
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const clickByText = (root, pattern) => {
        const button = Array.from(root.querySelectorAll('button')).find(candidate => pattern.test(candidate.textContent.trim()));
        if (!button || button.disabled) throw new Error(`Enabled button unavailable: ${pattern}`);
        button.click();
        return button;
    };
    const closeModals = () => {
        for (let i = 0; i < 6 && document.querySelector('.pa-writing-modal'); i++) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }
    };
    const closeLeaf = async () => {
        if (!leaf) return;
        const current = leaf;
        const view = current.view;
        const close = view.onClose.bind(view);
        let closing;
        view.onClose = () => closing ??= close();
        current.detach();
        await view.onClose();
        leaf = undefined;
    };

    const owner = Object.create(plugin);
    Object.defineProperties(owner, {
        settings: { value: { ...plugin.settings, memoryEnabled: false, webSearchEnabled: false,
            operationsAgentEnabled: false, debug: false, shareAnonymousCapabilityUsage: false } },
        isOperationsAgentEnabled: { value: false },
        agentRunCoordinator: { value: undefined },
        memorySearch: { value: {
            ensureReadyForChat: async () => { throw new Error('Probe forbids Memory preparation'); },
            searchHybrid: async () => { throw new Error('Probe forbids Memory search'); },
            getChunksByPath: async () => { throw new Error('Probe forbids Memory chunks'); },
        } },
        getAPIToken: { value: plugin.getAPIToken.bind(plugin) },
        getMemoryExtractionPromptContext: { value: () => undefined },
        readLatestMemorySource: { value: async () => null },
        log: { value: () => undefined },
    });

    const makeService = () => {
        const service = new Service(owner);
        const factory = service.aiUtils.createChatModel.bind(service.aiUtils);
        service.aiUtils.createChatModel = async (temperature, options = {}) => {
            const model = await factory(temperature, { ...options, onProviderRequestStart: () => {
                if (physicalRequests >= 4) throw new Error('Probe physical request bound reached');
                options.onProviderRequestStart?.();
                physicalRequests += 1;
            } });
            const instrument = (runnable, schemas) => {
                const original = runnable._streamResponseChunks.bind(runnable);
                runnable._streamResponseChunks = async function* (messages, callOptions, managerPort) {
                    const turn = { schemas: schemas.map(schema => schema.function?.name ?? schema.name), chunks: [] };
                    providerTurns.push(turn);
                    for await (const chunk of original(messages, callOptions, managerPort)) {
                        turn.chunks.push({
                            textLength: chunk.text?.length ?? 0,
                            toolNames: (chunk.message?.tool_call_chunks ?? []).map(call => call.name).filter(Boolean),
                            finishReason: chunk.message?.response_metadata?.finish_reason ?? chunk.generationInfo?.finish_reason,
                        });
                        yield chunk;
                    }
                };
                return runnable;
            };
            const bindTools = model.bindTools.bind(model);
            model.bindTools = schemas => instrument(bindTools(schemas), schemas);
            return instrument(model, []);
        };
        const stream = service.streamLLM.bind(service);
        service.streamLLM = (prompt, onChunk, signal, history, options = {}) => {
            report.streamOptions = {
                writingOutputProtocol: options.writingOutputProtocol,
                hasWritingRequest: !!options.writingRequest,
                candidateCount: options.writingContextHost?.candidates.length ?? null,
            };
            return stream(prompt, text => {
                if (text) ordinaryCallbacks.push(text);
                onChunk(text);
            }, signal, history, {
                ...options,
                onOperationsIntentStaged: intent => { intents.push(intent); options.onOperationsIntentStaged?.(intent); },
                onLifecycleEvent: event => {
                    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
                        toolEvents.push({ type: event.type, name: event.toolName, outcome: event.outcome });
                    }
                    options.onLifecycleEvent?.(event);
                },
                onEvent: event => {
                    if (event.kind === 'writing-preview') previewLengths.push(event.text.length);
                    if (event.kind === 'writing-artifact') artifacts.push({
                        body: event.body,
                        preamble: event.preamble ?? '',
                        explanation: event.explanation ?? '',
                        writingContext: event.writingContext,
                        associatedImages: event.associatedImages ?? [],
                    });
                    if (event.kind === 'writing-recovery') recoveries.push({ reason: event.reason, textLength: event.text?.length ?? 0 });
                    options.onEvent?.(event);
                },
            });
        };
        return service;
    };

    try {
        await manager.initialize();
        if (!(store.db instanceof IDBDatabase)) throw new Error('Expected real IndexedDB');
        const productionHost = originalFactory.call(plugin);
        if (productionHost.writingOutputProtocol !== 'native') throw new Error('Production host did not default to native');
        plugin.createChatHost = () => ({
            ...productionHost,
            settings: owner.settings,
            isOperationsAgentEnabled: false,
            chatHistoryManager: manager,
            writingVersions: versions,
            writingSave: save,
            prepareWritingStyle: async () => ({ context: '', revisionIds: [], isCurrent: () => true, isSourceCurrent: () => true }),
            prepareWritingStyleForScene: async () => ({ context: '', revisionIds: [], isCurrent: () => true, isSourceCurrent: () => true }),
            readWritingStyleReferences: async () => [],
            createChatService: makeService,
            scheduleMemoryExtractionAfterChatTurn: () => { learningCalls += 1; },
        });
        leaf = app.workspace.getLeaf('tab');
        try { await leaf.setViewState({ type: 'sidellm-view', active: true }); }
        finally { plugin.createChatHost = originalFactory; }
        await leaf.loadIfDeferred?.();
        await app.workspace.revealLeaf(leaf);
        const root = leaf.view.containerEl;
        await waitFor(() => root.querySelector('textarea') && root.querySelector('.send-button-visible'), 10000);
        const prompt = '请起草一则不超过80字的中文会议通知，必须包含“B-135作品通道验证完成”和“明早九点开会”。不要读取笔记、Memory或网页，直接交付可保存的成品。';
        report.prompt = prompt;
        const textarea = root.querySelector('textarea');
        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        const sendButton = root.querySelector('.send-button-visible');
        await waitFor(() => !sendButton.disabled, 10000);
        sendButton.click();

        await waitFor(async () => {
            const conversationId = await manager.getActiveConversationId();
            return conversationId && (await versions.list(conversationId)).some(version => version.origin === 'ai_generated')
                && root.querySelector('.pa-chat-writing-action');
        });
        const conversationId = await manager.getActiveConversationId();
        const generated = (await versions.list(conversationId)).filter(version => version.origin === 'ai_generated');
        if (generated.length !== 1 || artifacts.length !== 1 || recoveries.length || intents.length) {
            throw new Error('Expected one completed writing artifact');
        }
        if (!generated[0].text.includes('B-135作品通道验证完成') || !generated[0].text.includes('明早九点开会')) {
            throw new Error('Generated body missed required facts');
        }
        root.querySelector('.pa-chat-writing-action').click();
        await waitFor(() => document.querySelector('.pa-writing-modal textarea.pa-writing-modal__body'), 10000);
        let modal = document.querySelector('.pa-writing-modal');
        report.versionModal = {
            title: modal.querySelector('h2')?.textContent?.trim() ?? '',
            body: modal.querySelector('textarea.pa-writing-modal__body')?.value ?? '',
            buttons: Array.from(modal.querySelectorAll('button')).map(button => button.textContent.trim()),
            versionCount: (await versions.list(conversationId)).length,
        };
        report.state = 'version-modal-ready';
        await waitFor(() => report.continue === 'save', 60000);
        clickByText(modal, /^(Save as a note|保存为笔记)$/);
        await waitFor(() => Array.from(document.querySelectorAll('.pa-writing-modal')).some(item =>
            /^(Save as a note|保存为笔记)$/.test(item.querySelector('h2')?.textContent?.trim() ?? '')), 10000);
        modal = Array.from(document.querySelectorAll('.pa-writing-modal')).find(item =>
            /^(Save as a note|保存为笔记)$/.test(item.querySelector('h2')?.textContent?.trim() ?? ''));
        const title = modal.querySelector('input[type="text"]');
        title.value = targetPath.replace(/\.md$/i, '');
        title.dispatchEvent(new Event('input', { bubbles: true }));
        clickByText(modal, /^(Preview saving|预览保存)$/);
        await waitFor(() => !modal.querySelector('.pa-writing-save__actions button.mod-cta')?.disabled
            && modal.querySelector('.pa-writing-save__result pre.pa-writing-modal__body'), 10000);
        report.savePreview = {
            targetPath,
            body: modal.querySelector('.pa-writing-save__result pre.pa-writing-modal__body')?.textContent ?? '',
            targetExists: !!app.vault.getAbstractFileByPath(targetPath),
            buttons: Array.from(modal.querySelectorAll('.pa-writing-save__actions button')).map(button => button.textContent.trim()),
        };
        report.state = 'save-preview-ready';
        await waitFor(() => report.continue === 'confirm', 60000);
        clickByText(modal, /^(Save this exact selection|保存当前选定内容)$/);
        await waitFor(async () => {
            const receipts = await save.listReceipts();
            return receipts.some(receipt => receipt.targetNotePath === targetPath && receipt.state === 'completed');
        }, 30000);
        const receipt = (await save.listReceipts()).find(item => item.targetNotePath === targetPath);
        const note = app.vault.getAbstractFileByPath(targetPath);
        const noteText = note ? await app.vault.read(note) : '';
        const allVersions = await versions.list(conversationId);
        const finalBody = allVersions.find(version => version.id === receipt.writingVersionId)?.text ?? '';
        report.completed = {
            physicalRequests,
            providerTurns: providerTurns.map(turn => ({
                schemas: turn.schemas,
                finishReasons: turn.chunks.map(chunk => chunk.finishReason).filter(Boolean),
                toolNames: [...new Set(turn.chunks.flatMap(chunk => chunk.toolNames))],
            })),
            toolEvents,
            previewEventCount: previewLengths.length,
            previewFirstLength: previewLengths[0] ?? 0,
            previewMaxLength: Math.max(0, ...previewLengths),
            artifactCount: artifacts.length,
            artifactBody: artifacts[0]?.body ?? '',
            artifactPreamble: artifacts[0]?.preamble ?? '',
            ordinaryCallbackCount: ordinaryCallbacks.length,
            recoveryCount: recoveries.length,
            intentCount: intents.length,
            generatedVersionCount: allVersions.filter(version => version.origin === 'ai_generated').length,
            editedVersionCount: allVersions.filter(version => version.origin === 'user_edited').length,
            savedVersionBody: finalBody,
            receiptState: receipt?.state,
            noteExists: !!note,
            noteIncludesExactBody: !!finalBody && noteText.includes(finalBody),
            learningCalls,
        };
        report.pass = report.streamOptions?.writingOutputProtocol === 'native'
            && report.streamOptions?.hasWritingRequest === true
            && report.completed.physicalRequests <= 4
            && report.completed.previewEventCount > 0
            && report.completed.artifactCount === 1
            && report.completed.generatedVersionCount === 1
            && report.completed.recoveryCount === 0
            && report.completed.intentCount === 0
            && report.completed.receiptState === 'completed'
            && report.completed.noteIncludesExactBody;
        report.state = report.pass ? 'completed-ready' : 'failed';
        await waitFor(() => report.continue === 'cleanup', 60000);
    } finally {
        plugin.createChatHost = originalFactory;
        closeModals();
        await closeLeaf();
        const target = app.vault.getAbstractFileByPath(targetPath);
        if (target) await app.vault.delete(target, true);
        await save.dispose();
        await versions.dispose();
        await store.dispose();
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => { report.cleanup = 'waiting_for_connections'; };
        });
        report.cleanup = {
            database: 'deleted',
            targetRemoved: !app.vault.getAbstractFileByPath(targetPath),
        };
        if (originalActive) app.workspace.setActiveLeaf(originalActive, { focus: true });
    }
    report.state = report.pass ? 'done' : 'failed';
    report.finishedAt = new Date().toISOString();
})().catch(error => {
    window.__b135P4DefaultNative.state = 'failed';
    window.__b135P4DefaultNative.error = String(error?.stack ?? error);
});

'B-135 P4 default-native probe started; poll window.__b135P4DefaultNative';
