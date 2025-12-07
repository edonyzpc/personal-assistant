import { Suspense, lazy, useMemo } from "react";
import type { App } from "obsidian";
import type { PluginManager } from "plugin";

type Props = {
  app: App;
  plugin: PluginManager;
  staticsFileData: string;
};

type CustomChartData = {
  key: string;
  value: number;
};

const LineChart = lazy(async () => {
  const chartModule = await import("chart.js");
  const reactChart = await import("react-chartjs-2");
  const {
    Chart: ChartJS,
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
    Filler,
  } = chartModule;
  ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, Filler);
  return { default: reactChart.Line };
});

const Statistics = ({ app, plugin, staticsFileData }: Props) => {
  const statics = useMemo(() => JSON.parse(staticsFileData), [staticsFileData]);
  const history: string[] = useMemo(() => Object.keys(statics.history), [statics.history]);

  const { wordsData, pageData, filesData, pagesData } = useMemo(() => {
    const words: CustomChartData[] = [];
    const pages: CustomChartData[] = [];
    const files: CustomChartData[] = [];
    const totalPages: CustomChartData[] = [];
    for (const date of history) {
      words.push({ key: date, value: statics.history[date].words });
      pages.push({ key: date, value: -statics.history[date].pages });
      files.push({ key: date, value: Number(statics.history[date].files) });
      totalPages.push({ key: date, value: Number(statics.history[date].totalPages) });
    }
    return { wordsData: words, pageData: pages, filesData: files, pagesData: totalPages };
  }, [history, statics.history]);

  const animation = useMemo(() => {
    if (plugin.settings.animation) {
      const totalDuration = 10000;
      const delayBetweenPoints = totalDuration / Math.max(history.length, 1);
      const previousY = (ctx: any) =>
        ctx.index === 0
          ? ctx.chart.scales.y.getPixelForValue(100)
          : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(["y"], true).y;
      return {
        x: {
          type: "number",
          easing: "linear",
          duration: delayBetweenPoints,
          from: NaN,
          delay(ctx: any) {
            if (ctx.type !== "data" || ctx.xStarted) {
              return 0;
            }
            ctx.xStarted = true;
            return ctx.index * delayBetweenPoints;
          },
        },
        y: {
          type: "number",
          easing: "linear",
          duration: delayBetweenPoints,
          from: previousY,
          delay(ctx: any) {
            if (ctx.type !== "data" || ctx.yStarted) {
              return 0;
            }
            ctx.yStarted = true;
            return ctx.index * delayBetweenPoints;
          },
        },
      };
    }
    return {
      tension: {
        duration: 1000,
        easing: "linear",
        from: 1,
        to: 0,
        loop: true,
      },
    };
  }, [history.length, plugin.settings.animation]);

  const dataDaily = useMemo(
    () => ({
      datasets: [
        {
          label: "Daily Words",
          fill: true,
          data: wordsData,
          backgroundColor: ["rgba(255, 99, 132, 0.2)"],
          borderColor: ["rgba(255, 99, 132, 1)"],
          borderWidth: 1.0,
          yAxisID: "y",
          parsing: { xAxisKey: "key", yAxisKey: "value" },
          cubicInterpolationMode: "monotone" as const,
          pointStyle: "rectRounded" as const,
        },
        {
          label: "Daily Pages",
          fill: true,
          data: pageData,
          backgroundColor: ["rgba(238, 130, 238, 0.2)"],
          borderColor: ["rgba(238, 130, 238, 1)"],
          borderWidth: 1.0,
          yAxisID: "y1",
          parsing: { xAxisKey: "key", yAxisKey: "value" },
          cubicInterpolationMode: "monotone" as const,
          pointStyle: "rectRounded" as const,
        },
      ],
    }),
    [pageData, wordsData]
  );

  const dataTotal = useMemo(
    () => ({
      datasets: [
        {
          label: "Total Files",
          fill: true,
          data: filesData,
          backgroundColor: ["rgba(153, 102, 255, 0.2)"],
          borderColor: ["rgba(153, 102, 255, 1)"],
          borderWidth: 1.0,
          yAxisID: "y",
          parsing: { xAxisKey: "key", yAxisKey: "value" },
          cubicInterpolationMode: "monotone" as const,
          pointStyle: "rectRounded" as const,
        },
        {
          label: "Total Pages",
          fill: true,
          data: pagesData,
          backgroundColor: ["rgba(255, 205, 86, 0.2)"],
          borderColor: ["rgba(255, 205, 86, 1)"],
          borderWidth: 1.0,
          yAxisID: "y1",
          parsing: { xAxisKey: "key", yAxisKey: "value" },
          cubicInterpolationMode: "monotone" as const,
          pointStyle: "rectRounded" as const,
        },
      ],
    }),
    [filesData, pagesData]
  );

  const optionsDaily = useMemo(
    () => ({
      responsive: true,
      interaction: { intersect: true, mode: "index" as const },
      plugins: {
        title: {
          display: true,
          text: "Statistics of Obsidian Vault",
          font: { weight: "bold", size: 16, family: "Barlow" },
          color: "rgba(48,48,48,1)",
        },
        subtitle: {
          display: true,
          text: "words of vault named as Anthelion",
          font: { size: 14, style: "italic", family: "sans-serif", weight: "bold" },
          color: "rgba(48,48,48,0.8)",
        },
        legend: {
          labels: {
            color: "rgba(0,0,0,1)",
            usePointStyle: true,
            pointStyle: "rectRounded",
          },
        },
        tooltip: { usePointStyle: true },
      },
      animations: animation,
      scales: {
        y: {
          border: { display: true, width: 0.8 },
          grid: { display: true, drawOnChartArea: true, drawTicks: true, color: "rgba(59, 59, 59, 0.2)" },
          title: {
            display: true,
            text: "+words",
            font: { size: 15, style: "italic", weight: "bold" },
            color: "rgba(255, 99, 132, 1)",
          },
          ticks: { color: "rgba(255, 99, 132, 1)", showLabelBackdrop: false },
        },
        y1: {
          position: "right" as const,
          border: { display: true, width: 0.8 },
          grid: { display: true, drawOnChartArea: true, drawTicks: true, color: "rgba(59, 59, 59, 0.2)" },
          title: {
            display: true,
            text: "-pages",
            font: { size: 15, style: "italic", weight: "bold" },
            color: "rgba(238, 130, 238, 1)",
          },
          ticks: { color: "rgba(238, 130, 238, 1)", showLabelBackdrop: false },
        },
        x: {
          border: { display: false, width: 0.8 },
          grid: { color: "rgba(59, 59, 59, 0.2)" },
          ticks: {},
        },
      },
    }),
    [animation]
  );

  const optionsTotal = useMemo(
    () => ({
      interaction: { mode: "index" as const, axis: "y" as const },
      plugins: {
        title: {
          display: true,
          text: "Statistics of Obsidian Vault",
          font: { weight: "bold", size: 16, family: "Barlow" },
        },
        subtitle: {
          display: true,
          text: `total files/pages of vault named as ${app.vault.getName()}`,
          font: { size: 14, style: "italic", family: "sans-serif" },
        },
        legend: {
          labels: {
            color: "rgba(0,0,0,1)",
            usePointStyle: true,
            pointStyle: "rectRounded",
          },
        },
        tooltip: { usePointStyle: true },
      },
      animations: animation,
      scales: {
        y: {
          border: { display: true, width: 0.8 },
          grid: { display: true, drawOnChartArea: true, drawTicks: true, color: "rgba(59, 59, 59, 0.2)" },
          title: {
            display: true,
            text: "total-files",
            font: { size: 15, style: "italic", weight: "bold", family: "Courier New" },
            color: "rgba(153, 102, 255, 1)",
          },
          ticks: { color: "rgba(153, 102, 255, 0.5)", showLabelBackdrop: false },
          suggestedMin: 1373,
        },
        y1: {
          type: "linear" as const,
          display: true,
          position: "right" as const,
          grid: { drawOnChartArea: false },
          title: {
            display: true,
            text: "total-pages",
            font: { size: 15, style: "italic", weight: "bold", family: "Courier New" },
            color: "rgba(255, 205, 86, 1)",
          },
          ticks: { color: "rgba(255, 205, 86, 1)", showLabelBackdrop: false },
          suggestedMin: 4045,
        },
        x: {
          border: { display: false, width: 0.8 },
          grid: { color: "rgba(59, 59, 59, 0.2)" },
        },
      },
    }),
    [animation, app.vault]
  );

  const isTotal = plugin.settings.statisticsType === "total";

  return (
    <div id="statistics-line-chart" className="relative h-full w-full bg-white/90">
      <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading chart…</div>}>
        {isTotal ? (
          <LineChart data={dataTotal as any} options={optionsTotal as any} />
        ) : (
          <LineChart data={dataDaily as any} options={optionsDaily as any} />
        )}
      </Suspense>
    </div>
  );
};

export default Statistics;
