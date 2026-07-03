/*
 * Pagelet shell smoke runner.
 *
 * Usage:
 *   1. Run `make deploy` from the repo root.
 *   2. Copy this file into the repo-local test vault root:
 *      `cp scripts/pagelet-smoke-runner.js test/pagelet-smoke-runner.js`
 *   3. Open the test vault in Obsidian, open DevTools, then run:
 *      `eval(await app.vault.adapter.read("pagelet-smoke-runner.js"))`
 *
 * This runner intentionally avoids provider calls. It verifies the deployed
 * Pagelet shell, command registrations, and current Panel mount contract.
 */
(async () => {
  const PLUGIN_ID = "personal-assistant";
  const COMMAND_IDS = [
    "pa-pagelet:open-panel",
    "pa-pagelet:review-current",
    "pa-pagelet:quick-review",
    "pa-pagelet:discover-connections",
    "pa-pagelet:periodic-summary",
    "pa-pagelet:maintenance-review",
    "pa-pagelet:quiet-recall",
    "pa-pagelet:graph-discovery",
    "pa-pagelet:scope-recap",
    "pa-pagelet:toggle-proactive-hints",
    "pa-pagelet:preload-status",
    "pa-pagelet:background-preparation-status",
    "pa-pagelet:move-pet-corner",
    "pa-pagelet:toggle-pet-visibility",
  ];
  const RETIRED_COMMAND_IDS = [
    "pa-pagelet:weekly-review",
  ];

  const startedAt = new Date().toISOString();
  const result = {
    startedAt,
    finishedAt: null,
    checks: [],
    bugs: [],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const panelRoot = () => document.querySelector(".pa-pagelet-panel");
  const petRoot = () => document.querySelector(".pa-pagelet-pet");

  const record = (name, status, detail = "") => {
    const entry = { name, status, detail };
    result.checks.push(entry);
    if (status === "FAIL") result.bugs.push({ name, detail });
    console.log(`[pagelet-smoke:${status}] ${name}${detail ? ` -- ${detail}` : ""}`);
    return entry;
  };

  const assert = (name, condition, detail = "") => {
    record(name, condition ? "PASS" : "FAIL", detail || (condition ? "" : "assertion failed"));
  };

  const waitFor = async (name, predicate, timeoutMs = 10000, intervalMs = 100) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await predicate();
      if (value) return value;
      await sleep(intervalMs);
    }
    record(name, "FAIL", `timed out after ${timeoutMs}ms`);
    return null;
  };

  const openFirstMarkdownFile = async () => {
    const file = app.vault.getMarkdownFiles().find((candidate) => !candidate.path.startsWith("."));
    if (!file) return null;
    await app.workspace.getLeaf(false).openFile(file);
    await sleep(300);
    return file;
  };

  try {
    const plugin = app.plugins.plugins[PLUGIN_ID];
    assert("Personal Assistant plugin is loaded", Boolean(plugin));
    assert("Pagelet settings namespace exists", Boolean(plugin?.settings?.pagelet));
    assert("Pagelet is enabled", plugin?.settings?.pagelet?.enabled === true);
    assert("Pagelet background preparation setting is readable",
      typeof plugin?.settings?.pagelet?.preloadEnabled === "boolean",
      `preloadEnabled=${plugin?.settings?.pagelet?.preloadEnabled}`);

    for (const id of COMMAND_IDS) {
      assert(`Command registered: ${id}`, Boolean(app.commands.commands[`${PLUGIN_ID}:${id}`]));
    }
    for (const id of RETIRED_COMMAND_IDS) {
      assert(`Retired command absent: ${id}`, !app.commands.commands[`${PLUGIN_ID}:${id}`]);
    }

    const sourceFile = await openFirstMarkdownFile();
    assert("Opened a markdown note for Pagelet shell smoke", Boolean(sourceFile), sourceFile?.path || "");

    await app.commands.executeCommandById(`${PLUGIN_ID}:pa-pagelet:open-panel`);
    const panel = await waitFor("Open Panel command mounts Pagelet panel", () => panelRoot());
    assert("Panel uses current shell selector", Boolean(panel?.classList?.contains("pa-pagelet-panel")));
    const panelTextPattern = /Pagelet|拾页|Run Pagelet|运行拾页/i;
    const panelWithText = await waitFor(
      "Panel shows a localized Pagelet title or empty state",
      () => panelTextPattern.test(textOf(panelRoot())),
      3000,
    );
    assert("Panel shows a localized Pagelet title or empty state", Boolean(panelWithText), textOf(panelRoot()));
    const primaryButton = panelRoot()?.querySelector(".pa-pagelet-panel-save-btn");
    assert("Panel empty state exposes an explicit review action",
      /Review current note|审阅当前笔记|Review selected \(\d+\)|审阅已选（\d+）/i.test(textOf(primaryButton)),
      textOf(primaryButton));

    const activeLeafType = app.workspace.activeLeaf?.view?.getViewType?.() || "unknown";
    const petShouldMount = plugin?.settings?.pagelet?.petVisible === true && activeLeafType === "markdown";
    assert(
      "Pet mount state observed",
      !petShouldMount || Boolean(petRoot()),
      `petVisible=${plugin?.settings?.pagelet?.petVisible}; activeLeafType=${activeLeafType}; petDom=${petRoot() ? 1 : 0}`,
    );

    await app.commands.executeCommandById(`${PLUGIN_ID}:pa-pagelet:background-preparation-status`);
    record("Background preparation status command executed without throwing", "PASS");
  } catch (error) {
    record("Runner threw", "FAIL", error?.stack || String(error));
  } finally {
    result.finishedAt = new Date().toISOString();
    try {
      await app.vault.adapter.write("pagelet-smoke-runtime-result.json", JSON.stringify(result, null, 2));
    } catch (error) {
      console.warn("[pagelet-smoke] failed to write runtime result", error);
    }
    console.log("[pagelet-smoke:RESULT]", result);
  }
})();
