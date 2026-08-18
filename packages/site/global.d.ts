/// <reference types="mochi-framework/ambient" />

declare module '@fontsource/*';
declare module '@fontsource-variable/*';

// @nprapps/sidechain ships no types. Host half only — this package embeds.
declare module '@nprapps/sidechain' {
  export class Sidechain extends HTMLElement {
    iframe: HTMLIFrameElement;
    sendMessage(data: unknown): void;
    sendLegacy(type: string, value: unknown): void;
    static matchMessage(pattern: Record<string, unknown>, callback: (data: Record<string, unknown>, event: MessageEvent) => void): (event: MessageEvent) => void;
  }

  export default Sidechain;
}
