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
    type ChartOptions,
  } from 'chart.js';
	import type { App } from 'obsidian';
	import type { PluginManager } from 'plugin';

  export let app: App;
  export let plugin: PluginManager;
  export let staticsFileData: string;

  const statics = JSON.parse(staticsFileData);
  let wordsDatax = [];
  let wordsData = [];
  let filesData = [];
  let pagesData = [];
  const history = Object.keys(statics.history);
  for (const date of history) {
      wordsData.push(statics.history[date].words);
      wordsDatax.push(date);
      filesData.push({ x: date, y: Number(statics.history[date].files) });
      pagesData.push({ x: date, y: Number(statics.history[date].totalPages) });
  }


  const data = {
    //labels: ['January', 'February', 'March', 'April', 'May', 'June', 'July'],
    datasets: [
    {
      label: "Daily Words",
      labels: wordsDatax,
      data: wordsData,
      backgroundColor: ["rgba(255, 99, 132, 0.2)"],
      borderColor: ['rgba(255, 99, 132, 1)'],
      borderWidth: 1.0,
      yAxisID: 'y',

      fill: false,
      lineTension: 0.3,
      //borderCapStyle: "butt",
      borderDash: [],
      borderDashOffset: 0.0,
      //borderJoinStyle: 'miter',
      pointBorderColor: 'rgb(205, 130,1 58)',
      pointBackgroundColor: 'rgb(255, 255, 255)',
      pointBorderWidth: 10,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: 'rgb(0, 0, 0)',
      pointHoverBorderColor: 'rgba(220, 220, 220,1)',
      pointHoverBorderWidth: 2,
      pointRadius: 1,
      pointHitRadius: 10,
    },
    /*
    {
      label: 'My Second dataset',
      fill: true,
      lineTension: 0.3,
      backgroundColor: 'rgba(184, 185, 210, .9)',
      borderColor: 'rgb(35, 26, 136)',
      //borderCapStyle: "butt",
      borderDash: [],
      borderDashOffset: 0.0,
      //borderJoinStyle: 'miter',
      pointBorderColor: 'rgb(35, 26, 136)',
      pointBackgroundColor: 'rgb(255, 255, 255)',
      pointBorderWidth: 10,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: 'rgb(0, 0, 0)',
      pointHoverBorderColor: 'rgba(220, 220, 220, 1)',
      pointHoverBorderWidth: 2,
      pointRadius: 1,
      pointHitRadius: 10,
      data: [28, 48, 40, 19, 86, 27, 90],
    },
    */
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
          font: {size: 14, style: 'italic', family: 'sans-serif'},
          color: "rgba(48,48,48,0.8)",
      },
      legend: {
        labels: {
            color: "rgba(0,0,0,1)",
            usePointStyle: true,
        },
      }
    },
    animations: {
      tension: {
          duration: 1000,
          easing: 'linear',
          from: 1,
          to: 0,
          loop: true
      }
    },
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
              //text: "words",
              font: {size: 15, style: 'italic',family: 'Recursive',},
          },
          ticks: {
              color: "rgba(255, 99, 132, 1)",
              showLabelBackdrop: false,
          },
      },
      x: {
          type: 'time',
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
  <Line {data} {options} />
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
    position: relative;
    height: 100%;
    width: 100%;
    background-color: rgba(255, 255, 255, 0.9);
  }
</style>