import { beforeEach, describe, it, expect, jest } from '@jest/globals';

jest.mock('obsidian');

import { KEYCHAIN_API_TOKEN_ID, CryptoHelper, personalAssitant } from '../src/utils';

describe('Keychain Migration - SecretStorage', () => {
    let plugin: {
        app: { secretStorage: { setSecret: jest.Mock; getSecret: jest.Mock; listSecrets: jest.Mock } };
        settings: { apiToken: string };
        token: string;
        cryptoHelper: CryptoHelper;
        getAPIToken: () => string;
        clearTokenCache: () => void;
        migrateSettings: () => Promise<void>;
        saveSettings: jest.Mock;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        plugin = {
            app: {
                secretStorage: {
                    setSecret: jest.fn(),
                    getSecret: jest.fn(() => null),
                    listSecrets: jest.fn(() => []),
                },
            },
            settings: { apiToken: '' },
            token: '',
            cryptoHelper: new CryptoHelper(),
            saveSettings: jest.fn(),
            getAPIToken() {
                if (this.token !== '') {
                    return this.token;
                }
                const token = this.app.secretStorage.getSecret(KEYCHAIN_API_TOKEN_ID);
                if (!token) {
                    return '';
                }
                this.token = token;
                return token;
            },
            clearTokenCache() {
                this.token = '';
            },
            async migrateSettings() {
                const rawApiToken = this.settings.apiToken;
                if (rawApiToken && rawApiToken !== 'sk-xxx' && rawApiToken !== '') {
                    const decrypted = await this.cryptoHelper.decryptFromBase64(rawApiToken, personalAssitant);
                    if (decrypted) {
                        this.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, decrypted);
                        this.settings.apiToken = '';
                        this.token = decrypted;
                    }
                }
            },
        };
    });

    describe('S5: getAPIToken() - normal read path', () => {
        it('reads from secretStorage when cache is empty', () => {
            plugin.app.secretStorage.getSecret.mockReturnValue('sk-real-token');
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-real-token');
            expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledWith(KEYCHAIN_API_TOKEN_ID);
        });

        it('returns cached token without calling secretStorage', () => {
            plugin.token = 'sk-cached';
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-cached');
            expect(plugin.app.secretStorage.getSecret).not.toHaveBeenCalled();
        });

        it('returns empty string when keychain has no entry (S3)', () => {
            plugin.app.secretStorage.getSecret.mockReturnValue(null);
            const result = plugin.getAPIToken();
            expect(result).toBe('');
        });
    });

    describe('S4: clearTokenCache() - cache invalidation', () => {
        it('clears in-memory cache so next read goes to keychain', () => {
            plugin.token = 'sk-old';
            plugin.clearTokenCache();
            expect(plugin.token).toBe('');

            plugin.app.secretStorage.getSecret.mockReturnValue('sk-new');
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-new');
            expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledWith(KEYCHAIN_API_TOKEN_ID);
        });
    });

    describe('S2: migrateSettings() - legacy token migration', () => {
        it('decrypts encrypted token and moves to keychain', async () => {
            const crypto = new CryptoHelper();
            const encrypted = await crypto.encryptToBase64('sk-my-secret-key', personalAssitant);
            plugin.settings.apiToken = encrypted;

            await plugin.migrateSettings();

            expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith(
                KEYCHAIN_API_TOKEN_ID,
                'sk-my-secret-key'
            );
            expect(plugin.settings.apiToken).toBe('');
            expect(plugin.token).toBe('sk-my-secret-key');
        });

        it('skips migration when apiToken is empty (already migrated)', async () => {
            plugin.settings.apiToken = '';
            await plugin.migrateSettings();
            expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
        });

        it('skips migration when apiToken is default "sk-xxx"', async () => {
            plugin.settings.apiToken = 'sk-xxx';
            await plugin.migrateSettings();
            expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
        });

        it('handles decryption failure gracefully', async () => {
            plugin.settings.apiToken = 'invalid-not-base64-encrypted-data';
            await plugin.migrateSettings();
            expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
            expect(plugin.settings.apiToken).toBe('invalid-not-base64-encrypted-data');
        });
    });

    describe('S1: fresh install - setting token via UI', () => {
        it('setSecret stores token in keychain and clears cache', () => {
            plugin.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, 'sk-fresh-token');
            plugin.clearTokenCache();

            plugin.app.secretStorage.getSecret.mockReturnValue('sk-fresh-token');
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-fresh-token');
            expect(plugin.settings.apiToken).toBe('');
        });
    });
});
