<!-- Copyright 2023 edonyzpc -->

<script lang="ts">
    import { App, Component, MarkdownRenderer, Platform, Vault, setIcon } from "obsidian";
    import { tick } from "svelte";
    import type { PluginManager } from "plugin";
    export let app: App;
    export let fileNames: string[];
    export let container: HTMLElement;
    export let plugin: PluginManager

    async function readMarkdownFile(file: string) {
        return app.vault.adapter.read(file);
    }

    const subContainer = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            plugin.log("get the element");
            return element;
        } else {
            plugin.log("fail over to get parent element");
            return container;
        }
    }

    const isMobile = () => {
        plugin.log("this is Mobile", Platform.isMobile);
        return Platform.isMobile;
    }

    const isPluginEnabled = (pluginID: string) => {
        return (app as any).plugins.manifests.hasOwnProperty(pluginID) &&
            (app as any).plugins.enabledPlugins.has(pluginID);
    }

    // code from https://github.com/prncc/obsidian-repeat-plugin/blob/master/src/repeat/obsidian/RepeatView.tsx#L215
    enum EmbedType {
        Image = 'Image',
        Audio = 'Audio',
        Video = 'Video',
        PDF = 'PDF',
        Note = 'Note',
        Unknown = 'Unknown',
    }
    // https://help.obsidian.md/Advanced+topics/Accepted+file+formats
    const embedTypeToAcceptedExtensions = {
        [EmbedType.Image]: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'],
        [EmbedType.Audio]: ['mp3', 'webm', 'wav', 'm4a', 'ogg', '3gp', 'flac'],
        [EmbedType.Video]: ['mp4', 'webm', 'ogv', 'mov', 'mkv'],
        [EmbedType.PDF]: ['pdf'],
    }

    // Form src regexes that detect the type of embed.
    const embedTypeToSrcRegex = {};
    Object.keys(embedTypeToAcceptedExtensions).forEach((key) => {
        (embedTypeToSrcRegex as any)[key] = new RegExp([
            '.+\\.(',
            (embedTypeToAcceptedExtensions as any)[key].join('|'),
            ').*',
            ].join(''), 'i');
    });
    /**
     * Determines embed type based on src of the span element containing an embed.
     * @param node The span embed container.
     * @returns One of the plugin's recognized embed types.
     */
    function determineEmbedType(node: Element): EmbedType {
        const src = node.getAttribute('src')
        if (!src) {
            return EmbedType.Unknown;
        }
        for (const [embedTypeKey, embedTypeRegex] of Object.entries(embedTypeToSrcRegex)) {
            if (src.match(embedTypeRegex as RegExp)) {
                return (EmbedType as any)[embedTypeKey];
            }
        }
        // Markdown embeds don't have an extension.
        return EmbedType.Note;
    }
    /**
     * Resolved path suitable for constructing a canonical file URI.
     *
     * Obsidian does some path inference in case links don't specify a full path.
     * @param vault Vault which contains the file.
     * @param mediaSrc Path suffix of file to display.
     * @returns Full path of file, or just pathSuffix if no file matched.
     */
    function getClosestMatchingFilePath(
        vault: Vault,
        mediaSrc: string,
        containingNotePath: string,
    ) {
        const containingDir = (() => {
            const parts = containingNotePath.split('/');
            parts.pop();
            return parts.join('/');
        })();
        let normalizedPathSuffix = mediaSrc;
        if (mediaSrc.startsWith('.')) {
            const resourcePathParts = containingNotePath.split('/');
            // Remove the note file name.
            resourcePathParts.pop();
            for (const suffixPart of mediaSrc.split('/')) {
                if (suffixPart === '..') {
                resourcePathParts.pop();
                } else if (suffixPart === '.') {
                    continue;
                } else {
                    resourcePathParts.push(suffixPart);
                }
            }
            normalizedPathSuffix = resourcePathParts.join('/');
        }

        // Keep track of all matches to choose between later.
        // This is only useful if multiple folders contain the same file name.
        const allMatches: string[] = [];
        for (const file of vault.getFiles()) {
            if (file.path.endsWith(normalizedPathSuffix)) {
                // End things right away if we have an exact match.
                if (file.path === normalizedPathSuffix) {
                    return file.path;
                }
                allMatches.push(file.path);
            }
        }
        // Matches closer to note are prioritized over alphanumeric sorting.
        allMatches.sort((left, right) => {
            if (left.startsWith(containingDir) && !right.startsWith(containingDir)) {
                return -1
            }
            if (right.startsWith(containingDir) && !left.startsWith(containingDir)) {
                return 1;
            }
            return (left <= right) ? -1 : 1;
        });
        if (allMatches) {
            return allMatches[0];
        }
        // No matches probably means a broken link.
        return mediaSrc;
    }
    /**
     * Gets resource URI Obsidian can render.
     * @param vault Vault which contains the note.
     * @param mediaSrc src in containing span, something like a filename or path.
     * @returns URI
     */
     const getMediaUri = (
        vault: Vault,
        mediaSrc: string,
        containingNotePath: string,
    ) => {
        const matchingPath = getClosestMatchingFilePath(vault, mediaSrc, containingNotePath);
        return vault.adapter.getResourcePath(matchingPath);
    }
    /**
     * Gets note URI that Obsidian can open.
     * @param vault Vault which contains the note.
     * @param noteHref href of link, something like a relative note path or base name.
     * @returns URI
     */
    const getNoteUri = (
        vault: Vault,
        noteHref: string,
    ) => {
        if(isPluginEnabled('obsidian-advanced-uri')) {
            // Use Advanced URI plugin if it is enabled.
            // obsidian://advanced-uri?vault=<your-vault>&filepath=my-file
            return ['obsidian://advanced-uri?vault=',
                    encodeURIComponent(vault.getName()),
                    '&filepath=',
                    encodeURIComponent(noteHref),
                ].join('');
        } else {
            // Use Obsidian default URI
            return ['obsidian://open?vault=',
                    encodeURIComponent(vault.getName()),
                    '&file=',
                    encodeURIComponent(noteHref),
                ].join('');
    }
    };

    const renderMarkdown = async (
        markdown: string,
        containerEl: HTMLElement,
        sourcePath: string,
        lifecycleComponent: Component,
    ) => {
        await MarkdownRenderer.render(
            app,
            markdown,
            containerEl,
            sourcePath,
            lifecycleComponent,
        );

        const nodes = containerEl.querySelectorAll('span.internal-embed');
        nodes.forEach((node) => {
            const embedType = determineEmbedType(node);
            switch(embedType) {
                case EmbedType.Image:
                    const img = createEl('img');
                    img.src = getMediaUri(
                        app.vault,
                        node.getAttribute('src') as string,
                        sourcePath);
                    node.empty();
                    node.appendChild(img);
                    break;
                case EmbedType.Audio:
                    const audio = createEl('audio');
                    audio.controls = true;
                    audio.src = getMediaUri(
                      app.vault,
                      node.getAttribute('src') as string,
                      sourcePath);
                    node.empty();
                    node.appendChild(audio);
                    break;
                case EmbedType.Video:
                    const video = createEl('video');
                    video.controls = true;
                    video.src = getMediaUri(
                      app.vault,
                      node.getAttribute('src') as string,
                      sourcePath);
                    node.empty();
                    node.appendChild(video);
                    break;
                case EmbedType.PDF:
                    if (!Platform.isDesktop) {
                        plugin.log('Embedded PDFs are only supported on the desktop.');
                        return;
                    }
                    const iframe = createEl('iframe');
                    iframe.src = getMediaUri(
                      app.vault,
                      node.getAttribute('src') as string,
                      sourcePath);
                    iframe.width = '100%';
                    iframe.height = '500px';
                    node.empty();
                    node.appendChild(iframe);
                    break;
                case EmbedType.Note:
                    plugin.log('Embedded notes are not perfectly supported.');
                    /* callout HTML element
                    <div data-callout-metadata="" data-callout-fold="-" data-callout="abstract" class="callout is-collapsible is-collapsed">
                        <div class="callout-title">
                            <div class="callout-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-loader">
                                    <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>
                                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                                    <line x1="2" y1="12" x2="6" y2="12"></line>
                                    <line x1="18" y1="12" x2="22" y2="12"></line>
                                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                                </svg>
                            </div>
                            <div class="callout-title-inner">Test</div>
                            <div class="callout-fold is-collapsed">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </div>
                        </div>
                        <div class="callout-content" style="display: none;">
                            <p>test</p>
                        </div>
                    </div>
                     */
                    // not support note block preview and use internal link instead
                    const nodeSrc = (node.getAttribute('src') as string);
                    const callout = createDiv();
                    callout.setAttribute("data-callout-metadata", "");
                    callout.setAttribute("data-callout-fold", "-");
                    callout.setAttribute("data-callout", "abstract");
                    callout.addClasses(["callout", "is-collapsible", "is-collapsed"]);
                    const calloutTitle = callout.createDiv();
                    calloutTitle.addClass("callout-title");
                    const calloutIcon = calloutTitle.createDiv();
                    calloutIcon.addClass("callout-icon");
                    setIcon(calloutIcon, 'loader');
                    const calloutTitleInner = calloutTitle.createDiv();
                    calloutTitleInner.addClass("callout-title-inner");
                    const link = createEl("a");
                    link.target = "_blank";
                    link.rel = "noopener";
                    link.addClass("internal-link");
                    link.setText(nodeSrc + " 💨");
                    link.href = getNoteUri(app.vault, nodeSrc);
                    calloutTitleInner.appendChild(link);
                    node.empty()
                    node.appendChild(callout);
                    break;
                case EmbedType.Unknown:
                default:
                    plugin.log('Could not determine embedding type for element:');
                    plugin.log(node);
            }
        });
    
        const links = containerEl.querySelectorAll('a.internal-link');
        links.forEach((node) => {
            if (!node.getAttribute('href')) {
                return;
            }
            const link = (node as HTMLLinkElement);
            // prevents click event from parent element other than the current link element
            link.addEventListener('click', (evt) => {
                evt.stopPropagation();
            });
            // do not change the hyperlink if it is changed
            if (link.href.startsWith("obsidian://")) return;
            link.href = getNoteUri(app.vault, link.getAttribute('href') as string);
        });
}

    const addClickableforRecord = async (id: string, target: string) => {
        // Waits until Svelte finished updating the DOM
        await tick();
        const element = document.getElementById(id);
        if (element) {
            plugin.log("get the element");
            const noteName = target.split('\\').pop()?.split('/').pop();
            if (noteName) {
                const uri = getNoteUri(app.vault, noteName);
                element.setAttribute("onclick", `location.href='${uri}'`);
                element.setAttribute("style", "cursor:pointer");
            }
        } else {
            plugin.log("fail to find element with ", id);
        }
    }
