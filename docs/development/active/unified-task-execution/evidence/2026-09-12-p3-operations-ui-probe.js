if (window.__b135P3OperationsUi?.state === 'running') throw new Error('P3 Operations UI probe already running');
window.__b135P3OperationsUi = { state: 'running', startedAt: Date.now(), continue: false };

(async () => {
    const report = window.__b135P3OperationsUi;
    const plugin = app.plugins.plugins['personal-assistant'];
    if (!plugin) throw new Error('Personal Assistant is not loaded');
    const originalFactory = plugin.createChatHost;
    const originalActive = app.workspace.activeLeaf;
    const dbName = `pa-b135-p3-operations-ui-${crypto.randomUUID()}`;
    const store = new plugin.chatHistoryManager.store.constructor(dbName, indexedDB);
    const manager = new plugin.chatHistoryManager.constructor({ store });
    const versions = new plugin.writingVersions.constructor(store);
    const targetPath = 'B135-P3-Probe.md';
    const body = 'P3 最小语义验证通过。';
    const intent = {
        id: 'b135-p3-ui-intent', runId: 'b135-p3-ui-run', turnId: 'b135-p3-ui-turn',
        createdAt: Date.now(), expiresAt: Date.now() + 120000, state: 'pending',
        operations: [{
            id: 'b135-p3-ui-operation', toolCallId: 'b135-p3-ui-call', name: 'vault_create',
            input: { path: targetPath, content: body }, path: targetPath,
            expectedBefore: null, expectedAfter: body,
        }],
    };
    let leaf;
    let cancelled = false;
    let providerCalls = 0;
    let writes = 0;
    const waitFor = async (condition, timeoutMs = 10000) => {
        const end = Date.now() + timeoutMs;
        while (!await condition()) {
            if (Date.now() > end) throw new Error('P3 Operations UI condition did not settle');
            await new Promise(resolve => setTimeout(resolve, 25));
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
    const service = {
        getImageCapability: () => 'unsupported',
        streamLLM: async (prompt, onChunk, _signal, _history, options) => {
            report.prompt = prompt;
            options.onOperationsIntentStaged?.(intent);
            onChunk('修改方案已准备，等待你的确认；尚未写入。');
        },
        confirmOperationsIntent: async () => { writes += 1; throw new Error('UI probe forbids confirmation'); },
        cancelOperationsIntent: id => {
            if (id !== intent.id) throw new Error('Unexpected intent id');
            cancelled = true;
            intent.state = 'cancelled';
            return intent;
        },
        cancelPendingOperations: () => { if (intent.state === 'pending') { cancelled = true; intent.state = 'cancelled'; } },
        undoOperations: async () => [],
        resetContext: () => undefined,
        dispose: () => undefined,
    };
    try {
        await manager.initialize();
        plugin.createChatHost = () => ({
            ...originalFactory.call(plugin),
            chatHistoryManager: manager,
            writingVersions: versions,
            writingSave: undefined,
            isOperationsAgentEnabled: true,
            createChatService: () => service,
            scheduleMemoryExtractionAfterChatTurn: () => undefined,
        });
        leaf = app.workspace.getLeaf('tab');
        try { await leaf.setViewState({ type: 'sidellm-view', active: true }); }
        finally { plugin.createChatHost = originalFactory; }
        await leaf.loadIfDeferred?.();
        await app.workspace.revealLeaf(leaf);
        const root = leaf.view.containerEl;
        await waitFor(() => root.querySelector('textarea') && root.querySelector('.send-button-visible'));
        const textarea = root.querySelector('textarea');
        textarea.value = `请把结论保存为新笔记 ${targetPath}：${body} 只提出可确认方案，不要直接执行。`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        const send = root.querySelector('.send-button-visible');
        await waitFor(() => !send.disabled);
        send.click();
        await waitFor(() => root.querySelector('.pa-operations-intent-card'));
        const card = root.querySelector('.pa-operations-intent-card');
        await waitFor(() => !card.querySelector('.mod-cta').disabled);
        report.state = 'card-ready';
        report.card = {
            text: card.textContent.trim(),
            buttons: Array.from(card.querySelectorAll('button')).filter(button => !button.hidden)
                .map(button => ({ text: button.textContent.trim(), disabled: button.disabled })),
            pathVisible: card.textContent.includes(targetPath),
            bodyVisible: card.textContent.includes(body),
            targetExists: !!app.vault.getAbstractFileByPath(targetPath),
            providerCalls,
            writes,
        };
        await waitFor(() => report.continue === true, 60000);
        const cancel = Array.from(card.querySelectorAll('button')).find(button => /Cancel|取消/.test(button.textContent));
        if (!cancel || cancel.disabled) throw new Error('Enabled cancel button unavailable');
        cancel.click();
        await Promise.resolve();
        const statusText = card.querySelector('.pa-operations-intent-card__status')?.textContent?.trim() ?? '';
        report.afterCancel = {
            cancelled,
            statusText,
            statusVisible: /Cancelled|已取消/.test(statusText),
            decisionButtonsHidden: Array.from(card.querySelectorAll('.pa-operations-intent-card__actions button'))
                .filter(button => !button.classList.contains('pa-operations-intent-card__undo')).every(button => button.hidden),
            targetExists: !!app.vault.getAbstractFileByPath(targetPath),
            providerCalls,
            writes,
        };
        if (!cancelled || writes !== 0 || report.afterCancel.targetExists) throw new Error('Cancel did not remain write-free');
        report.state = 'done';
    } finally {
        plugin.createChatHost = originalFactory;
        await closeLeaf();
        await versions.dispose();
        await store.dispose();
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => { report.cleanup = 'waiting_for_connections'; };
        });
        report.cleanup = 'deleted';
        if (originalActive) app.workspace.setActiveLeaf(originalActive, { focus: true });
    }
})().catch(error => {
    window.__b135P3OperationsUi.state = 'failed';
    window.__b135P3OperationsUi.error = String(error?.stack ?? error);
});

'P3 Operations UI probe started; wait for card-ready';
