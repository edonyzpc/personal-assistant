<!-- Copyright 2024 edonyzpc -->

<script lang="ts">
  import { Line } from 'svelte-chartjs';
  import {
    Chart as ChartJS,
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
    Filler,
    type ChartData,
    type ChartOptions,
  } from 'chart.js';
	import type { App } from 'obsidian';
	import type { PluginManager } from 'plugin';

  export let app: App;
  export let plugin: PluginManager;
  export let staticsFileData: string;

  type CustomChartData = {
    key: string;
    value: number;
  };

  const statics = JSON.parse(staticsFileData);
  let wordsData = [];
  let pageData = [];
  let filesData = [];
  let pagesData = [];
  const history = Object.keys(statics.history);
  for (const date of history) {
    wordsData.push({ key: date, value: statics.history[date].words });
    pageData.push({ key: date, value: -statics.history[date].pages });
    filesData.push({ key: date, value: Number(statics.history[date].files) });
    pagesData.push({ key: date, value: Number(statics.history[date].totalPages) });
  }

  // statistics support progressive animation
  const totalDuration = 10000;
  const delayBetweenPoints = totalDuration / history.length;
  const previousY = (ctx: any) => ctx.index === 0 ? ctx.chart.scales.y.getPixelForValue(100) : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(['y'], true).y;
  const animationProgressive = {
    x: {
      type: 'number',
      easing: 'linear',
      duration: delayBetweenPoints,
      from: NaN, // the point is initially skipped
      delay(ctx: any) {
        if (ctx.type !== 'data' || ctx.xStarted) {
          return 0;
        }
        ctx.xStarted = true;
        return ctx.index * delayBetweenPoints;
      }
    },
    y: {
      type: 'number',
      easing: 'linear',
      duration: delayBetweenPoints,
      from: previousY,
      delay(ctx: any) {
        if (ctx.type !== 'data' || ctx.yStarted) {
          return 0;
        }
        ctx.yStarted = true;
        return ctx.index * delayBetweenPoints;
      }
    }
  };
  const animationRegular = {
    tension: {
        duration: 1000,
        easing: 'linear',
        from: 1,
        to: 0,
        loop: true
    }
  };
  let animation: any;
  if (plugin.settings.animation) {
    animation = animationProgressive;
  } else {
    animation = animationRegular;
  }

  const data: ChartData<"line", CustomChartData[]> = {
    datasets: [
    {
      label: "Daily Words",
      fill: true,
      data: wordsData,
      backgroundColor: ["rgba(255, 99, 132, 0.2)"],
      borderColor: ['rgba(255, 99, 132, 1)'],
      borderWidth: 1.0,
      yAxisID: 'y',
      parsing: {
        xAxisKey: 'key',
        yAxisKey: 'value'
      },
      cubicInterpolationMode: "monotone",
      pointStyle: "rectRounded",
    },
    {
      label: "Daily Pages",
      fill: true,
      data: pageData,
      backgroundColor: ["rgba(238, 130, 238, 0.2)"],
      borderColor: ['rgba(238, 130, 238, 1)'],
      borderWidth: 1.0,
      yAxisID: 'y1',
      parsing: {
        xAxisKey: 'key',
        yAxisKey: 'value'
      },
      cubicInterpolationMode: "monotone",
      pointStyle: "rectRounded",
    },
    ],
  };

  const dataFilePage: ChartData<"line", CustomChartData[]> = {
    datasets: [
      {
        label: "Total Files",
        fill: true,
        data: filesData,
        backgroundColor: ["rgba(153, 102, 255, 0.2)"],
        borderColor: ['rgba(153, 102, 255, 1)'],
        borderWidth: 1.0,
        yAxisID: 'y',
        parsing: {
          xAxisKey: 'key',
          yAxisKey: 'value'
        },
        cubicInterpolationMode: "monotone",
        pointStyle: "rectRounded",
      },
      {
        label: "Total Pages",
        fill: true,
        data: pagesData,
        backgroundColor: ["rgba(255, 205, 86, 0.2)"],
        borderColor: ['rgba(255, 205, 86, 1)'],
        borderWidth: 1.0,
        yAxisID: 'y1',
        parsing: {
          xAxisKey: 'key',
          yAxisKey: 'value'
        },
        cubicInterpolationMode: "monotone",
        pointStyle: "rectRounded",
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    interaction: {
      intersect: true,
      mode: 'index',
    },
    plugins: {
      title: {
          display: true,
          text: 'Statistics of Obsidian Vault',
          font: {weight: 'bold', size: 16, family: 'Barlow'},
          color: "rgba(48,48,48,1)",
      },
      subtitle: {
          display: true,
          text: "words of vault named as Anthelion",
          font: {size: 14, style: 'italic', family: 'sans-serif', weight: 'bold'},
          color: "rgba(48,48,48,0.8)",
      },
      legend: {
        labels: {
            color: "rgba(0,0,0,1)",
            usePointStyle: true,
            pointStyle: "rectRounded",
        },
      },
      tooltip: {
        usePointStyle: true,
      }
    },
    /*
    animations: {
      tension: {
          duration: 1000,
          easing: 'linear',
          from: 1,
          to: 0,
          loop: true
      }
    },
    */
    animations: animation,
    scales: {
      y: {
          border: {
              display: true,
              width: 0.8,
          },
          grid: {
              display: true,
              drawOnChartArea: true,
              drawTicks: true,
              color: "rgba(59, 59, 59, 0.2)",
          },
          title: {
              display: true,
              text: "+words",
              font: {size: 15, style: 'italic', weight: 'bold'},
              color: "rgba(255, 99, 132, 1)",
          },
          ticks: {
              color: "rgba(255, 99, 132, 1)",
              showLabelBackdrop: false,
          },
      },
      y1: {
        position: 'right',
        border: {
            display: true,
            width: 0.8,
        },
        grid: {
            display: true,
            drawOnChartArea: true,
            drawTicks: true,
            color: "rgba(59, 59, 59, 0.2)",
        },
        title: {
            display: true,
            text: "-pages",
            font: {size: 15, style: 'italic', weight: 'bold'},
            color: "rgba(238, 130, 238, 1)",
        },
        ticks: {
            color: "rgba(238, 130, 238, 1)",
            showLabelBackdrop: false,
        },
      },
      x: {
        border: {
            display: false,
            width: 0.8,
        },
        grid: {
            color: "rgba(59, 59, 59, 0.2)",
        },
        ticks: {
        },
      },
    },
  }

  const optionsFilePage: ChartOptions<"line"> = {
        interaction: {
            mode: 'index',
            axis: 'y',
        },
        plugins: {
            title: {
                display: true,
                text: 'Statistics of Obsidian Vault',
                font: {weight: 'bold', size: 16, family: 'Barlow'},
            },
            subtitle: {
                display: true,
                text: "total files/pages of vault named as " + app.vault.getName(),
                font: {size: 14, style: 'italic', family: 'sans-serif'}
            },
            legend: {
                labels: {
                    color: "rgba(0,0,0,1)",
                    usePointStyle: true,
                    pointStyle: "rectRounded",
                },
            },
            tooltip: {
              usePointStyle: true,
            }
        },
        /*
        animations: {
            tension: {
                duration: 1600,
                easing: 'easeInOutExpo',
                from: 1.5,
                to: 0,
                loop: true
            }
        },
        */
        animations: animation,
        scales: {
            y: {
                border: {
                    display: true,
                    width: 0.8,
                },
                grid: {
                    display: true,
                    drawOnChartArea: true,
                    drawTicks: true,
                    color: "rgba(59, 59, 59, 0.2)",
                },
                title: {
                    display: true,
                    text: "total-files",
                    font: {size: 15, style: 'italic', weight: 'bold', family: 'Courier New'},
                    color: 'rgba(153, 102, 255, 1)',
                },
                ticks: {
                    color: "rgba(153, 102, 255, 0.5)",
                    showLabelBackdrop: false,
                },
                suggestedMin: 1373,
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                // grid line settings
                grid: {
                  drawOnChartArea: false, // only want the grid lines for one axis to show up
                },
                title: {
                    display: true,
                    text: "total-pages",
                    font: {size: 15, style: 'italic', weight: 'bold', family: 'Courier New'},
                    color: 'rgba(255, 205, 86, 1)',
                },
                ticks: {
                    color: "rgba(255, 205, 86, 1)",
                    showLabelBackdrop: false,
                },
                suggestedMin: 4045,
            },
            x: {
                border: {
                    display: false,
                    width: 0.8,
                },
                grid: {
                    color: "rgba(59, 59, 59, 0.2)",
                },
            },
        },
  }

  const isTotal = () => {
    return plugin.settings.statisticsType === 'total';
  }

  ChartJS.register(
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
    Filler,
  );

</script>

<div id="statistics-line-chart">
  {#if isTotal()}
    <!-- total files/pages -->
    <Line data={dataFilePage} options={optionsFilePage} />
  {:else}
    <!-- daily words-->
    <Line data={data} options={options} />
  {/if}
</div>

<style>
  #statistics-line-chart {
    --backgroundColor: rgba(225, 204,230, .4);
    --backgroundColor-1: rgba(255, 99, 132, 0.2);
    --borderColor-1: rgb(205, 130, 158);
    --point-border-color: rgb(205, 130,1 58);
    --pointBackgroundColor: rgb(255, 255, 255);
    --pointHoverBackgroundColor: rgb(0, 0, 0);
    --pointHoverBorderColor: rgba(220, 220, 220,1);
    --pageDataColor: rgb(255, 136, 0);
    position: relative;
    height: 100%;
    width: 100%;
    background-color: rgba(255, 255, 255, 0.9);
  }
</style>