</script>

<div class="markdown-reading-view" style="width: 100%; height: 100%;">
    <div class="markdown-preview-view markdown-rendered node-insert-event is-readable-line-width allow-fold-headings show-indentation-guide allow-fold-lists show-properties" tabindex="-1" style="tab-size: 4;">
        <div class="markdown-preview-sizer markdown-preview-section">
            <div class="markdown-preview-pusher" style="width: 1px; height: 0.1px; margin-bottom: 0px;"></div>
        </div>

        {#if isMobile()}
        <div class="recordlist-wrapper" id="persoanl-assistant-record-list">
            {#each fileNames as fileName, idx}
                <div class="record-wrapper-mobile" id="record-wrapper-sub-{idx}"></div>
                {#await readMarkdownFile(fileName) then fileString }
                    <!-- svelte-ignore empty-block -->
                    <!-- {#await MarkdownRenderer.renderMarkdown(fileString, subContainer(`record-wrapper-sub-${idx}`), fileName, plugin) then _}{/await} -->
                    {#await renderMarkdown(fileString, subContainer(`record-wrapper-sub-${idx}`), fileName, plugin) then _}{/await}
                {/await}
            {/each}
        </div>
        {:else}
        <div class="recordlist-wrapper" id="persoanl-assistant-record-list">
            {#each fileNames as fileName, idx}
                <div class="record-wrapper" id="record-wrapper-sub-{idx}"></div>
                {#await readMarkdownFile(fileName) then fileString }
                    <!-- svelte-ignore empty-block -->
                    <!-- {#await MarkdownRenderer.renderMarkdown(fileString, subContainer(`record-wrapper-sub-${idx}`), fileName, plugin) then _}{/await} -->
                    {#await renderMarkdown(fileString, subContainer(`record-wrapper-sub-${idx}`), fileName, plugin) then _}{/await}
                {/await}
            {/each}
        </div>
        {/if}

         {#each fileNames as fileName, idx}
            <!-- svelte-ignore empty-block -->
            {#await addClickableforRecord(`record-wrapper-sub-${idx}`, fileName) then _}{/await}
         {/each}
    </div>
</div>

<style>
    .recordlist-wrapper {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
        flex-grow: 1;
        width: 100%;
        overflow-y: scroll;
        gap: 8px;
        scrollbar-width: none;
    }
    .record-wrapper {
        display: flex;
        flex-direction: column;
        /*
        justify-content: flex-start;
        align-items: flex-start;
        */
        width: 60%;
        padding: 12px 18px;
        background-color: var(--pa-record-background-color);
        color: var(--pa-record-font-color);
        border-radius: 8px;
        border: 0.2px solid #f1f1f1;
    }
    .record-wrapper-mobile {
        display: flex;
        flex-direction: column;
        /*
        justify-content: flex-start;
        align-items: flex-start;
        */
        width: 90%;
        padding: 12px 18px;
        background-color: var(--pa-record-background-color);
        color: var(--pa-record-font-color);
        border-radius: 8px;
        border: 0.2px solid #f1f1f1;
    }
</style>