export interface VaultStatistics {
    history: History;
    modifiedFiles: ModifiedFiles;
}

export type History = Record<string, Day>;

export interface ActivityCounts {
    words: number;
    characters: number;
    sentences: number;
    pages: number;
    footnotes: number;
    citations: number;
}

export interface SnapshotCounts {
    totalWords: number;
    totalCharacters: number;
    totalSentences: number;
    totalFootnotes: number;
    totalCitations: number;
    totalPages: number;
    files: number;
}

export interface Day {
    words: number;
    characters: number;
    sentences: number;
    pages: number;
    files: number;
    footnotes: number;
    citations: number;
    totalWords: number;
    totalCharacters: number;
    totalSentences: number;
    totalFootnotes: number;
    totalCitations: number;
    totalPages: number;
}

export interface StatsDeviceShard {
    version: 2;
    date: string;
    deviceId: string;
    updatedAt: string;
    activity: ActivityCounts;
    snapshot: SnapshotCounts;
}

export interface StatsDashboardDay extends ActivityCounts, SnapshotCounts {
    date: string;
    updatedAt: string;
    deviceIds: string[];
}

export interface StatsStoreError {
    path: string;
    message: string;
}

export interface StatsDashboardData {
    version: 2;
    generatedAt: string;
    deviceId: string;
    days: StatsDashboardDay[];
    errors: StatsStoreError[];
}

export type ModifiedFiles = Record<string, FileStat>;

export interface FileStat {
    footnotes: CountDiff;
    citations: CountDiff;
    words: CountDiff;
    characters: CountDiff;
    sentences: CountDiff;
    pages: CountDiff;
}

export interface CountDiff {
    initial: number;
    current: number;
}
