import { getPluginUiLanguage, makePluginTranslator } from '../../locales/plugin';
import type { DebugEvent } from '../types';

export const debugT = makePluginTranslator(getPluginUiLanguage());
export const debugLabel = (group: string, value: string) => debugT(`plugin.agentDebug.${group}.${value}`, undefined, value.replace(/_/g, ' '));
export const debugTime = (value: number) => new Date(value).toLocaleString();
export const nodeTitle = (event: DebugEvent) => typeof event.details?.purpose === 'string'
    ? debugLabel('purpose', event.details.purpose) : event.label ?? debugLabel('phase', event.kind);
