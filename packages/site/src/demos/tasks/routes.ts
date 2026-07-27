import { Mochi, mochiEvents } from 'mochi-framework';
import type { MochiRouteValue, MochiTaskConfig } from 'mochi-framework';
import { heartbeatTask, taskStatus, TASK_NAME } from './tasks.server';

// Mounted in the site's Mochi.serve({ tasks }) call — see src/routes.ts.
export const tasks: Record<string, MochiTaskConfig> = {
  [TASK_NAME]: heartbeatTask,
};

export const routes: Record<string, MochiRouteValue> = {
  '/demos/tasks': Mochi.page('./src/demos/tasks/Tasks.svelte', {
    serverProps: () => ({ initial: taskStatus() }),
  }),
  '/demos/tasks/events': Mochi.sse((stream) => {
    // Push the shared snapshot on every tick, so all connected clients advance
    // together instead of each polling for its own view.
    const push = (event: { task: string }) => {
      if (event.task === TASK_NAME) {
        stream.send(JSON.stringify(taskStatus()));
      }
    };
    mochiEvents.on('task:run', push);
    stream.onClose(() => {
      mochiEvents.off('task:run', push);
    });
  }),
};
