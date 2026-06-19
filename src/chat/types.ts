import type { Component } from 'obsidian';
import type { ChatContextUsedItem, ChatTurnMemoryMetadata } from '../ai-services/chat-service';
import type { ChatMessage, ChatRuntimeWarning, PaAgentMessage, PaAgentPersistedTurn, SourceRecord } from '../ai-services/chat-types';

export interface ThinkingStatusView {
    messageDiv: HTMLDivElement;
    summaryEl: HTMLElement;
    detailsEl: HTMLElement;
    activityListEl: HTMLElement;
    toggleButton: HTMLButtonElement;
    loaderEl?: HTMLElement;
    reasoningSectionEl?: HTMLElement;
    reasoningContentEl?: HTMLElement;
    contextUsedSectionEl?: HTMLElement;
    contextUsedListEl?: HTMLElement;
    warningSectionEl?: HTMLElement;
    warningListEl?: HTMLElement;
    expanded: boolean;
    detailItems: HTMLElement[];
    lastDetail?: string;
}

export type RenderedMessage = {
    messageDiv: HTMLDivElement;
    roleEl: HTMLElement;
    loaderEl?: HTMLElement;
    contentDiv: HTMLElement;
    actionDiv: HTMLDivElement;
    actionMenu: HTMLDivElement;
    actionMenuButton: HTMLButtonElement;
    copyButton?: HTMLButtonElement;
    addMessageButton?: HTMLButtonElement;
    deleteButton?: HTMLButtonElement;
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
    messages: PaAgentMessage[];
    messagesById: Map<string, PaAgentMessage>;
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
    memoryMetadata?: ChatTurnMemoryMetadata;
    contextUsedItems: ChatContextUsedItem[];
    activityDetails: string[];
    canonicalLifecycle: CanonicalLifecycleUiState;
    userMessage?: RenderedMessage;
    assistantMessage?: RenderedMessage;
    statusView?: ThinkingStatusView;
    terminalRow?: HTMLDivElement;
    providerReasoningObserved?: boolean;
};

export type HistoryTurnEntry = {
    kind: 'history';
    user: ChatMessage;
    assistant: ChatMessage;
    memoryMetadata?: ChatTurnMemoryMetadata;
    contextUsedItems?: ChatContextUsedItem[];
    activityDetails?: string[];
    providerReasoningObserved?: boolean;
};

export type TerminalTurnEntry = {
    kind: 'terminal';
    id: number;
    prompt: string;
    content: string;
    terminalKind: 'error' | 'cancelled';
    errorDetail?: string;
    userMessage?: RenderedMessage;
    statusView?: ThinkingStatusView;
    terminalRow?: HTMLDivElement;
};

export type TimelineEntry = HistoryTurnEntry | TerminalTurnEntry;
