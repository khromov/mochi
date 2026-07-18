import { Mochi, localFile, localFileBytes } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// localDirs (see index.ts) declares `user-files` → ./user-files, a folder of
// checked-in sample files. In a real app your upload handler would Bun.write
// into the folder; the files here are pre-existing so the demo needs no
// upload mechanism.
const NAMES = ['hello.txt', 'archive.zip'];

async function serverProps() {
  return {
    entries: await Promise.all(NAMES.map((name) => localFile(`user-files/${name}`))),
    text: new TextDecoder().decode(await localFileBytes('user-files/hello.txt')),
  };
}

export const routes: Record<string, MochiRouteValue> = {
  '/demos/user-files': Mochi.page('./src/demos/user-files/UserFilesDemo.svelte', { serverProps }),
};
