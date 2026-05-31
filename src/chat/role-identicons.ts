export type ChatRoleIdenticon = 'user' | 'assistant';
export type ChatRoleIdenticonCell = {
    row: number;
    col: number;
    delayMs: number;
};
export type ChatRoleIdenticonModel = {
    viewBox: string;
    cellSize: number;
    fill: string;
    cells: ChatRoleIdenticonCell[];
    emptyCells: ChatRoleIdenticonCell[];
};

const ROLE_IDENTICON_SEEDS: Record<ChatRoleIdenticon, string> = {
    user: 'personal-assistant:chat:user:identicon:v2',
    assistant: 'personal-assistant:chat:assistant:identicon:v5',
};

const ROLE_IDENTICON_PALETTE = [
    'var(--pa-chat-role-identicon-yellow)',
    'var(--pa-chat-role-identicon-orange)',
    'var(--pa-chat-role-identicon-red)',
    'var(--pa-chat-role-identicon-purple)',
    'var(--pa-chat-role-identicon-blue)',
];

const GRID = 5;
const SOURCE_COLS = 3;
const CELL = 4;
const ROW_DELAY_MS = 280;
const MOD = 2 ** 32;
const HASH_START = 2166136261;
const HASH_MULTIPLIER = 131;

function hash(seed: string): number {
    let hashValue = HASH_START;
    for (let index = 0; index < seed.length; index += 1) {
        hashValue = (hashValue * HASH_MULTIPLIER + seed.charCodeAt(index)) % MOD;
    }
    return hashValue;
}

function bit(hashValue: number, index: number): boolean {
    return Math.floor(hashValue / 2 ** index) % 2 === 1;
}

function cellKey(row: number, col: number): string {
    return `${row}:${col}`;
}

function createRoleIdenticonModel(role: ChatRoleIdenticon): ChatRoleIdenticonModel {
    const seed = ROLE_IDENTICON_SEEDS[role];
    const shapeHash = hash(`${seed}:shape`);
    const colorHash = hash(`${seed}:color`);
    const fill = ROLE_IDENTICON_PALETTE[Math.floor((colorHash / MOD) * ROLE_IDENTICON_PALETTE.length)];
    const filled = new Set<string>();
    const cells: ChatRoleIdenticonCell[] = [];

    for (let row = 0; row < GRID; row += 1) {
        for (let col = 0; col < SOURCE_COLS; col += 1) {
            const bitIndex = row * SOURCE_COLS + col;
            if (!bit(shapeHash, bitIndex)) continue;

            const delayMs = row * ROW_DELAY_MS;
            const mirrorCol = GRID - 1 - col;

            cells.push({ row, col, delayMs });
            filled.add(cellKey(row, col));

            if (mirrorCol !== col) {
                cells.push({ row, col: mirrorCol, delayMs });
                filled.add(cellKey(row, mirrorCol));
            }
        }
    }

    if (cells.length === 0) {
        const mid = Math.floor(GRID / 2);
        const delayMs = mid * ROW_DELAY_MS;
        cells.push({ row: mid, col: mid, delayMs });
        filled.add(cellKey(mid, mid));
    }

    const emptyCells: ChatRoleIdenticonCell[] = [];
    for (let row = 0; row < GRID; row += 1) {
        for (let col = 0; col < GRID; col += 1) {
            if (!filled.has(cellKey(row, col))) {
                emptyCells.push({ row, col, delayMs: row * ROW_DELAY_MS });
            }
        }
    }

    return {
        viewBox: '-3 -3 26 26',
        cellSize: CELL,
        fill,
        cells,
        emptyCells,
    };
}

export function getChatRoleIdenticonModel(role: ChatRoleIdenticon): ChatRoleIdenticonModel {
    return createRoleIdenticonModel(role);
}
