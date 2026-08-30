import {
    CHAR_PHRASE_PROFILE_ID,
    CHAR_PHRASE_TOKENIZER,
    getCharPhraseRuntimeCanaryFingerprint,
    segmentGraphemes,
    transformCharPhraseDocument,
} from "../src/vss/lexical-normalizer";

const PROFILE_CASES = [
    "召回。",
    "乒乓球拍",
    "東京大学生協",
    "日本語・検索",
    "々ー",
    "葛\u{E0100}",
] as const;

const profileArtifact = {
    schemaVersion: 1,
    profileId: CHAR_PHRASE_PROFILE_ID,
    tokenizer: CHAR_PHRASE_TOKENIZER,
    runtimeFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
    cases: PROFILE_CASES.map((value, index) => ({
        id: `profile-${index + 1}`,
        value,
        graphemes: segmentGraphemes(value),
        transformed: transformCharPhraseDocument(value),
    })),
};

(globalThis as typeof globalThis & {
    __PA_FTS_PROFILE_CANARY__?: typeof profileArtifact;
}).__PA_FTS_PROFILE_CANARY__ = profileArtifact;
