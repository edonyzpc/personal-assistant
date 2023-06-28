<script lang="ts">
    import { App, MarkdownRenderer } from "obsidian";
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
            console.debug("get the element");
            return element;
        } else {
            console.debug("fail over to get parent element");
            return container;
        }
    }

</script>

<div class="recordlist-wrapper" id="persoanl-assistant-record-list">
    {#each fileNames as fileName, idx}
        <div class="record-wrapper" id="record-wrapper-sub-{idx}"></div>
        {#await readMarkdownFile(fileName) then fileString }
            <!-- svelte-ignore empty-block -->
            {#await MarkdownRenderer.renderMarkdown(fileString, subContainer(`record-wrapper-sub-${idx}`), fileName, plugin) then _}{/await}
        {/await}
    {/each}
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
        width: 50%;
        padding: 12px 18px;
        background-color: var(--pa-record-background-color);
        color: var(--pa-record-font-color);
        border-radius: 8px;
        border: 0.2px solid #f1f1f1;
    }
</style>