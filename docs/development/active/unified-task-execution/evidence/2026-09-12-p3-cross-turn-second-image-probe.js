if (window.__b135P3SecondImage?.state === 'running') throw new Error('B-135 second-image probe already running');
window.__b135P3SecondImage = { state: 'running', startedAt: new Date().toISOString() };

(async () => {
    const report = window.__b135P3SecondImage;
    const plugin = app.plugins.plugins['personal-assistant'];
    if (!plugin) throw new Error('Personal Assistant is not loaded');
    const template = plugin.createChatService();
    const Service = template.constructor;
    template.dispose();

    const sources = [
        {
            path: 'pa-8eb638874373ff8e-1.jpg',
            ref: { assetId: 'b135-p3-first-image', contentHash: 'f79fa62ac0f90982ed5cefd36fc53bc3a6434840540659c8a076747e34f31b6f' },
            ordinal: 1,
            label: 'first-blue-card.jpg',
        },
        {
            path: 'pa-images/img_b3358334275245d98f33bde27b3a9706.png',
            ref: { assetId: 'b135-p3-second-image', contentHash: 'f6a752a2e705f7b69140014cd6af43c54f27b1d189b5400299f014f715d26020' },
            ordinal: 2,
            label: 'second-text-card.png',
        },
    ];
    const sourceById = new Map(sources.map(source => [source.ref.assetId, source]));
    for (const source of sources) {
        if (!plugin.app.vault.getAbstractFileByPath(source.path)) throw new Error(`Missing fixture image: ${source.path}`);
    }

    const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
    const convertToJpeg = async (bytes, mime) => {
        const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
        try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas unavailable');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0);
            const blob = await new Promise((resolve, reject) => canvas.toBlob(
                value => value ? resolve(value) : reject(new Error('JPEG conversion failed')),
                'image/jpeg',
                0.92,
            ));
            return blob;
        } finally {
            bitmap.close();
        }
    };
    const variantCalls = [];
    const verifyCalls = [];
    const imageService = {
        resolveVariant: async (ref, purpose) => {
            const source = sourceById.get(ref.assetId);
            if (!source || source.ref.contentHash !== ref.contentHash || purpose !== 'provider') {
                throw new Error('Unexpected image reference');
            }
            variantCalls.push({ ...ref });
            const bytes = await plugin.app.vault.adapter.readBinary(source.path);
            if (await sha256(bytes) !== ref.contentHash) throw new Error('Fixture image changed');
            const mime = source.path.endsWith('.png') ? 'image/png' : 'image/jpeg';
            const blob = await convertToJpeg(bytes, mime);
            return { blob, mime: 'image/jpeg', width: 1, height: 1, persistent: false, release: () => undefined };
        },
        verify: async (ref, purpose) => {
            const source = sourceById.get(ref.assetId);
            const file = source ? plugin.app.vault.getAbstractFileByPath(source.path) : null;
            if (!source || source.ref.contentHash !== ref.contentHash || purpose !== 'provider' || !file) {
                throw new Error('Unexpected image verification');
            }
            verifyCalls.push({ ...ref });
            const mtime = file.stat.mtime;
            const size = file.stat.size;
            return {
                asset: {
                    id: ref.assetId,
                    originalHash: ref.contentHash,
                    source: 'vault_reference',
                    originalPath: source.path,
                    byteLength: size,
                    detectedMime: source.path.endsWith('.png') ? 'image/png' : 'image/jpeg',
                    acquisition: 'original_file',
                    state: 'available',
                    anchorPath: 'PA Chat.md',
                    anchorKind: 'logical_root',
                    createdAt: 0,
                    owners: [],
                },
                isCurrent: () => {
                    const current = plugin.app.vault.getAbstractFileByPath(source.path);
                    return current === file && current.stat.mtime === mtime && current.stat.size === size;
                },
            };
        },
    };

    const host = Object.create(plugin);
    Object.defineProperties(host, {
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

    const images = sources.map(source => ({ ref: { ...source.ref }, ordinal: source.ordinal, label: source.label }));
    const history = [
        {
            role: 'user',
            content: '这里有两张图。我先想使用第一张；请先不要分析，等我下一条消息确认或更正。',
            images,
        },
        { role: 'assistant', content: '好的，我会等待你的确认或更正。' },
    ];
    const prompt = '更正上一轮：只看第二张，不使用第一张。请只告诉我第二张顶部的 ASCII 标题；不要读取笔记、Memory 或网页。';
    const record = {
        prompt,
        history,
        physicalRequests: 0,
        providerTurns: [],
        tools: [],
        artifacts: [],
        recoveries: [],
        intents: [],
        ordinaryText: '',
    };
    report.environment = {
        provider: host.settings.aiProvider,
        model: host.settings.chatModelName,
        memoryMode: 'skip-memory',
    };
    report.case = record;

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
                const imageBlocks = messages.reduce((count, message) => count + (Array.isArray(message.content)
                    ? message.content.filter(part => part?.type === 'image_url').length : 0), 0);
                const turn = { schemas: schemas.map(schema => schema.function?.name ?? schema.name), imageBlocks, chunks: [] };
                record.providerTurns.push(turn);
                for await (const chunk of original(messages, callOptions, manager)) {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
        await service.streamLLM(prompt, text => { record.ordinaryText = text; }, controller.signal, history, {
            memoryMode: 'skip-memory',
            images: [],
            imageAssetService: imageService,
            writingOutputProtocol: 'native',
            onOperationsIntentStaged: intent => record.intents.push(intent),
            onLifecycleEvent: event => {
                if (event.type === 'tool_execution_start') record.tools.push({ phase: 'start', name: event.toolName });
                if (event.type === 'tool_execution_end') record.tools.push({ phase: 'end', name: event.toolName, outcome: event.outcome });
                if (event.type === 'agent_end') record.agentStatus = event.status;
            },
            onEvent: event => {
                if (event.kind === 'writing-artifact') record.artifacts.push(event);
                if (event.kind === 'writing-recovery') record.recoveries.push(event);
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
    }

    record.toolNames = [...new Set(record.tools.map(item => item.name))];
    record.variantRefs = variantCalls;
    record.verifyRefs = verifyCalls;
    record.secondOnly = variantCalls.length > 0
        && variantCalls.every(ref => ref.assetId === sources[1].ref.assetId)
        && verifyCalls.length > 0
        && verifyCalls.every(ref => ref.assetId === sources[1].ref.assetId);
    record.pass = record.state === 'done'
        && record.toolNames.includes('resolve_chat_images')
        && record.secondOnly
        && record.providerTurns.some(turn => turn.imageBlocks === 1)
        && record.providerTurns.every(turn => turn.imageBlocks <= 1)
        && /30[\s-]*deep[\s-]*target/i.test(record.ordinaryText)
        && record.artifacts.length === 0
        && record.recoveries.length === 0
        && record.intents.length === 0;
    report.result = record.pass ? 'PASS' : 'FAIL';
    report.state = 'done';
    report.finishedAt = new Date().toISOString();
})().catch(error => {
    window.__b135P3SecondImage.state = 'failed';
    window.__b135P3SecondImage.error = String(error?.stack ?? error);
});

'B-135 second-image probe started; poll window.__b135P3SecondImage';
