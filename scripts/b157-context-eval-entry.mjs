/* B-157 test-only entry. Loading installs a handle and makes no provider call.
 * Build with build-b157-context-eval.mjs. In the test vault, load the bundle,
 * call __b157ContextEval.markBeforeReload(), reload the plugin, then load the
 * bundle again. Root starts an explicitly capped run with deployed bundle and
 * harness SHA-256 identities. No provider/model/settings are changed.
 */
import { TFile, TFolder, parseYaml, getFrontMatterInfo, resolveSubpath } from 'obsidian';
import fixture from './fixtures/b157-context-eval.json';
import { MemoryChatHistoryStore, IndexedDbChatHistoryStore, CHAT_HISTORY_SCHEMA_VERSION,
  CHAT_HISTORY_IDB_VERSION, buildTurnRecordKey } from '../src/chat/chat-history-store';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { createPaAgentPersistedTurn } from '../src/ai-services/pa-agent-history';
import { completeInputLineage, cloneInputLineage } from '../src/ai-services/input-lineage';
import { cloneActionStates, refreshImageActionState, refreshWritingSaveStates,
  refreshGhostActionState } from '../src/ai-services/pa-agent-result-facts';
import { OperationsService } from '../src/ai-services/operations/operations-service';
import { ImageAssetService } from '../src/chat/image-assets';
import { ImageGenerationService } from '../src/chat/image-generation-service';
import { WritingVersionService } from '../src/chat/writing-versions';
import { WritingSaveAction } from '../src/chat/writing-save-action';
import { resolveImageGenerationConnection } from '../src/ai-services/image-generation-connection';
import { WanImageProvider } from '../src/ai-services/wan-image-provider';
import { GhostClientError } from '../src/ghost-publishing/client';
import { GhostPublishingService } from '../src/ghost-publishing/service';
import { GhostOperationStore } from '../src/ghost-publishing/state-store';
import { createGhostActionContext } from '../src/ghost-publishing/action-context';
import { GhostPublishingIntegration } from '../src/ghost-publishing/host-integration';
import { FakeGovernanceIndexedDbFactory } from '../__tests__/helpers/fake-governance-indexeddb';
import { confirmUserAction } from '../src/confirm';
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import { parseConversationSourceSelection } from '../src/ai-services/chat-source-scope';

const buildInfo = typeof __B157_BUILD_INFO__ === 'undefined' ? null : __B157_BUILD_INFO__;
const PREFIX = fixture.syntheticPrefix;
const copy = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw new Error(`B157_${code}`); };
const errorCode = error => /^B157_[A-Z0-9_]+$/.test(error?.message ?? '')
  ? error.message : error?.name === 'AbortError' ? 'B157_ABORTED' : 'B157_EXECUTION_FAILED';
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof value === 'string' ? new TextEncoder().encode(value) : value)))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

export function episodeSchedule(caseIds = fixture.cases.map(item => item.id), arms = fixture.arms) {
  if (!Array.isArray(caseIds) || caseIds.length === 0 || new Set(caseIds).size !== caseIds.length
    || caseIds.some(id => !fixture.cases.some(item => item.id === id))) fail('INVALID_CASE_SELECTION');
  if (!Array.isArray(arms) || arms.length === 0 || new Set(arms).size !== arms.length
    || arms.some(arm => !fixture.arms.includes(arm))) fail('INVALID_ARM_SELECTION');
  return fixture.cases.filter(item => caseIds.includes(item.id)).flatMap(item => arms.map(arm => ({ ...item, arm })));
}

export function validateStartOptions(options) {
  if (!Number.isSafeInteger(options?.maxRequests) || options.maxRequests < 1) fail('EXPLICIT_REQUEST_CAP_REQUIRED');
  for (const key of ['expectedBundleSha256', 'expectedHarnessSha256']) {
    if (!/^[a-f0-9]{64}$/.test(options[key] ?? '')) fail('BUNDLE_IDENTITY_REQUIRED');
  }
  if (typeof options.harnessPath !== 'string' || !options.harnessPath.startsWith(PREFIX)
    || options.harnessPath.split('/').includes('..')) fail('SYNTHETIC_HARNESS_PATH_REQUIRED');
  if (typeof options.expectedPluginVersion !== 'string' || !options.expectedPluginVersion) fail('PLUGIN_VERSION_REQUIRED');
  if (options.summaryOnly !== undefined && typeof options.summaryOnly !== 'boolean') fail('INVALID_SUMMARY_ONLY');
  if (options.summaryOnly) {
    if (options.caseIds !== undefined || options.arms !== undefined || options.summaryUpdates === false) fail('SUMMARY_ONLY_SELECTION_CONFLICT');
  } else episodeSchedule(options.caseIds, options.arms);
  return options;
}

/** Capture only serialized model fields. Never read/export URL, headers or client configuration. */
export function captureProviderBody(body) {
  if (typeof body !== 'string') fail('REQUEST_BODY_UNAVAILABLE');
  let parsed;
  try { parsed = JSON.parse(body); } catch { fail('REQUEST_BODY_UNAVAILABLE'); }
  if (!Array.isArray(parsed.messages)) fail('REQUEST_MESSAGES_UNAVAILABLE');
  const safe = {};
  for (const key of ['model', 'stream', 'messages', 'tools', 'tool_choice', 'max_tokens',
    'max_completion_tokens', 'temperature', 'response_format', 'stream_options', 'top_p',
    'stop', 'seed', 'presence_penalty', 'frequency_penalty', 'reasoning_effort', 'enable_thinking']) {
    if (parsed[key] !== undefined) safe[key] = copy(parsed[key]);
  }
  return safe;
}

export function observedHistoryPath(body) {
  const encoded = value => value?.encoding === 'adjacent-repeats-v1' && Array.isArray(value.segments)
    && value.segments.every(segment => typeof segment.text === 'string' && Number.isSafeInteger(segment.count) && segment.count > 0);
  let rawHistory = false;
  for (const message of body.messages) {
    if (message.role !== 'user') continue;
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
    // The projector puts history before current input in this Host-owned prefix.
    // System instructions and current-user examples are never history payloads.
    if (!text.startsWith('Recent chat history:\n')) continue;
    const history = text.slice('Recent chat history:\n'.length).split(/\n\n(?:User input|Host context|Personal context):\n/u)[0];
    const summary = /<conversation_summary\b[^>]*context_only="true"[^>]*>\s*([\s\S]*?)\s*<\/conversation_summary>/u.exec(history);
    if (summary) {
      try { const value = JSON.parse(summary[1]);
        if (['goals', 'constraints', 'decisions', 'completed', 'open_questions', 'facts'].every(key => Array.isArray(value[key]))) return 'summary';
      } catch { /* An invalid diagnostic marker cannot establish this path. */ }
    }
    if (/<compaction_summary\b[^>]*context_only="true"[^>]*>[\s\S]+?<\/compaction_summary>/u.test(history)) return 'deterministic';
    const block = /<chat_history\b[^>]*context_only="true"[^>]*>\s*([\s\S]*?)\s*<\/chat_history>/u.exec(history);
    if (!block) continue;
    try {
      const records = JSON.parse(block[1]);
      if (!Array.isArray(records)) continue;
      rawHistory = true;
      for (const record of records) {
        if (encoded(record.content)) return 'lossless';
        for (const group of record.actionHistory ?? []) for (const call of group.calls ?? []) for (const result of call.results ?? []) {
          const envelope = typeof result.text === 'string'
            ? /<lossless_tool_result\b[^>]*context_only="true"[^>]*>[^\n]*\n[^\n]*\n(\{[\s\S]*\})\n<\/lossless_tool_result>/u.exec(result.text) : undefined;
          if (envelope && encoded(JSON.parse(envelope[1]))) return 'lossless';
        }
      }
    } catch { /* Retain unknown/raw evidence instead of guessing a reduction. */ }
  }
  if (rawHistory) return 'compat-raw';
  return body.messages.some(message => message.role === 'tool') ? 'native'
    : 'raw-or-absent';
}

/** Finite lifecycle snapshots are copied from actual ChatService events, never fabricated. */
export function lifecycleRecorder() {
  const messages = new Map();
  const events = [];
  let runId, turnId, status, committedFinalText = '';
  return {
    events,
    observe(event) {
      events.push(copy(event));
      if (event.type === 'agent_start') runId = event.runId;
      if (event.type === 'turn_start') turnId = event.turnId;
      if (event.type === 'message_end') messages.set(event.message.id, copy(event.message));
      if (event.type === 'turn_end') { turnId = event.turnId; status = event.status; }
      if (event.type === 'agent_end') {
        runId = event.runId; status = event.status;
        turnId = event.metadata?.finalTurnId ?? turnId;
      }
    },
    commit(text) { committedFinalText = text; },
    canonical() {
      if (!runId || !turnId) fail('CANONICAL_LIFECYCLE_MISSING');
      return createPaAgentPersistedTurn({ runId, turnId, status, committedFinalText,
        messages: [...messages.values()] });
    },
  };
}

