<script lang="ts">
	import { autoPlacement, offset, flip, shift } from "svelte-floating-ui/dom";
	import { createFloatingActions } from "svelte-floating-ui";

	const [floatingRef, floatingContent] = createFloatingActions({
		strategy: "absolute",
		placement: "right-end",
		middleware: [autoPlacement(), offset(6), flip(), shift()],
	});

	let showTooltip: boolean = false;
	function dragMe(node: HTMLElement) {
		let moving = false;
		let left = 300;
		let top = 100;

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
</script>

<div id="floating-ai" style="height:80px;width:80px" use:dragMe>
	<button
		on:mouseenter={() => (showTooltip = true)}
		on:mouseleave={() => (showTooltip = false)}
		use:floatingRef>Hover me</button
	>
</div>

{#if showTooltip}
	<div style="position:absolute" use:floatingContent>Tooltip</div>
{/if}
