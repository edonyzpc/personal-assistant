/*
 * Pagelet full smoke runner.
 *
 * Usage:
 *   1. Run `make deploy` from the repo root.
 *   2. Copy this file into the repo-local test vault root:
 *      `cp scripts/pagelet-smoke-runner.js test/pagelet-smoke-runner.js`
 *   3. Open the test vault in Obsidian, open DevTools, then run:
 *      `eval(await app.vault.adapter.read("pagelet-smoke-runner.js"))`
 *
 * The script intentionally runs inside Obsidian DevTools because it needs the
 * real plugin instance, workspace, vault adapter, provider settings, and UI DOM.
 */
(async () => {
  const startedAt = new Date().toISOString();
  const result = {
    startedAt,
    finishedAt: null,
    env: {},
    checks: [],
    bugs: [],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const panelRoot = () => document.querySelector(".pa-pagelet-view");
  const panelText = () => textOf(panelRoot());
  const getButton = (regex) => [...document.querySelectorAll("button")]
    .find((button) => regex.test(textOf(button)) || regex.test(button.getAttribute("aria-label") || ""));
  const getModalButton = (regex) => [...document.querySelectorAll(".modal button")]
    .find((button) => regex.test(textOf(button)) || regex.test(button.getAttribute("aria-label") || ""));
  const providerLimitPattern = /hourly call limit|rate limit|quota|too many requests/i;

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

  const waitFor = async (name, predicate, timeoutMs = 30000, intervalMs = 250) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await predicate();
      if (value) return value;
      await sleep(intervalMs);
    }
    record(name, "FAIL", `timed out after ${timeoutMs}ms`);
    return null;
  };

  const listPageletOutputs = async () => {
    try {
      const listing = await app.vault.adapter.list(".pagelet");
      return listing.files.filter((path) => path.endsWith(".md")).sort();
    } catch {
      return [];
    }
  };

  const readVaultFile = async (path) => app.vault.adapter.read(path);

  const openPath = async (path) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`Missing fixture: ${path}`);
    await app.workspace.getLeaf(false).openFile(file);
    await sleep(400);
    return file;
  };

  const configureCurrentScope = async (path) => {
    await openPath(path);
    await plugin.refreshPageletScope("current", path);
    await waitFor(`${path}: scope ready`, () => panelText().includes(path) && panelText().includes("Review selected (1)"), 10000);
  };

  const runReviewAndResolve = async (name, actionRegex, options = {}) => {
    const {
      requireAction = true,
      timeoutMs = 180000,
    } = options;
    const before = await listPageletOutputs();
    let settled = false;
    let thrown = null;
    const runPromise = plugin.runPageletReviewForPageletScope()
      .catch((error) => {
        thrown = error;
      })
      .finally(() => {
        settled = true;
      });

    let clicked = false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const button = getModalButton(actionRegex);
      if (button) {
        button.click();
        clicked = true;
        break;
      }
      if (settled) break;
      await sleep(300);
    }

    if (!settled) {
      const resolvedAfterTimeout = await Promise.race([
        runPromise.then(() => true),
        sleep(5000).then(() => false),
      ]);
      if (!resolvedAfterTimeout) {
        const after = await listPageletOutputs();
        const created = after.filter((path) => !before.includes(path));
        record(`${name}: runtime timeout`, "FAIL", `review did not settle within ${timeoutMs}ms; created=${created.join(",") || "none"}`);
        return { before, after, created, clicked, providerLimited: false, panelText: panelText(), timedOut: true };
      }
    }
    await sleep(1000);

    const after = await listPageletOutputs();
    const created = after.filter((path) => !before.includes(path));
    const currentPanelText = panelText();
    const providerLimited = providerLimitPattern.test(currentPanelText)
      || providerLimitPattern.test(String(thrown?.message || ""));

    if (providerLimited) {
      record(`${name}: provider call blocked`, "BLOCKED", "configured provider returned a rate/quota limit");
    } else if (requireAction && !clicked) {
      record(`${name}: modal action`, "FAIL", "review completed without the expected confirmation action");
    } else {
      record(`${name}: review resolved`, "PASS", `created=${created.join(",") || "none"}`);
    }

    if (thrown) {
      record(`${name}: runtime promise`, providerLimited ? "BLOCKED" : "FAIL", String(thrown?.message || thrown));
    }

    return { before, after, created, clicked, providerLimited, panelText: currentPanelText };
  };

  const plugin = app.plugins.plugins["personal-assistant"];
  if (!plugin) throw new Error("Personal Assistant plugin is not loaded");

  result.env.provider = plugin.settings?.aiProvider || null;
  result.env.model = plugin.settings?.chatModelName || null;
  result.env.obsidian = app.getVersion?.() || null;
  result.env.vault = app.vault.getName?.() || null;

  localStorage.removeItem("personal-assistant:pagelet:pending-draft:v1");

  await configureCurrentScope("pagelet-smoke-golden.md");
  assert(
    "panel uses selected-note CTA copy",
    panelText().includes("Review selected (1)") && !panelText().includes("Pagelet: Review current note"),
    panelText().slice(0, 160),
  );
  assert(
    "current scope includes only the active note",
    /Included \(1\)/.test(panelText()) && panelText().includes("pagelet-smoke-golden.md"),
    panelText().slice(0, 240),
  );

  await plugin.refreshPageletScope("last7", "pagelet-smoke-golden.md");
  await waitFor("last7 scope rendered", () => /Included \(\d+\)/.test(panelText()), 10000);
  const last7Text = panelText();
  assert("last7 scope updates without provider call", last7Text.includes("Review selected ("), last7Text.slice(0, 200));
  assert("review output notes are summarized without listing paths", /Pagelet review notes|拾页审阅笔记/.test(last7Text), last7Text);
  assert("no-ai tag notes are visible as locked skipped rows", last7Text.includes("excluded tag"), last7Text);
  assert("pagelet-frontmatter notes are visible as locked skipped rows", last7Text.includes("pagelet note"), last7Text);
  assert("hidden/system folder paths stay out of scope rows", !last7Text.includes(".trash/"), last7Text);

  const candidateCheckbox = [...document.querySelectorAll(".pa-pagelet-scope__checkbox")]
    .find((checkbox) => checkbox.checked && !checkbox.closest("label")?.innerText.includes("pagelet-smoke-golden.md"));
  if (candidateCheckbox) {
    candidateCheckbox.click();
    await sleep(250);
    assert("manual unchecked candidate moves to skipped", panelText().includes("unchecked"), panelText());
  } else {
    record("manual unchecked candidate moves to skipped", "SKIP", "no extra included note in last7 scope");
  }

  await configureCurrentScope("pagelet-smoke-cancel.md");
  const cancelRun = await runReviewAndResolve("cancel path", /Cancel|Close/);
  assert("cancel path writes no review note", cancelRun.created.length === 0, `created=${cancelRun.created.join(",") || "none"}`);

  await configureCurrentScope("pagelet-smoke-golden.md");
  const goldenRun = await runReviewAndResolve("golden save path", /Save review note|Confirm/);
  assert("golden path writes exactly one review note", goldenRun.created.length === 1, `created=${goldenRun.created.join(",") || "none"}`);
  const goldenOutput = goldenRun.created[0];
  if (goldenOutput) {
    const body = await readVaultFile(goldenOutput);
    assert(
      "saved note has Pagelet frontmatter",
      /pagelet:\s*true/.test(body) && /pagelet_source:\s*"?pagelet-smoke-golden\.md"?/.test(body),
      goldenOutput,
    );
    assert("saved note has suggestions heading", /## Suggestions|## \u5efa\u8bae/.test(body), goldenOutput);
  }

  const countAfterSave = (await listPageletOutputs()).length;
  await sleep(10000);
  assert("self-write no-loop after save", (await listPageletOutputs()).length === countAfterSave, `count=${countAfterSave}`);

  const addToDraft = getButton(/Add to draft/);
  if (addToDraft) {
    addToDraft.click();
    await sleep(250);
    const textarea = document.querySelector(".pa-pagelet-draft__text");
    assert("add to draft creates editable textarea", Boolean(textarea), textarea?.value || "");
    if (textarea) {
      textarea.value = "Edited smoke draft block";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(250);
      assert(
        "draft edit persists to localStorage",
        localStorage.getItem("personal-assistant:pagelet:pending-draft:v1")?.includes("Edited smoke draft block"),
        "localStorage snapshot",
      );
    }
    const remove = getButton(/Remove/);
    if (remove) {
      remove.click();
      await sleep(250);
      assert("draft remove clears textarea", !document.querySelector(".pa-pagelet-draft__text"));
    } else {
      record("draft remove clears textarea", "SKIP", "remove button missing");
    }
  } else {
    record("add to draft creates editable textarea", "SKIP", "no Add to draft button in model output");
  }

  const dismiss = getButton(/Dismiss this suggestion|Dismiss/);
  if (dismiss) {
    const beforeCards = document.querySelectorAll(".pa-pagelet-suggestion-card").length;
    dismiss.click();
    await sleep(250);
    assert("dismiss hides only one visible card", document.querySelectorAll(".pa-pagelet-suggestion-card").length < beforeCards, `before=${beforeCards}`);
  } else {
    record("dismiss hides only one visible card", "SKIP", "dismiss button missing");
  }

  const sourceButton = [...document.querySelectorAll(".pa-pagelet-suggestion-card__source-chip--interactive")][0];
  if (sourceButton) {
    sourceButton.click();
    await sleep(800);
    const activeFile = app.workspace.getActiveFile()?.path || "";
    assert("source chip opens source without replacing Pagelet panel", activeFile === "pagelet-smoke-golden.md" && Boolean(panelRoot()), activeFile);
  } else {
    record("source chip opens source without replacing Pagelet panel", "SKIP", "source chip missing");
  }

  const chatView = await plugin.activeChatView();
  const blocked = chatView?.prefillComposer("existing chat draft before Pagelet research") === true
    ? await plugin.preparePageletResearchPrompt({
      source_id: "seg-1",
      kind: "evidence",
      rationale: "smoke",
      proposed_action: "research smoke",
      related_notes: [],
    })
    : null;
  assert("research handoff does not overwrite existing Chat draft", blocked === false, `result=${blocked}`);

  const suggestionsRegion = document.querySelector(".pa-pagelet-cards");
  assert(
    "suggestions region has live-region semantics",
    suggestionsRegion?.getAttribute("role") === "region" && suggestionsRegion?.getAttribute("aria-live") === "polite",
  );
  const anyFooterAria = [...document.querySelectorAll(".pa-pagelet-suggestion-card__btn")]
    .some((button) => /seg-|note-/.test(button.getAttribute("aria-label") || ""));
  assert("card action aria labels include source context", anyFooterAria);

  await configureCurrentScope("pagelet-provider-zh.md");
  const zhRun = await runReviewAndResolve("provider zh current configured model", /Cancel|Close/, { requireAction: true });
  assert("provider zh writes no review note when cancelled or provider-limited", zhRun.created.length === 0, `provider=${result.env.provider}, model=${result.env.model}`);

  await configureCurrentScope("pagelet-provider-en.md");
  const enRun = await runReviewAndResolve("provider en current configured model", /Cancel|Close/, { requireAction: false });
  if (enRun.providerLimited) {
    record("provider en structured output", "BLOCKED", `provider=${result.env.provider}, model=${result.env.model}`);
  } else {
    assert("provider en writes no review note when cancelled", enRun.created.length === 0, `provider=${result.env.provider}, model=${result.env.model}`);
  }

  await configureCurrentScope("pagelet-smoke-injection.md");
  const injectionRun = await runReviewAndResolve("prompt-injection confinement", /Cancel|Close/, { requireAction: false });
  if (injectionRun.providerLimited) {
    record("prompt-injection live provider path", "BLOCKED", "provider rate/quota limit prevented a fresh model response");
  }
  assert("prompt-injection path does not write on cancel or provider limit", injectionRun.created.length === 0, "no source mutation/write");

  const canvas = app.vault.getAbstractFileByPath("obsidian-operations/canvas-smoke.canvas");
  if (canvas) {
    const before = await listPageletOutputs();
    await app.workspace.getLeaf(false).openFile(canvas);
    await sleep(500);
    await plugin.runPageletReviewForActiveNote();
    await sleep(1000);
    const after = await listPageletOutputs();
    assert("non-Markdown view no-ops without provider write", after.length === before.length, `before=${before.length}, after=${after.length}`);
  } else {
    record("non-Markdown view no-ops without provider write", "SKIP", "canvas fixture missing");
  }

  result.finishedAt = new Date().toISOString();
  await app.vault.adapter.write("pagelet-smoke-runtime-result.json", JSON.stringify(result, null, 2));
  console.log("[pagelet-smoke:RESULT]", result);
  return result;
})()
