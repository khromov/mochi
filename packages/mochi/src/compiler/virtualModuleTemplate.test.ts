import { describe, expect, test } from 'bun:test';
import { renderMochiEnvClient, renderMochiEnvServer } from './virtualModuleTemplate';

describe('mochi-env isStandalone flag', () => {
  test('the client module is standalone only when the flag is passed', () => {
    expect(renderMochiEnvClient(false, 'cookies.ts', 'enhance.ts', true)).toContain('export const isStandalone = true;');
    expect(renderMochiEnvClient(false, 'cookies.ts', 'enhance.ts')).toContain('export const isStandalone = false;');
  });

  test('the server module is never standalone (no SSR in a standalone build)', () => {
    expect(renderMochiEnvServer(false)).toContain('export const isStandalone = false;');
    expect(renderMochiEnvServer(false)).not.toContain('export const isStandalone = true;');
  });
});
