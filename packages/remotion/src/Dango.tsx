// Mochi dango mascot (three soft balls on a skewer). Ported 1:1 from frame.ts:dango().
import { COLORS, RADIUS } from './theme';
import { Box } from './ui';

export const Dango = ({ ball }: { ball: number }) => {
  const stickW = ball * 0.16;
  const gap = ball * 0.06;
  const totalH = ball * 3 + gap * 2;
  const ballColors = ['#f3b9c7', '#fff6ea', COLORS.accentSoft]; // sakura / shiro / matcha
  return (
    <Box style={{ position: 'relative', width: ball, height: totalH, alignItems: 'center', justifyContent: 'center' }}>
      {/* wooden skewer poking out the bottom (you hold it by the stick) */}
      <Box style={{ position: 'absolute', left: ball / 2 - stickW / 2, top: 0, width: stickW, height: totalH + ball * 0.55, borderRadius: RADIUS.pill, background: '#d8c39c' }} />
      {ballColors.map((c, i) => (
        <Box
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            top: i * (ball + gap),
            width: ball,
            height: ball,
            borderRadius: RADIUS.pill,
            background: c,
            boxShadow: `inset ${ball * 0.12}px ${ball * 0.12}px ${ball * 0.3}px rgba(255,255,255,0.55), inset -${ball * 0.1}px -${ball * 0.12}px ${ball * 0.28}px rgba(0,0,0,0.12)`,
          }}
        />
      ))}
    </Box>
  );
};
