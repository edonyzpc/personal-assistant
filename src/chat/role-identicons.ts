export type ChatRoleIdenticon = 'user' | 'assistant';

const ROLE_IDENTICON_SEEDS: Record<ChatRoleIdenticon, string> = {
    user: 'personal-assistant:chat-role:user',
    assistant: 'personal-assistant:chat-role:assistant',
};

const ROLE_IDENTICON_TONES: Record<ChatRoleIdenticon, { saturation: number; lightness: number }> = {
    user: { saturation: 68, lightness: 52 },
    assistant: { saturation: 76, lightness: 48 },
};

const roleIdenticonSrcCache = new Map<ChatRoleIdenticon, string>();

function hashSeed(seed: string): number {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createRoleIdenticonSvg(role: ChatRoleIdenticon): string {
    const seed = ROLE_IDENTICON_SEEDS[role];
    const tone = ROLE_IDENTICON_TONES[role];
    const hash = hashSeed(seed);
    const hue = hash % 360;
    const rects: string[] = [];

    for (let y = 0; y < 5; y += 1) {
        for (let x = 0; x < 3; x += 1) {
            const bitIndex = y * 3 + x;
            if ((hash & (1 << bitIndex)) === 0) continue;
            rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
            const mirrorX = 4 - x;
            if (mirrorX !== x) {
                rects.push(`<rect x="${mirrorX}" y="${y}" width="1" height="1"/>`);
            }
        }
    }

    if (rects.length === 0) {
        rects.push('<rect x="2" y="2" width="1" height="1"/>');
    }

    return `<svg viewBox="-1.5 -1.5 8 8" xmlns="http://www.w3.org/2000/svg" fill="hsl(${hue} ${tone.saturation}% ${tone.lightness}%)">${rects.join('')}</svg>`;
}

export function getChatRoleIdenticonSrc(role: ChatRoleIdenticon): string {
    const cached = roleIdenticonSrcCache.get(role);
    if (cached) return cached;

    const svg = createRoleIdenticonSvg(role);
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    roleIdenticonSrcCache.set(role, src);
    return src;
}
