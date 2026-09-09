import { describe, expect, it } from 'bun:test';
import { nativeLoadError } from './nativeLoadError';

const withPlatform = <T>(platform: string, fn: () => T): T => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
};

describe('nativeLoadError', () => {
  const loadLibrary = new Error('LoadLibrary failed: The specified module could not be found.');

  // The binding's loader reports this as a skipped optional dependency, so the prebuilt `.node`
  // is the first place people look — when the real gap is the C runtime it links against.
  it('names the VC++ redistributable for a Windows LoadLibrary failure', () => {
    const message = withPlatform('win32', () => nativeLoadError(loadLibrary).message);
    expect(message).toContain('Microsoft Visual C++ Redistributable');
    expect(message).toContain('winget install --id Microsoft.VCRedist.2015+.x64 -e');
  });

  it('does not blame the redistributable off Windows', () => {
    expect(withPlatform('linux', () => nativeLoadError(loadLibrary).message)).not.toContain('VCRedist');
  });

  it('keeps the original message and cause, including for non-Error rejections', () => {
    expect(withPlatform('win32', () => nativeLoadError(loadLibrary).message)).toContain('LoadLibrary failed');
    expect(nativeLoadError(loadLibrary).cause).toBe(loadLibrary);
    expect(nativeLoadError('boom').message).toContain('boom');
  });
});
