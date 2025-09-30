/**
 * @file This file contains constants used throughout the plugin.
 * @copyright Copyright (c) 2023 edonyzpc
 */

/**
 * The icon for the statistics view.
 */
export const PluginAST_STAT_ICON = "PluginAST_STAT";

/**
 * A regular expression to match comments in markdown.
 */
export const MATCH_COMMENT = new RegExp("%%[\\s\\S]*?(?!%%)[\\s\\S]+?%%", "g");

/**
 * A regular expression to match HTML comments.
 */
export const MATCH_HTML_COMMENT = new RegExp(
    "<!--[\\s\\S]*?(?:-->)?" +
    "<!---+>?" +
    "|<!(?![dD][oO][cC][tT][yY][pP][eE]|\\[CDATA\\[)[^>]*>?" +
    "|<[?][^>]*>?",
    "g"
);

/**
 * The name of the statistics file.
 */
export const STATS_FILE_NAME = "stats.json";