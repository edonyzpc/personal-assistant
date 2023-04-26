import { describe,expect, test } from '@jest/globals';
import { TEST_TOKEN } from '../utils';

/*
jest.mock('../plugin');
const mockMethod = jest.fn<(...strings: string[]) => string>();
jest.mocked(PluginManager).mockImplementation(() => {
    return {
        method: mockMethod,
    };
});
*/


describe('utils module', () => {
    test('utils init', () => {
        expect(TEST_TOKEN).toBe("personal-assistant");
    });
});