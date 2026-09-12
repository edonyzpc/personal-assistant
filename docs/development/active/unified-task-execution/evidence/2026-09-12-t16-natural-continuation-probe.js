if (window.__b135T16Continuation?.state === 'running') throw new Error('B-135 T16 continuation probe already running');
window.__b135T16Continuation = { state: 'running', startedAt: new Date().toISOString(), continue: null };

(async () => {
    const report = window.__b135T16Continuation;
    const plugin = app.plugins.plugins['personal-assistant'];
    if (!plugin) throw new Error('Personal Assistant is not loaded');
    if (document.querySelector('.pa-writing-modal')) throw new Error('Close the existing writing modal first');

    const originalFactory = plugin.createChatHost;
    const originalActive = app.workspace.activeLeaf;
    const dbName = `pa-b135-t16-continuation-${crypto.randomUUID()}`;
    const store = new plugin.chatHistoryManager.store.constructor(dbName, indexedDB);
    const manager = new plugin.chatHistoryManager.constructor({ store });
    const versions = new plugin.writingVersions.constructor(store);
    const template = plugin.createChatService();
    const Service = template.constructor;
    template.dispose();
    const conversationId = 'b135-t16-continuation';
    const providerTurns = [];
    const artifacts = [];
    const recoveries = [];
    const intents = [];
    let physicalRequests = 0;
    let learningCalls = 0;
    let leaf;

    const waitFor = async (condition, timeoutMs = 120000) => {
        const end = Date.now() + timeoutMs;
        while (!await condition()) {
            if (Date.now() > end) throw new Error('B-135 T16 condition did not settle');
            await new Promise(resolve => setTimeout(resolve, 25));
        }
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
                selectedParentVersionId: options.writingContextHost?.selectedParentVersionId ?? null,
            };
            return stream(prompt, onChunk, signal, history, {
                ...options,
                onOperationsIntentStaged: intent => { intents.push(intent); options.onOperationsIntentStaged?.(intent); },
                onEvent: event => {
                    if (event.kind === 'writing-artifact') artifacts.push({
                        body: event.body,
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
        const now = new Date().toISOString();
        await store.upsertConversation({ id: conversationId, title: 'B-135 T16 continuation', createdAt: now,
            updatedAt: now, turnCount: 1, preview: '上一版会议通知' });
        const parentScene = { writingTask: '撰写会议通知', purpose: '通知会议安排', audience: '项目成员', domain: '工作' };
        const parent = await versions.create({
            requestId: 'b135-t16-parent-request', messageId: 'b135-t16-parent-message', conversationId, turnIndex: 0,
            text: '会议通知：明早九点开会，请项目成员携带材料并提前十分钟到场。', explanation: '', images: [], scene: parentScene,
        });
        await store.appendTurn({ conversationId, turnIndex: 0,
            user: { role: 'user', content: '请起草一则会议通知。' },
            assistant: { role: 'assistant', content: parent.text, writingVersionId: parent.id,
                hostProvenance: { version: 1, messageId: parent.messageId, kind: 'ai_draft' } } });
        await manager.setActiveConversationId(conversationId);

        const productionHost = originalFactory.call(plugin);
        if (productionHost.writingOutputProtocol !== 'native') throw new Error('Production host did not default to native');
        plugin.createChatHost = () => ({
            ...productionHost,
            settings: owner.settings,
            isOperationsAgentEnabled: false,
            chatHistoryManager: manager,
            writingVersions: versions,
            writingSave: undefined,
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
        await waitFor(() => root.querySelector('textarea') && root.querySelector('.send-button-visible')
            && root.querySelector('.pa-chat-writing-action'), 10000);

        const prompt = '请继续修改上一版会议通知：保留“明早九点开会”，删掉携带材料和提前到场的要求，并在结尾添加“请准时参加”。不要读取笔记、Memory或网页，直接交付修改后的完整成品。';
        report.prompt = prompt;
        report.parent = { id: parent.id, body: parent.text, scene: parent.scene };
        const textarea = root.querySelector('textarea');
        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        const sendButton = root.querySelector('.send-button-visible');
        await waitFor(() => !sendButton.disabled, 10000);
        sendButton.click();

        await waitFor(async () => (await versions.list(conversationId)).length === 2 && artifacts.length === 1
            && root.querySelector('.pa-chat-writing-action'));
        const allVersions = await versions.list(conversationId);
        const child = allVersions.find(version => version.id !== parent.id);
        if (!child) throw new Error('Continuation did not create a child version');
        if (child.parentVersionId !== parent.id || artifacts[0]?.writingContext?.parentVersionId !== parent.id) {
            throw new Error('Continuation did not bind the offered parent');
        }
        if (!child.text.includes('明早九点开会') || !child.text.includes('请准时参加')
            || child.text.includes('携带材料') || child.text.includes('提前十分钟')) {
            throw new Error('Continuation body did not apply the requested changes');
        }
        const writingActions = Array.from(root.querySelectorAll('.pa-chat-writing-action'));
        writingActions.at(-1).click();
        await waitFor(() => document.querySelector('.pa-writing-modal textarea.pa-writing-modal__body'), 10000);
        const modal = document.querySelector('.pa-writing-modal');
        report.completed = {
            physicalRequests,
            providerTurns: providerTurns.map(turn => ({
                schemas: turn.schemas,
                finishReasons: turn.chunks.map(chunk => chunk.finishReason).filter(Boolean),
                toolNames: [...new Set(turn.chunks.flatMap(chunk => chunk.toolNames))],
            })),
            artifactCount: artifacts.length,
            recoveryCount: recoveries.length,
            intentCount: intents.length,
            versionCount: allVersions.length,
            child: { id: child.id, parentVersionId: child.parentVersionId, body: child.text, scene: child.scene },
            artifactParentVersionId: artifacts[0]?.writingContext?.parentVersionId ?? null,
            associatedImageCount: child.associatedImages.length,
            learningCalls,
            modal: {
                title: modal.querySelector('h2')?.textContent?.trim() ?? '',
                body: modal.querySelector('textarea.pa-writing-modal__body')?.value ?? '',
                buttons: Array.from(modal.querySelectorAll('button')).map(button => button.textContent.trim()),
            },
        };
        report.pass = report.streamOptions?.writingOutputProtocol === 'native'
            && report.streamOptions?.candidateCount === 1
            && report.completed.physicalRequests <= 4
            && report.completed.artifactCount === 1
            && report.completed.recoveryCount === 0
            && report.completed.intentCount === 0
            && report.completed.versionCount === 2
            && report.completed.modal.body === child.text;
        report.state = report.pass ? 'version-modal-ready' : 'failed';
        await waitFor(() => report.continue === 'cleanup', 60000);
    } finally {
        plugin.createChatHost = originalFactory;
        closeModals();
        await closeLeaf();
        await versions.dispose();
        await store.dispose();
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => { report.cleanup = 'waiting_for_connections'; };
        });
        report.cleanup = { database: 'deleted' };
        if (originalActive) app.workspace.setActiveLeaf(originalActive, { focus: true });
    }
    report.state = report.pass ? 'done' : 'failed';
    report.finishedAt = new Date().toISOString();
})().catch(error => {
    window.__b135T16Continuation.state = 'failed';
    window.__b135T16Continuation.error = String(error?.stack ?? error);
});

'B-135 T16 continuation probe started; poll window.__b135T16Continuation';
