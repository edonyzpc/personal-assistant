import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { AgentDebugPanel } from './components/AgentDebugPanel';
import { getPluginUiLanguage, pluginT } from '../locales/plugin';
import type { DebugContent, DebugEvent, DebugEventQuery, DebugRun, DebugRunQuery, DebugSessionDetail, DebugStoreStatus, DebugTracePage, DebugTraceQuery } from './types';

export const AGENT_DEBUG_VIEW_TYPE = 'pa-agent-debug-view';

export interface AgentDebugViewHost {
    enabled(): boolean;
    listRuns(query: DebugRunQuery): Promise<DebugRun[]>;
    getEvents(captureId: string, query: DebugEventQuery): Promise<DebugEvent[]>;
    getTracePage(captureId: string, query: DebugTraceQuery): Promise<DebugTracePage>;
    getContents(captureId: string, nodeId: string): Promise<DebugContent[]>;
    getSessionDetails(captureId: string, nodeId: string): DebugSessionDetail[];
    getStatus(): Promise<DebugStoreStatus>;
    subscribe(listener: (change?: { invalidated?: boolean }) => void): () => void;
    clearHistory(): Promise<void>;
}

export interface AgentDebugRouteTarget {
    conversationId?: string;
    captureId?: string;
    nodeId?: string;
}

/** Only route identifiers enter Obsidian workspace state, never Debug content. */
export class AgentDebugView extends ItemView {
    private root: Root | null = null;
    private conversationId: string | undefined;
    private captureId: string | undefined;
    private nodeId: string | undefined;
    private routeVersion = 0;

    constructor(leaf: WorkspaceLeaf, private readonly host: AgentDebugViewHost) { super(leaf); }
    getViewType(): string { return AGENT_DEBUG_VIEW_TYPE; }
    getDisplayText(): string { return pluginT('plugin.agentDebug.title', getPluginUiLanguage()); }
    getIcon(): string { return 'bug'; }
    getState(): Record<string, unknown> {
        return {
            ...(this.conversationId ? { conversationId: this.conversationId } : {}),
            ...(this.captureId ? { agentDebugCaptureId: this.captureId } : {}),
            ...(this.nodeId ? { agentDebugNodeId: this.nodeId } : {}),
        };
    }
    async setState(state: unknown, _result?: ViewStateResult): Promise<void> {
        if (!state || typeof state !== 'object') {
            this.revealTarget({});
            return;
        }
        const record = state as Record<string, unknown>;
        const validId = (value: unknown) => typeof value === 'string' && /^[\w.:-]{1,256}$/.test(value)
            ? value : undefined;
        this.revealTarget({
            conversationId: validId(record.conversationId),
            captureId: validId(record.agentDebugCaptureId),
            nodeId: typeof record.agentDebugNodeId === 'string' && record.agentDebugNodeId.length > 0
                ? record.agentDebugNodeId : undefined,
        });
    }
    revealConversation(conversationId?: string): void {
        this.conversationId = conversationId;
        this.routeVersion++;
        this.renderPanel();
    }
    revealTarget(target: AgentDebugRouteTarget = {}): void {
        this.conversationId = target.conversationId;
        this.captureId = target.captureId;
        this.nodeId = target.nodeId;
        this.routeVersion++;
        this.renderPanel();
    }
    async onOpen(): Promise<void> {
        const container = this.containerEl.querySelector('.view-content') ?? this.containerEl;
        this.root = createRoot(container);
        this.renderPanel();
    }
    async onClose(): Promise<void> { this.root?.unmount(); this.root = null; }
    private renderPanel(): void {
        this.root?.render(<AgentDebugPanel
            key={this.routeVersion}
            host={this.host}
            conversationId={this.conversationId}
            initialCaptureId={this.captureId}
            initialNodeId={this.nodeId}
        />);
    }
}
