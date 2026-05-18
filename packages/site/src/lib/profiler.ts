import { Session } from 'node:inspector/promises';

let session: Session | null = null;

export const profilerEnabled = (): boolean => process.env.MOCHI_PROFILER === '1';

export const startProfiler = async (): Promise<void> => {
  if (session) {
    return;
  }
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
};

export const stopProfiler = async (): Promise<unknown> => {
  if (!session) {
    throw new Error('profiler not started');
  }
  const { profile } = (await session.post('Profiler.stop')) as { profile: unknown };
  await session.post('Profiler.disable');
  session.disconnect();
  session = null;
  return profile;
};
