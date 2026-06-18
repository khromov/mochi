// Pull the in-Svelte virtual-module type augmentations into every consumer
// that imports from `mochi-framework`. The triple-slash form is the only way
// to load an ambient `declare module` without an actual import.
// Asset-import declarations (`*.css`, `*.md`) live in `./mochi-ambient.d.ts`
// and are exposed via the `mochi-framework/ambient` subpath; consumers opt
// in by adding `/// <reference types="mochi-framework/ambient" />` to their
// own `global.d.ts`.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./mochi-framework.d.ts" />
export { Mochi } from './Mochi';
export { build } from './build';
export type { MochiBuildOptions } from './build';
export { runTests } from './testing';
export type { RunTestsOptions } from './testing';
export type { MochiSvelteConfig } from './svelteConfig';
export { getRequestContext } from './requestContext';
export type { MochiRequestContext } from './requestContext';
export { getMochiConfig } from './mochiConfig';
export type { CookieSerializeOptions, Cookie } from './cookies';
export { MochiCache } from './cache';
export type { MochiCacheOptions, CacheResult, CacheStatus } from './cache';
export { sequence } from './hooks';
export { compress } from './middleware/compress';
export type { CompressOptions } from './middleware/compress';
export type { CompressionMethod } from './utils';
export { noCache } from './middleware/noCache';
export { consoleLogger, silenceInternalRoutes } from './consoleLogger';
export type { ConsoleLoggerOptions } from './consoleLogger';
export { logger, setLogLevel, getLogLevel } from './log';
export type { LogLevel } from './log';
export { mochiEvents, hasSubscribers } from './events';
export type { MochiCompileError } from './ComponentRegistry';
export type {
  MochiEmitter,
  MochiEventMap,
  MochiRequestEvent,
  MochiRequestKind,
  MochiWsOpenEvent,
  MochiWsMessageEvent,
  MochiWsCloseEvent,
  MochiSseOpenEvent,
  MochiSseMessageEvent,
  MochiSseCloseEvent,
  MochiFileChangeEvent,
  MochiFileChangeType,
  MochiIslandErrorEvent,
  MochiIslandErrorKind,
  MochiCacheStatus,
  MochiCacheReadEvent,
  MochiCacheRevalidateEvent,
  MochiCacheRevalidateFailedEvent,
  MochiCacheErrorEvent,
  MochiServerStartEvent,
  MochiServerStopEvent,
  MochiWarmupStartEvent,
  MochiWarmupCompleteEvent,
  MochiErrorEvent,
  MochiErrorKind,
  MochiActionInvokeEvent,
  MochiActionCompleteEvent,
  MochiActionResult,
  MochiCompileStartEvent,
  MochiCompileCompleteEvent,
  MochiCompileBatchCompleteEvent,
  MochiCompileErrorEvent,
  MochiCompileErrorLog,
  MochiRecompileStartEvent,
  MochiRecompileCompleteEvent,
  MochiRecompileTrigger,
  MochiClientBundleEvent,
} from './events';
export { json, error, apiError } from './utils';
export { trailingSlashIt } from './trailingSlash';
export { fail, redirect, success } from './forms';
export { enhance, deserialize } from './enhance.ssr';
export { isFormContentType, DEFAULT_FORM_CONTENT_TYPES, DEFAULT_PROTECTED_METHODS } from './csrf';
export type { MochiCsrfOptions } from './csrf';
export type {
  MochiHooks,
  MochiFilters,
  MochiHookContext,
  MochiHookKindMap,
  MochiFilterContext,
  MochiFilterValue,
  MochiFilterReturn,
  MochiFilterKindMap,
  ConsoleLoggerSource,
} from './extensions';
export { getClientAddress, resolveExpectedOrigin } from './proxy';
export type { MochiProxyOptions } from './proxy';
export type { Handle, HandleError, MochiErrorInfo, MochiEvent, MochiEventKind, MochiResolveOptions, MochiResolveFn } from './hooks';
export type {
  MarkdownConfig,
  MarkdownHighlighter,
  MochiErrorProps,
  MochiPageConfig,
  MochiApiConfig,
  MochiApiEvent,
  MochiApiHandler,
  MochiFormResult,
  MochiFormActions,
  MochiFormActionHandler,
  MochiFormEvent,
  MochiEnhanceOptions,
  MochiEnhanceResult,
  MochiFormShape,
  MochiSubmitFunction,
  MochiSubmitCallback,
  HttpMethod,
  MochiServeOptions,
  MochiI18nOptions,
  MochiWarmupOptions,
  MochiRouteValue,
  MochiWsConfig,
  MochiWsHandlers,
  MochiWsData,
  MochiSseConfig,
  MochiSseHandler,
  MochiSseStream,
  MochiFileConfig,
  MochiFileResolver,
  BunRouteValue,
  MochiSvelteShakerOptions,
} from './types';
