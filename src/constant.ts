// icons
export const PluginAST_STAT_ICON = "PluginAST_STAT";

// stats
export const MATCH_COMMENT = new RegExp("%%[\\s\\S]*?(?!%%)[\\s\\S]+?%%", "g");
export const MATCH_HTML_COMMENT = new RegExp(
    "<!--[\\s\\S]*?(?:-->)?" +
    "<!---+>?" +
    "|<!(?![dD][oO][cC][tT][yY][pP][eE]|\\[CDATA\\[)[^>]*>?" +
    "|<[?][^>]*>?",
    "g"
);
export const STATS_FILE_NAME = "stats.json";