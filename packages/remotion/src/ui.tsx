// satori's `h`/`text` helpers defaulted every node to `display: flex` (row), which the browser
// reproduces 1:1. Box mirrors that so the ported layout matches the old satori output exactly.
import type { CSSProperties, ReactNode } from 'react';
import { FRAUNCES, MONO, VARIATION } from './fonts';

export const Box = ({ style, children }: { style?: CSSProperties; children?: ReactNode }) => <div style={{ display: 'flex', ...style }}>{children}</div>;

// Font cuts matching the four faces the old pipeline baked: display logo, neutral body,
// lighter italic dek, monospace.
export const fontDisplay: CSSProperties = { fontFamily: FRAUNCES, fontVariationSettings: VARIATION.display };
export const fontSerif: CSSProperties = { fontFamily: FRAUNCES, fontVariationSettings: VARIATION.body };
export const fontSerifItalic: CSSProperties = { fontFamily: FRAUNCES, fontStyle: 'italic', fontVariationSettings: VARIATION.italic };
export const fontMono: CSSProperties = { fontFamily: MONO };
