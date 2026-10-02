import { Chart as ChartJS } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import StatisticsChart from '../src/components/statistics-chart';

describe('lazy statistics chart module', () => {
    it('exports the generic mixed-chart renderer with all dashboard components registered', () => {
        expect(StatisticsChart).toBe(Chart);
        for (const id of ['bar', 'line']) expect(ChartJS.registry.getController(id)).toBeDefined();
        for (const id of ['bar', 'line', 'point']) expect(ChartJS.registry.getElement(id)).toBeDefined();
        for (const id of ['category', 'linear']) expect(ChartJS.registry.getScale(id)).toBeDefined();
        for (const id of ['title', 'tooltip', 'legend', 'filler']) expect(ChartJS.registry.getPlugin(id)).toBeDefined();
    });
});
