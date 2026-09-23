import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { AgentDebugPanel } from './components/AgentDebugPanel';
import { getPluginUiLanguage, pluginT } from '../locales/plugin';
import type { DebugContent, DebugEvent, DebugEventQuery, DebugRun, DebugRunQuery, DebugSessionDetail, DebugStoreStatus } from './types';

export const AGENT_DEBUG_VIEW_TYPE = 'pa-agent-debug-view';

export interface AgentDebugViewHost {
    enabled(): boolean;
    listRuns(query: DebugRunQuery): Promise<DebugRun[]>;
    getEvents(captureId: string, query: DebugEventQuery): Promise<DebugEvent[]>;
    getContents(captureId: string, nodeId: string): Promise<DebugContent[]>;
    getSessionDetails(captureId: string, nodeId: string): DebugSessionDetail[];
    getStatus(): Promise<DebugStoreStatus>;
    subscribe(listener: (change?: { invalidated?: boolean }) => void): () => void;
    clearHistory(): Promise<void>;
}

/** Only route identifiers enter Obsidian workspace state, never Debug content. */
export class AgentDebugView extends ItemView {
    private root: Root | null = null;
    private conversationId: string | undefined;
    private routeVersion = 0;

    constructor(leaf: WorkspaceLeaf, private readonly host: AgentDebugViewHost) { super(leaf); }
    getViewType(): string { return AGENT_DEBUG_VIEW_TYPE; }
    getDisplayText(): string { return pluginT('plugin.agentDebug.title', getPluginUiLanguage()); }
    getIcon(): string { return 'bug'; }
    getState(): Record<string, unknown> { return this.conversationId ? { conversationId: this.conversationId } : {}; }
    async setState(state: unknown, _result?: ViewStateResult): Promise<void> {
        const id = state && typeof state === 'object' && 'conversationId' in state ? state.conversationId : undefined;
        this.revealConversation(typeof id === 'string' && /^[\w.:-]{1,256}$/.test(id) ? id : undefined);
    }
    revealConversation(conversationId?: string): void {
        this.conversationId = conversationId;
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
        this.root?.render(<AgentDebugPanel key={this.routeVersion} host={this.host} conversationId={this.conversationId} />);
    }
}
