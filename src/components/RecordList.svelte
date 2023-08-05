<script lang="ts">
    import { App, Component, MarkdownRenderer, Platform, Vault } from "obsidian";
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
        return (this.app as any).plugins.manifests.hasOwnProperty(pluginID) && (this.app as any).plugins.enabledPlugins.has(pluginID);
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
        await MarkdownRenderer.renderMarkdown(
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
                    plugin.log("parsing image");
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
                        console.error('Repeat Plugin: Embedded PDFs are only supported on the desktop.');
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
                    console.error('Repeat Plugin: Embedded notes are not yet supported.');
                    break;
                case EmbedType.Unknown:
                default:
                    console.error('Repeat Plugin: Could not determine embedding type for element:');
                    console.error(node);
            }
        });
    
        const links = containerEl.querySelectorAll('a.internal-link');
        plugin.log("parsing internal link");
        links.forEach((node: HTMLLinkElement) => {
            if (!node.getAttribute('href')) {
                return;
            }
            node.href = getNoteUri(app.vault, node.getAttribute('href') as string);
        });
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