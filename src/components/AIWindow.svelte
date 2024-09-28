<script lang="ts">
	import { autoPlacement, offset, flip, shift } from "svelte-floating-ui/dom";
	import { createFloatingActions } from "svelte-floating-ui";
	import { ActionIcon, SvelteUIProvider, Button } from "@svelteuidev/core";
	import { LockClosed, Transform } from "svelte-radix";

	import AIButton from "./AIButton.svelte";

	const [floatingRef, floatingContent] = createFloatingActions({
		strategy: "absolute",
		placement: "right-end",
		middleware: [autoPlacement(), offset(6), flip(), shift()],
	});

	let showTooltip: boolean = false;
	function dragMe(node: HTMLElement) {
		let moving = false;
		let right = 300;
		let bottom = 100;

		node.style.position = "absolute";
		node.style.bottom = `${bottom}px`;
		node.style.right = `${right}px`;
		node.style.cursor = "move";
		node.style.userSelect = "none";

		node.addEventListener("mousedown", () => {
			moving = true;
		});

		window.addEventListener("mousemove", (e) => {
			if (moving) {
				right -= e.movementX;
				bottom -= e.movementY;
				node.style.bottom = `${bottom}px`;
				node.style.right = `${right}px`;
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
		});
		// hide the origin element
		let originEl = document.getElementById("floating-ai-robot-button");
		if (originEl) {
			originEl.style.display = "none";
		}
	}
</script>

<SvelteUIProvider themeObserver="dark">
	<div id="floating-ai" style="height:200px;width:360px" use:dragMe>
		<ActionIcon
			color="blue"
			variant="hover"
			id="floating-ai-robot-button"
			on:mouseenter={() => (showTooltip = true)}
			on:mouseleave={() => (showTooltip = false)}
			on:click={() => popupAIButton()}
		>
			<Transform class="personal-assistant-ai-breathing" size={48} />
		</ActionIcon>
	</div>
</SvelteUIProvider>

{#if showTooltip}
	<div style="position:absolute" use:floatingContent>Tooltip</div>
{/if}
