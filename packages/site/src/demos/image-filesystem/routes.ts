import { Mochi, localImage } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// staticDirs (see index.ts) mounts two folders this demo reads:
//   /gallery → ./images   (checked-in sample photos)
//   /uploads → ./uploads  (written at runtime, below)

async function serverProps() {
  // Write raw bytes into the uploads folder at runtime. Bun resolves a directory route per request, so the file is
  // servable the moment it exists on disk — no restart, no registration.
  const bytes = await Bun.file('./images/mochi-7.jpg').bytes();
  await Bun.write('./uploads/mochi-copy.jpg', bytes);

  return {
    photo: await localImage('/gallery/mochi-3.jpg'),
    uploaded: await localImage('/uploads/mochi-copy.jpg'),
  };
}

export const routes: Record<string, MochiRouteValue> = {
  '/demos/image-filesystem': Mochi.page('./src/demos/image-filesystem/ImageFilesystemDemo.svelte', { serverProps }),
};
