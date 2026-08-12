class SettingsTab {
    private plugin: any;

    private rebuildProviderConfig(): void {
        const hasToken = this.plugin.hasTokenCachedValue() ?? Boolean(this.plugin.getConfiguredAPITokenSecret());
        void hasToken;
    }
}
