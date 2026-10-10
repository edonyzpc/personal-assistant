import { getPluginUiLanguage, makePluginTranslator } from '../../locales/plugin';
import type { DebugEvent } from '../types';

export const debugT = makePluginTranslator(getPluginUiLanguage());
export const debugLabel = (group: string, value: string) => debugT(`plugin.agentDebug.${group}.${value}`, undefined, value.replace(/_/g, ' '));
export const debugTime = (value: number) => new Date(value).toLocaleString();
export const nodeTitle = (event: DebugEvent) => typeof event.details?.purpose === 'string'
    ? debugLabel('purpose', event.details.purpose) : event.label ?? debugLabel('phase', event.kind);

export function debugDuration(milliseconds?: number): string {
    if (milliseconds === undefined) return debugT('plugin.agentDebug.unknown');
    return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

export function debugNodeIcon(event: DebugEvent): string {
    switch (event.nodeKind) {
        case 'run': return 'git-pull-request';
        case 'turn': return 'layers';
        case 'llm': return 'sparkles';
        case 'attempt': return 'corner-down-right';
        case 'tool': return 'wrench';
        case 'phase': return event.kind.includes('retry_wait') ? 'timer' : 'scan-line';
        default: return 'circle-help';
    }
}

export function debugStatusClass(status?: string): string {
    switch (status) {
        case 'completed': case 'success': return 'is-success';
        case 'failed': return 'is-error';
        case 'running': return 'is-running';
        case 'partial': case 'cancelled': case 'interrupted': case 'queued': case 'waiting': return 'is-warning';
        default: return 'is-unknown';
    }
}
