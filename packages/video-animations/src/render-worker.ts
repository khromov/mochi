// Stride partitioning (id, id+workers, id+2*workers, …) spreads heavier scenes evenly across threads.
import { loadFonts, renderFramePng } from './render';
import { FPS } from './theme';

interface StartMsg {
  id: number;
  workers: number;
  total: number;
  framesDir: string;
}

declare const self: {
  onmessage: ((e: { data: StartMsg }) => void) | null;
  postMessage: (msg: unknown) => void;
  close: () => void;
};

self.onmessage = async (e) => {
  const { id, workers, total, framesDir } = e.data;
  try {
    const fonts = await loadFonts();
    let count = 0;
    for (let i = id; i < total; i += workers) {
      const png = await renderFramePng(i / FPS, fonts);
      await Bun.write(`${framesDir}/frame_${String(i).padStart(4, '0')}.png`, png);
      count++;
      self.postMessage({ type: 'progress' });
    }
    self.postMessage({ type: 'done', id, count });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
  self.close();
};