/** In-memory synthetic vault: domain services execute normally, every mutation is recorded. */
export function createSyntheticApp() {
  const files = new Map(), bytes = new Map(), listeners = new Map(), mutations = [];
  let revision = 1000, failure, root;
  const allowed = path => typeof path === 'string' && path.startsWith(PREFIX)
    && !path.split('/').includes('..');
  // Real ImageAssetService uses its existing logical PA Chat root. These paths
  // exist only in this in-memory vault and are never admitted as note sources.
  const storageAllowed = path => allowed(path) || path === 'pa-images'
    || (typeof path === 'string' && /^pa-images\/[^/]+$/.test(path) && !path.includes('..'));
  const admit = path => { if (!storageAllowed(path)) fail('SYNTHETIC_PATH_ONLY'); };
  const emit = (name, ...args) => { for (const callback of listeners.get(name) ?? []) callback(...args); };
  const file = (path, folder = false) => {
    const result = folder ? new TFolder(vault, path) : new TFile(vault, path);
    if (!folder) result.stat = { ctime: ++revision, mtime: revision, size: 0 };
    result.parent = path ? files.get(path.slice(0, path.lastIndexOf('/'))) ?? root : null;
    if (result.parent) result.parent.children.push(result);
    return result;
  };
  const mutate = (kind, path) => {
    admit(path); mutations.push({ kind, path, ordinal: mutations.length + 1 });
    if (failure === kind) { failure = undefined; fail('CONTROLLED_LOCAL_WRITE_FAILURE'); }
  };
  const put = (path, content, folder = false) => {
    const result = files.get(path) ?? file(path, folder); files.set(path, result);
    if (!folder) { bytes.set(path, content); result.stat.size = typeof content === 'string' ? content.length : content.byteLength; }
    return result;
  };
  const read = async target => { admit(target.path); if (!files.has(target.path)) fail('SYNTHETIC_FILE_MISSING');
    const data = bytes.get(target.path); if (typeof data !== 'string') fail('SYNTHETIC_TEXT_REQUIRED'); return data; };
  const vault = {
    configDir: '.obsidian', getName: () => 'test', getRoot: () => root,
    getAbstractFileByPath: path => files.get(path) ?? null,
    getMarkdownFiles: () => [...files.values()].filter(value => value instanceof TFile && value.extension === 'md'),
    getFiles: () => [...files.values()].filter(value => value instanceof TFile), read, cachedRead: read,
    readBinary: async target => { admit(target.path); const data = bytes.get(target.path);
      return typeof data === 'string' ? new TextEncoder().encode(data).buffer : data.slice(0); },
    create: async (path, data) => { mutate('create', path); if (files.has(path)) fail('SYNTHETIC_COLLISION');
      const result = put(path, data); emit('create', result); return result; },
    createBinary: async (path, data) => { mutate('createBinary', path); if (files.has(path)) fail('SYNTHETIC_COLLISION');
      const result = put(path, data.slice(0)); emit('create', result); return result; },
    createFolder: async path => { mutate('createFolder', path); return put(path, '', true); },
    modify: async (target, data) => { mutate('modify', target.path); put(target.path, data); target.stat.mtime = ++revision; emit('modify', target); },
    process: async (target, fn) => { const value = fn(await read(target)); mutate('process', target.path);
      put(target.path, value); target.stat.mtime = ++revision; emit('modify', target); return value; },
    delete: async target => { mutate('delete', target.path); files.delete(target.path); bytes.delete(target.path); emit('delete', target); },
    rename: async (target, path) => { mutate('rename', path); const old = target.path, data = bytes.get(old);
      files.delete(old); bytes.delete(old); target.path = path; files.set(path, target); bytes.set(path, data); emit('rename', target, old); },
    on: (name, callback) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); return { name, callback }; },
    offref: ref => listeners.get(ref.name)?.delete(ref.callback),
    getResourcePath: target => `synthetic://${target.path}`,
  };
  vault.adapter = {
    exists: async path => files.has(path), mkdir: async path => vault.createFolder(path),
    read: async path => read({ path }), readBinary: async path => vault.readBinary({ path }),
    write: async (path, value) => files.has(path) ? vault.modify(files.get(path), value) : vault.create(path, value),
    writeBinary: async (path, value) => vault.createBinary(path, value),
    remove: async path => vault.delete(files.get(path)),
  };
  // Obsidian constructs TAbstractFile from (vault, path). Bootstrap only after
  // the isolated vault exists; no object from the actual user's vault is used.
  root = file('', true);
  put(PREFIX.slice(0, -1), '', true);
  put(`${PREFIX}source.md`, '# 合成银杏\n\n仅用于 B157 评测的公开合成文字。\n');
  put(`${PREFIX}new-source.md`, '# 合成枫树\n\n第二项独立合成任务。\n');
  return { vault, workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
    metadataCache: { getFileCache: target => ({ frontmatter: (() => {
      const text = bytes.get(target.path); if (typeof text !== 'string' || !text.startsWith('---\n')) return {};
      try { return JSON.parse(text.slice(4, text.indexOf('\n---', 4))); } catch { return {}; }
    })(), headings: [{ level: 1, heading: target.basename,
      position: { start: { line: 0 }, end: { line: 0 } } }] }), getCache: () => null,
      getFirstLinkpathDest: (path) => files.get(path) ?? null, resolvedLinks: {}, unresolvedLinks: {} },
    fileManager: { trashFile: target => vault.delete(target), renameFile: (target, path) => vault.rename(target, path),
      getAvailablePathForAttachment: async name => `${PREFIX}${name}`,
      processFrontMatter: async (target, fn) => {
        const text = await read(target), info = getFrontMatterInfo(text);
        let frontmatter = {};
        if (info.exists) {
          try { frontmatter = JSON.parse(info.frontmatter); }
          catch { frontmatter = parseYaml(info.frontmatter) ?? {}; }
        }
        fn(frontmatter); await vault.modify(target, `---\n${JSON.stringify(frontmatter)}\n---\n${text.slice(info.contentStart)}`);
      } },
    synthetic: { allowed, storageAllowed, mutations, failNext: kind => { failure = kind; },
      contents: () => [...bytes.entries()].filter(([, value]) => typeof value === 'string').map(([path, content]) => ({ path, content })) },
  };
}

export function installDispatchRecorder(service, control, record) {
  const createModel = service.aiUtils.createChatModel.bind(service.aiUtils);
  service.aiUtils.createEmbeddings = () => fail('EMBEDDINGS_BLOCKED');
  service.aiUtils.createChatModel = async (temperature, options = {}) => {
    control.assertCurrent();
    const attemptedInputs = [];
    const model = await createModel(temperature, { ...options,
      onProviderRequestStart: () => {
        control.assertCurrent(); options.onProviderRequestStart?.();
        if (control.count >= control.maximum) { control.abort(); fail('REQUEST_CAP_REACHED'); }
        control.count++; record.admittedRequests = (record.admittedRequests ?? 0) + 1;
        const attempted = attemptedInputs.find(input => input.status === 'attempted');
        if (attempted) { attempted.status = 'admitted'; attempted.admissionOrdinal = control.count; }
        control.onAdmission?.(control.count);
      },
      onProviderRequestTrace: event => {
        record.dispatchTrace.push(copy(event));
        if (event.phase === 'http_dispatch') {
          control.dispatched = (control.dispatched ?? 0) + 1;
          record.physicalRequests++;
          control.onDispatch?.(control.dispatched);
        }
        const input = event.phase === 'http_dispatch'
          ? attemptedInputs.find(input => input.status === 'admitted' && !input.requestId)
          : attemptedInputs.find(input => input.requestId === event.requestId);
        if (input) { input.requestId = event.requestId; input.status = event.phase;
          if (event.status !== undefined) input.responseStatus = event.status; }
        options.onProviderRequestTrace?.(event);
      },
      isProviderRequestTraceEnabled: () => true,
    });
    if (typeof model?.clientConfig?.fetch !== 'function') fail('UNGATED_MODEL_TRANSPORT');
    const transport = model.clientConfig.fetch;
    const capturedFetch = async (input, init) => {
      // The SDK calls this once for every retry. Its existing transport still
      // executes admission/cancellation; this observer never sees auth headers.
      const body = captureProviderBody(init?.body);
      const attempted = { ordinal: record.providerInputs.length + 1, status: 'attempted',
        evidence: 'attempted_payload; physical_input_requires_http_dispatch_requestId',
        historyPath: observedHistoryPath(body), body };
      attemptedInputs.push(attempted); record.providerInputs.push(attempted);
      try { return await transport(input, init); }
      catch (error) { if (!attempted.requestId) attempted.status = attempted.admissionOrdinal
        ? 'admission_without_dispatch' : 'rejected_before_dispatch'; throw error; }
    };
    model.clientConfig.fetch = capturedFetch;
    // Installed ChatOpenAI.withConfig/bindTools constructs a new model from
    // fields; its completions delegate already has a separate clientConfig.
    // Observe all three existing paths without replacing the SDK or its gate.
    if (model.fields?.configuration) model.fields.configuration.fetch = capturedFetch;
    else if (typeof model.withConfig === 'function') fail('MODEL_CLONE_TRANSPORT_UNAVAILABLE');
    for (const delegate of [model.completions, model.responses]) {
      if (!delegate) continue;
      if (delegate.client) fail('MODEL_ALREADY_DISPATCHED');
      delegate.clientConfig.fetch = capturedFetch;
    }
    return model;
  };
}

function syntheticHost(original, syntheticApp, identity, record) {
  return {
    app: syntheticApp,
    settings: { debug: false, aiProvider: identity.provider, baseURL: identity.baseURL,
      chatModelName: identity.model, policyModelName: '', embeddingModelName: '',
      qwenThinkingEnabled: identity.thinking, shareAnonymousCapabilityUsage: false,
      webSearchEnabled: false, memoryEnabled: true, licenseTier: original.settings.licenseTier,
      operationsAgentEnabled: true, operationsProactiveSaveSuggestionsEnabled: false,
      retrievalOptimizationFlags: {}, statisticsVaultId: 'b157-synthetic' },
    getAPIToken: () => original.getAPIToken(),
    isOperationsAgentEnabled: true,
    isDataBoundaryAllowedPath: path => syntheticApp.synthetic.allowed(path),
    isDataBoundaryAllowedFile: target => syntheticApp.synthetic.allowed(target.path),
    getMemoryEvidenceEpoch: () => 'b157-synthetic-source-epoch',
    memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }),
      searchHybrid: async () => [], getChunksByPath: async () => [] },
    getMemoryExtractionPromptContext: () => undefined,
    log: () => undefined,
    agentDebug: { startRun: () => ({ captureId: `b157_${record.id}_${record.turns.length}`,
      enabled: () => true, bindRun: () => undefined, finish: () => undefined,
      observe: event => {
        if (event.kind === 'attempt' && event.phase === 'dispatch') record.debugInputs.push({
          attemptId: event.attemptId, callId: event.callId, prompt: event.prompt, missingReason: event.missingReason });
        if (event.kind === 'llm') {
          record.callUpdates.push({ callId: event.callId, purpose: event.purpose, usage: event.usage });
          if (event.purpose === 'context_summary') record.summaryConsumerUpdates.push({ callId: event.callId,
            phase: event.phase, status: event.status, missingReason: event.missingReason,
            ...(event.error ? { error: errorCode(event.error) } : {}) });
        }
      } }) },
  };
}

