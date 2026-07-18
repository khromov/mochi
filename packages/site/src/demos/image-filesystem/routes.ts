import { Mochi, localImage } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// localDirs (see index.ts) declares runtime-served folders, among them:
//   photos  → ./images   (checked-in sample photos)
//   uploads → ./uploads  (written at runtime, below)

async function serverProps() {
  // Write raw bytes into the uploads folder at runtime — no restart, no
  // registration: the file is addressable the moment it exists on disk.
  const bytes = await Bun.file('./images/mochi-7.jpg').bytes();
  await Bun.write('./uploads/mochi-copy.jpg', bytes);

  return {
    photo: await localImage('photos/mochi-3.jpg'),
    uploaded: await localImage('uploads/mochi-copy.jpg'),
  };
}

export const routes: Record<string, MochiRouteValue> = {
  '/demos/image-filesystem': Mochi.page('./src/demos/image-filesystem/ImageFilesystemDemo.svelte', { serverProps }),
};
