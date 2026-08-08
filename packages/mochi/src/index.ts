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
export { build } from './cli/build';
export type { MochiBuildOptions } from './cli/build';
export { runTests } from './cli/testing';
export type { RunTestsOptions } from './cli/testing';
export type { MochiSvelteConfig } from './compiler/svelteConfig';
export type { MochiSvelteCompiler, SvelteCompilerBackend, SvelteCompileOutput } from './compiler/svelteCompilerBackend';
export type { ShakeAppResult, SvelteShakerBackend } from './compiler/svelteShaker';
export { getRequestContext } from './runtime/requestContext';
export type { MochiRequestContext } from './runtime/requestContext';
export { getMochiConfig } from './mochiConfig';
export type { CookieSerializeOptions, Cookie } from './runtime/cookies';
export { MochiCache } from './cache/cache';
export type { MochiCacheOptions, CacheResult, CacheStatus, Storage, SweepOptions, SweepResult } from './cache/cache';
export { requestCache, requestMemo, getRequestCache } from './runtime/requestCache';
export type { MochiRequestCache, RequestMemoOptions } from './runtime/requestCache';
export { MemoryStorage, FileStorage, isBlobRef, readBlobRef } from './cache/cache-storage';
export type { FileStorageOptions, MemoryStorageOptions, BlobRef } from './cache/cache-storage';
export { getImageUrl, getImageAttrs, getImage, getImagePlaceholder, imagePlaceholder, warmImagePlaceholder, invalidateImage } from './image/imageApi';
export type { ResolvedImage, ImageAttrs } from './image/imageApi';
export type { MochiImageOptions, ImageSize, InvalidateImageOptions, ImageFormat, ImageFit, ImportedImage, ImportedImageFormat } from './image/types';
export { IMAGE_FILE_FILTER } from './compiler/imageAssetLoader';
export { EmailError } from './email/types';
export type {
  MochiEmailOptions,
  MochiEmailMessage,
  MochiEmailResult,
  MochiEmailAttachment,
  MochiEmailTransportConfig,
  MochiEmailSendFn,
  MochiSmtpConfig,
  ResolvedEmailMessage,
} from './email/types';
export { sequence } from './runtime/hooks';
export { compress } from './middleware/compress';
export type { CompressOptions } from './middleware/compress';
export type { CompressionMethod } from './utils';
export { noCache } from './middleware/noCache';
export { consoleLogger, silenceInternalRoutes } from './dev/consoleLogger';
export type { ConsoleLoggerOptions } from './dev/consoleLogger';
export { logger, setLogLevel, getLogLevel } from './utils/log';
export type { LogLevel } from './utils/log';
export { pinGlobal } from './utils/globalState';
export { isBuilding } from './utils/buildFlag';
export { mochiEvents, hasSubscribers } from './events';
export type { MochiCompileError } from './compiler/ComponentRegistry';
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
  MochiCacheInflightDeferredEvent,
  MochiCacheDeleteEvent,
  MochiCacheSweepEvent,
  MochiImageCacheSweepEvent,
  MochiImageEntryKind,
  MochiImageStoreEvent,
  MochiImageDeleteReason,
  MochiImageDeleteEvent,
  MochiCacheRevalidateFailedEvent,
  MochiCacheErrorEvent,
  MochiQueueAddedEvent,
  MochiQueueActiveEvent,
  MochiQueueCompletedEvent,
  MochiQueueFailedEvent,
  MochiQueueErrorEvent,
  MochiEmailSentEvent,
  MochiEmailErrorEvent,
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
  MochiCaptchaVerifyEvent,
  MochiCaptchaReason,
} from './events';
export type { MochiQueue, MochiJob, MochiJobOptions, MochiQueueOptions, MochiQueueRuntimeOptions, MochiQueueListeners, MochiProcessor, MochiQueueStorage } from './queue';
export { DEFAULT_EXPIRE_IN_SECONDS } from './queue';
export { json, error, apiError } from './utils';
export { trailingSlashIt } from './runtime/trailingSlash';
export { fail, redirect, success } from './runtime/forms';
export { isHydratable } from './islands/isHydratable';

export { mintCaptcha, verifyCaptcha, consumeCaptcha, solveCaptcha } from './captcha/captcha';
export { MemoryNonceStore, SqliteNonceStore } from './captcha/nonceStore';
export { DEFAULT_CAPTCHA_BITS, DEFAULT_CAPTCHA_MIN_AGE_MS, DEFAULT_CAPTCHA_DRIFT_ALLOWANCE_MS } from './captcha/config';
export type { MintedCaptcha } from './captcha/captcha';
export type { MochiCaptchaOptions, CaptchaResult, CaptchaFailureReason, NonceStore } from './captcha/types';
export { enhance, deserialize } from './runtime/enhance.ssr';
export { isFormContentType, DEFAULT_FORM_CONTENT_TYPES, DEFAULT_PROTECTED_METHODS } from './runtime/csrf';
export { DEFAULT_COMPRESS_MIN_BYTES, encryptPayload, decryptPayload } from './islands/payloadCrypto';
export { DEFAULT_INLINE_BUDGET } from './islands/inlineServerIslands';
export type { EncryptOptions } from './islands/payloadCrypto';
export type { MochiCsrfOptions } from './runtime/csrf';
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
  ConsoleLoggerLevel,
  ConsoleLoggerLine,
} from './extensions';
export { getClientAddress, resolveExpectedOrigin } from './runtime/proxy';
export type { MochiProxyOptions } from './runtime/proxy';
export { memoryStore, sqliteStore, postgresStore } from './runtime/rateLimit';
export type {
  MochiRateLimitOptions,
  MochiRateLimitContext,
  MochiRateLimitKey,
  MochiRateLimitTier,
  MochiRateLimitSkip,
  MochiRateLimitGroup,
  MochiRateLimitInfo,
  MochiRateLimitStore,
  MochiRateLimitStoreResult,
  MochiRateLimitStoreBanResult,
  MochiRateLimitTierConfig,
  MochiRateLimitHeadersConfig,
  MochiRateLimitBanConfig,
  MochiRateLimitStoreErrorHandler,
  MochiRateLimitResponseFormatter,
  MochiSqliteStoreOptions,
  MochiPostgresStoreOptions,
} from './runtime/rateLimit';
export type { Handle, HandleError, MochiErrorInfo, MochiEvent, MochiEventKind, MochiResolveOptions, MochiResolveFn } from './runtime/hooks';
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
  MochiQueueConfig,
  BunRouteValue,
  MochiSvelteShakerOptions,
  MochiBarrelWarningOptions,
  MochiBuildReportOptions,
} from './types';

import type { Snippet } from 'svelte';

/**
 * Props helper for a `mochi:clientOnly` component, adding an optional `children` snippet so the SSR fallback passed as
 * children type-checks. That fallback is SSR-only placeholder markup and never reaches the component at runtime, so
 * leave `children` unrendered inside a client-only component.
 */
export type ClientOnlyProps<T> = Omit<T, 'children'> & { children?: Snippet };
