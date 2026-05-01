import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { App } from "obsidian";
import type { PluginManager } from "plugin";
import type { ChartData, ChartOptions } from "chart.js";
import type { StatsDashboardData, StatsDashboardDay } from "../stats/stats-types";
import { normalizeStatisticsView, type StatisticsView } from "../stats/stats-store";

type Props = {
	app: App;
	plugin: PluginManager;
	dashboardData: StatsDashboardData;
};

type ChartPoint = {
	key: string;
	value: number;
};

type MixedChartData = ChartData<"bar" | "line", ChartPoint[]>;
type MixedChartOptions = ChartOptions<"bar" | "line">;
export type StatsRange = "30d" | "90d" | "all";

const DashboardChart = lazy(async () => {
	const chartModule = await import("chart.js");
	const reactChart = await import("react-chartjs-2");
	const {
		Chart: ChartJS,
		BarController,
		LineController,
		Title,
		Tooltip,
		Legend,
		BarElement,
		LineElement,
		LinearScale,
		PointElement,
		CategoryScale,
		Filler,
	} = chartModule;
	ChartJS.register(
		BarController,
		LineController,
		Title,
		Tooltip,
		Legend,
		BarElement,
		LineElement,
		LinearScale,
		PointElement,
		CategoryScale,
		Filler
	);
	return { default: reactChart.Chart };
});

const tabs: { id: StatisticsView; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "daily", label: "Daily" },
	{ id: "growth", label: "Growth" },
	{ id: "composition", label: "Composition" },
];

const rangeOptions: { id: StatsRange; label: string }[] = [
	{ id: "30d", label: "30d" },
	{ id: "90d", label: "90d" },
	{ id: "all", label: "All" },
];

const numberFormatter = new Intl.NumberFormat();

function formatNumber(value: number): string {
	return numberFormatter.format(Math.round(value));
}

function formatPages(value: number): string {
	return `${value.toFixed(1)} pages`;
}

function toPoints(days: StatsDashboardDay[], field: keyof StatsDashboardDay): ChartPoint[] {
	return days.map((day) => ({
		key: day.date,
		value: typeof day[field] === "number" ? day[field] : 0,
	}));
}

export function getDefaultStatsRange(containerWidth: number): StatsRange {
	return containerWidth > 0 && containerWidth <= 480 ? "30d" : "90d";
}

export function selectRangeDays<T>(days: T[], range: StatsRange): T[] {
	if (range === "all") return days;
	return days.slice(-Number.parseInt(range, 10));
}

function latestDay(days: StatsDashboardDay[]): StatsDashboardDay | null {
	return days.length > 0 ? days[days.length - 1] : null;
}

function uniqueDeviceCount(days: StatsDashboardDay[]): number {
	return new Set(days.flatMap((day) => day.deviceIds)).size;
}

function getUpdatedAt(days: StatsDashboardDay[]): string {
	const latest = days
		.map((day) => day.updatedAt)
		.filter(Boolean)
		.sort()
		.pop();
	return latest ? latest.replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "No data";
}

function shortDeviceId(deviceId: string): string {
	if (!deviceId || deviceId.length <= 14) return deviceId;
	return `${deviceId.slice(0, 8)}...${deviceId.slice(-4)}`;
}

function metricCard(label: string, value: string, compact: boolean, detail?: string) {
	return (
		<div className="pa-min-w-0 pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-3 pa-shadow-sm">
			<div className="pa-text-xs pa-font-medium pa-uppercase pa-tracking-normal pa-text-slate-500">
				{label}
			</div>
			<div className={`pa-mt-1 pa-break-words pa-font-semibold pa-text-slate-900 ${compact ? "pa-text-xl" : "pa-text-2xl"}`}>
				{value}
			</div>
			{detail ? (
				<div className="pa-mt-1 pa-break-all pa-text-xs pa-text-slate-500">{detail}</div>
			) : null}
		</div>
	);
}

