/// <reference types="mochi-framework/ambient" />

declare module '@fontsource/*';
declare module '@fontsource-variable/*';

// @nprapps/sidechain ships no types. Guest half only — this package is the iframe.
declare module '@nprapps/sidechain' {
  export interface SidechainGuestOptions {
    id?: string;
    disablePolling?: boolean;
    polling?: number;
    sentinel?: string;
  }

  export interface SidechainGuest {
    sendMessage(data: unknown): void;
    sendLegacy(type: string, value: unknown): void;
    sendHeight(): void;
    on(type: string, callback: (value: unknown) => void): void;
    off(type: string, callback?: (value: unknown) => void): void;
    unregister(): void;
  }

  export class Sidechain extends HTMLElement {
    iframe: HTMLIFrameElement;
    sendMessage(data: unknown): void;
    sendLegacy(type: string, value: unknown): void;
    static registerGuest(options?: SidechainGuestOptions): SidechainGuest;
    static matchMessage(pattern: Record<string, unknown>, callback: (data: Record<string, unknown>, event: MessageEvent) => void): (event: MessageEvent) => void;
  }

  export default Sidechain;
}