function isolatedChatService(plugin, syntheticApp, identity, record, control) {
  // plugin.createChatService retains its real SDK/runtime factory. Only this
  // disposable service's data and domain ports are replaced.
  const service = plugin.createChatService();
  const original = service.host;
  if (!original || !service.aiUtils) fail('SERVICE_PORTS_UNAVAILABLE');
  if (!['free', 'paid'].includes(original.settings.licenseTier)) fail('PUBLIC_CAPABILITY_TIER_UNAVAILABLE');
  record.capabilityTier = original.settings.licenseTier;
  service.operationsSession?.dispose();
  service.ownedOperationsService?.dispose();
  const operations = new OperationsService({ vault: syntheticApp.vault,
    trashFile: target => syntheticApp.fileManager.trashFile(target),
    isOperationsAgentEnabled: () => true, isPathAllowed: syntheticApp.synthetic.allowed,
    frontmatterCodec: { parse: parseYaml, stringify: value => JSON.stringify(value) } });
  service.operationsSession = operations.createSession({ surface: 'b157-synthetic' });
  service.ownedOperationsService = operations;
  record.operationsCapability = { originalEnabled: original.isOperationsAgentEnabled === true,
    controlledEnabled: true, boundary: 'authorized_fixture_instance; actual_confirmation_required' };
  service.host = syntheticHost(original, syntheticApp, identity, record);
  service.aiUtils.host = service.host;
  installDispatchRecorder(service, control, record);
  const prepareHistory = service.contextSummarizer.prepareHistory.bind(service.contextSummarizer);
  service.contextSummarizer.prepareHistory = async input => {
    const observedInvoke = async (payload, signal) => {
      const before = record.providerInputs.length;
      const beforeCalls = record.callUpdates.length;
      const observation = { ordinal: record.summaryCompletions.length + 1,
        evidence: 'actual_synthetic_aux_invoke_return; diagnostic_only',
        maxChars: Number(payload.messages[0].content.match(/must be at most (\d+) characters/)?.[1]),
        sourceIndexes: payload.bindingSources?.map(source => source.index) ?? [] };
      const sourcePayload = JSON.parse(payload.messages[1].content);
      const actionFactsPayload = JSON.parse(payload.messages[2].content);
      observation.freeSourceIndexes = sourcePayload.sourceMessages?.map(source => source.index) ?? [];
      observation.retainedActionFactIndexes = actionFactsPayload.retainedActionFacts?.map(source => source.index) ?? [];
      if (Array.isArray(actionFactsPayload.retainedActionFacts)) observation.maxCharsMeaning = 'free_output_after_deterministic_fact_reservation';
      record.summaryCompletions.push(observation);
      try {
        const response = await input.invoke(payload, signal);
        observation.outcome = 'returned';
        observation.parserInput = observeSummaryParserInput(response, observation.maxChars);
        return response;
      } catch (error) {
        observation.outcome = 'invoke_error'; observation.error = errorCode(error);
        observation.errorType = ['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'APIError',
          'APIConnectionError', 'APIConnectionTimeoutError', 'RateLimitError'].includes(error?.name) ? error.name : 'unknown';
        throw error;
      } finally {
        observation.requestIds = record.providerInputs.slice(before).filter(item => item.requestId).map(item => item.requestId);
        observation.callId = record.callUpdates.slice(beforeCalls).filter(item => item.purpose === 'context_summary').at(-1)?.callId;
      }
    };
    const summary = await prepareHistory({ ...input, invoke: observedInvoke });
    record.summaryPreparations.push({ historyBudgetChars: input.historyBudgetChars,
      historyMessageCount: input.history.length, ...(summary ? { text: summary.text,
        coveredMessageCount: summary.sourceMessages.length } : { outcome: 'no_summary' }) });
    return summary;
  };
  return service;
}

function observeSummaryParserInput(response, maxChars) {
  if (typeof response !== 'string') return { type: response === undefined ? 'undefined' : response === null ? 'null' : typeof response,
    observation: 'non_string_invoke_return; inspect_consumer_status' };
  const maxCapturedChars = 16_000;
  const rawParseLimitExceeded = response.length > maxCapturedChars;
  const parserText = rawParseLimitExceeded ? undefined
    : response.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, '$1');
  let canonicalJSONStringChars;
  if (parserText !== undefined) {
    try {
      const value = JSON.parse(parserText);
      // Match summary text normalization for length diagnostics only. Schema,
      // source associations and admission remain the actual consumer's decision.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const field of ['goals', 'constraints', 'decisions', 'completed', 'open_questions', 'facts']) {
          if (Array.isArray(value[field])) value[field] = value[field].map(item => item
            && typeof item === 'object' && typeof item.text === 'string' ? { ...item, text: item.text.trim() } : item);
        }
      }
      canonicalJSONStringChars = JSON.stringify(value).length;
    } catch { /* Invalid JSON has no canonical length; inspect the actual consumer. */ }
  }
  return { type: 'string', chars: response.length, rawParseLimitChars: maxCapturedChars,
    observation: 'format_and_length_only; inspect_actual_consumer_for_schema_source_and_admission',
    ...(parserText !== undefined ? { parserTextChars: parserText.length } : {}),
    ...(canonicalJSONStringChars !== undefined ? { canonicalJSONStringChars,
      formattingOverBudget: parserText.length > maxChars && canonicalJSONStringChars <= maxChars } : {}),
    ...(rawParseLimitExceeded ? { rejectionCondition: 'raw_text_exceeds_parse_limit' }
      : canonicalJSONStringChars > maxChars ? { rejectionCondition: 'canonical_summary_exceeds_max_chars' } : {}),
    ...(response.length <= maxCapturedChars ? { text: response, truncated: false }
      : { prefix: response.slice(0, 512), suffix: response.slice(-512), truncated: true, captureReason: 'capture_limit_exceeded' }) };
}

async function freshManager(store) {
  const manager = new ChatHistoryManager({ store }); await manager.initialize();
  if (!manager.isAvailable()) fail('HISTORY_STORE_UNAVAILABLE'); return manager;
}

function turnOptions(conversationId, userMessageId, userText, budget) {
  return { conversationId, userText, historyBudgetChars: budget, memoryMode: 'auto',
    inputLineage: completeInputLineage([{ kind: 'user-text', messageId: userMessageId }]),
    runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: `scope_${userMessageId}`,
      userMessageId, persistedSelectionRevision: 0 } };
}

async function executeTurn(context, text, extra = {}, budget = fixture.historyBudgetChars[context.item.arm]) {
  const { record, store, manager, service, conversation } = context;
  const index = context.turnIndex++, userMessageId = `b157_${record.id}_${index}`;
  const storedTurns = await store.getTurns(conversation.id);
  const history = storedTurns.flatMap(turn => { const hydrated = manager.deserializeTurn(copy(turn));
    return [hydrated.userMessage, hydrated.assistantMessage]; });
  const lifecycle = lifecycleRecorder(), legacy = [], usages = [];
  const options = { ...turnOptions(conversation.id, userMessageId, text, budget), ...extra,
    onLifecycleEvent: event => lifecycle.observe(event), onCommittedFinalText: text => lifecycle.commit(text),
    onEvent: event => { if (event.kind === 'writing-artifact') legacy.push(event); },
    onUsageAccounting: value => usages.push(copy(value)) };
  let answer = '', failure;
  try { await service.streamLLM(text, chunk => { answer += chunk; }, context.signal, history, options); }
  catch (error) { failure = errorCode(error); }
  const canonical = lifecycle.canonical();
  const user = { role: 'user', content: text, inputLineage: options.inputLineage,
    runSourceSelection: options.runSourceSelection,
    hostProvenance: { version: 1, kind: extra.writingRequest ? 'writing_request' : 'ordinary_user_statement', messageId: userMessageId } };
  const assistant = { role: 'assistant', content: canonical.committedFinalText ?? answer,
    inputLineage: canonical.inputLineage, canonicalTurn: canonical, actionStates: canonical.actionStates };
  if (legacy.length) await context.domains.persistWritingArtifact(legacy.at(-1), assistant, index);
  context.conversation = await manager.recordTurn({ conversationId: conversation.id, turnIndex: index,
    entry: { kind: 'history', user, assistant }, userPrompt: text, conversation: context.conversation });
  record.turns.push({ index, userText: text, answer: assistant.content, canonical: copy(canonical),
    events: lifecycle.events, usage: usages, historyIdentity: await hash(JSON.stringify(storedTurns)),
    historyRawChars: JSON.stringify(history).length, historyBudgetChars: budget,
    writingProtocol: options.writingOutputProtocol ?? 'ordinary', writingRequestPresent: Boolean(options.writingRequest),
    writingArtifacts: copy(legacy),
    providerInputEnd: record.providerInputs.length, ...(failure ? { error: failure } : {}) });
  if (failure) fail('TURN_FAILED');
  return { canonical, assistant, index, userMessageId };
}

// Domain adapters below use real services. Their ports record synthetic calls;
// they never instantiate an external image provider or send a Ghost transport.

