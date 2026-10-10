import type { Component } from 'obsidian';
import type { ChatContextUsedItem, ChatTurnMemoryMetadata } from '../ai-services/chat-service';
import type { ChatMessage, ChatRuntimeWarning, PaAgentMessage, PaAgentPersistedTurn, SourceRecord } from '../ai-services/chat-types';
import type { PaAgentResultFact } from '../ai-services/pa-agent-result-facts';
import type { MessageImage } from './image-types';
import type { ChatHostProvenance } from '../ai-services/chat-provenance';
import type { ChatWritingRecovery, ChatWritingMaterialContext } from '../ai-services/chat-types';
import type { WritingVersion } from './writing-types';
import type { GenerationInputSnapshot } from '../ai-services/generation-input-snapshot';
import type { ThinkingDebugNodeRef, ThinkingExecutionSummary } from './execution-summary';

export interface ThinkingStatusView {
    messageDiv: HTMLDivElement;
    summaryEl: HTMLElement;
    detailsEl: HTMLElement;
    activityListEl: HTMLElement;
    toggleButton: HTMLButtonElement;
    loaderEl?: HTMLElement;
    reasoningSectionEl?: HTMLElement;
    reasoningToggleButton?: HTMLButtonElement;
    reasoningContentEl?: HTMLElement;
    contextUsedSectionEl?: HTMLElement;
    contextUsedListEl?: HTMLElement;
    warningSectionEl?: HTMLElement;
    warningListEl?: HTMLElement;
    expanded: boolean;
    reasoningExpanded: boolean;
    activityElementsByKey: Map<string, HTMLElement>;
    elapsedEl?: HTMLElement;
    timerId?: import('../platform-dom').PlatformIntervalHandle;
    timerStartedAt?: number;
    timerFrozenAt?: number;
}

export type ThinkingActivityStatus =
    | 'active'
    | 'succeeded'
    | 'reused'
    | 'failed'
    | 'stopped'
    | 'skipped'
    | 'unknown';

export interface ThinkingActivityRecord {
    key: string;
    kind: 'phase' | 'tool';
    title: string;
    detail?: string;
    status: ThinkingActivityStatus;
    runId?: string;
    turnId?: string;
    messageId?: string;
    toolCallId?: string;
    toolName?: string;
    executionKind?: import('./execution-summary').ThinkingExecutionStepKind;
    outcome?: string;
    sourceRecordKeys?: string[];
    operationId?: string;
    sourceSummary?: string;
    resultFact?: PaAgentResultFact;
}

export type RenderedMessage = {
    messageDiv: HTMLDivElement;
    roleEl: HTMLElement;
    loaderEl?: HTMLElement;
    contentDiv: HTMLElement;
    imageResponseDetails?: HTMLDetailsElement;
    actionDiv: HTMLDivElement;
    actionMenu: HTMLDivElement;
    actionMenuButton: HTMLButtonElement;
    copyButton?: HTMLButtonElement;
    addMessageButton?: HTMLButtonElement;
    shareButton?: HTMLButtonElement;
    deleteButton?: HTMLButtonElement;
    writingButton?: HTMLButtonElement;
    retryMessageButton?: HTMLButtonElement;
    writingRecoveryNotice?: HTMLElement;
    renderToken: number;
    copyContent: string;
    renderOwner?: Component;
    sourcePath: string;
    renderedContent?: string;
    renderedContentMode?: 'full' | 'deferred-mermaid';
    memoryMetadata?: ChatTurnMemoryMetadata;
    canonicalTurn?: PaAgentPersistedTurn;
};

export type RuntimeWarningViewItem = ChatRuntimeWarning;

export type CanonicalLifecycleUiState = {
    active: boolean;
    runId?: string;
    finalTurnId?: string;
    currentTurnId?: string;
    currentAssistantId?: string;
    messages: PaAgentMessage[];
    messagesById: Map<string, PaAgentMessage>;
    thinkingActivities: Map<string, ThinkingActivityRecord>;
    thinkingActivityOrder: string[];
    pendingReasoningParts: Map<string, { messageId: string; partIndex?: number; text: string }>;
    turnStatuses: Map<string, string>;
    hostContextUsedItems: ChatContextUsedItem[];
    hostSourceRecords: SourceRecord[];
    sawToolCallInAssistantMessage: boolean;
    pendingAnswerReclassified: boolean;
    warnings: RuntimeWarningViewItem[];
    terminalStatus?: string;
};

export type UiTurn = {
    id: number;
    prompt: string;
    images?: MessageImage[];
    userProvenance?: ChatHostProvenance;
    runSourceSelection?: import('../ai-services/chat-source-scope').RunSourceSelection;
    writingRequestId?: string;
    writingIntent?: boolean;
    writingParent?: WritingVersion;
    writingSelectedParent?: WritingVersion;
    writingMaterialContext?: ChatWritingMaterialContext;
    writingMaterials?: MessageImage[];
    writingArtifact?: { requestId: string; messageId: string; body: string; explanation: string; resultFact?: import('../ai-services/pa-agent-result-facts').PaAgentResultFact; styleRevisionIds?: string[];
        writingContext?: import('../ai-services/chat-types').ChatWritingContextMetadata; generationInput?: GenerationInputSnapshot;
        isSourceCurrent?: () => boolean };
    writingRecovery?: ChatWritingRecovery;
    writingRecoverySourceCurrent?: () => boolean;
    writingRecoveryGenerationInput?: GenerationInputSnapshot;
    writingRecoveryText?: string;
    memoryMetadata?: ChatTurnMemoryMetadata;
    contextUsedItems: ChatContextUsedItem[];
    activityDetails: string[];
    canonicalLifecycle: CanonicalLifecycleUiState;
    userMessage?: RenderedMessage;
    assistantMessage?: RenderedMessage;
    statusView?: ThinkingStatusView;
    chatStartedAt: number;
    chatDeliveredAt?: number;
    terminalRow?: HTMLDivElement;
    providerReasoningObserved?: boolean;
    providerReasoningBuffer?: string;
    debugCaptureId?: string;
    debugNodeRefs: Map<string, ThinkingDebugNodeRef>;
};

export type HistoryTurnEntry = {
    kind: 'history';
    user: ChatMessage;
    assistant: ChatMessage;
    memoryMetadata?: ChatTurnMemoryMetadata;
    contextUsedItems?: ChatContextUsedItem[];
    activityDetails?: string[];
    thinkingActivities?: ThinkingActivityRecord[];
    thinkingElapsedMs?: number;
    executionSummary?: ThinkingExecutionSummary;
    providerReasoningLegacyText?: string;
    providerReasoningObserved?: boolean;
};

export type TerminalTurnEntry = {
    kind: 'terminal';
    id: number;
    prompt: string;
    images?: MessageImage[];
    writingParent?: WritingVersion;
    writingIntent?: boolean;
    writingSelectedParent?: WritingVersion;
    writingMaterialContext?: ChatWritingMaterialContext;
    content: string;
    terminalKind: 'error' | 'cancelled';
    errorDetail?: string;
    userMessage?: RenderedMessage;
    statusView?: ThinkingStatusView;
    thinkingElapsedMs?: number;
    runId?: string;
    executionSummary?: ThinkingExecutionSummary;
    terminalRow?: HTMLDivElement;
};

export type TimelineEntry = HistoryTurnEntry | TerminalTurnEntry;
