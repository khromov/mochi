import { Composition } from 'remotion';
import { CANVAS, CANVAS_SQUARE, FPS, TOTAL_FRAMES } from './theme';
import { MochiVideo } from './MochiVideo';
import { ChangelogVideo } from './changelog/ChangelogVideo';
import { computeTimeline } from './changelog/timeline';
import { sampleRelease } from './changelog/releases/sample';
import { release as release080 } from './changelog/releases/v0_8_0';

export const RemotionRoot = () => (
  <>
    <Composition id="MochiVideo" component={MochiVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={CANVAS.width} height={CANVAS.height} />
    {/* Changelog videos: square 4K, silent, duration derived from the release timeline. The
        changelog-video skill points this at the current release (or adds a per-version id). */}
    <Composition
      id="ChangelogVideo"
      component={() => <ChangelogVideo release={sampleRelease} />}
      durationInFrames={computeTimeline(sampleRelease).totalFrames}
      fps={FPS}
      width={CANVAS_SQUARE.width}
      height={CANVAS_SQUARE.height}
    />
    <Composition
      id="Changelog-v0-8-0"
      component={() => <ChangelogVideo release={release080} />}
      durationInFrames={computeTimeline(release080).totalFrames}
      fps={FPS}
      width={CANVAS_SQUARE.width}
      height={CANVAS_SQUARE.height}
    />
  </>
);
