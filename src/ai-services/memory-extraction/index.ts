export {
    TypeAUserProfileExtractor,
    extractCandidatesFromText,
    deriveUserProfileRecordId,
    getOrCreateUserProfileRecordId,
    isProfileTextEligibleForPromptInjection,
    isProfileTextEligibleForStorage,
    renderUserProfileMarkdown,
    sanitizeUserProfileMarkdownForPrompt,
    sanitizeUserProfileSnapshot,
} from "./type-a-extractor";
export type {
    UserProfileCandidate,
    UserProfileConfidence,
    UserProfileEvidenceKind,
    UserProfileRecord,
    UserProfileSnapshot,
} from "./type-a-extractor";
export {
    IndexedDbUserProfileStore,
    IndexedDbExistingUserProfileReader,
    MemoryUserProfileStore,
    createExistingUserProfileReader,
    createUserProfileStore,
    getUserProfileDbName,
} from "./profile-store";
export type {
    ExistingUserProfileReader,
    UserProfileReadResult,
    UserProfileStore,
} from "./profile-store";
export { SerializedProfileGovernancePort } from "./profile-governance-port";
export type {
    ProfileGovernanceMutation,
    ProfileGovernancePort,
} from "./profile-governance-port";
export { TypeCVaultMetacognitionAnalyzer } from "./type-c-analyzer";
export type { VaultMetacognitionSnapshot } from "./type-c-analyzer";
export { MemoryExtractionScheduler, VAULT_INSIGHTS_PATH } from "./extraction-scheduler";
export type {
    AdmitTypeACandidates,
    MemoryExtractionPromptContext,
    MemoryExtractionSchedulerOptions,
    TypeAAdmissionBatch,
    TypeAAdmissionResult,
    VaultInsightsSnapshotContext,
} from "./extraction-scheduler";