const Statistics = ({ app, plugin, dashboardData }: Props) => {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const [activeView, setActiveView] = useState<StatisticsView>(
		normalizeStatisticsView(plugin.settings.statisticsType)
	);
	const [chartRange, setChartRange] = useState<StatsRange>("90d");
	const [rangeTouched, setRangeTouched] = useState(false);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		const updateWidth = () => setContainerWidth(element.clientWidth);
		updateWidth();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateWidth);
			return () => window.removeEventListener("resize", updateWidth);
		}

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			setContainerWidth(entry.contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (rangeTouched || containerWidth === 0) return;
		setChartRange(getDefaultStatsRange(containerWidth));
	}, [containerWidth, rangeTouched]);

	const days = useMemo(
		() => [...dashboardData.days].sort((a, b) => a.date.localeCompare(b.date)),
		[dashboardData.days]
	);
	const compact = containerWidth > 0 && containerWidth <= 480;
	const veryCompact = containerWidth > 0 && containerWidth <= 360;
	const medium = containerWidth > 0 && containerWidth <= 768;
	const latest = latestDay(days);
	const recentDays = days.slice(-30);
	const chartDays = useMemo(() => selectRangeDays(days, chartRange), [days, chartRange]);
	const writtenWords30 = recentDays.reduce((sum, day) => sum + day.words, 0);
	const activeWritingDays30 = recentDays.filter((day) => day.words > 0).length;
	const writtenWordsAll = days.reduce((sum, day) => sum + day.words, 0);
	const writtenPagesAll = days.reduce((sum, day) => sum + day.pages, 0);

	const chartAnimation = compact ? false : plugin.settings.animation ? { duration: medium ? 250 : 500 } : false;
	const pointRadius = compact ? 0 : medium ? 1 : 3;
	const metricGridClass = veryCompact
		? "pa-grid-cols-1"
		: compact
			? "pa-grid-cols-2"
			: "pa-grid-cols-1 md:pa-grid-cols-2 xl:pa-grid-cols-3";
	const overviewChartHeight = compact ? "pa-h-60" : "pa-h-72";
	const detailChartHeight = compact ? "pa-h-80" : medium ? "pa-h-96" : "pa-h-[32rem]";

	const commonOptions = useMemo<MixedChartOptions>(
		() => ({
			responsive: true,
			maintainAspectRatio: false,
			devicePixelRatio: medium ? Math.min(window.devicePixelRatio || 1, 2) : undefined,
			interaction: { mode: "index" as const, intersect: false },
			animation: chartAnimation,
			plugins: {
				legend: {
					labels: {
						color: "rgb(51, 65, 85)",
						usePointStyle: true,
					},
				},
				tooltip: {
					usePointStyle: true,
					callbacks: {
						label: (context) => {
							const label = context.dataset.label ?? "";
							const value = context.parsed.y ?? 0;
							if (label.includes("Pages")) {
								return `${label}: ${Number(value).toFixed(1)} pages`;
							}
							return `${label}: ${Number(value).toLocaleString()}`;
						},
					},
				},
			},
			scales: {
				x: {
					grid: { color: "rgba(148, 163, 184, 0.18)" },
					ticks: {
						autoSkip: true,
						color: "rgb(71, 85, 105)",
						maxRotation: 0,
						maxTicksLimit: compact ? 4 : medium ? 6 : 10,
					},
				},
				y: {
					beginAtZero: true,
					grid: { color: "rgba(148, 163, 184, 0.22)" },
					ticks: { color: "rgb(225, 29, 72)", maxTicksLimit: compact ? 4 : 6 },
				},
				y1: {
					beginAtZero: true,
					position: "right" as const,
					grid: { drawOnChartArea: false },
					ticks: { color: "rgb(147, 51, 234)", maxTicksLimit: compact ? 4 : 6 },
				},
			},
		}),
		[chartAnimation, compact, medium]
	);

	const activeChartData = useMemo<MixedChartData | null>(() => {
		if (activeView === "overview") {
			return {
				datasets: [
					{
						type: "bar" as const,
						label: "Writing Words",
						data: toPoints(recentDays, "words"),
						backgroundColor: "rgba(225, 29, 72, 0.35)",
						borderColor: "rgb(225, 29, 72)",
						borderWidth: 1,
						yAxisID: "y",
						parsing: { xAxisKey: "key", yAxisKey: "value" },
					},
				],
			};
		}

		if (activeView === "daily") {
			return {
				datasets: [
					{
						type: "bar" as const,
						label: "Daily Words",
						data: toPoints(chartDays, "words"),
						backgroundColor: "rgba(225, 29, 72, 0.32)",
						borderColor: "rgb(225, 29, 72)",
						borderWidth: 1,
						yAxisID: "y",
						parsing: { xAxisKey: "key", yAxisKey: "value" },
					},
					{
						type: "line" as const,
						label: "Daily Pages",
						data: toPoints(chartDays, "pages"),
						backgroundColor: "rgba(147, 51, 234, 0.14)",
						borderColor: "rgb(147, 51, 234)",
						borderWidth: 2,
						fill: true,
						tension: 0.25,
						yAxisID: "y1",
						parsing: { xAxisKey: "key", yAxisKey: "value" },
						pointRadius,
					},
				],
			};
		}

		if (activeView === "growth") {
			return {
				datasets: [
					{
						type: "line" as const,
						label: "Total Pages",
						data: toPoints(chartDays, "totalPages"),
						backgroundColor: "rgba(20, 184, 166, 0.16)",
						borderColor: "rgb(13, 148, 136)",
						borderWidth: 2,
						fill: true,
						tension: 0.25,
						yAxisID: "y",
						parsing: { xAxisKey: "key", yAxisKey: "value" },
						pointRadius,
					},
					{
						type: "line" as const,
						label: "Total Files",
						data: toPoints(chartDays, "files"),
						backgroundColor: "rgba(234, 179, 8, 0.18)",
						borderColor: "rgb(202, 138, 4)",
						borderWidth: 2,
						stepped: true,
						yAxisID: "y1",
						parsing: { xAxisKey: "key", yAxisKey: "value" },
						pointRadius,
					},
				],
			};
		}

		return null;
	}, [activeView, chartDays, pointRadius, recentDays]);

	const compositionRows = useMemo(
		() => activeView === "composition"
			? [
				{ label: "Written Characters", value: days.reduce((sum, day) => sum + day.characters, 0), color: "pa-bg-teal-500" },
				{ label: "Written Sentences", value: days.reduce((sum, day) => sum + day.sentences, 0), color: "pa-bg-rose-500" },
				{ label: "Footnotes", value: days.reduce((sum, day) => sum + day.footnotes, 0), color: "pa-bg-purple-500" },
				{ label: "Citations", value: days.reduce((sum, day) => sum + day.citations, 0), color: "pa-bg-amber-500" },
			]
			: [],
		[activeView, days]
	);
	const maxCompositionValue = Math.max(...compositionRows.map((row) => row.value), 1);
	const getCompositionWidth = (value: number) =>
		value === 0 ? "0%" : `${Math.max(4, (value / maxCompositionValue) * 100)}%`;

	const handleViewChange = (view: StatisticsView) => {
		setActiveView(view);
		plugin.settings.statisticsType = view;
		void plugin.saveSettings();
	};

	const handleRangeChange = (range: StatsRange) => {
		setRangeTouched(true);
		setChartRange(range);
	};

	const hasData = days.length > 0;
	const showRangePicker = activeView === "daily" || activeView === "growth";

	return (
		<div ref={containerRef} className="pa-statistics-view pa-flex pa-h-full pa-w-full pa-flex-col pa-overflow-auto pa-bg-slate-50 pa-text-slate-900">
			<div className={`pa-border-b pa-border-slate-200 pa-bg-white ${compact ? "pa-px-3 pa-py-2" : "pa-px-4 pa-py-3"}`}>
				<div className="pa-flex pa-flex-wrap pa-items-center pa-justify-between pa-gap-3">
					<div className="pa-min-w-0">
						<h2 className="pa-m-0 pa-text-lg pa-font-semibold">
							{app.vault.getName()} Statistics
						</h2>
						<div className="pa-mt-1 pa-text-xs pa-text-slate-500">
							Updated {getUpdatedAt(days)}
						</div>
					</div>
					<div
						className={compact
							? "pa-statistics-segment pa-statistics-segment--views pa-grid pa-w-full pa-grid-cols-2 pa-gap-1 pa-rounded-md pa-border pa-border-slate-200 pa-bg-slate-100 pa-p-1"
							: "pa-statistics-segment pa-statistics-segment--views pa-inline-flex pa-max-w-full pa-overflow-x-auto pa-rounded-md pa-border pa-border-slate-200 pa-bg-slate-100 pa-p-1"}
						role="tablist"
						aria-label="Statistics views"
					>
						{tabs.map((tab) => (
							<button
								key={tab.id}
								type="button"
								role="tab"
								aria-selected={activeView === tab.id}
								data-active={activeView === tab.id ? "true" : "false"}
								className="pa-statistics-tab"
								onClick={() => handleViewChange(tab.id)}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>
				{dashboardData.errors.length > 0 ? (
					<div className="pa-mt-3 pa-rounded-md pa-border pa-border-amber-200 pa-bg-amber-50 pa-p-2 pa-text-xs pa-text-amber-900">
						{dashboardData.errors.length} statistics file issue
						{dashboardData.errors.length === 1 ? "" : "s"} found. The chart skipped invalid data.
					</div>
				) : null}
			</div>

			{!hasData ? (
				<div className="pa-m-4 pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-6 pa-text-sm pa-text-slate-500">
					No statistics yet.
				</div>
			) : (
				<div className={`pa-flex pa-flex-1 pa-flex-col pa-gap-4 ${compact ? "pa-p-3" : "pa-p-4"}`}>
					{showRangePicker ? (
						<div className="pa-flex pa-justify-end">
							<div className="pa-statistics-segment pa-statistics-segment--range pa-inline-flex pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-1" aria-label="Chart date range">
								{rangeOptions.map((option) => (
									<button
										key={option.id}
										type="button"
										data-active={chartRange === option.id ? "true" : "false"}
										className="pa-statistics-tab"
										onClick={() => handleRangeChange(option.id)}
									>
										{option.label}
									</button>
								))}
							</div>
						</div>
					) : null}

					{activeView === "overview" ? (
						<>
							<div className={`pa-grid pa-gap-3 ${metricGridClass}`}>
								{metricCard("Total Words", formatNumber(latest?.totalWords ?? 0), compact)}
								{metricCard("Total Pages", formatPages(latest?.totalPages ?? 0), compact)}
								{metricCard("Markdown Files", formatNumber(latest?.files ?? 0), compact)}
								{metricCard("30d Writing", formatNumber(writtenWords30), compact, `${activeWritingDays30} active days`)}
								{metricCard("All Writing", formatNumber(writtenWordsAll), compact, formatPages(writtenPagesAll))}
								{metricCard("Devices", formatNumber(uniqueDeviceCount(days)), compact, shortDeviceId(dashboardData.deviceId))}
							</div>
							<div className={`${overviewChartHeight} pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-3`}>
								<Suspense fallback={<div className="pa-p-4 pa-text-sm pa-text-slate-500">Loading chart...</div>}>
									{activeChartData ? <DashboardChart type="bar" data={activeChartData} options={commonOptions} /> : null}
								</Suspense>
							</div>
						</>
					) : null}

					{activeView === "daily" ? (
						<div className={`${detailChartHeight} pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-3`}>
							<Suspense fallback={<div className="pa-p-4 pa-text-sm pa-text-slate-500">Loading chart...</div>}>
								{activeChartData ? <DashboardChart type="bar" data={activeChartData} options={commonOptions} /> : null}
							</Suspense>
						</div>
					) : null}

					{activeView === "growth" ? (
						<div className={`${detailChartHeight} pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-3`}>
							<Suspense fallback={<div className="pa-p-4 pa-text-sm pa-text-slate-500">Loading chart...</div>}>
								{activeChartData ? <DashboardChart type="line" data={activeChartData} options={commonOptions} /> : null}
							</Suspense>
						</div>
					) : null}

					{activeView === "composition" ? (
						<div className="pa-grid pa-grid-cols-1 pa-gap-3 lg:pa-grid-cols-2">
							{compositionRows.map((row) => (
								<div
									key={row.label}
									className="pa-rounded-md pa-border pa-border-slate-200 pa-bg-white pa-p-4 pa-shadow-sm"
								>
									<div className="pa-flex pa-items-center pa-justify-between pa-gap-3">
										<div className="pa-text-sm pa-font-medium pa-text-slate-600">{row.label}</div>
										<div className="pa-text-xl pa-font-semibold pa-text-slate-950">
											{formatNumber(row.value)}
										</div>
									</div>
									<div className="pa-mt-3 pa-h-2 pa-rounded pa-bg-slate-100">
										<div
											className={`pa-h-2 pa-rounded ${row.color}`}
											style={{ width: getCompositionWidth(row.value) }}
										/>
									</div>
								</div>
							))}
						</div>
					) : null}
				</div>
			)}
		</div>
	);
};

export default Statistics;
