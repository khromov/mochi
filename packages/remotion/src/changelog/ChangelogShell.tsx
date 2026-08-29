// The shared "green shell": the brand gradient+grain backdrop with the ambient leaf field,
// sized to the square canvas. Reused by every changelog video so they match the brand video.
import { Background } from '../Background';
import { Leaves } from '../Leaves';
import { CANVAS_SQUARE } from '../theme';
import { Grain } from './Grain';

export const ChangelogShell = ({ t }: { t: number }) => (
  <>
    <Background />
    <Leaves t={t} width={CANVAS_SQUARE.width} height={CANVAS_SQUARE.height} />
    <Grain />
  </>
);
