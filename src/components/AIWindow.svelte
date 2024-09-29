<script lang="ts">
	import { App, Editor, MarkdownView } from "obsidian";
	import {
		ActionIcon,
		type ColorScheme,
		SvelteUIProvider,
		Button,
	} from "@svelteuidev/core";
	import { LockClosed, Transform } from "svelte-radix";

	import AIButton from "./AIButton.svelte";
	import type { PluginManager } from "plugin";

	export let plugin: PluginManager;
	export let editor: Editor;
	export let view: MarkdownView;
	export let app: App;
	export let selectedQuery: string;

	let aiWinRef: any;
	let theme: ColorScheme = document.body.hasClass("theme-dark")
		? "dark"
		: "light";
	let showTooltip: boolean = false;
	function dragMe(node: HTMLElement) {
		let moving = false;
		let left = window.innerWidth / 6;
		let top = window.innerHeight / 6;

		node.style.position = "absolute";
		node.style.top = `${top}px`;
		node.style.left = `${left}px`;
		node.style.cursor = "move";
		node.style.userSelect = "none";

		node.addEventListener("mousedown", () => {
			moving = true;
		});

		window.addEventListener("mousemove", (e) => {
			if (moving) {
				left += e.movementX;
				top += e.movementY;
				node.style.top = `${top}px`;
				node.style.left = `${left}px`;
			}
		});

		window.addEventListener("mouseup", () => {
			moving = false;
		});
	}

	function popupAIButton() {
		let el: HTMLElement;
		const aiEl = document.getElementById("floating-ai");
		if (aiEl) {
			el = aiEl;
		} else {
			el = globalThis.document.getElementsByClassName(
				"app-container",
			)[0] as HTMLElement;
		}
		const aiBtn = document.getElementById("ai-button-container");
		if (aiBtn) {
			// already create the ai button element
			return;
		}
		new AIButton({
			target: el,
			props: {
				parentRef: aiWinRef,
				plugin: plugin,
				view: view,
				editor: editor,
				app: app,
				selectedQuery: selectedQuery,
			},
		});
		// hide the origin element
		let originEl = document.getElementById("floating-ai-robot-button");
		if (originEl) {
			originEl.style.display = "none";
		}
	}
</script>

<SvelteUIProvider themeObserver={theme} bind:this={aiWinRef}>
	<div id="floating-ai" style="height:200px;width:360px" use:dragMe>
		<ActionIcon
			color="blue"
			id="floating-ai-robot-button"
			size={48}
			on:click={() => popupAIButton()}
			override={{ "border-radius": "16px" }}
		>
			<Transform class="personal-assistant-ai-breathing" size={40} />
		</ActionIcon>
	</div>
</SvelteUIProvider>
