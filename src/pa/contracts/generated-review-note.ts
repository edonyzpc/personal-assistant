export interface GeneratedReviewNote {
    markdown: string;
    fileName: string;
    targetFolder: string;
    targetPath: string;
    sources: string[];
    tokenCost: { input: number; output: number };
    confirmationPrompt?: {
        title: string;
        message: string;
        confirmText: string;
    };
}
