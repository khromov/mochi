import { Composition } from 'remotion';
import { CANVAS, FPS, TOTAL_FRAMES } from './theme';
import { MochiVideo } from './MochiVideo';

export const RemotionRoot = () => <Composition id="MochiVideo" component={MochiVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={CANVAS.width} height={CANVAS.height} />;
