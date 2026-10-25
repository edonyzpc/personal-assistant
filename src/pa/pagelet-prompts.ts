import { detectNoteLanguage } from "../locales/pagelet/language-detect";
import type { PageletOutputLanguageSetting } from "../settings/pagelet/index";

// ---------------------------------------------------------------------------
// Language Resolution
// ---------------------------------------------------------------------------

export function resolveOutputLanguage(
    setting: PageletOutputLanguageSetting,
    noteContent: string,
): "zh" | "en" {
    return setting === "auto" ? detectNoteLanguage(noteContent) : setting;
}
