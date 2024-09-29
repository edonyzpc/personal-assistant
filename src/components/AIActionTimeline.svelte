<script lang="ts">
	import { Text, ThemeIcon, Timeline } from "@svelteuidev/core";
	import { Commit, EyeOpen, LightningBolt } from "svelte-radix";

	export let aiContent: string;
	export let aiRobot: string;
</script>

<Timeline active={2} bulletSize={24} lineWidth={2}>
	<Timeline.Item bullet={LightningBolt} title="通义千问初始化">
		<Text color="dimmed" size="sm">{aiRobot}</Text>
		<Text size="xs">1 second ago</Text>
	</Timeline.Item>

	<Timeline.Item bullet={Commit} title="Qwen-max推理过程">
		<Text color="dimmed" size="sm">{aiContent}</Text>
		<Text size="xs">7 seconds ago</Text>
	</Timeline.Item>

	<Timeline.Item title="ReAct任务检查">
		<svelte:fragment slot="bullet">
			<ThemeIcon radius="xl" color="green"
				><EyeOpen size={16} /></ThemeIcon
			>
		</svelte:fragment>
		<Text color="dimmed" size="sm">Check you Obsidian note</Text>
		<Text size="xs">37 seconds ago</Text>
	</Timeline.Item>
</Timeline>
