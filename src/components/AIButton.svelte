<script lang="ts">
	import { SvelteUIProvider, type SelectItem } from "@svelteuidev/core";
	import {
		ActionIcon,
		Button,
		CloseButton,
		Divider,
		Flex,
		Loader,
		Text,
		Paper,
		Space,
	} from "@svelteuidev/core";
	import { NativeSelect } from "@svelteuidev/core";
	import { ChevronDown, StarFilled, ClipboardCopy } from "svelte-radix";
	// dropdown item
	let prompts: SelectItem[] = [
		{ label: "1", value: `Where did you go to school?` },
		{ label: "2", value: `What is your mother's name?` },
		{
			label: "3",
			value: `What is another personal fact that an attacker could easily find with Google?`,
		},
	];

	let selected: SelectItem = {
		label: "1",
		value: `Where did you go to school?`,
	};

	let aiButtonRef: any;
	let answer = "";

	function handleSubmit() {
		alert(
			`answered question ${selected.label} (${selected.value}) with "${answer}"`,
		);
	}
</script>

<SvelteUIProvider
	id="ai-button-container"
	themeObserver="light"
	bind:this={aiButtonRef}
>
	<div>
		<CloseButton
			style="float: right;"
			on:click={() => {
				aiButtonRef.$destroy();
			}}
		/>
	</div>
	<div id="floating-ai-inner">
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
			<Text>selected {selected}<br /></Text>
			<Flex justify="space-around">
				<Button color="green" on:click={() => (answer = "abc")}
					>ok</Button
				>
				<Button color="red" on:click={() => (answer = "abc")}
					>cancel</Button
				>
			</Flex>
			<Loader color="blue" size="xs" variant="dots" style="float:left" />
		</Flex>
		<Divider size="sm" />
		<Paper shadow="md" withBorder>
			<Loader
				color="blue"
				size="xs"
				variant="bars"
				style="float:left"
			/><br />
			...
		</Paper>
	</div>
</SvelteUIProvider>

<style>
	#floating-ai-inner {
		display: block;
		height: 100%;
		width: 100%;
		background-color: rgba(233, 244, 244, 0.1);
	}
</style>