function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitFor(read, predicate, signal) {
  const deadline = Date.now() + 15_000;
  while (true) {
    if (signal?.aborted) fail('ABORTED');
    const value = await read(); if (predicate(value)) return value;
    if (Date.now() >= deadline) fail('DOMAIN_EVENT_NOT_OBSERVED');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export function recordingGhostRuntime(appInstance, record, options = {}) {
  const site = options.site ?? 'https://b157.synthetic.invalid/';
  const siteUrl = new URL(site);
  if (!['http:', 'https:'].includes(siteUrl.protocol) || siteUrl.username || siteUrl.password
    || !(siteUrl.hostname.endsWith('.invalid') || ['localhost', '127.0.0.1', '[::1]'].includes(siteUrl.hostname))) fail('CONTROLLED_GHOST_SITE_REQUIRED');
  const siteId = 'b157-synthetic-site', profile = { siteId };
  const operations = new GhostOperationStore({ dbName: `b157_${record.id}`,
    isDesktop: () => true, indexedDb: new FakeGovernanceIndexedDbFactory() });
  const completedRecords = new Map(), remote = new Map();
  let ordinal = 0, unknown = options.unknown === true;
  const now = () => new Date(Date.UTC(2026, 9, 2) + ++ordinal * 1000).toISOString();
  const records = {
    read: async (_siteId, noteUid) => completedRecords.has(noteUid) ? copy(completedRecords.get(noteUid)) : null,
    write: async (next, checksum) => {
      if ((completedRecords.get(next.binding.noteUid)?.checksum ?? null) !== checksum) fail('GHOST_RECORD_CONFLICT');
      completedRecords.set(next.binding.noteUid, copy(next));
      record.domainEvents.push({ owner: 'ghost-record', revision: next.revision, completed: copy(next.completed) });
    },
  };
  const send = async (method, gate, fields) => {
    record.submissions.push({ domain: 'ghost', method, ...(fields ? { fields: copy(fields) } : {}) });
    await gate.beforeSend(); gate.assertCurrent();
  };
  const client = {
    readPost: async (id, gate) => { await send('read', gate); const post = remote.get(id);
      if (!post) throw new GhostClientError('http', 'failed', 404); return copy(post); },
    findPostsByMarker: async (marker, gate) => { await send('find', gate);
      return [...remote.values()].filter(post => post.tags.some(tag => tag.name === marker)).map(copy); },
    createDraft: async (fields, gate) => {
      await send('create', gate, fields);
      const id = (++ordinal).toString(16).padStart(24, '0');
      const post = { id, uuid: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
        title: '', lexical: null, slug: fields.slug ?? `b157-${ordinal}`, status: 'draft',
        authors: [{ id: '2'.repeat(24) }], visibility: 'public', custom_template: null,
        feature_image: null, feature_image_alt: null, feature_image_caption: null,
        custom_excerpt: null, codeinjection_head: null, codeinjection_foot: null, published_at: null,
        ...copy(fields), tags: copy(fields.tags ?? []), created_at: now(), updated_at: now(),
        url: `${site}${fields.slug ?? `b157-${ordinal}`}/` };
      remote.set(id, post);
      if (unknown) { unknown = false; throw new GhostClientError('network', 'unknown'); }
      return copy(post);
    },
    updatePost: async (id, version, fields, gate) => { await send('update', gate, fields);
      const post = remote.get(id); if (post?.updated_at !== version) throw new GhostClientError('conflict', 'failed', 409);
      const next = { ...post, ...copy(fields), updated_at: now() }; remote.set(id, next); return copy(next); },
    deleteDraft: async (id, gate) => { await send('delete', gate); remote.delete(id); },
    uploadImage: async () => fail('GHOST_FIXTURE_HAS_NO_IMAGES'),
    downloadImage: async () => fail('GHOST_FIXTURE_HAS_NO_IMAGES'),
  };
  const service = new GhostPublishingService({ siteId, site, isDesktop: () => true,
    client, operations, records, newId: () => `b157-ghost-${++ordinal}`, now });
  const contextFor = (path, guard, sourceValidity, signal) => createGhostActionContext({
    selection: { path }, host: { vault: appInstance.vault, metadataCache: appInstance.metadataCache,
      fileManager: appInstance.fileManager, getFrontMatterInfo,
      parseYaml: text => { try { return JSON.parse(text); } catch { return parseYaml(text); } }, resolveSubpath }, client,
    isDesktop: () => true, guard, sourceValidity, siteId, siteUrl: site,
    getConnectionIdentity: () => 'b157-recording-connection', getProfile: () => profile,
    getSourceRevision: path => appInstance.vault.getAbstractFileByPath(path)?.stat?.mtime ?? 0,
    defaultVisibility: 'public', signal,
    readCompletedRecord: records.read,
    getCompletedRecordRevision: (_siteId, noteUid) => completedRecords.get(noteUid)?.revision ?? 0,
    generateMetadata: async () => ({ customExcerpt: 'Synthetic B157 article.', metaDescription: 'Synthetic B157 article.', slug: `b157-${ordinal}` }),
  });
  return { client, service, operations, records, site, siteId, profile, contextFor,
    setUnknown(value) { unknown = value; },
    async readPreviewMaterial(operationId) {
      const operation = await operations.findForContext(siteId, operationId);
      const post = operation?.target.previewId ? remote.get(operation.target.previewId) : undefined;
      if (!post) fail('GHOST_RECORDING_POST_MISSING');
      return { operationId, postId: post.id, uuid: post.uuid, title: post.title, lexical: post.lexical,
        slug: post.slug, status: post.status, codeinjection_head: post.codeinjection_head,
        codeinjection_foot: post.codeinjection_foot, snapshot: copy(operation.candidate),
        evidence: 'actual_recording_remote_draft; preview_gate_unmodified_and_unverified' };
    },
    publishRecordingRemote(id) { const post = remote.get(id); if (!post) fail('GHOST_RECORDING_POST_MISSING');
      post.status = 'published'; post.published_at = post.updated_at = now();
      record.domainEvents.push({ owner: 'ghost-recording-remote', postId: id, status: 'published' }); },
    dispose() { service.invalidate(); operations.close(); } };
}

export function createControlledDomains(appInstance, store, record, options = {}) {
  const allowed = path => path.startsWith(PREFIX) && !path.split('/').includes('..');
  const assets = new ImageAssetService(appInstance, store, {
    isPathAllowed: appInstance.synthetic?.storageAllowed ?? allowed });
  const versions = new WritingVersionService(store);
  const save = new WritingSaveAction(appInstance, store, assets, { isPathAllowed: allowed });
  const completion = deferred();
  let released = false, imageOrdinal = 0;
  const connection = resolveImageGenerationConnection({ aiProvider: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    imageGenerationConnectionMode: 'inherit-chat', imageGenerationBaseURL: '', imageGenerationConnectionRevision: 0 },
  { chat: 'b157-recording', dedicated: 'b157-recording' });
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII='), char => char.charCodeAt(0));
  const image = new ImageGenerationService({ store, assets, resolveConnection: () => connection,
    getToken: async () => 'b157-synthetic-placeholder',
    providerFactory: (current, token) => new WanImageProvider({ baseURL: current.baseURL, apiKey: token,
      request: async request => {
        record.submissions.push({ domain: 'image', method: request.method,
          ...(request.method === 'POST' ? { body: JSON.parse(request.body) } : {}) });
        if (request.method === 'POST') {
          if (options.unknown) throw new Error('Synthetic acceptance lost.');
          return { status: 200, json: { request_id: `b157_request_${++imageOrdinal}`,
            output: { task_id: `b157_task_${imageOrdinal}`, task_status: 'PENDING' } } };
        }
        if (!released) await completion.promise;
        return { status: 200, json: { request_id: `b157_result_${imageOrdinal}`,
          output: { task_id: request.url.split('/').at(-1), task_status: 'SUCCEEDED', finished: true,
            choices: [{ finish_reason: 'stop', message: { content: [{ type: 'image',
              image: 'https://b157.oss-cn-beijing.aliyuncs.com/fixture.png' }] } }] } } };
      } }), download: async () => png.slice().buffer });
  const unsubscribe = image.subscribe(task => record.domainEvents.push({ owner: 'image-service',
    taskId: task.taskId, revision: task.revision, state: task.state }));
  const ghost = recordingGhostRuntime(appInstance, record, options);
  const pendingGhost = new Map();
  let activeContext;
  const domains = {
    assets, versions, save, image, ghost, connection,
    attach(context) { activeContext = context; },
    releaseImage() { released = true; completion.resolve(); },
    bindings(text, index) {
      const context = activeContext, userMessageId = `b157_${record.id}_${index}`;
      const conversationId = context.conversation.id;
      return {
        createImage: { conversationId, stableMessageId: userMessageId, operationId: `image_${userMessageId}`,
          submit: async (input, isSourceCurrent, lineage) => {
            if (isSourceCurrent?.() === false) fail('SOURCE_REVOKED');
            return image.submit({ conversationId, stableMessageId: userMessageId, operationId: `image_${userMessageId}`,
              userPrompt: text, submittedPrompt: input.prompt, operation: input.operation, count: input.count,
              inputRefs: [], inputLineage: lineage, isSourceCurrent,
              attachmentPathHint: `${PREFIX}images` }).catch(error => {
                record.domainEvents.push({ owner: 'image-binding', error: /^image_generation:[a-z_]+$/.test(error?.message ?? '')
                  ? error.message : errorCode(error) }); throw error;
              });
          } },
        ghostPublishing: { conversationId, stableMessageId: userMessageId,
          submit: async (input, guard, sourceValidity, signal) => {
            const path = input.path ?? `${PREFIX}source.md`;
            if (!allowed(path) || !guard.isPathAllowed(path, 'task_material') || !sourceValidity()) fail('SOURCE_REVOKED');
            const created = await ghost.contextFor(path, guard, sourceValidity, signal);
            const existingIds = new Set((await ghost.operations.list(ghost.siteId, created.noteUid))
              .map(operation => operation.operationId));
            created.context.gate.assertCurrent();
            let operation;
            try {
              operation = await ghost.service.prepare(created.noteUid, created.postId, created.context, input.intent === 'restore');
            } catch (error) {
              // PublishingSession.initialize reloads persisted state after a lost
              // response. This headless binding admits only this request's unique
              // new unknown operation; existing or ambiguous records prove nothing.
              created.context.gate.assertCurrent();
              const added = (await ghost.operations.list(ghost.siteId, created.noteUid))
                .filter(candidate => !existingIds.has(candidate.operationId));
              created.context.gate.assertCurrent();
              if (added.length !== 1 || added[0].site !== ghost.site || added[0].state !== 'outcome_unknown') throw error;
              operation = added[0];
              record.domainEvents.push({ owner: 'ghost-binding', operationId: operation.operationId,
                revision: operation.revision, state: operation.state, evidence: 'actual-new-owned-persisted-operation' });
            }
            pendingGhost.set(operation.operationId, { ...created, path, guard, sourceValidity });
            return { status: operation.state === 'outcome_unknown' ? 'outcome_unknown' : 'prepared', operationId: operation.operationId };
          } },
      };
    },
    async persistWritingArtifact(artifact, assistant, turnIndex) {
      const context = activeContext;
      if (artifact.resultFact?.kind !== 'artifact_ready') fail('WRITING_ARTIFACT_RECEIPT_MISSING');
      const version = await versions.create({ conversationId: context.conversation.id, turnIndex,
        requestId: artifact.requestId, messageId: artifact.messageId, text: artifact.body,
        explanation: artifact.explanation, images: [], generationInput: artifact.generationInput });
      if (context.store !== store) await context.store.putWritingVersion(copy(version));
      const canonical = assistant.canonicalTurn, lineage = cloneInputLineage(canonical.inputLineage);
      if (!lineage) fail('WRITING_LINEAGE_MISSING');
      const state = { schemaVersion: 1, owner: 'writing', operationId: version.id, phase: 'ready', revision: 0,
        origin: { runId: canonical.runId, turnId: canonical.turnId, assistantId: artifact.messageId, resultId: artifact.messageId },
        inputLineage: lineage, receipt: { kind: 'writing-version', versionId: version.id } };
      canonical.actionStates = cloneActionStates([...(canonical.actionStates ?? []), state]);
      assistant.actionStates = canonical.actionStates; assistant.writingVersionId = version.id;
      record.domainEvents.push({ owner: 'writing-version-service', versionId: version.id, turnIndex });
    },
    async refreshStates() {
      const context = activeContext;
      const turns = await context.store.getTurns(context.conversation.id);
      for (const turn of turns) {
        const binding = turn.assistant.actionStateBinding;
        if (!binding) continue;
        const updates = [];
        for (const state of turn.assistant.actionStates ?? []) {
          let next = state;
          if (state.owner === 'image') {
            const task = await image.get(state.operationId); if (task) next = refreshImageActionState(state, task,
              context.conversation.id, turn.user.hostProvenance?.messageId) ?? state;
          } else if (state.owner === 'operations') next = context.service.refreshOperationsActionState(state);
          else if (state.owner === 'writing') next = refreshWritingSaveStates(state,
            (await save.listReceipts()).filter(receipt => receipt.writingVersionId === state.operationId)) ?? state;
          else if (state.owner === 'ghost') {
            const operation = await ghost.operations.findForContext(ghost.siteId, state.operationId);
            if (operation) next = refreshGhostActionState(state, { operationId: operation.operationId,
              revision: operation.revision, state: operation.state, verified: operation.verified?.status === 'published' }) ?? state;
          }
          updates.push(next);
        }
        await context.manager.updateActionStates(context.conversation.id, binding.runId, binding.turnId, () => updates);
      }
    },
    async settleInitial(item = activeContext.item) {
      const context = activeContext;
      const turns = await context.store.getTurns(context.conversation.id);
      // Only the newly requested turn may satisfy or receive this settlement.
      // Earlier action states remain in history but cannot stand in for a new call.
      const states = turns.at(-1)?.assistant.actionStates ?? [];
      if (!states.some(state => state.owner === item.domain)) fail('REQUESTED_DOMAIN_ACTION_NOT_OBSERVED');
      if (item.domain === 'image') {
        domains.releaseImage();
        await waitFor(() => image.list(context.conversation.id), tasks => tasks.some(task =>
          task.state === (item.settle === 'unknown' ? 'submission_unknown' : 'completed')), context.signal);
      } else if (item.domain === 'operations' && item.settle === 'complete') {
        for (const state of states.filter(state => state.owner === 'operations')) {
          record.confirmations.push({ domain: 'operations', intentId: state.operationId, boundary: 'actual-session-confirm' });
          await context.service.confirmOperationsIntent(state.operationId);
        }
      } else if (item.domain === 'writing') {
        const version = (await versions.list(context.conversation.id)).at(-1);
        if (!version) fail('WRITING_VERSION_NOT_OBSERVED');
        const prepared = await save.prepare({ writingVersionId: version.id,
          targetNotePath: `${PREFIX}${record.id}-saved.md` });
        record.confirmations.push({ domain: 'writing', operationId: prepared.operationId, boundary: 'actual-save-execute' });
        if (item.settle === 'unknown') appInstance.synthetic.failNext('process');
        await save.execute(prepared.operationId).catch(() => { if (item.settle !== 'unknown') fail('WRITING_SAVE_FAILED'); });
      } else if (item.domain === 'ghost' && item.settle === 'complete') {
        for (const state of states.filter(state => state.owner === 'ghost')) {
          const original = pendingGhost.get(state.operationId);
          if (!original || original.guard.isCurrent() || original.sourceValidity()) fail('GHOST_RUN_AUTHORITY_NOT_ENDED');
          let rejected = false;
          try { original.context.gate.assertCurrent(); } catch { rejected = true; }
          if (!rejected) fail('GHOST_OLD_CONTEXT_NOT_REJECTED');
          record.domainEvents.push({ owner: 'ghost-action-authority', oldRunGuardCurrent: false, oldContextRejected: true });
          const operation = await ghost.operations.findForContext(ghost.siteId, state.operationId);
          ghost.publishRecordingRemote(operation.target.previewId);
          record.confirmations.push({ domain: 'ghost', operationId: operation.operationId,
            boundary: 'recording-external-manual-publish-then-real-refresh' });
          const authority = await freshGhostActionAuthority(context, original.path, operation.operationId);
          try {
            const created = await ghost.contextFor(original.path, authority.guard, authority.sourceValidity, authority.signal);
            if (created.noteUid !== original.noteUid) fail('GHOST_SOURCE_IDENTITY_CHANGED');
            await ghost.service.refresh(created.noteUid, operation.operationId, created.context);
            record.domainEvents.push({ owner: 'ghost-action-authority', freshAuthority: true,
              sourceScope: authority.selection.scope, sourceSelectionRevision: authority.selection.revision });
          } finally { authority.release(); }
        }
      }
      await domains.refreshStates();
      record.domainStateAfterEvents = copy(await context.store.getTurns(context.conversation.id));
    },
    async dispose() { unsubscribe(); completion.resolve(); image.dispose(); ghost.dispose(); versions.dispose();
      await save.dispose(); await assets.dispose(); },
  };
  return domains;
}

async function freshGhostActionAuthority(context, path, operationId) {
  const { manager, store, conversation, syntheticApp, signal } = context;
  const lease = manager.observeSourceLifetime(conversation.id);
  try {
    const persisted = await store.getConversation(conversation.id);
    const selection = parseConversationSourceSelection(persisted?.sourceSelection);
    const turns = await store.getTurns(conversation.id);
    const origin = turns.find(turn => turn.assistant.actionStates?.some(state => state.owner === 'ghost' && state.operationId === operationId));
    const stableMessageId = origin?.user.hostProvenance?.messageId;
    if (!selection || !stableMessageId || !lease.isCurrent()) fail('GHOST_ACTION_SOURCE_UNAVAILABLE');
    const selectionCurrent = () => {
      const latest = manager.latestConversationSourceSelection(conversation.id) ?? selection;
      return !signal.aborted && context.manager === manager && context.store === store
        && context.conversation.id === conversation.id && lease.isCurrent()
        && latest.scope === selection.scope && latest.revision === selection.revision;
    };
    const state = new TaskSourceConstraintState({
      runId: `ghost-action-${stableMessageId}-${crypto.randomUUID()}`, userMessageId: stableMessageId,
      userText: origin.user.content, noteHandles: new Map(), sourceScope: selection.scope,
    });
    const guard = state.createReadGuard(state.snapshot(), targetPath => {
      const target = syntheticApp.vault.getAbstractFileByPath(targetPath);
      return target instanceof TFile && syntheticApp.synthetic.allowed(targetPath) ? targetPath : undefined;
    }, selectionCurrent, undefined, undefined, () => false, () => false, selectionCurrent);
    if (!guard.isPathAllowed(path, 'task_material')) fail('GHOST_ACTION_SOURCE_UNAVAILABLE');
    return { guard, sourceValidity: selectionCurrent, signal: lease.signal, selection, release: lease.release };
  } catch (error) { lease.release(); throw error; }
}

function newRecord(item) {
  return { id: `${item.id}-${item.arm}`, caseId: item.id, arm: item.arm, domain: item.domain,
    followup: item.followup, status: 'running', physicalRequests: 0, turns: [], providerInputs: [],
    dispatchTrace: [], debugInputs: [], callUpdates: [], summaryPreparations: [], summaryCompletions: [], summaryConsumerUpdates: [],
    domainEvents: [], submissions: [], confirmations: [],
    humanVerdict: 'pending' };
}

async function newEpisodeContext({ item, plugin, identity, control, resources, signal, state }) {
  const record = newRecord(item); state.results.push(record);
  const syntheticApp = createSyntheticApp(), store = new MemoryChatHistoryStore();
  let manager = await freshManager(store);
  const conversation = await manager.startConversation(item.initial);
  const service = isolatedChatService(plugin, syntheticApp, identity, record, control);
  const domains = createControlledDomains(syntheticApp, store, record, { unknown: item.settle === 'unknown' });
  const context = { item, plugin, identity, control, resources, signal, record, syntheticApp, store,
    manager, conversation, service, domains, turnIndex: 0 };
  domains.attach(context); resources.add(service); resources.add(domains);
  return context;
}

async function reopenContext(context) {
  const before = await context.store.getTurns(context.conversation.id);
  const wire = JSON.stringify(before);
  // A new storage object exercises clone/store validation; a new manager must
  // deserialize it, and a new ChatService has no derived summary/session cache.
  const restored = new MemoryChatHistoryStore(); await restored.initialize();
  await restored.upsertConversation(copy(context.conversation));
  for (const version of await context.store.listWritingVersions(context.conversation.id)) {
    await restored.putWritingVersion(JSON.parse(JSON.stringify(version)));
  }
  for (const receipt of await context.store.listSaveReceipts()) await restored.putSaveReceipt(JSON.parse(JSON.stringify(receipt)));
  for (const turn of JSON.parse(wire)) await restored.appendTurn(turn);
  context.service.dispose(); context.resources.delete(context.service);
  context.manager = await freshManager(restored);
  context.service = isolatedChatService(context.plugin, context.syntheticApp, context.identity, context.record, context.control);
  context.resources.add(context.service);
  // Domain stores stay live; history manager is reopened against the serialized
  // history store. Domain updates target this reopened manager from now on.
  context.store = restored;
  const hydrated = (await restored.getTurns(context.conversation.id)).map(turn => context.manager.deserializeTurn(turn));
  context.record.reopen = { serializedSha256: await hash(wire), storedSha256: await hash(JSON.stringify(await restored.getTurns(context.conversation.id))),
    hydratedTurnCount: hydrated.length, newStore: true, newManager: true, newService: true };
}

async function runEpisode(input) {
  const context = await newEpisodeContext(input), { item, record, domains } = context;
  try {
    const text = `${fixture.padding.text.repeat(fixture.padding.repeat)}\n${item.initial}`;
    const extra = { ...domains.bindings(text, 0), ...(item.domain === 'writing'
      ? await writingOptions(context, `writing_${record.id}_0`) : {}) };
    await executeTurn(context, text, extra, fixture.historyBudgetChars.reference);
    await domains.settleInitial();
    await reopenContext(context);
    // Lost Operations is established from the new real session, not inserted as
    // a canonical terminal fact. Other domains retain their real owner stores.
    await domains.refreshStates();
    const before = record.submissions.length;
    const followupExtra = { ...domains.bindings(item.question, 1),
      ...(item.domain === 'writing' && item.followup === 'new'
        ? await writingOptions(context, `writing_${record.id}_1`) : {}) };
    await executeTurn(context, item.question, followupExtra);
    record.followupSubmissions = record.submissions.slice(before);
    record.persistedAfterFollowup = copy(await context.store.getTurns(context.conversation.id));
    record.localMutations = copy(context.syntheticApp.synthetic.mutations);
    record.localSyntheticNotes = context.syntheticApp.synthetic.contents();
    const followupInputs = record.providerInputs.slice(record.turns[0].providerInputEnd).filter(input => input.requestId);
    record.comparison = { historyBudgetChars: fixture.historyBudgetChars[item.arm],
      observedPaths: [...new Set(followupInputs.map(input => input.historyPath))],
      compressionObserved: followupInputs.some(input => ['lossless', 'summary', 'deterministic'].includes(input.historyPath)),
      sameProviderWindowAndOutputReserve: 'inspect_actual_provider_inputs_and_usage',
      writingEvidence: item.domain === 'writing' ? 'inspect_actual_finaltext_and_artifact_events; no_writing_request_on_ordinary_explain_or_unknown' : undefined,
      semanticStatus: 'requires_independent_review' };
    record.status = 'recorded_for_review';
  } catch (error) { record.status = 'failed'; record.error = errorCode(error);
    record.errorType = error?.name ?? 'unknown';
    if (Array.isArray(error?.issues)) record.validationPaths = error.issues.map(issue => issue.path);
    throw error; }
  finally { input.resources.delete(context.service); input.resources.delete(domains);
    context.service.dispose(); await domains.dispose(); }
}

async function writingOptions(context, requestId) {
  const candidates = await context.domains.versions.list(context.conversation.id);
  const sourceCurrent = context.manager.captureSourceLifetime(context.conversation.id);
  const isCurrent = () => !context.signal.aborted && sourceCurrent();
  const admitted = new Map(candidates.map(version => [version.id, version.textHash]));
  return { writingRequest: { requestId }, writingOutputProtocol: 'native',
    writingContextHost: { conversationId: context.conversation.id, candidates,
      versions: context.domains.versions,
      styles: { prepare: async () => ({ context: '', revisionIds: [], isCurrent }) },
      isCurrent, isParentCurrent: parent => isCurrent() && admitted.get(parent.id) === parent.textHash,
      isParentSourceCurrent: parent => sourceCurrent() && admitted.get(parent.id) === parent.textHash } };
}

async function runSummaryUpdates(input) {
  const item = { id: 'three-summary-updates', arm: 'candidate', domain: 'prose', followup: 'corrections', initial: fixture.summaryUpdates[0] };
  const context = await newEpisodeContext({ ...input, item });
  try {
    for (const [index, text] of fixture.summaryOperationSeeds.entries()) {
      await executeTurn(context, text, {}, fixture.historyBudgetChars.reference);
      await context.domains.settleInitial({ domain: 'operations', settle: index === 0 ? 'complete' : 'lost-after-reopen' });
    }
    context.record.summaryStateBeforeReopen = copy(await context.store.getTurns(context.conversation.id));
    await reopenContext(context);
    await context.domains.refreshStates();
    context.record.summaryStateAfterReopen = copy(await context.store.getTurns(context.conversation.id));
    context.record.localMutations = copy(context.syntheticApp.synthetic.mutations);
    context.record.localSyntheticNotes = context.syntheticApp.synthetic.contents();
    for (let seedIndex = 0; seedIndex < fixture.summaryWarmup.length; seedIndex++) {
      const seed = fixture.summaryWarmup[seedIndex];
      const parts = seedIndex === 0 ? fixture.summaryWarmupMaterial.earlierParts : fixture.summaryWarmupMaterial.parts;
      const material = Array.from({ length: parts }, (_, index) =>
        `样本-${seedIndex}-${String(index).padStart(2, '0')}：${fixture.summaryWarmupMaterial.text}`).join('\n');
      await executeTurn(context, `${material}\n${seed}`, {}, fixture.historyBudgetChars.reference);
    }
    context.record.summaryStateBeforeUpdates = copy(await context.store.getTurns(context.conversation.id));
    context.record.summaryCorrectionTurns = [];
    for (let index = 0; index < fixture.summaryUpdates.length; index++) {
      const text = `${fixture.padding.text.repeat(fixture.padding.repeat)}\n${fixture.summaryUpdates[index]}`;
      const turnIndex = context.record.turns.length;
      await executeTurn(context, text, {}, fixture.summaryHistoryBudgetChars);
      context.record.summaryCorrectionTurns.push({ turnIndex,
        persistedTurn: copy((await context.store.getTurns(context.conversation.id)).at(-1)) });
    }
    context.record.summaryStateBeforeVerification = copy(await context.store.getTurns(context.conversation.id));
    context.record.summaryVerificationTurns = [];
    for (let index = 0; index < 2; index++) {
      const materialParts = 12;
      const material = Array.from({ length: materialParts }, (_, sample) =>
        `样本-${index + fixture.summaryWarmup.length}-${String(sample).padStart(2, '0')}：${fixture.summaryWarmupMaterial.text}`).join('\n');
      const text = `${material}\n请简短核对当前方案和原操作状态，沿用已有最新决定，不新增任务、写入或发布授权。`;
      const turnIndex = context.record.turns.length;
      const verification = { turnIndex, userSourceIndex: turnIndex * 2 + 1,
        materialParts, status: 'started' };
      context.record.summaryVerificationTurns.push(verification);
      try {
        await executeTurn(context, text, {}, fixture.summaryHistoryBudgetChars);
        verification.persistedTurn = copy((await context.store.getTurns(context.conversation.id)).at(-1));
        verification.status = 'completed';
      } catch (error) { verification.status = 'failed'; throw error; }
    }
    const summaries = context.record.summaryPreparations.filter(item => item.text);
    context.record.summaryEvidence = { summaryCallCount: new Set(context.record.callUpdates
      .filter(call => call.purpose === 'context_summary' && call.callId).map(call => call.callId)).size,
      observedSummaryUpdates: summaries.filter((item, index) => index === 0 || item.text !== summaries[index - 1].text).length,
      preparedSummaryCount: summaries.length,
      coveredMessageCounts: summaries.map(item => item.coveredMessageCount),
      verificationTurnIndices: context.record.summaryVerificationTurns.map(item => item.turnIndex),
      observedPaths: [...new Set(context.record.providerInputs.map(input => input.historyPath))],
      requiredUpdates: 3, actualUpdateVerdict: 'pending_input_and_summary_binding_review' };
    context.record.status = 'recorded_for_review';
  } catch (error) { context.record.status = 'failed'; context.record.error = errorCode(error); throw error; }
  finally { input.resources.delete(context.service); input.resources.delete(context.domains);
    context.service.dispose(); await context.domains.dispose(); }
}

function boundedNativeApp(appInstance, record) {
  const ownedPaths = new Set();
  const allowed = path => typeof path === 'string' && path.startsWith(PREFIX) && !path.split('/').includes('..');
  const storageAllowed = path => allowed(path) || path === PREFIX.slice(0, -1) || path === 'pa-images'
    || (typeof path === 'string' && /^pa-images\/[^/]+$/.test(path) && !path.includes('..'));
  const mutations = [];
  const admit = path => { if (!storageAllowed(path)) fail('SYNTHETIC_PATH_ONLY'); };
  const vault = new Proxy(appInstance.vault, { get(target, property) {
    if (property === 'getMarkdownFiles') return () => target.getMarkdownFiles().filter(file => allowed(file.path));
    if (property === 'getFiles') return () => target.getFiles().filter(file => storageAllowed(file.path));
    if (['read', 'cachedRead', 'readBinary'].includes(property)) return async file => { admit(file.path); return target[property](file); };
    if (['create', 'createBinary', 'createFolder'].includes(property)) return async (path, value) => {
      admit(path); if (target.getAbstractFileByPath(path)) fail('NATIVE_FIXTURE_COLLISION');
      const result = await target[property](path, value); ownedPaths.add(path);
      mutations.push({ kind: property, path }); record.domainEvents.push({ owner: 'native-vault', kind: property, path }); return result;
    };
    if (['modify', 'process', 'delete'].includes(property)) return async (file, value) => {
      admit(file.path); if (!allowed(file.path) && !ownedPaths.has(file.path)) fail('NATIVE_OWNED_FILE_REQUIRED');
      const result = await target[property](file, value); mutations.push({ kind: property, path: file.path }); return result;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new Proxy(appInstance, { get(target, property) {
    if (property === 'vault') return vault;
    if (property === 'synthetic') return { allowed, storageAllowed, mutations, ownedPaths,
      failNext: () => fail('NATIVE_FAILURE_INJECTION_UNAVAILABLE') };
    if (property === 'secretStorage') return { getSecret: () => fail('SECRET_ACCESS_BLOCKED'), setSecret: () => fail('SECRET_ACCESS_BLOCKED') };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

async function validateExistingNativeHistory(indexedDb, expected) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!expected || Object.keys(expected).sort().join(',') !== 'conversations,databaseName'
    || typeof expected.databaseName !== 'string'
    || !expected.databaseName.startsWith('b157-context-eval-')
    || !uuid.test(expected.databaseName.slice('b157-context-eval-'.length))
    || !Array.isArray(expected.conversations) || expected.conversations.length < 1 || expected.conversations.length > 8
    || expected.conversations.some(item => !item || Object.keys(item).sort().join(',') !== 'id,turnCount'
      || !uuid.test(item.id) || !Number.isSafeInteger(item.turnCount) || item.turnCount < 0 || item.turnCount > 50)
    || new Set(expected.conversations.map(item => item.id)).size !== expected.conversations.length) {
    fail('NATIVE_EXISTING_HISTORY_IDENTITY_INVALID');
  }
  if (typeof indexedDb.databases !== 'function') fail('NATIVE_DATABASE_LIST_UNAVAILABLE');
  const databases = (await indexedDb.databases()).filter(database => database.name === expected.databaseName);
  if (databases.length !== 1) fail('NATIVE_EXISTING_DATABASE_NOT_FOUND');
  if (databases[0].version !== CHAT_HISTORY_IDB_VERSION) fail('NATIVE_EXISTING_DATABASE_VERSION');
  // IndexedDB can disappear between databases() and open(). Prevent the real
  // Store's upgrade callback from creating or migrating a missing database.
  const existingOnly = { open(name, version) {
    if (name !== expected.databaseName || version !== CHAT_HISTORY_IDB_VERSION) fail('NATIVE_EXISTING_DATABASE_MISMATCH');
    const request = indexedDb.open(name, version);
    request.onupgradeneeded = () => request.transaction?.abort();
    return new Proxy(request, {
      get(target, property) { const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value; },
      set(target, property, value) {
        if (property === 'onupgradeneeded') return true;
        return Reflect.set(target, property, value, target);
      },
    });
  } };
  const database = await new Promise((resolve, reject) => {
    let abandoned = false;
    const request = existingOnly.open(expected.databaseName, CHAT_HISTORY_IDB_VERSION);
    request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
    request.onerror = () => { abandoned = true; reject(new Error('B157_NATIVE_EXISTING_DATABASE_OPEN_FAILED')); };
    request.onblocked = () => { abandoned = true; reject(new Error('B157_NATIVE_EXISTING_DATABASE_OPEN_BLOCKED')); };
  });
  try {
    if (database.version !== CHAT_HISTORY_IDB_VERSION
      || !['metadata', 'conversations', 'turns'].every(name => database.objectStoreNames.contains(name))) {
      fail('NATIVE_EXISTING_HISTORY_SCHEMA');
    }
    const transaction = database.transaction(['metadata', 'conversations', 'turns'], 'readonly');
    const read = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('B157_NATIVE_EXISTING_HISTORY_READ_FAILED'));
    });
    const [schema, active, conversations, turns] = await Promise.all([
      read(transaction.objectStore('metadata').get('schema-version')),
      read(transaction.objectStore('metadata').get('active-conversation')),
      read(transaction.objectStore('conversations').getAll()), read(transaction.objectStore('turns').getAll()),
    ]);
    if (schema?.value !== CHAT_HISTORY_SCHEMA_VERSION) fail('NATIVE_EXISTING_HISTORY_SCHEMA');
    const expectedCounts = new Map(expected.conversations.map(item => [item.id, item.turnCount]));
    if (active?.value != null && !expectedCounts.has(active.value)
      || conversations.length !== expectedCounts.size
      || new Set(conversations.map(item => item.id)).size !== expectedCounts.size
      || conversations.some(item => !expectedCounts.has(item.id) || expectedCounts.get(item.id) !== item.turnCount)
      || turns.length !== [...expectedCounts.values()].reduce((sum, count) => sum + count, 0)) {
      fail('NATIVE_EXISTING_HISTORY_MISMATCH');
    }
    const seen = new Set();
    for (const row of turns) {
      const turn = row.turn, count = expectedCounts.get(turn?.conversationId);
      if (count === undefined || !Number.isSafeInteger(turn.turnIndex) || turn.turnIndex < 0 || turn.turnIndex >= count
        || row.key !== buildTurnRecordKey(turn.conversationId, turn.turnIndex) || seen.has(row.key)
        || turn.user?.role !== 'user' || turn.assistant?.role !== 'assistant') fail('NATIVE_EXISTING_HISTORY_MISMATCH');
      seen.add(row.key);
    }
  } finally { database.close(); }
  return existingOnly;
}

export function installB157ContextEval(appInstance) {
  if (appInstance?.vault?.getName() !== 'test') fail('TEST_VAULT_REQUIRED');
  const plugin = appInstance.plugins?.plugins?.['personal-assistant'];
  if (!plugin?.createChatService) fail('CHAT_SERVICE_UNAVAILABLE');
  if (globalThis.__b157ContextEval?.state.status === 'running') fail('ALREADY_RUNNING');
  if (globalThis.__b157ContextEval?.hasOwnedResources()) fail('PREVIOUS_HANDLE_CLEANUP_REQUIRED');
  let controller, activeRun, nativeRestore, nativeHistory;
  const resources = new Set();
  const nativeHosts = new Set(), nativeConversationIds = new Set();
  const state = { schemaVersion: 1, status: 'ready', fixtureId: fixture.id, buildInfo,
    model: null, physicalRequests: 0, maxRequests: null, results: [], error: null,
    humanVerdict: 'pending', uiAdapterStatus: 'not_installed' };
  const cleanup = async () => {
    if (nativeRestore && appInstance.workspace?.getLeavesOfType?.('sidellm-view')
      .some(leaf => nativeHosts.has(leaf.view?.host))) fail('CLOSE_OWNED_CHAT_VIEWS_BEFORE_CLEANUP');
    controller?.abort();
    if (activeRun) await activeRun;
    nativeRestore?.(); nativeRestore = undefined;
    state.cleanupStatus = 'disposing';
    for (const resource of [...resources].reverse()) await resource.dispose?.();
    resources.clear(); nativeHosts.clear(); state.cleanupStatus = 'complete';
    return { status: 'complete', retainedSyntheticFiles: handle.nativeAdapters?.retainedSyntheticFiles?.() ?? [],
      evidence: 'owned services/observers disposed; synthetic files and report retained for review' };
  };
  const preflight = async options => {
    validateStartOptions(options);
    if (!buildInfo) fail('HARNESS_BUILD_IDENTITY_MISSING');
    if (appInstance.plugins.plugins['personal-assistant'] !== plugin) fail('PLUGIN_INSTANCE_CHANGED');
    if (plugin.manifest.version !== options.expectedPluginVersion) fail('PLUGIN_VERSION_MISMATCH');
    const bundlePath = `${appInstance.vault.configDir ?? '.obsidian'}/plugins/personal-assistant/main.js`;
    const bundleSha256 = await hash(await appInstance.vault.adapter.read(bundlePath));
    const harnessSha256 = await hash(await appInstance.vault.adapter.read(options.harnessPath));
    if (bundleSha256 !== options.expectedBundleSha256 || harnessSha256 !== options.expectedHarnessSha256) fail('DEPLOYED_BUNDLE_MISMATCH');
    if (!state.reloadVerified || state.bundleSha256 !== bundleSha256) {
      if (globalThis.__b157PreReloadPlugin === undefined || globalThis.__b157PreReloadPlugin === plugin) fail('PLUGIN_RELOAD_NOT_VERIFIED');
      delete globalThis.__b157PreReloadPlugin;
    }
    Object.assign(state, { reloadVerified: true, bundleSha256, harnessSha256,
      pluginVersion: plugin.manifest.version });
    return { bundleSha256, harnessSha256, pluginVersion: plugin.manifest.version,
      model: { provider: plugin.settings.aiProvider, model: plugin.settings.chatModelName }, status: 'ready_without_dispatch' };
  };
  const makeControl = maximum => {
    const settings = plugin.settings;
    const identity = { provider: settings.aiProvider, model: settings.chatModelName,
      baseURL: settings.baseURL, thinking: Boolean(settings.qwenThinkingEnabled) };
    controller = new AbortController();
    const control = { count: 0, dispatched: 0, maximum, abort: () => controller.abort(),
      onAdmission: count => { state.admittedRequests = count; }, onDispatch: count => { state.physicalRequests = count; },
      assertCurrent() { if (controller.signal.aborted) fail('ABORTED');
        if (plugin.settings.aiProvider !== identity.provider || plugin.settings.chatModelName !== identity.model
          || plugin.settings.baseURL !== identity.baseURL || Boolean(plugin.settings.qwenThinkingEnabled) !== identity.thinking) {
          controller.abort(); fail('MODEL_CHANGED'); } } };
    return { identity, control };
  };
  const handle = { state, fixture: copy(fixture),
    markBeforeReload() { globalThis.__b157PreReloadPlugin = plugin; return { status: 'marked_requires_reload' }; },
    abort() { controller?.abort(); }, cleanup, hasOwnedResources: () => resources.size > 0,
    safeExport() { return copy(state); }, preflight,
    async installNativeAdapters(options) {
      if (activeRun || nativeRestore) fail('ALREADY_RUNNING');
      await preflight(options);
      if (typeof plugin.createChatHost !== 'function') fail('NATIVE_HOST_FACTORY_UNAVAILABLE');
      const { identity, control } = makeControl(options.maxRequests);
      const record = newRecord({ id: 'native-ui', arm: 'candidate', domain: 'four-domains', followup: 'actual-ui-actions' });
      if (!globalThis.indexedDB) fail('NATIVE_INDEXEDDB_UNAVAILABLE');
      const existingHistory = options.existingHistory;
      const nativeIndexedDb = existingHistory === undefined ? globalThis.indexedDB
        : await validateExistingNativeHistory(globalThis.indexedDB, existingHistory);
      const databaseName = existingHistory?.databaseName ?? `b157-context-eval-${crypto.randomUUID()}`;
      const nativeStore = new IndexedDbChatHistoryStore(databaseName, nativeIndexedDb);
      resources.add(nativeStore);
      const manager = await freshManager(nativeStore);
      nativeConversationIds.clear();
      for (const conversation of existingHistory?.conversations ?? []) nativeConversationIds.add(conversation.id);
      nativeHistory = { databaseName, store: nativeStore };
      state.ownedHistoryDatabase = { name: databaseName, isolated: true, retainedForReview: true,
        reconnected: existingHistory !== undefined };
      const scopedApp = boundedNativeApp(appInstance, record);
      const domains = createControlledDomains(scopedApp, manager.store, record, { site: options.recordingGhostSite });
      const integration = new GhostPublishingIntegration({ app: scopedApp, pluginId: 'b157-test-only', vaultPath: 'b157-test-only',
        getSettings: () => ({ siteUrl: domains.ghost.site, defaultVisibility: 'public', profile: {} }),
        saveSettings: async () => fail('SETTINGS_WRITE_BLOCKED'), isCurrent: () => !controller.signal.aborted,
        isPathAllowed: scopedApp.synthetic.allowed, isContentAllowed: path => scopedApp.synthetic.allowed(path),
        isWebAllowed: () => false,
        generateMetadata: async () => ({ customExcerpt: 'Synthetic B157 article.', metaDescription: 'Synthetic B157 article.', slug: 'b157-ui' }) });
      // This is an explicit test-only instance seam. Native scope/session/card
      // and preview gates still execute; no production permission switch exists.
      const configuration = integration.configuration;
      configuration.getIdentity = () => 'b157-recording-connection';
      configuration.connection = async () => ({ siteId: domains.ghost.siteId, siteUrl: domains.ghost.site,
        identity: 'b157-recording-connection', profile: domains.ghost.profile, defaultVisibility: 'public' });
      configuration.getAdminKey = async () => fail('SECRET_ACCESS_BLOCKED');
      integration.controller.runtimes.set(domains.ghost.siteId, domains.ghost);
      const originalFactory = plugin.createChatHost;
      const ownDescriptor = Object.getOwnPropertyDescriptor(plugin, 'createChatHost');
      plugin.createChatHost = function () {
        const originalHost = originalFactory.call(plugin);
        const host = Object.create(originalHost);
        const nativeSettings = {};
        for (const key of ['debug', 'memoryEnabled', 'aiProvider', 'baseURL', 'chatModelName', 'embeddingModelName']) {
          if (originalHost.settings[key] !== undefined) nativeSettings[key] = originalHost.settings[key];
        }
        nativeSettings.operationsAgentEnabled = true;
        nativeSettings.operationsProactiveSaveSuggestionsEnabled = false;
        Object.defineProperties(host, {
          app: { value: scopedApp }, chatHistoryManager: { value: manager },
          settings: { value: nativeSettings }, isOperationsAgentEnabled: { value: true },
          memoryStatus: { value: { getMaintenancePlan: async () => ({ reason: 'ready', action: 'none',
            notesToCheck: 0, requiresApproval: false, canAnswerNow: true }),
            prepareFromCommand: async () => fail('MEMORY_PREPARATION_OUTSIDE_FIXTURE'),
            updateFromCommand: async () => fail('MEMORY_PREPARATION_OUTSIDE_FIXTURE'),
            showTechnicalStatus: () => undefined, onStatusChanged: () => () => undefined } },
          prepareWritingRecoverySources: { value: async () => fail('RECOVERY_OUTSIDE_FIXTURE') },
          onWritingReferencesChanged: { value: () => () => undefined },
          registerOperationsReviewSession: { value: () => undefined },
          invalidateOperationsReviewSession: { value: () => undefined },
          openOperationsReview: { value: undefined },
          openAgentDebug: { value: undefined }, recordAgentDebugTextCommitted: { value: () => undefined },
          imageAssetService: { value: domains.assets }, imageGenerationService: { value: domains.image },
          writingVersions: { value: domains.versions }, writingSave: { value: domains.save },
          prepareWritingStyleForScene: { value: async () => ({ context: '', revisionIds: [], isCurrent: () => true }) },
          readWritingStyleReferences: { value: async () => [] },
          rememberWritingStyle: { value: async () => fail('STYLE_WRITE_OUTSIDE_FIXTURE') },
          prepareFeaturedImagePrompt: { value: async () => fail('FEATURED_IMAGE_OUTSIDE_FIXTURE') },
          confirmFeaturedImageTextPreparationFirstUse: { value: async () => fail('FEATURED_IMAGE_OUTSIDE_FIXTURE') },
          confirmImageGenerationFirstUse: { value: async () => {
            const approved = await confirmUserAction(scopedApp, { title: 'B157 合成图片确认',
              message: '本次只调用录制图片端口，无图片付费请求。确认仅在此评测实例有效。', confirmText: '确认' });
            record.confirmations.push({ domain: 'image', boundary: 'actual-native-modal', approved });
            return approved;
          } },
          captureImageGenerationConnection: { value: () => domains.connection },
          createGhostPublishingBinding: { value: request => integration.createBinding(request) },
          readGhostContextReceipt: { value: id => integration.readContextReceipt(id) },
          clearGhostContextPersistence: { value: id => integration.clearContextPersistence(id) },
          scheduleMemoryExtractionAfterChatTurn: { value: () => undefined },
          createChatService: { value: () => {
            const service = isolatedChatService(plugin, scopedApp, identity, record, control);
            const streamLLM = service.streamLLM.bind(service);
            service.streamLLM = async (prompt, chunk, signal, history, options = {}) => {
              const lifecycle = lifecycleRecorder();
              if (options.conversationId) nativeConversationIds.add(options.conversationId);
              const wrapped = { ...options,
                onLifecycleEvent: event => { lifecycle.observe(event); options.onLifecycleEvent?.(event); },
                onCommittedFinalText: text => { lifecycle.commit(text); options.onCommittedFinalText?.(text); } };
              try { return await streamLLM(prompt, chunk, signal, history, wrapped); }
              finally { record.turns.push({ userText: options.userText ?? prompt, events: lifecycle.events,
                ...(lifecycle.events.some(event => event.type === 'agent_start')
                  ? { canonical: lifecycle.canonical() } : { canonicalUnavailable: true }),
                providerInputEnd: record.providerInputs.length }); }
            };
            resources.add(service); return service;
          } },
        });
        nativeHosts.add(host);
        return host;
      };
      nativeRestore = () => {
        if (ownDescriptor) Object.defineProperty(plugin, 'createChatHost', ownDescriptor);
        else delete plugin.createChatHost;
        state.uiAdapterStatus = 'removed_close_owned_chat_views';
      };
      resources.add(integration); resources.add(domains);
      state.results.push(record); state.model = { provider: identity.provider, model: identity.model };
      state.uiAdapterStatus = 'installed_requires_new_chat_view';
      state.uiEvidenceBoundary = 'real ChatView and domain events are observable; native Ghost preview remains required and is never mocked';
      handle.nativeAdapters = {
        releaseImage: () => domains.releaseImage(),
        readGhostPreviewMaterial: operationId => domains.ghost.readPreviewMaterial(operationId),
        setImageUnknown: () => fail('SELECT_UNKNOWN_EPISODE_BEFORE_SUBMISSION'),
        setGhostUnknown: value => domains.ghost.setUnknown(Boolean(value)),
        async publishGhostRecordingRemote(operationId) {
          const operation = await domains.ghost.operations.findForContext(domains.ghost.siteId, operationId);
          if (!operation?.target.previewId) fail('GHOST_RECORDING_POST_MISSING');
          domains.ghost.publishRecordingRemote(operation.target.previewId);
        },
        async prepareSyntheticNotes() {
          for (const [path, text] of [[`${PREFIX}source.md`, '# 合成银杏\n\n仅用于 B157 原生评测。\n'],
            [`${PREFIX}new-source.md`, '# 合成枫树\n\n第二个合成任务。\n']]) {
            if (appInstance.vault.getAbstractFileByPath(path)) fail('NATIVE_FIXTURE_ALREADY_EXISTS');
            if (!appInstance.vault.getAbstractFileByPath(PREFIX.slice(0, -1))) await scopedApp.vault.createFolder(PREFIX.slice(0, -1));
            await scopedApp.vault.create(path, text);
          }
        },
        retainedSyntheticFiles: () => [...scopedApp.synthetic.ownedPaths],
        async deleteOwnedHistoryDatabase() {
          if (nativeRestore || resources.size > 0 || state.cleanupStatus !== 'complete') fail('CLEANUP_BEFORE_DATABASE_DELETE');
          if (!nativeHistory || nativeHistory.databaseName !== databaseName) fail('OWNED_DATABASE_MISMATCH');
          await new Promise((resolve, reject) => {
            const request = globalThis.indexedDB.deleteDatabase(databaseName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error('B157_DATABASE_DELETE_FAILED'));
            request.onblocked = () => reject(new Error('B157_DATABASE_DELETE_BLOCKED'));
          });
          state.ownedHistoryDatabase.retainedForReview = false;
          return { status: 'deleted', databaseName };
        },
        async status() {
          const conversations = await manager.store.listConversations();
          for (const conversation of conversations) nativeConversationIds.add(conversation.id);
          const persistedTurns = [];
          for (const id of nativeConversationIds) persistedTurns.push(...await manager.store.getTurns(id));
          return { physicalRequests: control.dispatched, admittedRequests: control.count,
            maximum: control.maximum, historyDatabase: databaseName,
            existingHistory: { databaseName, conversations: conversations.map(({ id, turnCount }) => ({ id, turnCount })) },
            record: copy(record), persistedTurns: copy(persistedTurns), retainedSyntheticFiles: [...scopedApp.synthetic.ownedPaths] };
        },
      };
      return { status: state.uiAdapterStatus, preview: 'unverified_requires_native_preview',
        startup: 'no_provider_dispatch; create a new Chat view to use the controlled host' };
    },
    async start(options) {
      validateStartOptions(options);
      if (activeRun || nativeRestore) fail('ALREADY_RUNNING');
      const { bundleSha256, harnessSha256 } = await preflight(options);
      const { identity, control } = makeControl(options.maxRequests);
      Object.assign(state, { status: 'running', model: { provider: identity.provider, model: identity.model },
        summaryOnly: options.summaryOnly === true,
        maxRequests: options.maxRequests, physicalRequests: 0, bundleSha256, harnessSha256,
        pluginVersion: plugin.manifest.version, results: [], startedAt: new Date().toISOString(), error: null });
      activeRun = (async () => {
        try {
          for (const item of options.summaryOnly ? [] : episodeSchedule(options.caseIds, options.arms)) {
            control.assertCurrent();
            await runEpisode({ item, plugin, identity, control, resources, state, signal: controller.signal });
          }
          if (options.summaryUpdates !== false) await runSummaryUpdates({ plugin, identity, control,
            resources, state, signal: controller.signal });
          state.status = 'recorded_for_review';
        } catch (error) { state.error = errorCode(error); state.status = controller.signal.aborted ? 'aborted' : 'failed'; }
        finally { state.physicalRequests = control.dispatched; state.admittedRequests = control.count;
          state.completedAt = new Date().toISOString();
          for (const resource of resources) await resource.dispose?.(); resources.clear(); activeRun = undefined; }
        return handle.safeExport();
      })();
      return activeRun;
    },
  };
  globalThis.__b157ContextEval = handle;
  return handle;
}

if (typeof globalThis.app !== 'undefined') installB157ContextEval(globalThis.app);
