<script lang="ts">
    import { App, MarkdownRenderer } from "obsidian";
	import type { PluginManager } from "plugin";
    export let variable: number;
    export let app: App;
    export let fileNames: string[];
    export let container: HTMLElement;
    export let plugin: PluginManager

    async function readMarkdownFile(file: string) {
        return app.vault.adapter.read(file);
    }

    const subContainer = (id: string) => {
        //const element = container.querySelector(".recordlist-wrapper");
        console.log("----");
        console.log(document.getElementById("persoanl-assistant-record-list-wrapper-1"));
        const element = document.getElementById(id);
        if (element) {
            console.log("get the element");
            return element;
        } else {
            console.log("fail over to get parent element");
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
        {#each fileNames as fileName, idx}
            <div id="record-wrapper-sub-{idx}"></div>
            {#await readMarkdownFile(fileName) then fileString }
                <!-- svelte-ignore empty-block -->
                {#await MarkdownRenderer.renderMarkdown(fileString, subContainer(`record-wrapper-sub-${idx}`), fileName, plugin) then _}{/await}
            {/await}
        {/each}
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