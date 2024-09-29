<script lang="ts">
	import { Center, Loader, Skeleton } from "@svelteuidev/core";
</script>

<div id="ai-robot-paper-loading">
	<Center
		><Loader
			color="blue"
			size="xs"
			variant="bars"
			style="float:left"
		/></Center
	><br />
	<Skeleton height={8} radius="xl" />
	<Skeleton height={8} radius="xl" override={{ marginTop: "8px" }} />
	<Skeleton
		height={8}
		width="70%"
		radius="xl"
		override={{ marginTop: "8px" }}
	/>
</div>
