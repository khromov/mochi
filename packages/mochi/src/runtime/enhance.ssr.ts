// Server-side stubs for the `enhance` Svelte attachment and `deserialize`
// helper. The real implementations live in `enhance.client.ts` and are
// substituted in the client bundle by the `mochi-framework` virtual module
// (see `ComponentRegistry.ts`). Svelte never invokes attachments during SSR,
// so importing these symbols on the server is safe — only calls would throw.

import type { Attachment } from 'svelte/attachments';
import type { MochiEnhanceOptions, MochiEnhanceResult, MochiFormShape, MochiSubmitFunction } from '../types';

export function enhance<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape>(
  options?: MochiSubmitFunction<Success, Failure> | MochiEnhanceOptions<Success, Failure>,
): Attachment<HTMLFormElement>;
export function enhance(): never {
  throw new Error('enhance is browser-only and runs inside a hydrated island');
}

export function deserialize<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape>(text: string): MochiEnhanceResult<Success, Failure>;
export function deserialize(): never {
  throw new Error('deserialize is browser-only');
}
