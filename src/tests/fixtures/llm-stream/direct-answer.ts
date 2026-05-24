import type { RecordedLlmStreamFixture } from "./types";

export const directAnswerFixture: RecordedLlmStreamFixture = {
    name: "direct-answer",
    description: "Model streams visible answer text without requesting tools.",
    chunks: [
        { content: "The project note says " },
        { content: "the launch checklist is ready." },
    ],
};
