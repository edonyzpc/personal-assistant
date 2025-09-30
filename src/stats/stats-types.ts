/**
 * @file This file contains the types for the statistics feature.
 * @copyright Copyright (c) 2023 edonyzpc
 */

/**
 * Represents the statistics for the vault.
 */
export interface VaultStatistics {
    /** The history of statistics. */
    history: History;
    /** The files that have been modified today. */
    modifiedFiles: ModifiedFiles;
}

/**
 * Represents the history of statistics.
 */
export type History = Record<string, Day>;

/**
 * Represents the statistics for a day.
 */
export interface Day {
    /** The number of words written today. */
    words: number;
    /** The number of characters written today. */
    characters: number;
    /** The number of sentences written today. */
    sentences: number;
    /** The number of pages written today. */
    pages: number;
    /** The number of files in the vault. */
    files: number;
    /** The number of footnotes written today. */
    footnotes: number;
    /** The number of citations written today. */
    citations: number;
    /** The total number of words in the vault. */
    totalWords: number;
    /** The total number of characters in the vault. */
    totalCharacters: number;
    /** The total number of sentences in the vault. */
    totalSentences: number;
    /** The total number of footnotes in the vault. */
    totalFootnotes: number;
    /** The total number of citations in the vault. */
    totalCitations: number;
    /** The total number of pages in the vault. */
    totalPages: number;
}

/**
 * Represents the files that have been modified today.
 */
export type ModifiedFiles = Record<string, FileStat>;

/**
 * Represents the statistics for a file.
 */
export interface FileStat {
    /** The number of footnotes in the file. */
    footnotes: CountDiff;
    /** The number of citations in the file. */
    citations: CountDiff;
    /** The number of words in the file. */
    words: CountDiff;
    /** The number of characters in the file. */
    characters: CountDiff;
    /** The number of sentences in the file. */
    sentences: CountDiff;
    /** The number of pages in the file. */
    pages: CountDiff;
}

/**
 * Represents the difference in a count.
 */
export interface CountDiff {
    /** The initial count. */
    initial: number;
    /** The current count. */
    current: number;
}