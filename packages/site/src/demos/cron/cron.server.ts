import { Mochi } from 'mochi-framework';
import type { CronLogEntry } from './types';

const MAX_ENTRIES = 100;

// The cron appends one entry per minute forever; trimming to the last MAX_ENTRIES keeps the in-memory log bounded.
const log: CronLogEntry[] = [];
let seq = 0;

type WsClient = { send: (data: string) => void };
const clients = new Set<WsClient>();

function broadcast(message: string): void {
  for (const ws of clients) {
    ws.send(message);
  }
}

// The site rides the default `cronStorage: 'memory'`, so the demo writes no file into the working dir; set
// `Mochi.serve({ cronStorage })` to make the schedule durable across restarts and multiple nodes.
export const activityLog = Mochi.cron('demo-activity-log', '* * * * *', (run) => {
  const entry: CronLogEntry = { seq: ++seq, at: Date.now(), scheduledTime: run.scheduledTime };
  log.push(entry);
  if (log.length > MAX_ENTRIES) {
    log.splice(0, log.length - MAX_ENTRIES);
  }
  broadcast(JSON.stringify({ type: 'entry', entry }));
});

export function addClient(ws: WsClient): void {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', entries: [...log].reverse() }));
}

export function removeClient(ws: WsClient): void {
  clients.delete(ws);
}
