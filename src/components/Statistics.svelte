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
  } from 'chart.js';


  const data = {
    labels: ['January', 'February', 'March', 'April', 'May', 'June', 'July'],
    datasets: [
    {
    label: 'My First dataset',
    fill: true,
    lineTension: 0.3,
    backgroundColor: 'rgba(225, 204, 230, .4)',
    borderColor: 'rgb(205, 130, 158)',
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
    data: [65, 59, 80, 81, 56, 55, 40],
    },
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
    ],
  };

  const options = {
    responsive: true,
    scales: {
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
    Filler
  );

</script>

<div id="statistics-line-chart">
  <Line {data} options={options} />
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