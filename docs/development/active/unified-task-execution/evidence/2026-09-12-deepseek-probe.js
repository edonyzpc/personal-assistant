if (window.__b135Deepseek?.state === 'running') throw new Error('Probe already running');
window.__b135Deepseek = { state: 'running', startedAt: new Date().toISOString(), results: [] };
(async () => {
    const result = window.__b135Deepseek;
    const plugin = app.plugins.plugins['personal-assistant'];
    const template = plugin.createChatService();
    const Service = template.constructor;
    template.dispose();
    const expected = '第一行：“安静且可信。”\n第二行：保留  两个空格。🙂';
    const original = '请为测试卡片写一段作品。只使用这条消息，不读取笔记或网页。正文请逐字写成下面两行，保留第二行中间的两个空格：\n' + expected;
    const delimited = '请为测试卡片写一段作品。只使用这条消息，不读取笔记或网页。正文是下方 <作品正文> 与 </作品正文> 之间的全部两行文字（不包含分隔标记）。请逐字复制，包含“第一行：”“第二行：”、中文引号、双空格及 Emoji，不要改写。\n<作品正文>\n' + expected + '\n</作品正文>';
    result.config = { provider: plugin.settings.aiProvider, model: 'deepseek-v4-pro',
        thinking: plugin.settings.qwenThinkingEnabled };
    const forbidden = (record, kind) => () => { record.forbiddenCalls.push(kind); throw new Error('Probe forbids ' + kind); };
    for (const entry of [{ name: 'deepseek-native-post-fix', prompt: delimited, native: true }, { name: 'deepseek-legacy-post-fix', prompt: delimited, native: false }]) {
        const record = { name: entry.name, prompt: entry.prompt, expected, state: 'running',
            startedAt: Date.now(), requests: 0, preparations: 0, forbiddenCalls: [], models: [], streams: [], events: [], text: '' };
        result.results.push(record);
        const vault = { getMarkdownFiles: () => [], getFiles: () => [], getAbstractFileByPath: () => null,
            getName: () => 'B135 synthetic probe', configDir: '.obsidian',
            read: forbidden(record, 'read'), cachedRead: forbidden(record, 'cachedRead'), readBinary: forbidden(record, 'readBinary'),
            create: forbidden(record, 'create'), modify: forbidden(record, 'modify'), delete: forbidden(record, 'delete'),
            adapter: { exists: async () => false, read: forbidden(record, 'adapter.read'), write: forbidden(record, 'adapter.write') } };
        const host = { app: { vault, workspace: { getActiveFile: () => null },
                metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null, resolvedLinks: {} },
                fileManager: { trashFile: forbidden(record, 'trashFile') } },
            settings: { ...plugin.settings, chatModelName: 'deepseek-v4-pro', debug: false, memoryEnabled: false, webSearchEnabled: false,
                operationsAgentEnabled: false, shareAnonymousCapabilityUsage: false },
            log() {}, getAPIToken: () => plugin.getAPIToken(), isOperationsAgentEnabled: false,
            getMemoryExtractionPromptContext: () => undefined,
            memorySearch: { ensureReadyForChat: forbidden(record, 'prepareMemory'), searchHybrid: forbidden(record, 'searchMemory'),
                getChunksByPath: forbidden(record, 'chunks') },
            isDataBoundaryAllowedPath: () => false, readLatestMemorySource: async () => null };
        const service = new Service(host);
        const factory = service.aiUtils.createChatModel.bind(service.aiUtils);
        service.aiUtils.createChatModel = async (temperature, options = {}) => {
            record.models.push({ temperature, transport: options.transport, qwenRequestOptions: options.qwenRequestOptions });
            const model = await factory(temperature, { ...options, onProviderRequestStart: () => {
                if (record.requests >= 3) throw new Error('Probe physical request bound reached');
                options.onProviderRequestStart?.(); record.requests++;
            } });
            const instrument = (runnable, schemas) => {
                // bindTools calls withConfig, which creates a new model. Instrument
                // that model's generator; prompt.pipe uses transform, not stream.
                const stream = runnable._streamResponseChunks.bind(runnable);
                runnable._streamResponseChunks = async function* (messages, callOptions, manager) {
                    const capture = { schemas, chunks: [] };
                    record.streams.push(capture);
                    for await (const chunk of stream(messages, callOptions, manager)) {
                        capture.chunks.push({ text: chunk.text, tool_call_chunks: chunk.message?.tool_call_chunks,
                            response_metadata: chunk.message?.response_metadata, generationInfo: chunk.generationInfo });
                        yield chunk;
                    }
                };
                return runnable;
            };
            const bind = model.bindTools.bind(model);
            model.bindTools = schemas => instrument(bind(schemas), schemas);
            instrument(model, []);
            return model;
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 150000);
        try {
            await service.streamLLM(entry.prompt, text => { record.text += text; }, controller.signal, [], {
                writingRequest: { requestId: 'b135-verbatim-' + entry.name },
                ...(entry.native ? { writingOutputProtocol: 'native' } : {}),
                writingContextHost: { conversationId: 'b135-isolated-verbatim', candidates: [], versions: { get: async () => null },
                    styles: { prepare: async () => { record.preparations++; return { context: '', revisionIds: [], isCurrent: () => true, isSourceCurrent: () => true }; } },
                    isCurrent: () => true, isParentCurrent: () => false },
                onLifecycleEvent: event => { if (event.type === 'message_end') { const copy = JSON.parse(JSON.stringify(event)); if (Array.isArray(copy.message?.content)) copy.message.content = copy.message.content.filter(part => part.type !== 'thinking'); (record.lifecycle ??= []).push(copy); } },
                onEvent: event => { if (['writing-artifact', 'writing-recovery', 'error', 'done'].includes(event.kind)) record.events.push(event); },
            });
            record.state = 'done';
        } catch (error) { record.state = 'failed'; record.error = String(error); }
        finally { clearTimeout(timeout); service.dispose(); record.elapsedMs = Date.now() - record.startedAt; }
        const artifacts = record.events.filter(event => event.kind === 'writing-artifact');
        record.artifactCount = artifacts.length;
        record.exact = artifacts.length === 1 && artifacts[0].body === expected;
        if (record.forbiddenCalls.length || record.state === 'failed') break;
    }
    result.state = 'done';
})().catch(error => { window.__b135Deepseek.state = 'failed'; window.__b135Deepseek.error = String(error); });
'started; poll window.__b135Deepseek';
