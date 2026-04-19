declare module "obsidian-callout-manager" {
  import type { App, Plugin, RGB } from "obsidian";

  export type CalloutID = string;

  export interface CalloutProperties {
    id: CalloutID;
    color: string;
    icon: string;
  }

  export interface CalloutSourceObsidian {
    type: "builtin";
  }

  export interface CalloutSourceSnippet {
    type: "snippet";
    snippet: string;
  }

  export interface CalloutSourceTheme {
    type: "theme";
    theme: string;
  }

  export interface CalloutSourceCustom {
    type: "custom";
  }

  export type CalloutSource =
    | CalloutSourceObsidian
    | CalloutSourceSnippet
    | CalloutSourceTheme
    | CalloutSourceCustom;

  export type Callout = CalloutProperties & {
    sources: CalloutSource[];
  };

  export interface CalloutManagerEventMap {
    change(): void;
  }

  export type CalloutManagerEvent = keyof CalloutManagerEventMap;
  export type CalloutManagerEventListener<Event extends CalloutManagerEvent> =
    CalloutManagerEventMap[Event];

  export interface CalloutManagerUnownedHandle {
    getCallouts(): ReadonlyArray<Callout>;
    getColor(callout: Callout): RGB | { invalid: string };
    getTitle(callout: Callout): string;
  }

  export interface CalloutManagerOwnedHandle
    extends CalloutManagerUnownedHandle {
    on<E extends CalloutManagerEvent>(
      event: E,
      listener: CalloutManagerEventListener<E>,
    ): void;
    off<E extends CalloutManagerEvent>(
      event: E,
      listener: CalloutManagerEventListener<E>,
    ): void;
  }

  export type CalloutManager<WithPluginReference extends boolean = false> =
    WithPluginReference extends true
      ? CalloutManagerOwnedHandle
      : CalloutManagerUnownedHandle;

  export const PLUGIN_ID: "callout-manager";
  export const PLUGIN_API_VERSION: "v1";

  export function getApi(plugin: Plugin): Promise<CalloutManager<true> | undefined>;
  export function getApi(): Promise<CalloutManager<false> | undefined>;
  export function isInstalled(app?: App): boolean;
}
