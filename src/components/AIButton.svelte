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

	export let parentRef: any;
	export let plugin: PluginManager;
	export let editor: Editor;
	export let view: MarkdownView;
	export let app: App;
	export let selectedQuery: string;
	// dropdown item
	let prompts: SelectItem[] = [
		{ label: "自动backlink管理", value: `AssitantRobotBacklink` },
		{ label: "自动标签管理", value: `AssistantRobot` },
		{
			label: "待定...",
			value: `What is another personal fact that an attacker could easily find with Google?`,
			disabled: true,
		},
	];

	let selected: string;
	let theme: ColorScheme = document.body.hasClass("theme-dark")
		? "dark"
		: "light";
	let aiButtonRef: any;

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
				label="Select AI Helper"
				icon={StarFilled}
			>
				<svelte:component this={ChevronDown} slot="rightSection" />
			</NativeSelect>
			<div id="ai-robot-selected-item" out:typewriter={{}}>
				selected {selected}
			</div>
			<Flex justify="space-around">
				<Button color="green" on:click={dispatchRobotTask}>ok</Button>
				<Button color="red" on:click={closeAIButton}>cancel</Button>
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
