export type ChatRoleIdenticon = 'user' | 'assistant';
export type ChatRoleIdenticonCell = {
    x: number;
    y: number;
};
export type ChatRoleIdenticonModel = {
    viewBox: string;
    fill: string;
    activeFill: string;
    cells: ChatRoleIdenticonCell[];
};

const ROLE_IDENTICON_SEEDS: Record<ChatRoleIdenticon, string> = {
    user: 'personal-assistant:chat-role:user',
    assistant: 'personal-assistant:chat-role:assistant',
};

const ROLE_IDENTICON_TONES: Record<ChatRoleIdenticon, { hue: number; saturation: number; lightness: number; activeLightness: number }> = {
    user: { hue: 104, saturation: 68, lightness: 52, activeLightness: 62 },
    assistant: { hue: 168, saturation: 76, lightness: 48, activeLightness: 58 },
};

export function createChatRoleIdenticonSessionSeed(): string {
    const cryptoProvider = globalThis.crypto;
    if (typeof cryptoProvider?.randomUUID === 'function') {
        return cryptoProvider.randomUUID();
    }

    if (typeof cryptoProvider?.getRandomValues === 'function') {
        const values = new Uint32Array(2);
        cryptoProvider.getRandomValues(values);
        return `${values[0].toString(36)}-${values[1].toString(36)}`;
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashSeed(seed: string): number {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createRoleIdenticonModel(role: ChatRoleIdenticon, sessionSeed?: string): ChatRoleIdenticonModel {
    const seed = sessionSeed ? `${ROLE_IDENTICON_SEEDS[role]}:shape:${sessionSeed}` : ROLE_IDENTICON_SEEDS[role];
    const tone = ROLE_IDENTICON_TONES[role];
    const hash = hashSeed(seed);
    const cells: ChatRoleIdenticonCell[] = [];

    for (let y = 0; y < 5; y += 1) {
        for (let x = 0; x < 3; x += 1) {
            const bitIndex = y * 3 + x;
            if ((hash & (1 << bitIndex)) === 0) continue;
            cells.push({ x, y });
            const mirrorX = 4 - x;
            if (mirrorX !== x) {
                cells.push({ x: mirrorX, y });
            }
        }
    }

    if (cells.length === 0) {
        cells.push({ x: 2, y: 2 });
    }

    return {
        viewBox: '-0.5 -0.5 6 6',
        fill: `hsl(${tone.hue} ${tone.saturation}% ${tone.lightness}%)`,
        activeFill: `hsl(${tone.hue} ${tone.saturation}% ${tone.activeLightness}%)`,
        cells,
    };
}

export function getChatRoleIdenticonModel(role: ChatRoleIdenticon, sessionSeed?: string): ChatRoleIdenticonModel {
    return createRoleIdenticonModel(role, sessionSeed);
}
