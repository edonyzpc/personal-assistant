/*
 * B-149 live-model baseline for the Obsidian `test` vault. Loading makes no
 * provider request. Stage the frozen R2 cases at B149-runtime-eval/cases.json,
 * then call __b149AgentEval.start({ maxRequests, expectedBundleSha256 }).
 * Export with __b149AgentEval.export(); cleanup with __b149AgentEval.cleanup().
 * The caller owns the cross-run authorization ledger and removes staged files.
 */
/* global app, crypto, TextEncoder, AbortController */
(() => {
  const FIXTURE_PATH = 'B149-runtime-eval/cases.json';
  const BUNDLE_PATH = '.obsidian/plugins/personal-assistant/main.js';
  const FIXTURE_HASH = 'aec67d51749e2c76863d7509fb65c3a410c614b9551f615ff74403e1c3e6dea9';
  const PLUGIN_ID = 'personal-assistant';
  if (app.vault.getName() !== 'test') throw new Error('B149_TEST_VAULT_REQUIRED');
  const plugin = app.plugins.plugins[PLUGIN_ID];
  if (!plugin || typeof plugin.createChatService !== 'function') throw new Error('B149_PLUGIN_UNAVAILABLE');
  if (globalThis.__b149AgentEval?.state.status === 'running') throw new Error('B149_ALREADY_RUNNING');
  globalThis.__b149AgentEval?.cleanup();

  let controller;
  let ownedService;
  let starting = false;
  const state = { schemaVersion: 1, layer: 'live-model-synthetic-host', status: 'ready',
    fixtureHash: FIXTURE_HASH, fixturePath: FIXTURE_PATH, bundlePath: BUNDLE_PATH,
    bundleSha256: null, pluginVersion: null, reloadVerified: false, model: null, maxRequests: null,
    physicalDispatchAdmissions: 0, fixedWebRequests: 0, selectedCaseIds: [],
    startedAt: null, completedAt: null, results: [], errorCode: null,
    humanVerdict: 'pending_human_review',
    usageLimit: 'Only provider-reported usage with a unique physical response ID is attributed; missing or ambiguous attempts remain unknown.' };

  const safeEvalCodes = new Set([
    'B149_ABORTED', 'B149_MODEL_CHANGED', 'B149_REQUEST_CAP_REACHED',
    'B149_SYNTHETIC_HOST_ONLY', 'B149_SYNTHETIC_PATH_ONLY', 'B149_EMBEDDINGS_BLOCKED',
    'B149_UNGATED_MODEL_TRANSPORT', 'B149_FIXED_WEB_PROVIDER_UNAVAILABLE',
    'B149_INVALID_FIXED_WEB_FIXTURE', 'B149_WEB_REQUEST_NOT_REPLACED',
    'B149_CHAT_SERVICE_SEAM_UNAVAILABLE',
  ]);

  const sha256 = async text => Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(text),
  ))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  function errorCode(error) {
    if (state.requestCapReached) return 'B149_REQUEST_CAP_REACHED';
    const message = typeof error?.message === 'string' ? error.message : '';
    if (safeEvalCodes.has(message)) return message;
    if (message === 'AI API token not configured. Add a valid token in Settings.') return 'provider_missing_token';
    if (message === 'AI provider configuration incomplete. Check base URL and model in Settings.') {
      return 'provider_missing_configuration';
    }
    const status = Number(error?.status);
    if (status === 401 || status === 403 || error?.name === 'AuthenticationError') return 'provider_auth_error';
    if (status === 429 || error?.name === 'RateLimitError') return 'provider_rate_limited';
    if (status >= 500 && status <= 599) return 'provider_server_error';
    if (['APIConnectionError', 'FetchError', 'TypeError'].includes(error?.name)
      || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code)) return 'transport_or_network_error';
    if (error?.name === 'AbortError') return 'aborted';
    return 'unclassified_error';
  }
  const stop = () => controller?.abort();
  const cleanup = () => { stop(); ownedService?.dispose(); ownedService = undefined; };

  function validateOptions(options) {
    if (!Number.isSafeInteger(options?.maxRequests) || options.maxRequests < 1 || options.maxRequests > 50) {
      throw new Error('B149_EXPLICIT_MAX_REQUESTS_1_TO_50_REQUIRED');
    }
    if (!/^[a-f0-9]{64}$/.test(options.expectedBundleSha256 ?? '')) {
      throw new Error('B149_EXPECTED_BUNDLE_SHA256_REQUIRED');
    }
    if (options.caseIds !== undefined && (!Array.isArray(options.caseIds)
      || options.caseIds.some(id => typeof id !== 'string'))) throw new Error('B149_INVALID_CASE_IDS');
  }

  async function preflight(options) {
    if (app.vault.getName() !== 'test' || app.plugins.plugins[PLUGIN_ID] !== plugin) {
      throw new Error('B149_TEST_VAULT_OR_PLUGIN_CHANGED');
    }
    if (!globalThis.__b149EvalPreReloadPlugin || globalThis.__b149EvalPreReloadPlugin === plugin) {
      throw new Error('B149_PLUGIN_RELOAD_NOT_VERIFIED');
    }
    // A marker authorizes one preflight only; each later run needs a new capture and reload.
    if (!Reflect.deleteProperty(globalThis, '__b149EvalPreReloadPlugin')) {
      throw new Error('B149_PLUGIN_RELOAD_NOT_VERIFIED');
    }
    validateOptions(options);
    const rawCases = await app.vault.adapter.read(FIXTURE_PATH);
    const cases = JSON.parse(rawCases);
    const actualHash = await sha256(JSON.stringify(cases));
    if (actualHash !== FIXTURE_HASH || !Array.isArray(cases) || cases.length !== 12
      || cases.some((item, index) => item.id !== `E-${String(index + 1).padStart(2, '0')}`
        || !Array.isArray(item.notes) || item.notes.some(note => !note.path.startsWith('synthetic/')))) {
      throw new Error('B149_FROZEN_FIXTURE_MISMATCH');
    }
    if (['E-02', 'E-03', 'E-08'].some(id => typeof cases.find(item => item.id === id)?.webEvidence !== 'string')) {
      throw new Error('B149_FROZEN_WEB_FIXTURE_MISSING');
    }
    const priorMessages = cases[8].history?.flatMap(message => message.canonicalTurn?.messages ?? []) ?? [];
    const actions = priorMessages.filter(message => message.role === 'assistant')
      .flatMap(message => message.content?.filter?.(part => part.type === 'toolCall') ?? []);
    const results = priorMessages.filter(message => message.role === 'toolResult');
    if (actions.length !== 2 || results.length !== 2
      || JSON.stringify(actions[0].input) === JSON.stringify(actions[1].input)
      || results[0].content.promptText !== results[1].content.promptText
      || actions.some((action, index) => action.id !== results[index].toolCallId)) {
      throw new Error('B149_FROZEN_ACTION_PAIRS_MISSING');
    }
    const bundleSha256 = await sha256(await app.vault.adapter.read(BUNDLE_PATH));
    if (bundleSha256 !== options.expectedBundleSha256) throw new Error('B149_DEPLOYED_BUNDLE_MISMATCH');
    const settings = plugin.settings;
    if (settings.aiProvider !== 'qwen' || settings.chatModelName !== 'deepseek-v4-pro') {
      throw new Error('B149_CONFIGURED_TEST_MODEL_REQUIRED');
    }
    const selected = options.caseIds ?? cases.map(item => item.id);
    if (selected.length === 0 || new Set(selected).size !== selected.length
      || selected.some(id => !cases.some(item => item.id === id))) throw new Error('B149_UNKNOWN_OR_DUPLICATE_CASE');
    return { cases: cases.filter(item => selected.includes(item.id)), bundleSha256,
      modelIdentity: { provider: settings.aiProvider, model: settings.chatModelName, baseURL: settings.baseURL } };
  }

  function syntheticHost(service, item, record, modelIdentity) {
    const original = service.host;
    const files = item.notes.map((note, index) => ({ path: note.path, name: note.path.split('/').at(-1),
      basename: note.path.split('/').at(-1).replace(/\.md$/, ''), extension: 'md',
      stat: { ctime: 1000 + index, mtime: 1000 + index, size: note.body.length } }));
    const byPath = new Map(files.map(file => [file.path, file]));
    const deny = () => { throw new Error('B149_SYNTHETIC_HOST_ONLY'); };
    const readSynthetic = async file => {
      if (!byPath.has(file?.path)) throw new Error('B149_SYNTHETIC_PATH_ONLY');
      return item.notes.find(note => note.path === file.path).body;
    };
    // Copy only public configuration fields. Never spread the plugin's settings,
    // which may acquire credential-bearing fields in a later version.
    const settings = { debug: false, aiProvider: modelIdentity.provider, baseURL: modelIdentity.baseURL,
      chatModelName: modelIdentity.model, policyModelName: '', embeddingModelName: '',
      shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false,
      webSearchEnabled: Boolean(item.webEvidence), licenseTier: 'paid',
      // Model-visible Memory stays available for a bounded "answer-now" result.
      // The synthetic port below never opens an index or dispatches embeddings.
      memoryEnabled: true, retrievalOptimizationFlags: {}, operationsAgentEnabled: false,
      operationsProactiveSaveSuggestionsEnabled: false, operationsAuditIncludeContent: false,
      operationsAuditRetentionDays: 30, statisticsVaultId: 'b149-synthetic' };
    return {
      settings,
      app: {
        workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
        vault: {
          getName: () => 'test',
          getMarkdownFiles: () => item.offline === 'search_failure'
            || (item.offline === 'recovery' && record.activeToolName === 'search_vault_snippets')
            ? deny() : files,
          getFiles: () => files,
          getAbstractFileByPath: path => byPath.get(path) ?? null,
          cachedRead: readSynthetic, read: readSynthetic,
          create: deny, modify: deny, process: deny, delete: deny, rename: deny,
          adapter: new Proxy({}, { get: () => deny }),
        },
        metadataCache: {
          getFileCache: file => {
            const note = item.notes.find(candidate => candidate.path === file?.path);
            return note ? { headings: [{ level: 1, heading: note.heading,
              position: { start: { line: 0 }, end: { line: 0 } } }] } : null;
          },
          getCache: () => null, getFirstLinkpathDest: () => null,
          resolvedLinks: {}, unresolvedLinks: {},
        },
        fileManager: { trashFile: deny, renameFile: deny },
      },
      memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }),
        searchHybrid: async () => [], getChunksByPath: async () => [],
        rankGraphCandidates: deny, getPathEvidenceGenerations: deny },
      getMemoryEvidenceEpoch: () => 'b149-synthetic-source-epoch',
      getAPIToken: () => original.getAPIToken(),
      isOperationsAgentEnabled: false,
      getMemoryExtractionPromptContext: () => undefined,
      log: () => undefined,
      agentDebug: { startRun: () => ({
        captureId: `b149-live-${item.id}`, enabled: () => true,
        bindRun: id => { record.runtimeRunId = id; },
        observe: event => {
          if (event.kind === 'attempt' && event.phase === 'dispatch') {
            record.requestBodies.push({ attemptId: event.attemptId ?? null,
              callId: event.callId ?? null, purpose: null, prompt: event.prompt ?? null,
              missingReason: event.missingReason ?? null });
          }
          if (event.kind === 'llm' && event.callId) record.callUpdates.push({
            callId: event.callId, purpose: event.purpose ?? 'unknown',
            totalTokens: event.usage?.totalTokens,
          });
        },
        finish: status => { record.debugStatus = status; },
      }) },
    };
  }

  function installModelDispatchGate(service, record, modelIdentity) {
    const createModel = service.aiUtils.createChatModel.bind(service.aiUtils);
    service.aiUtils.createEmbeddings = () => { throw new Error('B149_EMBEDDINGS_BLOCKED'); };
    service.aiUtils.createChatModel = async (temperature, options = {}) => {
      if (controller.signal.aborted) throw new Error('B149_ABORTED');
      const before = options.onProviderRequestStart;
      const trace = options.onProviderRequestTrace;
      const model = await createModel(temperature, {
        ...options,
        onProviderRequestStart: () => {
          before?.();
          if (controller.signal.aborted) throw new Error('B149_ABORTED');
          if (plugin.settings.aiProvider !== modelIdentity.provider
            || plugin.settings.chatModelName !== modelIdentity.model
            || plugin.settings.baseURL !== modelIdentity.baseURL) {
            stop(); throw new Error('B149_MODEL_CHANGED');
          }
          if (state.physicalDispatchAdmissions >= state.maxRequests) {
            state.requestCapReached = true; stop(); throw new Error('B149_REQUEST_CAP_REACHED');
          }
          state.physicalDispatchAdmissions++;
          record.physicalDispatchAdmissions++;
        },
        onProviderRequestTrace: event => {
          record.requestTrace.push(event);
          try { trace?.(event); } catch { /* Existing diagnostics remain optional. */ }
        },
        isProviderRequestTraceEnabled: () => true,
      });
      if (typeof model?.clientConfig?.fetch !== 'function') throw new Error('B149_UNGATED_MODEL_TRANSPORT');
      return model;
    };
  }

  function installFixedWeb(service, item, record) {
    const getProviders = service.getAdditionalCapabilityProviders.bind(service);
    service.getAdditionalCapabilityProviders = async () => {
      if (!item.webEvidence) return [];
      const providers = await getProviders();
      if (providers.length !== 1 || providers[0].id !== 'builtin-web-search') {
        throw new Error('B149_FIXED_WEB_PROVIDER_UNAVAILABLE');
      }
      const provider = providers[0];
      const separator = item.webEvidence.indexOf(': ');
      if (separator < 0) throw new Error('B149_INVALID_FIXED_WEB_FIXTURE');
      provider.request = async request => {
        state.fixedWebRequests++;
        record.webRequests.push({ endpoint: request.endpoint, body: request.body });
        return { status: 200, body: { results: [{ title: `Synthetic ${item.id}`,
          url: item.webEvidence.slice(0, separator), snippet: item.webEvidence.slice(separator + 2) }] } };
      };
      if (typeof provider.request !== 'function') throw new Error('B149_WEB_REQUEST_NOT_REPLACED');
      return [provider];
    };
  }

  async function runCase(item, modelIdentity) {
    const started = Date.now();
    const runSourceSelection = Object.freeze({ schemaVersion: 1, scope: item.requestedScope,
      selectionId: `b149-${item.id}-selection`, userMessageId: `b149-${item.id}-user` });
    const record = { caseId: item.id, baseline: item.baseline, status: 'running', terminalStatus: null,
      runSourceSelection,
      runtimeRunId: null, debugStatus: null, answer: '', writingArtifact: null,
      sourcePaths: [], sourceUrls: [], toolResults: [], toolCalls: [], visibleOutputs: [],
      requestTrace: [], requestBodies: [], webRequests: [], callUpdates: [], activeToolName: null,
      physicalDispatchAdmissions: 0, requestEvidenceComplete: false,
      startedAt: new Date().toISOString(), completedAt: null, errorCode: null,
      firstVisibleOutputMs: null, firstUsefulMs: null, deliveredMs: null,
      usefulRubric: 'pending_human_review', humanVerdict: 'pending_human_review' };
    state.results.push(record);
    const service = plugin.createChatService();
    ownedService = service;
    if (!service.host || !service.aiUtils?.createChatModel || !service.getAdditionalCapabilityProviders
      || typeof service.streamLLM !== 'function') throw new Error('B149_CHAT_SERVICE_SEAM_UNAVAILABLE');
    const host = syntheticHost(service, item, record, modelIdentity);
    service.host = host;
    service.aiUtils.host = host;
    const createRuntime = service.createAgentRuntime.bind(service);
    service.createAgentRuntime = options => createRuntime({ ...options,
      skillContextProvider: null, operationsIntentController: undefined, operationsToolProvider: undefined });
    installModelDispatchGate(service, record, modelIdentity);
    installFixedWeb(service, item, record);
    const writingContextHost = item.offline === 'writing' ? {
      conversationId: `b149-${item.id}-conversation`, candidates: [],
      versions: { get: async () => null },
      styles: { prepare: async () => ({ context: '', revisionIds: [],
        isCurrent: () => !controller.signal.aborted, isSourceCurrent: () => true }) },
      isCurrent: () => !controller.signal.aborted,
      isParentCurrent: () => false,
    } : undefined;
    try {
      await service.streamLLM(item.prompt, snapshot => { record.answer = snapshot; }, controller.signal,
        item.history ? [...item.history] : undefined, {
          userText: item.prompt, runSourceSelection, memoryMode: 'auto',
          onUsageAccounting: snapshot => { record.usageLedger = snapshot; },
          ...(writingContextHost ? { writingRequest: { requestId: `b149-${item.id}` },
            writingContextHost, writingOutputProtocol: 'native' } : {}),
          onLifecycleEvent: event => {
            if (event.type === 'agent_end') {
              record.terminalStatus = event.status;
              record.deliveredMs = Date.now() - started;
            }
            if (event.type === 'tool_execution_start') {
              record.activeToolName = event.toolName;
              record.toolCalls.push({ name: event.toolName, input: event.input });
            }
            if (event.type === 'tool_execution_end') record.activeToolName = null;
            if (event.type === 'message_end' && event.message.role === 'toolResult') {
              const message = event.message;
              const result = { name: message.toolName, promptText: message.content.promptText,
                sourcePaths: (message.content.sourceRecords ?? []).flatMap(source => source.path ? [source.path] : []),
                sourceUrls: (message.content.sourceRecords ?? []).flatMap(source => source.url ? [source.url] : []),
                isError: message.isError };
              record.toolResults.push(result);
              if (!result.isError) {
                record.sourcePaths.push(...result.sourcePaths);
                record.sourceUrls.push(...result.sourceUrls);
              }
            }
          },
          onEvent: event => {
            if (event.kind === 'answer-snapshot' && event.snapshot.trim()) {
              const atMs = Date.now() - started;
              record.visibleOutputs.push({ kind: event.kind, atMs, text: event.snapshot });
              if (record.firstVisibleOutputMs === null) record.firstVisibleOutputMs = atMs;
            }
            if (event.kind === 'writing-artifact') {
              record.writingArtifact = event.body;
              const atMs = Date.now() - started;
              record.visibleOutputs.push({ kind: event.kind, atMs, text: event.body });
              if (record.firstVisibleOutputMs === null) record.firstVisibleOutputMs = atMs;
              record.deliveredMs = atMs;
            }
            if (event.kind === 'answer-complete' || event.kind === 'partial-output-error' || event.kind === 'aborted') {
              record.deliveredMs = Date.now() - started;
            }
          },
        });
    } catch (error) { record.errorCode = errorCode(error); }
    finally {
      record.completedAt = new Date().toISOString();
      record.sourcePaths = [...new Set(record.sourcePaths)];
      record.sourceUrls = [...new Set(record.sourceUrls)];
      const calls = new Map();
      for (const update of record.callUpdates) {
        const previous = calls.get(update.callId);
        calls.set(update.callId, { callId: update.callId,
          purpose: update.purpose !== 'unknown' ? update.purpose : previous?.purpose ?? 'unknown',
          totalTokens: update.totalTokens ?? previous?.totalTokens });
      }
      record.calls = [...calls.values()];
      record.usage = record.usageLedger ? {
        estimatedPromptTokens: record.usageLedger.attempts.length > 0
          && record.usageLedger.attempts.every(attempt => Number.isFinite(attempt.estimatedPromptTokens))
          ? record.usageLedger.attempts.reduce((sum, attempt) => sum + attempt.estimatedPromptTokens, 0) : null,
        measuredPromptTokens: record.usageLedger.physicalAttribution === 'complete'
          && record.usageLedger.attempts.every(attempt => Number.isFinite(attempt.measuredPromptTokens))
          ? record.usageLedger.attempts.reduce((sum, attempt) => sum + attempt.measuredPromptTokens, 0) : null,
        logicalTotalTokens: record.usageLedger.logicalTotalTokens,
        knownUnassignedLogicalTokens: record.usageLedger.knownUnassignedLogicalTokens,
        physicalTotalTokens: record.usageLedger.physicalTotalTokens,
        knownPhysicalTokens: record.usageLedger.knownPhysicalTokens,
        physicalAttribution: record.usageLedger.physicalAttribution,
        attempts: record.usageLedger.attempts,
        logicalCalls: record.usageLedger.logicalCalls,
        price: { amount: null, currency: null, reason: 'pricing_not_verified_for_endpoint_model' },
      } : { estimatedPromptTokens: null, measuredPromptTokens: null,
        logicalTotalTokens: null, physicalTotalTokens: null,
        knownUnassignedLogicalTokens: null,
        knownPhysicalTokens: 0, physicalAttribution: 'unknown',
        price: { amount: null, currency: null, reason: 'pricing_not_verified_for_endpoint_model' } };
      const usageByAttempt = new Map((record.usage.attempts ?? []).map(attempt => [attempt.attemptId, attempt]));
      record.requestBodies = record.requestBodies.map(request => {
        const attempt = usageByAttempt.get(request.attemptId);
        return { ...request,
          estimatedPromptTokens: attempt?.estimatedPromptTokens ?? null,
          estimateMethod: attempt?.estimateMethod ?? null,
          measuredPromptTokens: attempt?.measuredPromptTokens ?? null,
          measuredTotalTokens: attempt?.complete ? attempt.totalTokens : null,
          usageStatus: attempt?.status ?? 'unknown',
        };
      });
      delete record.usageLedger;
      record.requestEvidenceComplete = record.requestBodies.length === record.physicalDispatchAdmissions
        && record.requestTrace.filter(event => event.phase === 'http_dispatch').length === record.physicalDispatchAdmissions
        && record.requestBodies.every(request => request.prompt && typeof request.prompt === 'object'
          && Object.keys(request.prompt).length > 0 && !request.missingReason);
      if (state.requestCapReached) record.errorCode = 'B149_REQUEST_CAP_REACHED';
      if (!record.errorCode && record.terminalStatus === 'error') {
        const failedHttp = [...record.requestTrace].reverse().find(event => event.phase === 'http_error'
          || (event.phase === 'http_response' && event.status >= 400));
        record.errorCode = failedHttp?.phase === 'http_error' ? 'transport_or_network_error'
          : failedHttp?.status === 401 || failedHttp?.status === 403 ? 'provider_auth_error'
            : failedHttp?.status === 429 ? 'provider_rate_limited'
              : failedHttp?.status >= 500 ? 'provider_server_error' : 'runtime_or_provider_error_unclassified';
      }
      record.status = controller.signal.aborted ? 'cancelled'
        : record.errorCode || record.terminalStatus === 'error' ? 'failed'
          : record.terminalStatus ?? 'unknown';
      if (record.deliveredMs === null && record.status !== 'completed') record.deliveredMs = Date.now() - started;
      delete record.callUpdates;
      delete record.activeToolName;
      service.dispose();
      ownedService = undefined;
    }
  }

  async function start(options) {
    if (starting || state.status === 'running') throw new Error('B149_ALREADY_RUNNING');
    starting = true;
    try {
      const prepared = await preflight(options);
      cleanup();
      controller = new AbortController();
      Object.assign(state, { status: 'running', bundleSha256: prepared.bundleSha256,
        pluginVersion: plugin.manifest?.version ?? null, reloadVerified: true,
        model: { provider: prepared.modelIdentity.provider, model: prepared.modelIdentity.model },
        maxRequests: options.maxRequests, physicalDispatchAdmissions: 0, fixedWebRequests: 0,
        requestCapReached: false, selectedCaseIds: prepared.cases.map(item => item.id),
        startedAt: new Date().toISOString(), completedAt: null, results: [], errorCode: null });
      try {
        for (const item of prepared.cases) {
          if (controller.signal.aborted) break;
          if (item.id === 'E-11') {
            state.results.push({ caseId: item.id, status: 'not_run_offline_only', terminalStatus: null,
              reason: 'In-flight nonresponsive preparation is an offline cancellation probe.' });
            continue;
          }
          await runCase(item, prepared.modelIdentity);
        }
        state.status = state.requestCapReached ? 'cap_reached'
          : controller.signal.aborted ? 'aborted'
            : state.results.some(result => result.status === 'failed') ? 'recorded_with_runtime_failures'
              : 'recorded_for_review';
      } catch (error) {
        state.status = state.requestCapReached ? 'cap_reached' : controller.signal.aborted ? 'aborted' : 'failed';
        state.errorCode = errorCode(error);
      } finally { state.completedAt = new Date().toISOString(); cleanup(); }
      return state;
    } finally {
      starting = false;
    }
  }

  globalThis.__b149AgentEval = { state, start, abort: stop, cleanup,
    export: () => JSON.stringify(state),
    fixturePath: FIXTURE_PATH, fixtureHash: FIXTURE_HASH, bundlePath: BUNDLE_PATH };
})();
