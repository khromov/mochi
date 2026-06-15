import type { SourceSpec } from '../components/utils.ts';
import { files as api } from '../demos/api/files.ts';
import { files as cacheEvents } from '../demos/cache-events/files.ts';
import { files as chat } from '../demos/chat/files.ts';
import { files as cookieVaryTest } from '../demos/cookie-vary-test/files.ts';
import { files as cookies } from '../demos/cookies/files.ts';
import { files as dataLoading } from '../demos/data-loading/files.ts';
import { files as error } from '../demos/error/files.ts';
import { files as errorBoundaries } from '../demos/error-boundaries/files.ts';
import { files as file } from '../demos/file/files.ts';
import { files as fileUpload } from '../demos/file-upload/files.ts';
import { files as fontLoading } from '../demos/font-loading/files.ts';
import { files as formCancel } from '../demos/form-cancel/files.ts';
import { files as formErrors } from '../demos/form-errors/files.ts';
import { files as formRedirects } from '../demos/form-redirects/files.ts';
import { files as formReturnData } from '../demos/form-return-data/files.ts';
import { files as helloWorld } from '../demos/hello-world/files.ts';
import { files as hydratable } from '../demos/hydratable/files.ts';
import { files as hydration } from '../demos/hydration/files.ts';
import { files as islandProps } from '../demos/island-props/files.ts';
import { files as lazy } from '../demos/lazy/files.ts';
import { files as lazyServerIsland } from '../demos/lazy-server-island/files.ts';
import { files as login } from '../demos/login/files.ts';
import { files as mdsvex } from '../demos/mdsvex/files.ts';
import { files as nestedComponents } from '../demos/nested-components/files.ts';
import { files as propDedup } from '../demos/prop-dedup/files.ts';
import { files as propsId } from '../demos/props-id/files.ts';
import { files as reloadFormData } from '../demos/reload-form-data/files.ts';
import { files as requestId } from '../demos/request-id/files.ts';
import { files as serverIsland } from '../demos/server-island/files.ts';
import { files as serverProps } from '../demos/server-props/files.ts';
import { files as sharedState } from '../demos/shared-state/files.ts';
import { files as streams } from '../demos/streams/files.ts';
import { files as url } from '../demos/url/files.ts';

// Single source of truth for each demo's source files, shared by the demo page
// (via loadSources), the per-demo llms.txt route, and the /llms-full.txt bundle.
export const demoFiles: Record<string, SourceSpec[]> = {
  api: api,
  'cache-events': cacheEvents,
  chat: chat,
  'cookie-vary-test': cookieVaryTest,
  cookies: cookies,
  'data-loading': dataLoading,
  error: error,
  'error-boundaries': errorBoundaries,
  file: file,
  'file-upload': fileUpload,
  'font-loading': fontLoading,
  'form-cancel': formCancel,
  'form-errors': formErrors,
  'form-redirects': formRedirects,
  'form-return-data': formReturnData,
  'hello-world': helloWorld,
  hydratable: hydratable,
  hydration: hydration,
  'island-props': islandProps,
  lazy: lazy,
  'lazy-server-island': lazyServerIsland,
  login: login,
  mdsvex: mdsvex,
  'nested-components': nestedComponents,
  'prop-dedup': propDedup,
  'props-id': propsId,
  'reload-form-data': reloadFormData,
  'request-id': requestId,
  'server-island': serverIsland,
  'server-props': serverProps,
  'shared-state': sharedState,
  streams: streams,
  url: url,
};
