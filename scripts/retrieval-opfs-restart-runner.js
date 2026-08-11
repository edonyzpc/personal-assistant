/*
 * B-125 desktop OPFS full-app restart evidence recorder.
 *
 * Copy this file to the root of the isolated test vault, then run it from the
 * Obsidian desktop DevTools console before and after a complete app restart:
 *
 *   eval(await app.vault.adapter.read("retrieval-opfs-restart-runner.js"))
 *   await paRetrievalOpfsRestart.captureBefore({ operatorConfirmed: true })
 *   // Fully quit Obsidian, relaunch it, and reopen the same vault.
 *   eval(await app.vault.adapter.read("retrieval-opfs-restart-runner.js"))
 *   await paRetrievalOpfsRestart.captureAfter({ operatorConfirmed: true })
 *
 * The runner reads only content-free VSS stats, its own artifact, the loaded
 * plugin artifact, and its derived baseline. It writes only derived JSON
 * evidence. It does not call a provider, prepare/update/rebuild Memory, or
 * mutate Markdown. The no-maintenance window remains an explicit operator
 * assertion; stable marker-like fields corroborate it but cannot prove that no
 * unobserved operation occurred.
 */
/* global app, console, crypto, navigator, performance, process, TextEncoder */
(async () => {
  const SCHEMA_VERSION = 1;
  const RECEIPT_TYPE = "personal-assistant-retrieval-opfs-restart";
  const PLUGIN_ID = "personal-assistant";
  const RUNNER_PATH = "retrieval-opfs-restart-runner.js";
  const BASELINE_PATH = "retrieval-opfs-restart-baseline.json";
  const RECEIPT_PATH = "retrieval-opfs-restart-receipt.json";
  const EXPECTED_BACKEND = "sqlite-wasm-opfs-sahpool";
  const MAX_EVIDENCE_WINDOW_MS = 15 * 60 * 1_000;
  const SUPPORTED_DESKTOP_PLATFORMS = new Set(["darwin", "win32", "linux"]);
  const BEFORE_ASSERTION_ID = "full-app-restart-window-before-v1";
  const AFTER_ASSERTION_ID = "full-app-restart-window-after-v1";
  const BEFORE_ASSERTION = "Operator plans to fully quit and relaunch the same Obsidian desktop app and vault, then run captureAfter without intentionally invoking Memory prepare, update, rebuild, provider-backed retrieval, a plugin-reload-only shortcut, artifact replacement, or Markdown/source mutation in the evidence window.";
  const AFTER_ASSERTION = "Operator confirms that the evidence window contained a full quit and relaunch of the same Obsidian desktop app and vault, followed by captureAfter, without intentionally invoking Memory prepare, update, rebuild, provider-backed retrieval, a plugin-reload-only shortcut, artifact replacement, or Markdown/source mutation.";
  const LIMITATIONS = Object.freeze([
    "The runner cannot independently observe every action between the two captures.",
    "The no-maintenance window is operator-attested; stable marker-like fields are corroborating evidence, not proof of absence.",
    "Electron main-process launch identity is bound to renderer process.ppid inside a short evidence window; it is process-tree evidence, not a cryptographic host attestation.",
  ]);

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const canonicalJson = (value) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  };

  const digest = async (value) => {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const isSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const isSafeVersion = (value) => (
    typeof value === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u.test(value)
  );
  const isSafeRuntimeToken = (value) => (
    typeof value === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u.test(value)
  );
  const isIsoTimestamp = (value) => {
    if (typeof value !== "string") return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  };
  const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
  const isFinitePositive = (value) => Number.isFinite(value) && value > 0;
  const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
  const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

  const createIssue = (code, status) => ({ code, status });
  const overallStatus = (issues) => (
    issues.some((entry) => entry.status === "FAIL")
      ? "FAIL"
      : issues.some((entry) => entry.status === "BLOCKED")
        ? "BLOCKED"
        : "PASS"
  );

  const addRequiredValueCheck = (issues, value, predicate, missingCode, invalidCode) => {
    if (value === undefined || value === null || value === "") {
      issues.push(createIssue(missingCode, "BLOCKED"));
      return false;
    }
    if (!predicate(value)) {
      issues.push(createIssue(invalidCode, "FAIL"));
      return false;
    }
    return true;
  };

  const attachEvidenceDigest = async (document) => {
    const payload = clone(document);
    delete payload.evidenceSha256;
    return {
      ...payload,
      evidenceSha256: await digest(canonicalJson(payload)),
    };
  };

  const hasValidEvidenceDigest = async (document) => {
    if (!document || !isSha256(document.evidenceSha256)) return false;
    const payload = clone(document);
    const expected = payload.evidenceSha256;
    delete payload.evidenceSha256;
    return expected === await digest(canonicalJson(payload));
  };

  const shellVersionFromUserAgent = (userAgent) => (
    userAgent.match(/(?:^|[\s;(])obsidian\/([0-9A-Za-z][0-9A-Za-z._+-]*)/iu)?.[1] ?? null
  );

  const electronVersionFromUserAgent = (userAgent) => (
    userAgent.match(/(?:^|[\s;(])electron\/([0-9A-Za-z][0-9A-Za-z._+-]*)/iu)?.[1] ?? null
  );

  const captureRuntimeIdentity = (plugin, issues) => {
    let formalIdentity = null;
    try {
      formalIdentity = typeof plugin?.getObsidianRuntimeIdentity === "function"
        ? plugin.getObsidianRuntimeIdentity()
        : null;
    } catch {
      issues.push(createIssue("runtime_identity_seam_unavailable", "BLOCKED"));
    }

    const loadedAppVersion = formalIdentity?.loadedAppVersion ?? null;
    const loadedAppVersionSource = formalIdentity?.loadedAppVersionSource ?? null;
    const userAgent = typeof navigator?.userAgent === "string" ? navigator.userAgent : "";
    const shellVersion = shellVersionFromUserAgent(userAgent);
    const userAgentElectronVersion = electronVersionFromUserAgent(userAgent);
    const electronVersion = typeof process !== "undefined"
      ? process?.versions?.electron ?? null
      : null;
    const platform = typeof process !== "undefined" ? process?.platform ?? null : null;
    const arch = typeof process !== "undefined" ? process?.arch ?? null : null;
    const processType = typeof process !== "undefined" ? process?.type ?? null : null;
    const pid = typeof process !== "undefined" ? process?.pid ?? null : null;
    const mainProcessPid = typeof process !== "undefined" ? process?.ppid ?? null : null;
    const timeOrigin = typeof performance !== "undefined" ? performance?.timeOrigin ?? null : null;

    addRequiredValueCheck(
      issues,
      loadedAppVersion,
      isSafeVersion,
      "app_version_missing",
      "app_version_invalid",
    );
    if (loadedAppVersionSource === undefined || loadedAppVersionSource === null) {
      issues.push(createIssue("app_version_source_missing", "BLOCKED"));
    } else if (loadedAppVersionSource !== "obsidian.apiVersion") {
      issues.push(createIssue("app_version_source_invalid", "FAIL"));
    }
    addRequiredValueCheck(
      issues,
      shellVersion,
      isSafeVersion,
      "shell_version_missing",
      "shell_version_invalid",
    );
    addRequiredValueCheck(
      issues,
      electronVersion,
      isSafeVersion,
      "electron_version_missing",
      "electron_version_invalid",
    );
    if (userAgentElectronVersion === null) {
      issues.push(createIssue("electron_user_agent_identity_missing", "BLOCKED"));
    } else if (userAgentElectronVersion !== electronVersion) {
      issues.push(createIssue("electron_identity_mismatch", "FAIL"));
    }
    if (processType === undefined || processType === null) {
      issues.push(createIssue("process_type_missing", "BLOCKED"));
    } else if (processType !== "renderer") {
      issues.push(createIssue("process_type_not_renderer", "FAIL"));
    }
    if (platform === undefined || platform === null) {
      issues.push(createIssue("platform_missing", "BLOCKED"));
    } else if (!SUPPORTED_DESKTOP_PLATFORMS.has(platform)) {
      issues.push(createIssue("platform_not_supported_desktop", "FAIL"));
    }
    addRequiredValueCheck(
      issues,
      arch,
      isSafeRuntimeToken,
      "arch_missing",
      "arch_invalid",
    );
    addRequiredValueCheck(
      issues,
      pid,
      isPositiveInteger,
      "process_pid_missing",
      "process_pid_invalid",
    );
    addRequiredValueCheck(
      issues,
      mainProcessPid,
      isPositiveInteger,
      "main_process_pid_missing",
      "main_process_pid_invalid",
    );
    addRequiredValueCheck(
      issues,
      timeOrigin,
      isFinitePositive,
      "time_origin_missing",
      "time_origin_invalid",
    );

    return {
      appVersion: loadedAppVersion,
      appVersionSource: loadedAppVersionSource,
      shellVersion,
      shellVersionSource: "navigator.userAgent:obsidian/x",
      electronVersion,
      electronVersionSource: "process.versions.electron",
      platform,
      arch,
      processType,
      pid,
      mainProcessPid,
      mainProcessIdentitySource: "electron-renderer:process.ppid",
      timeOrigin,
    };
  };

  const captureStorageIdentity = async (stats, issues) => {
    const status = stats?.status ?? null;
    const backend = stats?.backend ?? null;
    const fallbackMode = stats?.fallbackMode ?? null;
    const storagePersisted = stats?.storagePersisted ?? null;
    const fileCount = stats?.fileCount ?? null;
    const chunkCount = stats?.chunkCount ?? null;
    const estimatedDbBytes = stats?.estimatedDbBytes ?? null;
    const lexicalProfileId = stats?.lexicalProfileId ?? null;
    const lexicalProfileState = stats?.lexicalProfileState ?? null;
    const lexicalGeneration = stats?.lexicalGeneration ?? null;
    const databaseInstanceId = stats?.databaseInstanceId ?? null;
    const indexId = stats?.indexId ?? null;
    const indexBuiltAt = stats?.indexBuiltAt ?? null;
    const chunkMutationEpoch = stats?.chunkMutationEpoch ?? null;
    const indexMutationEpoch = stats?.indexMutationEpoch ?? null;
    const rebuildEpoch = stats?.rebuildEpoch ?? null;
    const lexicalMaintenanceEpoch = stats?.lexicalMaintenanceEpoch ?? null;

    if (status === null) issues.push(createIssue("vss_status_missing", "BLOCKED"));
    else if (status !== "ready") issues.push(createIssue("vss_status_not_ready", "FAIL"));
    if (backend === null) issues.push(createIssue("vss_backend_missing", "BLOCKED"));
    else if (backend !== EXPECTED_BACKEND) issues.push(createIssue("vss_backend_invalid", "FAIL"));
    if (fallbackMode === null) issues.push(createIssue("fallback_mode_missing", "BLOCKED"));
    else if (fallbackMode !== false) issues.push(createIssue("fallback_mode_active", "FAIL"));
    addRequiredValueCheck(
      issues,
      fileCount,
      isPositiveInteger,
      "file_count_missing",
      "file_count_not_positive",
    );
    addRequiredValueCheck(
      issues,
      chunkCount,
      isPositiveInteger,
      "chunk_count_missing",
      "chunk_count_not_positive",
    );
    addRequiredValueCheck(
      issues,
      estimatedDbBytes,
      isFinitePositive,
      "estimated_db_bytes_missing",
      "estimated_db_bytes_not_positive",
    );
    addRequiredValueCheck(
      issues,
      lexicalProfileId,
      isSafeRuntimeToken,
      "lexical_profile_id_missing",
      "lexical_profile_id_invalid",
    );
    if (lexicalProfileState === null) {
      issues.push(createIssue("lexical_profile_state_missing", "BLOCKED"));
    } else if (lexicalProfileState !== "ready") {
      issues.push(createIssue("lexical_profile_not_ready", "FAIL"));
    }
    addRequiredValueCheck(
      issues,
      lexicalGeneration,
      isNonNegativeInteger,
      "lexical_generation_missing",
      "lexical_generation_invalid",
    );
    addRequiredValueCheck(
      issues,
      databaseInstanceId,
      isSafeRuntimeToken,
      "database_instance_id_missing",
      "database_instance_id_invalid",
    );
    addRequiredValueCheck(
      issues,
      indexId,
      isSafeRuntimeToken,
      "index_id_missing",
      "index_id_invalid",
    );
    addRequiredValueCheck(
      issues,
      indexBuiltAt,
      isIsoTimestamp,
      "index_built_at_missing",
      "index_built_at_invalid",
    );
    for (const [value, missingCode, invalidCode] of [
      [chunkMutationEpoch, "chunk_mutation_epoch_missing", "chunk_mutation_epoch_invalid"],
      [indexMutationEpoch, "index_mutation_epoch_missing", "index_mutation_epoch_invalid"],
      [rebuildEpoch, "rebuild_epoch_missing", "rebuild_epoch_invalid"],
      [lexicalMaintenanceEpoch, "lexical_maintenance_epoch_missing", "lexical_maintenance_epoch_invalid"],
    ]) {
      addRequiredValueCheck(
        issues,
        value,
        isNonNegativeInteger,
        missingCode,
        invalidCode,
      );
    }

    const databaseName = stats?.databaseName;
    const opfsDirectory = stats?.opfsDirectory;
    const opfsVfsName = stats?.opfsVfsName;
    const scopeFieldsComplete = [databaseName, opfsDirectory, opfsVfsName]
      .every(isNonEmptyString);
    if (!scopeFieldsComplete) {
      issues.push(createIssue("storage_scope_identity_missing", "BLOCKED"));
    }
    const scopeIdentity = scopeFieldsComplete ? {
      databaseNameSha256: await digest(`databaseName\u0000${databaseName}`),
      opfsDirectorySha256: await digest(`opfsDirectory\u0000${opfsDirectory}`),
      opfsVfsNameSha256: await digest(`opfsVfsName\u0000${opfsVfsName}`),
      combinedSha256: await digest(canonicalJson({ databaseName, opfsDirectory, opfsVfsName })),
    } : {
      databaseNameSha256: null,
      opfsDirectorySha256: null,
      opfsVfsNameSha256: null,
      combinedSha256: null,
    };

    return {
      status,
      backend,
      fallbackMode,
      storagePersistenceGrant: {
        persisted: typeof storagePersisted === "boolean" ? storagePersisted : null,
        role: "diagnostic-only-not-a-durable-ready-gate",
      },
      fileCount,
      chunkCount,
      estimatedDbBytes,
      lexicalProfile: {
        id: lexicalProfileId,
        state: lexicalProfileState,
        generation: lexicalGeneration,
      },
      continuity: {
        databaseInstanceIdSha256: isSafeRuntimeToken(databaseInstanceId)
          ? await digest(`databaseInstanceId\u0000${databaseInstanceId}`)
          : null,
        indexIdSha256: isSafeRuntimeToken(indexId)
          ? await digest(`indexId\u0000${indexId}`)
          : null,
        indexBuiltAt,
        chunkMutationEpoch,
        indexMutationEpoch,
        rebuildEpoch,
        lexicalMaintenanceEpoch,
      },
      scopeIdentity,
    };
  };

  const readAndHash = async (path) => digest(await app.vault.adapter.read(path));

  const captureArtifactIdentity = async (plugin, issues) => {
    const pluginVersion = plugin?.manifest?.version ?? null;
    addRequiredValueCheck(
      issues,
      pluginVersion,
      isSafeVersion,
      "plugin_version_missing",
      "plugin_version_invalid",
    );

    let pluginArtifactSha256 = null;
    let runnerArtifactSha256 = null;
    const configDirectory = isNonEmptyString(app?.vault?.configDir)
      ? app.vault.configDir
      : ".obsidian";
    try {
      pluginArtifactSha256 = await readAndHash(
        `${configDirectory}/plugins/${PLUGIN_ID}/main.js`,
      );
    } catch {
      issues.push(createIssue("plugin_artifact_unavailable", "BLOCKED"));
    }
    try {
      runnerArtifactSha256 = await readAndHash(RUNNER_PATH);
    } catch {
      issues.push(createIssue("runner_artifact_unavailable", "BLOCKED"));
    }
    if (pluginArtifactSha256 !== null && !isSha256(pluginArtifactSha256)) {
      issues.push(createIssue("plugin_artifact_identity_invalid", "BLOCKED"));
    }
    if (runnerArtifactSha256 !== null && !isSha256(runnerArtifactSha256)) {
      issues.push(createIssue("runner_artifact_identity_invalid", "BLOCKED"));
    }

    let loadedBuild = null;
    if (typeof plugin?.getLoadedPluginBuildIdentity !== "function") {
      issues.push(createIssue("loaded_plugin_build_identity_seam_missing", "BLOCKED"));
    } else {
      try {
        loadedBuild = await plugin.getLoadedPluginBuildIdentity();
      } catch {
        issues.push(createIssue("loaded_plugin_build_identity_unavailable", "BLOCKED"));
      }
    }
    if (loadedBuild !== null) {
      if (loadedBuild.schemaVersion !== 1
        || loadedBuild.identitySource !== "plugin-onload-cached-main-js"
        || loadedBuild.pluginId !== PLUGIN_ID
        || loadedBuild.pluginVersion !== pluginVersion
        || !isNonEmptyString(loadedBuild.pluginArtifactPath)
        || !isIsoTimestamp(loadedBuild.capturedAtPluginLoad)
        || !isNonEmptyString(loadedBuild.lexicalProfileRuntimeFingerprint)) {
        issues.push(createIssue("loaded_plugin_build_identity_invalid", "FAIL"));
      }
      if (loadedBuild.blocker !== null) {
        issues.push(createIssue("loaded_plugin_build_identity_blocked", "BLOCKED"));
      }
      if (!isSha256(loadedBuild.loadedPluginArtifactSha256)) {
        issues.push(createIssue("loaded_plugin_artifact_identity_invalid", "BLOCKED"));
      } else if (isSha256(pluginArtifactSha256)
        && loadedBuild.loadedPluginArtifactSha256 !== pluginArtifactSha256) {
        issues.push(createIssue("loaded_plugin_artifact_mismatch", "FAIL"));
      }
    }

    return {
      plugin: {
        id: PLUGIN_ID,
        version: pluginVersion,
        artifactSha256: pluginArtifactSha256,
        loadedBuild: loadedBuild === null ? null : {
          schemaVersion: loadedBuild.schemaVersion ?? null,
          pluginId: loadedBuild.pluginId ?? null,
          pluginVersion: loadedBuild.pluginVersion ?? null,
          pluginArtifactPathSha256: isNonEmptyString(loadedBuild.pluginArtifactPath)
            ? await digest(`pluginArtifactPath\u0000${loadedBuild.pluginArtifactPath}`)
            : null,
          loadedPluginArtifactSha256: loadedBuild.loadedPluginArtifactSha256 ?? null,
          lexicalProfileRuntimeFingerprint:
            loadedBuild.lexicalProfileRuntimeFingerprint ?? null,
          capturedAtPluginLoad: loadedBuild.capturedAtPluginLoad ?? null,
          identitySource: loadedBuild.identitySource ?? null,
          blocker: loadedBuild.blocker ?? null,
        },
      },
      runner: {
        path: RUNNER_PATH,
        artifactSha256: runnerArtifactSha256,
      },
    };
  };

  const captureSnapshot = async () => {
    const issues = [];
    const plugin = app?.plugins?.plugins?.[PLUGIN_ID] ?? null;
    if (!plugin) issues.push(createIssue("plugin_not_loaded", "BLOCKED"));

    let stats = null;
    if (typeof plugin?.vss?.getStats !== "function") {
      issues.push(createIssue("foreground_vss_stats_seam_missing", "BLOCKED"));
    } else {
      try {
        stats = await plugin.vss.getStats({ mode: "foreground" });
      } catch {
        issues.push(createIssue("foreground_vss_stats_unavailable", "BLOCKED"));
      }
    }

    const runtime = captureRuntimeIdentity(plugin, issues);
    const storage = await captureStorageIdentity(stats, issues);
    const artifacts = await captureArtifactIdentity(plugin, issues);
    return {
      status: overallStatus(issues),
      issues,
      runtime,
      storage,
      ...artifacts,
    };
  };

  const stableFieldPaths = Object.freeze([
    "runtime.appVersion",
    "runtime.appVersionSource",
    "runtime.shellVersion",
    "runtime.shellVersionSource",
    "runtime.electronVersion",
    "runtime.electronVersionSource",
    "runtime.platform",
    "runtime.arch",
    "runtime.processType",
    "runtime.mainProcessIdentitySource",
    "plugin.id",
    "plugin.version",
    "plugin.artifactSha256",
    "plugin.loadedBuild.schemaVersion",
    "plugin.loadedBuild.pluginId",
    "plugin.loadedBuild.pluginVersion",
    "plugin.loadedBuild.pluginArtifactPathSha256",
    "plugin.loadedBuild.loadedPluginArtifactSha256",
    "plugin.loadedBuild.lexicalProfileRuntimeFingerprint",
    "plugin.loadedBuild.identitySource",
    "plugin.loadedBuild.blocker",
    "runner.path",
    "runner.artifactSha256",
    "storage.status",
    "storage.backend",
    "storage.fallbackMode",
    "storage.fileCount",
    "storage.chunkCount",
    "storage.estimatedDbBytes",
    "storage.lexicalProfile.id",
    "storage.lexicalProfile.state",
    "storage.lexicalProfile.generation",
    "storage.continuity.databaseInstanceIdSha256",
    "storage.continuity.indexIdSha256",
    "storage.continuity.indexBuiltAt",
    "storage.continuity.chunkMutationEpoch",
    "storage.continuity.indexMutationEpoch",
    "storage.continuity.rebuildEpoch",
    "storage.continuity.lexicalMaintenanceEpoch",
    "storage.scopeIdentity.databaseNameSha256",
    "storage.scopeIdentity.opfsDirectorySha256",
    "storage.scopeIdentity.opfsVfsNameSha256",
    "storage.scopeIdentity.combinedSha256",
  ]);

  const valueAtPath = (value, path) => path.split(".").reduce(
    (current, segment) => current?.[segment],
    value,
  );

  const compareSnapshots = (before, after) => {
    const issues = [];
    const stableFields = {};
    for (const path of stableFieldPaths) {
      const stable = JSON.stringify(valueAtPath(before, path))
        === JSON.stringify(valueAtPath(after, path));
      stableFields[path] = stable ? "PASS" : "FAIL";
      if (!stable) {
        issues.push(createIssue(`stable_field_drift:${path}`, "FAIL"));
      }
    }
    const pidChanged = before?.runtime?.pid !== after?.runtime?.pid;
    const mainProcessPidChanged = before?.runtime?.mainProcessPid
      !== after?.runtime?.mainProcessPid;
    const timeOriginChanged = before?.runtime?.timeOrigin !== after?.runtime?.timeOrigin;
    if (!pidChanged) issues.push(createIssue("full_app_restart_pid_unchanged", "FAIL"));
    if (!mainProcessPidChanged) {
      issues.push(createIssue("full_app_restart_main_process_pid_unchanged", "FAIL"));
    }
    if (!timeOriginChanged) {
      issues.push(createIssue("full_app_restart_time_origin_unchanged", "FAIL"));
    }
    return {
      status: overallStatus(issues),
      issues,
      fullAppRestart: {
        status: pidChanged && mainProcessPidChanged && timeOriginChanged ? "PASS" : "FAIL",
        pidChanged,
        mainProcessPidChanged,
        mainProcessIdentitySource: "electron-renderer:process.ppid",
        timeOriginChanged,
      },
      stableFields,
    };
  };

  const writeEvidence = async (path, document) => {
    await app.vault.adapter.write(path, `${JSON.stringify(document, null, 2)}\n`);
  };

  const operatorAssertion = (phase, confirmed, confirmedAt) => ({
    id: phase === "before" ? BEFORE_ASSERTION_ID : AFTER_ASSERTION_ID,
    statement: phase === "before" ? BEFORE_ASSERTION : AFTER_ASSERTION,
    basis: "operator-attestation-not-independently-verified",
    confirmed: confirmed === true,
    confirmedAt: confirmed === true ? confirmedAt : null,
    status: confirmed === true ? "PASS" : "BLOCKED",
  });

  const captureBefore = async (options = {}) => {
    const capturedAt = new Date().toISOString();
    const snapshot = await captureSnapshot();
    const assertion = operatorAssertion("before", options?.operatorConfirmed, capturedAt);
    const issues = [...snapshot.issues];
    if (assertion.status !== "PASS") {
      issues.push(createIssue("operator_before_assertion_missing", "BLOCKED"));
    }
    const runIdentitySha256 = await digest(canonicalJson({
      capturedAt,
      pid: snapshot.runtime.pid,
      mainProcessPid: snapshot.runtime.mainProcessPid,
      timeOrigin: snapshot.runtime.timeOrigin,
      pluginArtifactSha256: snapshot.plugin.artifactSha256,
      loadedPluginArtifactSha256:
        snapshot.plugin.loadedBuild?.loadedPluginArtifactSha256 ?? null,
      runnerArtifactSha256: snapshot.runner.artifactSha256,
      storageScopeSha256: snapshot.storage.scopeIdentity.combinedSha256,
    }));
    const baseline = await attachEvidenceDigest({
      schemaVersion: SCHEMA_VERSION,
      receiptType: RECEIPT_TYPE,
      phase: "before",
      status: overallStatus(issues),
      runIdentitySha256,
      capturedAt,
      evidenceWindow: {
        startedAt: capturedAt,
        finishedAt: null,
        maximumDurationMs: MAX_EVIDENCE_WINDOW_MS,
      },
      operatorAssertion: assertion,
      snapshot,
      issues,
      evidencePolicy: {
        contentFree: true,
        rawStorageScopeStored: false,
        invokedRunnerActions: [
          "plugin.vss.getStats({mode:foreground})",
          "plugin.getLoadedPluginBuildIdentity()",
          "read runner and plugin artifacts",
          "write derived JSON evidence",
        ],
        forbiddenRunnerActionsInvoked: [],
      },
      limitations: [...LIMITATIONS],
    });
    await writeEvidence(BASELINE_PATH, baseline);
    console.log(`[retrieval-opfs-restart:${baseline.status}] before evidence captured`);
    return clone(baseline);
  };

  const readBaseline = async () => {
    try {
      const text = await app.vault.adapter.read(BASELINE_PATH);
      const baseline = JSON.parse(text);
      const validShape = baseline?.schemaVersion === SCHEMA_VERSION
        && baseline?.receiptType === RECEIPT_TYPE
        && baseline?.phase === "before"
        && isNonEmptyString(baseline?.capturedAt)
        && isSha256(baseline?.runIdentitySha256)
        && baseline?.snapshot
        && Array.isArray(baseline?.issues);
      if (!validShape || !await hasValidEvidenceDigest(baseline)) {
        return { baseline: null, baselineSha256: await digest(text), errorCode: "baseline_invalid" };
      }
      return {
        baseline,
        baselineSha256: await digest(text),
        errorCode: null,
      };
    } catch {
      return { baseline: null, baselineSha256: null, errorCode: "baseline_unavailable" };
    }
  };

  const captureAfter = async (options = {}) => {
    const capturedAt = new Date().toISOString();
    const baselineRead = await readBaseline();
    const snapshot = await captureSnapshot();
    const assertion = operatorAssertion("after", options?.operatorConfirmed, capturedAt);
    const issues = [...snapshot.issues];

    if (baselineRead.errorCode) {
      issues.push(createIssue(baselineRead.errorCode, "BLOCKED"));
    } else if (baselineRead.baseline.status !== "PASS") {
      issues.push(createIssue(
        "baseline_not_pass",
        baselineRead.baseline.status === "FAIL" ? "FAIL" : "BLOCKED",
      ));
    }
    if (assertion.status !== "PASS") {
      issues.push(createIssue("operator_after_assertion_missing", "BLOCKED"));
    }

    let comparison = {
      status: "BLOCKED",
      issues: [createIssue("comparison_unavailable", "BLOCKED")],
      fullAppRestart: {
        status: "BLOCKED",
        pidChanged: null,
        mainProcessPidChanged: null,
        mainProcessIdentitySource: "electron-renderer:process.ppid",
        timeOriginChanged: null,
      },
      stableFields: {},
    };
    if (baselineRead.baseline?.status === "PASS" && snapshot.status === "PASS") {
      comparison = compareSnapshots(baselineRead.baseline.snapshot, snapshot);
      issues.push(...comparison.issues);
    } else {
      issues.push(...comparison.issues);
    }

    const startedAt = baselineRead.baseline?.capturedAt ?? null;
    const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
    const finishedAtMs = Date.parse(capturedAt);
    const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      && finishedAtMs >= startedAtMs
      ? finishedAtMs - startedAtMs
      : null;
    if (durationMs === null) issues.push(createIssue("evidence_window_invalid", "BLOCKED"));
    if (durationMs !== null && durationMs > MAX_EVIDENCE_WINDOW_MS) {
      issues.push(createIssue("evidence_window_expired", "BLOCKED"));
    }

    const receipt = await attachEvidenceDigest({
      schemaVersion: SCHEMA_VERSION,
      receiptType: RECEIPT_TYPE,
      phase: "after",
      status: overallStatus(issues),
      runIdentitySha256: baselineRead.baseline?.runIdentitySha256 ?? null,
      capturedAt,
      evidenceWindow: {
        startedAt,
        finishedAt: capturedAt,
        durationMs,
        maximumDurationMs: MAX_EVIDENCE_WINDOW_MS,
        withinMaximum: durationMs !== null && durationMs <= MAX_EVIDENCE_WINDOW_MS,
      },
      operatorAssertions: {
        before: baselineRead.baseline?.operatorAssertion ?? null,
        after: assertion,
        status: baselineRead.baseline?.operatorAssertion?.status === "PASS"
          && assertion.status === "PASS"
          ? "PASS"
          : "BLOCKED",
      },
      baselineBinding: {
        path: BASELINE_PATH,
        artifactSha256: baselineRead.baselineSha256,
        evidenceSha256: baselineRead.baseline?.evidenceSha256 ?? null,
        status: baselineRead.baseline ? "PASS" : "BLOCKED",
      },
      before: baselineRead.baseline?.snapshot ?? null,
      after: snapshot,
      comparison,
      issues,
      evidencePolicy: {
        contentFree: true,
        rawStorageScopeStored: false,
        invokedRunnerActions: [
          "read derived baseline JSON",
          "plugin.vss.getStats({mode:foreground})",
          "plugin.getLoadedPluginBuildIdentity()",
          "read runner and plugin artifacts",
          "write derived JSON evidence",
        ],
        forbiddenRunnerActionsInvoked: [],
      },
      limitations: [...LIMITATIONS],
    });
    await writeEvidence(RECEIPT_PATH, receipt);
    console.log(`[retrieval-opfs-restart:${receipt.status}] after evidence captured`);
    return clone(receipt);
  };

  globalThis.paRetrievalOpfsRestart = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    receiptType: RECEIPT_TYPE,
    runnerPath: RUNNER_PATH,
    baselinePath: BASELINE_PATH,
    receiptPath: RECEIPT_PATH,
    beforeAssertion: BEFORE_ASSERTION,
    afterAssertion: AFTER_ASSERTION,
    captureBefore,
    captureAfter,
  });
})();
