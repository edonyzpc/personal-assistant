import { describe, test } from '@jest/globals';
import { Memos } from '../memos';

/*
jest.mock('../plugin');
const mockMethod = jest.fn<(...strings: string[]) => string>();
jest.mocked(PluginManager).mockImplementation(() => {
    return {
        method: mockMethod,
    };
});
*/


describe('memos module', () => {
    test('memos init', () => {
        console.log(Memos);
    });
});