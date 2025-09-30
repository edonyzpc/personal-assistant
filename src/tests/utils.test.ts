/**
 * @file This file contains tests for the utils module.
 * @copyright Copyright (c) 2023 edonyzpc
 */

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

/**
 * A test suite for the utils module.
 */
describe('utils module', () => {
    test('utils init', () => {
        expect(TEST_TOKEN).toBe("personal-assistant");
    });
});