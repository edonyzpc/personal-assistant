import { Platform } from "obsidian";

interface PlatformOverrides {
    isDesktop?: boolean;
    isMobile?: boolean;
    isPhone?: boolean;
    isIosApp?: boolean;
}

const defaultPlatform: PlatformOverrides = { isDesktop: true, isMobile: false, isPhone: false, isIosApp: false };

function applyPlatform(overrides: PlatformOverrides): void {
    Object.assign(Platform, { ...defaultPlatform, ...overrides });
}

function resetPlatform(): void {
    Object.assign(Platform, defaultPlatform);
}

export function withMobilePlatform(fn: () => void): void {
    describe("(mobile platform)", () => {
        beforeEach(() => applyPlatform({ isDesktop: false, isMobile: true }));
        afterEach(resetPlatform);
        fn();
    });
}

export function withPhonePlatform(fn: () => void): void {
    describe("(phone platform)", () => {
        beforeEach(() => applyPlatform({ isDesktop: false, isMobile: true, isPhone: true }));
        afterEach(resetPlatform);
        fn();
    });
}

export function withIOSPlatform(fn: () => void): void {
    describe("(iOS platform)", () => {
        beforeEach(() => applyPlatform({ isDesktop: false, isMobile: true, isIosApp: true }));
        afterEach(resetPlatform);
        fn();
    });
}

export function withDesktopPlatform(fn: () => void): void {
    describe("(desktop platform)", () => {
        beforeEach(() => applyPlatform({ isDesktop: true, isMobile: false }));
        afterEach(resetPlatform);
        fn();
    });
}

export function setPlatformMobile(): void {
    applyPlatform({ isDesktop: false, isMobile: true });
}

export function setPlatformDesktop(): void {
    applyPlatform({ isDesktop: true, isMobile: false });
}

export { resetPlatform };
