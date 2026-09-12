if (window.__b135P3Semantic?.state === 'running') throw new Error('P3 semantic probe already running');
window.__b135P3Semantic = { state: 'running', startedAt: new Date().toISOString(), results: [] };

(async () => {
    const report = window.__b135P3Semantic;
    const plugin = app.plugins.plugins['personal-assistant'];
    if (!plugin) throw new Error('Personal Assistant is not loaded');
    const template = plugin.createChatService();
    const Service = template.constructor;
    template.dispose();

    const currentPath = 'B135-P3-Current.md';
    const targetPath = 'B135-P3-Probe.md';
    const marker = 'B135-P3-CURRENT-7K2M';
    const noteText = `# B-135 P3 synthetic current note\n\n唯一测试代号：${marker}\n\n这里只包含合成验证内容。`;
    const realVault = plugin.app.vault;
    if (realVault.getAbstractFileByPath(currentPath) || realVault.getAbstractFileByPath(targetPath)) {
        throw new Error('Synthetic probe path already exists');
    }
    const beforeMarkdownPaths = realVault.getMarkdownFiles().map(file => file.path).sort();
    const currentFile = await realVault.create(currentPath, noteText);
    const realWorkspace = plugin.app.workspace;
    const originalActiveLeaf = realWorkspace.activeLeaf;
    const probeLeaf = realWorkspace.getLeaf('tab');
    await probeLeaf.openFile(currentFile, { active: true });
    await probeLeaf.loadIfDeferred?.();
    await realWorkspace.revealLeaf(probeLeaf);
    const reads = [];
    const writes = [];
    const metadataReads = [];
    const abstractLookups = [];
    const bind = (target, key) => {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
    };
    const adapter = new Proxy(realVault.adapter, {
        get(target, key) {
            if (key === 'exists') return async path => {
                abstractLookups.push({ kind: 'adapter.exists', path });
                return target.exists(path);
            };
            if (key === 'read' || key === 'readBinary') return async path => {
                reads.push({ kind: `adapter.${String(key)}`, path });
                if (path !== currentPath) throw new Error(`Probe blocked adapter read: ${path}`);
                return key === 'read' ? noteText : new TextEncoder().encode(noteText).buffer;
            };
            if (['write', 'writeBinary', 'append', 'remove', 'rename', 'mkdir', 'rmdir'].includes(String(key))) {
                return async (...args) => {
                    writes.push({ kind: `adapter.${String(key)}`, path: String(args[0] ?? '') });
                    throw new Error(`Probe blocked adapter write: ${String(key)}`);
                };
            }
            return bind(target, key);
        },
    });
    const vault = new Proxy(realVault, {
        get(target, key) {
            if (key === 'adapter') return adapter;
            if (key === 'getMarkdownFiles' || key === 'getFiles') return () => [currentFile];
            if (key === 'getAbstractFileByPath') return path => {
                abstractLookups.push({ kind: 'vault.getAbstractFileByPath', path });
                return target.getAbstractFileByPath(path);
            };
            if (key === 'read' || key === 'cachedRead') return async file => {
                reads.push({ kind: String(key), path: file?.path });
                if (file?.path !== currentPath) throw new Error(`Probe blocked vault read: ${file?.path}`);
                return noteText;
            };
            if (key === 'readBinary') return async file => {
                reads.push({ kind: 'readBinary', path: file?.path });
                if (file?.path !== currentPath) throw new Error(`Probe blocked binary read: ${file?.path}`);
                return new TextEncoder().encode(noteText).buffer;
            };
            if (['create', 'modify', 'process', 'delete', 'rename', 'copy'].includes(String(key))) {
                return async (...args) => {
                    writes.push({ kind: `vault.${String(key)}`, path: String(args[0]?.path ?? args[0] ?? '') });
                    throw new Error(`Probe blocked vault write: ${String(key)}`);
                };
            }
            return bind(target, key);
        },
    });
    const realMetadata = plugin.app.metadataCache;
    const metadataCache = new Proxy(realMetadata, {
        get(target, key) {
            if (key === 'getFileCache') return file => {
                metadataReads.push(file?.path ?? '');
                return file?.path === currentPath ? target.getFileCache(file) : null;
            };
            return bind(target, key);
        },
    });
    const fileManager = new Proxy(plugin.app.fileManager, {
        get(target, key) {
            if (key === 'trashFile') return async file => {
                writes.push({ kind: 'fileManager.trashFile', path: file?.path });
                throw new Error('Probe blocked trash');
            };
            return bind(target, key);
        },
    });
    const hostApp = Object.create(plugin.app);
    Object.defineProperties(hostApp, {
        vault: { value: vault },
        workspace: { value: realWorkspace },
        metadataCache: { value: metadataCache },
        fileManager: { value: fileManager },
    });
    const host = Object.create(plugin);
    Object.defineProperties(host, {
        app: { value: hostApp },
        settings: { value: { ...plugin.settings, memoryEnabled: false, webSearchEnabled: true,
            operationsAgentEnabled: true, debug: false, shareAnonymousCapabilityUsage: false } },
        isOperationsAgentEnabled: { value: true },
        agentRunCoordinator: { value: undefined },
        memorySearch: { value: {
            ensureReadyForChat: async () => { throw new Error('Probe forbids Memory preparation'); },
            searchHybrid: async () => { throw new Error('Probe forbids Memory search'); },
            getChunksByPath: async () => { throw new Error('Probe forbids Memory chunks'); },
        } },
        getAPIToken: { value: plugin.getAPIToken.bind(plugin) },
        getMemoryExtractionPromptContext: { value: () => undefined },
        readLatestMemorySource: { value: async () => null },
        isDataBoundaryAllowedPath: { value: path => path === currentPath || path === targetPath },
        log: { value: () => undefined },
    });

    const allCases = [
        {
            name: 'quoted-negated-consultation',
            prompt: '“请帮我创建并写入一篇笔记”只是引用。请解释这句话的语气；只给建议，不要创建、修改笔记，也不要起草成品。',
            expect: 'ordinary',
        },
        {
            name: 'advice-and-draft',
            prompt: '先用一句话给我建议，再起草一条不超过40字的提醒短信，主题是明早带伞。不要读取笔记或网页。',
            expect: 'writing',
        },
        {
            name: 'current-note-only-no-web',
            prompt: '只用当前笔记，不要联网。请告诉我文中的唯一测试代号是什么，并说明它来自当前笔记。',
            expect: 'current-note',
        },
        {
            name: 'operations-proposal-only',
            prompt: `请把下面结论保存为新笔记 ${targetPath}：P3 最小语义验证通过。只提出可确认的修改方案，不要直接执行。`,
            expect: 'operations',
        },
    ];
    const selectedNames = Array.isArray(window.__b135P3SemanticCaseNames)
        ? new Set(window.__b135P3SemanticCaseNames)
        : null;
    const cases = selectedNames ? allCases.filter(item => selectedNames.has(item.name)) : allCases;

    try {
        report.config = { provider: host.settings.aiProvider, model: host.settings.chatModelName,
            writingOutputProtocol: 'native', memoryMode: 'skip-memory' };
        for (const item of cases) {
            const record = { name: item.name, expect: item.expect, prompt: item.prompt, state: 'running',
                startedAt: Date.now(), physicalRequests: 0, boundToolNames: [], providerTurns: [],
                tools: [], stagedIntents: [], artifacts: [], recoveries: [], ordinaryText: '', contextPreparations: 0 };
            report.results.push(record);
            const service = new Service(host);
            const factory = service.aiUtils.createChatModel.bind(service.aiUtils);
            service.aiUtils.createChatModel = async (temperature, options = {}) => {
                const model = await factory(temperature, { ...options, onProviderRequestStart: () => {
                    if (record.physicalRequests >= 4) throw new Error('Probe physical request bound reached');
                    options.onProviderRequestStart?.();
                    record.physicalRequests += 1;
                } });
                const instrument = (runnable, schemas) => {
                    const original = runnable._streamResponseChunks.bind(runnable);
                    runnable._streamResponseChunks = async function* (messages, callOptions, manager) {
                        const turn = { schemas: schemas.map(schema => schema.function?.name ?? schema.name), chunks: [] };
                        record.providerTurns.push(turn);
                        for await (const chunk of original(messages, callOptions, manager)) {
                            turn.chunks.push({ textLength: chunk.text?.length ?? 0,
                                toolNames: (chunk.message?.tool_call_chunks ?? []).map(call => call.name).filter(Boolean),
                                finishReason: chunk.message?.response_metadata?.finish_reason ?? chunk.generationInfo?.finish_reason });
                            yield chunk;
                        }
                    };
                    return runnable;
                };
                const bindTools = model.bindTools.bind(model);
                model.bindTools = schemas => {
                    record.boundToolNames.push(schemas.map(schema => schema.function?.name ?? schema.name));
                    return instrument(bindTools(schemas), schemas);
                };
                return instrument(model, []);
            };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 120000);
            const requestId = `b135-p3-${item.name}`;
            try {
                await service.streamLLM(item.prompt, text => { record.ordinaryText = text; }, controller.signal, [], {
                    memoryMode: 'skip-memory',
                    writingRequest: { requestId },
                    writingOutputProtocol: 'native',
                    writingContextHost: {
                        conversationId: 'b135-p3-isolated', candidates: [],
                        versions: { get: async () => null },
                        styles: { prepare: async () => { record.contextPreparations += 1;
                            return { context: '', revisionIds: [], isCurrent: () => true, isSourceCurrent: () => true }; } },
                        isCurrent: () => true,
                        isParentCurrent: () => false,
                    },
                    onOperationsIntentStaged: intent => record.stagedIntents.push({ id: intent.id, state: intent.state,
                        operations: intent.operations.map(operation => ({ name: operation.name, path: operation.path })) }),
                    onTurnMetadata: metadata => {
                        record.sourcePaths = (metadata.sourceRecords ?? []).map(source => source.path).filter(Boolean);
                    },
                    onLifecycleEvent: event => {
                        if (event.type === 'tool_execution_start') record.tools.push({ phase: 'start', name: event.toolName });
                        if (event.type === 'tool_execution_end') record.tools.push({ phase: 'end', name: event.toolName, outcome: event.outcome });
                        if (event.type === 'agent_end') record.agentStatus = event.status;
                    },
                    onEvent: event => {
                        if (event.kind === 'writing-artifact') record.artifacts.push({ body: event.body, preamble: event.preamble ?? '',
                            explanation: event.explanation ?? '' });
                        if (event.kind === 'writing-recovery') record.recoveries.push({ reason: event.reason, textLength: event.text?.length ?? 0 });
                    },
                });
                record.state = 'done';
            } catch (error) {
                record.state = controller.signal.aborted ? 'aborted' : 'failed';
                record.error = String(error?.stack ?? error);
            } finally {
                clearTimeout(timer);
                service.cancelPendingOperations();
                service.dispose();
                record.elapsedMs = Date.now() - record.startedAt;
            }
            record.artifactCount = record.artifacts.length;
            record.intentCount = record.stagedIntents.length;
            record.toolNames = [...new Set(record.tools.map(entry => entry.name))];
            record.targetExists = !!realVault.getAbstractFileByPath(targetPath);
            if (item.expect === 'ordinary') {
                record.pass = record.state === 'done' && !!record.ordinaryText.trim()
                    && record.artifactCount === 0 && record.intentCount === 0 && record.toolNames.length === 0;
            } else if (item.expect === 'writing') {
                record.pass = record.state === 'done' && record.artifactCount === 1 && record.intentCount === 0
                    && record.artifacts[0].body.length <= 40 && /伞|雨/.test(record.artifacts[0].body);
            } else if (item.expect === 'current-note') {
                record.pass = record.state === 'done' && record.ordinaryText.includes(marker)
                    && record.toolNames.includes('declare_source_scope') && record.toolNames.includes('get_current_note_context')
                    && !record.toolNames.includes('webSearch') && record.intentCount === 0 && record.artifactCount === 0;
            } else {
                record.pass = record.state === 'done' && record.intentCount === 1 && !record.targetExists
                    && record.stagedIntents[0].operations.some(operation => operation.name === 'vault_create' && operation.path === targetPath);
            }
            report.latest = { name: record.name, state: record.state, pass: record.pass,
                physicalRequests: record.physicalRequests, toolNames: record.toolNames };
        }
        report.summary = {
            passCount: report.results.filter(result => result.pass).length,
            total: report.results.length,
            allPassed: report.results.every(result => result.pass),
            proxyReads: reads,
            metadataReads,
            proxyWrites: writes,
            targetExists: !!realVault.getAbstractFileByPath(targetPath),
        };
    } finally {
        probeLeaf.detach();
        if (originalActiveLeaf) realWorkspace.setActiveLeaf(originalActiveLeaf, { focus: true });
        const target = realVault.getAbstractFileByPath(targetPath);
        if (target) await realVault.delete(target, true);
        const current = realVault.getAbstractFileByPath(currentPath);
        if (current) await realVault.delete(current, true);
        const afterMarkdownPaths = realVault.getMarkdownFiles().map(file => file.path).sort();
        report.cleanup = {
            currentRemoved: !realVault.getAbstractFileByPath(currentPath),
            targetRemoved: !realVault.getAbstractFileByPath(targetPath),
            markdownTreeRestored: JSON.stringify(afterMarkdownPaths) === JSON.stringify(beforeMarkdownPaths),
        };
    }
    report.state = 'done';
})().catch(error => {
    window.__b135P3Semantic.state = 'failed';
    window.__b135P3Semantic.error = String(error?.stack ?? error);
});

'P3 semantic probe started; poll window.__b135P3Semantic';
