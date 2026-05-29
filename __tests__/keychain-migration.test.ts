import { beforeEach, describe, it, expect, jest } from '@jest/globals';

jest.mock('obsidian');

import { KEYCHAIN_API_TOKEN_ID, CryptoHelper, getVaultApiTokenId, personalAssitant } from '../src/utils';

describe('Keychain Migration - SecretStorage', () => {
    let plugin: {
        app: { secretStorage: { setSecret: jest.Mock; getSecret: jest.Mock; listSecrets: jest.Mock } };
        settings: { apiToken?: string; statisticsVaultId: string };
        token: string;
        cryptoHelper: CryptoHelper;
        getAPIToken: () => string;
        getAPITokenSecretId: () => string;
        getLegacyAPITokenSecretId: () => string;
        clearTokenCache: () => void;
        migrateSettings: () => Promise<void>;
        saveSettings: jest.Mock;
    };
    let secretValues: Map<string, string>;

    beforeEach(() => {
        jest.clearAllMocks();
        secretValues = new Map();
        plugin = {
            app: {
                secretStorage: {
                    setSecret: jest.fn((id: string, value: string) => {
                        secretValues.set(id, value);
                    }),
                    getSecret: jest.fn((id: string) => secretValues.get(id) ?? null),
                    listSecrets: jest.fn(() => Array.from(secretValues.keys())),
                },
            },
            settings: { apiToken: '', statisticsVaultId: 'vault-123' },
            token: '',
            cryptoHelper: new CryptoHelper(),
            saveSettings: jest.fn(async () => undefined),
            getAPITokenSecretId() {
                return getVaultApiTokenId(this.settings.statisticsVaultId);
            },
            getLegacyAPITokenSecretId() {
                return KEYCHAIN_API_TOKEN_ID;
            },
            getAPIToken() {
                if (this.token !== '') {
                    return this.token;
                }
                const scopedId = this.getAPITokenSecretId();
                const scopedToken = this.app.secretStorage.getSecret(scopedId);
                const token = scopedToken ?? this.app.secretStorage.getSecret(this.getLegacyAPITokenSecretId());
                if (!token) {
                    return '';
                }
                if (!scopedToken) {
                    this.app.secretStorage.setSecret(scopedId, token);
                }
                this.token = token;
                return token;
            },
            clearTokenCache() {
                this.token = '';
            },
            async migrateSettings() {
                const rawApiToken = this.settings.apiToken;
                const scopedId = this.getAPITokenSecretId();
                if (rawApiToken && rawApiToken !== 'sk-xxx') {
                    const decrypted = await this.cryptoHelper.decryptFromBase64(rawApiToken, personalAssitant);
                    if (decrypted) {
                        this.app.secretStorage.setSecret(scopedId, decrypted);
                        delete this.settings.apiToken;
                        this.token = decrypted;
                        await this.saveSettings();
                    } else {
                        delete this.settings.apiToken;
                        await this.saveSettings();
                    }
                } else if ('apiToken' in this.settings) {
                    delete this.settings.apiToken;
                    await this.saveSettings();
                }
                if (!this.app.secretStorage.getSecret(scopedId)) {
                    const legacyToken = this.app.secretStorage.getSecret(this.getLegacyAPITokenSecretId());
                    if (legacyToken) {
                        this.app.secretStorage.setSecret(scopedId, legacyToken);
                        this.token = legacyToken;
                    }
                }
            },
        };
    });

    describe('S5: getAPIToken() - normal read path', () => {
        it('reads from vault-scoped secretStorage when cache is empty', () => {
            secretValues.set(plugin.getAPITokenSecretId(), 'sk-real-token');
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-real-token');
            expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledWith(plugin.getAPITokenSecretId());
        });

        it('falls back to legacy secret id and copies it to the vault-scoped id', () => {
            secretValues.set(KEYCHAIN_API_TOKEN_ID, 'sk-legacy-token');
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-legacy-token');
            expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith(plugin.getAPITokenSecretId(), 'sk-legacy-token');
        });

        it('returns cached token without calling secretStorage', () => {
            plugin.token = 'sk-cached';
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-cached');
            expect(plugin.app.secretStorage.getSecret).not.toHaveBeenCalled();
        });

        it('returns empty string when keychain has no entry (S3)', () => {
            const result = plugin.getAPIToken();
            expect(result).toBe('');
        });
    });

    describe('S4: clearTokenCache() - cache invalidation', () => {
        it('clears in-memory cache so next read goes to keychain', () => {
            plugin.token = 'sk-old';
            plugin.clearTokenCache();
            expect(plugin.token).toBe('');

            secretValues.set(plugin.getAPITokenSecretId(), 'sk-new');
            const result = plugin.getAPIToken();
            expect(result).toBe('sk-new');
            expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledWith(plugin.getAPITokenSecretId());
        });
    });

    describe('S2: migrateSettings() - legacy token migration', () => {
        it('decrypts encrypted token and moves to keychain', async () => {
            const crypto = new CryptoHelper();
            const encrypted = await crypto.encryptToBase64('sk-my-secret-key', personalAssitant);
            plugin.settings.apiToken = encrypted;

            await plugin.migrateSettings();

            expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith(
                plugin.getAPITokenSecretId(),
                'sk-my-secret-key'
            );
            expect(plugin.settings).not.toHaveProperty('apiToken');
            expect(plugin.token).toBe('sk-my-secret-key');
        });

        it('deletes empty legacy apiToken from data.json', async () => {
            plugin.settings.apiToken = '';
            await plugin.migrateSettings();
            expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
            expect(plugin.settings).not.toHaveProperty('apiToken');
        });

        it('deletes default "sk-xxx" legacy apiToken from data.json', async () => {
            plugin.settings.apiToken = 'sk-xxx';
            await plugin.migrateSettings();
            expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
            expect(plugin.settings).not.toHaveProperty('apiToken');
        });

        it('deletes legacy apiToken after decryption failure', async () => {
            plugin.settings.apiToken = 'invalid-not-base64-encrypted-data';
            await plugin.migrateSettings();
            expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
            expect(plugin.settings).not.toHaveProperty('apiToken');
        });

        it('copies an existing legacy keychain token into the vault-scoped id when scoped is missing', async () => {
            delete plugin.settings.apiToken;
            secretValues.set(KEYCHAIN_API_TOKEN_ID, 'sk-legacy-token');

            await plugin.migrateSettings();

            expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith(plugin.getAPITokenSecretId(), 'sk-legacy-token');
            expect(plugin.token).toBe('sk-legacy-token');
        });
    });

    describe('S1: fresh install - setting token via UI', () => {
        it('setSecret stores token in keychain and clears cache', () => {
            plugin.app.secretStorage.setSecret(plugin.getAPITokenSecretId(), 'sk-fresh-token');
            plugin.clearTokenCache();

            const result = plugin.getAPIToken();
            expect(result).toBe('sk-fresh-token');
            expect(plugin.settings.apiToken).toBe('');
        });
    });
});
