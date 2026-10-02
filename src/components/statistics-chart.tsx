import {
    Chart as ChartJS,
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
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

// Keep registration inside this lazy module; importing Statistics need not initialize charts.
ChartJS.register(
    BarController, LineController, Title, Tooltip, Legend,
    BarElement, LineElement, LinearScale, PointElement, CategoryScale, Filler,
);

export default Chart;
