<!--
  @component
  A floating AI button with a dropdown menu of actions.
-->
<script lang="ts">
	import {
		SvelteUIProvider,
		type SelectItem,
		type ColorScheme,
	} from "@svelteuidev/core";
	import {
		ActionIcon,
		Button,
		Center,
		CloseButton,
		Divider,
		Flex,
		Loader,
		Text,
		Paper,
		Space,
		Skeleton,
	} from "@svelteuidev/core";
	import { NativeSelect } from "@svelteuidev/core";
	import { typewriter } from "@svelteuidev/motion";
	import { App, Editor, MarkdownView } from "obsidian";
	import { ChevronDown, StarFilled, ClipboardCopy } from "svelte-radix";

	import type { PluginManager } from "plugin";
	import { AssistantRobot } from "ai";

	import AiLoader from "./AILoader.svelte";
	import AiActionTimeline from "./AIActionTimeline.svelte";
	import AiIcon from "./AIIcon.svelte";

	/** The reference to the parent component. */
	export let parentRef: any;
	/** The PluginManager instance. */
	export let plugin: PluginManager;
	/** The editor instance. */
	export let editor: Editor;
	/** The markdown view instance. */
	export let view: MarkdownView;
	/** The app instance. */
	export let app: App;
	/** The selected query. */
	export let selectedQuery: string;
	// dropdown item
	let prompts: SelectItem[] = [
		{ label: "Auto Backlink Management", value: `AssitantRobotBacklink` },
		{ label: "Auto Tag Management", value: `AssistantRobot` },
		{
			label: "Coming soon...",
			value: `What is another personal fact that an attacker could easily find with Google?`,
			disabled: true,
		},
	];

	let selected: string;
	let theme: ColorScheme = document.body.hasClass("theme-dark")
		? "dark"
		: "light";
	let aiButtonRef: any;

	/**
	 * Dispatches the selected robot task.
	 */
	const dispatchRobotTask = async () => {
		if (selected === "AssistantRobot") {
			const robot = new AssistantRobot(
				plugin,
				editor,
				view,
				app,
				selectedQuery,
			);
			const el = document.getElementById("ai-robot-paper");
			let ailoader: AiLoader;
			if (el) {
				ailoader = new AiLoader({ target: el });
			} else {
				return;
			}
			const res = await robot.assitantTags();
			ailoader.$destroy();
			new AiActionTimeline({
				target: el,
				props: { aiContent: res, aiRobot: selected },
			});
			setTimeout(() => {
				(app as any).commands.executeCommandById(
					"personal-assistant:local-graph",
				);
			}, 5000);
		} else if (selected === "AssitantRobotBacklink") {
			return;
		} else {
			return;
		}
	};

	/**
	 * Closes the AI button.
	 */
	const closeAIButton = () => {
		aiButtonRef.$destroy();
		// clear parent ref
		parentRef.$destroy();
	};
</script>

<SvelteUIProvider
	id="ai-button-container"
	themeObserver={theme}
	bind:this={aiButtonRef}
>
	<div id="floating-ai-inner">
		<div>
			<CloseButton style="float: right;" on:click={closeAIButton} />
		</div>

		<Flex justify="space-between" direction="column">
			<NativeSelect
				data={prompts}
				bind:value={selected}
				placeholder="Pick one"
				label="Select your assistant"
				icon={AiIcon}
				size="md"
			>
				<svelte:component this={ChevronDown} slot="rightSection" />
			</NativeSelect>
			<div id="ai-robot-selected-item" out:typewriter={{}}>
				selected {selected}
			</div>
			<Flex justify="space-around">
				<Button
					ripple
					variant="gradient"
					gradient={{ from: "teal", to: "green", deg: 105 }}
					on:click={dispatchRobotTask}>execute</Button
				>
				<Button
					ripple
					variant="gradient"
					gradient={{ from: "orange", to: "red", deg: 85 }}
					on:click={closeAIButton}>cancel</Button
				>
			</Flex>
			<!--Loader color="blue" size="xs" variant="dots" style="float:left" /-->
		</Flex>
		<Divider size="sm" />
		<Paper id="ai-robot-paper" shadow="md" withBorder></Paper>
	</div>
</SvelteUIProvider>

<style>
	#floating-ai-inner {
		display: block;
		height: 100%;
		width: 100%;
		background-color: rgba(130, 132, 132, 0.2);
		padding: 5px 5px 5px 5px;
	}
	#ai-robot-selected-item {
		margin: 2px 2px 2px 2px;
	}
</style>
