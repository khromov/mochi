import prettyBytes from '../vendor/pretty-bytes';

export const formatSize = prettyBytes;

export const PROPS_WARN_YELLOW_BYTES = 10240;
export const PROPS_WARN_RED_BYTES = 102400;

export type PropsWarnLevel = 'red' | 'yellow' | 'none';

export function getPropsWarnLevel(bytes: number): PropsWarnLevel {
  if (bytes > PROPS_WARN_RED_BYTES) {
    return 'red';
  }
  if (bytes > PROPS_WARN_YELLOW_BYTES) {
    return 'yellow';
  }
  return 'none';
}
