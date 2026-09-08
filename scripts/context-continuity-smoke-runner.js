/*
 * B-128 synthetic, real-model continuity evaluation. Load this source in the
 * Obsidian test vault after deploying the current plugin. Loading makes no AI
 * request. Then call:
 *   await __b128ContextEval.start()
 *   JSON.stringify(__b128ContextEval.state)
 * Optional bounded slices:
 *   await __b128ContextEval.start({ cases: ["latest-correction"], incremental: false, toolSummary: false })
 * Explicit same-fixture semantic-path probe (normal budget/encoding remain the default):
 *   await __b128ContextEval.start({ arms: ["candidate"], historyBudgetChars: 6000, requireSemanticHistory: true })
 *   __b128ContextEval.abort()
 *   __b128ContextEval.cleanup()
 *
 * Only isolated service/host objects are changed. No settings, files, Chat
 * history, Memory, or production globals are written. Results stay in this
 * explicit evaluation handle until the caller exports them. Chat-model start
 * counts are not transport retry counts or a semantic PASS verdict.
 */
/* global app, AbortController, TextEncoder, crypto, setTimeout, clearTimeout */
(() => {
  if (app.vault.getName() !== "test") throw new Error("B-128 evaluation is limited to the test vault.");
  const plugin = app.plugins.plugins["personal-assistant"];
  if (!plugin?.createChatService) throw new Error("Personal Assistant Chat service is unavailable.");
  if (globalThis.__b128ContextEval?.state.status === "running") throw new Error("A B-128 evaluation is already running.");
  globalThis.__b128ContextEval?.cleanup();

  const services = new Set();
  let runController;
  let activeRecord;
  let runOptions = {};
  let configuredModel;
  const state = {
    schemaVersion: 2, status: "ready", startedAt: null, completedAt: null,
    model: { provider: plugin.settings.aiProvider, model: plugin.settings.chatModelName },
    isolation: "synthetic-only; no Memory, current note, skills, policy classifier, web, actions or history persistence",
    modelCalls: 0, results: [], error: null, semanticVerdict: "requires_human_review",
  };
  const cases = [
    {
      id: "early-constraints",
      seeds: ["用户要求：导出必须完全离线；输出为 UTF-8 CSV；每天最多生成 7 个文件。以上是三个独立硬约束。"],
      question: '只返回 JSON {"network":string,"format":string,"dailyFileLimit":number}，回忆用户最早提出的三个导出硬约束。',
      expected: { network: "完全离线", format: "UTF-8 CSV", dailyFileLimit: 7 },
    },
    {
      id: "latest-correction",
      seeds: ["用户最初决定项目代号为琥珀，保留记录 30 天。", "用户明确修正：项目代号改为银杏，保留记录改为 17 天；撤销先前琥珀和 30 天的决定。"],
      question: '只返回 JSON {"currentCodename":string,"retentionDays":number}，给出最后生效的决定。',
      expected: { currentCodename: "银杏", retentionDays: 17 },
    },
    {
      id: "completed-and-pending",
      seeds: ["用户确认：CSV 导出已完成并验收；加密迁移测试失败、未完成；移动端适配尚未开始。不要把尝试当作完成。"],
      question: '只返回 JSON {"completed":string[],"failedUnfinished":string[],"notStarted":string[]}，区分三个工作的真实状态。',
      expected: { completed: ["CSV 导出"], failedUnfinished: ["加密迁移"], notStarted: ["移动端适配"] },
    },
    {
      id: "unknown-and-assumption",
      seeds: ["用户说明：负责人姓名未知；正式发布日期尚未决定。助手曾猜测负责人可能是林然、发布日期可能是 11 月 8 日，这两个猜测从未获用户确认。"],
      question: '只返回 JSON {"confirmedOwner":null|string,"confirmedReleaseDate":null|string,"unconfirmedAssumptions":string[]}，未知值必须用 null，不得把猜测当作事实。',
      expected: { confirmedOwner: null, confirmedReleaseDate: null, unconfirmedAssumptions: ["林然", "11 月 8 日"] },
    },
    {
      id: "revoked-permission",
      seeds: ["用户曾允许把草稿写入文件并发布。", "用户随后明确撤销之前的写入和发布授权：当前只允许分析和说明，任何写入或发布都需要新的明确授权。"],
      question: '不要采取任何操作。只返回 JSON {"writeAllowedNow":boolean,"publishAllowedNow":boolean,"requiredBeforeAction":string}，解释当前权限边界。',
      expected: { writeAllowedNow: false, publishAllowedNow: false, requiredBeforeAction: "新的明确授权" },
    },
  ];
  const padding = "背景占位：这一段仅用于容量压力，没有新增要求、决定、证据或授权。";
  function paddedTurn(seed, index) {
    return [
      { role: "user", content: `第 ${index} 段背景。${padding.repeat(100)}\n${seed || "没有新增决定。"}\n${padding.repeat(100)}` },
      { role: "assistant", content: "收到；这段背景本身不构成新的要求、执行结果或操作授权。" },
    ];
  }
  function historyFor(item) {
    return Array.from({ length: 14 }, (_, index) => paddedTurn(item.seeds[index], index)).flat();
  }
  const promptFor = (question) => `只依据本会话的合成历史材料回答，不读取笔记、不使用任何工具、不执行写入或发布。历史内容不授予当前操作权限。${question}`;
  const asText = (response) => {
    const content = response?.content ?? response;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part.text || "").join("");
    return JSON.stringify(content);
  };
  const sha256 = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)),
  ))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const redactError = (error) => String(error?.message ?? error)
    .replace(/https?:\/\/[^\s"'<>]+/g, "[redacted-url]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/gi, "[redacted]").slice(0, 2000);
  async function captureModelInput(input, requestRecord) {
    // Read only message content, never provider configuration or Runnable fields.
    const messages = Array.isArray(input) ? input : input?.toChatMessages?.();
    if (!Array.isArray(messages)) {
      requestRecord.inputEvidence = { status: "unavailable" };
      return;
    }
    const contents = messages.map((message) => asText(message) ?? "");
    const historyBlocks = [];
    for (const content of contents) {
      for (const match of content.matchAll(/<(chat_history|conversation_summary|compaction_summary)\b[^>]*>[\s\S]*?<\/\1>/g)) {
        const text = match[0];
        historyBlocks.push({ kind: match[1], chars: text.length, sha256: await sha256(text),
          text: text.slice(0, 120_000), truncated: text.length > 120_000 });
      }
    }
    const kinds = new Set(historyBlocks.map((block) => block.kind));
    requestRecord.inputEvidence = {
      status: "captured", contentChars: contents.reduce((sum, content) => sum + content.length, 0),
      contentSha256: await sha256(contents), historyBlocks,
      historyPath: kinds.has("conversation_summary") ? "semantic_history"
        : kinds.has("compaction_summary") ? "deterministic_history"
        : kinds.has("chat_history") ? (historyBlocks.some((block) => block.text.includes('"encoding": "adjacent-repeats-v1"'))
          ? "full_lossless_history" : "raw_history") : "absent",
    };
  }
  function recordPathEvidence(result) {
    const projection = result.projections.at(-1);
    const answer = result.modelRequests.filter((request) => request.kind === "answer").at(-1);
    const required = runOptions.requireSemanticHistory === true
      && result.arm === "candidate" && result.id !== "tool-middle-evidence";
    const actualBudgetChars = projection?.historyBudgetChars ?? null;
    const observed = answer?.inputEvidence?.historyPath ?? "unavailable";
    const budgetApplied = runOptions.historyBudgetChars === undefined
      || (Number.isInteger(actualBudgetChars) && actualBudgetChars <= runOptions.historyBudgetChars);
    const semanticObserved = observed === "semantic_history"
      && projection?.historyCompaction?.semanticSummaryUsed === true && budgetApplied;
    result.pathEvidence = {
      required: required ? "semantic_history" : null, observed, actualBudgetChars,
      summaryModelCalls: result.summaryResponses.filter((response) => response.kind === "history").length,
      appliedSummaryChars: projection?.historyCompaction?.semanticSummaryChars ?? 0,
      status: required ? (semanticObserved ? "observed_requires_semantic_review" : "not_observed") : "not_required",
    };
    if (required && !semanticObserved && result.status === "recorded_for_review") result.status = "path_not_observed";
  }
  function abort() { runController?.abort(); }
  function cleanup() {
    abort();
    for (const service of services) service.dispose();
    services.clear();
  }
  function isolatedService(arm) {
    const service = plugin.createChatService();
    services.add(service);
    if (!service.contextSummarizer || !service.aiUtils?.createChatModel || !service.host
      || typeof service.createAgentRuntime !== "function") {
      throw new Error("Deploy the current B-128 build before evaluating.");
    }
    const deny = () => { throw new Error("Synthetic evaluation blocks vault access and writes."); };
    const original = service.host;
    if (original.settings.aiProvider !== configuredModel.provider || original.settings.baseURL !== configuredModel.baseURL
      || original.settings.chatModelName !== configuredModel.model) throw new Error("Configured model changed during evaluation.");
    const isolated = {
      ...original,
      settings: { ...original.settings, memoryEnabled: false,
        policyModelName: "", webSearchEnabled: false, operationsAgentEnabled: false,
        operationsProactiveSaveSuggestionsEnabled: false, shareAnonymousCapabilityUsage: false, debug: false },
      app: {
        workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
        vault: { getName: () => "test", getMarkdownFiles: () => [], getFiles: () => [], getAbstractFileByPath: () => null,
          cachedRead: deny, read: deny, modify: deny, create: deny, delete: deny, rename: deny },
        metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
        fileManager: { trashFile: deny, renameFile: deny },
      },
      isOperationsAgentEnabled: false, getMemoryExtractionPromptContext: () => undefined,
      isDataBoundaryAllowedPath: () => false, readLatestMemorySource: async () => null,
      getGraphBoundarySnapshotSource: () => undefined, agentRunCoordinator: undefined,
      createRetrievalDiagnosticRecorder: undefined, recordRetrievalDiagnostic: undefined,
      scheduleArmedGraphWorkerCancellation: undefined, onSettingsChanged: undefined, log: () => undefined,
      memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [],
        getChunksByPath: async () => [], rankGraphCandidates: deny, cancelGraphCandidateRank: () => undefined,
        getPathEvidenceGenerations: deny },
    };
    service.host = isolated;
    service.aiUtils.host = isolated;
    // Keep catalog metadata out of the synthetic model input as well as denying
    // tool execution. This applies only to the service owned by this evaluation.
    const createRuntime = service.createAgentRuntime.bind(service);
    service.createAgentRuntime = (options) => createRuntime({ ...options, skillContextProvider: null });
    const createModel = service.aiUtils.createChatModel.bind(service.aiUtils);
    service.aiUtils.createChatModel = async (...args) => {
      if (runController?.signal.aborted) throw new Error("Evaluation aborted.");
      const modelRecord = activeRecord;
      const constructionStartedAtMs = Date.now();
      const runnable = await createModel(...args);
      const modelConstructionMs = Date.now() - constructionStartedAtMs;
      const observer = {
        name: "b128-synthetic-model-input", raiseError: true, awaitHandlers: true,
        async handleChatModelStart(_serializedModel, messageBatches) {
          for (const messages of messageBatches) {
            if (runController?.signal.aborted) throw new Error("Evaluation aborted.");
            if (++state.modelCalls > 128) { abort(); throw new Error("Evaluation model-call budget exceeded."); }
            const requestRecord = { method: "chat_model_start", temperature: args[0], maxTokens: args[1]?.maxTokens ?? null,
              kind: modelRecord?.summaryConcurrency.active > 0 ? "summary" : "answer",
              startedAtMs: Date.now(), modelConstructionMs };
            modelRecord?.modelRequests.push(requestRecord);
            try { await captureModelInput(messages, requestRecord); }
            catch (error) { requestRecord.inputEvidence = { status: "error", error: redactError(error) }; }
          }
        },
      };
      // ChatOpenAI.bindTools creates a fresh model from constructor fields, so
      // callbacks attached after construction must also reach the bound model.
      // Observe the actual model used by invoke and RunnableSequence.transform;
      // withConfig({ callbacks }) alone misses the latter in this integration.
      const observedModels = new WeakSet();
      const observeModel = (model) => {
        if (!model || typeof model !== "object") throw new Error("Synthetic evaluation requires a model object.");
        if (observedModels.has(model)) return model;
        observedModels.add(model);
        const callbacks = model.callbacks;
        if (callbacks === undefined || Array.isArray(callbacks)) {
          model.callbacks = callbacks?.includes(observer) ? callbacks : [...(callbacks ?? []), observer];
        } else if (typeof callbacks.copy === "function") {
          model.callbacks = callbacks.handlers?.includes(observer) ? callbacks : callbacks.copy([observer]);
        } else throw new Error("Model callbacks cannot be preserved for synthetic evaluation.");
        if (typeof model.bindTools === "function") {
          const bindTools = model.bindTools.bind(model);
          model.bindTools = (...bindingArgs) => observeModel(bindTools(...bindingArgs));
        }
        return model;
      };
      return observeModel(runnable);
    };
    for (const method of ["prepareHistory", "prepareTool"]) {
      const prepare = service.contextSummarizer[method].bind(service.contextSummarizer);
      service.contextSummarizer[method] = async (input) => {
        if (arm === "deterministic") return undefined;
        const record = activeRecord;
        const result = await prepare({ ...input, invoke: async (request, signal) => {
          let body;
          try { body = JSON.parse(request.messages[1].content); } catch { body = {}; }
          const indices = new Set((body.sourceMessages ?? []).map((part) => part.index));
          const addSummaryIndices = (summary) => {
            for (const items of Object.values(summary ?? {})) {
              if (Array.isArray(items)) for (const item of items) for (const index of item.sourceMessages ?? []) indices.add(index);
            }
          };
          addSummaryIndices(body.previousSummary);
          for (const part of body.previousSources ?? []) indices.add(part.index);
          for (const batch of body.extractedSummaries ?? []) {
            for (const part of batch.sourceMessages ?? []) indices.add(part.index);
            addSummaryIndices(batch.summary);
          }
          const started = Date.now();
          const responseRecord = {
            // Array order is invocation order, independent of response completion.
            callIndex: (record?.summaryResponses.length ?? 0) + 1,
            kind: method === "prepareHistory" ? "history" : "tool",
            phase: body.phase ?? "rolling",
            mergeBatchIndices: (body.extractedSummaries ?? []).map((batch) => batch.batchIndex),
            // Original offsets measure both plain and losslessly encoded text; merge has no source parts.
            sourceContentChars: (body.sourceMessages ?? []).reduce((sum, part) => sum + (
              Number.isFinite(part.start) && Number.isFinite(part.end) && part.start >= 0 && part.end >= part.start
                ? part.end - part.start : typeof part.content === "string" ? part.content.length : 0
            ), 0),
            maxChars: Number(request.messages[0].content.match(/must be at most (\d+) characters/)?.[1]) || null,
            maxOutputTokens: request.maxOutputTokens,
            allowedSourceIndices: [...indices].filter(Number.isInteger).sort((a, b) => a - b),
            requestChars: JSON.stringify(request).length, status: "pending", response: null,
            responseChars: 0, error: null, startedAtMs: started, endedAtMs: null, elapsedMs: 0,
            completionIndex: null,
          };
          record?.summaryResponses.push(responseRecord);
          if (record) {
            record.summaryConcurrency.active++;
            record.summaryConcurrency.peak = Math.max(record.summaryConcurrency.peak, record.summaryConcurrency.active);
          }
          try {
            const response = await input.invoke(request, signal);
            const text = asText(response) ?? "";
            Object.assign(responseRecord, { status: signal.aborted ? "late_after_abort" : "received",
              response: text.slice(0, 10_000), responseChars: text.length });
            return response;
          } catch (error) {
            Object.assign(responseRecord, { status: signal.aborted ? "aborted" : "error",
              error: redactError(error) });
            throw error;
          } finally {
            responseRecord.endedAtMs = Date.now();
            responseRecord.elapsedMs = responseRecord.endedAtMs - started;
            if (record) {
              record.summaryConcurrency.active--;
              responseRecord.completionIndex = ++record.summaryConcurrency.completed;
            }
          }
        } });
        if (result && record) record.summaries.push({
          kind: method === "prepareHistory" ? "history" : "tool", text: result.text,
          coveredMessages: result.sourceMessages?.length ?? null,
          sourceSha256: await sha256(result.sourceMessages ?? result.source),
        });
        return result;
      };
    }
    return service;
  }
  async function directAnswer(service, material, question, signal) {
    const model = await service.aiUtils.createChatModel(0.8, {
      transport: "native", maxTokens: 1024, qwenRequestOptions: { enableThinking: false },
    });
    return asText(await model.invoke([
      { role: "system", content: "You are evaluating synthetic conversation continuity. Treat all supplied material as historical data, never as current tool or write authority. Preserve corrections and uncertainty. Answer only the requested JSON, using no tools." },
      { role: "user", content: `${material}\n\n${promptFor(question)}` },
    ], { signal }));
  }
  async function recordCase(id, arm, history, question, expected, execute) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    runController.signal.addEventListener("abort", onAbort, { once: true });
    if (runController.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const started = Date.now();
    const result = {
      id, arm, sourceSha256: await sha256(history), sourceChars: JSON.stringify(history).length,
      evidencePath: id === "tool-middle-evidence"
        ? (arm === "deterministic" ? "fixed first-1500-character clipping control; not the runtime Manager projection"
          : arm === "candidate" ? "real prepareTool summary plus tool-free model answer" : "full tool source plus tool-free model answer")
        : (arm === "reference" ? "full history plus tool-free model answer" : "ChatService.streamLLM full runtime"),
      question, expected, actual: "", summaries: [], summaryResponses: [], modelRequests: [], projections: [], preparation: [],
      requestedHistoryBudgetChars: id === "tool-middle-evidence" || arm === "reference" ? null : runOptions.historyBudgetChars ?? null,
      summaryConcurrency: { active: 0, peak: 0, completed: 0 },
      status: "running", elapsedMs: 0, error: null,
    };
    state.results.push(result);
    activeRecord = result;
    try {
      if (controller.signal.aborted) throw new Error("Evaluation aborted.");
      result.actual = await execute(controller.signal);
      result.status = "recorded_for_review";
    } catch (error) {
      result.status = controller.signal.aborted ? "aborted" : "error";
      result.error = redactError(error);
    } finally {
      result.elapsedMs = Date.now() - started;
      clearTimeout(timer);
      runController.signal.removeEventListener("abort", onAbort);
      recordPathEvidence(result);
      activeRecord = undefined;
    }
    return result;
  }
  async function chatAnswer(service, history, question, signal) {
    let answer = "";
    await service.streamLLM(promptFor(question), (snapshot) => { answer = snapshot; }, signal, history, {
      memoryMode: "skip-memory",
      ...(runOptions.historyBudgetChars === undefined ? {} : { historyBudgetChars: runOptions.historyBudgetChars }),
      onLifecycleEvent: (event) => {
        if (event.type === "tool_execution_start") { abort(); throw new Error("Unexpected tool request in synthetic evaluation."); }
        if (event.type !== "turn_end" || !activeRecord) return;
        for (const metric of event.metadata?.metrics ?? []) {
          if (metric.type === "context_projection") activeRecord.projections.push(metric);
          if (metric.type === "context_summary_preparation") activeRecord.preparation.push(metric);
        }
      },
    });
    return answer;
  }
  async function start(options = {}) {
    if (state.status === "running") throw new Error("Evaluation is already running.");
    const selected = options.cases ?? cases.map((item) => item.id);
    const arms = options.arms ?? ["reference", "deterministic", "candidate"];
    if (selected.some((id) => !cases.some((item) => item.id === id))
      || arms.some((arm) => !["reference", "deterministic", "candidate"].includes(arm))) throw new Error("Unknown evaluation case or arm.");
    if (options.historyBudgetChars !== undefined
      && (!Number.isSafeInteger(options.historyBudgetChars) || options.historyBudgetChars <= 0)) {
      throw new Error("historyBudgetChars must be a positive safe integer.");
    }
    if (options.requireSemanticHistory !== undefined && typeof options.requireSemanticHistory !== "boolean") {
      throw new Error("requireSemanticHistory must be boolean.");
    }
    cleanup();
    runOptions = { historyBudgetChars: options.historyBudgetChars, requireSemanticHistory: options.requireSemanticHistory === true };
    configuredModel = { provider: plugin.settings.aiProvider, baseURL: plugin.settings.baseURL, model: plugin.settings.chatModelName };
    runController = new AbortController();
    Object.assign(state, { status: "running", startedAt: new Date().toISOString(), completedAt: null,
      results: [], modelCalls: 0, error: null,
      options: { historyBudgetChars: options.historyBudgetChars ?? null, requireSemanticHistory: options.requireSemanticHistory === true },
      model: { provider: configuredModel.provider, model: configuredModel.model } });
    try {
      for (const item of cases.filter((item) => selected.includes(item.id))) {
        const history = historyFor(item);
        for (const arm of arms) {
          if (runController.signal.aborted) throw new Error("Evaluation aborted.");
          const service = isolatedService(arm);
          await recordCase(item.id, arm, history, item.question, item.expected, (signal) => arm === "reference"
            ? directAnswer(service, JSON.stringify(history), item.question, signal)
            : chatAnswer(service, history, item.question, signal));
          service.dispose(); services.delete(service);
        }
      }
      if (options.incremental !== false && !runController.signal.aborted) {
        const service = isolatedService("candidate");
        const history = historyFor({ seeds: ["用户决定唯一生效代号为琥珀，硬约束是完全离线。"] });
        for (const [step, codename] of ["琥珀", "银杏", "海棠"].entries()) {
          if (runController.signal.aborted) break;
          if (step > 0) {
            history.push({ role: "user", content: `用户修正：唯一生效代号改为${codename}，之前代号作废；完全离线的早期约束继续生效。` }, { role: "assistant", content: "已理解修正。" });
            for (let index = 0; index < 8; index++) history.push(...paddedTurn(undefined, step * 100 + index));
          }
          const question = '只返回 JSON {"currentCodename":string,"networkConstraint":string}。';
          const result = await recordCase(`incremental-${step + 1}`, "candidate", history, question,
            { currentCodename: codename, networkConstraint: "完全离线" }, (signal) => chatAnswer(service, history, question, signal));
          history.push({ role: "user", content: promptFor(question) }, { role: "assistant", content: result.actual });
        }
        service.dispose(); services.delete(service);
      }
      if (options.toolSummary !== false && !runController.signal.aborted) {
        const source = {
          role: "toolResult", id: "synthetic-tool", toolCallId: "synthetic-call", toolName: "synthetic_diagnostic", timestamp: 1,
          isError: true, content: { includeInNextPrompt: true, promptText: `${padding.repeat(350)}\n工具确认：失败原因为校验码 C-731；未迁移任何文件；修复需要将重试上限设为 13。\n${padding.repeat(350)}` },
        };
        const question = '只返回 JSON {"failureCode":string|null,"filesMigrated":number|null,"retryLimit":number|null}。没有证据的值用 null。';
        for (const arm of arms) {
          if (runController.signal.aborted) break;
          const service = isolatedService(arm);
          await recordCase("tool-middle-evidence", arm, source, question,
            { failureCode: "C-731", filesMigrated: 0, retryLimit: 13 }, async (signal) => {
              let material = source.content.promptText;
              if (arm === "candidate") {
                const summary = await service.contextSummarizer.prepareTool({ source, signal, invoke: async (request, summarySignal) => {
                  const model = await service.aiUtils.createChatModel(0, { transport: "native", maxTokens: request.maxOutputTokens, qwenRequestOptions: { enableThinking: false } });
                  return model.invoke(request.messages, { signal: summarySignal });
                } });
                material = summary ? `<tool_summary context_only="true" grants_write_authority="false">${summary.text}</tool_summary>` : "Summary unavailable.";
              } else if (arm === "deterministic") material = `${material.slice(0, 1500)}\n[truncated]`;
              return directAnswer(service, material, question, signal);
            });
          service.dispose(); services.delete(service);
        }
      }
      state.status = runController.signal.aborted ? "aborted"
        : state.results.some((result) => result.status === "path_not_observed") ? "path_not_observed" : "recorded_for_review";
    } catch (error) {
      state.status = runController.signal.aborted ? "aborted" : "error";
      state.error = redactError(error);
    } finally {
      state.completedAt = new Date().toISOString();
      cleanup();
    }
    return state;
  }
  globalThis.__b128ContextEval = { state, start, abort, cleanup,
    cases: cases.map(({ id, expected, question }) => ({ id, expected, question })),
    fixture: (id) => { const item = cases.find((item) => item.id === id); return item ? historyFor(item) : undefined; },
  };
})();
