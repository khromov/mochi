import prettyBytes from '../lib/prettyBytes';

export const formatSize = prettyBytes;

export const highlightColors = {
  keyColor: '#b8d5be',
  numberColor: '#e9a89a',
  stringColor: '#d5b982',
  trueColor: '#a7c9a8',
  falseColor: '#a7c9a8',
  nullColor: '#72786c',
};

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
