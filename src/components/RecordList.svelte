<script lang="ts">
    import { App, MarkdownRenderer } from "obsidian";
	import type { PluginManager } from "plugin";
    export let variable: number;
    export let app: App;
    export let fileName: string;
    export let container: HTMLElement;
    export let plugin: PluginManager

    async function readMarkdownFile() {
        return app.vault.adapter.read(fileName);
    }

    let readMarkdown = readMarkdownFile();

    const subContainer = () => {
        //const element = container.querySelector(".recordlist-wrapper");
        const element = document.getElementById("persoanl-assistant-record-list-wrapper-1");
        if (element) {
            return element;
        } else {
            return container;
        }
    }

</script>

<div class="recordlist-wrapper" id="persoanl-assistant-record-list">
    <div class="record-wrapper">
    <span>My number is {variable}!</span>
    </div>
    <div class="record-wrapper">
    <span>My number is {variable}!</span>
    </div>
    <div class="record-wrapper" id="persoanl-assistant-record-list-wrapper-1">
        {#await readMarkdown then fileString }
            {#await MarkdownRenderer.renderMarkdown(fileString, subContainer(), fileName, plugin) then }
            {/await}
        {/await}
    </div>
</div>

<style>
    .recordlist-wrapper {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        flex-grow: 1;
        width: 100%;
        overflow-y: scroll;
        gap: 8px;
        scrollbar-width: none;
    }
    .record-wrapper {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        width: 100%;
        padding: 12px 18px;
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #f1f1f1;
    }
</style>