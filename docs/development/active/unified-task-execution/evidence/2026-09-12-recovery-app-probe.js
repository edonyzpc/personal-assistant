if (window.__b135RecoveryProbe?.state === 'running') throw new Error('Recovery probe already running');
window.__b135RecoveryProbe = { state: 'running', startedAt: Date.now() };
(async () => {
    const plugin = app.plugins.plugins['personal-assistant'];
    if (!plugin || typeof plugin.prepareWritingRecoverySources !== 'function') throw new Error('Current recovery build not loaded');
    if (document.querySelector('.pa-writing-modal')) throw new Error('Close existing writing modal before isolated probe');
    const factory = plugin.createChatHost;
    const originalActive = app.workspace.activeLeaf;
    const dbName = `pa-b135-recovery-probe-${crypto.randomUUID()}`;
    const store = new plugin.chatHistoryManager.store.constructor(dbName, indexedDB);
    const manager = new plugin.chatHistoryManager.constructor({ store });
    const versions = new plugin.writingVersions.constructor(store);
    const owner = Object.create(plugin);
    owner.chatHistoryManager = manager;
    owner.writingVersions = versions;
    let leaf;
    let providerCalls = 0;
    let learningCalls = 0;
    const results = [];
    const waitFor = async (condition) => {
        const end = Date.now() + 8000;
        while (!await condition()) {
            if (Date.now() > end) throw new Error('Probe condition did not settle');
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const closeProbeModals = () => {
        // This Obsidian build has no close icon in these modals. Use its
        // existing Escape handler; the baseline above requires no prior modal.
        for (let i = 0; i < 4 && document.querySelector('.pa-writing-modal'); i++) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }
    };
    const closeProbeLeaf = async () => {
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
    try {
        await manager.initialize();
        if (!(store.db instanceof IDBDatabase)) throw new Error('Expected real IndexedDB');
        for (const outcome of ['valid', 'missing_source']) {
            const id = `b135-recovery-${outcome}`;
            const now = new Date().toISOString();
            const body = '  原样 “正文”\r\n第二行 🌊  ';
            const recovery = { requestId: `request-${outcome}`, messageId: `answer-${outcome}`,
                rawText: `prefix${body}suffix`, reason: 'incomplete',
                ...(outcome === 'missing_source' ? { backgroundSourceRefs: [{ path: `missing-${dbName}.md` }] } : {}) };
            await store.upsertConversation({ id, title: 'B135 isolated recovery', createdAt: now, updatedAt: now, turnCount: 1, preview: 'Synthetic recovery' });
            await store.appendTurn({ conversationId: id, turnIndex: 0,
                user: { role: 'user', content: 'Synthetic recovery fixture' },
                assistant: { role: 'assistant', content: 'Incomplete synthetic draft', writingRecovery: recovery,
                    hostProvenance: { version: 1, messageId: `answer-${outcome}`, kind: 'ai_draft' } } });
            await manager.setActiveConversationId(id);
            plugin.createChatHost = () => ({ ...factory.call(plugin), chatHistoryManager: manager,
                writingVersions: versions, writingSave: undefined,
                prepareWritingRecoverySources: (value, images, conversationId, metadata) =>
                    plugin.prepareWritingRecoverySources.call(owner, value, images, conversationId, metadata),
                createChatService: () => ({ streamLLM: async () => { providerCalls++; throw new Error('Provider forbidden in probe'); },
                    dispose() {}, resetContext() {}, cancelPendingOperations() {} }),
                scheduleMemoryExtractionAfterChatTurn: () => { learningCalls++; },
            });
            leaf = app.workspace.getLeaf('tab');
            try { await leaf.setViewState({ type: 'sidellm-view', active: true }); }
            finally { plugin.createChatHost = factory; }
            await waitFor(() => leaf.view.containerEl.querySelector('.pa-chat-writing-action'));
            leaf.view.containerEl.querySelector('.pa-chat-writing-action').click();
            await waitFor(() => document.querySelector('.pa-writing-modal'));
            const modal = document.querySelector('.pa-writing-modal');
            const explanation = /旧来源记录不完整|The old source record is incomplete/.test(modal.textContent);
            const areas = modal.querySelectorAll('textarea');
            const buttons = modal.querySelectorAll('button');
            if (!explanation || areas.length !== 2 || buttons.length !== 2) throw new Error('Recovery confirmation UI missing');
            if (!/确认并恢复为 AI 草稿|Confirm and recover as an AI draft/.test(buttons[1].textContent)) throw new Error('Confirmation label missing');
            if ((await versions.list(id)).length) throw new Error('Opening modal created a version');
            areas[0].setSelectionRange(6, areas[0].value.length - 6);
            buttons[0].click();
            // HTML textarea normalizes CRLF to LF. Select the exact intended
            // editable value; recovery must preserve that submitted text.
            const submitted = areas[1].value;
            if (submitted !== body.replace(/\r\n/g, '\n')) throw new Error('Probe body selection differs');
            buttons[1].click();
            await waitFor(async () => (await versions.list(id)).length > 0 || !buttons[1].disabled);
            const saved = await versions.list(id);
            if (outcome === 'valid') {
                if (saved.length !== 1 || saved[0].text !== submitted || saved[0].origin !== 'ai_generated'
                    || saved[0].referenceScope !== undefined) throw new Error('Recovered text or provenance differs');
                const turn = (await store.getTurns(id))[0];
                await waitFor(async () => (await store.getTurns(id))[0].assistant.writingVersionId === saved[0].id);
                if (turn.assistant.writingRecovery.rawText !== recovery.rawText) throw new Error('Recovery original changed');
            } else if (saved.length !== 0) throw new Error('Missing source was recovered');
            results.push({ outcome, explanation, versions: saved.length, submittedTextPreserved: outcome === 'valid',
                uncertainReferenceScopePreserved: outcome === 'valid', providerCalls, learningCalls });
            window.__b135RecoveryProbe.results = [...results];
            closeProbeModals();
            await closeProbeLeaf();
        }
        if (providerCalls || learningCalls) throw new Error('Unexpected provider or learning work');
        return { tier: 'app-runtime DOM interaction; not full-ui or iOS', realIndexedDB: true, results, providerCalls, learningCalls };
    } finally {
        plugin.createChatHost = factory;
        closeProbeModals();
        await closeProbeLeaf();
        await versions.dispose();
        await store.dispose();
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => { window.__b135RecoveryProbe.cleanup = 'waiting_for_connections'; };
        });
        window.__b135RecoveryProbe.cleanup = 'deleted';
        if (originalActive) app.workspace.setActiveLeaf(originalActive, { focus: true });
    }
})().then(result => { window.__b135RecoveryProbe = { state: 'done', cleanup: 'deleted', result }; },
    error => { window.__b135RecoveryProbe = { ...window.__b135RecoveryProbe, state: 'failed', error: String(error), stack: error?.stack }; });
'Recovery probe started; poll window.__b135RecoveryProbe';
