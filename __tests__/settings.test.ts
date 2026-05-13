import { describe, expect, it, jest } from '@jest/globals';

jest.mock('obsidian', () => ({
    App: class { },
    Platform: { isDesktop: true, isMobile: false },
    PluginSettingTab: class {
        containerEl = { empty: jest.fn() };
        constructor(_app: unknown, _plugin: unknown) { }
    },
    Setting: class { },
}));

jest.mock('vanilla-picker', () => ({
    __esModule: true,
    default: class { },
}));

jest.mock('../src/stats-view', () => ({ STAT_PREVIEW_TYPE: 'stat-preview' }));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));
jest.mock('../src/utils', () => ({
    CryptoHelper: class { },
    personalAssitant: 'personal-assistant',
}));

import { updateQwenResponseOptionAvailability } from '../src/settings';

class MockDescription {
    text = '';

    setText(text: string) {
        this.text = text;
        return this;
    }
}

class MockToggle {
    disabled = false;

    setDisabled(disabled: boolean) {
        this.disabled = disabled;
        return this;
    }
}

describe('Qwen response option settings', () => {
    it('refreshes DashScope-only option availability when the base URL changes', () => {
        const description = new MockDescription();
        const toggles = [new MockToggle(), new MockToggle()];

        expect(updateQwenResponseOptionAvailability(
            'https://dashscope.aliyuncs.com/compatible-mode/v1',
            description,
            toggles,
        )).toBe(true);
        expect(description.text).toContain('final chat answers through Alibaba Cloud DashScope');
        expect(toggles.map((toggle) => toggle.disabled)).toEqual([false, false]);

        expect(updateQwenResponseOptionAvailability(
            'https://example.invalid/compatible-mode/v1',
            description,
            toggles,
        )).toBe(false);
        expect(description.text).toContain('available only with the DashScope OpenAI-compatible base URL');
        expect(toggles.map((toggle) => toggle.disabled)).toEqual([true, true]);

        expect(updateQwenResponseOptionAvailability(
            'https://dashscope.aliyuncs.com/compatible-mode/v1/',
            description,
            toggles,
        )).toBe(true);
        expect(toggles.map((toggle) => toggle.disabled)).toEqual([false, false]);
    });
});
